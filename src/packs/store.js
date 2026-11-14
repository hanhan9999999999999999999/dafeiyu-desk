// 包仓库：内置模型 + 用户模型，统一成一套读写接口。
//
// 目录约定：
//   内置  <root>/model/            只读，随程序分发，授权通常禁止再分发 → 所以它只有一个
//   用户  %APPDATA%/大肥鱼/models/  可导入、可编辑、可删除；商业发行时用户自己往里放模型
//
// 两种布局都要支持：
//   · 内置目录**本身就是**一个包（历史原因：model/ 下就是 dafeiyu 的 moc3/tex/mot）
//   · 目录下每个子文件夹是一个包（用户目录的标准布局）
// 靠「根目录里有没有 .model3.json」自动判断，不需要额外配置。
//
// 为什么不在原地改内置包：
//   内置包在 asar / resources 里，打包后是只读的；而且用户改坏了没法恢复。
//   想改内置模型 → 「复制为用户包」，之后所有编辑都落在用户区。
const fs = require("fs");
const os = require("os");
const path = require("path");
const M = require("./manifest");
const { probe } = require("./probe");
const { extractZip, isZipFile } = require("./zip");

// 用户输入问题（选错目录、不是 zip、包里没模型）统一带 400：
// 前端和日志能分清「用户点错了」和「服务真的炸了」。
function badRequest(message) {
  const e = new Error(message);
  e.statusCode = 400;
  return e;
}

const LIMITS = {
  files: 4000,
  totalBytes: 1.2 * 1024 * 1024 * 1024,   // 模型体积本来就大，给 1.2G 上限
  fileBytes: 240 * 1024 * 1024,
  depth: 6,
};

