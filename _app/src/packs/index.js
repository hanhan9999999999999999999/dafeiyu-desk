// 适配器内核的统一入口。server 只跟这个对象说话，不直接碰 store/rules/probe。
//
// 分层：
//   store   磁盘（哪几个包、读、写、导入、删）
//   probe   结构（模型里有什么）
//   rules   可扩展点（要配哪些东西、怎么校验）
//   doctor  结论（能不能用、还差什么）
// 这一层负责把它们串起来，顺便管「当前用哪个包」。
const path = require("path");
const fs = require("fs");
const { PackStore, makeIdFrom, LIMITS } = require("./store");
const { RuleRegistry } = require("./rules");
const { loadBuiltin, customRefs, invalidate: invalidateBuiltin } = require("./builtin");
const { probe } = require("./probe");
const { diagnose } = require("./doctor");
const M = require("./manifest");
const sem = require("./semantics");
const TUNING = require("./rules/70-tuning");

// 「空」的判定：空串 / null / 空数组 / 空对象都算没设置。
// 清单里「没写」和「写了空值」在这个 schema 里语义相同（= 用默认），合并安全。
function isBlank(v) {
  if (v === undefined || v === null || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

// 保存值优先，空的用探测建议补 —— 用户第一次打开适配器时不该看到一整屏空白下拉。
function mergeCfg(saved, suggest) {
  if (isBlank(saved)) return suggest ? JSON.parse(JSON.stringify(suggest)) : {};
  if (!suggest || typeof suggest !== "object") return saved;
  const out = JSON.parse(JSON.stringify(suggest));
  for (const k of Object.keys(saved)) {
    if (!isBlank(saved[k])) out[k] = saved[k];
  }
  return out;
}

class ModelAdapter {
  /**
   * @param {object} o
   * @param {string} o.root        程序资源根（内置模型在 <root>/model）
   * @param {string} o.userDir     用户模型目录
   * @param {string} o.motionsFile 内置动作库 src/motions.js
   * @param {Function} [o.getSettings]
   * @param {Function} [o.patchSettings]
   * @param {Function} [o.log]
   */
  constructor(o) {
    const opts = o || {};
    this.log = typeof opts.log === "function" ? opts.log : () => {};
    this.builtinDir = opts.root ? path.join(opts.root, "model") : "";
    this.userDir = opts.userDir || "";
    this.motionsFile = opts.motionsFile || "";
    this.getSettings = typeof opts.getSettings === "function" ? opts.getSettings : () => ({});
    this.patchSettings = typeof opts.patchSettings === "function" ? opts.patchSettings : () => {};

    this.store = new PackStore({ builtinDir: this.builtinDir, userDir: this.userDir, log: this.log });
    this.rules = new RuleRegistry(path.join(__dirname, "rules"));
    this._builtinCache = null;
  }

  builtin() {
    const now = Date.now();
    if (this._builtinCache && now - this._builtinCache.at < 8000) return this._builtinCache.value;
    const v = loadBuiltin(this.motionsFile);
    this._builtinCache = { at: now, value: v };
    return v;
  }

  reloadRules() {
    const r = this.rules.reload();
    this._builtinCache = null;
    invalidateBuiltin();
    return r;
  }

  // ---------- 列表与详情 ----------

  list() {
    const active = this.activeId();
    return {
      active,
      builtinDir: this.builtinDir,
      userDir: this.userDir,
      packs: this.store.list().map((p) => Object.assign({ active: p.id === active }, p)),
    };
  }

  activeId() {
    const s = this.getSettings() || {};
    const want = String(s.activePack || "").trim();
    if (want) {
      const rec = this.store.read(want);
      if (rec) return want;
    }
    // 没设、或者设的包被删了 → 回退到第一个可用的（内置优先）
    const all = this.store.list();
    const first = all.find((p) => p.origin === "builtin") || all[0];
    return first ? first.id : "";
  }

  activate(id) {
    const rec = this.store.read(id);
    if (!rec) throw new Error("模型包不存在：" + id);
    // 只有配置、没有模型文件的包（升级后留下的孤儿覆盖层）先单独拦一道：
    // 否则体检只会报「缺 5 个参数没绑」，用户会以为是自己没适配对，实际是文件没了。
    if (rec.missingModel) {
      const err = new Error("这个模型包缺模型文件（只剩配置，没有 .moc3 / 贴图）— 重新导入完整模型后再应用");
      err.code = "PACK_MISSING_MODEL";
      throw err;
    }
    // 切之前先体检：模型文件/贴图缺失这类包切过去是「桌宠直接消失」，
    // 用户只看到人不见了，不知道发生了什么。闸门放在这里，IPC 和 HTTP 两条路都拦得住。
    const d = this.diagnose(id);
    if (d && d.verdict === "broken") {
      const err = new Error("这个模型还不能用 — " + (d.headline || "体检没通过"));
      err.code = "PACK_BROKEN";
      throw err;
    }
    this.patchSettings({ activePack: id });
    return this.getManifest(id);
  }

  // 渲染端只需要「当前模型怎么加载、怎么动」这一份最小信息。
  // 它不能拿到清单原文 —— 清单里可能是空的（靠探测建议补），也可能用规则表达
  // （builtin:xxx / model:xxx），渲染端每次都要自己解释一遍就太脏了。
  // 所以这里直接把规则解释完，输出「查表即用」的视图。
  getManifest(id) {
    const want = id || this.activeId();
    const rec = this.store.read(want);
    if (!rec) return null;
    const r = this._resolve(want);
    const m = rec.manifest;
    const cfgs = r ? r.cfgs : {};
    const P = cfgs["core-params"] || {};
    const A = cfgs.actions || {};
    const E = cfgs.expressions || {};
    const L = cfgs.layout || {};
    const C = cfgs.capabilities || {};
    const I = cfgs.interaction || {};
    // 手感规则自带「默认值 + 范围收敛」，直接问它要归一化后的结果 ——
    // 渲染端不该再抄一遍 24/18/12 这些数字，抄了迟早和规则里的默认值对不上。
    const T = TUNING.read(m);

    const params = {};
    for (const s of sem.PARAM_SLOTS) if (P[s.id]) params[s.id] = String(P[s.id]);
    const aliases = {};
    const al = P.aliases || {};
    for (const k of Object.keys(al)) if (al[k]) aliases[k] = String(al[k]);

    // 动作：默认值也要展开，渲染端不该再写一遍「没配就用 idle」这种逻辑
    const actions = {};
    for (const s of sem.ACTION_SLOTS_ALL) actions[s.id] = sem.decodeAction(A[s.id], s);

    // 渲染端拿到的是「场景名」，不是槽 id（它调 actionFor("dshThinking") 而不是
    // actionFor("thinking")）。所以再给一张场景 → 路由的表，key 用槽的默认场景，
    // 这样即使适配器把某个槽改成播另一个场景，调用方传的仍然是原来的场景名。
    const sceneRoutes = {};
    for (const s of sem.ACTION_SLOTS_ALL) sceneRoutes[s.scene] = actions[s.id];

    // exp3 的文件名是模型作者随便起的，没法按规则拼，只能从探测报告带出去。
    // 渲染端要用它去 fetch 表情文件，把里面的参数值叠加进来。
    const expFiles = {};
    for (const e of (r && r.report ? r.report.expressions || [] : [])) {
      if (e && e.name) expFiles[e.name] = e.file;
    }

    const expMap = {};
    for (const s of sem.EXPR_SLOTS) {
      if (s.id === "default") continue;
      const v = E[s.id];
      expMap[s.id] = v ? String(v) : "";
    }

    // 内置 82 支曲线是照着 dafeiyu 的标准参数名写的。换模型后这些名字可能
    // 不叫这个（有人管竖直角度叫 ParamAngleZ），也可能根本不存在。
    // 与其让渲染端自己猜，这里直接算一张「曲线里写的名字 → 这台模型里的名字」的表，
    // 渲染端查不到就走「跳过这条曲线」的老逻辑。
    const paramMap = {};
    for (const s of sem.PARAM_SLOTS) {
      const target = params[s.id];
      if (!target) continue;
      if (s.canon) paramMap[s.canon] = target;
      for (const a of s.alts || []) paramMap[a] = target;
    }
    for (const k of Object.keys(aliases)) paramMap[k] = aliases[k];

    const tex = (r && r.report ? r.report.textures : []).map((t, i) => ({
      index: i,
      path: t.path,
      url: `/packs/${m.id}/${t.path}`,
      bytes: t.bytes,
      missing: !!t.missing,
    }));

    // 模型自带的动作/表情清单：适配器的「动作库」面板直接列出来，点一下就能播。
    // 之前这些只存在于探测报告里，界面上只能看到一个「有 3 组动作」的数字，
    // 用户根本不知道哪一组长什么样 —— 想选动作只能盲猜组名。
    const motionList = [];
    const mf = (r && r.report ? r.report.motionFiles : []) || [];
    for (const it of mf) {
      if (!it || !it.file) continue;
      motionList.push({
        group: it.group,
        index: it.index,
        file: it.file,
        duration: it.duration,
        declared: it.declared !== false,
      });
    }
    const exprList = (r && r.report ? r.report.expressions : []) || [];

    return {
      id: m.id,
      displayName: m.displayName,
      description: m.description,
      author: m.author,
      license: m.license,
      version: m.version,
      origin: rec.origin,
      writable: true,
      readonlyModel: !rec.writable,
      base: `/packs/${m.id}/`,
      // 缺模型的包不给 URL：渲染端拿到空 URL 会走「先给她找一个身体」，
      // 而不是拿一个注定 404 的地址重试三次再弹错误页。
      url: rec.missingModel ? "" : `/packs/${m.id}/${m.live2d.model}`,
      missingModel: !!rec.missingModel,
      model: m.live2d.model,
      textures: tex,
      params,
      paramMap,
      aliases,
      actions,
      sceneRoutes,
      expressions: {
        engine: E.engine || "auto",
        default: E.default || "",
        map: expMap,
        files: expFiles,
      },
      layout: {
        scale: (m.live2d.layout && m.live2d.layout.scale) || 1,
        viewY: Number(L.viewY) || 0.1,
        viewH: Number(L.viewH) || 0.5,
        offsetX: Number(L.offsetX) || 0,
        padding: Number(L.padding) || 0.02,
      },
      // 分组是模型自带的声明（model3.json 的 Groups），不是配置项 —— 从清单读，别从规则读
      groups: {
        eyeBlink: (m.live2d.groups && m.live2d.groups.eyeBlink) || "",
        lipSync: (m.live2d.groups && m.live2d.groups.lipSync) || "",
      },
      physics: C.physics !== false,
      tuning: T,
      motions: motionList,
      expressionList: exprList.map((e) => ({ name: e.name, file: e.file })),
      stats: {
        params: (r && r.report ? (r.report.params || []).length : 0),
        textures: tex.length,
        expressions: exprList.length,
        motions: motionList.length,
        motionGroups: new Set(motionList.map((x) => x.group)).size,
        bytes: tex.reduce((n, t) => n + (t.bytes || 0), 0),
      },
      interaction: {
        headLine: Number(I.headLine) || 0.42,
        faceLine: Number(I.faceLine) || 0.72,
        followX: I.followX == null ? 1 : Number(I.followX),
        followY: I.followY == null ? 1 : Number(I.followY),
        breathAmp: I.breathAmp == null ? 1 : Number(I.breathAmp),
      },
      probe: r && r.report ? {
        paramCount: (r.report.params || []).length,
        motionGroups: Object.keys(r.report.motions || {}),
        expressionCount: (r.report.expressions || []).length,
        hasCdi3: !!r.report.cdi3,
      } : null,
    };
  }

  // 统一解析：清单 + 探测 + 规则建议合并后的完整配置。
  // open / getManifest / diagnose / check 都走这里，保证「界面上看到的」和「渲染用的」是同一份值。
  _resolve(id) {
    const rec = this.store.read(id);
    if (!rec) return null;
    const report = probe(rec.dir, rec.manifest, { fallbackDir: rec.base });
    const builtin = this.builtin();
    const ctx = { manifest: rec.manifest, report, builtin };
    const saved = this.rules.readAll(rec.manifest);
    const suggest = this.rules.detectAll(ctx);
    const cfgs = {};
    for (const rid of Object.keys(suggest).concat(Object.keys(saved))) {
      if (rid in cfgs) continue;
      cfgs[rid] = mergeCfg(saved[rid], suggest[rid]);
    }
    for (const r of this.rules.rules) if (!(r.id in cfgs)) cfgs[r.id] = {};
    ctx.cfgs = cfgs;
    return { rec, report, builtin, cfgs, saved, suggest, ctx };
  }

  probe(id) {
    const r = this.store.probe(id);
    if (!r) return null;
    return Object.assign({}, r, {
      builtin: {
        scenes: Object.keys(this.builtin().scenes || {}),
        sceneActions: this.builtin().scenes || {},
        motionCount: this.builtin().actionCount || 0,
        paramRefs: this.builtin().paramRefs || [],
        customRefs: customRefs(this.builtin()),
      },
      semantics: {
        params: sem.PARAM_SLOTS, actions: sem.ACTION_SLOTS, activities: sem.ACTIVITY_SLOTS,
        expressions: sem.EXPR_SLOTS, required: { params: sem.REQUIRED_PARAMS, actions: sem.REQUIRED_ACTIONS, expressions: sem.REQUIRED_EXPRS },
      },
    });
  }

  // 一键「按探测结果填满」：导入时用一次，之后用户还能改
  autofill(id) {
    const rec = this.store.read(id);
    if (!rec) return null;
    const report = probe(rec.dir, rec.manifest, { fallbackDir: rec.base });
    const ctx = { manifest: rec.manifest, report, builtin: this.builtin() };
    const cfgs = this.rules.detectAll(ctx);
    this.rules.applyAll(rec.manifest, cfgs);
    rec.manifest.adapter.probedAt = new Date().toISOString();
    const saved = this.store.write(id, rec.manifest);
    return { manifest: saved, cfgs };
  }

  // 「推荐取景」：只重跑布局规则的 detect，不碰用户别的配置。
  // 取景窗并进适配器之后，这个按钮是「我拖乱了，给我一个像样的起点」的出口。
  recommendLayout(id) {
    const r = this._resolve(id);
    if (!r) throw new Error("模型包不存在：" + id);
    const rule = this.rules.get("layout");
    let cfg = {};
    try { cfg = (rule && rule.detect ? rule.detect(r.ctx) : {}) || {}; } catch (e) { cfg = {}; }
    return { id, cfg };
  }

  // ---------- 编辑与保存 ----------

  // 适配器保存：清单字段（id/名字等）+ 各规则的 cfg
  // 「恢复默认」= 从空清单重建一份，再跑一遍探测建议。
  // 不能直接在原清单上跑 detect —— 动作/表情规则在探测不到东西时返回 {}，apply 不动旧值，
  // 用户调乱的那些会留下来，看起来像「点了没反应」。
  resetConfig(id) {
    const rec = this.store.read(id);
    if (!rec) return null;
    const report = probe(rec.dir, rec.manifest, { fallbackDir: rec.base });
    const old = rec.manifest;
    const base = M.blank(id, (old.live2d && old.live2d.model) || this.store.findModel3(rec.dir));
    base.displayName = old.displayName || base.displayName;
    base.description = old.description || "";
    base.author = old.author || "";
    base.license = old.license || "";
    base.version = old.version || "1.0.0";
    base.adapter.origin = (old.adapter && old.adapter.origin) || "user";
    if (old.adapter && old.adapter.legacy) base.adapter.legacy = old.adapter.legacy;
    const ctx = { manifest: base, report, builtin: this.builtin() };
    const cfgs = this.rules.detectAll(ctx);
    this.rules.applyAll(base, cfgs);
    base.adapter.probedAt = new Date().toISOString();
    this.store.write(id, base);
    return this.open(id);
  }

  save(id, payload) {
    const rec = this.store.read(id);
    if (!rec) throw new Error("模型包不存在：" + id);
    const p = payload || {};
    const next = JSON.parse(JSON.stringify(rec.manifest));

    if (p.displayName != null) next.displayName = M.cleanName(p.displayName, 64) || next.id;
    if (p.description != null) next.description = M.cleanName(p.description, 500);
    if (p.author != null) next.author = M.cleanName(p.author, 120);
    if (p.license != null) next.license = M.cleanName(p.license, 2000);
    if (p.version != null) next.version = M.cleanName(p.version, 32) || "1.0.0";

    if (p.cfgs && typeof p.cfgs === "object") this.rules.applyAll(next, p.cfgs);
    if (p.interaction && typeof p.interaction === "object") {
      // 兼容：有的调用方直接给 interaction 对象
      this.rules.applyAll(next, { interaction: p.interaction });
    }
    next.adapter.probedAt = next.adapter.probedAt || new Date().toISOString();

    const saved = this.store.write(id, next);
    return saved;
  }

  // 读给界面的完整状态：清单 + 各规则当前值 + 探测报告 + 体检
  open(id) {
    const r = this._resolve(id);
    if (!r) return null;
    const ruleIssues = this.rules.validateAll(r.ctx);
    const doc = diagnose({
      manifest: r.rec.manifest, report: r.report, builtin: r.builtin, ruleIssues, cfgs: r.cfgs,
      missingModel: !!r.rec.missingModel,
    });
    return {
      id: r.rec.manifest.id,
      origin: r.rec.origin,
      writable: true,
      readonlyModel: !r.rec.writable,
      missingModel: !!r.rec.missingModel,
      dir: r.rec.dir,
      manifest: r.rec.manifest,
      report: r.report,
      cfgs: r.cfgs,
      saved: r.saved,
      suggest: r.suggest,
      schema: this.rules.schema(),
      diagnose: doc,
      builtin: {
        scenes: r.builtin.scenes,
        motionCount: r.builtin.actionCount,
        customRefs: customRefs(r.builtin),
      },
    };
  }

  diagnose(id) {
    const r = this._resolve(id);
    if (!r) return null;
    return diagnose({
      manifest: r.rec.manifest, report: r.report, builtin: r.builtin,
      ruleIssues: this.rules.validateAll(r.ctx), cfgs: r.cfgs,
      missingModel: !!r.rec.missingModel,
    });
  }

  // ---------- 包管理 ----------

  importDir(srcDir, opts) { return this.store.importDir(srcDir, opts); }
  importArchive(zipPath, opts) { return this.store.importArchive(zipPath, opts); }
  duplicate(id, newId) { return this.store.duplicate(id, newId); }

  // 统一入口：目录或 zip 都行。界面上「选文件夹」和「选压缩包」走的是同一条
  // 检查-导入流程，只是解包那一步不同 —— 校验结论必须长得一模一样，
  // 否则用户会以为压缩包导入是另一套功能、少了一些检查。
  inspectPath(p) {
    const target = String(p || "").trim();
    if (!target) return { ok: false, error: "没有给路径" };
    let st = null;
    try { st = fs.statSync(target); } catch (e) { return { ok: false, error: "路径不存在：" + target }; }
    if (st.isDirectory()) return this.inspectDir(target);
    if (!/\.zip$/i.test(target)) {
      return { ok: false, error: "只支持文件夹和 .zip；其它压缩格式请先解压（rar/7z 需要自己装解压软件）" };
    }
    const zip = require("./zip");
    if (!zip.isZipFile(target)) return { ok: false, error: "这个文件不是有效的 ZIP" };
    const os = require("os");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dafeiyu-check-"));
    try {
      const zs = zip.extractZip(target, tmp);
      let src = tmp;
      if (!this.store.findModel3(src)) {
        const subs = fs.readdirSync(tmp, { withFileTypes: true }).filter((e) => e.isDirectory());
        if (subs.length === 1) {
          const inner = path.join(tmp, subs[0].name);
          if (this.store.findModel3(inner)) src = inner;
        }
      }
      const out = this.inspectDir(src);
      return Object.assign({}, out, {
        // 临时目录里的路径对用户没意义，界面上要显示压缩包本身
        dir: path.resolve(target),
        archive: {
          name: path.basename(target),
          zipBytes: st.size,
          files: zs.files,
          unpacked: zs.bytes,
          skipped: zs.skipped.slice(0, 12),
        },
      });
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
    }
  }

  remove(id) {
    const active = this.activeId();
    const ok = this.store.remove(id);
    if (ok && active === id) {
      const next = this.store.list()[0];
      this.patchSettings({ activePack: next ? next.id : "" });
    }
    return ok;
  }

  // 检查一个外部目录能不能导入。这是导入前的「看一眼」，只读，不碰磁盘。
  //
  // 用户手上的模型千奇百怪：可能整个文件夹就是一个包，也可能是「下载解压出来一层
  // 套一层」，还可能带着 psd、cmo3 这些工程文件。所以这里不假设结构，直接把选中的
  // 目录当包根去探；探不到 model3 就报清楚，而不是导入一半才失败。
  inspectDir(dir) {
    const d = String(dir || "").trim();
    if (!d) return { ok: false, error: "没有给目录" };
    let st = null;
    try { st = fs.statSync(d); } catch (e) { return { ok: false, error: "目录不存在：" + d }; }
    if (!st.isDirectory()) return { ok: false, error: "这不是文件夹，模型要选「文件夹」" };

    const model = this.store.findModel3(d);
    if (!model) {
      return { ok: false, error: "这个文件夹里找不到 .model3.json —— Live2D 模型清单文件，确认选的是模型目录" };
    }

    // id 与显示名要和真正导入时的那套规则一致，否则界面显示「model-2」、
    // 导进来变成「dafeiyu」，用户会以为导错了包。
    const base = path.basename(path.resolve(d)) || "pack";
    let id = makeIdFrom(path.basename(model));
    if (!id || !M.ID_RE.test(id)) id = makeIdFrom(base);
    const clash = !!this.store.dirOf(id);

    const generic = /^(model|models|live2d|live2dmodel|pack|assets?|resource|resources|new folder|新建文件夹)$/i;
    const nameGuess = generic.test(base) ? path.basename(model).replace(/\.model3\.json$/i, "") : base;

    const manifest = M.blank(id, model);
    manifest.displayName = String(nameGuess).slice(0, 60);

    const report = probe(d, manifest);

    // 体积与文件数：导入前要告诉用户「会占多少」。同步遍历，但设上限
    // （一个模型目录通常几十个文件；真遇到 node_modules 之类可以早停）。
    let bytes = 0;
    let files = 0;
    let stopped = false;
    const walk = (p, depth) => {
      if (stopped) return;
      let list = [];
      try { list = fs.readdirSync(p, { withFileTypes: true }); } catch (e) { return; }
      for (const it of list) {
        if (stopped) return;
        if (files >= LIMITS.files || depth > LIMITS.depth) { stopped = true; return; }
        const full = path.join(p, it.name);
        if (it.isDirectory()) {
          if (/^(\.git|\.svn|__MACOSX|node_modules|\.idea|\.vscode)$/.test(it.name)) continue;
          walk(full, depth + 1);
        } else if (it.isFile()) {
          files += 1;
          try { bytes += fs.statSync(full).size; } catch (e) { }
        }
      }
    };
    walk(path.resolve(d), 1);

    const issues = [];
    const push = (level, message) => issues.push({ level, message });
    for (const e of report.errors || []) push("error", e);
    for (const w of report.warnings || []) push("warn", w);
    if (!report.textures || !report.textures.length) push("error", "模型里一张贴图都没有，导入了也是空白");
    if (!report.moc) push("error", "找不到 .moc3 文件（模型本体），模型清单指向的文件不在");
    if (!report.params || !report.params.length) push("error", "读不到参数表，导入后什么都绑不了");
    if (!report.expressions || !report.expressions.length) push("info", "这个模型没有表情文件，表情会退回参数组合");
    if (!report.groupList || !report.groupList.length) push("info", "没有分组信息（眨眼/口型要靠手动选）");
    if (clash) push("warn", "已经有一个同 id 的模型包「" + id + "」，导入会换一个 id 或者覆盖它");
    if (bytes > LIMITS.totalBytes) push("error", "这个目录 " + Math.round(bytes / 1048576) + "MB，超过单个包的上限");
    if (stopped) push("warn", "文件太多，只统计了一部分");

    const canImport = !issues.some((i) => i.level === "error");

    return {
      ok: true,
      dir: path.resolve(d),
      id,
      suggestId: id,
      name: manifest.displayName,
      model,
      canImport,
      clash,
      bytes,
      files,
      issues,
      report: {
        params: (report.params || []).length,
        paramsNamed: (report.params || []).filter((p) => p.name).length,
        motions: report.motions || {},
        motionFiles: (report.motionFiles || []).length,
        expressions: (report.expressions || []).length,
        textures: (report.textures || []).length,
        parts: (report.parts || []).length,
        mocBytes: report.mocBytes || 0,
        groups: (report.groupList || []).length,
      },
    };
  }

  check(id) {
    const rec = this.store.read(id);
    if (!rec) return null;
    return this.store.check(id);
  }

  // 导出成可分发的最小包信息（不含模型文件本身，避免违反模型授权）
  exportManifest(id) {
    const rec = this.store.read(id);
    if (!rec) return null;
    const m = JSON.parse(JSON.stringify(rec.manifest));
    m.adapter.origin = "exported";
    return m;
  }
}

module.exports = { ModelAdapter, sem, M };
