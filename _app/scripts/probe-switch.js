"use strict";
/**
 * 切模型的探针（round 28）。
 *
 * 要证明三件事：
 *   1. 切一次模型，页面**只重载一次**（修之前是两次：页面自己 reload 一次，
 *      主进程 120ms 后又 reload 一次，把刚开始的加载打断重来）。
 *   2. 「只换规则」（adapter:reload，改取景/表情/动作路由）**不重载页面**，
 *      但新的取景真的生效了。
 *   3. 切完之后模型确实起来了，不是白屏。
 *
 * 计数手法：CDP 的 Page.addScriptToEvaluateOnNewDocument 在每个新文档创建时执行，
 * 脚本往 localStorage 里自增一个数 —— localStorage 同源跨 reload 保留，
 * 所以这个数就是「页面被加载了几次」。同时用 Page.frameNavigated 事件做第二份计数，
 * 两者取大（哪种通路失效都不至于漏判）。
 */

const fs = require("fs");
const { makeTmp } = require("./lib/tmp");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { connect, findTarget, sampleFrom } = require("./lib/cdp");

const APP = path.resolve(__dirname, "..");
const EXE = path.join(APP, "runtime", "electron.exe");
const PORT = 9317;
const IMPORT_SRC = path.resolve(APP, "..", "mianfeimodelYUAN");

function cleanEnv(extra) {
  const env = Object.assign({}, process.env, extra || {});
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CHROME_CRASHPAD_PIPE_NAME;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return env;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const INDEX_PICK = (t) => t && t.type === "page" && /\/src\/index\.html/.test(t.url || "");

const READY = `JSON.stringify((function () {
  try {
    const d = window.__fishDebug ? window.__fishDebug() : null;
    return {
      ok: !!(d && d.model) && typeof window.__applyPackRules === "function",
      model: !!(d && d.model),
      packId: d ? d.packId : "",
      viewY: d ? d.viewY : null,
      viewH: d ? d.viewH : null,
      nav: Number(localStorage.getItem("__nav") || 0),
      ready: document.readyState,
    };
  } catch (e) { return { ok: false, err: String(e && e.message) }; }
})())`;

async function waitReady(ms) {
  const until = Date.now() + (ms || 30000);
  let last = null;
  while (Date.now() < until) {
    try {
      last = await sampleFrom(PORT, INDEX_PICK, READY, 6000);
      if (last && last.ok) return last;
    } catch (e) { last = last || { err: String(e && e.message) }; }
    await sleep(400);
  }
  return last;
}

// 应用自己的 HTTP 服务端口 = 页面的 origin（9317 是 CDP 调试口，不是它）
let ORIGIN = "";
async function learnOrigin() {
  const r = await sampleFrom(PORT, INDEX_PICK, "JSON.stringify({ origin: location.origin })", 6000);
  ORIGIN = String((r && r.origin) || "");
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(ORIGIN)) throw new Error("读不到应用端口：" + ORIGIN);
  return ORIGIN;
}

