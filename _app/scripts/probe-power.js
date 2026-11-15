"use strict";
/*
 * probe-power.js —— 她开着一整天，究竟吃多少电
 *
 * 已有的 perf（启动耗时）与 soak（长时间挂机看 RSS）都不回答这个：
 *   - 空闲时的 CPU 到底降下来没有（降帧 `calm` 是 8 秒后生效）
 *   - 空闲时还在不在跑 JS（每秒脚本时间）
 *   - 从空闲回到活动，帧率能不能立刻升回去（降过头就是「她变成幻灯片」）
 *
 * 判据用「每秒脚本时间」而不是「唤醒次数」：Windows 上拿不到每次唤醒，
 * 但 TaskDuration / ScriptDuration 的主线程速度是同一件事更硬的量。
 */
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { connect, listTargets, evalOn, findTarget } = require("./lib/cdp");
const { makeTmp } = require("./lib/tmp");

const ROOT = path.resolve(__dirname, "..");
const EXE = path.join(ROOT, "runtime", process.platform === "win32" ? "electron.exe" : "electron");
const PORT = Number(process.env.PROBE_PORT || 9333);
const KEEP = process.env.KEEP === "1";

/* 实测之后定的门槛（第一版全是占位，跑一遍看真实数字再收紧） */
const BUDGET = {
  activeFps: 18, // 活动时要高于这个（降帧必须退掉）
  idleFps: 15, // 空闲 10 秒后不高于这个
  idleCpuPct: 6, // 空闲时所有进程 CPU 之和的均值（%）
  idleTabCpuPct: 2, // 空闲时渲染进程（Tab）自己的 CPU 均值（%）
  idleRssMb: 40, // 空闲 30 秒的 RSS 增量
  idleWakeSec: 0.5, // 空闲时每秒主线程任务时间占的比例上限
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n, d = 1) => (Math.round(n * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d);

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, detail) {
  pass += 1;
  console.log("✅ " + name + (detail === undefined ? "" : "  " + JSON.stringify(detail)));
}
function bad(name, detail) {
  fail += 1;
  failures.push(name);
  console.log("❌ " + name + (detail === undefined ? "" : "  " + JSON.stringify(detail)));
}
function judge(name, cond, detail) {
  if (cond) ok(name, detail);
  else bad(name, detail);
}

function killTree(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve();
    spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" }).on("exit", () => resolve());
    setTimeout(resolve, 4000);
  });
}

async function waitFor(fn, ms, step = 250) {
  const t0 = Date.now();
  for (;;) {
    let v;
    try {
      v = await fn();
    } catch (e) {
      v = null;
    }
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await sleep(step);
  }
}

const PAGE_PICK = (list) => list.find((t) => /\/src\/index\.html/.test(t.url || ""));
const HAVE = (list) => list.find((t) => /\/src\/index\.html/.test(t.url || "") && t.webSocketDebuggerUrl);

/* 渲染侧读一次：帧率 + 降帧标志 */
const READ_JS = `JSON.stringify((function(){
  const d = (typeof window.__fishDebug === "function") ? window.__fishDebug() : {};
  return { fps: d.fps, maxFps: d.fpsCap, paused: d.paused, res: d.res };
})())`;

/* 主进程指标：各进程 CPU 与内存 */
const METRICS_JS = `(function(){ return window.deskfish.testMetrics(); })()`;

