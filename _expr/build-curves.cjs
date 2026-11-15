/**
 * LumenAct 表演曲线 → 大肥鱼 Live2D 参数曲线  转换器  v2
 * ------------------------------------------------------------------
 * 1. 读 LumenAct catalog.json + curves.f32（166 通道 @30fps）
 * 2. 以 neutral(style 77) 第 0 帧为基线差分，只留「表演增量」
 * 3. 按语义映射表压成 Live2D 参数曲线，输出 [[ParamName,[[t,v]...]], ...]
 *
 * 为什么差分：166 通道里混着大量模型自带基线形变
 * （neutral 里 eyebrow_angry_L 就有 35.3、eye_up 恒等于 100、sp_ear_elf 恒等于 100）。
 * 不减基线，直接搬就是把脸搬歪。
 *
 * 为什么每参数单独设简化容差：量纲不一样。
 *   头部是「度」（±30），容差 0.01 等于要求精确到 0.03%，纯属浪费点；
 *   表情是 0~1，容差 0.01 已经看不见。
 *
 * 运行：node build-curves.cjs
 */
"use strict";
const fs = require("fs");
const path = require("path");

const HFDIR = path.resolve(__dirname, "..", "_ref", "LumenAct", "hf");
const SRC_CAT = path.join(HFDIR, "models_expression_catalog.json");
const SRC_BIN = path.join(HFDIR, "models_expression_curves.f32");
const OUTDIR = __dirname;

const cat = JSON.parse(fs.readFileSync(SRC_CAT, "utf8"));
const buf = fs.readFileSync(SRC_BIN);
const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
const C = cat.channel_count;
const FPS = cat.fps;
const NEUTRAL_ID = String(cat.neutral_style);

const CH = new Map();
cat.channels.forEach((ch, i) => CH.set(ch.property.replace(/^blendShape\./, ""), i));
const neutralStyle = cat.styles.find((s) => String(s.id) === NEUTRAL_ID);
if (!neutralStyle) throw new Error("找不到 neutral style " + NEUTRAL_ID);

const BASE = new Float32Array(C);
for (let c = 0; c < C; c++) BASE[c] = f32[(neutralStyle.offset + 0) * C + c];

