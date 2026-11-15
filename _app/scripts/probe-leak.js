"use strict";
// churn / soak 只看句柄总数，看不见 EventEmitter 上的监听器堆积。
//
// 一条监听器泄漏长这样：句柄数不变、内存涨得慢、功能还「正常」，
// 但每次触发那个事件，回调就多跑一遍 —— 三小时后 CPU 莫名其妙高，
// 谁也说不清是哪一行加的。
//
// 本探针反复走三条热路径，然后逐个数长生命周期 emitter 上的监听器：
//   A. 改设置 30 次（applySettings 是每次改设置都要跑的热路径）
//   B. 开关设置窗 12 次（窗口反复建/销，最容易把监听挂在不该挂的地方）
//   C. 开关适配器 6 次（最重的面板，加载真模型规则）
//
// 判定：app / ipcMain / powerMonitor / screen 四个长生命周期 emitter 的
// 监听器总数与 ipc 频道数，结束后必须与基线**完全相等**（不是「涨幅小」，
// 是相等 —— 这几处一次都不该加）。句柄允许 ±2（Chromium 自己会抖动）。
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { makeTmp } = require("./lib/tmp");
const { findTarget, sampleFrom } = require("./lib/cdp");

const APP = path.resolve(__dirname, "..");
const EXE = path.join(APP, "runtime", "electron.exe");
const PORT = Number(process.env.PROBE_PORT || 9331);

const argv = process.argv.slice(2);
const KEEP = argv.includes("--keep");
const ROUNDS_A = Number((argv.find((a) => /^--a=/.test(a)) || "").split("=")[1]) || 30;
const ROUNDS_B = Number((argv.find((a) => /^--b=/.test(a)) || "").split("=")[1]) || 12;
const ROUNDS_C = Number((argv.find((a) => /^--c=/.test(a)) || "").split("=")[1]) || 6;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (n, e) => { pass++; console.log("✅ " + n + (e ? "  " + e : "")); };
const bad = (n, e) => { fail++; console.log("❌ " + n + (e ? "  " + e : "")); };
const want = (n, c, e) => (c ? ok(n, e) : bad(n, e));

