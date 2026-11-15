"use strict";
// 人不在的时候，周期任务真的停了吗？
//
// 这条线上一轮只堵住了「推鼠标坐标」一个口子，本探针查另外两处：
//   1) 主进程每 2 秒的 DSH 活跃度扫描（两层 readdir + 每个会话一次 statSync）
//   2) 渲染进程每 8 秒打一次桥的 /api/health
// 两处都加了计数，用「暂停前后增不增」证明它们真的停了。
//
// seeTick（看屏幕）没有计数可读、而且要真截图，所以只在 verify-src 里静态钉住，
// 不在这个探针里假装验过。
const fs = require("fs");
const { makeTmp } = require("./lib/tmp");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { findTarget } = require("./lib/cdp");
const { sampleFrom, evalOn, connect } = require("./lib/cdp");

const APP = path.resolve(__dirname, "..");
const EXE = path.join(APP, "runtime", "electron.exe");
const PORT = Number(process.env.PROBE_PORT || 9323);

const argv = process.argv.slice(2);
const KEEP = argv.includes("--keep");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(name, extra) { pass++; console.log("✅ " + name + (extra ? "  " + extra : "")); }
function bad(name, extra) { fail++; console.log("❌ " + name + (extra ? "  " + extra : "")); }
function want(name, cond, extra) { if (cond) ok(name, extra); else bad(name, extra); }

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

const PAGE_PICK = {
  stats: `(async function () {
    const st = await window.deskfish.testIdleStats();
    return JSON.stringify({
      ok: true,
      scans: st.scans,
      paused: st.paused,
      polls: window.__dshPolls || 0,
      debug: typeof window.__fishDebug === "function" ? !!window.__fishDebug().paused : null,
    });
  })()`,
};

async function readStats() {
  const r = await sampleFrom(PORT, INDEX_PICK, PAGE_PICK.stats, 6000);
  return r;
}

async function main() {
  const userData = makeTmp("dfy-idle-");
  const child = spawn(EXE, [
    "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + userData,
    ".",
  ], { cwd: APP, env: cleanEnv({ FISH_MULTI: "1", FISH_TEST_HIDDEN: "1" }), stdio: "ignore" });

  try {
    // 等页面真的能用：target 出现 ≠ DOM 好了 ≠ 通道就绪
    const t0 = Date.now();
    let ready = false;
    while (Date.now() - t0 < 40000) {
      try {
        const t = await findTarget(PORT, INDEX_PICK);
        if (t) {
          const r = await sampleFrom(PORT, INDEX_PICK,
            `JSON.stringify({ s: document.readyState, f: typeof window.deskfish.testIdleStats })`, 4000);
          if (r && r.s === "complete" && r.f === "function") { ready = true; break; }
        }
      } catch (e) { }
      await sleep(400);
    }
    if (!ready) throw new Error("页面没就绪（testIdleStats 不可用）");

    // ---------- A 正常：两处都该在动 ----------
    // 桥接是 8 秒一拍，所以这里不能只等 3 秒就下结论 —— 得等它真的走过一拍。
    const a1 = await readStats();
    let a2 = a1;
    const tWait = Date.now();
    while (Date.now() - tWait < 14000) {
      await sleep(1200);
      a2 = await readStats();
      if (a2.polls >= 1 && a2.scans - a1.scans >= 1) break;
    }
    const dScanA = a2.scans - a1.scans;
    const dPollA = a2.polls - a1.polls;
    want("正常时 DSH 活跃度扫描在跑（每 2 秒一次）", dScanA >= 1, JSON.stringify({ from: a1.scans, to: a2.scans, delta: dScanA }));
    want("正常时桥接轮询在跑（每 8 秒一次）", dPollA >= 1, JSON.stringify({ from: a1.polls, to: a2.polls, delta: dPollA }));

    // ---------- B 暂停：两处都该停 ----------
    await sampleFrom(PORT, INDEX_PICK, `window.deskfish.testPauseRender(true) ? "1" : "1"`, 4000);
    await sleep(500);
    const b1 = await readStats();
    // 等过一整个 8 秒周期，才能证明桥接那一路也停了
    await sleep(9500);
    const b2 = await readStats();
    const dScanB = b2.scans - b1.scans;
    const dPollB = b2.polls - b1.polls;
    want("暂停状态读得到", b2.paused === true, JSON.stringify({ paused: b2.paused, debug: b2.debug }));
    want("暂停后 DSH 活跃度扫描不再跑", dScanB === 0, JSON.stringify({ delta: dScanB }));
    want("暂停后桥接轮询不再跑", dPollB === 0, JSON.stringify({ delta: dPollB }));

    // ---------- C 恢复：扫描继续，桥接立刻补一拍 ----------
    await sampleFrom(PORT, INDEX_PICK, `window.deskfish.testPauseRender(false) ? "1" : "1"`, 4000);
    await sleep(900);
    const c1 = await readStats();
    want("恢复的那一下桥接立刻补一拍（不等 8 秒）", c1.polls > b2.polls, JSON.stringify({ before: b2.polls, after: c1.polls }));
    await sleep(3000);
    const c2 = await readStats();
    want("恢复后 DSH 活跃度扫描继续跑", c2.scans - c1.scans >= 1, JSON.stringify({ from: c1.scans, to: c2.scans, delta: c2.scans - c1.scans }));
    want("恢复后暂停状态已解除", c2.paused === false, JSON.stringify({ paused: c2.paused }));

    console.log("");
    console.log("结果：" + pass + " 通过，" + fail + " 失败");
  } catch (e) {
    console.error("探针失败：" + (e && e.message ? e.message : e));
    fail++;
  } finally {
    try { killTree(child.pid); } catch (e) { }
    // 失败也要收拾：否则每红一次就在临时目录里留一份 userData
    if (!KEEP) {
      await sleep(700);
      try { fs.rmSync(userData, { recursive: true, force: true }); } catch (e) { }
    }
  }
  process.exit(fail ? 1 : 0);
}

main();
