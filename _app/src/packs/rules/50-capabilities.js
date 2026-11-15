// 规则 ⑤：能力与驱动
//
// 模型文件里的「组」决定了引擎能不能自动眨眼、自动对口型。这两个功能都是
// 静默失效的 —— 组名写错不会报错，只会「这个人永远睁着眼」。
// 所以让用户在这里亲眼看到「我们找到了哪组」，而不是去猜。
const M = require("../manifest");

module.exports = {
  id: "capabilities",
  version: 1,
  title: "能力与驱动",
  description: "头发和衣服的物理演算。眨眼和口型由程序自己按参数驱动，不依赖模型里的参数组，所以这里不需要配。",
  order: 50,

  // 只留物理。眨眼/口型看起来像能配，其实引擎那边的组是 model3.json 里写死的，
  // 运行时换不掉 —— 与其放两个改了没用的下拉，不如说清楚「这里不用配」。
  fields: [
    {
      key: "physics", type: "toggle", label: "启动物理演算", group: "物理",
      hint: "头发、衣服的晃动。模型带 .physics3.json 才有意义；觉得晃得太厉害可以关掉。",
    },
  ],

  read(manifest) {
    const L = manifest.live2d || {};
    return { physics: !(L.physics && L.physics.enabled === false) };
  },

  apply(manifest, cfg) {
    const L = manifest.live2d;
    const c = cfg || {};
    L.physics = { enabled: c.physics !== false };
    // groups 不动：那是模型自带的声明，改它只会让体检和实际不符。
  },

  detect(ctx) {
    return { physics: !!(ctx.report && ctx.report.physics) };
  },

  validate(ctx, cfg) {
    const issues = [];
    const c = cfg || {};
    const r = ctx.report || {};
    if (c.physics && !r.physics) {
      issues.push({ level: "info", code: "no-physics", message: "这个模型没有物理文件，头发和衣服不会自己晃" });
    }
    if (!c.physics && r.physics) {
      issues.push({ level: "info", code: "physics-off", message: "物理演算被关掉了 —— 模型会显得很硬" });
    }
    return issues;
  },
};
