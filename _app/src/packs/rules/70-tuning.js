// 规则 ⑦：动作手感调校
//
// 这一条解决的是「同一个模型换台电脑、换个人看着就别扭」的问题。
// 之前所有幅度都写死在渲染端（转头 6.5 倍、身体 5 倍、呼吸 1.6 弧度…），
// 换个比例不同的模型就会发现：头转得像拨浪鼓、身体跟得比头还快、
// 或者呼吸幅度大到整个人在浮。模型是别人画的，幅度必须能调。
//
// 这里只放「需要每帧生效」的量。颜色、布局、动作路由各有自己的规则。
const M = require("../manifest");

const num = (v, lo, hi, d) => M.clamp(v, lo, hi, d);
const bool = (v, d) => (v === undefined || v === null ? d : !!v);

module.exports = {
  id: "tuning",
  version: 1,
  title: "动作手感",
  description: "转头、身体跟随、眼珠、物理与渲染精度。数值都写在清单里，换模型各自独立，不会互相影响。",
  order: 70,

  fields: [
    // ---- 头部 ----
    {
      key: "angleMaxX", type: "slider", label: "左右转头上限", group: "头部",
      min: 6, max: 48, step: 1, unit: "°", defaultValue: 26,
      hint: "鼠标移到屏幕最边上时头最多转多少度。太大像脖子抽筋，太小像不看你。",
    },
    {
      key: "angleMaxY", type: "slider", label: "上下点头上限", group: "头部",
      min: 5, max: 40, step: 1, unit: "°", defaultValue: 30,
      hint: "有些模型抬头会露出下巴破面，这时把它调小。",
    },
    {
      key: "angleMaxZ", type: "slider", label: "歪头上限", group: "头部",
      min: 2, max: 30, step: 1, unit: "°", defaultValue: 14,
      hint: "侧头时脖子歪多少。Q 版模型建议 6-10。",
    },
    {
      key: "deadzone", type: "slider", label: "中心死区", group: "头部",
      min: 0, max: 0.35, step: 0.01, defaultValue: 0.07,
      hint: "鼠标停在模型正前方这个范围内时头不动 —— 避免微微一动就抖。",
    },

    // ---- 全身 ----
    {
      key: "bodyGainX", type: "slider", label: "身体左右跟随", group: "全身",
      min: 0, max: 2, step: 0.05, defaultValue: 1,
      hint: "0 = 只有头转、身体不动；1 = 身体跟着转约三分之一幅度；2 = 整个人转过去。",
    },
    {
      key: "bodyGainY", type: "slider", label: "身体上下跟随", group: "全身",
      min: 0, max: 2, step: 0.05, defaultValue: 1,
      hint: "模型没有 ParamBodyAngleY 时这一项不生效，不会报错。",
    },
    {
      key: "bodyGainZ", type: "slider", label: "身体侧倾跟随", group: "全身",
      min: 0, max: 2, step: 0.05, defaultValue: 1,
    },
    {
      key: "bodyLag", type: "slider", label: "身体延迟", group: "全身",
      min: 0, max: 1, step: 0.05, defaultValue: 0.35,
      hint: "身体比头慢多少。0 = 头和身体同步（机械感），0.6 以上像腰很软。",
    },

    // ---- 眼睛 ----
    {
      key: "eyeGain", type: "slider", label: "眼珠跟随", group: "眼睛",
      min: 0, max: 2, step: 0.05, defaultValue: 1,
      hint: "眼珠跟着鼠标转的幅度。1 是标准值。",
    },
    {
      key: "eyeMax", type: "slider", label: "眼珠上限", group: "眼睛",
      min: 0.2, max: 1.6, step: 0.05, defaultValue: 1,
      hint: "眼珠最多偏到眼眶多少。有些模型眼白很小，超过 1 会看出眼珠出框。",
    },

    // ---- 物理与渲染 ----
    {
      key: "physicsDt", type: "select", label: "物理步长", group: "物理与渲染",
      options: [
        { value: "16", label: "1/60 秒 · 最顺（低配机器可能掉帧）" },
        { value: "33", label: "1/30 秒 · 推荐（默认）" },
        { value: "50", label: "1/20 秒 · 省性能" },
        { value: "0", label: "跟随实际帧间隔 · 偶尔会抽一下" },
      ],
      defaultValue: "33",
      hint: "物理演算按固定步长设计。掉帧时把一大段时间塞进去会让头发「弹飞」，封顶更稳。",
    },
    {
      key: "maskResolution", type: "select", label: "裁剪蒙版精度", group: "物理与渲染",
      options: [
        { value: "256", label: "256 · 最省" },
        { value: "512", label: "512 · 省" },
        { value: "1024", label: "1024 · 推荐" },
        { value: "2048", label: "2048 · 最清晰（显存翻倍）" },
      ],
      defaultValue: "1024",
      hint: "手臂挡脸、头发遮眼这类「裁剪」的清晰度。切换后需要重新加载模型。",
    },
    {
      key: "fadeScale", type: "slider", label: "动作过渡倍率", group: "物理与渲染",
      min: 0.3, max: 3, step: 0.1, defaultValue: 1,
      hint: "动作之间的淡入淡出时长。0.5 = 干脆利落，2 = 慢悠悠。",
    },

    // ---- 动作 ----
    {
      key: "paramLock", type: "toggle", label: "播放动作时接管参数", group: "动作",
      defaultValue: true,
      hint: "模型自带动作会动头、动身体，但鼠标跟随每帧也在写同一批参数。打开后动作期间让动作说了算，播完立刻交还。",
    },
    {
      key: "idleLock", type: "toggle", label: "待机动作也接管", group: "动作",
      defaultValue: false,
      hint: "待机动作通常只是轻微呼吸/摇摆，和鼠标跟随共存更自然。除非待机动作幅度很大、和跟随打架，否则别开。",
    },
    {
      key: "motionSpeed", type: "slider", label: "动作速度", group: "动作",
      min: 0.5, max: 2, step: 0.05, defaultValue: 1,
      hint: "内置动作曲线的播放速度。1 = 原速。",
    },
  ],

  read(manifest) {
    const T = (manifest.live2d && manifest.live2d.tuning) || {};
    return {
      angleMaxX: num(T.angleMaxX, 6, 48, 26),
      angleMaxY: num(T.angleMaxY, 5, 40, 30),
      angleMaxZ: num(T.angleMaxZ, 2, 30, 14),
      deadzone: num(T.deadzone, 0, 0.35, 0.07),
      bodyGainX: num(T.bodyGainX, 0, 2, 1),
      bodyGainY: num(T.bodyGainY, 0, 2, 1),
      bodyGainZ: num(T.bodyGainZ, 0, 2, 1),
      bodyLag: num(T.bodyLag, 0, 1, 0.35),
      eyeGain: num(T.eyeGain, 0, 2, 1),
      eyeMax: num(T.eyeMax, 0.2, 1.6, 1),
      physicsDt: String(T.physicsDt == null ? 33 : num(T.physicsDt, 0, 66, 33)),
      maskResolution: String(T.maskResolution == null ? 1024 : num(T.maskResolution, 256, 2048, 1024)),
      fadeScale: num(T.fadeScale, 0.3, 3, 1),
      paramLock: bool(T.paramLock, true),
      idleLock: bool(T.idleLock, false),
      motionSpeed: num(T.motionSpeed, 0.5, 2, 1),
    };
  },

  apply(manifest, cfg) {
    const c = cfg || {};
    manifest.live2d.tuning = {
      angleMaxX: num(c.angleMaxX, 6, 48, 26),
      angleMaxY: num(c.angleMaxY, 5, 40, 30),
      angleMaxZ: num(c.angleMaxZ, 2, 30, 14),
      deadzone: num(c.deadzone, 0, 0.35, 0.07),
      bodyGainX: num(c.bodyGainX, 0, 2, 1),
      bodyGainY: num(c.bodyGainY, 0, 2, 1),
      bodyGainZ: num(c.bodyGainZ, 0, 2, 1),
      bodyLag: num(c.bodyLag, 0, 1, 0.35),
      eyeGain: num(c.eyeGain, 0, 2, 1),
      eyeMax: num(c.eyeMax, 0.2, 1.6, 1),
      physicsDt: num(c.physicsDt, 0, 66, 33),
      maskResolution: num(c.maskResolution, 256, 2048, 1024),
      fadeScale: num(c.fadeScale, 0.3, 3, 1),
      paramLock: c.paramLock !== false,
      idleLock: !!c.idleLock,
      motionSpeed: num(c.motionSpeed, 0.5, 2, 1),
    };
  },

  detect(ctx) {
    // 模型越大（贴图多、参数多），说明细节越多，蒙版精度跟着提一档
    const params = (ctx.report && ctx.report.params) || [];
    const tex = (ctx.report && ctx.report.textures) || [];
    const heavy = params.length > 160 || tex.length >= 6;
    return {
      angleMaxX: 26, angleMaxY: 30, angleMaxZ: 14, deadzone: 0.07,
      bodyGainX: 1, bodyGainY: 1, bodyGainZ: 1, bodyLag: 0.35,
      eyeGain: 1, eyeMax: 1, physicsDt: 33,
      maskResolution: heavy ? 2048 : 1024,
      fadeScale: 1, paramLock: true, idleLock: false, motionSpeed: 1,
    };
  },

  validate(ctx, cfg) {
    const issues = [];
    const c = cfg || {};
    const r = ctx.report || {};
    if (Number(c.maskResolution) >= 2048) {
      issues.push({ level: "info", code: "mask-heavy", message: "蒙版精度 2048 会多用一份显存；集显笔记本建议 1024", fix: "调到 1024" });
    }
    if (!r.physics && Number(c.physicsDt) !== 0) {
      issues.push({ level: "info", code: "no-physics-dt", message: "这个模型没有物理文件，物理步长不影响它" });
    }
    if (Number(c.angleMaxX) >= 34) {
      issues.push({ level: "info", code: "head-extreme", message: "转头上限很大，注意看侧脸有没有露出后脑勺的破面" });
    }
    if (Number(c.bodyGainX) >= 1.7 && Number(c.angleMaxX) >= 30) {
      issues.push({ level: "warn", code: "body-overdrive", message: "头和身体同时开到很大，容易看起来像被拧了一圈" });
    }
    return issues;
  },
};