function cleanEnv(extra) {
  const env = Object.assign({}, process.env, extra || {});
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CHROME_CRASHPAD_PIPE_NAME;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return env;
}
function killTree(pid) {
  try { spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" }); } catch (e) { }
}

const INDEX_PICK = (t) => t && t.type === "page" && /\/src\/index\.html/.test(t.url || "");
const SETTINGS_PICK = (t) => t && t.type === "page" && /\/src\/settings\.html/.test(t.url || "");

const SNAP = `window.deskfish.testListeners()`;

const snap = () => sampleFrom(PORT, INDEX_PICK, SNAP, 8000);

const sumOf = (o) => {
  if (!o || typeof o !== "object") return 0;
  let n = 0;
  for (const k of Object.keys(o)) n += Number(o[k]) || 0;
  return n;
};

async function main() {
  const userData = makeTmp("dfy-leak-");
  const child = spawn(EXE, [
    "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + userData,
    ".",
  ], { cwd: APP, env: cleanEnv({ FISH_MULTI: "1", FISH_TEST_HIDDEN: "1" }), stdio: "ignore" });

  try {
    const t0 = Date.now();
    let ready = false;
    while (Date.now() - t0 < 45000) {
      try {
        const t = await findTarget(PORT, INDEX_PICK);
        if (t) {
          const r = await sampleFrom(PORT, INDEX_PICK,
            `JSON.stringify({ s: document.readyState, m: !!(window.__fishDebug && window.__fishDebug().model), f: typeof window.deskfish.testListeners })`, 5000);
          const v = typeof r === "string" ? JSON.parse(r) : r;
          if (v && v.s === "complete" && v.m === true && v.f === "function") { ready = true; break; }
        }
      } catch (e) { }
      await sleep(300);
    }
    if (!ready) throw new Error("窗口没起来（readyState / model / testListeners 三项没同时就绪）");

    /* 基线必须等窗口数稳定：firstRun 时引导卡在 4.2 秒后才弹，
       先等过那一下、再关一次、再采基线，否则「基线 1 → 结束 2」会被误判成漏窗口。 */
    await sleep(4500);
    await sampleFrom(PORT, INDEX_PICK, "window.deskfish.closeWelcome && window.deskfish.closeWelcome()", 6000).catch(() => null);
    await sleep(1000);
    const base = await snap();
    want("能读到监听器快照", !!base && base.ok === true);
    want("基线：主窗口在", base.windows >= 1, "windows=" + base.windows);
    const bApp = sumOf(base.app), bIpc = sumOf(base.ipc), bPow = sumOf(base.power), bScr = sumOf(base.screen);
    const bCh = base.ipcChannels, bH = base.handles;
    console.log("   基线：app " + bApp + " / ipcMain " + bIpc + "（" + bCh + " 个频道）/ power " + bPow +
      " / screen " + bScr + " / 句柄 " + bH);

    // ── A：改设置 30 次 ────────────────────────────────
    const aRes = await sampleFrom(PORT, INDEX_PICK, `(async function () {
      const t0 = Date.now();
      for (let i = 0; i < ${ROUNDS_A}; i++) {
        await window.deskfish.settingsPatch({ volume: 0.3 + (i % 5) * 0.1 });
      }
      return JSON.stringify({ ok: true, ms: Date.now() - t0 });
    })()`, 30000);
    const afterA = await snap();
    const aMs = aRes && Number(aRes.ms) || 0;
    console.log("   A 段：" + ROUNDS_A + " 次改设置用了 " + aMs + "ms");
    want("A 之后 app 监听器没多", sumOf(afterA.app) === bApp, sumOf(afterA.app) + " vs " + bApp);
    want("A 之后 ipcMain 监听器没多", sumOf(afterA.ipc) === bIpc, sumOf(afterA.ipc) + " vs " + bIpc);
    want("A 之后 ipc 频道数没多", afterA.ipcChannels === bCh, afterA.ipcChannels + " vs " + bCh);

    // ── B：开关设置窗 12 次 ────────────────────────────
    for (let i = 0; i < ROUNDS_B; i++) {
      await sampleFrom(PORT, INDEX_PICK, "window.deskfish.openSettings()", 8000).catch(() => null);
      await sleep(260);
      /* 设置窗 DOM 就绪再关，否则关的是一个还没开始加载的壳 */
      try {
        const st = await findTarget(PORT, SETTINGS_PICK);
        if (st) {
          await sampleFrom(PORT, SETTINGS_PICK,
            `JSON.stringify({ s: document.readyState })`, 4000).catch(() => null);
        }
      } catch (e) { }
      await sampleFrom(PORT, INDEX_PICK, "window.deskfish.closeSettings()", 8000).catch(() => null);
      await sleep(220);
    }
    await sleep(700);
    const afterB = await snap();
    console.log("   B 段：" + ROUNDS_B + " 次开关设置窗完，windows=" + afterB.windows + " 句柄 " + afterB.handles);
    want("B 之后窗口数回到基线", afterB.windows === base.windows, afterB.windows + " vs " + base.windows);
    want("B 之后 app 监听器没多", sumOf(afterB.app) === bApp, sumOf(afterB.app) + " vs " + bApp);
    want("B 之后 ipcMain 监听器没多", sumOf(afterB.ipc) === bIpc, sumOf(afterB.ipc) + " vs " + bIpc);
    want("B 之后 ipc 频道数没多", afterB.ipcChannels === bCh, afterB.ipcChannels + " vs " + bCh);
    want("B 之后 screen 监听器没多", sumOf(afterB.screen) === bScr, sumOf(afterB.screen) + " vs " + bScr);

    // ── C：开关适配器 6 次（最重的面板）────────────────
    for (let i = 0; i < ROUNDS_C; i++) {
      await sampleFrom(PORT, INDEX_PICK, 'window.deskfish.openAdapter("", "")', 8000).catch(() => null);
      await sleep(420);
      await sampleFrom(PORT, INDEX_PICK, "window.deskfish.closeAdapter()", 8000).catch(() => null);
      await sleep(320);
    }
    await sleep(900);
    const afterC = await snap();
    console.log("   C 段：" + ROUNDS_C + " 次开关适配器完，windows=" + afterC.windows + " 句柄 " + afterC.handles);
    want("C 之后窗口数回到基线", afterC.windows === base.windows, afterC.windows + " vs " + base.windows);
    want("C 之后 app 监听器没多", sumOf(afterC.app) === bApp, sumOf(afterC.app) + " vs " + bApp);
    want("C 之后 ipcMain 监听器没多", sumOf(afterC.ipc) === bIpc, sumOf(afterC.ipc) + " vs " + bIpc);
    want("C 之后 power 监听器没多", sumOf(afterC.power) === bPow, sumOf(afterC.power) + " vs " + bPow);
    want("C 之后 ipc 频道数没多", afterC.ipcChannels === bCh, afterC.ipcChannels + " vs " + bCh);

    const hDelta = afterC.handles - bH;
    want("句柄没随着三轮往上爬（只许降，涨不超过 2）", hDelta <= 2,
      bH + " → " + afterC.handles + "（" + (hDelta >= 0 ? "+" : "") + hDelta + "）");

    /* 主窗口自己的监听器：onCursor / onSettingsChanged 这些都在 IIFE 顶层订一次，
       三轮跑完应该一模一样；不一样就是有人在热路径里又订了一次。 */
    const bWin = sumOf(base.contents), aWin = sumOf(afterC.contents);
    want("主窗口 webContents 监听器没多", aWin === bWin, aWin + " vs " + bWin);

    console.log("");
    console.log("结果：" + pass + " 通过，" + fail + " 失败");
    console.log("句柄种类：" + JSON.stringify(afterC.kinds));
  } catch (e) {
    bad("探针自身没跑完", String(e && e.message || e));
    console.log("结果：" + pass + " 通过，" + fail + " 失败");
    process.exitCode = 1;
  } finally {
    if (!KEEP) {
      killTree(child.pid);
      await sleep(600);
      try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { }
    } else {
      console.log("（--keep：进程与 " + userData + " 留着）");
    }
  }
}

main().then(() => { if (fail) process.exitCode = 1; }).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
