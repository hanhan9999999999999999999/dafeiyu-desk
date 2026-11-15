// 模型包清单（pet.json v3）。
//
// 一份清单要同时回答四个问题：
//   1. 这个包是谁（id / 名字 / 作者 / 授权）
//   2. 模型在哪、怎么加载（model 相对路径、贴图规则、物理）
//   3. 软件要的能力它拿什么补（params / actions / expressions 三张映射）
//   4. 适配器留下了什么痕迹（adapter.*，运行期不读，只给界面回显）
//
// 三个原则：
//   · 缺失即默认 —— 老包、手写的包、只有模型文件的裸包，都要能跑起来，不能因为少一个字段就白屏
//   · 一切路径必须相对且不含 .. —— 清单是用户可编辑的文本，等于半个输入口
//   · 不认识的字段原样保留 —— 以后加字段时旧版程序不该把它吃掉
const path = require("path");

const MANIFEST_VERSION = 3;
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const clamp = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

// 相对路径检查：不许绝对、不许盘符、不许 ..
function isSafeRel(p) {
  if (typeof p !== "string" || !p.trim()) return false;
  if (p.length > 512) return false;
  if (/^[a-zA-Z]:/.test(p)) return false;
  if (p.startsWith("/") || p.startsWith("\\")) return false;
  if (p.startsWith("//") || p.startsWith("\\\\")) return false;
  const norm = p.replace(/\\/g, "/");
  if (norm.split("/").some((seg) => seg === "..")) return false;
  return true;
}

function safeRel(p, dflt) {
  return isSafeRel(p) ? String(p).replace(/\\/g, "/") : dflt;
}

function cleanName(s, max = 120) {
  return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}

// 名字候选表：去空、去重、限长，最多 8 个
function cleanNames(arr, max = 8) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const v of arr) {
    const s = cleanName(v, 120);
    if (s && out.indexOf(s) < 0) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function cleanMap(obj, keyMax = 120, max = 64) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const out = {};
  let n = 0;
  for (const k of Object.keys(obj)) {
    if (n++ >= max) break;
    const key = cleanName(k, keyMax);
    if (!key) continue;
    out[key] = cleanNames(obj[k]);
  }
  return out;
}

function blank(id, model) {
  return {
    manifestVersion: MANIFEST_VERSION,
    id: id || "model",
    displayName: id || "未命名模型",
    description: "",
    version: "1.0.0",
    author: "",
    license: "",
    renderer: "live2d",
    live2d: {
      model: model || "",
      layout: { scale: 1, viewY: 0.1, viewH: 0.5, anchorX: 0.5, anchorY: 0.5, offsetX: 0, offsetY: 0, padding: 0.02 },
      textures: { count: 0, dir: "tex", pattern: "tex{i}.png", pad: 2, ext: "png" },
      params: {},
      aliases: {},
      actions: { engine: "builtin", overrides: {} },
      expressions: { engine: "auto", default: "", map: {} },
      groups: { eyeBlink: "EyeBlink", lipSync: "LipSync" },
      physics: { enabled: true },
      interaction: { headLine: 0.42, faceLine: 0.72, followX: 1, followY: 1, breathAmp: 1 },
      tuning: {
        angleMaxX: 26, angleMaxY: 30, angleMaxZ: 14, deadzone: 0.07,
        bodyGainX: 1, bodyGainY: 1, bodyGainZ: 1, bodyLag: 0.35,
        eyeGain: 1, eyeMax: 1, physicsDt: 33, maskResolution: 1024,
        fadeScale: 1, paramLock: true, idleLock: false, motionSpeed: 1,
      },
    },
    adapter: { probeVersion: 1, probedAt: "", rules: {}, origin: "imported", notes: "" },
  };
}

