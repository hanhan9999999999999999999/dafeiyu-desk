// 体检：把「能不能用」拆成可执行的清单。
//
// 分三层，因为三层的失败方式完全不同：
//   结构层（清单）  字段写错了 —— 界面能直接说哪一行
//   磁盘层（文件）  moc3/贴图缺失 —— 加载会失败，必须修
//   语义层（规则）  参数没绑、动作指向不存在的组 —— 能跑，但表现是错的
//
// 最后给一个 0-100 的分数。分数不是为了好看，是为了让用户知道「现在离能用还差多远」。
const M = require("./manifest");
const sem = require("./semantics");

// info 不扣分：它表示「少一点表现力」，不代表有问题。扣分会让人误以为没配好。
const PENALTY = { error: 16, warn: 4, info: 0 };

/**
 * @param {object} p
 * @param {object} p.manifest
 * @param {object} p.report   probe 结果
 * @param {object} p.builtin  builtin.loadBuiltin 结果
 * @param {Array}  p.ruleIssues  rules.validateAll 结果
 * @param {object} p.cfgs     各规则的当前值（用于算覆盖率）
 */
function diagnose(p) {
  const issues = [];
  const m = p.manifest || {};

  const mv = M.validate(m);
  for (const i of mv.issues) issues.push(Object.assign({ layer: "manifest" }, i));

  const r = p.report || {};
  for (const e of r.errors || []) issues.push({ level: "error", layer: "disk", code: "disk", message: e });
  // 贴图缺失单独处理：Cubism 引擎只要有一张贴图 404，整个模型就加载失败（实测过）。
  // 它不是「某张图不太对」，是这个包画不出来 —— 按 warn 每张扣 4 分会给出「84 分能用」的假象。
  const missTex = (r.textures || []).filter((t) => t.missing);
  for (const w of r.warnings || []) {
    if (/^贴图缺失：/.test(w)) continue;
    issues.push({ level: "warn", layer: "disk", code: "disk", message: w });
  }
  if (missTex.length) {
    const names = missTex.slice(0, 3).map((t) => t.path).join("、");
    issues.push({
      level: "error",
      layer: "disk",
      code: "disk",
      message: `贴图缺失 ${missTex.length} 张：${names}${missTex.length > 3 ? " 等" : ""} —— 加载会直接失败`,
    });
  }

  for (const i of p.ruleIssues || []) issues.push(Object.assign({ layer: "rules" }, i));

  // 覆盖统计：让「差多少」变成数字。
  // 注意用的是「合并后的配置」而不是清单原文 —— 清单里没写绑定的模型，
  // 界面上其实已经按探测建议填好了，体检必须看用户看到的那份值，否则永远报「没绑」。
  const pc = (p.cfgs && p.cfgs["core-params"]) || {};
  const boundParams = sem.PARAM_SLOTS.filter((s) => !!pc[s.id]).length;
  const missingRequired = sem.REQUIRED_PARAMS.filter((id) => !pc[id]);

  const exprCount = (r.expressions || []).length;
  const g = (r.groups || {});

  // 分数。
  // 「模型本体 / 贴图不存在」这类是结构性缺失——包根本立不起来，
  // 按普通 error 扣 16 会剩下 84 分，用户看到「84」会以为只是小毛病。
  // 这类单独按 60 扣，一个就掉到 40 以下，两个直接归零。
  const FATAL_RE = /模型文件不存在|没有任何可用贴图|贴图缺失|找不到 .moc3/;
  let score = 100;
  for (const i of issues) {
    const fatal = i.level === "error" && i.layer === "disk" && FATAL_RE.test(i.message || "");
    score -= fatal ? 60 : (PENALTY[i.level] || 0);
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  const errors = issues.filter((i) => i.level === "error");
  const warns = issues.filter((i) => i.level === "warn");
  const verdict = errors.length ? "broken" : warns.length ? "usable" : "ready";
  const verdictText = {
    ready: "可以直接用",
    usable: "能用，但有几处建议调一下",
    broken: "还不能用，先处理红色问题",
  }[verdict];

  // 一句话总结：优先说「最关键的下一步」，而不是罗列所有问题
  let headline = "";
  if (missingRequired.length) {
    headline = `还差 ${missingRequired.length} 个必需参数没绑（${missingRequired.map((id) => sem.PARAM_BY_ID[id].label).join("、")}）`;
  } else if (errors.length) {
    headline = errors[0].message;
  } else if (warns.length) {
    headline = warns[0].message;
  } else {
    headline = `参数 ${boundParams}/${sem.PARAM_SLOTS.length} 全部就位，动作与表情都已接上`;
  }

  return {
    ok: errors.length === 0,
    score,
    verdict,
    verdictText,
    headline,
    issues,
    counts: { error: errors.length, warn: warns.length, info: issues.length - errors.length - warns.length },
    stats: {
      paramsBound: boundParams,
      paramsTotal: sem.PARAM_SLOTS.length,
      paramsMissing: missingRequired.map((id) => ({ id, label: sem.PARAM_BY_ID[id].label })),
      textures: (r.textures || []).length,
      textureMissing: (r.textures || []).filter((t) => t.missing).length,
      motions: Object.keys(r.motions || {}).length,
      motionCount: Object.values(r.motions || {}).reduce((a, b) => a + b, 0),
      expressions: exprCount,
      parts: (r.parts || []).length,
      modelParams: (r.params || []).length,
      mocBytes: r.mocBytes || 0,
      eyeBlink: (g.eyeBlink || []).length,
      lipSync: (g.lipSync || []).length,
      physics: !!r.physics,
      cdi3: !!r.cdi3,
    },
  };
}

module.exports = { diagnose, PENALTY };
