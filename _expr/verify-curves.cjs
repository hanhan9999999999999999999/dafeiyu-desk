/**
 * 曲线库定量验证
 * ------------------------------------------------------------
 * 拿简化后的关键点，用项目里 lib/curve.js 同一条 Catmull-Rom 重建，
 * 与 LumenAct 原始 30fps 逐帧值对比：
 *   1. 最大/平均误差  —— 简化有没有把形状弄坏
 *   2. 过冲（overshoot） —— Catmull-Rom 在不等距点上会冲出区间，
 *      0~1 的量纲冲出边界就会让眼睑翻白、嘴角反折
 *   3. 边界越界计数
 * 运行：node verify-curves.cjs
 */
"use strict";
const fs = require("fs");
const path = require("path");

const HFDIR = path.resolve(__dirname, "..", "_ref", "LumenAct", "hf");
const cat = JSON.parse(fs.readFileSync(path.join(HFDIR, "models_expression_catalog.json"), "utf8"));
const buf = fs.readFileSync(path.join(HFDIR, "models_expression_curves.f32"));
const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
const C = cat.channel_count, FPS = cat.fps;
const NEUTRAL_ID = String(cat.neutral_style);
const CH = new Map();
cat.channels.forEach((ch, i) => CH.set(ch.property.replace(/^blendShape\./, ""), i));
const neutralStyle = cat.styles.find((s) => String(s.id) === NEUTRAL_ID);
const BASE = new Float32Array(C);
for (let c = 0; c < C; c++) BASE[c] = f32[(neutralStyle.offset) * C + c];
function d(style, frame, name) {
  const c = CH.get(name);
  return c === undefined ? 0 : f32[(style.offset + frame) * C + c] - BASE[c];
}

