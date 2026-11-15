// Catmull-Rom 插值与数值夹取 —— 无状态纯函数，放在这里是为了能被单元测试直接 require。
//
// 为什么不留在 renderer.js 里：
//   渲染那个文件是 2200 行的闭包，任何断言都只能靠真机跑起来看画面，
//   而「两点之间怎么补」这类算错就看不出、只表现为「动作有点怪」。
//   抽出来之后 scripts/test-curve.js 可以拿边界值直接钉住。
//
// 为什么两处合成一份：
//   点击回弹（curve）和动作播放（lerpAt）本来就是同一条 Catmull-Rom，
//   只是零跨度兜底一个写 Math.max(1e-6, span)、一个写 span || 1。
//   同一套算法写两份，改一处漏一处是迟早的事。
//   现在统一用 Math.max(1e-6, span)：跨度为正时两者完全等价，跨度为 0 时不产生 NaN。
//
// 为什么是 Catmull-Rom 而不是 smoothstep：
//   smoothstep 在每个控制点处导数都是 0，多点的动作会变成「走走停停」，
//   每到一个点就刹一下车，看起来像卡带。Catmull-Rom 穿过每个点，
//   且相邻段在连接处一阶导数连续，速度是顺过去的；端点用「镜像虚拟邻居」，避免首尾出现假的加速度。
(function (root, factory) {
  if (typeof module === "object" && module && module.exports) module.exports = factory();
  else root.__fishCurve = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // 夹取。刻意保持原来的裸比较语义：NaN 会被原样放过去，而不是静默变成边界值。
  // 夹取一旦开始「猜」，上游算错就再也查不出来了 —— 参数变成 NaN 时她只是不动，那比默默动错好查。
  const clampNum = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  // t 秒处的值。pts = [[t0, v0], [t1, v1], ...]，要求按 t 递增（不递增也不会崩，只是取段会偏）。
  const curve = (t, pts) => {
    if (!pts || typeof pts.length !== "number" || pts.length === 0) return 0;
    const n = pts.length;
    if (n === 1) return pts[0][1];
    if (t <= pts[0][0]) return pts[0][1];
    const last = pts[n - 1];
    if (t >= last[0]) return last[1];
    let i = 0;
    for (let j = 0; j < n - 1; j += 1) {
      if (t >= pts[j][0] && t <= pts[j + 1][0]) { i = j; break; }
    }
    const p1 = pts[i], p2 = pts[i + 1];
    // 虚拟邻居：端点对自己做镜像，保证首尾切线合理
    const p0 = i > 0 ? pts[i - 1] : [2 * p1[0] - p2[0], p1[1]];
    const p3 = i + 2 < n ? pts[i + 2] : [2 * p2[0] - p1[0], p2[1]];
    const span = Math.max(1e-6, p2[0] - p1[0]);
    const u = (t - p1[0]) / span;
    const u2 = u * u, u3 = u2 * u;
    // Catmull-Rom 基函数（张力 0.5 的标准形式）
    return 0.5 * (
      (2 * p1[1]) +
      (-p0[1] + p2[1]) * u +
      (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * u2 +
      (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * u3
    );
  };

  return { curve, clampNum };
});
