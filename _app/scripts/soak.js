"use strict";
/**
 * 长跑稳定性（soak）：真起一个桌宠，按固定间隔采样内存 / 句柄 / CPU / 窗口数，
 * 给出趋势与判定。冒烟只看「启动这一下」，跑一天会不会慢慢涨死，只有这个能看出来。
 *
 * 用法：
 *   node scripts/soak.js                       # 默认 10 分钟，每 30 秒采一次
 *   node scripts/soak.js --minutes 30 --every 60
 *   node scripts/soak.js --minutes 2 --every 20 --keep   # 跑完不杀，自己接着点
 *
 * 判定（任一不满足即 FAIL，退出码 1）：
 *   1) 主进程 RSS 增长速率 < 30 MB/小时，且总量涨幅 < 80 MB
 *   2) 句柄数（getActiveResourcesInfo）末值不超过首值 +2
 *   3) 渲染进程 JS heap 涨幅 < 40 MB
 *   4) 全程 console 没有新的 error / 未捕获异常
 * 采样明细落在 _tmp/soak-<时间戳>.json，出问题直接拿它对比。
 *
 * 注意：它用 FISH_MULTI=1 + 独立 userData 起实例，不碰主人正在用的那一份。
 */
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const ROOT = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);
function opt(name, dflt) {
  const i = argv.indexOf("--" + name);
  if (i < 0) return dflt;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : dflt;
}
function flag(name) { return argv.includes("--" + name); }

const EXE = path.join(ROOT, "runtime", "electron.exe");
const MINUTES = Math.max(0.5, Number(opt("minutes", 10)) || 10);
const EVERY_MS = Math.max(5000, Number(opt("every", 30)) * 1000);
// 预热期：启动 + 首次加载模型会把 RSS/堆推上一个台阶，这段的斜率没有诊断意义。
// 趋势与判定一律只用预热之后的样本，否则 2 分钟的短跑永远「涨 300 MB/小时」。
const WARMUP_MS = Math.max(0, Number(opt("warmup", 60)) * 1000);
const PORT = Number(opt("port", 9241)) || 9241;
const MAIN_PORT = PORT + 1;
const KEEP = flag("keep");
const USER_DATA = path.resolve(ROOT, String(opt("user-data", path.join("_tmp", "soak-user"))));
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT_JSON = path.resolve(ROOT, String(opt("json", path.join("_tmp", "soak-" + STAMP + ".json"))));

// 阈值（商业交付口径：一天下来不该有肉眼可见的位移）
const MAX_RSS_PER_HOUR_MB = 30;
const MAX_RSS_TOTAL_MB = 80;
const MAX_HANDLE_DELTA = 2;
const MAX_RENDER_HEAP_MB = 40;

// ---------- 迷你 WebSocket CDP 客户端 ----------
// 采样必须走 sampleFrom()（现连、求值、立刻关）：复用长连接会在空闲一分钟后
// 不再回应，整轮采样空白（详见 scripts/lib/cdp.js 顶部说明）。
const { connect, listTargets, sampleFrom, reconnectPageEvents } = require("./lib/cdp");

function killTree(pid) {
  if (!pid) return;
  try {
    spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } catch (e) { }
}

function mb(n) { return Math.round((Number(n) || 0) / 1048576 * 10) / 10; }
function fmtSec(ms) { return (ms / 1000).toFixed(1) + "s"; }

