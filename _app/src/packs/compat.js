// 表情动作的兼容层：把一个陌生模型的参数名，翻译成大肥鱼认识的那 26 个语义槽。
//
// 为什么要有这一层：
//   程序的逻辑写的是「笑眼」「张嘴」「歪头」，模型里写的却是画师自己起的名——
//   ParamEyeLSmile、ParamEye_Smile_L、ParamMeEyeSmileL…… 同一个意思七八种写法。
//   以前的做法是「标准名对一遍，对不上就按关键词硬撞」，撞错的时候比撞不到更糟：
//   把 ParamBodyAngleX 认成左右转头，模型会在跟随鼠标时整个身子乱扭。
//
// 这里的规矩：
//   1. 先认标准名（canon），再认常见变体（alias），最后才按词打分（fuzzy）；
//   2. 打分要**扣分**：头部的槽看到 body/arm/leg/hand 就大幅降权，左右槽看到反向侧也降权；
//   3. 分数不够宁可留空——留空时界面会写「这个模型没这功能」，猜错时用户只会觉得「她坏了」；
//   4. 单侧参数（模型只做了一个 ParamEyeOpen）允许同时服务左右两槽，并标记出来；
//   5. 全都算完给一份人话报告，适配器界面上直接看得懂「这个模型能演到什么程度」。
//
// 纯函数，不碰文件系统，可以单独跑测试（scripts/test-compat.js）。

const sem = require("./semantics.js");

// 常见写法补充：canon/alts 之外，画师们最爱用的那些。
// 键是槽 id，值是「等同于标准名」的整名（大小写不敏感，比较时去掉分隔符）。
const ALIAS = {
  angleX: ["ParamAngleX2", "ParamHeadAngleX", "ParamHeadX", "ParamKubiX"],
  angleY: ["ParamAngleY2", "ParamHeadAngleY", "ParamHeadY", "ParamKubiY"],
  angleZ: ["ParamAngleZ2", "ParamHeadAngleZ", "ParamHeadZ", "ParamKubiZ", "ParamTilt"],
  bodyAngleX: ["ParamBodyX", "ParamBodyAngleX2"],
  bodyAngleZ: ["ParamBodyZ", "ParamBodyAngleZ2"],
  eyeBallX: ["ParamEyeBallX2", "ParamHitomiX", "ParamEyeX", "ParamMeEyeX"],
  eyeBallY: ["ParamEyeBallY2", "ParamHitomiY", "ParamEyeY", "ParamMeEyeY"],
  eyeLOpen: ["ParamEyeOpenL", "ParamEyeLOpen2", "ParamEyeOpen1", "ParamMeEyeOpenL"],
  eyeROpen: ["ParamEyeOpenR", "ParamEyeROpen2", "ParamEyeOpen2", "ParamMeEyeOpenR"],
  mouthOpen: ["ParamMouthOpenY", "ParamMouthOpenX", "ParamMouthA", "ParamMouthUp", "ParamKuchiOpen"],
  mouthForm: ["ParamMouthForm2", "ParamMouthShape", "ParamMouthSmile", "ParamKuchiForm"],
  breath: ["ParamBreath2", "ParamBreathing", "ParamIki", "ParamKokyuu"],
  eyeSmile: ["ParamEyeLSmile", "ParamEyeRSmile", "ParamEyeSmileL", "ParamEyeSmileR", "ParamEyeSmile2", "ParamEyeBallSmile"],
  browLY: ["ParamBrowLY2", "ParamBrowYL", "ParamMayuLY", "ParamBrowLeftY"],
  browRY: ["ParamBrowRY2", "ParamBrowYR", "ParamMayuRY", "ParamBrowRightY"],
  browLAngle: ["ParamBrowLAngle2", "ParamBrowAngleL", "ParamMayuLAngle"],
  browRAngle: ["ParamBrowRAngle2", "ParamBrowAngleR", "ParamMayuRAngle"],
  browInnerUp: ["ParamBrowInnerUp2", "ParamBrowLForm", "ParamBrowRForm"],
  shockL: ["ParamShockL2", "ParamEyeShockL", "ParamShock1"],
  shockR: ["ParamShockR2", "ParamEyeShockR", "ParamShock2"],
  cryL: ["ParamCryL2", "ParamTearL", "ParamEyeCryL"],
  cryR: ["ParamCryR2", "ParamTearR", "ParamEyeCryR"],
  angry: ["ParamAngry2", "ParamAnger", "ParamBrowAngry", "ParamIkari"],
  pupilX: ["ParamPupilX", "ParamHitomiX2", "ParamEyeBallX3"],
  mouthPucker: ["ParamMouthPucker2", "ParamMouthO", "ParamKuchiPucker"],
  cheekPuff: ["ParamCheek", "ParamCheekPuff2", "ParamCheekL", "ParamHoppe"],
};

