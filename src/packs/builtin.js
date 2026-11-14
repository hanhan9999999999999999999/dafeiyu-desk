// 内置动作库的「数据视图」。
//
// src/motions.js 是给浏览器用的（`window.FishMotions = {...}`），服务端要读它只能
// 用沙箱跑一遍 —— 但这样最值得：动作库更新（加新动作、改曲线）之后，适配器里
// 的「内置场景列表」和「专有参数别名」会自动跟着变，不会出现两边对不上的情况。
//
// 沙箱只给一个空 window，没有 require / process / fs，跑的是我们自己的文件，风险可控。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let CACHE = null;

/**
 * @param {string} motionsFile 绝对路径
 * @returns {{scenes: Object<string,string[]>, motions: Object, paramRefs: string[], paramOwners: Object, actionCount: number}}
 */
function loadBuiltin(motionsFile) {
  if (CACHE && CACHE.file === motionsFile && CACHE.at > 0) return CACHE.value;
  const out = { scenes: {}, motions: {}, paramRefs: [], paramOwners: {}, actionCount: 0 };
  try {
    const src = fs.readFileSync(motionsFile, "utf8");
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    // 超时保护：动作库是纯数据，正常 <50ms；卡住说明文件坏了，不该拖死服务
    vm.runInContext(src, sandbox, { filename: path.basename(motionsFile), timeout: 4000 });
    const w = sandbox.window || {};
    if (w.FishMotionScenes && typeof w.FishMotionScenes === "object") {
      for (const k of Object.keys(w.FishMotionScenes)) {
        out.scenes[k] = Array.isArray(w.FishMotionScenes[k]) ? w.FishMotionScenes[k].slice() : [];
      }
    }
    if (w.FishMotions && typeof w.FishMotions === "object") {
      out.motions = w.FishMotions;
      out.actionCount = Object.keys(w.FishMotions).length;
      // 曲线里出现过的所有参数名，按首次出现顺序；再记下每个参数被哪些动作用到（给别名提示文案用）
      const seen = new Set();
      for (const name of Object.keys(w.FishMotions)) {
        const curves = w.FishMotions[name];
        if (!Array.isArray(curves)) continue;
        for (const c of curves) {
          if (!Array.isArray(c) || typeof c[0] !== "string") continue;
          const p = c[0];
          if (!seen.has(p)) { seen.add(p); out.paramRefs.push(p); }
          (out.paramOwners[p] = out.paramOwners[p] || []).push(name);
        }
      }
    }
  } catch (e) {
    out.error = e.message;
  }
  CACHE = { file: motionsFile, at: Date.now(), value: out };
  return out;
}

// 标准 Cubism 参数 —— 这些在动作库里出现是正常的，不需要别名。
// 判断依据：语义槽的 canon 名都在这里（从 semantics 取，不重复维护）
const sem = require("./semantics");
const STANDARD = new Set();
for (const s of sem.PARAM_SLOTS) {
  STANDARD.add(s.canon);
  for (const a of s.alts || []) STANDARD.add(a);
}
for (const extra of [
  "ParamAngleX", "ParamAngleY", "ParamAngleZ", "ParamBodyAngleX", "ParamBodyAngleZ",
  "ParamEyeBallX", "ParamEyeBallY", "ParamEyeLOpen", "ParamEyeROpen",
  "ParamMouthOpenY", "ParamMouthForm", "ParamBreath", "ParamEyeSmile",
  "ParamBrowLY", "ParamBrowRY", "ParamBrowLA", "ParamBrowRA", "ParamCheek",
  "ParamHairFront", "ParamHairBack", "ParamHairSide", "ParamArmLA", "ParamArmRA",
  "ParamArmLB", "ParamArmRB", "ParamTere", "ParamNod", "ParamShake",
]) STANDARD.add(extra);

// 动作库里用到的「非标准参数」= 这只模型的专有参数，别名界面只需要列这些。
function customRefs(builtin) {
  const out = [];
  for (const p of builtin.paramRefs || []) {
    if (!STANDARD.has(p)) out.push({ name: p, actions: (builtin.paramOwners[p] || []).slice(0, 6), count: (builtin.paramOwners[p] || []).length });
  }
  return out;
}

function invalidate() { CACHE = null; }

module.exports = { loadBuiltin, customRefs, invalidate, STANDARD };