function d(style, frame, name) {
  const c = CH.get(name);
  return c === undefined ? 0 : f32[(style.offset + frame) * C + c] - BASE[c];
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const pct = (v) => v / 100;

// ------------------------------------------------------------------
// 映射表 { fn, eps, mix }
//   fn  : (style, frame) => 值
//   eps : RDP 简化容差（按该参数自己的量纲给）
//   mix : 播放端建议的头身混合权重，1=全给，0=只取表情不取转头
// ------------------------------------------------------------------
// ------------------------------------------------------------------
// 键是「语义槽位 id」，不是模型参数名。
//
// 为什么改成槽位：以前键直接写 ParamMouthForm / EyeSmile，等于把曲线库钉死在
// 大肥鱼这一个模型上 —— 换任何一个别人做的模型，findIdx("EyeSmile") 返回 -1，
// 那些曲线会静默消失（不报错、脸不动），用户只会觉得「表情变弱了」，查不出原因。
// 现在键表达的是「她需要一个能表示笑眼的通道」，具体叫什么由渲染端按
// canon → alts 在目标模型里自己找。找不到就按降级表打折，不会整段失效。
//
// 槽位定义在 _app/src/packs/semantics.js（PARAM_SLOTS），那边是唯一真相。
// 这里只 require 引用，不复制 —— 复制一份就会漂移。
// ------------------------------------------------------------------
const sem = require(path.resolve(__dirname, "..", "_app", "src", "packs", "semantics.js"));

const TARGETS = {
  // —— 头：muscle 是骨骼旋转量，实测 Head Turn ∈[-0.516,0.739] 乘 40 → [-21,30] 度
  angleX: { eps: 0.30, mix: 0.55, fn: (s, f) => clamp(d(s, f, "Head Turn Left-Right") * 40, -30, 30) },
  angleY: { eps: 0.30, mix: 0.55, fn: (s, f) => clamp(d(s, f, "Head Nod Down-Up") * 40, -30, 30) },
  angleZ: { eps: 0.30, mix: 0.55, fn: (s, f) => clamp(d(s, f, "Head Tilt Left-Right") * 30, -30, 30) },

  // —— 眼球：VRM 的 Left/Right Eye In-Out 镜像，取左值翻号；量纲已是 ±0.5，正好对上
  eyeBallX: { eps: 0.012, fn: (s, f) => clamp(-d(s, f, "Left Eye In-Out"), -1, 1) },
  eyeBallY: { eps: 0.012, fn: (s, f) => clamp(d(s, f, "Left Eye Down-Up"), -1, 1) },

  // —— 眼睑：三路闭合取 max（闭合是「或」不是「加」） ——
  eyeLOpen: {
    eps: 0.012,
    fn: (s, f) => clamp(1 - Math.max(
      pct(d(s, f, "eye_close")), pct(d(s, f, "eye_wink_1_L")),
      pct(d(s, f, "eye_zitome")) * 0.6, pct(d(s, f, "eye_wink_2_L")) * 0.9), 0, 1),
  },
  eyeROpen: {
    eps: 0.012,
    fn: (s, f) => clamp(1 - Math.max(
      pct(d(s, f, "eye_close")), pct(d(s, f, "eye_wink_1_R")),
      pct(d(s, f, "eye_zitome")) * 0.6, pct(d(s, f, "eye_wink_2_R")) * 0.9), 0, 1),
  },
  eyeSmile: { eps: 0.010, fn: (s, f) => clamp(pct(d(s, f, "eye_smile") + d(s, f, "eye_wink_1_L") * 0.25), 0, 1) },

  // —— 嘴：嘴角正负抵消，张嘴取「或」 ——
  mouthForm: {
    eps: 0.012,
    fn: (s, f) => clamp(
      pct(d(s, f, "mouth_smile_1") * 0.85 + d(s, f, "mouth_smile_2") * 0.6 + d(s, f, "eyebrow_smile_L") * 0.15)
      - pct(d(s, f, "mouth_angry_1") * 0.75 + d(s, f, "mouth_angry_2") * 0.5)
      - d(s, f, "mouth_M") * 0.0065, -1, 1),
  },
  mouthOpen: {
    eps: 0.012,
    fn: (s, f) => clamp(pct(d(s, f, "mouth_a") + d(s, f, "mouth_a_2") * 0.8 + d(s, f, "mouth_o") * 0.9
      + d(s, f, "vrc.v_aa") * 0.8 + d(s, f, "mouth_wa") * 0.7), 0, 1),
  },
  mouthPucker: { eps: 0.010, fn: (s, f) => clamp(pct(d(s, f, "mouth_kiss") + d(s, f, "mouth_circle") * 0.6), 0, 1) },
  cheekPuff: { eps: 0.010, fn: (s, f) => clamp(pct(d(s, f, "mouth_cheek_inflate")), 0, 1) },

  // —— 眉 ——
  browLY: {
    eps: 0.012,
    fn: (s, f) => clamp((d(s, f, "eyebrow_up_L") + d(s, f, "eyebrow_smile_L") * 0.5
      - d(s, f, "eyebrow_down_L") * 1.15 - d(s, f, "eyebrow_serious_L") * 0.8) / 100, -1, 1),
  },
  browRY: {
    eps: 0.012,
    fn: (s, f) => clamp((d(s, f, "eyebrow_up_R") + d(s, f, "eyebrow_smile_R") * 0.5
      - d(s, f, "eyebrow_down_R") * 1.15 - d(s, f, "eyebrow_serious_R") * 0.8) / 100, -1, 1),
  },
  browLAngle: { eps: 0.012, fn: (s, f) => clamp(pct(d(s, f, "eyebrow_angry_L") * 0.7 - d(s, f, "eyebrow_worry_L") * 0.8), -1, 1) },
  browRAngle: { eps: 0.012, fn: (s, f) => clamp(pct(d(s, f, "eyebrow_angry_R") * 0.7 - d(s, f, "eyebrow_worry_R") * 0.8), -1, 1) },
  browInnerUp: { eps: 0.010, fn: (s, f) => clamp((d(s, f, "eyebrow_worry_L") + d(s, f, "eyebrow_worry_R")) / 200, 0, 1) },

  // —— 特效：这些在美术自己的 idle.motion3 里被驱动过，是活参数 ——
  shockL: { eps: 0.010, fn: (s, f) => clamp(pct(d(s, f, "eye_surprised_L") + d(s, f, "eye_surprised") * 0.5), 0, 1) },
  shockR: { eps: 0.010, fn: (s, f) => clamp(pct(d(s, f, "eye_surprised_R") + d(s, f, "eye_surprised") * 0.5), 0, 1) },
  // cryL / cryR 两个槽位删掉了：它们映射的是 sp_tear_default（眼角泪光）+
  // sp_tear_cool，烘进曲线库之后「难过流泪」「痛苦疼痛」一播就在眼睛下方挂一条
  // 白色泪痕 —— 主人点她一下就看到这个，说像在哭，连着报了三次。
  // 难过本来靠眼睑下垂 + 眉垮 + 嘴角向下就够，不需要眼泪。
  angry: { eps: 0.010, fn: (s, f) => clamp(pct(d(s, f, "eye_angry") * 0.7), 0, 1) },
  pupilX: { eps: 0.014, fn: (s, f) => clamp(pct(d(s, f, "eyeshighlight_move_L")), -1, 1) },
};

// 槽位表：canon / alts / range / gain 一起写进产物。
// 渲染端拿这份表就能在任意模型上自己解析，不需要反向依赖 semantics.js ——
// 这样 expr-curves.js 是自包含的，整个 _expr 目录挪到别的壳里也能跑。
const slots = {};
for (const [id, def] of Object.entries(TARGETS)) {
  const s = sem.PARAM_BY_ID[id];
  if (!s) throw new Error("TARGETS 里的槽位 " + id + " 在 semantics.js 的 PARAM_SLOTS 里不存在");
  slots[id] = {
    label: s.label,
    canon: s.canon,
    alts: s.alts || [],
    range: s.range || null,
    gain: typeof s.gain === "number" ? s.gain : 1,
    // weight：这个槽对「表情能不能被认出来」的贡献。渲染端算模型兼容性评分用，
    // 按参数个数平均会把「只有眼睑和嘴」的好模型误判成残废。
    weight: typeof sem.weightOf === "function" ? sem.weightOf(id) : 1,
    mix: def.mix != null ? def.mix : 1,
  };
}

// RDP：丢掉直线上的冗余点
function rdp(pts, eps) {
  if (pts.length <= 2) return pts;
  const [x1, y1] = pts[0], [x2, y2] = pts[pts.length - 1];
  let maxD = -1, idx = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i];
    let dist;
    if (Math.abs(x2 - x1) < 1e-12) dist = Math.abs(y - y1);
    else {
      const t = (x - x1) / (x2 - x1);
      dist = Math.abs(y - (y1 + t * (y2 - y1)));
    }
    if (dist > maxD) { maxD = dist; idx = i; }
  }
  if (maxD > eps && idx > 0) {
    return rdp(pts.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(pts.slice(idx), eps));
  }
  return [pts[0], pts[pts.length - 1]];
}

