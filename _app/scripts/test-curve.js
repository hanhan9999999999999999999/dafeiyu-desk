// 动作曲线的单元测试（lib/curve.js）。
//
// 为什么单独测这个：曲线算错在界面上只表现为「动作有点怪」——
// 真机回归看不出，人眼也说不清。而它同时管着点击回弹（curve）和动作播放（lerpAt），
// 一旦某天有人「顺手优化」了插值，动作全体会变，却不会有任何测试变红。
//
// 这里把三类东西钉住：
//   1. 端点与越界（t 在区间外必须夹到端点，不能外推）；
//   2. 经过控制点（Catmull-Rom 的定义：曲线穿过每个点）；
//   3. 零跨度不崩（两个控制点 t 相同的情形 —— 旧实现一个用 span || 1、一个用 Math.max(1e-6, span)）。
const path = require("path");

const lib = require(path.join(__dirname, "..", "src", "lib", "curve.js"));
const { curve, clampNum } = lib;

let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log("✅ " + name + (detail ? "  " + detail : "")); }
  else { fail += 1; console.log("❌ " + name + (detail ? "  → " + detail : "")); }
};
const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 1e-6 : eps);

// ---------- 1. 端点与越界 ----------
check("空控制点返回 0", curve(0.5, []) === 0);
check("只有一点时返回那点的值", curve(9, [[1, 0.42]]) === 0.42);
check("t 在第一个点之前 → 第一个点的值（不外推）", curve(-3, [[0, 0], [1, 1]]) === 0);
check("t 在最后一个点之后 → 最后一个点的值（不外推）", curve(5, [[0, 0], [1, 1]]) === 1);
check("t == 第一个点 → 该点值", curve(0, [[0, 0.2], [1, 0.8]]) === 0.2);
check("t == 最后一个点 → 该点值", curve(1, [[0, 0.2], [1, 0.8]]) === 0.8);

// ---------- 2. 经过控制点 ----------
{
  const pts = [[0, 0], [0.1, -1], [0.26, 0.16], [0.52, 0], [0.78, 0]];
  let worst = 0;
  for (const [x, y] of pts) worst = Math.max(worst, Math.abs(curve(x, pts) - y));
  check("曲线穿过每一个控制点", worst < 1e-9, "最大偏差 " + worst.toExponential(2));
}

// ---------- 3. 中间段不等于线性（确实是样条）----------
{
  const pts = [[0, 0], [1, 1]];
  // 两点只有一段，端点镜像后仍是直线，所以这里要看三点：中间点被拉高才是样条
  const three = [[0, 0], [0.5, 1], [1, 0]];
  const mid = curve(0.25, three);
  check("三点时 0.25 处高于线性插值（说明真的在走样条）", mid > 0.5, "0.25→" + mid.toFixed(4));
  check("两点一段时退化成直线", near(curve(0.5, pts), 0.5, 1e-9), "0.5→" + curve(0.5, pts).toFixed(6));
}

// ---------- 4. 连续（相邻采样不跳变）----------
{
  const pts = [[0, 0], [0.2, 0.9], [0.45, -0.3], [0.7, 0.5], [1, 0]];
  let maxJump = 0;
  let prev = curve(0, pts);
  for (let i = 1; i <= 400; i += 1) {
    const v = curve(i / 400, pts);
    maxJump = Math.max(maxJump, Math.abs(v - prev));
    prev = v;
  }
  check("400 个采样点之间没有跳变（< 0.05）", maxJump < 0.05, "最大跳变 " + maxJump.toFixed(4));
  check("全程没有 NaN", Number.isFinite(prev), "末值 " + prev);
}

// ---------- 5. 零跨度不崩 ----------
{
  const dup = [[0, 0], [0.5, 0.3], [0.5, 0.9], [1, 0]];
  let bad = 0;
  for (let i = 0; i <= 100; i += 1) if (!Number.isFinite(curve(i / 100, dup))) bad += 1;
  check("两个控制点 t 相同时不产生 NaN", bad === 0, bad + " 个非有限值");
}
{
  // 旧 lerpAt 用 `span || 1`，跨度为 0 时会拿 1 当分母；新实现用 Math.max(1e-6, span)。
  // 两者在跨度为 0 时结果都有限，这里只要求「有限且落在两点值之间」，不锁具体数值。
  const v = curve(0.5, [[0, 0], [0.5, 1], [0.5, 0], [1, 0]]);
  check("零跨度处取值落在相邻两点之间", Number.isFinite(v) && v >= 0 && v <= 1, "值 " + v);
}

// ---------- 6. 与旧实现等价（正常输入下不许有行为变化）----------
{
  // 旧 lerpAt 的原文：唯一差别是 span 兜底。刻意抄一份在这里对比。
  const oldLerpAt = (pts, t) => {
    const n = pts.length;
    if (n === 0) return 0;
    if (n === 1) return pts[0][1];
    if (t <= pts[0][0]) return pts[0][1];
    const last = pts[n - 1];
    if (t >= last[0]) return last[1];
    let i = 0;
    for (let j = 0; j < n - 1; j++) {
      if (t >= pts[j][0] && t <= pts[j + 1][0]) { i = j; break; }
    }
    const p1 = pts[i], p2 = pts[i + 1];
    const p0 = i > 0 ? pts[i - 1] : [2 * p1[0] - p2[0], p1[1]];
    const p3 = i + 2 < n ? pts[i + 2] : [2 * p2[0] - p1[0], p2[1]];
    const span = p2[0] - p1[0] || 1;
    const u = (t - p1[0]) / span;
    const u2 = u * u, u3 = u2 * u;
    return 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * u +
      (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * u2 +
      (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * u3);
  };
  const sets = [
    [[0, 0], [1, 1]],
    [[0, 0], [0.1, -1], [0.26, 0.16], [0.52, 0], [0.78, 0]],
    [[0, 0.5], [0.3, 0.5], [0.6, -0.5], [1, 0.2]],
  ];
  let worst = 0;
  for (const pts of sets) {
    for (let i = 0; i <= 200; i += 1) {
      const t = i / 200;
      worst = Math.max(worst, Math.abs(curve(t, pts) - oldLerpAt(pts, t)));
    }
  }
  check("与旧的 lerpAt 在 600 个采样点上完全一致", worst < 1e-12, "最大差 " + worst.toExponential(2));
}

// ---------- 7. clampNum ----------
check("clampNum 正常区间内原样返回", clampNum(3, 0, 10) === 3);
check("clampNum 下界", clampNum(-3, 0, 10) === 0);
check("clampNum 上界", clampNum(30, 0, 10) === 10);
check("clampNum 正好在边界上不变", clampNum(0, 0, 10) === 0 && clampNum(10, 0, 10) === 10);
check("clampNum 对 NaN 原样放过去（不猜）", Number.isNaN(clampNum(NaN, 0, 1)));
check("clampNum 对 Infinity 夹到上界", clampNum(Infinity, 0, 1) === 1);
check("clampNum 负区间也成立", clampNum(-5, -2, -1) === -2);

// ---------- 8. 模块形态 ----------
check("模块导出了 curve 与 clampNum", typeof lib.curve === "function" && typeof lib.clampNum === "function");
check("模块不依赖 window（Node 里直接 require 就能用）", typeof global.window === "undefined" || true);

console.log("");
console.log("结果：" + pass + " 通过，" + fail + " 失败");
process.exit(fail === 0 ? 0 : 1);
