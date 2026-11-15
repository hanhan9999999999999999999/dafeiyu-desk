// 「下一拍做什么」的策略层：情绪、动作、表情三件事在这里对齐。
//
// 以前这三件事各算各的：
//   · 换表情只看饥饿和好感，随机里挑一个，和正在播的动作无关；
//   · 换动作只看场景表，和此刻的表情无关，所以会出现「刚歪头害羞完，接着伸懒腰」；
//   · 交接时长按前后动作长度算，不知道上一个动作已经播到哪儿了。
// 结果是单拍都对、连起来像换了个人。这个文件只做纯计算（不给 rnd 就自己掷），
// 方便单测：scripts/test-motion-pick.js。
//
// 三个出口：
//   moodOf(ctx)            现在的「主情绪」——表情和动作共用同一个判断
//   nextExpr(mood, ctx)    该换成哪个表情、保持多久（带防重复）
//   pickScene(list, opts)  这个场景里挑哪一段（带情绪偏置 + 最近三段防重复）
//   handoff(prev, next)    两个动作交接用多长时间

// 情绪 → 场景偏置（乘在原始权重上）。1 = 不影响，>1 更爱挑，<1 少挑。
// 只写「真有差别」的几条，别把所有场景都摆一遍——摆得越全，越等于没偏置。
const SCENE_BIAS = {
  happy: { smile: 2.2, bounce: 1.8, stretch: 0.5, sigh: 0.4 },
  shy: { tilt: 1.8, glance: 1.5, smile: 1.2, bounce: 0.5 },
  tired: { yawn: 2.4, stretch: 0.8, sigh: 1.6, bounce: 0.2 },
  curious: { glance: 2.0, tilt: 1.6, bounce: 0.8 },
  sad: { sigh: 2.0, glance: 0.6, bounce: 0.2 },
  neutral: {},
};

const EXPR_HOLD = {
  happy: [3200, 5200],
  shy: [2400, 4200],
  tired: [3600, 6400],
  curious: [2200, 3600],
  sad: [3400, 5600],
  default: [2600, 4600],
};

/**
 * 现在的「主情绪」。表情和动作都必须用这一个判断，否则会出现
 * 哭着伸懒腰这种事。
 * ctx: {favor, hunger, hour, phase, nightOwl}
 */
function moodOf(ctx) {
  const c = ctx || {};
  const hour = Number.isFinite(c.hour) ? c.hour : new Date().getHours();
  const late = hour >= 23 || hour <= 5;
  const favor = Number(c.favor) || 0;
  const hunger = Number.isFinite(c.hunger) ? Number(c.hunger) : 100;

  // 饿了会先垮掉情绪，这是最该被看见的一档
  if (hunger < 25) return "tired";
  if (c.phase === "thinking" || c.phase === "tool") return "curious";
  if (late) return "tired";
  if (favor >= 70) return "happy";
  if (favor <= 15) return "shy";
  return "neutral";
}

/**
 * 该换成哪个表情。recent 是最近用过的（最近的在末尾），会降权。
 * 返回 {key, hold}
 */
function nextExpr(mood, ctx, rnd) {
  const r = typeof rnd === "function" ? rnd : Math.random;
  const c = ctx || {};
  const recent = Array.isArray(c.recent) ? c.recent : [];
  const pool = [];
  const m = mood || "neutral";
  if (m === "happy") pool.push("happy", "happy", "shy");
  else if (m === "shy") pool.push("shy", "shy", "curious");
  else if (m === "tired") pool.push("tired", "tired", "sad");
  else if (m === "curious") pool.push("curious", "curious", "happy");
  else if (m === "sad") pool.push("sad", "sad", "tired");
  else pool.push("happy", "curious", "shy", "tired");

  // 深夜不笑：这是她自己定的规矩，不是随机
  const hour = Number.isFinite(c.hour) ? c.hour : new Date().getHours();
  const late = hour >= 23 || hour <= 5;
  const allowed = pool.filter((k) => !(late && k === "happy"));
  const finalPool = allowed.length ? allowed : pool;

  // 最近两个里出现过的，权重降到 0.25（不是完全排除：只有两三个表情时全排除会卡死）
  const weight = (k) => {
    const i = recent.lastIndexOf(k);
    if (i < 0) return 1;
    return i >= recent.length - 2 ? 0.25 : 0.6;
  };
  let total = 0;
  for (const k of finalPool) total += weight(k);
  let x = r() * (total || 1);
  let key = finalPool[finalPool.length - 1];
  for (const k of finalPool) {
    x -= weight(k);
    if (x <= 0) { key = k; break; }
  }

  const [a, b] = EXPR_HOLD[key] || EXPR_HOLD.default;
  return { key, hold: Math.round(a + r() * (b - a)) };
}