const MIN_RANGE = 0.010;    // 归一量纲；头部的量纲更大，按 eps*3 折算
const styles = {}, report = [];

for (const st of cat.styles) {
  const n = st.frames;
  const curves = [], stats = [];
  // 长段降采样到 15fps（52 秒的中性段没必要 30fps）
  const step = n > 360 ? 2 : 1;

  for (const [slotId, def] of Object.entries(TARGETS)) {
    const eps = def.eps;
    // 平坦段门槛按该槽位自己的量纲算：头部 ±30 度的区间和眼睑 0~1 的区间，
    // 用同一个常数会让「头一直微微动」被当噪声砍掉、或者「眼睑抖 1%」被当表演。
    const rg = slots[slotId].range;
    const minRange = rg ? Math.max(MIN_RANGE, (rg[1] - rg[0]) * 0.01) : MIN_RANGE;
    const pts = [];
    let mn = Infinity, mx = -Infinity, lastT = -1;
    for (let f = 0; f < n; f += step) {
      const v = def.fn(st, f);
      pts.push([+(f / FPS).toFixed(4), +v.toFixed(4)]);
      lastT = f / FPS;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    // 最后一帧一定要有，否则段尾会短一截
    if ((n - 1) % step !== 0) {
      const v = def.fn(st, n - 1);
      pts.push([+((n - 1) / FPS).toFixed(4), +v.toFixed(4)]);
      lastT = (n - 1) / FPS;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (mx - mn < minRange) continue;
    const simp = rdp(pts, eps);
    curves.push([slotId, simp]);
    stats.push({ slot: slotId, canon: slots[slotId].canon, min: +mn.toFixed(3), max: +mx.toFixed(3), keys: simp.length, mix: def.mix });
  }

  styles[String(st.id)] = {
    id: String(st.id), label: st.label,
    subcategory: st.subcategory || "", emotion: st.emotion || "",
    environment: st.environment || "", pace: st.pace || "",
    context_id: st.context_id || "",
    frames: n, dur: +(n / FPS).toFixed(3), curves,
  };
  report.push({ id: String(st.id), label: st.label, sub: st.subcategory || "", dur: +(n / FPS).toFixed(2), ch: curves.length, keys: stats.reduce((a, b) => a + b.keys, 0), stats });
}

const byLabel = {};
for (const s of Object.values(styles)) (byLabel[s.label] = byLabel[s.label] || []).push(s.id);

const out = {
  schema: "fish.exprcurves.v2",
  fps: FPS,
  source: "LumenAct v1.2 / 97 段 / 差分自 neutral(77) 第0帧 / 166 通道 → Live2D 语义槽位",
  // v2 与 v1 唯一的区别：curves 里的键是「语义槽位 id」，不是模型参数名。
  // 渲染端拿 slots 表去目标模型里找 canon / alts，找不到按降级表打折。
  // 这样同一份 388KB 的曲线库能喂任意 Live2D 模型，而不是只认大肥鱼。
  note: "curves 的键是槽位 id（见 slots），不是参数名；解析见 renderer 的 resolveExprSlot",
  generatedAt: new Date().toISOString(),
  slotIds: Object.keys(TARGETS),
  slots,
  mixedParams: Object.entries(TARGETS).filter(([, v]) => v.mix != null).map(([k, v]) => [k, v.mix]),
  byLabel, styles,
};

const jsPath = path.join(OUTDIR, "expr-curves.js");
fs.writeFileSync(jsPath,
  "/* 由 _expr/build-curves.cjs 生成，不要手改；改映射请改脚本重跑 */\n" +
  "window.FishExprCurves = " + JSON.stringify(out) + ";\n", "utf8");

const L = [];
L.push("# LumenAct → Live2D 曲线转换自检");
L.push("");
L.push(`- 通道 ${C} @ ${FPS}fps，基线 = style ${NEUTRAL_ID}「${neutralStyle.label}」第 0 帧`);
L.push(`- 目标语义槽位 ${Object.keys(TARGETS).length} 个（v2：curves 的键是槽位 id，不是模型参数名）`);
L.push(`- 产出 ${report.length} 段`);
L.push(`- 文件 ${(fs.statSync(jsPath).size / 1024).toFixed(1)} KB，总关键点 ${report.reduce((a, r) => a + r.keys, 0)}`);
L.push(`- 平均每段活槽位 ${(report.reduce((a, r) => a + r.ch, 0) / report.length).toFixed(1)} 个`);
L.push(`- 槽位表：`);
for (const [id, s] of Object.entries(slots)) {
  L.push(`  - \`${id}\` → canon \`${s.canon}\`${s.alts.length ? ` / alts ${s.alts.map((a) => "`" + a + "`").join(", ")}` : ""}｜range ${s.range ? s.range.join("~") : "?"}｜mix ${s.mix}`);
}
L.push("");
L.push("| id | label | 细分 | 时长s | 活参数 | 关键点 |");
L.push("|---|---|---|---|---|---|");
for (const r of report) L.push(`| ${r.id} | ${r.label} | ${r.sub} | ${r.dur} | ${r.ch} | ${r.keys} |`);
L.push("");
L.push("## 抽样：参数落点");
for (const id of ["54", "59", "23", "5", "34", "69", "43", "2", "58", "77", "0", "96"]) {
  const r = report.find((x) => x.id === id);
  if (!r) continue;
  L.push("");
  L.push(`### ${id} ${r.label} / ${r.sub}（${r.dur}s，${r.ch} 槽位）`);
  L.push(r.stats.map((s) => `\`${s.slot}\`(${s.canon}) ${s.min}~${s.max}(${s.keys}点${s.mix != null ? `,mix${s.mix}` : ""})`).join(" · "));
}
fs.writeFileSync(path.join(OUTDIR, "转换自检.md"), L.join("\n"), "utf8");

console.log(`OK -> ${jsPath}  ${(fs.statSync(jsPath).size / 1024).toFixed(1)} KB`);
console.log(`段 ${report.length} / 参数 ${Object.keys(TARGETS).length} / 平均活参数 ${(report.reduce((a, r) => a + r.ch, 0) / report.length).toFixed(1)}`);
console.log(`总关键点 ${report.reduce((a, r) => a + r.keys, 0)}`);
