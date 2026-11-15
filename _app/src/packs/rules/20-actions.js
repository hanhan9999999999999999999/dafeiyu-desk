// 规则 ②：动作映射
//
// 一个「动作槽」问的是：这一刻她该做什么动作。两种回答方式：
//   builtin:<场景> 用程序内置的 82 支参数曲线（默认，只要参数绑对了就能播）
//   model:<组名>   播模型自带的 motion（模型自带动作通常最贴脸，但要求模型有这组）
//   none           明确不做动作（有些模型动作幅度太大，宁可不播）
//
// 默认全部走内置库 —— 因为内置库是「任何模型都能跑」的那一层；
// 「模型自带动作更合适」是用户主动选的加分项，不是必需项。
const sem = require("../semantics");
const M = require("../manifest");

const DEFAULT_COVERAGE = 0.8;
const encode = sem.encodeAction;
const decode = sem.decodeAction;

module.exports = {
  id: "actions",
  version: 1,
  title: "动作映射",
  description: "每个状态该播什么。默认用程序内置的动作曲线（对任何模型都有效）；如果模型自带动作更贴，可以在这里换过去。",
  order: 20,

  fields: sem.ACTION_SLOTS.map((s) => ({
    key: s.id,
    type: "select",
    label: s.label,
    hint: s.hint || `默认：内置动作 · ${s.scene}`,
    group: s.group,
    optionsFrom: "action",
    required: !!s.required,
    defaultScene: s.scene,
  })),

  read(manifest) {
    const ovs = (manifest.live2d && manifest.live2d.actions && manifest.live2d.actions.overrides) || {};
    const out = {};
    for (const s of sem.ACTION_SLOTS) out[s.id] = encode(ovs[s.id], s);
    return out;
  },

  apply(manifest, cfg) {
    const A = manifest.live2d.actions;
    A.overrides = A.overrides || {};
    for (const s of sem.ACTION_SLOTS) {
      const v = cfg && cfg[s.id];
      const def = "builtin:" + s.scene;
      if (!v || v === def) { delete A.overrides[s.id]; continue; }   // 默认值不写进清单
      A.overrides[s.id] = decode(v, s);
    }
  },

  detect() { return {}; },   // 动作默认全走内置库，不猜

  validate(ctx, cfg) {
    const issues = [];
    const c = cfg || {};
    const modelGroups = (ctx.report && ctx.report.motions) || {};
    const builtinScenes = (ctx.builtin && ctx.builtin.scenes) || {};
    const hasBuiltin = Object.keys(builtinScenes).length > 0;

    for (const s of sem.ACTION_SLOTS) {
      const val = c[s.id] || "builtin:" + s.scene;
      if (val === "none") {
        if (s.required) issues.push({ level: "error", code: "action-none", message: `「${s.label}」被设成不播动作，但这个状态是必需的` });
        continue;
      }
      if (val.startsWith("model:")) {
        const g = val.slice(6);
        if (!modelGroups[g]) {
          issues.push({ level: "error", code: "action-motion-missing", message: `「${s.label}」指向模型动作组 ${g}，但模型里没有这一组`, fix: `改成内置动作，或换一个存在的组` });
        }
        continue;
      }
      if (val.startsWith("file:")) {
        const rel = val.slice(5).trim();
        const files = (ctx.report && ctx.report.motionFiles) || [];
        if (!rel) {
          issues.push({ level: "error", code: "action-file-empty", message: `「${s.label}」绑了动作文件但没写路径` });
        } else if (files.length && !files.some((m) => m.file === rel)) {
          issues.push({ level: "error", code: "action-file-missing", message: `「${s.label}」指向的动作文件不在包里：${rel}`, fix: "重新导入模型，或在素材库里改绑" });
        }
        continue;
      }
      if (val.startsWith("builtin:")) {
        const g = val.slice(8);
        if (hasBuiltin && !builtinScenes[g]) {
          issues.push({ level: "warn", code: "action-scene-missing", message: `「${s.label}」指向内置场景 ${g}，动作库里没有这个场景` });
        }
      }
    }
    return issues;
  },

  // 给界面用：内置场景覆盖率（有多少个动作能被这个模型完整播放）
  // 不算必需；适配器会显示成「动作覆盖率 82%」这种一句话
  coverage(ctx) {
    const b = ctx.builtin || {};
    const scenes = b.scenes || {};
    const params = (ctx.manifest && ctx.manifest.live2d && ctx.manifest.live2d.params) || {};
    const aliases = (ctx.manifest && ctx.manifest.live2d && ctx.manifest.live2d.aliases) || {};
    const bound = new Set();
    for (const k of Object.keys(params)) for (const n of params[k] || []) bound.add(n);
    for (const k of Object.keys(aliases)) for (const n of aliases[k] || []) bound.add(n);
    const actions = Object.keys(b.motions || {});
    if (!actions.length) return { total: 0, playable: 0, ratio: 1 };
    let playable = 0;
    for (const name of actions) {
      const curves = b.motions[name];
      if (!Array.isArray(curves) || !curves.length) { playable++; continue; }
      let hit = 0;
      for (const c of curves) if (Array.isArray(c) && bound.has(c[0])) hit++;
      if (hit / curves.length >= DEFAULT_COVERAGE) playable++;
    }
    return { total: actions.length, playable, ratio: actions.length ? playable / actions.length : 1 };
  },
};