// —— 与 src/lib/curve.js 完全一致的实现 ——
const curve = (t, pts) => {
  if (!pts || pts.length === 0) return 0;
  const n = pts.length;
  if (n === 1) return pts[0][1];
  if (t <= pts[0][0]) return pts[0][1];
  const last = pts[n - 1];
  if (t >= last[0]) return last[1];
  let i = 0;
  for (let j = 0; j < n - 1; j += 1) if (t >= pts[j][0] && t <= pts[j + 1][0]) { i = j; break; }
  const p1 = pts[i], p2 = pts[i + 1];
  const p0 = i > 0 ? pts[i - 1] : [2 * p1[0] - p2[0], p1[1]];
  const p3 = i + 2 < n ? pts[i + 2] : [2 * p2[0] - p1[0], p2[1]];
  const span = Math.max(1e-6, p2[0] - p1[0]);
  const u = (t - p1[0]) / span, u2 = u * u, u3 = u2 * u;
  return 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * u +
    (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * u2 +
    (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * u3);
};

// 加载生成好的曲线库
const code = fs.readFileSync(path.join(__dirname, "expr-curves.js"), "utf8");
const sandbox = { window: {} };
new Function("window", code.replace(/^window\./, "window."))(sandbox.window);
const lib = sandbox.window.FishExprCurves;

// 需要重新算原始值的系列（与 build-curves.cjs 的映射保持一致）
const pct = (v) => v / 100;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const RAW = {
  ParamAngleX: (s, f) => clamp(d(s, f, "Head Turn Left-Right") * 40, -30, 30),
  ParamAngleY: (s, f) => clamp(d(s, f, "Head Nod Down-Up") * 40, -30, 30),
  ParamAngleZ: (s, f) => clamp(d(s, f, "Head Tilt Left-Right") * 30, -30, 30),
  ParamEyeBallX: (s, f) => clamp(-d(s, f, "Left Eye In-Out"), -1, 1),
  ParamEyeBallY: (s, f) => clamp(d(s, f, "Left Eye Down-Up"), -1, 1),
  ParamEyeLOpen: (s, f) => clamp(1 - Math.max(pct(d(s, f, "eye_close")), pct(d(s, f, "eye_wink_1_L")), pct(d(s, f, "eye_zitome")) * 0.6, pct(d(s, f, "eye_wink_2_L")) * 0.9), 0, 1),
  ParamEyeROpen: (s, f) => clamp(1 - Math.max(pct(d(s, f, "eye_close")), pct(d(s, f, "eye_wink_1_R")), pct(d(s, f, "eye_zitome")) * 0.6, pct(d(s, f, "eye_wink_2_R")) * 0.9), 0, 1),
  EyeSmile: (s, f) => clamp(pct(d(s, f, "eye_smile") + d(s, f, "eye_wink_1_L") * 0.25), 0, 1),
  ParamMouthForm: (s, f) => clamp(pct(d(s, f, "mouth_smile_1") * 0.85 + d(s, f, "mouth_smile_2") * 0.6 + d(s, f, "eyebrow_smile_L") * 0.15) - pct(d(s, f, "mouth_angry_1") * 0.75 + d(s, f, "mouth_angry_2") * 0.5) - d(s, f, "mouth_M") * 0.0065, -1, 1),
  ParamMouthOpenY: (s, f) => clamp(pct(d(s, f, "mouth_a") + d(s, f, "mouth_a_2") * 0.8 + d(s, f, "mouth_o") * 0.9 + d(s, f, "vrc.v_aa") * 0.8 + d(s, f, "mouth_wa") * 0.7), 0, 1),
  Mouthpucker: (s, f) => clamp(pct(d(s, f, "mouth_kiss") + d(s, f, "mouth_circle") * 0.6), 0, 1),
  CheeckPuff: (s, f) => clamp(pct(d(s, f, "mouth_cheek_inflate")), 0, 1),
  ParamBrowLY: (s, f) => clamp((d(s, f, "eyebrow_up_L") + d(s, f, "eyebrow_smile_L") * 0.5 - d(s, f, "eyebrow_down_L") * 1.15 - d(s, f, "eyebrow_serious_L") * 0.8) / 100, -1, 1),
  ParamBrowRY: (s, f) => clamp((d(s, f, "eyebrow_up_R") + d(s, f, "eyebrow_smile_R") * 0.5 - d(s, f, "eyebrow_down_R") * 1.15 - d(s, f, "eyebrow_serious_R") * 0.8) / 100, -1, 1),
  ParamBrowLAngle: (s, f) => clamp(pct(d(s, f, "eyebrow_angry_L") * 0.7 - d(s, f, "eyebrow_worry_L") * 0.8), -1, 1),
  ParamBrowRAngle: (s, f) => clamp(pct(d(s, f, "eyebrow_angry_R") * 0.7 - d(s, f, "eyebrow_worry_R") * 0.8), -1, 1),
  BrowInnerUp: (s, f) => clamp((d(s, f, "eyebrow_worry_L") + d(s, f, "eyebrow_worry_R")) / 200, 0, 1),
  ShockL: (s, f) => clamp(pct(d(s, f, "eye_surprised_L") + d(s, f, "eye_surprised") * 0.5), 0, 1),
  ShockR: (s, f) => clamp(pct(d(s, f, "eye_surprised_R") + d(s, f, "eye_surprised") * 0.5), 0, 1),
  RCry: (s, f) => clamp(pct(d(s, f, "sp_tear_default") * 0.8 + d(s, f, "sp_tear_cool")), 0, 1),
  LCry: (s, f) => clamp(pct(d(s, f, "sp_tear_default") * 0.8 + d(s, f, "sp_tear_cool")), 0, 1),
  Angry: (s, f) => clamp(pct(d(s, f, "eye_angry") * 0.7), 0, 1),
  PupilX: (s, f) => clamp(pct(d(s, f, "eyeshighlight_move_L")), -1, 1),
};
// 允许的范围（越界就是过冲）
const LIMIT = { def: [-1, 1], ParamAngleX: [-30, 30], ParamAngleY: [-30, 30], ParamAngleZ: [-30, 30],
  ParamEyeLOpen: [0, 1], ParamEyeROpen: [0, 1], EyeSmile: [0, 1], ParamMouthOpenY: [0, 1],
  Mouthpucker: [0, 1], CheeckPuff: [0, 1], BrowInnerUp: [0, 1], ShockL: [0, 1], ShockR: [0, 1],
  RCry: [0, 1], LCry: [0, 1], Angry: [0, 1] };

let worst = [], totalErr = 0, totalN = 0, overCount = 0, nanCount = 0;
const byParam = new Map();
const overMag = new Map();   // 参数 -> {max, sum, n} 过冲幅度（超出边界的绝对值）

for (const st of cat.styles) {
  const libStyle = lib.styles[String(st.id)];
  if (!libStyle) continue;
  for (const [param, pts] of libStyle.curves) {
    const raw = RAW[param];
    if (!raw) continue;
    const lim = LIMIT[param] || LIMIT.def;
    let maxErr = 0, sumErr = 0, n = 0, over = 0, bestMag = 0;
    for (let f = 0; f < st.frames; f++) {
      const t = f / FPS;
      const rv = raw(st, f);
      const cv = curve(t, pts);
      if (!isFinite(cv)) { nanCount++; continue; }
      const e = Math.abs(cv - rv);
      if (e > maxErr) maxErr = e;
      sumErr += e; n++;
      if (cv < lim[0] - 1e-6 || cv > lim[1] + 1e-6) {
        over++;
        const mag = cv < lim[0] ? lim[0] - cv : cv - lim[1];
        if (mag > bestMag) bestMag = mag;
      }
    }
    if (bestMag > 0) {
      if (!overMag.has(param)) overMag.set(param, { max: 0, sum: 0, n: 0 });
      const om = overMag.get(param);
      om.max = Math.max(om.max, bestMag); om.sum += bestMag * over; om.n += over;
    }
    totalErr += sumErr; totalN += n; overCount += over;
    const avg = sumErr / (n || 1);
    if (!byParam.has(param)) byParam.set(param, { max: 0, avg: 0, over: 0, cnt: 0 });
    const bp = byParam.get(param);
    bp.max = Math.max(bp.max, maxErr); bp.avg += avg; bp.over += over; bp.cnt++;
    worst.push({ id: st.id, label: st.label, param, maxErr, avg, over, n, range: lim });
  }
}

worst.sort((a, b) => b.maxErr - a.maxErr);
const L = [];
L.push("# 曲线重建误差验证");
L.push("");
L.push(`- 段 ${Object.keys(lib.styles).length}，曲线 ${totalN ? worst.length : 0} 条，逐帧比对 ${totalN} 个采样`);
L.push(`- 全库平均绝对误差 **${(totalErr / (totalN || 1)).toFixed(5)}**`);
L.push(`- 越界（Catmull-Rom 过冲出界定区间）${overCount} 次，NaN ${nanCount} 次`);
L.push("");
L.push("## 按参数汇总");
L.push("| 参数 | 最大误差 | 平均误差 | 越界次数 | 曲线条数 |");
L.push("|---|---|---|---|---|");
for (const [p, v] of [...byParam.entries()].sort((a, b) => b[1].max - a[1].max)) {
  L.push(`| ${p} | ${v.max.toFixed(4)} | ${(v.avg / v.cnt).toFixed(4)} | ${v.over} | ${v.cnt} |`);
}
L.push("");
L.push("## 过冲幅度（越界时超出边界多少）");
L.push("| 参数 | 最大过冲 | 平均过冲 | 越界帧数 |");
L.push("|---|---|---|---|");
for (const [p, v] of [...overMag.entries()].sort((a, b) => b[1].max - a[1].max)) {
  L.push(`| ${p} | ${v.max.toFixed(4)} | ${(v.sum / v.n).toFixed(4)} | ${v.n} |`);
}
L.push("");
L.push("## 误差最大的 15 条");
L.push("| 段 | 参数 | 最大误差 | 平均 | 越界 |");
L.push("|---|---|---|---|---|");
for (const w of worst.slice(0, 15)) {
  L.push(`| ${w.id} ${w.label} | ${w.param} | ${w.maxErr.toFixed(4)} | ${w.avg.toFixed(4)} | ${w.over} |`);
}
fs.writeFileSync(path.join(__dirname, "误差验证.md"), L.join("\n"), "utf8");
console.log(L.slice(0, 8).join("\n"));
console.log("\n--- 按参数 ---");
for (const [p, v] of [...byParam.entries()].sort((a, b) => b[1].max - a[1].max))
  console.log(`  ${p.padEnd(18)} max=${v.max.toFixed(4)} avg=${(v.avg / v.cnt).toFixed(4)} over=${v.over}`);
console.log("\n--- 过冲幅度 ---");
for (const [p, v] of [...overMag.entries()].sort((a, b) => b[1].max - a[1].max))
  console.log(`  ${p.padEnd(18)} 最大过冲=${v.max.toFixed(4)} 平均=${(v.sum / v.n).toFixed(4)} 帧数=${v.n}`);
