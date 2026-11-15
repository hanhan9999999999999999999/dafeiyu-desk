"use strict";
/**
 * probe-reconnect —— 桥接断开又回来的时候，她还是不是她自己。
 *
 * 真机上很难把 DSH 桥停掉再拉起来（还会碰到别的会话），所以这里自己起一个
 * 假桥：同一个端口、四种应答（正常 / 忙 / 端口上有别人 / 直接掐断）。
 * 页面通过设置里的 bridgeUrl 指过来 —— 走的是真实的那条 pollDsh 通路。
 *
 * 验四件事：
 *   1. 桥是「忙」的时候她该挂着思考相（这是别人在忙，不是她在忙）。
 *   2. 桥**断了**之后她不能一直挂着思考相，而且要主动说一句。
 *   3. 桥**回来**之后要自己回到正常，并说一句「连上了」。
 *   4. 一次网络抖动（只失败一轮）不该让她当场变脸。
 */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const { makeTmp } = require("./lib/tmp");
const { sampleFrom } = require("./lib/cdp");

const APP = path.resolve(__dirname, "..");
const EXE = path.join(APP, "runtime", "electron.exe");
const PORT = Number(process.env.PROBE_PORT || 9337);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function fmt(x) {
  try {
    const s = typeof x === "string" ? x : JSON.stringify(x);
    return s.length > 200 ? s.slice(0, 200) + "…" : s;
  } catch (e) {
    return String(x);
  }
}
function ok(name, cond, extra) {
  if (cond) {
    pass += 1;
    console.log("✅ " + name + (extra !== undefined ? "  " + fmt(extra) : ""));
  } else {
    fail += 1;
    console.log("❌ " + name + (extra !== undefined ? "  " + fmt(extra) : ""));
  }
}

const MAIN_PICK = (x) => x && x.type === "page" && /\/src\/index\.html/.test(x.url || "");

