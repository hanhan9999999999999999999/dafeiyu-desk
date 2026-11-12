// 规则注册表：适配器的「可扩展点」。
//
// 设计目标是「以后软件加了新逻辑，适配器里能多出一块设置」，所以规则必须满足：
//   · 自带字段声明（UI 不认识任何具体规则，只按 schema 画控件）
//   · 自带探测（拿到模型结构后能给出默认值）
//   · 自带体检（能说出「你还差什么」）
//   · 自洽的读写（cfg ⇄ 清单字段的换算写在规则里，UI 只碰 cfg）
// 满足这四条，加一个规则文件就是加一块能力，不用改 adapter.js 一行代码。
const fs = require("fs");
const path = require("path");

const FIELD_TYPES = new Set([
  "param", "motion", "expression", "text", "textarea", "number", "toggle",
  "select", "slider", "map", "group",
]);

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

// 一条规则的形状检查。宁可加载时报错，也不要让它跑到界面上把面板画崩。
function checkRule(r, file) {
  const where = path.basename(file);
  if (!r || typeof r !== "object") throw new Error(`${where}: 没有导出对象`);
  if (!r.id || !/^[a-z0-9-]{1,40}$/.test(r.id)) throw new Error(`${where}: id 必须是 kebab-case`);
  if (!r.title) throw new Error(`${where}: 缺 title`);
  const fields = Array.isArray(r.fields) ? r.fields : [];
  for (const f of fields) {
    if (!f || !f.key) throw new Error(`${where}: 字段缺 key`);
    if (!FIELD_TYPES.has(f.type)) throw new Error(`${where}: 字段 ${f.key} 类型 ${f.type} 不认识`);
    if (!f.label) f.label = f.key;
  }
  return {
    id: r.id,
    version: Number(r.version) || 1,
    title: r.title,
    description: r.description || "",
    order: Number.isFinite(r.order) ? r.order : 100,
    fields,
    detect: typeof r.detect === "function" ? r.detect : null,
    validate: typeof r.validate === "function" ? r.validate : null,
    read: typeof r.read === "function" ? r.read : null,
    apply: typeof r.apply === "function" ? r.apply : null,
    _file: file,
  };
}

class RuleRegistry {
  constructor(dir) {
    this.dir = dir;
    this.rules = [];
    this.errors = [];
    this.loadedAt = 0;
    this.reload();
  }

  // 重新扫描。开发时改一个规则文件刷新适配器就能看到，不必重启程序。
  reload() {
    this.rules = [];
    this.errors = [];
    let files = [];
    try {
      files = fs.readdirSync(this.dir).filter((f) => f.endsWith(".js") && !f.startsWith("_")).sort();
    } catch (e) {
      this.errors.push({ file: this.dir, message: "规则目录读不了：" + e.message });
    }
    for (const f of files) {
      const full = path.join(this.dir, f);
      if (!isFile(full)) continue;
      try {
        delete require.cache[require.resolve(full)];
        const mod = require(full);
        this.rules.push(checkRule(mod, full));
      } catch (e) {
        this.errors.push({ file: f, message: e.message });
      }
    }
    this.rules.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    this.loadedAt = Date.now();
    return { count: this.rules.length, errors: this.errors };
  }

  get(id) {
    return this.rules.find((r) => r.id === id) || null;
  }

  // 给 UI 的完整 schema（不含函数）
  schema() {
    return {
      version: 1,
      loadedAt: this.loadedAt,
      errors: this.errors,
      rules: this.rules.map((r) => ({
        id: r.id, version: r.version, title: r.title, description: r.description,
        order: r.order, fields: r.fields, file: path.basename(r._file),
      })),
    };
  }

  /** 汇总探测默认值：{ruleId: cfg} */
  detectAll(ctx) {
    const out = {};
    for (const r of this.rules) {
      if (!r.detect) continue;
      try {
        const v = r.detect(ctx);
        if (v && typeof v === "object") out[r.id] = v;
      } catch (e) {
        this.errors.push({ file: path.basename(r._file), message: "detect 抛错：" + e.message });
      }
    }
    return out;
  }

  /** 从清单读出各规则的当前值：{ruleId: cfg} */
  readAll(manifest) {
    const out = {};
    for (const r of this.rules) {
      try {
        out[r.id] = r.read ? r.read(manifest) : (manifest.adapter && manifest.adapter.rules ? manifest.adapter.rules[r.id] : undefined);
      } catch (e) {
        out[r.id] = undefined;
        this.errors.push({ file: path.basename(r._file), message: "read 抛错：" + e.message });
      }
    }
    return out;
  }

  /** 把 {ruleId: cfg} 写回清单（就地修改并返回） */
  applyAll(manifest, cfgs) {
    const bag = (manifest.adapter.rules = manifest.adapter.rules || {});
    for (const r of this.rules) {
      if (!cfgs || !(r.id in cfgs)) continue;
      const cfg = cfgs[r.id];
      try {
        if (r.apply) r.apply(manifest, cfg);
        else bag[r.id] = cfg;
      } catch (e) {
        this.errors.push({ file: path.basename(r._file), message: "apply 抛错：" + e.message });
      }
    }
    return manifest;
  }

  /** 全部规则的体检：issues 都带 ruleId，界面能定位到具体那一块 */
  validateAll(ctx) {
    const issues = [];
    for (const r of this.rules) {
      if (!r.validate) continue;
      let got = [];
      try {
        got = r.validate(ctx, ctx.cfgs ? ctx.cfgs[r.id] : undefined) || [];
      } catch (e) {
        issues.push({ level: "error", ruleId: r.id, code: "rule-crash", message: `规则「${r.title}」体检失败：${e.message}` });
        continue;
      }
      for (const i of got) {
        if (!i || !i.message) continue;
        issues.push({
          level: i.level === "warn" ? "warn" : i.level === "info" ? "info" : "error",
          ruleId: r.id, code: i.code || "rule", message: i.message, fix: i.fix || "",
        });
      }
    }
    return issues;
  }
}

module.exports = { RuleRegistry, checkRule, FIELD_TYPES };