async function main() {
  const userData = makeTmp("dfy-power-");
  const env = Object.assign({}, process.env, { FISH_MULTI: "1", FISH_TEST_HIDDEN: "1" });
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CHROME_CRASHPAD_PIPE_NAME;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;

  const child = spawn(
    EXE,
    ["--remote-debugging-port=" + PORT, "--user-data-dir=" + userData, "."],
    { cwd: ROOT, env, stdio: "ignore" }
  );

  let client = null;
  try {
    /* ---- 起窗口 ---- */
    const target = await waitFor(async () => {
      const list = await listTargets(PORT);
      return HAVE(list);
    }, 45000);
    if (!target) throw new Error("等不到页面 target（端口 " + PORT + "）");

    client = await connect(target.webSocketDebuggerUrl);

    const ready = await waitFor(async () => {
      const r = await evalOn(
        client,
        `JSON.stringify({
          s: document.readyState,
          m: !!(window.__fishDebug && window.__fishDebug().model),
          f: typeof (window.deskfish && window.deskfish.testMetrics)
        })`
      );
      const v = typeof r === "string" ? JSON.parse(r) : r;
      return v && v.s === "complete" && v.m === true && v.f === "function" ? v : null;
    }, 60000);
    if (!ready) throw new Error("页面没就绪（模型或 testMetrics 缺失）");
    ok("页面就绪，指标通道在", ready);

    /* 引导卡是 firstRun 时 4.2 秒后才弹的 —— 不关掉它，它会一直占着一个 rAF */
    await sleep(5200);
    try {
      await evalOn(client, `(function(){ try { window.deskfish.closeWelcome(); } catch (e) {} return 1; })()`);
    } catch (e) {}
    await sleep(800);

    await client.send("Performance.enable", {});

    const readPerf = async () => {
      const r = await client.send("Performance.getMetrics", {});
      const map = {};
      for (const m of (r && r.metrics) || []) map[m.name] = m.value;
      return map;
    };

    const readMetrics = async () => {
      const r = await evalOn(client, METRICS_JS);
      return r;
    };

    const readFish = async () => {
      const r = await evalOn(client, READ_JS);
      return typeof r === "string" ? JSON.parse(r) : r;
    };

    const sumCpu = (m) => {
      const procs = (m && m.procs) || [];
      return procs.reduce((a, p) => a + (Number(p.cpu) || 0), 0);
    };
    const tabCpu = (m) => {
      const procs = (m && m.procs) || [];
      return procs.filter((p) => /tab/i.test(p.type)).reduce((a, p) => a + (Number(p.cpu) || 0), 0);
    };
    const sumMem = (m) => {
      const procs = (m && m.procs) || [];
      return procs.reduce((a, p) => a + (Number(p.mem) || 0), 0);
    };

    /* ---- 活动段：让她忙起来，帧率必须高于阈值 ----
     * 「活动」的判据在渲染侧是 `lastMoveAt`，而它只由主进程推来的全局鼠标坐标更新
     * （`renderer.js` 的 `onCursor`，坐标真的变了才重置）。
     * 所以这里走 `__test:nudge` —— 和真实鼠标同一条路，不碰用户真鼠标。 */
    const before = await readFish();
    ok("初始状态读得到", before);

    for (let i = 0; i < 10; i += 1) {
      await evalOn(client, `(function(){ window.deskfish.testNudge(); return 1; })()`);
      await sleep(200);
    }
    await sleep(500);
    const activeFish = await readFish();
    judge(
      "活动时帧率高于 " + BUDGET.activeFps + "（降帧先退掉）",
      Number(activeFish.fps) > BUDGET.activeFps,
      activeFish
    );

    /* ---- 空闲段：等 calm 生效（8 秒）再开始数 ---- */
    await sleep(9000);
    const idleFish0 = await readFish();
    judge(
      "空闲 10 秒后帧率降到 " + BUDGET.idleFps + " 以内",
      Number(idleFish0.fps) <= BUDGET.idleFps,
      idleFish0
    );

    const p0 = await readPerf();
    const m0 = await readMetrics();
    judge("指标通道返回进程明细（含 gpu）", ((m0 && m0.procs) || []).some((p) => /gpu/i.test(p.type)), {
      types: ((m0 && m0.procs) || []).map((p) => p.type),
    });
    console.log("  CDP 指标（诊断用）：" + JSON.stringify(p0).slice(0, 300));

    /* 30 秒采样，每 3 秒一次 */
    const samples = [];
    const T0 = Date.now();
    while (Date.now() - T0 < 30000) {
      await sleep(3000);
      const fish = await readFish();
      const met = await readMetrics();
      samples.push({
        t: Math.round((Date.now() - T0) / 1000),
        fps: Number(fish.fps) || 0,
        cpu: sumCpu(met),
        tabCpu: tabCpu(met),
        mem: sumMem(met),
      });
    }
    const p1 = await readPerf();

    const avgCpu = samples.reduce((a, s) => a + s.cpu, 0) / samples.length;
    const avgTabCpu = samples.reduce((a, s) => a + s.tabCpu, 0) / samples.length;
    const avgFps = samples.reduce((a, s) => a + s.fps, 0) / samples.length;
    const maxFps = Math.max.apply(null, samples.map((s) => s.fps));
    const mem0 = samples.length ? samples[0].mem : 0;
    const mem1 = samples.length ? samples[samples.length - 1].mem : 0;

    const secs = Math.max(1, (Date.now() - T0) / 1000);
    const scriptMs = ((p1.ScriptDuration || 0) - (p0.ScriptDuration || 0)) * 1000;
    const taskMs = ((p1.TaskDuration || 0) - (p0.TaskDuration || 0)) * 1000;
    const scriptPerSec = scriptMs / secs;
    const taskPerSec = taskMs / secs;

    console.log(
      "\n空闲 " +
        Math.round(secs) +
        " 秒：CPU 均值 " +
        fmt(avgCpu) +
        "% / 峰值 " +
        fmt(Math.max.apply(null, samples.map((s) => s.cpu))) +
        "%，帧率 " +
        fmt(avgFps) +
        "（最高 " +
        maxFps +
        "），脚本 " +
        fmt(scriptPerSec) +
        " ms/秒，主线程任务 " +
        fmt(taskPerSec) +
        " ms/秒，内存 " +
        mem0 +
        " → " +
        mem1 +
        " MB\n"
    );

    judge(
      "空闲时 CPU 均值不超过 " + BUDGET.idleCpuPct + "%",
      avgCpu <= BUDGET.idleCpuPct,
      { avgCpu: Number(fmt(avgCpu)), peak: Number(fmt(Math.max.apply(null, samples.map((s) => s.cpu)))) }
    );
    judge(
      "空闲时帧率一直压在 " + BUDGET.idleFps + " 以内",
      maxFps <= BUDGET.idleFps,
      { maxFps, avgFps: Number(fmt(avgFps)) }
    );
    judge(
      "空闲时渲染进程（Tab）CPU 不超过 " + BUDGET.idleTabCpuPct + "%",
      avgTabCpu <= BUDGET.idleTabCpuPct,
      { avgTabCpu: Number(fmt(avgTabCpu)), peak: Number(fmt(Math.max.apply(null, samples.map((s) => s.tabCpu)))) }
    );
    /* TaskDuration 在不同 Chromium 版本上，有的会累计、有的恒为 0。
     * 有值才判 —— 恒 0 时它证明不了「主线程闲着」，只能当诊断信息。 */
    if (taskMs > 0) {
      judge(
        "空闲时主线程不是一直在忙（任务占比 < " + BUDGET.idleWakeSec * 100 + "%）",
        taskPerSec / 1000 < BUDGET.idleWakeSec,
        { taskPerSec: Number(fmt(taskPerSec)), ratio: Number(fmt(taskPerSec / 1000, 3)) }
      );
    } else {
      console.log("  （TaskDuration 在这个版本上没累计，主线程忙碌度靠 CPU% 判）");
    }
    judge(
      "空闲 30 秒内存不涨过 " + BUDGET.idleRssMb + " MB",
      mem1 - mem0 <= BUDGET.idleRssMb,
      { from: mem0, to: mem1, delta: mem1 - mem0 }
    );

    /* ---- 回到活动：帧率要能立刻升回去 ---- */
    for (let i = 0; i < 6; i += 1) {
      await evalOn(client, `(function(){ window.deskfish.testNudge(); return 1; })()`);
      await sleep(180);
    }
    await sleep(500);
    const backFish = await readFish();
    judge(
      "回到活动后帧率升回 " + BUDGET.activeFps + " 以上",
      Number(backFish.fps) > BUDGET.activeFps,
      backFish
    );
  } catch (e) {
    bad("探针执行出错", String((e && e.stack) || e).slice(0, 600));
  } finally {
    try {
      if (client) client.close();
    } catch (e) {}
    await killTree(child.pid);
    await sleep(600);
    if (!KEEP) {
      try {
        fs.rmSync(userData, { recursive: true, force: true });
      } catch (e) {}
    }
    console.log("\n结果：" + pass + " 通过，" + fail + " 失败");
    if (fail) console.log("失败项：" + failures.join("、"));
    process.exit(fail ? 1 : 0);
  }
}

if (require.main === module) main();
