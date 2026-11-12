#!/usr/bin/env node
/**
 * 模型适配器自检：清单协议、语义槽、规则插件、内置动作库、内置包体检。
 *
 * 用法：node scripts/verify-packs.js
 * 退出码：0 全过；1 有错误（⚠️ 只是提示，不算失败）。
 *
 * 为什么单独一个脚本：适配器是「别人往里丢模型」的入口，最容易坏在
 * 「某个规则文件写错了字段类型」「某个槽改了名字但渲染端还按旧名找」这种
 * 跨文件的不一致上。这些错不会让程序崩，只会让某个模型的某个功能静默失效 ——
 * 必须在提交前抓出来。
 *
 * 查六件事：
 *   1. 语义槽定义完整（12 参数 / 27 动作场景 / 7 表情），id 不重复
 *   2. 每条内置曲线用到的参数，都能被某个槽或别名解释（否则换模型必丢）
 *   3. 规则文件形状合法：id/version/title/fields/read/apply 都在，字段类型合法
 *   4. 清单 sanitize 往返稳定：blank → sanitize → validate 不产生 error
 *   5. 内置动作库能加载，场景表里的动作名都真实存在
 *   6. 内置模型包能 probe + diagnose，且不是 broken
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const sem = require(path.join(ROOT, "src", "packs", "semantics.js"));
const M = require(path.join(ROOT, "src", "packs", "manifest.js"));
const { RuleRegistry, FIELD_TYPES } = require(path.join(ROOT, "src", "packs", "rules.js"));
const { loadBuiltin } = require(path.join(ROOT, "src", "packs", "builtin.js"));
const probeMod = require(path.join(ROOT, "src", "packs", "probe.js"));
const probe = probeMod.probe || probeMod;
const { diagnose } = require(path.join(ROOT, "src", "packs", "doctor.js"));

let pass = 0;
let fail = 0;
let warn = 0;
const rows = [];

// FIELD_TYPES 是 Set，用 has；顺手兼容数组/对象，免得以后改了导出形式这里静默失效
const hasFieldType = (t) => (FIELD_TYPES instanceof Set)
  ? FIELD_TYPES.has(t)
  : Array.isArray(FIELD_TYPES)
    ? FIELD_TYPES.indexOf(t) >= 0
    : Object.prototype.hasOwnProperty.call(FIELD_TYPES, t);

const ok = (n, d) => { pass += 1; rows.push(["✅", n, d || ""]); };
const bad = (n, d) => { fail += 1; rows.push(["❌", n, d || ""]); };
const tip = (n, d) => { warn += 1; rows.push(["⚠️ ", n, d || ""]); };

// ── 1. 语义槽 ─────────────────────────────────────────────
(() => {
  const groups = [
    ["参数", sem.PARAM_SLOTS],
    ["动作", sem.ACTION_SLOTS],
    ["活动", sem.ACTIVITY_SLOTS],
    ["表情", sem.EXPR_SLOTS],
  ];
  for (const [name, list] of groups) {
    const ids = list.map((s) => s.id);
    const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
    if (!list.length) bad(name + "槽", "一个都没有");
    else if (dup.length) bad(name + "槽", "id 重复：" + [...new Set(dup)].join(","));
    else ok(name + "槽", list.length + " 项");
  }
  // 参数槽必须给出 canon 名，动作槽必须给出默认场景
  const noCanon = sem.PARAM_SLOTS.filter((s) => !s.canon).map((s) => s.id);
  if (noCanon.length) bad("参数槽 canon", "缺：" + noCanon.join(","));
  else ok("参数槽 canon", "全有");
  const noScene = sem.ACTION_SLOTS.filter((s) => !s.scene).map((s) => s.id);
  if (noScene.length) bad("动作槽 scene", "缺：" + noScene.join(","));
  else ok("动作槽 scene", "全有");
})();

// ── 2. 内置曲线参数可解释性 ────────────────────────────────
(() => {
  let b = null;
  try { b = loadBuiltin(path.join(ROOT, "src", "motions.js")); } catch (e) {
    bad("动作库加载", e.message);
    return;
  }
  ok("动作库加载", b.actionCount + " 支 / " + Object.keys(b.scenes).length + " 个场景");

  // 场景表里写的动作名，必须都能在动作库里找到
  const missing = [];
  for (const scene of Object.keys(b.scenes)) {
    for (const name of b.scenes[scene]) if (!b.motions[name]) missing.push(scene + "·" + name);
  }
  if (missing.length) bad("场景表引用", "找不到动作：" + missing.slice(0, 4).join("，") + (missing.length > 4 ? " 等" + missing.length + " 个" : ""));
  else ok("场景表引用", "全部能找到");

  // 曲线里用到的专有参数，必须有地方解释它，否则换模型时这几条会被整段跳过
  const custom = require(path.join(ROOT, "src", "packs", "builtin.js")).customRefs(b);
  const aliased = new Set();
  for (const s of sem.PARAM_SLOTS) [s.canon].concat(s.alts || []).forEach((n) => n && aliased.add(n));
  const orphan = custom.filter((n) => !aliased.has(n));
  if (orphan.length) {
    tip("专有参数", orphan.length + " 个（" + orphan.slice(0, 5).join("，") + "）只能靠「专有参数别名」接，内置包里它们只服务伸懒腰");
  } else {
    ok("专有参数", "没有");
  }
})();

// ── 3. 规则插件 ───────────────────────────────────────────
let REG = null;
(() => {
  const dir = path.join(ROOT, "src", "packs", "rules");
  let reg = null;
  try {
    reg = new RuleRegistry(dir, () => { });
    reg.reload();
    REG = reg;
  } catch (e) {
    bad("规则加载", e.message);
    return;
  }
  if (reg.errors && reg.errors.length) {
    bad("规则加载", reg.errors.map((x) => x.file + "：" + x.message).join("；"));
  } else {
    ok("规则加载", reg.rules.length + " 条");
  }

  const badFields = [];
  const badRules = [];
  for (const r of reg.rules) {
    if (!r.id || !r.title || !Array.isArray(r.fields)) { badRules.push(r._file || r.id || "?"); continue; }
    for (const f of r.fields) {
      if (!f || !f.key) badFields.push((r.id || "?") + " 有字段缺 key");
      else if (!hasFieldType(f.type)) badFields.push(r.id + "." + f.key + " 类型非法：" + f.type);
    }
    if (typeof r.read !== "function") badRules.push(r.id + " 缺 read()");
    if (typeof r.apply !== "function") badRules.push(r.id + " 缺 apply()");
  }
  if (badRules.length) bad("规则形状", badRules.join("；"));
  else ok("规则形状", "id/title/fields/read/apply 齐备");
  if (badFields.length) bad("字段定义", badFields.slice(0, 6).join("；"));
  else ok("字段定义", "类型全部合法");

  // order 不能重复，否则界面上的步骤顺序不稳定
  const orders = reg.rules.map((r) => r.order);
  const dupOrder = orders.filter((v, i) => orders.indexOf(v) !== i);
  if (dupOrder.length) bad("规则顺序", "order 重复：" + [...new Set(dupOrder)].join(","));
  else ok("规则顺序", "order 唯一");
})();

// ── 4. 清单往返 ───────────────────────────────────────────
(() => {
  let blank = null;
  try { blank = M.blank("probe-pack", "test.model3.json"); } catch (e) {
    bad("空清单", e.message);
    return;
  }
  const v1 = M.validate(blank);
  const errs = v1.issues.filter((i) => i.level === "error");
  if (errs.length) bad("空清单", errs.map((i) => i.message).join("；"));
  else ok("空清单", "结构合法");

  // 写盘走 sanitize，读回走 sanitize：两次结果必须一致，否则保存会「越存越少」
  const once = M.sanitize(blank);
  const twice = M.sanitize(JSON.parse(JSON.stringify(once)));
  const same = JSON.stringify(once) === JSON.stringify(twice);
  if (!same) bad("清单往返", "sanitize 不稳定（存一次和存两次结果不同）");
  else ok("清单往返", "sanitize 幂等");

  // 保存链路最容易漏的字段：layout 的 viewY/viewH。它们必须能穿过 sanitize。
  const withLay = JSON.parse(JSON.stringify(once));
  withLay.live2d.layout.viewY = 0.05;
  withLay.live2d.layout.viewH = 0.8;
  const kept = M.sanitize(withLay);
  if (kept.live2d.layout.viewY !== 0.05 || kept.live2d.layout.viewH !== 0.8) {
    bad("布局字段", "viewY/viewH 被 sanitize 丢掉了 —— 用户在适配器里调的取景保存不上");
  } else {
    ok("布局字段", "viewY/viewH 能穿过 sanitize");
  }

  // 规则落盘：每条规则 apply 写进去的东西，必须能穿过 sanitize 再被 read 读回来。
  // 防的是「新增一个字段忘了加进 sanitize 白名单」——viewY/viewH 和 interaction
  // 都这么静默丢过配置，接口还返回成功，用户只看到「保存没反应」。
  // 用规则自己的 detect 产出一份合法配置，再走 apply → sanitize → read 闭环。
  const stubReport = {
    params: [], groupList: [], motions: {}, motionFiles: [], expressions: [], textures: [], parts: [],
    groups: { eyeBlink: [], lipSync: [] },
    guesses: { params: {}, expressions: {} },
  };
  const { RuleRegistry } = require(path.join(ROOT, "src", "packs", "rules"));
  const reg2 = new RuleRegistry(path.join(ROOT, "src", "packs", "rules"));
  reg2.reload();
  const lostRules = [];
  for (const r of reg2.rules) {
    if (typeof r.detect !== "function" || typeof r.apply !== "function" || typeof r.read !== "function") continue;
    let cfg = null;
    try { cfg = r.detect({ report: stubReport, manifest: M.blank("probe", "x.model3.json"), cfgs: {}, settings: {}, builtin: null }) || {}; } catch (e) { continue; }
    const m = M.blank("probe", "x.model3.json");
    try { r.apply(m, cfg); } catch (e) { lostRules.push(r.id + " apply 抛错：" + e.message); continue; }
    const before = JSON.stringify(r.read(m));
    const after = JSON.stringify(r.read(M.sanitize(m)));
    if (before !== after) lostRules.push(r.id + "：存前 " + before + " ≠ 存后 " + after);
  }
  if (lostRules.length) bad("规则落盘", lostRules.slice(0, 3).join("；"));
  else ok("规则落盘", "apply → sanitize → read 一致（" + reg2.rules.length + " 条规则）");
})();

// ── 5/6. 内置包（走 ModelAdapter，和运行时同一条路） ────────
(() => {
  const dir = path.join(ROOT, "model");
  const model3 = (() => {
    try { return fs.readdirSync(dir).find((f) => f.endsWith(".model3.json")) || ""; } catch (e) { return ""; }
  })();
  if (!model3) { tip("内置包", "model/ 里没有 .model3.json，跳过"); return; }

  let adapter = null;
  try {
    const { ModelAdapter } = require(path.join(ROOT, "src", "packs"));
    const os = require("os");
    // 用系统临时目录当「用户模型目录」：自检不该往用户真实目录里写东西
    const tmpUser = fs.mkdtempSync(path.join(os.tmpdir(), "fish-verify-"));
    adapter = new ModelAdapter({
      root: ROOT,
      userDir: tmpUser,
      motionsFile: path.join(ROOT, "src", "motions.js"),
      getSettings: () => ({ activePack: "" }),
      patchSettings: () => { },
      log: () => { }, logErr: () => { },
    });
  } catch (e) {
    bad("适配器初始化", e.message);
    return;
  }

  let listed = null;
  try { listed = adapter.list(); } catch (e) { bad("模型列表", e.message); return; }
  const pack = (listed.packs || []).find((p) => p.origin === "builtin" && p.ok);
  if (!pack) { bad("模型列表", "内置包没被识别"); return; }
  ok("模型列表", listed.packs.length + " 个包，当前 " + listed.active);

  let rep = null;
  try {
    const pr = adapter.probe(pack.id);   // 返回 {id, origin, dir, manifest, report, builtin}
    rep = pr && pr.report;
  } catch (e) { bad("内置包探测", e.message); return; }
  if (!rep || !rep.params) { bad("内置包探测", "返回空（id=" + pack.id + "）"); return; }
  ok("内置包探测", rep.params.length + " 参数 / " + Object.keys(rep.motions).length + " 动作组 / " + rep.expressions.length + " 表情 / " + rep.textures.length + " 贴图");
  const texMissing = (rep.textures || []).filter((t) => t.missing);
  if (texMissing.length) bad("内置包贴图", texMissing.length + " 张找不到");
  else ok("内置包贴图", "全部就位");

  // 体检：内置包是「出厂状态」，broken 说明规则或探测有回归。
  // 走 adapter.diagnose 而不是手工拼 cfgs —— 合并 saved + suggest 的逻辑只有一份，
  // 脚本自己拼一份就会「脚本说没绑、界面说绑了」。
  let d = null;
  try { d = adapter.diagnose(pack.id); } catch (e) { bad("内置包体检", e.message); return; }
  if (!d) { bad("内置包体检", "返回空"); return; }
  if (d.verdict === "broken") bad("内置包体检", d.score + " 分 · " + d.headline);
  else if (d.counts.error) bad("内置包体检", d.counts.error + " 个错误 · " + d.headline);
  else ok("内置包体检", d.score + " 分 · " + d.verdictText + (d.counts.warn ? "（" + d.counts.warn + " 条提示）" : ""));

  // 运行时视图：渲染端只认这一张表，字段缺一个就会静默退回硬编码
  let rt = null;
  try { rt = adapter.getManifest(pack.id); } catch (e) { bad("运行时视图", e.message); return; }
  const need = ["url", "base", "textures", "params", "paramMap", "actions", "sceneRoutes", "expressions", "layout", "groups", "interaction"];
  const miss = need.filter((k) => rt[k] === undefined);
  if (miss.length) bad("运行时视图", "缺字段：" + miss.join(","));
  else ok("运行时视图", rt.textures.length + " 贴图 / " + Object.keys(rt.actions).length + " 动作槽 / " + Object.keys(rt.sceneRoutes).length + " 场景路由");

  // 每条内置动作曲线，能落到这台模型的参数上的比例 —— 太低说明绑定或别名漏了
  let b = null;
  try { b = adapter.builtin(); } catch (e) { }
  if (b) {
    let total = 0;
    let hit = 0;
    for (const name of Object.keys(b.motions)) {
      for (const [pid] of b.motions[name]) {
        total += 1;
        const real = rt.paramMap[pid] || pid;
        if (rep.params.some((p) => p.id === real)) hit += 1;
      }
    }
    const pct = total ? Math.round((hit / total) * 1000) / 10 : 0;
    if (pct < 60) bad("曲线覆盖率", pct + "%（" + hit + "/" + total + "）—— 内置动作会大面积播不出来");
    else ok("曲线覆盖率", pct + "%（" + hit + "/" + total + " 条曲线参数能在本模型里找到）");
  }
})();

// ── 输出 ─────────────────────────────────────────────────
const pad = rows.reduce((m, r) => Math.max(m, r[1].length), 0);
for (const [mark, name, detail] of rows) {
  console.log(mark + " " + name.padEnd(pad) + "  " + detail);
}
console.log("\n结果：" + pass + " 通过，" + fail + " 失败，" + warn + " 提示");
process.exit(fail ? 1 : 0);
