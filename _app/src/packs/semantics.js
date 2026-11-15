// 语义契约：软件逻辑 ↔ 模型 之间唯一的一张翻译表。
//
// 为什么要单独一张表：
//   以前「她想做什么」和「模型怎么动」是直接写在一起的 —— renderer 里
//   setExpr("happy")、actionFor("dshThinking")、PIDX.ParamAngleX：28 混着出现，
//   换一个模型就要满文件找常量。现在把「软件需要哪些能力」抽成槽位，
//   模型包里只回答「这个槽我拿什么补」。加新逻辑时改这里，适配器那边自动多一行。
//
// 三类槽：
//   PARAM_SLOTS  参数槽：每帧要写的连续量（转头、眼珠、眨眼、口型、呼吸）
//   ACTION_SLOTS 动作槽：一次性播放的动作（待机、思考、被摸头、吃饭…）
//   EXPR_SLOTS   表情槽：持续几秒的情绪（开心、害羞、难过…）
//
// 每个槽都带 canon（标准 Cubism 参数名 / 内置场景名），探测时按 canon 先猜一遍，
// 猜不中就留空等用户选 —— 猜错比留空更糟，猜错会在别的模型上悄悄写错参数。

// ---------- 参数槽 ----------
// canon: 标准 Cubism 参数名；alts: 常见变体（第三方模型改名/合并时用）
// range: 该参数在 Cubism 里的常规取值范围，用于滑杆和曲线归一
const PARAM_SLOTS = [
  {
    id: "angleX", label: "左右转头", canon: "ParamAngleX", alts: ["AngleX", "ParamAngleX2"],
    range: [-30, 30], unit: "°", group: "头部",
    hint: "鼠标左右移动时头跟着转。没有这个参数，跟随鼠标就只会转眼珠。",
  },
  {
    id: "angleY", label: "上下点头", canon: "ParamAngleY", alts: ["AngleY", "ParamAngleY2"],
    range: [-30, 30], unit: "°", group: "头部",
  },
  {
    id: "angleZ", label: "歪头", canon: "ParamAngleZ", alts: ["AngleZ", "ParamAngleZ2"],
    range: [-30, 30], unit: "°", group: "头部",
    hint: "摇头、卖萌、犯困都靠它。缺了会显得很僵。",
  },
  {
    id: "bodyAngleX", label: "身体左右转", canon: "ParamBodyAngleX", alts: ["BodyAngleX"],
    range: [-10, 10], unit: "°", group: "身体",
  },
  {
    id: "bodyAngleZ", label: "身体侧倾", canon: "ParamBodyAngleZ", alts: ["BodyAngleZ"],
    range: [-10, 10], unit: "°", group: "身体",
  },
  {
    id: "eyeBallX", label: "眼珠左右", canon: "ParamEyeBallX", alts: ["EyeBallX", "ParamEyeBallXI"],
    range: [-1, 1], group: "眼睛",
  },
  {
    id: "eyeBallY", label: "眼珠上下", canon: "ParamEyeBallY", alts: ["EyeBallY", "ParamEyeBallYI"],
    range: [-1, 1], group: "眼睛",
  },
  {
    // 老模型（Koharu 那一代）常把 ParamEyeLOpen 直接叫 ParamEyeOpenL / EyeOpenL，
    // 也有干脆叫 EyeL 的。这些名字在第三方模型里出现的频率比规范名还高。
    id: "eyeLOpen", label: "左眼开合", canon: "ParamEyeLOpen",
    alts: ["ParamEyeOpenL", "EyeOpenL", "EyeLOpen", "EyeL", "ParamEyeL"],
    range: [0, 1], group: "眼睛", hint: "眨眼必需。没有它就永远睁着眼。",
  },
  {
    id: "eyeROpen", label: "右眼开合", canon: "ParamEyeROpen",
    alts: ["ParamEyeOpenR", "EyeOpenR", "EyeROpen", "EyeR", "ParamEyeR"],
    range: [0, 1], group: "眼睛",
  },
  {
    id: "mouthOpen", label: "张嘴", canon: "ParamMouthOpenY",
    alts: ["ParamMouthOpen", "MouthOpen", "MouthOpenY", "ParamMouthA"],
    range: [0, 1], group: "嘴巴", hint: "说话时的口型。没有它，说话只有声音没有嘴。",
  },
  {
    id: "mouthForm", label: "嘴角", canon: "ParamMouthForm",
    alts: ["ParamMouthFormY", "MouthForm", "MouthFormY"],
    range: [-1, 1], group: "嘴巴", hint: "笑和撇嘴靠它；没有就只能靠眼睛表达情绪。",
  },
  {
    id: "breath", label: "呼吸", canon: "ParamBreath", alts: ["Breath"],
    range: [0, 1], group: "身体", hint: "待机时的起伏。缺了人像一张贴纸。",
  },

  // ---------- 表情参数槽 ----------
  // 上面 12 个是「让她活着」必需的；这 14 个是给表演曲线用的 —— LumenAct 那 97 段
  // 动捕表情要靠它们才长得出脸。和上面那批的区别：缺了不会让软件坏掉，只是这个表情
  // 少一层肉。所以一个都不进 REQUIRED_PARAMS，体检时缺了只报提示。
  //
  // 为什么每个都写这么宽的 alts：第三方模型没人管命名规范。同一件事有人叫
  // EyeSmile、有人叫 ParamEyeSmile、有人直接在标准名后面加个 1。探测顺序是
  // canon → alts 逐个别名，第一个在模型里真实存在的赢。
  //
  // gain：同一个参数名在不同美术手里「用力程度」差很多 —— 有人 ±1 眉毛动 10 像素，
  // 有人 ±1 动 50 像素。适配器里给一根滑杆，渲染时乘上去。默认 1 就是照搬。
  {
    id: "eyeSmile", label: "笑眼", canon: "EyeSmile",
    alts: ["ParamEyeSmile", "EyeSmile1", "ParamEyeSmile1", "ParamEyeSmileL", "EyeSmile_L"],
    range: [0, 1], group: "表情", expr: true, gain: 1,
    hint: "弯月形笑眼。缺了只能拿「眯眼 + 嘴角上扬」近似 —— 看得出在笑，但没有那股利落劲。",
  },
  {
    id: "browLY", label: "左眉高度", canon: "ParamBrowLY",
    alts: ["ParamBrowLForm", "BrowLY", "ParamBrowL", "ParamBrowLY2"],
    range: [-1, 1], group: "表情", expr: true, gain: 1,
    hint: "挑眉、疑惑、难过都靠它。整条眉毛动不了的表情，会显得眉毛是画上去的。",
  },
  {
    id: "browRY", label: "右眉高度", canon: "ParamBrowRY",
    alts: ["ParamBrowRForm", "BrowRY", "ParamBrowR", "ParamBrowRY2"],
    range: [-1, 1], group: "表情", expr: true, gain: 1,
  },
  {
    id: "browLAngle", label: "左眉角度", canon: "ParamBrowLAngle",
    alts: ["ParamBrowLForm2", "BrowLAngle", "ParamBrowLY3", "ParamBrowLAngle2"],
    range: [-1, 1], group: "表情", expr: true, gain: 1,
    hint: "「八」字形（生气）和「八」字倒过来（担心）的分界就在这个角度上。",
  },
  {
    id: "browRAngle", label: "右眉角度", canon: "ParamBrowRAngle",
    alts: ["ParamBrowRForm2", "BrowRAngle", "ParamBrowRY3", "ParamBrowRAngle2"],
    range: [-1, 1], group: "表情", expr: true, gain: 1,
  },
  {
    id: "browInnerUp", label: "眉心上挑", canon: "BrowInnerUp",
    alts: ["ParamBrowInnerUp", "ParamBrowInnerUpY", "BrowInnerY", "ParamBrowInner"],
    range: [0, 1], group: "表情", expr: true, gain: 1,
    hint: "委屈时眉毛中间拱起来那一下。没有它，「难过」和「发呆」分不开。",
  },
  {
    id: "shockL", label: "左眼震惊", canon: "ShockL",
    alts: ["ParamShockL", "Shock_L", "ParamEyeShockL", "EyeShockL"],
    range: [0, 1], group: "表情", expr: true, gain: 1,
    hint: "瞳孔一缩的那种惊。缺了就只能靠「睁大眼」，惊得不够狠。",
  },
  {
    id: "shockR", label: "右眼震惊", canon: "ShockR",
    alts: ["ParamShockR", "Shock_R", "ParamEyeShockR", "EyeShockR"],
    range: [0, 1], group: "表情", expr: true, gain: 1,
  },
  {
    id: "cryL", label: "左眼泪", canon: "LCry",
    alts: ["ParamCryL", "ParamTearL", "CryL", "TearL", "ParamTearsL"],
    range: [0, 1], group: "表情", expr: true, gain: 1,
    hint: "眼泪。有的模型是「有眼泪」开关，有的是「流泪进度」——都是 0~1，照写。",
  },
  {
    id: "cryR", label: "右眼泪", canon: "RCry",
    alts: ["ParamCryR", "ParamTearR", "CryR", "TearR", "ParamTearsR"],
    range: [0, 1], group: "表情", expr: true, gain: 1,
  },
  {
    id: "angry", label: "怒纹", canon: "Angry",
    alts: ["ParamAngry", "Angry1", "ParamAngryMark", "AngryMark"],
    range: [0, 1], group: "表情", expr: true, gain: 1,
    hint: "额头那个「井」字。很多模型没有，没有就用眼睛和嘴演。",
  },
  {
    id: "pupilX", label: "瞳孔左右", canon: "PupilX",
    alts: ["ParamPupilX", "ParamEyeBallXI", "PupilX2", "ParamPupilHorizon"],
    range: [-1, 1], group: "表情", expr: true, gain: 1,
    hint: "眼珠比 ParamEyeBallX 更「里面」的一层。有它的时候斜视更自然。",
  },
  {
    id: "mouthPucker", label: "嘟嘴", canon: "Mouthpucker",
    alts: ["ParamMouthPucker", "MouthPucker", "ParamMouthPout", "MouthPout", "ParamMouthPuckerY"],
    range: [0, 1], group: "表情", expr: true, gain: 1,
    hint: "亲亲嘴。爱心眼、撒娇那几段全靠它，缺了会变成普通的笑。",
  },
  {
    id: "cheekPuff", label: "鼓脸", canon: "CheeckPuff",
    alts: ["ParamCheek", "CheekPuff", "ParamCheekPuff", "ParamCheekPuffY", "CheekPuff1"],
    range: [0, 1], group: "表情", expr: true, gain: 1,
    hint: "鼓腮帮子（赌气/憋笑）。大肥鱼这个参数美术没接到网格上，所以它动不了 —— 不是 bug。",
  },
];