function cleanEnv() {
  const env = Object.assign({}, process.env, { FISH_MULTI: "1", FISH_TEST_HIDDEN: "1" });
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CHROME_CRASHPAD_PIPE_NAME;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return env;
}
function killTree(pid) {
  try { spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" }); } catch (e) { }
}

/* ---------- 假桥：mode = ok | busy | foreign | down ---------- */
let mode = "ok";
let bridge = null;
let bridgePort = 0;

function startBridge() {
  return new Promise((resolve, reject) => {
    const s = http.createServer((req, res) => {
      if (String(req.url || "").indexOf("/api/health") !== 0) {
        res.writeHead(404);
        return res.end("no");
      }
      if (mode === "down") {
        // 直接掐断：fetch 会 reject，和「DSH 关了 / 端口没人听」一个效果
        try { req.socket.destroy(); } catch (e) { }
        return;
      }
      // 页面在 127.0.0.1:7801，桥在另一个端口 —— 跨源，必须给 CORS 头，
      // 否则 fetch 会被浏览器直接拦掉，看起来和「桥挂了」一模一样。
      res.writeHead(200, {
        "content-type": "application/json",
        "access-control-allow-origin": "*",
      });
      if (mode === "foreign") return res.end(JSON.stringify({ hello: "not-a-bridge" }));
      res.end(JSON.stringify({ app: "dsh-phone-bridge", busy: mode === "busy", queued: 0 }));
    });
    s.on("error", reject);
    s.listen(0, "127.0.0.1", () => {
      bridge = s;
      bridgePort = s.address().port;
      resolve();
    });
  });
}

/* ---------- 页面内 ---------- */
const WATCH = `(() => {
  if (!window.__said) {
    window.__said = [];
    try {
      const b = document.getElementById("bubble");
      if (b) {
        let last = "";
        new MutationObserver(() => {
          const t = String(b.textContent || "").trim();
          if (t && t !== last) { last = t; window.__said.push(t); }
        }).observe(b, { childList: true, characterData: true, subtree: true });
      }
    } catch (e) { }
  }
  return { watched: true };
})()`;

const SNAP = `(() => {
  const d = window.__fishDebug ? window.__fishDebug() : {};
  return { phase: d.phase, link: d.link, dshFail: d.dshFail, base: d.bridgeBase,
           said: (window.__said || []).slice(-6), saidCount: (window.__said || []).length };
})()`;

async function snap() {
  try {
    return await sampleFrom(PORT, MAIN_PICK, SNAP, 6000);
  } catch (e) {
    return { err: String(e && e.message ? e.message : e) };
  }
}

async function waitMain(deadline) {
  while (Date.now() < deadline) {
    try {
      const r = await sampleFrom(
        PORT,
        MAIN_PICK,
        "({ ready: document.readyState, model: !!(window.__fishDebug && window.__fishDebug().model) })",
        4000
      );
      if (r && r.ready === "complete" && r.model) return true;
    } catch (e) { }
    await sleep(300);
  }
  return false;
}

async function main() {
  await startBridge();
  const url = "http://127.0.0.1:" + bridgePort;
  const userData = makeTmp("dfy-reconnect-");

  const child = spawn(EXE, ["--remote-debugging-port=" + PORT, "--user-data-dir=" + userData, "."], {
    cwd: APP,
    env: cleanEnv(),
    stdio: "ignore",
  });

  try {
    if (!(await waitMain(Date.now() + 45000))) throw new Error("等不到模型起来");
    await sampleFrom(PORT, MAIN_PICK, WATCH, 4000);

    // 指到假桥（走真实的 settingsPatch → onSettingsChanged → syncBridgeBase）
    await sampleFrom(PORT, MAIN_PICK, "window.deskfish.settingsPatch({ bridgeUrl: " + JSON.stringify(url) + " })", 6000);
    await sleep(9000);

    /* A：正常 */
    const a = await snap();
    ok("接上一个好的桥之后是「连着」", a.link === "ok", { link: a.link });
    ok("正常时她不挂思考相", a.phase !== "thinking", { phase: a.phase });
    ok("地址跟到了设置里填的那个", a.base === url, { base: a.base });

    /* B：桥说忙 */
    mode = "busy";
    await sleep(9500);
    const b = await snap();
    ok("桥说忙的时候她挂着思考相", b.phase === "thinking", { phase: b.phase, link: b.link });
    ok("忙的时候仍然算连着", b.link === "ok", { link: b.link });

    /* C：桥断了（连续两轮才算） */
    mode = "down";
    await sleep(19500);
    const c = await snap();
    ok("桥断了之后不再挂着思考相", c.phase !== "thinking", { phase: c.phase });
    ok("桥断了之后状态标成断开", c.link === "down", { link: c.link, dshFail: c.dshFail });
    const saidC = (c.said || []).join(" | ");
    ok("断的时候她主动说了一句", saidC.indexOf("连不上 DSH") >= 0, saidC.slice(-90));

    /* D：桥回来了 */
    mode = "ok";
    await sleep(9500);
    const d = await snap();
    ok("桥回来之后状态回到连着", d.link === "ok", { link: d.link, dshFail: d.dshFail });
    ok("回来的时候她说了一句「连上了」", (d.said || []).join(" | ").indexOf("连上了") >= 0, (d.said || []).join(" | ").slice(-70));
    ok("回来之后思考相已经复位", d.phase !== "thinking", { phase: d.phase });

    /* E：端口上有服务但不是自家桥 */
    mode = "foreign";
    await sleep(19500);
    const e = await snap();
    ok("端口上答话的不是自家桥也算断", e.link === "down", { link: e.link });

    /* F：一次抖动不算断 */
    mode = "ok";
    await sleep(9500);
    const before = await snap();
    const saidAt = Number(before.saidCount || 0);
    mode = "down";
    await sleep(1000); // 不到一轮，最多打到一次
    mode = "ok";
    await sleep(9500);
    const f = await snap();
    // 只看这一段之后新增的话：said 是整个会话累积下来的
    const fresh = (f.said || []).slice(Math.max(0, (f.said || []).length - Math.max(0, (f.saidCount || 0) - saidAt)));
    ok("一次抖动之后仍然是连着", f.link === "ok", { link: f.link, dshFail: f.dshFail });
    ok("抖动没有让她说「连不上」", fresh.join(" | ").indexOf("连不上 DSH") < 0,
      { before: before.link, fresh: fresh.join(" | ").slice(-70) });
  } finally {
    try { killTree(child.pid); } catch (e) { }
    await sleep(700);
    try { bridge.close(); } catch (e) { }
    try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { }
  }

  console.log("");
  console.log("结果：" + pass + " 通过，" + fail + " 失败");
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("探针自己出错：" + (e && e.stack ? e.stack : e));
  try { if (bridge) bridge.close(); } catch (e2) { }
  process.exit(1);
});
