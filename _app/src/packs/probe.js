// 探测：把一个模型包目录读成一份结构报告，并给出「自动匹配」的猜测。
//
// 这一步不加载 moc3、不启动引擎 —— 只读 json 和文件大小。原因有两个：
//   1. 适配器要在「还没渲染」的时候就能列出参数/动作/表情，否则用户得先等模型加载完
//   2. 探测失败必须是可解释的（少哪个文件、哪个字段不合法），而不是引擎一句红字
//
// 猜测的原则：宁可留空，不要猜错。猜错的代价是「在新模型上悄悄写错参数」，
// 用户还以为是模型本身的问题；留空至少界面上看得见、能手动选。
const fs = require("fs");
const path = require("path");
const sem = require("./semantics");
const M = require("./manifest");

function readJson(file, maxBytes) {
  const lim = maxBytes || 32 * 1024 * 1024;
  const st = fs.statSync(file);
  if (st.size > lim) throw new Error(`文件过大：${path.basename(file)} (${(st.size / 1048576).toFixed(1)}MB)`);
  const txt = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(txt);
}

function exists(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function sizeOf(p) {
  try { return fs.statSync(p).size; } catch { return 0; }
}

// cdi3 是 Cubism Editor 导出的「参数/部件字典」，不是 model3 引用的，靠命名约定找：
//   1. 和 moc 同名（dafeiyu.moc3 → dafeiyu.cdi3.json）
//   2. 和 model3 同名（x.model3.json → x.cdi3.json）
//   3. 目录里唯一的那个 *.cdi3.json
function findCdi3(packDir, model3, mocName, fallbackDir) {
  const dirs = [path.dirname(path.join(packDir, model3))];
  // 覆盖层（本机配置）的 pet.json 单独存在用户目录，模型本体还在安装目录里 ——
  // cdi3 也要去那边找一遍，否则内置模型一改配置就「参数全没了」，适配器直接空白。
  if (fallbackDir) {
    const d2 = path.dirname(path.join(fallbackDir, model3));
    if (d2 !== dirs[0]) dirs.push(d2);
  }
  for (const dir of dirs) {
    const cands = [];
    const add = (base) => {
      if (!base) return;
      cands.push(path.join(dir, base.replace(/\.(moc3|model3\.json)$/i, "") + ".cdi3.json"));
    };
    add(mocName);
    add(path.basename(model3));
    cands.push(path.join(dir, "model.cdi3.json"));
    for (const c of cands) if (exists(c)) return c;
    try {
      const hit = fs.readdirSync(dir).filter((f) => /\.cdi3\.json$/i.test(f));
      if (hit.length === 1) return path.join(dir, hit[0]);
    } catch { /* 目录读不了就算了 */ }
  }
  return "";
}

// 参数名模糊匹配：标准名找不到时的退路。
// 只在「名字里同时出现全部关键词」时才算命中，避免把 ParamAngleX 猜成 ParamBodyAngleX。
const FUZZY = {
  angleX: [["angle", "x"], ["head", "x"], ["kubi", "x"]],
  angleY: [["angle", "y"], ["head", "y"]],
  angleZ: [["angle", "z"], ["head", "z"], ["tilt"]],
  bodyAngleX: [["body", "x"], ["bodyangle", "x"]],
  bodyAngleZ: [["body", "z"], ["bodyangle", "z"]],
  eyeBallX: [["eyeball", "x"], ["eye", "ball", "x"], ["hitomi", "x"]],
  eyeBallY: [["eyeball", "y"], ["eye", "ball", "y"], ["hitomi", "y"]],
  eyeLOpen: [["eye", "l", "open"], ["eyeopen", "l"], ["lefteye", "open"]],
  eyeROpen: [["eye", "r", "open"], ["eyeopen", "r"], ["righteye", "open"]],
  mouthOpen: [["mouth", "open"], ["mouth", "y"], ["kuchi", "open"]],
  mouthForm: [["mouth", "form"], ["mouth", "shape"], ["mouth", "smile"]],
  breath: [["breath"], ["breathing"], ["iki"], ["kokyuu"]],
};

function fuzzyParam(slotId, paramIds) {
  const rules = FUZZY[slotId];
  if (!rules) return [];
  const lower = paramIds.map((id) => ({ id, l: id.toLowerCase() }));
  for (const keys of rules) {
    for (const p of lower) {
      if (keys.every((k) => p.l.includes(k))) return [p.id];
    }
  }
  return [];
}

// 表情名模糊匹配：不同画师给 exp 的命名五花八门，但情绪词高度趋同。
const EXPR_HINTS = {
  happy: ["happy", "smile", "laugh", "joy", "heart", "fun", "haha"],
  shy: ["shy", "blush", "embarrass", "fluster", "hot", "red"],
  tired: ["tired", "sleep", "sleepy", "sweat", "exhaust", "dizzy"],
  curious: ["curious", "smug", "question", "think", "wonder", "star"],
  sad: ["sad", "cry", "tear", "sorrow", "down", "blue"],
  pout: ["pout", "angry", "anger", "mad", "annoy", "x-eye", "xeye"],
  default: ["default", "normal", "base", "idle", "neutral"],
};

function fuzzyExpr(slotId, names) {
  const hints = EXPR_HINTS[slotId];
  if (!hints || !names.length) return "";
  const scored = [];
  for (const raw of names) {
    const l = raw.toLowerCase();
    for (let i = 0; i < hints.length; i++) {
      if (l.includes(hints[i])) { scored.push({ raw, score: hints.length - i }); break; }
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.length ? scored[0].raw : "";
}

/**
 * 探测一个模型包。
 * @param {string} packDir 包目录绝对路径
 * @param {object} manifest 已 sanitize 的清单
 * @returns 结构报告
 */
function probe(packDir, manifest, opts) {
  // 覆盖层：用户的 pet.json 在 userDir，模型文件仍在安装目录。
  // 所有「包内相对路径」都先查本包目录、再查 fallback —— 一处统一，别每处各写一遍。
  const fb = opts && opts.fallbackDir ? opts.fallbackDir : "";
  const at = (rel) => {
    const a = path.join(packDir, rel);
    if (exists(a)) return a;
    if (fb) {
      const b = path.join(fb, rel);
      if (exists(b)) return b;
    }
    return a;
  };
  // 绝对路径 → 相对哪个包根（用于回给前端的 URL 片段）
  const relOf = (abs) => {
    const r1 = path.relative(packDir, abs);
    if (r1 && !r1.startsWith("..") && !path.isAbsolute(r1)) return r1.replace(/\\/g, "/");
    if (fb) {
      const r2 = path.relative(fb, abs);
      if (r2 && !r2.startsWith("..") && !path.isAbsolute(r2)) return r2.replace(/\\/g, "/");
    }
    return String(abs).replace(/\\/g, "/");
  };
  const report = {
    ok: false,
    packDir,
    modelPath: "",
    errors: [],
    warnings: [],
    model3: null,
    moc: "",
    mocBytes: 0,
    textures: [],
    physics: "",
    motions: {},          // group -> count
    motionFiles: [],      // {group, index, file, bytes}
    expressions: [],      // [{name, file}]
    params: [],           // [{id, name, group, order}]
    paramGroups: [],
    parts: [],
    groups: { eyeBlink: [], lipSync: [] },
    groupList: [],        // 模型声明的全部参数组（[{name,target,ids}]）
    hitAreas: [],         // 模型自带的命中区域 id（可选，程序不依赖）
    cdi3: "",
    guesses: { params: {}, actions: {}, expressions: {} },
    matched: { params: 0, paramsTotal: 0 },
  };

  const rel = manifest && manifest.live2d ? manifest.live2d.model : "";
  if (!rel) { report.errors.push("清单里没有模型文件路径"); return report; }
  const full = at(rel);
  if (!exists(full)) { report.errors.push(`模型文件不存在：${rel}`); return report; }

  let doc;
  try {
    doc = readJson(full);
  } catch (e) {
    report.errors.push(`模型文件读不了：${e.message}`);
    return report;
  }
  report.modelPath = rel;
  report.model3 = doc;

  const fr = doc.FileReferences || {};
  // Moc 可能带子目录，也可能就是同目录文件名
  const mocRel = typeof fr.Moc === "string" ? fr.Moc : "";
  const mocFull = mocRel ? at(M.resolveResource(manifest, mocRel)) : "";
  if (mocFull && exists(mocFull)) {
    report.moc = mocRel;
    report.mocBytes = sizeOf(mocFull);
  } else {
    report.errors.push("找不到 .moc3 模型本体（FileReferences.Moc）");
  }

  // 贴图：Cubism 的 Textures 数组是权威来源；清单里的 count 只是给「重载时替换」用的缓存提示
  const texArr = Array.isArray(fr.Textures) ? fr.Textures : [];
  for (const t of texArr) {
    if (typeof t !== "string") continue;
    const r = M.resolveResource(manifest, t);
    const f = r ? at(r) : "";
    const b = f ? sizeOf(f) : 0;
    report.textures.push({ path: r || t, bytes: b, missing: !b });
    if (!b) report.warnings.push(`贴图缺失：${t}`);
  }
  if (!texArr.length) report.warnings.push("模型没有声明任何贴图");

  const phyRel = typeof fr.Physics === "string" ? fr.Physics : "";
  if (phyRel) {
    const r = M.resolveResource(manifest, phyRel);
    if (r && exists(at(r))) report.physics = r;
    else report.warnings.push(`物理文件声明了但不存在：${phyRel}`);
  }

  // 动作时长：动作库面板要显示「几秒」，渲染端也要按它算参数锁的 TTL。
  // 不整份 parse —— motion3 可能很大，而 Meta 只占最后几百字节。
  // 取头尾各 4KB 抠 Duration，抠不到就留 0（播放器自己会再算一遍）。
  const motionDuration = (file) => {
    try {
      // 已声明的动作传的是包内相对路径，扫描出来的传的是绝对路径；
      // path.join(包目录, "C:\...") 会拼成不存在的路径，统一在这里归一。
      const full2 = path.isAbsolute(file) ? file : at(file);
      const st2 = fs.statSync(full2);
      const fd = fs.openSync(full2, "r");
      const headLen = Math.min(4096, st2.size);
      const head = Buffer.alloc(headLen);
      fs.readSync(fd, head, 0, headLen, 0);
      let text = head.toString("utf8");
      if (st2.size > headLen) {
        const tailLen = Math.min(4096, st2.size - headLen);
        const tail = Buffer.alloc(tailLen);
        fs.readSync(fd, tail, 0, tailLen, st2.size - tailLen);
        text += tail.toString("utf8");
      }
      fs.closeSync(fd);
      const mm = text.match(/"Duration"\s*:\s*([0-9.]+)/);
      return mm ? Number(mm[1]) || 0 : 0;
    } catch (e) { return 0; }
  };
  // 动作
  const mot = fr.Motions && typeof fr.Motions === "object" ? fr.Motions : {};
  for (const g of Object.keys(mot)) {
    const list = Array.isArray(mot[g]) ? mot[g] : [];
    report.motions[g] = list.length;
    for (let i = 0; i < list.length; i++) {
      const item = list[i] || {};
      const file = typeof item.File === "string" ? M.resolveResource(manifest, item.File) : "";
      report.motionFiles.push({
        group: g, index: i, file,
        bytes: file ? sizeOf(at(file)) : 0,
        fadeIn: Number(item.FadeInTime) || 0,
        fadeOut: Number(item.FadeOutTime) || 0,
        loop: item.Loop !== false,
        duration: file ? motionDuration(file) : 0,
        declared: true,
      });
    }
  }
  if (!Object.keys(report.motions).length) report.warnings.push("模型没有自带任何动作");

  // 表情
  const exp = Array.isArray(fr.Expressions) ? fr.Expressions : [];
  for (const e of exp) {
    if (!e || typeof e.Name !== "string") continue;
    const file = typeof e.File === "string" ? M.resolveResource(manifest, e.File) : "";
    report.expressions.push({ name: e.Name, file, bytes: file ? sizeOf(at(file)) : 0 });
  }

  // ── 扫目录：把「文件存在但没在清单里登记」的动作/表情收进来 ──────────
  // 素材站上的模型经常是半成品：motions/ 里躺着 motion3，model3.json 的
  // FileReferences 却没有 Motions 字段（作者导出时清空过，或者干脆是别的工具
  // 生成的骨架）。引擎只认声明，所以这些文件在旧版里等于不存在 —— 用户明明
  // 看见文件夹里有一堆动作，桌宠却永远只有待机，还会以为导入坏了。
  // 这里把它们标成 declared:false：动作走程序自己的曲线播放器（motion3.js），
  // 表情走现有的 exp3 叠加器，都不依赖引擎 registry。
  const modelDir = path.dirname(full);
  const knownMot = new Set(report.motionFiles.map((m) => String(m.file || "").toLowerCase()));
  const knownExp = new Set(report.expressions.map((e) => String(e.file || "").toLowerCase()));
  const extraMot = [];
  const extraExp = [];
  const scanDirs = (dir, depth) => {
    if (depth > 3) return;
    let list = [];
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const it of list) {
      if (it.name.startsWith(".") || it.name === "__MACOSX") continue;
      const fp = path.join(dir, it.name);
      if (it.isDirectory()) { scanDirs(fp, depth + 1); continue; }
      if (!it.isFile()) continue;
      if (/\.motion3\.json$/i.test(it.name)) extraMot.push(fp);
      else if (/\.exp3\.json$/i.test(it.name)) extraExp.push(fp);
    }
  };
  scanDirs(modelDir, 0);

  const modelBase = path.basename(modelDir);
  let undeclared = 0;
  for (const fp of extraMot) {
    const relP = relOf(fp);
    if (knownMot.has(relP.toLowerCase())) continue;
    if (report.motionFiles.length >= 400) { report.warnings.push("动作文件超过 400 个，只收前 400 个"); break; }
    // 组名：优先用所在文件夹（motions/idle.motion3.json → "motions"），
    // 文件夹就是模型根时用文件名，避免所有动作都挤进同一组。
    const parent = path.basename(path.dirname(fp));
    let group = parent && parent !== modelBase ? parent : path.basename(fp).replace(/\.motion3\.json$/i, "");
    if (!group) group = "motions";
    const idx = report.motions[group] || 0;
    report.motions[group] = idx + 1;
    report.motionFiles.push({
      group, index: idx, file: relP,
      bytes: sizeOf(fp), fadeIn: 0, fadeOut: 0, loop: false,
      duration: motionDuration(fp), declared: false,
    });
    undeclared += 1;
  }
  for (const fp of extraExp) {
    if (report.expressions.length >= 400) break;
    const relP = relOf(fp);
    if (knownExp.has(relP.toLowerCase())) continue;
    const name = path.basename(fp).replace(/\.exp3\.json$/i, "");
    report.expressions.push({ name, file: relP, bytes: sizeOf(fp), declared: false });
    undeclared += 1;
  }
  if (undeclared) {
    report.warnings.push(`有 ${undeclared} 个动作/表情文件没有在模型清单里声明，已自动收进素材库（可以直接在适配器里试播和绑定）`);
  }
  report.undeclared = undeclared;

  // 分组（眨眼/口型）—— 这两个是引擎自动驱动用的，名字写错会「眨眼失效」且不报错。
  // Cubism 3 的 Groups 是数组 [{Target,Name,Ids}]，但网上流传的改版模型里也有写成对象的，
  // 两种都认，顺便记下全部组名，体检时能提示「你写的是 EyeBlink，模型里叫 Eyes」。
  const groupsRaw = doc.Groups;
  const groupList = [];
  if (Array.isArray(groupsRaw)) {
    for (const g of groupsRaw) {
      if (!g || typeof g.Name !== "string") continue;
      groupList.push({ name: g.Name, target: String(g.Target || ""), ids: (Array.isArray(g.Ids) ? g.Ids : []).filter((x) => typeof x === "string") });
    }
  } else if (groupsRaw && typeof groupsRaw === "object") {
    for (const k of Object.keys(groupsRaw)) {
      const ids = Array.isArray(groupsRaw[k]) ? groupsRaw[k] : [];
      groupList.push({ name: k, target: "", ids: ids.filter((x) => typeof x === "string") });
    }
  }
  report.groupList = groupList;
  const pick = (name) => {
    const g = groupList.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
    return g ? g.ids.slice() : [];
  };
  report.groups.eyeBlink = pick("EyeBlink");
  report.groups.lipSync = pick("LipSync");

  // 命中区域（有些模型自带，有些没有）。本程序用的是按模型框相对高度分区，
  // 不依赖它；这里只做记录，方便以后加「按命中区域交互」时直接用。
  const hit = Array.isArray(doc.HitAreas) ? doc.HitAreas : [];
  report.hitAreas = hit.filter((h) => h && typeof h.Id === "string").map((h) => h.Id);

  // cdi3 字典：有它才有中文名和部件名，没有也能跑，只是界面显示参数 id
  const cdi = findCdi3(packDir, rel, typeof fr.Moc === "string" ? fr.Moc : "", fb);
  if (cdi) {
    report.cdi3 = relOf(cdi);
    try {
      const d = readJson(cdi, 16 * 1024 * 1024);
      const ps = Array.isArray(d.Parameters) ? d.Parameters : [];
      report.params = ps
        .filter((p) => p && typeof p.Id === "string")
        .map((p, i) => ({
          id: p.Id,
          name: typeof p.Name === "string" ? p.Name : "",
          group: typeof p.GroupId === "string" ? p.GroupId : "",
          order: i,
        }));
      const pgs = Array.isArray(d.ParameterGroups) ? d.ParameterGroups : [];
      report.paramGroups = pgs
        .filter((g) => g && typeof g.Id === "string")
        .map((g) => ({ id: g.Id, name: typeof g.Name === "string" ? g.Name : "", count: Number(g.Id) || 0 }));
      const parts = Array.isArray(d.Parts) ? d.Parts : [];
      report.parts = parts.filter((p) => p && typeof p.Id === "string").map((p) => p.Id);
    } catch (e) {
      report.warnings.push(`cdi3 解析失败（不影响使用）：${e.message}`);
    }
  } else {
    report.warnings.push("没有 cdi3 字典 —— 参数只能显示 id，仍然可用");
  }

  // ---- 自动匹配 ----
  const ids = report.params.map((p) => p.id);
  const lowerIds = ids.map((id) => id.toLowerCase());
  const params = {};
  for (const slot of sem.PARAM_SLOTS) {
    const cands = sem.candidates(slot);
    let hit = "";
    for (const c of cands) {
      const i = lowerIds.indexOf(String(c).toLowerCase());
      if (i >= 0) { hit = ids[i]; break; }
    }
    if (!hit) {
      const fz = fuzzyParam(slot.id, ids);
      if (fz.length) hit = fz[0];
    }
    params[slot.id] = hit ? [hit] : [];
    if (hit) report.matched.params++;
  }
  report.matched.paramsTotal = sem.PARAM_SLOTS.length;
  report.guesses.params = params;

  // 动作：有 idle 组就直接指过去，其余留空（内置库默认就能跑）
  const actions = {};
  for (const slot of sem.ACTION_SLOTS) {
    actions[slot.id] = { engine: "builtin", scene: slot.scene };
  }
  if (report.motions.idle) actions.idle = { engine: "model", motion: "idle", index: 0 };
  report.guesses.actions = actions;

  // 表情：先用 canon，再模糊
  const names = report.expressions.map((e) => e.name);
  const expMap = {};
  for (const slot of sem.EXPR_SLOTS) {
    let hit = "";
    const i = names.findIndex((n) => n.toLowerCase() === String(slot.canon || "").toLowerCase());
    if (i >= 0) hit = names[i];
    if (!hit) hit = fuzzyExpr(slot.id, names);
    expMap[slot.id] = hit;
  }
  report.guesses.expressions = expMap;

  report.ok = !!report.moc && report.textures.some((t) => !t.missing);
  if (!report.ok) {
    if (!report.moc) report.errors.push("模型本体缺失");
    if (!report.textures.some((t) => !t.missing)) report.errors.push("没有任何可用贴图");
  }
  return report;
}

module.exports = { probe, findCdi3, readJson, fuzzyParam, fuzzyExpr, EXPR_HINTS, FUZZY };
