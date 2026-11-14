#!/usr/bin/env node
/**
 * 源码自检：页面引用、CSP、IPC 桥接是否对得上。
 *
 * 用法：node scripts/verify-src.js
 * 退出码：0 全过；1 有错误（⚠️ 只是提示，不算失败）。
 *
 * 查三件事：
 *   1. 每个 .html 都有 CSP
 *   2. 每个 <script src> / <link href> 指向的文件真的存在
 *   3. preload 里 invoke 的每个 channel，main 里都有 ipcMain.handle
 *      （反过来 main 有、preload 没暴露的，只给提示 —— 可能只是内部通道）
 */
const fs = require("fs");
const path = require("path");

const SRC = path.resolve(__dirname, "..", "src");

let pass = 0;
let fail = 0;
let warn = 0;
const rows = [];

function ok(n, d) {
  pass += 1;
  rows.push(["✅", n, d || ""]);
}
function bad(n, d) {
  fail += 1;
  rows.push(["❌", n, d || ""]);
}
function wrn(n, d) {
  warn += 1;
  rows.push(["⚠️", n, d || ""]);
}

// ---------- 1 & 2. HTML：CSP + 引用 ----------
const htmls = fs.readdirSync(SRC).filter((f) => f.toLowerCase().endsWith(".html"));

for (const h of htmls) {
  const full = path.join(SRC, h);
  const text = fs.readFileSync(full, "utf8");

  if (!/Content-Security-Policy/i.test(text)) bad(h + " 缺少 CSP");
  else ok(h + " 有 CSP");

  const refs = [];
  for (const m of text.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) refs.push(["script", m[1]]);
  for (const m of text.matchAll(/<link[^>]*\shref="([^"]+)"/g)) refs.push(["link", m[1]]);

  for (const [kind, ref] of refs) {
    if (/^(https?:)?\/\//.test(ref) || ref.startsWith("data:")) continue;
    const p = ref.startsWith("/")
      ? path.join(SRC, "..", ref.slice(1))
      : path.resolve(SRC, ref);
    if (fs.existsSync(p)) ok(`${h} → ${ref}`);
    else bad(`${h} → ${ref}（${kind}）不存在`);
  }
}

// ---------- 3. IPC 桥接 ----------
const mainSrc = fs.readFileSync(path.join(SRC, "main.js"), "utf8");
const preloadSrc = fs.readFileSync(path.join(SRC, "preload.js"), "utf8");

const handled = new Set();
for (const m of mainSrc.matchAll(/ipcMain\.handle\(\s*"([^"]+)"/g)) handled.add(m[1]);

const invoked = new Set();
for (const m of preloadSrc.matchAll(/invoke\(\s*"([^"]+)"/g)) invoked.add(m[1]);

for (const ch of [...invoked].sort()) {
  if (handled.has(ch)) ok("IPC " + ch);
  else bad("preload 调用了未注册的 IPC：" + ch);
}
for (const ch of [...handled].sort()) {
  if (!invoked.has(ch)) wrn("main 注册了但 preload 没暴露：" + ch);
}

// ---------- 4. getElementById 的 id 在引用它的 html 里存在 ----------
// 这一项防的是「els.xxx 是 null → addEventListener 抛错 → 整个面板初始化失败」。
// 动态创建的元素（createElement 之后 .id = "x"）不算缺失，先把它们收集起来。
for (const js of fs.readdirSync(SRC).filter((f) => f.endsWith(".js"))) {
  const jsText = fs.readFileSync(path.join(SRC, js), "utf8");
  const ids = [...jsText.matchAll(/getElementById\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]);
  // 有页面习惯把取元素包成 $("x")（adapter.js 就是）。只在文件里确实定义了
  // 「$ = (id) => document.getElementById(id)」时才按这个模式再收一遍，
  // 免得把别的 $("...") 当成元素 id。
  if (/const\s+\$\s*=\s*\([^)]*\)\s*=>\s*document\.getElementById/.test(jsText)) {
    for (const m of jsText.matchAll(/(?<![\w.$])\$\(\s*"([^"]+)"\s*\)/g)) ids.push(m[1]);
  }
  if (!ids.length) continue;

  const dynamic = new Set(
    [...jsText.matchAll(/\.id\s*=\s*"([^"]+)"/g)].map((m) => m[1])
  );

  // 谁引用了这个 js，就在谁里面找 id
  const owners = htmls.filter((h) =>
    fs.readFileSync(path.join(SRC, h), "utf8").includes(js)
  );
  if (!owners.length) {
    wrn(`${js} 没有页面引用，跳过 id 检查`);
    continue;
  }

  const union = new Set();
  for (const h of owners) {
    const t = fs.readFileSync(path.join(SRC, h), "utf8");
    for (const m of t.matchAll(/\sid="([^"]+)"/g)) union.add(m[1]);
  }

  for (const id of [...new Set(ids)].sort()) {
    if (dynamic.has(id)) continue;
    if (union.has(id)) ok(`${js} #${id}`);
    else bad(`${js} 引用了不存在的 #${id}`);
  }
}

// ---------- 输出 ----------
const wName = rows.reduce((m, r) => Math.max(m, r[1].length), 0);
console.log("");
for (const r of rows) {
  console.log(r[0] + " " + r[1].padEnd(wName) + (r[2] ? "  " + r[2] : ""));
}
console.log("");
console.log(`结果：${pass} 通过，${fail} 失败，${warn} 提示（main 有 ${handled.size} 个 IPC，preload 暴露 ${invoked.size} 个）`);

process.exit(fail ? 1 : 0);
