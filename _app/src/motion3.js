// motion3.json → 点序列 的解析器。
//
// 为什么要有这一层：引擎的 motionManager 只播 model3.json 里登记过的动作。
// 而实际下载到的模型里，大量动作文件是「躺在 motions/ 里但没登记」的
// （作者换工具、重导出、或者干脆是半成品包）。用户看到文件夹里十几个动作，
// 桌宠却只会待机，只会觉得「导入坏了」。
//
// 这个解析器把 motion3 的 Segments（Linear / Bezier / Stepped / InverseStepped）
// 展开成等间隔的 [时间, 值] 点，交给 renderer 现成的曲线播放器 ——
// 它已经是 Catmull-Rom + 淡入淡出 + 交叉淡化，点密一点就等于原曲线。
//
// 同时被浏览器（window.FishMotion3）和 Node（require）使用，方便离线自测。
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FishMotion3 = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  function bezierValue(x1, y1, x2, y2, x3, y3, tx) {
    // 先把 x 反解成参数 u（x 单调，二分足够稳），再取 y(u)。
    // 20 次二分对 1/30 秒量级的采样精度远超需要，且没有迭代不收敛的风险。
    let lo = 0;
    let hi = 1;
    let u = 0.5;
    for (let i = 0; i < 24; i += 1) {
      u = (lo + hi) / 2;
      const mu = 1 - u;
      const x = mu * mu * mu * 0 + 3 * mu * mu * u * x1 + 3 * mu * u * u * x2 + u * u * u * x3;
      if (x < tx) lo = u;
      else hi = u;
    }
    const mu = 1 - u;
    return 3 * mu * mu * u * y1 + 3 * mu * u * u * y2 + u * u * u * y3;
  }

  /**
   * 把一条 Curves 的 Segments 展开成 [[t,v], ...]。
   * 段编码（Live2D 官方格式）：
   *   [0] 起始点 t0,v0
   *   之后每段：类型 + 点
   *     0 Linear        → t,v
   *     1 Bezier        → x1,y1, x2,y2, x3,y3
   *     2 Stepped       → t,v（到 t 才跳）
   *     3 InverseStepped→ t,v（进段立刻跳）
   */
  function bakeSegments(segs, step) {
    const out = [];
    if (!Array.isArray(segs) || segs.length < 2) return out;
    let t0 = Number(segs[0]);
    let v0 = Number(segs[1]);
    if (!Number.isFinite(t0) || !Number.isFinite(v0)) return out;
    out.push([t0, v0]);

    let i = 2;
    let prevT = t0;
    let prevV = v0;
    let guard = 0;
    while (i < segs.length && guard < 20000) {
      guard += 1;
      const type = Number(segs[i]);
      i += 1;
      if (type === 0) {
        const t = Number(segs[i]);
        const v = Number(segs[i + 1]);
        i += 2;
        if (!Number.isFinite(t) || !Number.isFinite(v)) break;
        const n = Math.max(1, Math.ceil((t - prevT) / step));
        for (let k = 1; k <= n; k += 1) out.push([prevT + ((t - prevT) * k) / n, prevV + (v - prevV) * (k / n)]);
        prevT = t; prevV = v;
      } else if (type === 1) {
        const x1 = Number(segs[i]), y1 = Number(segs[i + 1]);
        const x2 = Number(segs[i + 2]), y2 = Number(segs[i + 3]);
        const x3 = Number(segs[i + 4]), y3 = Number(segs[i + 5]);
        i += 6;
        if (![x1, y1, x2, y2, x3, y3].every(Number.isFinite)) break;
        const n = Math.max(1, Math.ceil((x3 - prevT) / step));
        for (let k = 1; k <= n; k += 1) {
          const t = prevT + ((x3 - prevT) * k) / n;
          out.push([t, bezierValue(x1, y1, x2, y2, x3, y3, t)]);
        }
        prevT = x3; prevV = y3;
      } else if (type === 2) {
        const t = Number(segs[i]);
        const v = Number(segs[i + 1]);
        i += 2;
        if (!Number.isFinite(t) || !Number.isFinite(v)) break;
        // 保持到 t，再跳变。中间塞一个同值点，播放器的插值不会把它抹成斜坡。
        out.push([Math.max(prevT, t - 1e-4), prevV]);
        out.push([t, v]);
        prevT = t; prevV = v;
      } else if (type === 3) {
        const t = Number(segs[i]);
        const v = Number(segs[i + 1]);
        i += 2;
        if (!Number.isFinite(t) || !Number.isFinite(v)) break;
        // 进段立刻跳，然后保持
        out.push([prevT + 1e-4, v]);
        out.push([t, v]);
        prevT = t; prevV = v;
      } else {
        // 认不出的类型：后面的数字无法判断边界，整条曲线到此为止，
        // 保留已经解析出来的部分（比整条丢掉更有用）。
        break;
      }
      if (prevT > 1e6) break;
    }
    return out;
  }

  /**
   * @returns {{duration:number, loop:boolean, curves:Array<[string, Array<[number,number]>]>}}
   */
  function parse(json, opts) {
    const o = opts || {};
    const meta = (json && json.Meta) || {};
    const step = 1 / clamp(Number(o.fps || meta.Fps || 30), 5, 120);
    const curves = [];
    let duration = Number(meta.Duration) || 0;
    const list = (json && Array.isArray(json.Curves)) ? json.Curves : [];
    for (const c of list) {
      if (!c || typeof c.Id !== "string") continue;
      const target = String(c.Target || "Parameter");
      if (target !== "Parameter") continue;          // Part 曲线不支持（和引擎行为一致）
      const pts = bakeSegments(c.Segments, step);
      if (pts.length < 2) continue;
      curves.push([c.Id, pts]);
      const last = pts[pts.length - 1][0];
      if (last > duration) duration = last;
    }
    return { duration: duration || 1, loop: meta.Loop === true, curves };
  }

  return { parse, bakeSegments, bezierValue };
});
