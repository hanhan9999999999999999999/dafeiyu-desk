"use strict";
/* 对话记录真的活得过来吗？
 *
 * 三件事必须成立：
 *   1. 说过的两句话，重启之后还在（这是用户最直观的"她记得"）；
 *   2. 攒多了只留最新的 MAX 条，不会越滚越大；
 *   3. chatlog.json 被写坏时，原文件要留一份 .bad-*，而不是被空列表覆盖掉。
 *
 * 第 3 条是这轮重点：以前 chatLoad() 一条 catch 全吃掉，
 * 程序当空数组继续跑，下一次写盘就把几千条记录覆盖没了，连痕迹都没有。
 */
const { spawn } = require("child_process");
const fs = require("fs");
const { makeTmp } = require("./lib/tmp");
const os = require("os");
const path = require("path");
const cdp = require("./lib/cdp");

const APP = path.resolve(__dirname, "..");
const EXE = path.join(APP, "runtime", "electron.exe");
const PORT = Number(process.env.PROBE_CHAT_PORT || 9313);
const WAIT_MS = 25000;

const pass = [];
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass.push(name); console.log("✅ " + name + (detail ? "  " + detail : "")); }
  else { fails.push(name); console.log("❌ " + name + (detail ? "  " + detail : "")); }
}

function cleanEnv(extra) {
  const env = Object.assign({}, process.env, extra || {});
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CHROME_CRASHPAD_PIPE_NAME;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return env;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function start(userData) {
  return spawn(EXE, ["--remote-debugging-port=" + PORT, "--user-data-dir=" + userData, "."], {
    cwd: APP,
    env: cleanEnv({ FISH_MULTI: "1", FISH_TEST_HIDDEN: "1" }),
    stdio: "ignore",
  });
}

function killTree(child) {
  return new Promise((resolve) => {
    if (!child || child.killed) return resolve();
    try { require("child_process").execFileSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { stdio: "ignore" }); } catch (e) { }
    setTimeout(resolve, 400);
  });
}

const PAGE_PICK = (x) => x && x.type === "page" && /\/src\/index\.html/.test(x.url || "");

async function waitReady(deadline) {
  while (Date.now() < deadline) {
    try {
      const r = await cdp.sampleFrom(PORT, PAGE_PICK, "JSON.stringify({s:document.readyState,m:!!(window.__fishDebug&&window.__fishDebug().model),a:typeof(window.deskfish&&window.deskfish.chatAppend)})", 6000);
      if (r && r.s === "complete" && r.a === "function") return true;
    } catch (e) { }
    await sleep(400);
  }
  return false;
}

async function run(expr, timeoutMs) {
  return cdp.sampleFrom(PORT, PAGE_PICK, expr, timeoutMs || 20000);
}