// 每个槽的「必须同时出现的词」与「一看到就该让路的词」。
// must 里每个子数组是「一组同义词，命中其一即可」，不同组必须都命中。
const SPEC = {
  angleX: { must: [["angle", "kubi", "head"], ["x"]], deny: ["body", "arm", "leg", "hand", "breath", "eye", "mouth", "brow"] },
  angleY: { must: [["angle", "kubi", "head"], ["y"]], deny: ["body", "arm", "leg", "hand", "breath", "eye", "mouth", "brow"] },
  angleZ: { must: [["angle", "kubi", "head", "tilt"], ["z"]], deny: ["body", "arm", "leg", "hand", "breath", "eye", "mouth", "brow"] },
  bodyAngleX: { must: [["body", "karada"], ["x"]], deny: ["arm", "leg", "hand", "eye", "mouth", "brow", "head"] },
  bodyAngleZ: { must: [["body", "karada"], ["z"]], deny: ["arm", "leg", "hand", "eye", "mouth", "brow", "head"] },
  eyeBallX: { must: [["eyeball", "hitomi", "pupil", "eye"], ["x"]], deny: ["open", "smile", "brow", "body", "angle"] },
  eyeBallY: { must: [["eyeball", "hitomi", "pupil", "eye"], ["y"]], deny: ["open", "smile", "brow", "body", "angle"] },
  eyeLOpen: { must: [["eye"], ["open"]], side: "l", deny: ["smile", "brow", "body"] },
  eyeROpen: { must: [["eye"], ["open"]], side: "r", deny: ["smile", "brow", "body"] },
  mouthOpen: { must: [["mouth", "kuchi"], ["open", "a", "y"]], deny: ["eye", "brow", "body", "form", "smile"] },
  mouthForm: { must: [["mouth", "kuchi"], ["form", "shape", "smile"]], deny: ["eye", "brow", "body", "open"] },
  breath: { must: [["breath", "breathing", "iki", "kokyuu"]], deny: ["eye", "mouth", "body"] },
  eyeSmile: { must: [["eye"], ["smile"]], deny: ["brow", "body", "mouth"] },
  browLY: { must: [["brow", "mayu"], ["y", "up", "down", "form"]], side: "l", deny: ["eye", "mouth", "body"] },
  browRY: { must: [["brow", "mayu"], ["y", "up", "down", "form"]], side: "r", deny: ["eye", "mouth", "body"] },
  browLAngle: { must: [["brow", "mayu"], ["angle"]], side: "l", deny: ["eye", "mouth", "body"] },
  browRAngle: { must: [["brow", "mayu"], ["angle"]], side: "r", deny: ["eye", "mouth", "body"] },
  browInnerUp: { must: [["brow", "mayu"], ["inner", "form"]], deny: ["eye", "mouth", "body", "angle"] },
  shockL: { must: [["shock"], []], side: "l", deny: ["eye", "mouth", "body"] },
  shockR: { must: [["shock"], []], side: "r", deny: ["eye", "mouth", "body"] },
  cryL: { must: [["cry", "tear", "namida"], []], side: "l", deny: ["mouth", "body"] },
  cryR: { must: [["cry", "tear", "namida"], []], side: "r", deny: ["mouth", "body"] },
  angry: { must: [["angry", "anger", "ikari"]], deny: ["eye", "mouth", "body"] },
  pupilX: { must: [["pupil"], ["x"]], deny: ["body", "angle"] },
  mouthPucker: { must: [["mouth", "kuchi"], ["pucker", "o", "round"]], deny: ["eye", "brow", "body", "open"] },
  cheekPuff: { must: [["cheek", "hoppe", "puff"], []], deny: ["eye", "mouth", "body"] },
};

