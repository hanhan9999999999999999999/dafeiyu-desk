// 规则 ⑥：互动手感
//
// 这一条是「以后加新逻辑」的样板：程序里新写了一层交互（鼠标跟随、点击分区、
// 呼吸幅度），只要在这里声明几个字段、在渲染端读一下清单，适配器里就自动多一块设置，
// 不用改界面一行代码。
//
// 为什么这些要按模型调：
//   点击分区是按「模型框的相对高度」切的（头 / 脸 / 身体）。大肥鱼 0.42 是下巴，
//   但 Q 版模型三头身，0.42 可能还在额头上 —— 用户摸头结果触发了戳脸。
//   呼吸幅度同理：大模型幅度刚好，小模型看起来像在喘。
const M = require("../manifest");

const num = (v, lo, hi, d) => M.clamp(v, lo, hi, d);

module.exports = {
  id: "interaction",
  version: 1,
  title: "互动手感",
  description: "鼠标跟随、点击分区、呼吸幅度。这几项和模型比例强相关，换模型后建议试一下。",
  order: 60,

  fields: [
    {
      key: "headLine", type: "slider", label: "头部下边界", group: "点击分区",
      min: 0.15, max: 0.75, step: 0.01, defaultValue: 0.42,
      hint: "从模型顶往下的相对高度。小于这个值算「摸头」。",
    },
    {
      key: "faceLine", type: "slider", label: "脸部下边界", group: "点击分区",
      min: 0.35, max: 0.95, step: 0.01, defaultValue: 0.72,
      hint: "小于这个值算「戳脸」，再往下算「戳身体」。",
    },
    {
      key: "followX", type: "slider", label: "左右跟随强度", group: "跟随",
      min: 0, max: 2, step: 0.05, defaultValue: 1,
      hint: "0 = 完全不跟鼠标，2 = 幅度加倍。",
    },
    {
      key: "followY", type: "slider", label: "上下跟随强度", group: "跟随",
      min: 0, max: 2, step: 0.05, defaultValue: 1,
    },
    {
      key: "breathAmp", type: "slider", label: "呼吸幅度", group: "待机",
      min: 0, max: 2, step: 0.05, defaultValue: 1,
      hint: "0 = 不呼吸（有些模型自带呼吸动画，这时该关掉）。",
    },
  ],

  read(manifest) {
    const I = (manifest.live2d && manifest.live2d.interaction) || {};
    return {
      headLine: num(I.headLine, 0.15, 0.75, 0.42),
      faceLine: num(I.faceLine, 0.35, 0.95, 0.72),
      followX: num(I.followX, 0, 2, 1),
      followY: num(I.followY, 0, 2, 1),
      breathAmp: num(I.breathAmp, 0, 2, 1),
    };
  },

  apply(manifest, cfg) {
    const c = cfg || {};
    manifest.live2d.interaction = {
      headLine: num(c.headLine, 0.15, 0.75, 0.42),
      faceLine: num(c.faceLine, 0.35, 0.95, 0.72),
      followX: num(c.followX, 0, 2, 1),
      followY: num(c.followY, 0, 2, 1),
      breathAmp: num(c.breathAmp, 0, 2, 1),
    };
  },

  detect() {
    return { headLine: 0.42, faceLine: 0.72, followX: 1, followY: 1, breathAmp: 1 };
  },

  validate(ctx, cfg) {
    const issues = [];
    const c = cfg || {};
    const h = Number(c.headLine), f = Number(c.faceLine);
    if (Number.isFinite(h) && Number.isFinite(f) && f - h < 0.12) {
      issues.push({ level: "warn", code: "zone-too-small", message: "脸那一格只剩不到 12% 高，戳脸会很难命中", fix: "把脸部下边界往上或头部下边界往下拉" });
    }
    if (Number(c.breathAmp) > 1.6) {
      issues.push({ level: "info", code: "breath-strong", message: "呼吸幅度很大，模型可能会上下浮得有点夸张" });
    }
    return issues;
  },
};