// v2 → v3。
//
// v2 的 motions 是「语义 → 模型动作组」的平表 —— 但全项目从来没读过它，
// 说明它是设计草图而不是生效配置。而且内置 82 支曲线比模型自带的 1~2 个动作丰富得多，
// 所以动作**不迁移**成覆盖，只留一份 legacy 记录备查；
// 表情要迁移 —— 模型自带的 exp3 表情确实比参数组合好。
function migrateV2(raw, id) {
  const out = blank(id || raw.id, "");
  const l2 = raw.live2d || {};
  out.displayName = cleanName(raw.displayName || raw.name || id, 64) || id;
  out.description = cleanName(raw.description, 500);
  out.version = cleanName(raw.version, 32) || "1.0.0";
  out.author = cleanName(raw.author, 120);
  out.license = cleanName(raw.license, 2000);
  if (cleanName(raw.renderer, 32)) out.renderer = cleanName(raw.renderer, 32);
  out.live2d.model = safeRel(l2.model, "");
  out.live2d.layout.scale = clamp(l2.scale, 0.2, 5, 1);

  const exp = l2.expressions && typeof l2.expressions === "object" ? l2.expressions : {};
  for (const slot of Object.keys(exp)) {
    const n = cleanName(exp[slot], 120);
    if (n) out.live2d.expressions.map[slot] = n;
  }
  out.adapter.origin = "builtin";
  out.adapter.legacy = {
    petManifestVersion: 2,
    motions: l2.motions && typeof l2.motions === "object" ? l2.motions : {},
    note: "v2 清单原样保留，仅作参考；动作默认走内置动作库",
  };
  return out;
}

