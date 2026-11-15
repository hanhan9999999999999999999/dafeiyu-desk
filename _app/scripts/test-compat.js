// 兼容层自测：拿几种真实的「怪模型」打它，看能不能正确对上语义槽。
//
// 这几类最常把人坑到：
//   ① 标准 Cubism 模型 —— 必须全对，一个都不能错；
//   ② 画师改名模型 —— 名字里带 Eye_Smile_L、Brow_Up_1 这种写法；
//   ③ 只有单侧参数的模型 —— 一个 ParamEyeOpen 要同时服务左右眼；
//   ④ 敌意顺序 —— ParamBodyAngleX 排在最前，不能被认成「转头」（这条以前是真 bug）；
//   ⑤ 极简模型 —— 只有 5 个必需参数，其余全缺，要老实说「基础兼容」，不能硬凑。
const sem = require("../src/packs/semantics.js");
const compat = require("../src/packs/compat.js");

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log("✅ " + name); }
  else { fail += 1; console.log("❌ " + name + (extra ? "  → " + extra : "")); }
}

const STANDARD = sem.PARAM_SLOTS.map((s) => s.canon);
const RENAMED = [
  "ParamHeadAngleX", "ParamHeadAngleY", "ParamHeadAngleZ",
  "ParamBodyX", "ParamBodyZ",
  "ParamHitomiX", "ParamHitomiY",
  "ParamEyeOpenL", "ParamEyeOpenR",
  "ParamMouthA", "ParamMouthShape", "ParamBreath2",
  "ParamEyeSmileL", "ParamEyeSmileR",
  "ParamBrowUp_L", "ParamBrowUp_R", "ParamBrowAngle_L", "ParamBrowAngle_R",
  "ParamBrowInnerUp",
  "ParamEyeShockL", "ParamEyeShockR", "ParamTearL", "ParamTearR",
  "ParamAnger", "ParamPupilX", "ParamMouthO", "ParamCheek",
];
const ONE_EYE = ["ParamAngleX", "ParamAngleZ", "ParamEyeOpen", "ParamMouthOpenY", "ParamBreath"];
const HOSTILE = ["ParamBodyAngleX", "ParamBodyAngleZ", "ParamAngleX", "ParamAngleZ", "ParamEyeLOpen", "ParamEyeROpen", "ParamMouthOpenY"];
const MINIMAL = ["ParamAngleX", "ParamAngleZ", "ParamEyeLOpen", "ParamEyeROpen", "ParamMouthOpenY"];

// ── ① 标准模型 ──
const std = compat.resolve({ paramIds: STANDARD, exprNames: ["default", "happy", "shy"] });
ok("标准模型：26 个槽全部接上", Object.keys(std.params).every((k) => std.params[k].length > 0), JSON.stringify(std.missing));
ok("标准模型：全部走「标准名」，没有一处靠猜", std.detail.every((d) => d.how === "exact"), JSON.stringify(std.detail.filter((d) => d.how !== "exact")));
ok("标准模型：评分是 full", std.level === "full" && std.score >= 85, std.score + "/" + std.level);
ok("标准模型：表情对上了 default/happy/shy", std.exprs.default === "default" && std.exprs.happy === "happy" && std.exprs.shy === "shy");
ok("标准模型：不需要替身", std.proxied.length === 0);

// ── ② 改名模型 ──
const rn = compat.resolve({ paramIds: RENAMED, exprNames: ["通常", "笑顔", "照れ"] });
ok("改名模型：转头认到 ParamHeadAngleX", (rn.params.angleX || [])[0] === "ParamHeadAngleX", JSON.stringify(rn.params.angleX));
ok("改名模型：嘴巴认到 ParamMouthA", (rn.params.mouthOpen || [])[0] === "ParamMouthA", JSON.stringify(rn.params.mouthOpen));
ok("改名模型：笑眼认到 ParamEyeSmileL", (rn.params.eyeSmile || [])[0] === "ParamEyeSmileL", JSON.stringify(rn.params.eyeSmile));
ok("改名模型：少见的眉角也对上", (rn.params.browLAngle || [])[0] === "ParamBrowAngle_L", JSON.stringify(rn.params.browLAngle));
ok("改名模型：整体不是 basic", rn.level !== "basic", rn.level);
ok("改名模型：中文表情名能认（通常→default，笑顔→happy）", rn.exprs.default === "通常" && rn.exprs.happy === "笑顔", JSON.stringify(rn.exprs));

