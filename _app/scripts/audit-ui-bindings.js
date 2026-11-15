"use strict";
/**
 * 界面控件接线审计：HTML 里的可交互元素，到底有没有人给它绑事件。
 *
 * 为什么值得一个脚本：
 *   设置窗有 76 个带 id 的可交互元素，其它窗口加起来 34 个。全部用
 *   `$("id").addEventListener(...)` 逐个绑（没有 data-act 这类声明式），所以
 *   「加了一个开关但忘了接」在代码里看不出来、单元测试抓不到、真机冒烟只会觉得
 *   「界面能开」。用户点下去没反应，他不会写缺陷单，只会觉得这软件不靠谱。
 *
 * 判据（分两步，尽量避免误报）：
 *   第一步 —— 直接绑定：id 出现处的上下文（±N 字符）里有 addEventListener / onclick 等。
 *   第二步 —— 间接绑定：代码常见两种写法
 *       const E = { scaleNum: document.getElementById("scaleNum"), ... };  E.scaleNum.addEventListener(...)
 *       const el = $("scaleNum");                                          el.addEventListener(...)
 *     所以先把「变量名 → id」的映射建出来，再看 `.addEventListener(` 的接收者是不是这些变量。
 *   两步都不命中的才报「可疑」。
 *
 * 用法：
 *   node scripts/audit-ui-bindings.js            # 只报可疑项
 *   node scripts/audit-ui-bindings.js --verbose  # 每页都列
 */
const fs = require("node:fs");
const path = require("node:path");

const APP = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);
const VERBOSE = argv.includes("--verbose");
const WINDOW = 420;
// --src <目录>：给单元测试用（造一间假 src，验证它真能抓到没绑定的控件）
const srcArg = (() => {
  const i = argv.indexOf("--src");
  return i >= 0 && argv[i + 1] ? path.resolve(argv[i + 1]) : "";
})();
const SRC = srcArg || path.join(APP, "src");

const PAGES = srcArg
  ? fs.readdirSync(srcArg).filter((f) => f.endsWith(".html"))
  : [
    "settings.html", "index.html", "adapter.html", "petpanel.html",
    "chatlog.html", "profile.html", "welcome.html", "seewatch.html",
  ];

const COMMON = [
  "settings-renderer.js", "settings-shell.js", "settings.js", "renderer.js", "dock.js",
  "adapter.js", "petpanel.js", "petpanel-win.js", "chatlog.js", "profile-win.js",
  "welcome.js", "seewatch.js", "window-menu.js", "preload.js",
];

const BIND_HINT = /addEventListener\(|\.onclick\s*=|\.onchange\s*=|\.oninput\s*=|\.onsubmit\s*=|\.onkeydown\s*=|\bbind\w*\(|\bwire\w*\(|\bon\(\s*["']/;

function readIf(p) { try { return fs.readFileSync(p, "utf8"); } catch (e) { return ""; } }

function scriptsOf(html) {
  const out = [];
  // 内联的 <script>…</script> 也算（有的页面把几行绑定直接写在 HTML 里）
  const inline = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let mi;
  while ((mi = inline.exec(html))) {
    if (mi[1] && mi[1].trim()) out.push({ file: "(inline)", text: mi[1] });
  }
  const re = /<script[^>]*\ssrc="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const rel = m[1].replace(/^\.\//, "");
    const p = path.join(SRC, rel);
    if (fs.existsSync(p)) out.push({ file: rel, text: readIf(p) });
  }
  return out;
}

function interactiveIds(html) {
  const out = [];
  const re = /<(button|input|select|textarea)\b([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const idm = /\sid="([A-Za-z0-9_-]+)"/.exec(m[2] || "");
    if (idm && out.indexOf(idm[1]) < 0) out.push(idm[1]);
  }
  return out;
}

/** 变量名 → id（两种常见写法） */
function varToIdMap(text) {
  const map = new Map();
  let m;
  const re1 = /([A-Za-z_$][\w$]*)\s*:\s*document\.getElementById\(\s*["']([A-Za-z0-9_-]+)["']\s*\)/g;
  while ((m = re1.exec(text))) map.set(m[1], m[2]);
  const re2 = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*document\.getElementById\(\s*["']([A-Za-z0-9_-]+)["']\s*\)/g;
  while ((m = re2.exec(text))) map.set(m[1], m[2]);
  const re3 = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\$\(\s*["']([A-Za-z0-9_-]+)["']\s*\)/g;
  while ((m = re3.exec(text))) map.set(m[1], m[2]);
  // 对象字面量里用短名收集：const el = { stop: $("stop"), levelBtn: $("levelBtn") }
  // —— petpanel-win.js 就是这么写的，漏了这条会把接了事件的按钮报成死键。
  const re4 = /([A-Za-z_$][\w$]*)\s*:\s*\$\(\s*["']([A-Za-z0-9_-]+)["']\s*\)/g;
  while ((m = re4.exec(text))) map.set(m[1], m[2]);
  return map;
}

/** 所有 addEventListener 的接收者表达式 */
function boundReceivers(text) {
  const set = new Set();
  const re = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\.\s*addEventListener\s*\(/g;
  let m;
  while ((m = re.exec(text))) set.add(m[1]);
  return set;
}

function ctxBound(id, text) {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp('(["\'])' + esc + '\\1', "g");
  let m;
  while ((m = re.exec(text))) {
    const from = Math.max(0, m.index - WINDOW);
    const to = Math.min(text.length, m.index + id.length + WINDOW);
    if (BIND_HINT.test(text.slice(from, to))) return true;
  }
  return false;
}

let totalInteractive = 0;
let unbound = 0;
const rows = [];

for (const page of PAGES) {
  const htmlPath = path.join(SRC, page);
  if (!fs.existsSync(htmlPath)) continue;
  const html = readIf(htmlPath);
  const scripts = scriptsOf(html);
  const pool = scripts.map((s) => s.text).join("\n") + "\n" +
    COMMON.map((f) => readIf(path.join(SRC, f))).join("\n");

  const ids = interactiveIds(html);
  totalInteractive += ids.length;

  const vmap = varToIdMap(pool);
  const receivers = boundReceivers(pool);
  // 变量名 → 它绑过事件
  const boundVars = new Set();
  for (const r of receivers) {
    const parts = r.split(".");
    const last = parts[parts.length - 1];
    boundVars.add(r);
    boundVars.add(last);
  }
  // 反过来：某个 id 对应的变量名，是否在 boundVars 里
  const boundIds = new Set();
  for (const [v, id] of vmap) {
    if (boundVars.has(v) || [...boundVars].some((b) => b.endsWith("." + v))) boundIds.add(id);
  }

  const dead = [];
  for (const id of ids) {
    if (ctxBound(id, pool)) continue;
    if (boundIds.has(id)) continue;
    dead.push(id);
  }
  unbound += dead.length;
  rows.push({ page, n: ids.length, dead });
  if (VERBOSE || dead.length) {
    console.log("[audit] " + page + "：" + ids.length + " 个可交互元素" +
      (dead.length ? "，" + dead.length + " 个找不到绑定" : "，全部有绑定"));
    if (dead.length) console.log("        可疑：" + dead.join(", "));
  }
}

console.log("");
console.log("结果：" + totalInteractive + " 个可交互元素，" + unbound + " 个找不到绑定");
process.exit(0);
