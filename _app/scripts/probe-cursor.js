"use strict";
// 人不在的时候，主进程还在往渲染进程推鼠标坐标吗？
// 锁屏 / 休眠 / 最小化 / 手动暂停，这四个来源都走 setPauseReason —— 探针直接用它。
const { spawn } = require("child_process");
const fs = require("fs");
const { makeTmp } = require("./lib/tmp");
const os = require("os");
const path = require("path");
const { sampleFrom, findTarget } = require("./lib/cdp");

const APP = path.resolve(__dirname, "..");
const EXE = path.join(APP, "runtime", "electron.exe");
const PORT = Number(process.env.PROBE_PORT || 9321);
const KEEP = process.argv.includes("--keep");

const args = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const WAIT_MS = Number(argOf("wait", 12000));
const SAMPLE_MS = Number(argOf("sample", 1200));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function killTree(pid) {
  try { spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" }); } catch (e) { }
}

function cleanEnv(extra) {
  const env = Object.assign({}, process.env, extra || {});
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CHROME_CRASHPAD_PIPE_NAME;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return env;
}

const PAGE_PICK = (x) => x && x.type === "page" && /\/src\/index\.html/.test(x.url || "");
const PROBE = "JSON.stringify({ ready: document.readyState, has: typeof (window.deskfish && window.deskfish.testCursorFeed) === 'function' })";

async function waitReady(deadline) {
  while (Date.now() < deadline) {
    try {
      const r = await sampleFrom(PORT, PAGE_PICK, PROBE, 4000);
      if (r && r.ready === "complete" && r.has) return true;
    } catch (e) { }
    await sleep(300);
  }
  return false;
}

// 读一次计数（走真 IPC）
const READ = "window.deskfish.testCursorFeed()";
// 模拟「人不在」/「人回来」
const PAUSE = (on) => `(window.deskfish.testPauseRender(${on ? "true" : "false"}), true)`;

(async () => {
  const userData = makeTmp("dfy-cursor-");
  const child = spawn(EXE, ["--remote-debugging-port=" + PORT, "--user-data-dir=" + userData, "."], {
    cwd: APP,
    env: cleanEnv({ FISH_MULTI: "1", FISH_TEST_HIDDEN: "1" }),
    stdio: "ignore",
  });

  const results = [];
  const ok = (name, cond, detail) => {
    results.push({ name, pass: !!cond, detail });
    console.log((cond ? "✅ " : "❌ ") + name + (detail !== undefined ? "  " + JSON.stringify(detail) : ""));
  };

  try {
    if (!(await waitReady(Date.now() + WAIT_MS))) {
      throw new Error("页面没准备好（" + WAIT_MS + "ms）");
    }
    await sleep(1200);

    // A 正常：一秒内应该推几十帧
    const a1 = await sampleFrom(PORT, PAGE_PICK, READ, 6000);
    await sleep(SAMPLE_MS);
    const a2 = await sampleFrom(PORT, PAGE_PICK, READ, 6000);
    const dA = (a2 && a2.sent || 0) - (a1 && a1.sent || 0);
    ok("正常运行时坐标一直在推", dA >= 10, { from: a1 && a1.sent, to: a2 && a2.sent, delta: dA });
    ok("正常运行时不算暂停", a2 && a2.paused === false, a2 && a2.paused);

    // B 暂停（等价于锁屏 / 最小化）：应该一帧都不推
    await sampleFrom(PORT, PAGE_PICK, PAUSE(true), 6000);
    await sleep(400);
    const b1 = await sampleFrom(PORT, PAGE_PICK, READ, 6000);
    await sleep(SAMPLE_MS);
    const b2 = await sampleFrom(PORT, PAGE_PICK, READ, 6000);
    const dB = (b2 && b2.sent || 0) - (b1 && b1.sent || 0);
    ok("暂停之后一帧都不该推（锁屏一整夜就是几百万次白唤醒）", dB === 0, { delta: dB });
    ok("暂停状态读得到", b2 && b2.paused === true, b2 && b2.paused);

    // C 恢复：应该重新开始推
    await sampleFrom(PORT, PAGE_PICK, PAUSE(false), 6000);
    await sleep(400);
    const c1 = await sampleFrom(PORT, PAGE_PICK, READ, 6000);
    await sleep(SAMPLE_MS);
    const c2 = await sampleFrom(PORT, PAGE_PICK, READ, 6000);
    const dC = (c2 && c2.sent || 0) - (c1 && c1.sent || 0);
    ok("恢复之后接着推", dC >= 10, { delta: dC });
    ok("恢复之后不算暂停", c2 && c2.paused === false, c2 && c2.paused);

    // D 暂停期间渲染进程也该是停的（同一条通路，顺手验一下没被拆开）
    await sampleFrom(PORT, PAGE_PICK, PAUSE(true), 6000);
    await sleep(300);
    const dbg = await sampleFrom(PORT, PAGE_PICK, "JSON.stringify(window.__fishDebug ? window.__fishDebug() : {})", 6000);
    ok("暂停时渲染端确实停着（同一来源控制两边）", dbg && dbg.paused === true, dbg && dbg.paused);
    await sampleFrom(PORT, PAGE_PICK, PAUSE(false), 6000);

    const pass = results.filter((r) => r.pass).length;
    const fail = results.length - pass;
    console.log("\n结果：" + pass + " 通过，" + fail + " 失败");
    killTree(child.pid);
    if (!KEEP) { await sleep(600); try { fs.rmSync(userData, { recursive: true, force: true }); } catch (e) { } }
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.error("探针失败：" + (e && e.message ? e.message : e));
    try { killTree(child.pid); } catch (e2) { }
    if (!KEEP) { await sleep(600); try { fs.rmSync(userData, { recursive: true, force: true }); } catch (e3) { } }
    process.exit(2);
  }
})();
