// 规则 ④：取景与布局
//
// 程序加载模型后要先回答一个问题：「画布上那么大一整块，窗口里该露出哪一段」。
// 大肥鱼的包围盒是**全身**，顶上还有 20% 空白，所以要靠一个矩形（viewBox）圈出
// 「头到胸」这一段。换成别的模型，这个矩形肯定不一样 —— 这就是本规则存在的原因。
//
// 三种模型的差异都能用这三个数吃掉：
//   viewY/viewH  圈哪一段（半身像要往上圈，Q 版要圈得少）
//   offsetX      水平偏移（有些模型的画布没居中）
const M = require("../manifest");

const num = (v, lo, hi, d) => M.clamp(v, lo, hi, d);

module.exports = {
  id: "layout",
  version: 1,
  title: "取景与布局",
  description: "窗口里露出模型的哪一段。上方预览会实时跟着变，拖到满意为止。",
  order: 40,

  fields: [
    {
      key: "viewY", type: "slider", label: "取景上缘", group: "取景",
      min: -0.2, max: 0.95, step: 0.01, unit: "", defaultValue: 0.1,
      hint: "从模型的百分之几开始往下取。数值越大越往下（会切掉头），越小越往上（会露出更多空白）。",
    },
    {
      key: "viewH", type: "slider", label: "取景高度", group: "取景",
      min: 0.1, max: 1.3, step: 0.01, defaultValue: 0.5,
      hint: "要露出多高一段。半身像一般 0.4~0.6；全身 0.9~1.1；只看头 0.2~0.3。",
    },
    {
      key: "offsetX", type: "slider", label: "水平偏移", group: "取景",
      min: -0.3, max: 0.3, step: 0.005, defaultValue: 0,
      hint: "模型偏左就填正数把它推回来。",
    },
    {
      key: "padding", type: "slider", label: "边缘留白", group: "取景",
      min: 0, max: 0.2, step: 0.005, defaultValue: 0.02,
      hint: "模型不要顶到窗口边。",
    },
  ],

  read(manifest) {
    const L = (manifest.live2d && manifest.live2d.layout) || {};
    return {
      viewY: num(L.viewY, -0.2, 0.95, 0.1),
      viewH: num(L.viewH, 0.1, 1.3, 0.5),
      offsetX: num(L.offsetX, -0.3, 0.3, 0),
      padding: num(L.padding, 0, 0.2, 0.02),
    };
  },

  apply(manifest, cfg) {
    const L = manifest.live2d.layout;
    L.viewY = num(cfg && cfg.viewY, -0.2, 0.95, 0.1);
    L.viewH = num(cfg && cfg.viewH, 0.1, 1.3, 0.5);
    L.offsetX = num(cfg && cfg.offsetX, -0.3, 0.3, 0);
    L.padding = num(cfg && cfg.padding, 0, 0.2, 0.02);
  },

  // 探测猜不出「该露哪一段」—— 这不是模型文件里的信息，是审美。
  // 但可以按模型长宽比给个像样的起点：细长的（全身）多露一点，宽的（半身）少露一点。
  detect(ctx) {
    const r = ctx.report || {};
    const tex = (r.textures || [])[0];
    let viewY = 0.1, viewH = 0.5;
    if (tex && tex.path) {
      // 贴图尺寸要解码才知道，探测阶段不做；用参数数量做粗判：
      // 有腿/脚相关参数（ParamLeg / ParamKnee / 足）的多半是全身模型
      const ids = (r.params || []).map((p) => p.id.toLowerCase());
      const fullBody = ids.some((id) => /leg|knee|foot|ashi|足|knee/.test(id));
      if (fullBody) { viewY = 0.02; viewH = 0.96; }
      else { viewY = 0.08; viewH = 0.55; }
    }
    return { viewY, viewH, offsetX: 0, padding: 0.02 };
  },

  validate(ctx, cfg) {
    const issues = [];
    const c = cfg || {};
    const y = Number(c.viewY) || 0, h = Number(c.viewH) || 0.5;
    if (h > 1.15) issues.push({ level: "warn", code: "layout-tall", message: "取景高度超过模型本身，上下会露出空白" });
    if (h < 0.15) issues.push({ level: "warn", code: "layout-tiny", message: "取景太小，窗口里会只剩一条" });
    if (y + h > 1.05) issues.push({ level: "warn", code: "layout-out", message: "取景下缘超出模型底部，会露出空白" });
    if (y < -0.05) issues.push({ level: "warn", code: "layout-top", message: "取景上缘在模型上方，顶部会空一大块" });
    return issues;
  },
};