// 主入口：任何来源的清单都从这里过一遍，出来的东西一定是合法 v3。
function sanitize(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return blank("model", "");
  const ver = Number(raw.manifestVersion || raw.petManifestVersion || 2);
  const rawId = cleanName(raw.id, 64).toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  const id = ID_RE.test(rawId) ? rawId : "model";

  if (ver < 3) return migrateV2(raw, id);

  const out = blank(id, "");
  out.displayName = cleanName(raw.displayName || raw.name, 64) || id;
  out.description = cleanName(raw.description, 500);
  out.version = cleanName(raw.version, 32) || "1.0.0";
  out.author = cleanName(raw.author, 120);
  out.license = cleanName(raw.license, 2000);
  if (cleanName(raw.renderer, 32)) out.renderer = cleanName(raw.renderer, 32);

  const l2 = raw.live2d && typeof raw.live2d === "object" ? raw.live2d : {};
  const L = out.live2d;
  L.model = safeRel(l2.model, "");

  const lay = l2.layout && typeof l2.layout === "object" ? l2.layout : {};
  L.layout = {
    scale: clamp(lay.scale, 0.2, 5, 1),
    // viewY/viewH 是「窗口里露模型的哪一段」，取景规则的结果就落在这两个字段上。
    // 少了它们，用户在适配器里把框拖到满意、点保存，写盘时会被这里悄悄抹掉，
    // 下次打开又回到默认 —— 表现为「保存没反应」，是最难查的那类 bug。
    viewY: clamp(lay.viewY, -0.2, 0.95, 0.1),
    viewH: clamp(lay.viewH, 0.1, 1.3, 0.5),
    anchorX: clamp(lay.anchorX, -0.5, 1.5, 0.5),
    anchorY: clamp(lay.anchorY, -0.5, 1.5, 0.5),
    offsetX: clamp(lay.offsetX, -2, 2, 0),
    offsetY: clamp(lay.offsetY, -2, 2, 0),
    padding: clamp(lay.padding, 0, 0.4, 0.02),
  };

  const tex = l2.textures && typeof l2.textures === "object" ? l2.textures : {};
  L.textures = {
    count: Math.round(clamp(tex.count, 0, 32, 0)),
    dir: safeRel(tex.dir, "tex"),
    pattern: cleanName(tex.pattern, 64) || "tex{i}.png",
    pad: Math.round(clamp(tex.pad, 0, 4, 2)),
    ext: ["png", "jpg", "webp"].indexOf(cleanName(tex.ext, 8)) >= 0 ? cleanName(tex.ext, 8) : "png",
  };

  L.params = cleanMap(l2.params);
  L.aliases = cleanMap(l2.aliases);

  const act = l2.actions && typeof l2.actions === "object" ? l2.actions : {};
  L.actions.engine = act.engine === "model" ? "model" : "builtin";
  if (act.overrides && typeof act.overrides === "object" && !Array.isArray(act.overrides)) {
    const ov = {};
    let n = 0;
    for (const k of Object.keys(act.overrides)) {
      if (n++ >= 64) break;
      const slot = cleanName(k, 64);
      const v = act.overrides[k];
      if (!slot || !v || typeof v !== "object") continue;
      if (v.engine === "none") { ov[slot] = { engine: "none" }; continue; }
      if (v.engine === "model" && cleanName(v.motion, 120)) {
        ov[slot] = { engine: "model", motion: cleanName(v.motion, 120), index: Math.round(clamp(v.index, 0, 64, 0)) };
        continue;
      }
      if (v.engine === "file") {
        const rel = safeRel(v.file, "");
        if (rel) { ov[slot] = { engine: "file", file: rel, name: cleanName(v.name, 120) }; continue; }
      }
      if (cleanName(v.scene, 64)) { ov[slot] = { engine: "builtin", scene: cleanName(v.scene, 64) }; }
    }
    L.actions.overrides = ov;
  }

  const exp = l2.expressions && typeof l2.expressions === "object" ? l2.expressions : {};
  L.expressions.engine = ["auto", "model", "params"].indexOf(exp.engine) >= 0 ? exp.engine : "auto";
  L.expressions.default = cleanName(exp.default, 120);
  if (exp.map && typeof exp.map === "object" && !Array.isArray(exp.map)) {
    const m = {};
    for (const k of Object.keys(exp.map)) {
      const slot = cleanName(k, 64);
      const v = cleanName(exp.map[k], 120);
      if (slot) m[slot] = v;              // 空字符串 = 这个情绪不设表情，合法
    }
    L.expressions.map = m;
  }

  const grp = l2.groups && typeof l2.groups === "object" ? l2.groups : {};
  L.groups = { eyeBlink: cleanName(grp.eyeBlink, 120), lipSync: cleanName(grp.lipSync, 120) };
  const phy = l2.physics && typeof l2.physics === "object" ? l2.physics : {};
  L.physics = { enabled: phy.enabled !== false };

  // interaction：点击分区高度、跟随强度、呼吸幅度。
  // 和 layout 同理 —— 这几个字段是「规则写、渲染端读」，不进白名单就会在保存时被抹掉。
  const itx = l2.interaction && typeof l2.interaction === "object" ? l2.interaction : {};
  L.interaction = {
    headLine: clamp(itx.headLine, 0.05, 0.95, 0.42),
    faceLine: clamp(itx.faceLine, 0.08, 0.99, 0.72),
    followX: clamp(itx.followX, 0, 2, 1),
    followY: clamp(itx.followY, 0, 2, 1),
    breathAmp: clamp(itx.breathAmp, 0, 2, 1),
  };


  // tuning：动作手感。和 layout / interaction 同理 —— 规则写、渲染端读，
  // 不进白名单的话保存时会被整块抹掉，表现为「调了半天，重开又回默认」。
  const tn = l2.tuning && typeof l2.tuning === "object" ? l2.tuning : {};
  L.tuning = {
    angleMaxX: clamp(tn.angleMaxX, 6, 48, 26),
    angleMaxY: clamp(tn.angleMaxY, 5, 40, 30),
    angleMaxZ: clamp(tn.angleMaxZ, 2, 30, 14),
    deadzone: clamp(tn.deadzone, 0, 0.35, 0.07),
    bodyGainX: clamp(tn.bodyGainX, 0, 2, 1),
    bodyGainY: clamp(tn.bodyGainY, 0, 2, 1),
    bodyGainZ: clamp(tn.bodyGainZ, 0, 2, 1),
    bodyLag: clamp(tn.bodyLag, 0, 1, 0.35),
    eyeGain: clamp(tn.eyeGain, 0, 2, 1),
    eyeMax: clamp(tn.eyeMax, 0.1, 2, 1),
    physicsDt: Math.round(clamp(tn.physicsDt, 0, 66, 33)),
    maskResolution: [256, 512, 1024, 2048].indexOf(Number(tn.maskResolution)) >= 0 ? Number(tn.maskResolution) : 1024,
    fadeScale: clamp(tn.fadeScale, 0.2, 4, 1),
    paramLock: tn.paramLock !== false,
    idleLock: tn.idleLock === true,
    motionSpeed: clamp(tn.motionSpeed, 0.25, 3, 1),
  };
  const ad = raw.adapter && typeof raw.adapter === "object" ? raw.adapter : {};
  out.adapter = {
    probeVersion: Math.round(clamp(ad.probeVersion, 0, 999, 1)),
    probedAt: cleanName(ad.probedAt, 40),
    rules: ad.rules && typeof ad.rules === "object" && !Array.isArray(ad.rules) ? ad.rules : {},
    origin: ["builtin", "imported", "duplicated"].indexOf(ad.origin) >= 0 ? ad.origin : "imported",
    notes: cleanName(ad.notes, 1000),
  };
  // v2 迁移过来的旧映射：原样留着，不做二次解释
  if (ad.legacy && typeof ad.legacy === "object") out.adapter.legacy = ad.legacy;
  return out;
}