// 主进程侧取一次快照。/json/list 拿不到进程指标，只能进 inspector 里问。
// 注意：主进程 --inspect 的默认求值上下文里没有全局 require（它不是 Node REPL）。
// 只能用 process.mainModule.require 绕过去拿 electron；拿不到就退化成纯 process.* 指标。
const MAIN_PROBE = `(function () {
  var out = { rss: 0, heapUsed: 0, external: 0, arrayBuffers: 0, handles: 0, handleKinds: {}, windows: 0, cpuUser: 0, cpuSys: 0, note: "" };
  try {
    var m = process.memoryUsage();
    out.rss = m.rss; out.heapUsed = m.heapUsed; out.external = m.external; out.arrayBuffers = m.arrayBuffers;
  } catch (e) { out.note += "mem:" + (e && e.message) + " "; }
  try { out.handles = process.getActiveResourcesInfo().length; } catch (e) { }
  try {
    var res = process.getActiveResourcesInfo();
    out.handleKinds = res.reduce(function (a, k) { a[k] = (a[k] || 0) + 1; return a; }, {});
  } catch (e) { }
  try {
    var cu = process.cpuUsage();
    out.cpuUser = cu.user; out.cpuSys = cu.system;
  } catch (e) { }
  var req = null;
  try { if (typeof require === "function") req = require; } catch (e) { }
  if (!req) { try { req = process.mainModule && process.mainModule.require; } catch (e) { } }
  if (req) {
    try {
      var el = req("electron");
      try {
        out.windows = el.BrowserWindow.getAllWindows().filter(function (w) { return !w.isDestroyed(); }).length;
      } catch (e) { out.note += "win:" + (e && e.message) + " "; }
      try {
        out.metrics = el.app.getAppMetrics().map(function (x) {
          return { pid: x.pid, type: x.type, cpu: x.cpu && x.cpu.percentCPUUsage, ws: x.memory && x.memory.workingSetSize };
        });
      } catch (e) { out.metrics = []; }
    } catch (e) { out.note += "el:" + (e && e.message) + " "; }
  } else {
    out.note += "no-require ";
  }
  return JSON.stringify(out);
})()`;

// 渲染进程侧：页面自己的 JS heap 与画面状态。桌宠真正的开销在这里（Pixi + Live2D）。
// __fishDebug() 是 renderer.js 自己暴露的自检函数（冒烟也用它）。
const PAGE_PROBE = `(function () {
  try {
    var mm = performance.memory || {};
    var d = {};
    try { if (typeof window.__fishDebug === "function") d = window.__fishDebug() || {}; } catch (e) { }
    return JSON.stringify({
      heap: mm.usedJSHeapSize || 0,
      totalHeap: mm.totalJSHeapSize || 0,
      canvases: document.querySelectorAll("canvas").length,
      fps: d.fps,
      model: !!d.model,
      phase: d.phase,
      ticking: d.ticking,
      idleMs: d.idleMs
    });
  } catch (e) { return JSON.stringify({ error: String(e && e.message || e) }); }
})()`;

// 采样走「一次一条连接」：连上、求值、立刻关 —— 实现在 scripts/lib/cdp.js

function slopePerHour(samples, pick) {
  // 最小二乘，x 用秒，结果换算成「每小时变化量」
  const pts = samples.map((s) => [s.t / 1000, pick(s)]).filter((p) => Number.isFinite(p[1]));
  if (pts.length < 3) return 0;
  const n = pts.length;
  const sx = pts.reduce((a, p) => a + p[0], 0);
  const sy = pts.reduce((a, p) => a + p[1], 0);
  const sxx = pts.reduce((a, p) => a + p[0] * p[0], 0);
  const sxy = pts.reduce((a, p) => a + p[0] * p[1], 0);
  const den = n * sxx - sx * sx;
  if (!den) return 0;
  const perSec = (n * sxy - sx * sy) / den;
  return perSec * 3600;
}