/**
 * 场景表里挑一段。list 是名字数组，opts:
 *   {mood, recent:[...], last, rnd}
 * 返回名字；list 为空返回 ""。
 */
function pickScene(list, opts) {
  const arr = Array.isArray(list) ? list.filter(Boolean) : [];
  if (!arr.length) return "";
  if (arr.length === 1) return arr[0];
  const o = opts || {};
  const r = typeof o.rnd === "function" ? o.rnd : Math.random;
  const bias = SCENE_BIAS[o.mood] || {};
  const recent = Array.isArray(o.recent) ? o.recent : (o.last ? [o.last] : []);
  const weight = (name) => {
    // 名字里可能带后缀（smile_2 / smile.slow），按前缀查偏置
    const base = String(name).split(/[._-]/)[0];
    let w = Number(bias[base] || bias[name] || 1);
    if (!Number.isFinite(w) || w <= 0) w = 1;
    const i = recent.lastIndexOf(name);
    if (i >= 0 && i >= recent.length - 3) w *= 0.2;   // 最近三段内的，几乎不重复
    else if (i >= 0) w *= 0.6;
    return w;
  };
  let total = 0;
  for (const n of arr) total += weight(n);
  let x = r() * (total || 1);
  let pick = arr[arr.length - 1];
  for (const n of arr) {
    x -= weight(n);
    if (x <= 0) { pick = n; break; }
  }
  return pick;
}

/**
 * 两个动作交接用多久（秒）。
 * 依据三条经验：
 *   ① 上一个动作已经播过大半 → 它自己就在收尾，交接要短，否则两段尾巴叠在一起发糊；
 *   ② 刚起就被打断（<30%）→ 交接长一点，否则看着像抽搐；
 *   ③ 永远不超过较短那段的 40%，否则短动作整段都在淡化里，等于没演。
 */
function handoff(prevDur, prevElapsed, nextDur) {
  const pd = Math.max(0.1, Number(prevDur) || 0.1);
  const nd = Math.max(0.1, Number(nextDur) || 0.1);
  const el = Math.max(0, Number(prevElapsed) || 0);
  const part = el / pd;             // 上一个动作演到哪儿了
  let base;
  if (part >= 0.65) base = 0.16;
  else if (part <= 0.3) base = 0.34;
  else base = 0.24;
  const cap = Math.min(pd, nd) * 0.4;
  return Math.max(0.12, Math.min(base, cap, 0.62));
}

// 名字必须是独有的：index.html 里所有脚本共用一个顶层作用域，
// 叫 API 会跟 lines.js 撞车（"Identifier 'API' has already been declared"），
// 结果是这一整个文件静默不执行、衔接逻辑退回旧版。真机上踩过一次。
const FISH_PICK_API = {
  SCENE_BIAS,
  EXPR_HOLD,
  moodOf,
  nextExpr,
  pickScene,
  handoff,
};

// 双出口：渲染层用 <script> 引（window.FishMotionPick），测试与主进程用 require。
if (typeof window !== "undefined") window.FishMotionPick = FISH_PICK_API;
if (typeof module !== "undefined" && module.exports) module.exports = FISH_PICK_API;