// 单侧参数同时服务左右时，这几个槽要成对处理（模型只做了一个眼睛开合参数）。
const PAIRS = [["eyeLOpen", "eyeROpen"], ["browLY", "browRY"], ["browLAngle", "browRAngle"], ["shockL", "shockR"], ["cryL", "cryR"]];

// 缺了某个槽时，能不能用别的参数近似表达。只收「看起来真的是同一件事」的几条，
// 宁可少给也不要给错：替身做出来的表情不对，用户会觉得她表情坏了，比不做更糟。
const PROXY = [
  { slot: "eyeSmile", via: ["eyeLOpen", "eyeROpen"], kind: "squint", note: "没有笑眼参数，用「眯眼」代替（写 0.45 倍）" },
  { slot: "mouthForm", via: ["mouthPucker"], kind: "invert", note: "没有嘴角参数，用「撇嘴」反过来代替微笑" },
  { slot: "browInnerUp", via: ["browLAngle", "browRAngle"], kind: "share", note: "没有眉心上挑，用眉角代替" },
  { slot: "angry", via: ["browLAngle", "browRAngle"], kind: "share", note: "没有生气参数，用压眉代替" },
];

const EXPR_HINTS = {
  default: ["default", "normal", "base", "idle", "neutral", "通常", "默认"],
  happy: ["happy", "smile", "laugh", "joy", "fun", "haha", "heart", "笑", "开心"],
  shy: ["shy", "blush", "embarrass", "fluster", "hot", "red", "羞", "脸红"],
  tired: ["tired", "sleep", "sleepy", "sweat", "exhaust", "dizzy", "累", "困"],
  curious: ["curious", "smug", "question", "think", "wonder", "star", "疑", "好奇"],
  sad: ["sad", "cry", "tear", "sorrow", "down", "blue", "悲", "哭"],
  pout: ["pout", "angry", "anger", "mad", "annoy", "x-eye", "xeye", "生气", "嘟"],
};

function norm(id) {
  return String(id || "").toLowerCase().replace(/[_\-\s.]/g, "");
}

