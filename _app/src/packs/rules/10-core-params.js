// 规则 ①：核心参数绑定
//
// 这是整个适配器最要紧的一块。程序每帧要往模型写十几个参数（转头、眨眼、口型…），
// 以前靠写死的数字索引，换模型就等于乱写。这里把「语义槽 → 参数 id」交给用户确认。
//
// 为什么必须有「别名」字段：
//   内置动作库（82 支曲线）里用了 dafeiyu 的专有参数 Movement2 / Param56 / Param57。
//   别的模型没有这些参数，曲线里这几条就会被跳过；如果目标模型有等价的手臂参数，
//   用户在这里把它们对上，动作就能完整播放。
const sem = require("../semantics");
const M = require("../manifest");

module.exports = {
  id: "core-params",
  version: 1,
  title: "核心参数绑定",
  description: "这个模型靠哪些参数抬头、眨眼、说话。绑定错了不会报错，只会动得很怪，所以请逐个确认。",
  order: 10,

  fields: sem.PARAM_SLOTS.map((s) => ({
    key: s.id,
    type: "param",
    label: s.label,
    hint: s.hint || "",
    group: s.group,
    slot: s.canon,
    required: sem.REQUIRED_PARAMS.indexOf(s.id) >= 0,
    range: s.range,
    unit: s.unit || "",
  })).concat([
    {
      key: "aliases",
      type: "map",
      label: "专有参数别名",
      hint: "内置动作里有几个参数是这只模型独有的。目标模型如果有等价参数，在这里对上；没有就留空，那几段动作会自动跳过。",
      group: "高级",
      from: "motionRefs",
    },
  ]),

  // 从清单读成 {slot: 参数名}
  read(manifest) {
    const p = (manifest.live2d && manifest.live2d.params) || {};
    const out = {};
    for (const s of sem.PARAM_SLOTS) {
      const arr = Array.isArray(p[s.id]) ? p[s.id] : [];
      out[s.id] = arr[0] || "";
    }
    const al = (manifest.live2d && manifest.live2d.aliases) || {};
    const aliases = {};
    for (const k of Object.keys(al)) aliases[k] = (Array.isArray(al[k]) ? al[k] : [])[0] || "";
    out.aliases = aliases;
    return out;
  },

  // 写回清单。空值 = 这个槽不绑定（而不是绑到空字符串）
  apply(manifest, cfg) {
    const L = manifest.live2d;
    L.params = L.params || {};
    for (const s of sem.PARAM_SLOTS) {
      const v = M.cleanName(cfg && cfg[s.id], 120);
      if (v) L.params[s.id] = [v];
      else delete L.params[s.id];
    }
    L.aliases = {};
    const al = (cfg && cfg.aliases) || {};
    for (const k of Object.keys(al)) {
      const from = M.cleanName(k, 120);
      const to = M.cleanName(al[k], 120);
      if (from && to) L.aliases[from] = [to];
    }
  },

  // 探测默认值：直接吃 probe 的 guess
  detect(ctx) {
    const g = (ctx.report && ctx.report.guesses && ctx.report.guesses.params) || {};
    const out = {};
    for (const s of sem.PARAM_SLOTS) {
      const arr = g[s.id] || [];
      out[s.id] = arr[0] || "";
    }
    out.aliases = {};
    return out;
  },

  validate(ctx, cfg) {
    const issues = [];
    const c = cfg || {};
    for (const s of sem.PARAM_SLOTS) {
      const need = sem.REQUIRED_PARAMS.indexOf(s.id) >= 0;
      if (!c[s.id]) {
        if (need) {
          issues.push({
            level: "error",
            code: "param-missing",
            message: `缺「${s.label}」—— 这个模型的对应参数没选，相关动作会失效`,
            fix: `在参数列表里找和 ${s.canon} 同名的参数`,
          });
        } else {
          issues.push({
            level: "info",
            code: "param-optional",
            message: `「${s.label}」留空，相关表现会退化（不影响使用）`,
          });
        }
      }
    }
    // 同一个参数被两个槽抢：典型是左右眼都指向 ParamEyeLOpen，结果只有一只眼眨
    const used = {};
    for (const s of sem.PARAM_SLOTS) {
      const v = c[s.id];
      if (!v) continue;
      if (used[v]) {
        issues.push({
          level: "warn",
          code: "param-duplicate",
          message: `「${used[v]}」和「${s.label}」都绑到了 ${v}，通常应该各用各的`,
        });
      } else used[v] = s.label;
    }
    return issues;
  },
};
