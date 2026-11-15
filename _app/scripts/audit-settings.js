// 每个设置键都必须有人读（round 17）
//
// 背景：`anchorMode` 这个键从 1.x 就存在，`stashAnchor()` 每次都写它，
// 但全仓没有一行读它 —— "corner" 之外那个 "free" 模式从来没实现过。
// 它没有界面控件，所以暂时没伤到人；但只要有人给它补一个开关，
// 用户改完就会得到"保存了、但什么都没发生"。
//
// 这个脚本就是拦这件事：DEFAULTS 里每加一个键，必须同时有一个消费方
// （主进程拿它调窗口，或渲染侧拿它改行为）。只写不读的键要进 WHITELIST
// 并写清为什么留着。
//
// 用法：node scripts/audit-settings.js   （有死键就 exit 1）
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DEFAULTS } = require("../src/settings.js");

const SRC = path.join(__dirname, "..", "src");

// 定义方与界面方不算消费方：它们本来就得提到每个键
const NOT_CONSUMER = new Set(["settings.js", "settings-renderer.js"]);

// 已知的只写不读字段。加进来必须写明原因，否则下一个人会以为它有用。
const WHITELIST = {
  // stashAnchor() 每次保存位置都写 "corner"，但没有代码读它来决定行为；
  // "free"（记住绝对坐标）模式未实现，anchorMode 目前只是个占位。
  // 真要实现 free 模式，得先让 ensureStartPos / scheduleResize 认它。
  anchorMode: "只写不读的占位：free 模式未实现（见 stashAnchor）",
};

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "vendor") continue;
      walk(p, out);
    } else if (e.name.endsWith(".js") && !NOT_CONSUMER.has(e.name)) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(SRC, []).map((p) => ({ rel: path.relative(SRC, p), text: fs.readFileSync(p, "utf8") }));
if (!files.length) {
  console.log("❌ 一个源文件都没扫到，路径是不是变了？");
  process.exit(1);
}

const keys = Object.keys(DEFAULTS);
const dead = [];
const stub = [];

for (const k of keys) {
  // 认 s.key / s["key"] / get("key") / patch({ key: ... }) 这几种写法
  const re = new RegExp("[.\\[\"'`(]\\s*" + k + "\\b", "g");
  const hits = files.filter((f) => (f.text.match(re) || []).length > 0).map((f) => f.rel);
  if (hits.length) continue;
  if (WHITELIST[k]) stub.push({ k, why: WHITELIST[k], files: hits });
  else dead.push(k);
}

console.log("设置键 " + keys.length + " 个，扫描 " + files.length + " 个源文件");
console.log("— 只写不读（已登记）：" + (stub.length ? stub.map((s) => s.k).join(", ") : "无"));
for (const s of stub) console.log("    " + s.k + "：" + s.why);

// 白名单里登记过、但其实已经有消费方的键：说明实现了却忘了删登记
const stale = Object.keys(WHITELIST).filter((k) => !stub.some((s) => s.k === k));

if (dead.length) {
  console.log("");
  console.log("❌ 这些设置键存得下去，但没有任何代码读它 —— 用户改了不会发生任何事：");
  for (const k of dead) console.log("    · " + k);
  console.log("  要么接上消费方，要么删掉这个键，要么加进本脚本的 WHITELIST 并写明原因。");
}

if (stale.length) {
  console.log("");
  console.log("⚠ 这些键登记在 WHITELIST 里，但已经有消费方了，把登记删掉：");
  for (const k of stale) console.log("    · " + k);
}

const fail = dead.length + stale.length;
console.log("");
console.log("audit-settings：" + (fail ? "❌ " + fail + " 个问题" : "✅ 每个键都有人读"));
process.exit(fail ? 1 : 0);