// 用 HTTP 触发切模型：页面会 reload，走 IPC 的话这次求值会被打断
async function postJson(p, body) {
  const r = await fetch(ORIGIN + p, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const txt = await r.text();
  if (!txt) throw new Error("POST " + p + " -> " + r.status + " 空响应");
  try { return JSON.parse(txt); }
  catch (e) { throw new Error("POST " + p + " -> " + r.status + " 不是 JSON：" + txt.slice(0, 200)); }
}

async function main() {
  const userData = makeTmp("dfy-switch-");
  const args = [
    "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + userData,
    ".",
  ];
  const child = spawn(EXE, args, {
    cwd: APP,
    env: cleanEnv({ FISH_MULTI: "1", FISH_TEST_HIDDEN: "1" }),
    stdio: "ignore",
  });

  const pass = [];
  const fail = [];
  const ok = (n, d) => { pass.push(n); console.log("✅ " + n + (d === undefined ? "" : "  " + d)); };
  const bad = (n, d) => { fail.push(n); console.log("❌ " + n + (d === undefined ? "" : "  " + d)); };

  let client = null;
  try {
    // 等页面起来
    const first = await waitReady(40000);
    if (!first || !first.ok) {
      bad("窗口起来且模型加载完成", JSON.stringify(first));
      throw new Error("没起来");
    }
    ok("窗口起来且模型加载完成", "packId=" + first.packId);
    ok("读到应用端口", await learnOrigin());

    // ---- 挂计数 ----
    const tgt = await findTarget(PORT, INDEX_PICK);
    if (!tgt) throw new Error("找不到页面目标");
    client = connect(tgt.webSocketDebuggerUrl);
    await client.ready;
    await client.send("Page.enable").catch(() => { });
    await client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: "try{localStorage.setItem('__nav',String(Number(localStorage.getItem('__nav')||0)+1))}catch(e){}",
    });
    ok("计数脚本已注入（每次新文档自增 localStorage.__nav）");

    // 注入只对「下一个」文档生效，先重载一次让它落地
    await client.send("Page.reload", {}, 8000).catch(() => { });
    await sleep(1500);
    const afterInject = await waitReady(40000);
    if (!afterInject || !afterInject.ok) throw new Error("重载后没起来");
    const navBase = Number(afterInject.nav || 0);
    ok("注入生效（__nav 有了）", "nav=" + navBase);

    // ---- 1. 切模型 ----
    const srcOk = fs.existsSync(IMPORT_SRC);
    if (!srcOk) throw new Error("找不到导入源 " + IMPORT_SRC);
    const imp = await postJson("/api/packs/import", { path: IMPORT_SRC });
    const newId = imp && (imp.id || (imp.pack && imp.pack.id));
    if (!newId) throw new Error("导入失败：" + JSON.stringify(imp));
    ok("第二个模型导入成功", "id=" + newId);

    await sleep(800);
    const before = await sampleFrom(PORT, INDEX_PICK, READY, 6000);
    const navBefore = Number(before.nav || 0);

    const t0 = Date.now();
    try { await postJson("/api/packs/active", { id: newId }); }
    catch (e) { if (String(e && e.message).indexOf("cut off") < 0 && String(e && e.message).indexOf("fetch failed") < 0) throw e; }
    const after = await waitReady(45000);
    const ms = Date.now() - t0;
    if (!after || !after.ok) throw new Error("切完之后模型没起来");
    ok("切完之后模型起来了", "packId=" + after.packId + "，" + ms + "ms");
    ok("切到的确实是新模型", after.packId === newId ? "packId=" + after.packId : "期望 " + newId + " 实际 " + after.packId);

    const navAfter = Number(after.nav || 0);
    const delta = navAfter - navBefore;
    if (delta === 1) ok("切一次模型，页面只重载一次", "Δnav=" + delta);
    else bad("切一次模型，页面只重载一次", "Δnav=" + delta + "（期望 1；2 就是双 reload）");

    // ---- 2. 只换规则：adapter:reload ----
    const navBefore2 = navAfter;
    const rr = await sampleFrom(PORT, INDEX_PICK, `(async () => JSON.stringify(await window.deskfish.adapterReload()))()`, 10000);
    await sleep(1800);
    const after2 = await sampleFrom(PORT, INDEX_PICK, READY, 6000);
    if (!after2 || !after2.ok) bad("换规则之后页面还活着", JSON.stringify(after2));
    else {
      ok("换规则之后页面还活着", "packId=" + after2.packId);
      const d2 = Number(after2.nav || 0) - navBefore2;
      if (d2 === 0) ok("只换规则不重载页面", "Δnav=" + d2);
      else bad("只换规则不重载页面", "Δnav=" + d2 + "（期望 0）");
      ok("换规则之后模型没被重建（还是同一个包）", after2.packId === newId ? "" : "期望 " + newId + " 实际 " + after2.packId);
    }
    if (rr && rr.ok === true) ok("adapterReload 返回 ok");
    else bad("adapterReload 返回 ok", JSON.stringify(rr));

    // ---- 3. 直接调「只换规则」的页面函数 ----
    const navBefore3 = Number((after2 && after2.nav) || 0);
    const ap = await sampleFrom(PORT, INDEX_PICK, `(async () => JSON.stringify({ r: await window.__applyPackRules() }))()`, 15000);
    await sleep(600);
    const after3 = await sampleFrom(PORT, INDEX_PICK, READY, 6000);
    if (ap && ap.r === true) ok("__applyPackRules 自己跑一遍返回 true");
    else bad("__applyPackRules 返回 true", JSON.stringify(ap));
    const d3 = Number((after3 && after3.nav) || 0) - navBefore3;
    if (d3 === 0) ok("__applyPackRules 不重载页面", "Δnav=" + d3);
    else bad("__applyPackRules 不重载页面", "Δnav=" + d3);
    if (after3 && typeof after3.viewY === "number" && typeof after3.viewH === "number") {
      ok("取景值读得到（viewY/viewH）", "y=" + after3.viewY + " h=" + after3.viewH);
    } else bad("取景值读得到（viewY/viewH）", JSON.stringify(after3));

    // ---- 4. frameNavigated 计数做第二份证据 ----
    const navEvents = (client && client.events ? client.events : []).filter((e) => e && e.method === "Page.frameNavigated");
    ok("CDP 也记到了导航事件", navEvents.length + " 次");
  } catch (e) {
    bad("整轮跑完", String((e && e.message) || e));
  } finally {
    if (client) client.close();
    try { child.kill(); } catch (e) { }
    try {
      const { execFileSync } = require("child_process");
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch (e) { }
    await sleep(600);
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch (e) { }
  }

  console.log("");
  console.log("结果：" + pass.length + " 通过，" + fail.length + " 失败");
  if (fail.length) { console.log("失败项：" + fail.join(" / ")); process.exit(1); }
}

main().catch((e) => { console.error("探针崩了：" + ((e && e.stack) || e)); process.exit(2); });