// 体检（结构层）：只查清单自身，不碰磁盘、不碰模型。
// 磁盘和模型层的检查在 probe.js / store.js 里，分工是为了让本模块能被前端引用。
function validate(m) {
  const issues = [];
  const err = (code, message, extra) => issues.push(Object.assign({ level: "error", code, message }, extra));
  const warn = (code, message, extra) => issues.push(Object.assign({ level: "warn", code, message }, extra));

  if (!m || typeof m !== "object") return { ok: false, issues: [{ level: "error", code: "manifest-shape", message: "清单不是对象" }] };
  if (m.manifestVersion !== MANIFEST_VERSION) err("manifest-version", `清单版本应为 ${MANIFEST_VERSION}`);
  if (!ID_RE.test(String(m.id || ""))) err("id", "id 只能是小写字母数字和 - _，且不以符号开头");
  if (!String(m.displayName || "").trim()) warn("display-name", "没有显示名，列表里会显示 id");
  const L = m.live2d || {};
  if (!L.model) err("model-path", "没有填模型文件（.model3.json）");
  else if (!isSafeRel(L.model)) err("model-path", "模型路径必须是包内相对路径");
  else if (!/\.model3\.json$/i.test(L.model)) warn("model-ext", "模型文件通常以 .model3.json 结尾");
  return { ok: issues.every((i) => i.level !== "error"), issues };
}

// 清单里模型文件所在目录（贴图、物理等资源都相对它解析）
function modelDir(m) {
  const rel = m && m.live2d ? m.live2d.model : "";
  const d = path.posix.dirname(String(rel || "").replace(/\\/g, "/"));
  return d === "." ? "" : d;
}

// 拼资源路径：清单里的相对路径 + 模型目录，最后再校验一次
function resolveResource(m, rel) {
  const base = modelDir(m);
  const joined = base ? base + "/" + String(rel || "").replace(/\\/g, "/") : String(rel || "");
  return isSafeRel(joined) ? path.posix.normalize(joined) : "";
}

module.exports = {
  MANIFEST_VERSION, ID_RE,
  isSafeRel, safeRel, cleanName, cleanNames, cleanMap, clamp,
  blank, sanitize, migrateV2, validate, modelDir, resolveResource,
};