// 表情参数槽单独一张表：渲染端的表演曲线只认这批（加上头部三个角度）。
// 分开列的理由：基础槽是「缺了她就死了」，表情槽是「缺了少一层脸」，两回事。
// ---------- 表演能力权重 ----------
// 换一个模型，怎么告诉用户「你这个模型能演多少」？
// 按参数个数平均是错的：一个只有眼睑和嘴型的模型，演「害羞」「生气」「难过」照样像；
// 少了眉毛只是少一层细节，不该被判成残废。所以按「这门参数对表情的贡献」加权。
//
// 分档依据是实测：97 段曲线里，情绪的可辨识度主要由三样撑起来 ——
//   ① 眼睑开合（眯、睁、半阖）—— 眼睛是情绪的第一语言，权重最高
//   ② 嘴角（笑/撇）与歪头（情绪姿态）
//   ③ 眉毛（第二语言，但大多模型都有，缺了才显）
// 脸颊鼓起、泪光、鼻尖红这些是加分项，权重压到 0.4~0.6。
const PARAM_WEIGHTS = {
  eyeLOpen: 3, eyeROpen: 3,   // 眼睑：情绪的第一语言
  mouthForm: 2.5,             // 嘴角：笑与撇嘴
  angleZ: 2,                  // 歪头：姿态最强的一根
  angleX: 1.5, angleY: 1.5,   // 转头点头
  eyeBallX: 1.2, eyeBallY: 1.2, // 视线：躲闪、直视、翻眼
  browLY: 1.2, browRY: 1.2,   // 眉毛高度
  mouthOpen: 1, eyeSmile: 1,  // 张嘴、笑眼
  browLAngle: 1, browRAngle: 1, // 眉毛角度：生气/担心的分界
  mouthPucker: 0.6, cheekPuff: 0.6, angry: 0.6, // 嘟嘴、鼓脸、黑脸贴片
  browInnerUp: 0.5, cryL: 0.5, cryR: 0.5,       // 内眉上扬、眼泪
  shockL: 0.4, shockR: 0.4, pupilX: 0.4,        // 惊讶线、瞳孔位移
  bodyAngleX: 0.5, bodyAngleZ: 0.5, breath: 0.4, // 身体与呼吸
};
const weightOf = (id) => (typeof PARAM_WEIGHTS[id] === "number" ? PARAM_WEIGHTS[id] : 1);