// 把 ParamEyeLSmile 拆成 ["eye","l","smile"]：驼峰、下划线、数字都切开。
function tokens(id) {
  return String(id || "")
    .replace(/^param/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .replace(/[_\-\s.]+/g, " ")
    .toLowerCase()
    .split(" ")
    .filter(Boolean);
}

function anyHit(tokenStr, words) {
  // words 为空数组 = 这一组不作要求（比如 shock 只要出现 shock 就行）
  if (!words.length) return true;
  return words.some((w) => tokenStr.includes(w));
}

// 侧别：l / r / none。数字后缀 1/2 也算（老模型常用 ParamEyeOpen1 / 2 表示左右）。
function sideOf(tokenArr, raw) {
  const has = (w) => tokenArr.includes(w);
  if (has("l") || has("left") || /left/i.test(raw)) return "l";
  if (has("r") || has("right") || /right/i.test(raw)) return "r";
  if (tokenArr.includes("1")) return "l";
  if (tokenArr.includes("2")) return "r";
  return "";
}

/**
 * 给一个槽的所有候选参数打分。分数越高越像，低于阈值的直接丢掉。
 * 返回 [{id, score, why}]
 */
function scoreSlot(slotId, paramIds) {
  const spec = SPEC[slotId];
  if (!spec) return [];
  const out = [];
  const canon = norm(sem.PARAM_BY_ID[slotId] ? sem.PARAM_BY_ID[slotId].canon : "");
  const alts = (ALIAS[slotId] || []).map(norm);
  for (const id of paramIds) {
    const n = norm(id);
    const tk = tokens(id);
    const joined = tk.join("");
    // ① 标准名 / 变体：直接满分，不再看别的
    if (n === canon) { out.push({ id, score: 1000, why: "标准名" }); continue; }
    if (alts.includes(n)) { out.push({ id, score: 940, why: "常见变体" }); continue; }
    // ② 关键词打分
    let score = 0;
    const hits = [];
    let ok = true;
    for (const group of spec.must) {
      if (!anyHit(joined, group)) { ok = false; break; }
      hits.push(group[0]);
    }
    if (!ok) continue;
    score = 600 + hits.length * 20;
    // 侧别：要求的侧别和参数实际的侧别不一致就重罚（不一刀切，因为有些模型靠顺序区分）
    if (spec.side) {
      const s = sideOf(tk, id);
      if (s && s !== spec.side) { score -= 320; }
      else if (!s) { score -= 60; }   // 没侧别 = 单侧参数，可用但要标记
    }
    // 反向词扣分：头部槽看到 body/arm 之类，说明这是别的部位
    for (const d of (spec.deny || [])) {
      if (joined.includes(d)) score -= 260;
    }
    // 名字越长越可能是复合参数，轻微降权（ParamAngleX 优于 ParamAngleXWithBody）
    if (tk.length > 3) score -= (tk.length - 3) * 25;
    if (score > 0) out.push({ id, score, why: "关键词(" + hits.join("+") + ")" });
  }
  out.sort((a, b) => b.score - a.score || String(a.id).length - String(b.id).length);
  return out;
}

const PASS = 420;   // 及格线：低于它的匹配不如留空

/**
 * 主入口。
 * @param {{paramIds:string[], exprNames?:string[]}} input
 * @returns 映射结果 + 人话报告（纯数据，方便存进 manifest 或直接给界面）
 */
function resolve(input) {
  const paramIds = Array.isArray(input && input.paramIds) ? input.paramIds : [];
  const exprNames = Array.isArray(input && input.exprNames) ? input.exprNames : [];
  const params = {};
  const detail = [];
  const missing = [];
  const sideShared = [];
  const usedBy = Object.create(null);   // 一个参数被几个槽用掉了

  for (const slot of sem.PARAM_SLOTS) {
    const ranked = scoreSlot(slot.id, paramIds).filter((x) => x.score >= PASS);
    if (ranked.length) {
      const best = ranked[0];
      params[slot.id] = [best.id];
      usedBy[best.id] = (usedBy[best.id] || 0) + 1;
      detail.push({ slot: slot.id, param: best.id, how: best.score >= 940 ? "exact" : "fuzzy", score: best.score, why: best.why });
    } else {
      params[slot.id] = [];
      missing.push(slot.id);
    }
  }

  // 单侧参数补对侧：模型只有一个 ParamEyeOpen 时，让左右都指它。
  for (const [a, b] of PAIRS) {
    const pa = params[a] || [];
    const pb = params[b] || [];
    // 两槽各自都猜到了「同一个参数」——说明模型只有一个，这就是共用，记下来别当成两套。
    if (pa.length && pb.length && pa[0] === pb[0]) {
      if (!sideShared.includes(a)) sideShared.push(a);
      if (!sideShared.includes(b)) sideShared.push(b);
      continue;
    }
    if (pa.length && !pb.length) {
      params[b] = params[a].slice();
      sideShared.push(b);
      detail.push({ slot: b, param: params[a][0], how: "shared", score: 0, why: "和 " + a + " 共用同一个参数" });
      const i = missing.indexOf(b);
      if (i >= 0) missing.splice(i, 1);
    } else if (params[b] && params[b].length && (!params[a] || !params[a].length)) {
      params[a] = params[b].slice();
      sideShared.push(a);
      detail.push({ slot: a, param: params[b][0], how: "shared", score: 0, why: "和 " + b + " 共用同一个参数" });
      const i = missing.indexOf(a);
      if (i >= 0) missing.splice(i, 1);
    }
  }

  // 替身：只在「真的缺」且「有可用的近似参数」时才登记，绝不给空头承诺。
  const proxied = [];
  const has = (id) => Array.isArray(params[id]) && params[id].length > 0;
  for (const p of PROXY) {
    if (has(p.slot)) continue;
    const via = p.via.filter(has);
    if (!via.length) continue;
    proxied.push({ slot: p.slot, via, kind: p.kind, note: p.note });
    const i = missing.indexOf(p.slot);
    if (i >= 0) missing.splice(i, 1);
  }

  // 表情：先标准名，再按情绪词打分（同类多个时取名字最短的，通常是主表情）。
  const exprs = {};
  const exprMissing = [];
  for (const slot of sem.EXPR_SLOTS) {
    let hit = "";
    const canon = norm(slot.canon);
    for (const n of exprNames) if (norm(n) === canon) { hit = n; break; }
    if (!hit) {
      const hints = EXPR_HINTS[slot.id] || [];
      const scored = [];
      for (const raw of exprNames) {
        const l = String(raw).toLowerCase();
        for (let i = 0; i < hints.length; i++) {
          if (l.includes(String(hints[i]).toLowerCase())) { scored.push({ raw, score: hints.length - i }); break; }
        }
      }
      scored.sort((x, y) => y.score - x.score || String(x.raw).length - String(y.raw).length);
      if (scored.length) hit = scored[0].raw;
    }
    exprs[slot.id] = hit;
    if (!hit) exprMissing.push(slot.id);
  }

  const req = sem.REQUIRED_PARAMS.filter((id) => has(id)).length;
  const reqTotal = sem.REQUIRED_PARAMS.length;
  const byScore = detail.filter((d) => d.score > 0);
  const avg = byScore.length ? Math.round(byScore.reduce((s, d) => s + Math.min(1000, d.score), 0) / byScore.length) : 0;
  const score = Math.round(
    (req / Math.max(1, reqTotal)) * 60
    + (Math.min(1, byScore.length / Math.max(1, sem.PARAM_SLOTS.length)) * 25)
    + ((exprs && Object.values(exprs).filter(Boolean).length) / sem.EXPR_SLOTS.length) * 15
  );

  return {
    params,
    detail,
    missing,
    proxied,
    sideShared,
    exprs,
    exprMissing,
    requiredOk: req,
    requiredTotal: reqTotal,
    score,
    quality: avg,
    level: levelOf(score, req, reqTotal),
    summary: summarize({ score, missing, proxied, sideShared, exprMissing, req, reqTotal, exprs }),
  };
}

function levelOf(score, req, reqTotal) {
  if (req < reqTotal) return "basic";
  if (score >= 85) return "full";
  if (score >= 65) return "good";
  if (score >= 40) return "ok";
  return "basic";
}

const LEVEL_TEXT = {
  full: "完全兼容",
  good: "基本兼容",
  ok: "能用，但会少一些细节",
  basic: "只保证基础动作",
};

function summarize(r) {
  const lines = [];
  lines.push(LEVEL_TEXT[r.level] + "：26 个语义槽接上 " + (sem.PARAM_SLOTS.length - r.missing.filter((id) => !r.proxied.some((p) => p.slot === id)).length) + " 个");
  if (r.missing.length) {
    const names = r.missing.map((id) => (sem.PARAM_BY_ID[id] ? sem.PARAM_BY_ID[id].label : id));
    lines.push("缺：" + names.slice(0, 6).join("、") + (names.length > 6 ? " 等 " + names.length + " 项" : ""));
  }
  if (r.proxied.length) lines.push("用替身：" + r.proxied.map((p) => (sem.PARAM_BY_ID[p.slot] ? sem.PARAM_BY_ID[p.slot].label : p.slot)).join("、"));
  if (r.sideShared.length) lines.push("左右共用：" + r.sideShared.map((id) => (sem.PARAM_BY_ID[id] ? sem.PARAM_BY_ID[id].label : id)).join("、"));
  const got = Object.keys(r.exprs || {}).filter((k) => r.exprs[k]).length;
  lines.push("表情 " + got + " / " + sem.EXPR_SLOTS.length);
  return { level: r.level, levelText: LEVEL_TEXT[r.level], lines };
}

/**
 * 把 resolve() 的结果压成 manifest 里存的那几行（兼容旧字段，方便老版本读）。
 */
function toGuesses(res) {
  const params = {};
  for (const k of Object.keys(res.params)) params[k] = res.params[k];
  return { params, expressions: res.exprs };
}

module.exports = {
  PASS,
  ALIAS,
  SPEC,
  PROXY,
  EXPR_HINTS,
  tokens,
  sideOf,
  scoreSlot,
  resolve,
  summarize,
  toGuesses,
  LEVEL_TEXT,
};