// 哪些文件值得复制：模型本体、表情、物理、贴图、音频（有些模型带动效音）
// 其余（.git / .DS_Store / 预览图 / 源文件 .cmo3 .psd / 备份）一律跳过 ——
// 用户从素材站下载的包里经常塞着几百兆的 psd 和制作文件，复制它们纯属浪费。
const SKIP_EXT = new Set([
  ".cmo3", ".can3", ".psd", ".psb", ".clip", ".ai", ".xcf", ".blend", ".max", ".fbx",
  ".zip", ".rar", ".7z", ".tar", ".gz", ".exe", ".msi", ".dmg",
]);
const SKIP_DIR = new Set([".git", ".svn", "__MACOSX", "node_modules", ".idea", ".vscode", "previews", "preview"]);

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function relOf(root, full) {
  return path.relative(root, full).replace(/\\/g, "/");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function listDirSafe(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

function makeIdFrom(name) {
  const base = String(name || "model")
    .replace(/\.model3\.json$/i, "")
    .replace(/\.[a-z0-9]+$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return M.ID_RE.test(base) ? base : "model";
}

class PackStore {
  /**
   * @param {{builtinDir?: string, userDir?: string, log?: Function}} opts
   */
  constructor(opts) {
    const o = opts || {};
    this.builtinDir = o.builtinDir ? path.resolve(o.builtinDir) : "";
    this.userDir = o.userDir ? path.resolve(o.userDir) : "";
    this.log = typeof o.log === "function" ? o.log : () => {};
    this._cache = new Map();      // id -> {at, manifest}
    this._cacheMs = 1500;
  }

  roots() {
    return [
      { origin: "builtin", dir: this.builtinDir, writable: false },
      { origin: "user", dir: this.userDir, writable: true },
    ].filter((r) => r.dir);
  }

  // 这个目录本身是不是一个模型包（而不是「装着一堆包」的库）
  _isPackDir(dir, depth = 0) {
    const files = listDirSafe(dir);
    if (files.some((e) => e.isFile() && /\.model3\.json$/i.test(e.name))) return true;
    if (depth >= 1) return false;
    // 素材站下载的包常见多套一层同名目录：model/xxx/xxx.model3.json
    for (const s of files) {
      if (s.isDirectory() && !SKIP_DIR.has(s.name)) {
        if (this._isPackDir(path.join(dir, s.name), depth + 1)) return true;
      }
    }
    return false;
  }

  _builtinId() {
    if (!this.builtinDir) return "";
    const pet = path.join(this.builtinDir, "pet.json");
    if (isFile(pet)) {
      try {
        const j = readJson(pet);
        if (M.ID_RE.test(String(j.id || ""))) return j.id;
      } catch { /* 坏掉的清单不影响取 id，下面兜底 */ }
    }
    return makeIdFrom(path.basename(this.builtinDir));   // 目录名 "model" → "model"
  }

  // 内置根是单包 → 只有一个内置包；否则按子目录扫
  _builtinPacks() {
    if (!this.builtinDir) return [];
    if (this._isPackDir(this.builtinDir)) {
      return [{ id: this._builtinId(), dir: this.builtinDir, origin: "builtin", writable: false, single: true }];
    }
    const out = [];
    for (const ent of listDirSafe(this.builtinDir)) {
      if (!ent.isDirectory() || !M.ID_RE.test(ent.name)) continue;
      out.push({ id: ent.name, dir: path.join(this.builtinDir, ent.name), origin: "builtin", writable: false, single: false });
    }
    return out;
  }

  // 遍历内置与用户目录，按目录名当 id。用户包和内置包同名时用户包优先（可以覆盖/修内置包）。
  scan() {
    const found = new Map();
    for (const p of this._builtinPacks()) found.set(p.id, p);
    if (this.userDir) {
      for (const ent of listDirSafe(this.userDir)) {
        if (!ent.isDirectory() || !M.ID_RE.test(ent.name)) continue;
        const id = ent.name;
        // 用户目录里出现和内置包同名的包，是「本机配置覆盖内置」——
        // 用户在内置模型上调了几个参数，保存时派生出来的。它不是「另一个模型」，
        // 界面上要能分开：一个是「大肥鱼」，一个是「大肥鱼 · 本机配置」。
        const origin = found.has(id) ? "override" : "user";
        found.set(id, { id, dir: path.join(this.userDir, id), origin, writable: true, single: false, overrides: origin === "override" });
      }
    }
    return Array.from(found.values());
  }

  dirOf(id) {
    if (!M.ID_RE.test(String(id || ""))) return null;
    const user = this.userDir && path.join(this.userDir, id);
    const b = this._builtinPacks().find((p) => p.id === id);
    if (user && isDir(user)) {
      // 同名内置包存在 → 这是「本机配置覆盖内置」，不是用户导入的新模型。
      // dirOf 是 read/probe/open 的唯一入口，这里不区分的话，
      // 适配器列表显示「本机配置」、点进去却变成「自建」，前后不一致。
      return { dir: user, origin: b ? "override" : "user", writable: true, base: b ? b.dir : "" };
    }
    if (b) return { dir: b.dir, origin: "builtin", writable: false, base: "" };
    return null;
  }

  // 读一个包的清单。没有 pet.json 也不要紧 —— 现场根据 model3 生成一份裸清单，
  // 让「只丢了一个模型文件夹」的用户也能直接用（这是最常见的导入方式）。
  read(id) {
    const hit = this.dirOf(id);
    if (!hit) return null;
    const now = Date.now();
    const cached = this._cache.get(id);
    if (cached && now - cached.at < this._cacheMs && cached.dir === hit.dir) return cached.manifest;

    const petFile = path.join(hit.dir, "pet.json");
    let manifest = null;
    if (isFile(petFile)) {
      try {
        manifest = M.sanitize(readJson(petFile));
      } catch (e) {
        this.log(`[packs] ${id} 的 pet.json 解析失败：${e.message}`);
      }
    }
    // 覆盖层只存 pet.json，模型本体仍在安装目录 —— 两处都要找
    const findM3 = () => this.findModel3(hit.dir) || (hit.base ? this.findModel3(hit.base) : "");
    if (!manifest) manifest = M.blank(id, findM3());
    manifest.id = id;
    if (!manifest.live2d.model) manifest.live2d.model = findM3();

    // 1.1.0 起安装包不再带模型：老用户的 models/<id>/pet.json 可能只剩一份配置，
    // 模型文件已经随旧安装目录一起没了。这里先把「文件到底在不在」查清楚，
    // 免得上层拼出一个 404 的 URL，让渲染端反复重试。
    const modelRel = String((manifest.live2d && manifest.live2d.model) || "");
    const missingModel = !modelRel || !isFile(path.join(hit.dir, modelRel));

    const out = { manifest, dir: hit.dir, origin: hit.origin, writable: hit.writable, base: hit.base || "", missingModel };
    this._cache.set(id, { at: now, dir: hit.dir, manifest: out });
    return out;
  }

  // 在包目录里找 .model3.json：优先根目录，其次一层子目录（素材站下载常多包一层）
  findModel3(dir, depth = 0) {
    const files = listDirSafe(dir);
    const direct = files.filter((e) => e.isFile() && /\.model3\.json$/i.test(e.name));
    if (direct.length) return direct[0].name;
    if (depth >= 2) return "";
    const subs = files.filter((e) => e.isDirectory() && !SKIP_DIR.has(e.name));
    for (const s of subs) {
      const r = this.findModel3(path.join(dir, s.name), depth + 1);
      if (r) return relOf(dir, path.join(dir, s.name, r));
    }
    return "";
  }

  list() {
    const out = [];
    for (const hit of this.scan()) {
      const rec = this.read(hit.id);
      if (!rec) continue;
      const m = rec.manifest;
      const v = M.validate(m);
      out.push({
        id: m.id,
        displayName: m.displayName,
        version: m.version,
        author: m.author,
        origin: rec.origin,
        writable: rec.writable,
        dir: rec.dir,
        model: m.live2d.model,
        renderer: m.renderer,
        // 列表里就要标出「缺模型文件」：用户升级后留下的孤儿覆盖层光看名字看不出来，
        // 点进去才发现不能应用，会以为是适配器坏了。
        missingModel: !!rec.missingModel,
        ok: v.ok,
        issues: v.issues,
      });
    }
    out.sort((a, b) => (a.origin === b.origin ? a.displayName.localeCompare(b.displayName, "zh") : a.origin === "builtin" ? -1 : 1));
    return out;
  }

  // 探测（读结构，不加载引擎）
  probe(id) {
    const rec = this.read(id);
    if (!rec) return null;
    const report = probe(rec.dir, rec.manifest, { fallbackDir: rec.base });
    return { id, origin: rec.origin, dir: rec.dir, base: rec.base || "", manifest: rec.manifest, report };
  }

  write(id, manifest) {
    if (!M.ID_RE.test(String(id || ""))) throw badRequest("非法 id");
    if (!this.userDir) throw new Error("没有配置用户模型目录");
    const dir = path.join(this.userDir, id);
    if (!isDir(dir)) fs.mkdirSync(dir, { recursive: true });
    const clean = M.sanitize(Object.assign({}, manifest, { id }));
    // 原子写：先写 .tmp 再 rename，断电不会留下半个 json 把包读崩
    const file = path.join(dir, "pet.json");
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(clean, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, file);
    this._cache.delete(id);
    this.log(`[packs] 写入 ${id}/pet.json`);
    return clean;
  }

  // 从外部目录导入。返回 {id, dir, report, manifest, skipped}
  importDir(srcDir, opts) {
    const o = opts || {};
    if (!isDir(srcDir)) throw badRequest("源目录不存在");
    if (!this.userDir) throw new Error("没有配置用户模型目录");
    fs.mkdirSync(this.userDir, { recursive: true });

    const model3 = o.model3 || this.findModel3(srcDir);
    if (!model3) throw badRequest("这个目录里找不到 .model3.json —— 请选择包含模型文件的文件夹");

    // id 优先用用户选的那个文件夹/压缩包内层目录名：
    // 很多模型的文件就叫 model.model3.json，用它当 id 会得到一串「model」「model-2」。
    const srcName = path.basename(srcDir || "");
    let id = o.id ? makeIdFrom(o.id) : makeIdFrom(srcName && srcName !== "." ? srcName : path.basename(model3));
    // id 去重：已存在就加后缀，除非明确要求覆盖。
    // 这里用 dirOf 而不是只看 userDir —— 用户目录和内置目录同名时，用户包会遮蔽
    // 内置包（这是「覆盖内置模型」的正常机制）。但导入一个碰巧也叫 dafeiyu 的模型
    // 不该悄悄把内置的那只顶掉，所以内置已占用的 id 也算冲突。
    if (!o.overwrite) {
      let n = 2;
      const base = id;
      while (this.dirOf(id)) { id = `${base}-${n++}`; }
    }

    const dstDir = path.join(this.userDir, id);
    fs.mkdirSync(dstDir, { recursive: true });

    const stat = { files: 0, bytes: 0, skipped: [] };
    this._copyTree(srcDir, dstDir, stat, 0, o);

    // 复制完再探测 —— 注意探测必须指向「复制后的目录」，
    // 因为清单里的相对路径要能在包里真正找到
    const manifest = M.blank(id, model3);
    // 显示名：用户给了就用用户的。没给时，目录名如果只是「model / live2d」这种
    // 通用词，用模型清单的名字反而更像人话（dafeiyu.model3.json → dafeiyu）。
    const dirName = path.basename(path.resolve(srcDir));
    const generic = /^(model|models|live2d|live2dmodel|pack|assets?|resource|resources|new folder|新建文件夹)$/i;
    const fallback = generic.test(dirName) ? path.basename(model3, path.extname(model3)).replace(/\.model3$/i, "") : dirName;
    manifest.displayName = M.cleanName(o.displayName || o.name || fallback, 64) || id;
    manifest.description = M.cleanName(o.description || "", 500);
    manifest.author = M.cleanName(o.author || "", 120);
    manifest.license = M.cleanName(o.license || "", 2000);
    manifest.adapter.origin = "imported";

    const report = probe(dstDir, manifest);
    // 把猜测写进清单：参数绑定 + 表情映射（动作先保留内置库）
    manifest.live2d.params = report.guesses.params;
    manifest.live2d.expressions.map = report.guesses.expressions;
    manifest.live2d.groups.eyeBlink = report.groups.eyeBlink.length ? "EyeBlink" : "";
    manifest.live2d.groups.lipSync = report.groups.lipSync.length ? "LipSync" : "";
    manifest.live2d.textures.count = report.textures.length;
    // 贴图目录/命名按实际路径反推，保证渲染端能拼对
    const firstTex = report.textures.find((t) => t.path);
    if (firstTex) {
      const dir = path.posix.dirname(firstTex.path);
      const base = path.posix.basename(firstTex.path);
      const num = base.match(/(\d+)\./);
      manifest.live2d.textures.dir = dir === "." ? "" : dir;
      if (num) {
        manifest.live2d.textures.pad = num[1].length;
        manifest.live2d.textures.pattern = base.replace(num[1], "{i}");
      } else {
        manifest.live2d.textures.pattern = "{i}";
      }
      manifest.live2d.textures.ext = (base.match(/\.([a-z0-9]+)$/i) || [, "png"])[1].toLowerCase();
    }
    manifest.adapter.probedAt = new Date().toISOString();
    manifest.adapter.probeVersion = 1;

    this.write(id, manifest);
    return { id, dir: dstDir, manifest: this.read(id).manifest, report, skipped: stat.skipped, bytes: stat.bytes, files: stat.files };
  }

  // 压缩包直投：用户从素材站下载的几乎都是 zip，之前必须先手动解压再选文件夹，
  // 这一步劝退过太多人（解到哪、要不要删、里面套了几层都不知道）。
  // 这里解到临时目录 → 自动剥掉「只有一个壳目录」的常见结构 → 走正常导入 → 清临时目录。
  importArchive(zipPath, opts) {
    const o = Object.assign({}, opts || {});
    if (!isZipFile(zipPath)) throw badRequest("这不是 ZIP 压缩包（只支持 .zip）");
    if (!this.userDir) throw new Error("没有配置用户模型目录");
    const st = fs.statSync(zipPath);
    if (st.size > 900 * 1024 * 1024) throw badRequest("压缩包超过 900MB，建议解压后导入文件夹");

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dafeiyu-pack-"));
    try {
      let zs;
      try {
        zs = extractZip(zipPath, tmp);
      } catch (e) {
        throw badRequest("压缩包解不开：" + String(e && e.message || e));
      }
      // 常见结构一：zip 里直接就是模型文件
      // 常见结构二：zip 里只有一层文件夹，模型在那层里
      let src = tmp;
      if (!this.findModel3(src)) {
        const subs = listDirSafe(tmp).filter((e) => e.isDirectory() && !SKIP_DIR.has(e.name.toLowerCase()));
        if (subs.length === 1) {
          const inner = path.join(tmp, subs[0].name);
          if (this.findModel3(inner)) src = inner;
        }
      }
      if (!this.findModel3(src)) {
        throw badRequest("压缩包里找不到 .model3.json —— 请确认下的是 Live2D 模型包，不是安装程序或预览图");
      }
      if (!o.displayName && !o.name) {
        // 用压缩包文件名当显示名：用户下载时命名的那个词通常就是他认识的模型名
        o.displayName = path.basename(zipPath, path.extname(zipPath));
      }
      // id 用压缩包名：解到临时目录后 basename 是 dafeiyu-pack-xxxx，不能拿它当 id
      if (!o.id) o.id = path.basename(zipPath, path.extname(zipPath));
      const out = this.importDir(src, o);
      out.archive = {
        name: path.basename(zipPath),
        bytes: st.size,
        packed: zs.files,
        unpacked: zs.bytes,
        skipped: zs.skipped.slice(0, 20),
      };
      return out;
    } finally {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
    }
  }

  _copyTree(src, dst, stat, depth, opts) {
    if (depth > LIMITS.depth) return;
    for (const ent of listDirSafe(src)) {
      if (stat.files >= LIMITS.files || stat.bytes >= LIMITS.totalBytes) return;
      const name = ent.name;
      if (name.startsWith(".") && name !== ".nojekyll") continue;
      const from = path.join(src, name);
      const to = path.join(dst, name);
      // 目标必须仍在 dst 内（符号链接/奇怪名字的兜底）
      const relToDst = path.relative(dst, to);
      if (relToDst.startsWith("..") || path.isAbsolute(relToDst)) continue;

      let st;
      try { st = fs.lstatSync(from); } catch { continue; }

      if (st.isSymbolicLink()) { stat.skipped.push({ name: relOf(src, from), why: "符号链接" }); continue; }
      if (st.isDirectory()) {
        if (SKIP_DIR.has(name.toLowerCase())) { stat.skipped.push({ name: relOf(src, from), why: "缓存/预览目录" }); continue; }
        fs.mkdirSync(to, { recursive: true });
        this._copyTree(from, to, stat, depth + 1, opts);
        continue;
      }
      if (!st.isFile()) continue;

      const ext = path.extname(name).toLowerCase();
      if (SKIP_EXT.has(ext)) { stat.skipped.push({ name: relOf(src, from), why: "制作文件/压缩包" }); continue; }
      if (st.size > LIMITS.fileBytes) { stat.skipped.push({ name: relOf(src, from), why: "单文件过大" }); continue; }
      if (stat.bytes + st.size > LIMITS.totalBytes) { stat.skipped.push({ name: relOf(src, from), why: "总容量超限" }); continue; }

      try {
        fs.copyFileSync(from, to);
        stat.files++;
        stat.bytes += st.size;
      } catch (e) {
        stat.skipped.push({ name: relOf(src, from), why: "复制失败：" + e.message });
      }
    }
  }

  // 内置包 → 用户包（「我想改大肥鱼」的唯一入口）
  duplicate(id, newId) {
    const rec = this.read(id);
    if (!rec) throw new Error("源包不存在");
    return this.importDir(rec.dir, {
      id: newId || id + "-custom",
      displayName: rec.manifest.displayName + "（副本）",
      overwrite: false,
    });
  }

  // 只删用户包；内置包删不掉（也不能删）
  remove(id) {
    const rec = this.read(id);
    if (!rec) return false;
    if (rec.origin !== "user" && rec.origin !== "override") {
      throw new Error("内置模型不能删除，可以复制成用户模型后再改");
    }
    // override 删掉的是本机覆盖层，删完自动回落到内置原样 —— 这正是用户想要的「恢复默认」。
    fs.rmSync(rec.dir, { recursive: true, force: true });
    this._cache.delete(id);
    this.log(`[packs] 删除 ${id}`);
    return true;
  }

  // 校验一个包：清单结构 + 磁盘文件 + 规则体检（规则部分由 rules.js 补，这里只做前两项）
  check(id) {
    const rec = this.read(id);
    if (!rec) return { ok: false, issues: [{ level: "error", code: "missing", message: "模型包不存在" }] };
    const v = M.validate(rec.manifest);
    const report = probe(rec.dir, rec.manifest, { fallbackDir: rec.base });
    const issues = v.issues.slice();
    for (const e of report.errors) issues.push({ level: "error", code: "disk", message: e });
    for (const w of report.warnings) issues.push({ level: "warn", code: "disk", message: w });
    return { ok: issues.every((i) => i.level !== "error"), issues, report, manifest: rec.manifest };
  }
}

module.exports = { PackStore, makeIdFrom, LIMITS, SKIP_EXT, SKIP_DIR };