const EXPR_PARAM_SLOTS = PARAM_SLOTS.filter((s) => s.expr);

// ---------- 动作槽 ----------
// scene: 内置动作库（src/motions.js 的 FishMotionScenes）里的场景名，默认走它
// required: 体检时缺了要报「错误」，否则只是提示
const ACTION_SLOTS = [
  { id: "idle", label: "待机", scene: "idle", required: true, group: "状态", hint: "没事干的时候随机播的小动作" },
  { id: "idleSoft", label: "安静待机", scene: "idleSoft", group: "状态", hint: "深夜/省电时用，幅度更小" },
  { id: "sleep", label: "睡着", scene: "sleep", required: true, group: "状态" },
  { id: "wake", label: "醒来", scene: "wake", group: "状态" },
  { id: "thinking", label: "思考", scene: "dshThinking", required: true, group: "工作", hint: "DSH 在干活时她该有的样子" },
  { id: "done", label: "完成", scene: "dshDone", required: true, group: "工作" },
  { id: "failed", label: "失败/中止", scene: "actStop", required: true, group: "工作" },
  { id: "start", label: "开始", scene: "actStart", group: "工作" },
  { id: "petHead", label: "被摸头", scene: "petHead", group: "互动" },
  { id: "petFace", label: "被戳脸", scene: "petFace", group: "互动" },
  { id: "petBody", label: "被戳身体", scene: "petBody", group: "互动" },
  { id: "more", label: "还要", scene: "more", group: "互动" },
  { id: "feed", label: "投喂", scene: "feed", group: "互动" },
];