// ── ③ 单侧参数 ──
const one = compat.resolve({ paramIds: ONE_EYE });
ok("单侧模型：一个 ParamEyeOpen 同时喂左右眼", (one.params.eyeLOpen || [])[0] === "ParamEyeOpen" && (one.params.eyeROpen || [])[0] === "ParamEyeOpen", JSON.stringify([one.params.eyeLOpen, one.params.eyeROpen]));
ok("单侧模型：标记了「左右共用」", one.sideShared.includes("eyeROpen"), JSON.stringify(one.sideShared));
ok("单侧模型：必需参数 5 个全有 → 不是 basic", one.level !== "basic", one.level + " " + one.requiredOk + "/" + one.requiredTotal);

// ── ④ 敌意顺序（回归：以前会把身体角度认成转头）──
const hs = compat.resolve({ paramIds: HOSTILE });
ok("敌意顺序：转头没有被身体角度抢走", (hs.params.angleX || [])[0] === "ParamAngleX", JSON.stringify(hs.params.angleX));
ok("敌意顺序：身体左右转认到 ParamBodyAngleX", (hs.params.bodyAngleX || [])[0] === "ParamBodyAngleX", JSON.stringify(hs.params.bodyAngleX));
ok("敌意顺序：歪头没有被身体抢走", (hs.params.angleZ || [])[0] === "ParamAngleZ", JSON.stringify(hs.params.angleZ));
ok("敌意顺序：身体侧倾认到 ParamBodyAngleZ", (hs.params.bodyAngleZ || [])[0] === "ParamBodyAngleZ", JSON.stringify(hs.params.bodyAngleZ));
ok("敌意顺序：同一个参数不会被两个槽抢着用",
  (() => {
    const used = hs.detail.filter((d) => d.score > 0).map((d) => d.param);
    const dup = used.filter((x, i) => used.indexOf(x) !== i);
    // 左右共用是允许的（shared 分数为 0），这里只查非 shared 的重复
    return dup.every((p) => hs.sideShared.some((s) => (hs.params[s] || [])[0] === p));
  })(),
  JSON.stringify(hs.detail));

// ── ⑤ 极简模型 ──
const mn = compat.resolve({ paramIds: MINIMAL });
ok("极简模型：缺的槽老实留空", mn.missing.length > 10, mn.missing.length);
ok("极简模型：有笑眼替身（眯眼），并写清楚", mn.proxied.some((p) => p.slot === "eyeSmile" && p.kind === "squint"), JSON.stringify(mn.proxied));
ok("极简模型：等级不高，不吹牛", mn.level !== "full", mn.level);
ok("极简模型：报告里有「缺什么」的人话", /缺：/.test(mn.summary.lines.join(" ")), JSON.stringify(mn.summary.lines));

// ── 通用性质 ──
ok("任何输入都不抛异常", (() => {
  for (const bad of [{}, { paramIds: null }, { paramIds: [""] }, { paramIds: [1, 2, {}] }]) {
    compat.resolve(bad);
  }
  return true;
})());
ok("空模型：必需参数 0 个 → basic", compat.resolve({ paramIds: [] }).level === "basic");
ok("toGuesses 出来的结构能直接喂给老代码", (() => {
  const g = compat.toGuesses(std);
  return g.params && typeof g.params === "object" && g.expressions && typeof g.expressions === "object";
})());
ok("每个槽都有 SPEC 兜底（新加槽不会静默失效）",
  sem.PARAM_SLOTS.every((s) => !!compat.SPEC[s.id] || (compat.ALIAS[s.id] || []).length > 0),
  sem.PARAM_SLOTS.filter((s) => !compat.SPEC[s.id] && !(compat.ALIAS[s.id] || []).length).map((s) => s.id).join(","));

console.log("\n结果：" + pass + " 通过，" + fail + " 失败");
process.exitCode = fail ? 1 : 0;
