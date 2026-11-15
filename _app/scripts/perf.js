"use strict";
/**
 * 启动性能预算：从 spawn 到底下几件事各自花了多久。
 *
 * 为什么要有这个：soak 看的是「开着一整天会不会长胖」，churn 看的是「反复开关会不会漏」，
 * 但没有任何东西回答「双击之后多久能看到她」——而这恰恰是用户第一个能感知的指标。
 * 装到一台老笔记本上启动慢 20 秒，用户的第一判断是「这软件卡」，不是「模型 16 MB 要读盘」。
 *
 * 量四段（都是相对 spawn 时刻的毫秒）：
 *   toTarget  本地服务起来、调试口能看到 index.html（此前页面是空白）
 *   toDom     页面 DOM 就绪（骨架能交互了）
 *   toModel   模型加载完、__fishDebug().model === true（用户真正「看到她」的时刻）
 *   pageHeap  同一时刻页面 JS 堆（MB）
 *
 * 为什么不是「首次绘制」：Electron 35 里 `performance.getEntriesByType("paint")` 返回空数组
 * （Chromium 只把 paint timing 暴露给真实页面导航，Electron 的 file/http 混合加载拿不到），
 * 实测 paintCount=0。所以退一层用 domContentLoaded，它诚实地表示「DOM 解析完」，
 * 不假装自己知道像素什么时候出现。真正的「看到画面」用 toModel 表示，那个更接近用户感受。
 *
 * 用法：
 *   node scripts/perf.js                跑 3 轮，各段取中位数
 *   node scripts/perf.js --runs 1       只跑一轮（看明细）
 *   node scripts/perf.js --json         只输出 JSON（给别的脚本吃）
 *   node scripts/perf.js --keep         跑完不删隔离 userData
 */

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const { makeTmp } = require("./lib/tmp");
const os = require("node:os");
const path = require("node:path");
const { sampleFrom, evalOnce, listTargets } = require("./lib/cdp");

const APP = path.join(__dirname, "..");
const EXE = path.join(APP, "runtime", process.platform === "win32" ? "electron.exe" : "electron");

// 预算：装在老笔记本上（机械盘、4 核）也不该破这些线。
// 超了不一定是 bug，但必须有个人来解释，所以它是一条断言而不是一个数字。
const BUDGET = {
  toTargetMs: 20000,
  toDomMs: 30000,
  toModelMs: 45000,
  pageHeapMb: 500,
  // 启动期长帧（>50ms 的阻塞帧）超过这个数会被点名：它意味着「能起来，但一起就卡」
  longFrames: 20,
};

const args = process.argv.slice(2);
const has = (k) => args.includes(k);
const num = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : d;
};
const RUNS = Math.max(1, num("--runs", 3));
const JSON_ONLY = has("--json");
const LONG = has("--long");
const KEEP = has("--keep");
const PORT = num("--port", 9261);
const POLL_MS = 300;
const MAX_WAIT_MS = 90000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 页面探针：一次把「现在到哪一步了」全问出来。
// 注意性能条目只在同一个文档里有效，reload 后要重新取。
const PAGE_PROBE = `JSON.stringify((function(){
  var d = (typeof window.__fishDebug === "function") ? window.__fishDebug() : null;
  var t = performance.timing || {};
  var heap = 0;
  try { heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0; } catch (e) { }
  // 启动期有没有把人卡住：long-animation-frame 是 Chromium 自己标出来的 >50ms 帧
  var lf = [], lfMax = 0, lfDetail = [];
  try {
    lf = performance.getEntriesByType("long-animation-frame") || [];
    for (var i = 0; i < lf.length; i++) {
      lfMax = Math.max(lfMax, Math.round(lf[i].duration));
      // 每帧最多记 3 段脚本：谁把这 0.9 秒吃掉的，只有这里能看见
      var sc = [];
      var ss = lf[i].scripts || [];
      for (var k = 0; k < ss.length && k < 3; k++) {
        var u = String(ss[k].sourceURL || "");
        sc.push(u.slice(u.lastIndexOf("/") + 1) + " · " + Math.round(ss[k].duration) + "ms · " +
          (ss[k].sourceFunctionName || ss[k].invoker || "?"));
      }
      lfDetail.push({ d: Math.round(lf[i].duration), sc: sc });
    }
  } catch (e) { }
  return {
    now: Math.round(performance.now()),
    domReady: t.domContentLoadedEventEnd ? Math.round(t.domContentLoadedEventEnd - t.navigationStart) : 0,
    model: !!(d && d.model),
    fps: d ? d.fps : 0,
    phase: d ? (d.phase || "") : "",
    heap: heap,
    longFrames: lf.length,
    longFrameMax: lfMax,
    longDetail: lfDetail
  };
})())`;