// 活动槽：pet.js 里那 13 件事。默认场景名 = 自己的 id，不配也能跑；
// 列出来是为了「模型自带动作更合适」时能覆盖。
const ACTIVITY_SLOTS = [
  { id: "actEat", label: "吃东西", scene: "actEat", group: "活动" },
  { id: "actRest", label: "休息", scene: "actRest", group: "活动" },
  { id: "actSleep", label: "睡觉", scene: "actSleep", group: "活动" },
  { id: "actBath", label: "洗澡", scene: "actBath", group: "活动" },
  { id: "actGroom", label: "梳毛", scene: "actGroom", group: "活动" },
  { id: "actPlay", label: "玩耍", scene: "actPlay", group: "活动" },
  { id: "actStretch", label: "伸懒腰", scene: "actStretch", group: "活动" },
  { id: "actSun", label: "晒太阳", scene: "actSun", group: "活动" },
  { id: "actRead", label: "看书", scene: "actRead", group: "活动" },
  { id: "actSing", label: "唱歌", scene: "actSing", group: "活动" },
  { id: "actMovie", label: "看电影", scene: "actMovie", group: "活动" },
  { id: "actWalk", label: "散步", scene: "actWalk", group: "活动" },
  { id: "actDaze", label: "发呆", scene: "actDaze", group: "活动" },
  { id: "actDone", label: "活动结束", scene: "actDone", group: "活动" },
];

// ---------- 表情槽 ----------
// canon: 大肥鱼模型里的表情名，仅供参考，别的模型当然不一样
// params: 没有 exp3 表情时，用参数偏移量拼一个（renderer 的 EXPR_DEF 同源）
const EXPR_SLOTS = [
  { id: "default", label: "默认", canon: "default-body", required: true, group: "基础" },
  { id: "happy", label: "开心", canon: "heart-eyes", group: "情绪", params: { mouth: 0.6, eye: -0.2, roll: -5 } },
  { id: "shy", label: "害羞", canon: "blush", group: "情绪", params: { mouth: 0.28, eye: -0.08, roll: -22, yaw: 0.22 } },
  { id: "tired", label: "累了", canon: "cold-sweat", group: "情绪", params: { mouth: -0.3, eye: -0.45, roll: 10 } },
  { id: "curious", label: "好奇", canon: "smug-eye", group: "情绪", params: { mouth: 0.2, roll: 24, gazeX: 0.4 } },
  { id: "sad", label: "难过", canon: "tears", group: "情绪", params: { mouth: -0.65, eye: -0.25, gazeY: -0.35, roll: 6 } },
  { id: "pout", label: "生气", canon: "x-eyes", group: "情绪", params: { mouth: -0.5, eye: -0.1, roll: -8, yaw: -0.1 } },
];

