// 规则 ③：表情
//
// 模型表达情绪有两条路，程序两条都支持：
//   model  用模型自带的 exp3 表情文件（画师做的最好，优先）
//   params 用参数组合拼（嘴、眼、歪头），任何模型都有这些参数，只是没 exp3 那么精细
// engine=auto 的意思是「填了就用模型表情，没填就退回参数组合」，正常都该用 auto。
const sem = require("../semantics");
const M = require("../manifest");

module.exports = {
  id: "expressions",
  version: 1,
  title: "表情",
  description: "开心、害羞、难过分别用哪个表情。留空就用参数组合凑一个（能看，但不如画师做的表情）。",
  order: 30,

  fields: [
    {
      key: "engine",
      type: "select",
      label: "表情来源",
      group: "设置",
      options: [
        { value: "auto", label: "自动（有模型表情就用，没有就参数组合）" },
        { value: "model", label: "只用模型自带的 exp3 表情" },
        { value: "params", label: "只用参数组合" },
      ],
    },
  ].concat(
    sem.EXPR_SLOTS.map((s) => ({
      key: s.id,
      type: "expression",
      label: s.label,
      group: "情绪",
      required: s.id === "default",
      hint: s.id === "default" ? "平时站着不动时的表情" : "",
    }))
  ),

  read(manifest) {
    const E = (manifest.live2d && manifest.live2d.expressions) || {};
    const map = E.map || {};
    const out = { engine: E.engine || "auto" };
    for (const s of sem.EXPR_SLOTS) {
      out[s.id] = s.id === "default" ? E.default || "" : map[s.id] || "";
    }
    return out;
  },

  apply(manifest, cfg) {
    const E = manifest.live2d.expressions;
    E.engine = ["auto", "model", "params"].indexOf(cfg && cfg.engine) >= 0 ? cfg.engine : "auto";
    E.default = M.cleanName(cfg && cfg.default, 120);
    E.map = {};
    for (const s of sem.EXPR_SLOTS) {
      if (s.id === "default") continue;
      const v = M.cleanName(cfg && cfg[s.id], 120);
      if (v) E.map[s.id] = v;
    }
  },

  detect(ctx) {
    const g = (ctx.report && ctx.report.guesses && ctx.report.guesses.expressions) || {};
    const out = { engine: "auto" };
    for (const s of sem.EXPR_SLOTS) out[s.id] = g[s.id] || "";
    return out;
  },

  validate(ctx, cfg) {
    const issues = [];
    const c = cfg || {};
    const names = ((ctx.report && ctx.report.expressions) || []).map((e) => e.name);
    const has = (n) => names.some((x) => String(x).toLowerCase() === String(n).toLowerCase());
    const engine = c.engine || "auto";

    if (engine === "model" && !names.length) {
      issues.push({ level: "error", code: "expr-none", message: "选了「只用模型表情」，但这个模型没有任何 exp3 表情", fix: "改成自动" });
    }
    if (engine !== "params" && !names.length) {
      issues.push({ level: "info", code: "expr-fallback", message: "模型没有自带表情，全部情绪会用参数组合表达" });
    }

    for (const s of sem.EXPR_SLOTS) {
      const v = c[s.id];
      if (!v) {
        if (s.id === "default" && names.length) {
          issues.push({ level: "warn", code: "expr-default", message: "没设置默认表情 —— 会保持模型的初始状态，通常没问题，但有些模型初始是闭眼的" });
        }
        continue;
      }
      if (names.length && !has(v)) {
        issues.push({
          level: s.id === "default" ? "error" : "warn",
          code: "expr-missing",
          message: `「${s.label}」用的表情 ${v} 不在模型里`,
          fix: names.slice(0, 6).join(" / "),
        });
      }
    }
    return issues;
  },
};