async function runOnce(idx) {
  const ud = makeTmp("dfy-perf-");
  const t0 = Date.now();
  const env = Object.assign({}, process.env, { FISH_MULTI: "1", FISH_TEST_HIDDEN: "1" });
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CHROME_CRASHPAD_PIPE_NAME;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;

  const child = spawn(EXE, ["--remote-debugging-port=" + PORT, "--user-data-dir=" + ud, "."], {
    cwd: APP,
    env,
    stdio: "ignore",
  });

  const out = { run: idx, toTargetMs: 0, toDomMs: 0, toModelMs: 0, pageHeapMb: 0, fps: 0, longFrames: 0, longFrameMax: 0, ok: false };
  const pick = (x) => x && x.type === "page" && /index\.html/.test(x.url || "");

  try {
    // ① 等到调试口上出现主页面
    let t = null;
    while (Date.now() - t0 < MAX_WAIT_MS) {
      t = (await listTargets(PORT)).find(pick) || null;
      if (t) break;
      if (child.exitCode !== null) throw new Error("进程提前退出（code " + child.exitCode + "）");
      await sleep(POLL_MS);
    }
    if (!t) throw new Error("等不到主页面（" + Math.round(MAX_WAIT_MS / 1000) + " 秒）");
    out.toTargetMs = Date.now() - t0;

    // ② 轮询页面直到模型加载完。
    // 每拍新连一次（cdp.js 的铁律：不拿长连接做采样）。
    let last = null;
    while (Date.now() - t0 < MAX_WAIT_MS) {
      try {
        last = await sampleFrom(PORT, pick, PAGE_PROBE, 8000);
      } catch (e) {
        last = null; // 页面还在切文档，下一拍再问
      }
      if (last) {
        // domReady 是相对 timeOrigin 的，last.now 也是；相减就换算到「相对 spawn」
        if (!out.toDomMs && last.domReady) out.toDomMs = Math.round((Date.now() - t0) - last.now + last.domReady);
        if (last.model) break;
      }
      await sleep(POLL_MS);
    }
    if (!last || !last.model) throw new Error("等不到模型加载完成");
    out.toModelMs = Date.now() - t0;
    out.pageHeapMb = last.heap || 0;
    out.fps = last.fps || 0;
    out.longFrames = last.longFrames || 0;
    out.longFrameMax = last.longFrameMax || 0;
    out.longDetail = last.longDetail || [];
    out.ok = true;
  } catch (e) {
    out.error = String((e && e.message) || e);
  } finally {
    try { child.kill(); } catch (e) { }
    await sleep(600);
    try {
      require("node:child_process").execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch (e) { }
    if (!KEEP) {
      await sleep(300);
      try { fs.rmSync(ud, { recursive: true, force: true, maxRetries: 3 }); } catch (e) { }
    }
  }
  return out;
}

const median = (xs) => {
  const a = xs.filter((x) => typeof x === "number" && x > 0).sort((x, y) => x - y);
  if (!a.length) return 0;
  return a[Math.floor(a.length / 2)];
};

(async () => {
  const runs = [];
  for (let i = 1; i <= RUNS; i += 1) {
    if (!JSON_ONLY) process.stdout.write("[perf] 第 " + i + "/" + RUNS + " 轮…\n");
    const r = await runOnce(i);
    runs.push(r);
    if (!JSON_ONLY) {
      process.stdout.write("[perf]   服务 " + r.toTargetMs + "ms · DOM " + r.toDomMs + "ms · 模型 " +
        r.toModelMs + "ms · 堆 " + r.pageHeapMb + "MB · 长帧 " + r.longFrames +
        "(最长 " + r.longFrameMax + "ms)" + (r.ok ? "" : "  ← " + r.error) + "\n");
      if (LONG && r.longDetail && r.longDetail.length) {
        r.longDetail.forEach((x) => {
          process.stdout.write("[perf]     长帧 " + x.d + "ms ← " +
            (x.sc.length ? x.sc.join(" | ") : "（没标到脚本，多为布局/合成）") + "\n");
        });
      }
    }
  }

  const good = runs.filter((r) => r.ok);
  const sum = {
    at: new Date().toISOString(),
    runs: runs.length,
    okRuns: good.length,
    toTargetMs: median(good.map((r) => r.toTargetMs)),
    toDomMs: median(good.map((r) => r.toDomMs)),
    toModelMs: median(good.map((r) => r.toModelMs)),
    pageHeapMb: median(good.map((r) => r.pageHeapMb)),
    longFrames: median(good.map((r) => r.longFrames)),
    longFrameMax: median(good.map((r) => r.longFrameMax)),
    budget: BUDGET,
  };
  sum.fail = [];
  if (!good.length) sum.fail.push("没有一轮成功");
  else {
    if (sum.toTargetMs > BUDGET.toTargetMs) sum.fail.push("服务起来太慢 " + sum.toTargetMs + "ms > " + BUDGET.toTargetMs);
    if (sum.toDomMs > BUDGET.toDomMs) sum.fail.push("DOM 就绪太慢 " + sum.toDomMs + "ms > " + BUDGET.toDomMs);
    if (sum.toModelMs > BUDGET.toModelMs) sum.fail.push("模型加载太慢 " + sum.toModelMs + "ms > " + BUDGET.toModelMs);
    if (sum.pageHeapMb > BUDGET.pageHeapMb) sum.fail.push("页面堆太大 " + sum.pageHeapMb + "MB > " + BUDGET.pageHeapMb);
    if (sum.longFrames > BUDGET.longFrames) sum.fail.push("启动期长帧太多 " + sum.longFrames + " 个 > " + BUDGET.longFrames);
  }
  sum.ok = sum.fail.length === 0;

  // 明细落盘 + 追加历史，便于「这次比上次慢了多少」这种问题有据可查
  const tmp = path.join(APP, "_tmp");
  try { fs.mkdirSync(tmp, { recursive: true }); } catch (e) { }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  try {
    fs.writeFileSync(path.join(tmp, "perf-" + stamp + ".json"), JSON.stringify({ sum, runs }, null, 2), "utf8");
    const hist = path.join(tmp, "perf-history.json");
    let arr = [];
    try { arr = JSON.parse(fs.readFileSync(hist, "utf8")); } catch (e) { arr = []; }
    if (!Array.isArray(arr)) arr = [];
    arr.push(sum);
    fs.writeFileSync(hist, JSON.stringify(arr.slice(-50), null, 2), "utf8");
  } catch (e) { }

  if (JSON_ONLY) {
    process.stdout.write(JSON.stringify(sum) + "\n");
  } else {
    process.stdout.write("\n服务起来  : " + sum.toTargetMs + " ms   （预算 " + BUDGET.toTargetMs + "）\n");
    process.stdout.write("DOM 就绪  : " + sum.toDomMs + " ms   （预算 " + BUDGET.toDomMs + "）\n");
    process.stdout.write("模型就绪  : " + sum.toModelMs + " ms   （预算 " + BUDGET.toModelMs + "）\n");
    process.stdout.write("页面堆    : " + sum.pageHeapMb + " MB   （预算 " + BUDGET.pageHeapMb + "）\n");
    process.stdout.write("启动长帧  : " + sum.longFrames + " 个，最长 " + sum.longFrameMax + " ms   （预算 " + BUDGET.longFrames + " 个）\n");
    process.stdout.write("判定      : " + (sum.ok ? "PASS" : "FAIL —— " + sum.fail.join("；")) + "\n");
  }
  process.exit(sum.ok ? 0 : 1);
})();