const ACTION_SLOTS_ALL = ACTION_SLOTS.concat(ACTIVITY_SLOTS);

const byId = (list) => {
  const m = Object.create(null);
  for (const s of list) m[s.id] = s;
  return m;
};

const PARAM_BY_ID = byId(PARAM_SLOTS);
const ACTION_BY_ID = byId(ACTION_SLOTS_ALL);
const EXPR_BY_ID = byId(EXPR_SLOTS);

// 必需槽：体检时缺一个就算「没适配好」
const REQUIRED_PARAMS = ["angleX", "angleZ", "eyeLOpen", "eyeROpen", "mouthOpen"];
const REQUIRED_ACTIONS = ACTION_SLOTS.filter((s) => s.required).map((s) => s.id);
const REQUIRED_EXPRS = ["default"];

// 参数的标准候选表（探测用）：canon 在前，alts 跟上。
// 名字大小写不敏感 —— Cubism 自己区分，但手改过模型的人经常大小写乱写。
function candidates(slot) {
  return [slot.canon].concat(slot.alts || []).filter(Boolean);
}

// 动作槽的值用一行字符串表达，好处是：清单里能一眼看懂、界面的一个下拉就能编辑、
// 校验时不用递归比较对象。
//   "builtin:场景名"  用内置动作库
//   "model:动作组"    用模型自带的 motion
//   "none"            明确不做动作
function encodeAction(ov, slot) {
  if (!ov) return "builtin:" + slot.scene;
  if (ov.engine === "none") return "none";
  if (ov.engine === "model") return "model:" + (ov.motion || "");
  // 未在模型清单里声明的动作也能绑：清单里存的是包内相对路径，
  // 这样不管文件叫什么、被扫到第几组，指向的都是同一个动作。
  if (ov.engine === "file") return "file:" + (ov.file || "");
  return "builtin:" + (ov.scene || slot.scene);
}

function decodeAction(v, slot) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return { engine: "builtin", scene: slot.scene };
  if (s === "none") return { engine: "none" };
  if (s.startsWith("model:")) {
    const g = s.slice(6).trim();
    return g ? { engine: "model", motion: g, index: 0 } : { engine: "builtin", scene: slot.scene };
  }
  if (s.startsWith("file:")) {
    const rel = s.slice(5).trim();
    if (!rel) return { engine: "builtin", scene: slot.scene };
    const base = rel.split("/").pop().replace(/\.motion3\.json$/i, "");
    return { engine: "file", file: rel, name: base };
  }
  if (s.startsWith("builtin:")) {
    const g = s.slice(8).trim();
    return { engine: "builtin", scene: g || slot.scene };
  }
  return { engine: "builtin", scene: slot.scene };
}

// 表演曲线要用到的槽（头部三角度 + 眼睛 + 嘴 + 眉 + 泪/怒/震惊）。
// 含基础槽里的 angleX/Y/Z、eyeBallX/Y、eyeLOpen/ROpen、mouthOpen、mouthForm，
// 因为这些也是「脸」的一部分，表演曲线同样会写它们。
const PERF_PARAM_SLOTS = PARAM_SLOTS.filter((s) =>
  s.expr || ["angleX", "angleY", "angleZ", "eyeBallX", "eyeBallY", "eyeLOpen", "eyeROpen", "mouthOpen", "mouthForm"].includes(s.id)
);

module.exports = {
  PARAM_SLOTS, ACTION_SLOTS, ACTIVITY_SLOTS, ACTION_SLOTS_ALL, EXPR_SLOTS,
  EXPR_PARAM_SLOTS, PERF_PARAM_SLOTS, PARAM_WEIGHTS, weightOf,
  PARAM_BY_ID, ACTION_BY_ID, EXPR_BY_ID,
  REQUIRED_PARAMS, REQUIRED_ACTIONS, REQUIRED_EXPRS,
  candidates, encodeAction, decodeAction,
};