(async function main() {
  if (!fs.existsSync(EXE)) {
    console.error("[soak] 找不到 " + EXE + "（先确认 runtime/ 在）");
    process.exit(2);
  }
  fs.mkdirSync(USER_DATA, { recursive: true });
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });

  const env = Object.assign({}, process.env);
  for (const k of ["ELECTRON_RUN_AS_NODE", "CHROME_CRASHPAD_PIPE_NAME", "ELECTRON_NO_ATTACH_CONSOLE"]) delete env[k];
  // FISH_MULTI=1：允许和主人正在用的实例并存，不会被单实例锁顶掉
  env.FISH_MULTI = "1";
  // 自测不许上屏（见 main.js 的 TEST_HIDDEN）：窗口不进屏幕、不进任务栏，但照常渲染
  env.FISH_TEST_HIDDEN = "1";

  const bootArgs = ["--remote-debugging-port=" + PORT, "--inspect=" + MAIN_PORT, "--user-data-dir=" + USER_DATA, "."];
  console.log("[soak] 启动桌宠：计划跑 " + MINUTES + " 分钟，每 " + EVERY_MS / 1000 + " 秒采一次");
  console.log("[soak] userData=" + USER_DATA + "（与主人那份隔离）");
  const child = spawn(EXE, bootArgs, { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: false });

  let exited = false;
  let exitCode = null;
  child.on("exit", (code) => { exited = true; exitCode = code; });

  const problems = [];
  const collectErr = (text) => {
    const t = String(text || "");
    if (!/error|uncaught|unhandled|exception/i.test(t)) return;
    if (/Insecure Content-Security-Policy|Electron Security Warning|Autofill\.|ERR_CONNECTION_REFUSED|DevTools/i.test(t)) return;
    problems.push(t.replace(/\s+/g, " ").slice(0, 300));
  };

  // 等主进程 inspector 与页面都出来
  let mainC = null;
  let pageC = null;
  {
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline && !exited) {
      if (!mainC) {
        const ts = await listTargets(MAIN_PORT);
        const t = ts.find((x) => x && x.webSocketDebuggerUrl);
        if (t) {
          const c = connect(t.webSocketDebuggerUrl);
          try { await c.ready; mainC = c; } catch (e) { c.close(); }
        }
      }
      if (!pageC) {
        const ts = await listTargets(PORT);
        const t = ts.find((x) => x && x.type === "page" && x.webSocketDebuggerUrl);
        if (t) {
          const c = connect(t.webSocketDebuggerUrl);
          try {
            await c.ready;
            await c.send("Runtime.enable").catch(() => { });
            await c.send("Log.enable").catch(() => { });
            pageC = c;
          } catch (e) { c.close(); }
        }
      }
      if (mainC && pageC) break;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (exited) {
    console.error("[soak] 桌宠启动后就退了，code=" + exitCode);
    process.exit(2);
  }
  if (!mainC || !pageC) {
    console.error("[soak] 连不上：" + (mainC ? "" : "主进程 ") + (pageC ? "" : "页面 "));
    killTree(child.pid);
    process.exit(2);
  }

  const t0 = Date.now();
  const durationMs = MINUTES * 60 * 1000;
  const samples = [];
  let nextAt = 0;
  let lastCpu = 0;
  let lastCpuAt = 0;

  while (Date.now() - t0 < durationMs) {
    const elapsed = Date.now() - t0;
    if (elapsed >= nextAt) {
      nextAt = elapsed + EVERY_MS;
      const mm = await sampleFrom(MAIN_PORT, (x) => x && x.webSocketDebuggerUrl, MAIN_PROBE)
        .catch((e) => ({ error: e.message }));
      const pg = await sampleFrom(PORT, (x) => x && x.type === "page" && x.webSocketDebuggerUrl, PAGE_PROBE)
        .catch((e) => ({ error: e.message }));
      // 窗口数/页面数用 CDP 目标列表兜底：主进程里拿不到 electron 模块时也有数
      let pageCount = 0;
      try { pageCount = (await listTargets(PORT)).filter((x) => x && x.type === "page").length; } catch (e) { }
      // 主进程自身 CPU：cpuUsage 是累计微秒，差分除以间隔就是占比
      const cpuNow = (Number(mm && mm.cpuUser) || 0) + (Number(mm && mm.cpuSys) || 0);
      const cpuPrev = lastCpu;
      lastCpu = cpuNow;
      const dtMs = elapsed - lastCpuAt;
      lastCpuAt = elapsed;
      const cpuSelf = (cpuPrev && dtMs > 0) ? Math.round((cpuNow - cpuPrev) / 1000 / dtMs * 1000) / 10 : 0;
      // 页面侧 console 顺手收一下。事件连接也会被对端掐掉，断了就重连一次，
      // 否则后面几十轮都在读一个死掉的连接（看上去「零错误」，其实是没在听）。
      if (!pageC || pageC.isClosed()) {
        pageC = await reconnectPageEvents(PORT).catch(() => null);
      }
      if (pageC) {
        for (const ev of pageC.events.splice(0)) {
          if (ev.method === "Runtime.exceptionThrown") collectErr(ev.params && ev.params.exceptionDetails && ev.params.exceptionDetails.text);
          if (ev.method === "Runtime.consoleAPICalled" && ev.params && ev.params.type === "error") {
            collectErr((ev.params.args || []).map((a) => a.value || a.description || "").join(" "));
          }
          if (ev.method === "Log.entryAdded" && ev.params && ev.params.entry && ev.params.entry.level === "error") {
            collectErr(ev.params.entry.text);
          }
        }
      }
      const renderHeap = (pg && pg.heap) || 0;
      const renderTotal = (pg && pg.totalHeap) || 0;
      const metricCpu = ((mm && mm.metrics) || []).reduce((a, x) => a + (Number(x.cpu) || 0), 0);
      const s = {
        t: elapsed,
        at: new Date().toISOString(),
        rss: mm && mm.rss,
        heapUsed: mm && mm.heapUsed,
        external: mm && mm.external,
        arrayBuffers: mm && mm.arrayBuffers,
        handles: mm && mm.handles,
        handleKinds: mm && mm.handleKinds,
        windows: (mm && mm.windows) || pageCount,
        pages: pageCount,
        cpuSelf,
        cpuMetric: Math.round(((mm && mm.metrics) || []).reduce((a, x) => a + (Number(x.cpu) || 0), 0) * 10) / 10,
        renderHeap, renderTotal,
        fps: pg && pg.fps, phase: pg && pg.phase, model: pg && pg.model, ticking: pg && pg.ticking,
        note: (mm && mm.note) || "",
        err: (mm && mm.error) || (pg && pg.error) || null,
      };
      samples.push(s);
      console.log(
        "[soak] " + String(Math.round(elapsed / 1000)).padStart(4) + "s  " +
        "RSS " + String(mb(s.rss)).padStart(7) + "MB  " +
        "heap " + String(mb(s.heapUsed)).padStart(6) + "MB  " +
        "ext " + String(mb(s.external)).padStart(6) + "MB  " +
        "页面 " + String(mb(renderHeap)).padStart(6) + "MB  " +
        "句柄 " + String(s.handles).padStart(3) + "  " +
        "窗 " + s.windows + "  " +
        "CPU " + String(s.cpuSelf).padStart(5) + "%  " +
        "fps " + (s.fps === undefined ? "-" : s.fps) + "  " +
        (s.err ? "ERR " + s.err : "")
      );
    }
    if (exited) break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  const stoppedEarly = exited;
  mainC.close();
  pageC.close();
  if (!KEEP) killTree(child.pid);
  await new Promise((r) => setTimeout(r, 400));

  // ---------- 判定 ----------
  // 只用预热之后的样本：启动那一下的爬升不是泄漏。
  const warm = samples.filter((s) => s.t >= WARMUP_MS && !s.err);
  const good = warm.filter((s) => s.rss);
  const first = good[0] || {};
  const last = good[good.length - 1] || {};
  const rssSlope = slopePerHour(good, (s) => mb(s.rss));
  const heapSlope = slopePerHour(good, (s) => mb(s.heapUsed));
  const renderSlope = slopePerHour(good, (s) => mb(s.renderHeap));
  const handleDelta = (Number(last.handles) || 0) - (Number(first.handles) || 0);
  const rssDelta = mb(last.rss) - mb(first.rss);
  const renderDelta = mb(last.renderHeap) - mb(first.renderHeap);
  const cpuAvg = good.length ? Math.round(good.reduce((a, s) => a + (Number(s.cpuSelf) || 0), 0) / good.length * 10) / 10 : 0;
  const peakRss = good.reduce((a, s) => Math.max(a, mb(s.rss)), 0);

  const fails = [];
  const warns = [];
  const boot = samples[0] || {};
  const bootDelta = mb(first.rss) - mb(boot.rss); // 预热期一次性爬升，只记录不判定
  if (stoppedEarly) fails.push("桌宠中途退出了（code=" + exitCode + "），跑到 " + Math.round((samples[samples.length - 1] || {}).t / 1000 || 0) + " 秒");
  if (good.length < 3) fails.push("预热之后的采样只有 " + good.length + " 个，看不出趋势（把 --minutes 调长，或把 --warmup 调短）");
  if (rssSlope > MAX_RSS_PER_HOUR_MB) fails.push("主进程 RSS 增长 " + rssSlope.toFixed(1) + " MB/小时（红线 " + MAX_RSS_PER_HOUR_MB + "）");
  if (rssDelta > MAX_RSS_TOTAL_MB) fails.push("主进程 RSS 总共涨了 " + rssDelta.toFixed(1) + " MB（红线 " + MAX_RSS_TOTAL_MB + "）");
  if (handleDelta > MAX_HANDLE_DELTA) fails.push("句柄数 " + first.handles + " → " + last.handles + "（红线 +" + MAX_HANDLE_DELTA + "）");
  if (renderDelta > MAX_RENDER_HEAP_MB) fails.push("渲染进程 JS heap 涨了 " + renderDelta.toFixed(1) + " MB（红线 " + MAX_RENDER_HEAP_MB + "）");
  if (problems.length) fails.push("抓到 " + problems.length + " 条 console 错误");
  if (cpuAvg > 8) warns.push("CPU 均值 " + cpuAvg + "%，桌宠常驻正常应在 8% 以下（模型帧率/精度可调）");
  if (bootDelta > 250) warns.push("预热期一次性涨了 " + bootDelta.toFixed(1) + " MB，偏大（模型纹理/精度）");

  const report = {
    startedAt: new Date(t0).toISOString(),
    minutes: MINUTES,
    everySec: EVERY_MS / 1000,
    warmupSec: WARMUP_MS / 1000,
    stoppedEarly,
    exitCode,
    samples,
    summary: {
      count: good.length,
      bootRss: mb(boot.rss), bootDelta,
      rssFirst: mb(first.rss), rssLast: mb(last.rss), rssPeak: peakRss, rssDelta, rssSlopePerHour: Number(rssSlope.toFixed(1)),
      heapSlopePerHour: Number(heapSlope.toFixed(1)),
      handlesFirst: first.handles, handlesLast: last.handles,
      renderFirst: mb(first.renderHeap), renderLast: mb(last.renderHeap), renderDelta, renderSlopePerHour: Number(renderSlope.toFixed(1)),
      cpuAvg,
      problems,
    },
    verdict: fails.length ? "FAIL" : "PASS",
    fails,
    warns,
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2), "utf8");

  console.log("");
  console.log("========== 长跑结果 ==========");
  console.log("时长      : " + MINUTES + " 分钟（预热 " + WARMUP_MS / 1000 + " 秒后计 " + good.length + " 次采样，每 " + EVERY_MS / 1000 + " 秒）" + (stoppedEarly ? "  ※中途退出" : ""));
  console.log("主进程 RSS: " + mb(boot.rss) + " →(预热) " + mb(first.rss) + " → " + mb(last.rss) + " MB   峰值 " + peakRss + " MB   斜率 " + rssSlope.toFixed(1) + " MB/小时");
  console.log("主进程堆  : 斜率 " + heapSlope.toFixed(1) + " MB/小时");
  console.log("页面堆    : " + mb(first.renderHeap) + " → " + mb(last.renderHeap) + " MB   斜率 " + renderSlope.toFixed(1) + " MB/小时");
  console.log("句柄      : " + first.handles + " → " + last.handles + "（" + (handleDelta >= 0 ? "+" : "") + handleDelta + "）");
  console.log("CPU 均值  : " + cpuAvg + "%");
  console.log("采样明细  : " + path.relative(ROOT, OUT_JSON));
  if (problems.length) {
    console.log("console   : " + problems.length + " 条错误，头一条：" + problems[0]);
  } else {
    console.log("console   : 无错误");
  }
  console.log("判定      : " + (fails.length ? "FAIL" : "PASS"));
  for (const f of fails) console.log("  ✗ " + f);
  for (const w of warns) console.log("  ! " + w);
  console.log("==============================");

  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error("[soak] 崩了：" + ((e && e.stack) || e));
  process.exit(2);
});