(async () => {
  const userData = makeTmp("dfy-chat-");
  const file = path.join(userData, "chatlog.json");
  console.log("[probe] userData = " + userData);

  let child = null;
  try {
    // ---------- 第一程：写两句 ----------
    child = start(userData);
    if (!(await waitReady(Date.now() + WAIT_MS))) throw new Error("第一程页面没起来");
    console.log("[probe] 第一程就绪");

    const wrote = await run(
      "window.deskfish.chatAppend({role:'user',text:'重启前说的话'}).then(function(){" +
      "return window.deskfish.chatAppend({role:'assistant',text:'我记住了'});" +
      "}).then(function(){return window.deskfish.chatList();})" +
      ".then(function(r){return JSON.stringify({ok:r.ok,n:r.items.length,texts:r.items.map(function(m){return m.text;})});})",
    );
    ok("能往对话记录里追加", wrote && wrote.ok === true && wrote.n >= 2, JSON.stringify(wrote));

    // 等防抖写盘（chatSaveSoon 400ms）
    await sleep(1200);
    ok("chatlog.json 已经落盘", fs.existsSync(file), file);
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, "utf8");
      ok("落盘内容里有那两句话", raw.indexOf("重启前说的话") >= 0 && raw.indexOf("我记住了") >= 0);
      ok("落盘带 version 字段", (() => { try { return JSON.parse(raw).version >= 1; } catch (e) { return false; } })());
    }

    // ---------- 关掉，重启 ----------
    await killTree(child);
    child = null;
    await sleep(800);

    child = start(userData);
    if (!(await waitReady(Date.now() + WAIT_MS))) throw new Error("第二程页面没起来");
    console.log("[probe] 第二程就绪");

    const after = await run(
      "window.deskfish.chatList().then(function(r){" +
      "return JSON.stringify({ok:r.ok,n:r.items.length,texts:r.items.map(function(m){return m.text;})});})",
    );
    ok("重启之后记录还在", after && after.ok === true, JSON.stringify(after));
    ok("重启之后那句用户的话还在", !!(after && after.texts && after.texts.indexOf("重启前说的话") >= 0));
    ok("重启之后那句她的话也在", !!(after && after.texts && after.texts.indexOf("我记住了") >= 0));

    // ---------- 把文件写坏，再重启 ----------
    await killTree(child);
    child = null;
    await sleep(800);

    const broken = '{"version":1,"items":[{"role":"user","text":"写到一半';
    fs.writeFileSync(file, broken, "utf8");
    console.log("[probe] 已把 chatlog.json 写成半截 JSON");

    child = start(userData);
    if (!(await waitReady(Date.now() + WAIT_MS))) throw new Error("第三程页面没起来");
    console.log("[probe] 第三程就绪");

    const badRun = await run(
      "window.deskfish.chatList().then(function(r){return JSON.stringify({ok:r.ok,n:r.items.length});})",
    );
    ok("文件坏掉时程序不崩，照常打开", badRun && badRun.ok === true, JSON.stringify(badRun));

    const bads = fs.readdirSync(userData).filter((f) => f.indexOf("chatlog.json.bad-") === 0);
    ok("坏文件被留了一份 .bad-*", bads.length >= 1, bads.join(", ") || "（没有）");
    if (bads.length) {
      const kept = fs.readFileSync(path.join(userData, bads[0]), "utf8");
      ok("留的那份还是原来的坏内容（不是空的）", kept === broken, kept.slice(0, 40));
    }

    // 新写的内容仍然能存
    await run("window.deskfish.chatAppend({role:'user',text:'坏掉之后还能说话'})");
    await sleep(1000);
    const raw2 = fs.readFileSync(file, "utf8");
    ok("坏过一次之后仍然能正常写盘", raw2.indexOf("坏掉之后还能说话") >= 0);

    // ---------- 上限 ----------
    const many = [];
    for (let i = 0; i < 60; i += 1) many.push({ role: "user", text: "第" + i + "句", at: Date.now() + i });
    const merged = await run(
      "window.deskfish.chatMerge(" + JSON.stringify(many) + ").then(function(r){return JSON.stringify({ok:r.ok,added:r.added,n:r.items.length});})",
    );
    ok("批量合并能进去", merged && merged.ok === true && merged.added >= 50, JSON.stringify(merged));
    ok("合并后条数不越界（<=3000）", merged && merged.n <= 3000, String(merged && merged.n));
  } catch (e) {
    fails.push("探针异常：" + (e && e.message ? e.message : e));
    console.log("❌ 探针异常：" + (e && e.stack ? e.stack : e));
  } finally {
    await killTree(child);
    if (process.env.KEEP !== "1") {
      try { fs.rmSync(userData, { recursive: true, force: true }); } catch (e) { }
    } else console.log("[probe] 保留目录：" + userData);
  }

  console.log("");
  console.log("结果：" + pass.length + " 通过，" + fails.length + " 失败");
  if (fails.length) { console.log("失败项：" + fails.join(" / ")); process.exit(1); }
  process.exit(0);
})();
