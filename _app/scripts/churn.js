"use strict";
/**
 * churn：反复开关面板，看有没有漏窗口 / 漏句柄 / 一路涨内存。
 *
 * soak 回答「一直开着稳不稳」，churn 回答「一天里点开点关几十次会不会下沉」。
 * 桌宠这类常驻程序最常见的真实毛病不是慢泄漏，而是某个面板关不干净：
 * BrowserWindow 还在、webContents 还在、定时器还在，用户看不见但进程一直背着。
 *
 * 判定（全部达标才算 PASS）：
 *   1. 每轮结束窗口数回到基线（预热后测得，允许 ±0）；
 *   2. 结束时句柄增量 ≤ MAX_HANDLE_DELTA；
 *   3. 结束时 RSS 增量 ≤ MAX_RSS_GROWTH_MB；
 *   4. 页面调试目标数回到基线 ±1（残留的 webContents 会在这里露头）；
 *   5. 整个过程 console 零错误。
 *
 * 采样同样走 sampleFrom()（现连、求值、立刻关），不复用长连接 —— 见 scripts/lib/cdp.js。
 *
 * 用法：
 *   node scripts/churn.js                 # 8 轮，全部面板
 *   node scripts/churn.js --rounds 20     # 20 轮
 *   node scripts/churn.js --panels profile,settings
 *   node scripts/churn.js --keep          # 留着进程（自己看界面）
 */

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { connect, listTargets, sampleFrom } = require("./lib/cdp");

const ROOT = path.join(__dirname, "..");
const EXE = path.join(ROOT, "runtime", process.platform === "win32" ? "electron.exe" : "electron");

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}
function has(name) { return process.argv.includes("--" + name); }

const ROUNDS = Math.max(1, parseInt(arg("rounds", "8"), 10) || 8);
const PORT = parseInt(arg("port", "9251"), 10) || 9251;
const MAIN_PORT = PORT + 1;
const KEEP = has("keep");
const ONLY = arg("panels", "");
const USER_DATA = String(arg("user-data", path.join(ROOT, "_tmp", "churn-user")));

// 每个面板的开/关 API 都在 preload 里（window.deskfish.*）。
// waitOpen 给的是「窗口真的画出来」的时间，适配器要加载页面所以最长。
const ALL_PANELS = [
  { key: "profile", open: "openProfile()", close: "closeProfile()", waitOpen: 900, waitClose: 500 },
  { key: "settings", open: "openSettings()", close: "closeSettings()", waitOpen: 1000, waitClose: 600 },
  { key: "petpanel", open: "openPetPanel()", close: "closePetPanel()", waitOpen: 800, waitClose: 500 },
  { key: "adapter", open: 'openAdapter("", "")', close: "closeAdapter()", waitOpen: 1800, waitClose: 800 },
  { key: "chatlog", open: "openChatLog()", close: "closeChatLog()", waitOpen: 800, waitClose: 500 },
  { key: "seewatch", open: "openSeeWatch()", close: "closeSeeWatch()", waitOpen: 800, waitClose: 500 },
];

const PANELS = ONLY
  ? ALL_PANELS.filter((p) => String(ONLY).split(",").map((s) => s.trim()).includes(p.key))
  : ALL_PANELS;

const MAX_HANDLE_DELTA = 4;
const MAX_RSS_GROWTH_MB = 80;
const MAX_TARGET_DRIFT = 1;

const PROBE = `(function () {
  var out = { rss: 0, heapUsed: 0, handles: 0, windows: 0, contents: 0, note: "" };
  try {
    var m = process.memoryUsage();
    out.rss = m.rss; out.heapUsed = m.heapUsed;
  } catch (e) { out.note += "mem:" + (e && e.message) + " "; }
  try { out.handles = process.getActiveResourcesInfo().length; } catch (e) { }
  var req = null;
  try { if (typeof require === "function") req = require; } catch (e) { }
  if (!req) { try { req = process.mainModule && process.mainModule.require; } catch (e) { } }
  if (req) {
    try {
      var el = req("electron");
      out.windows = el.BrowserWindow.getAllWindows().filter(function (w) { return !w.isDestroyed(); }).length;
      try {
        out.contents = el.webContents.getAllWebContents().filter(function (c) {
          return !c.isDestroyed() && !/devtools/.test(c.getURL() || "");
        }).length;
      } catch (e2) { out.note += "wc:" + (e2 && e2.message) + " "; }
    } catch (e) { out.note += "win:" + (e && e.message) + " "; }
  } else { out.note += "no-require "; }
  return JSON.stringify(out);
})()`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mb = (n) => Math.round((Number(n) || 0) / 1048576 * 10) / 10;

function killTree(pid) {
  if (!pid) return;
  try { spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch (e) { }
}

async function mainPage() {
  return sampleFrom(PORT, (x) => x && x.type === "page" && /index\.html/.test(x.url || ""), "1");
}

// 在主窗口里跑一句（面板的 open/close 都是 window.deskfish 上的方法）
async function inPage(expr) {
  return sampleFrom(
    PORT,
    (x) => x && x.type === "page" && /index\.html/.test(x.url || ""),
    "JSON.stringify((function(){try{var d=window.deskfish;if(!d)return {r:'no-deskfish'};" + expr + ";return {r:'ok'}}catch(e){return {r:'err:'+(e&&e.message)}}})())",
    20000
  );
}

async function sampleMain() {
  try {
    return await sampleFrom(MAIN_PORT, (x) => x && x.webSocketDebuggerUrl, PROBE, 20000);
  } catch (e) {
    return null;
  }
}

async function countTargets() {
  const ts = await listTargets(PORT);
  return ts.filter((t) => t && t.type === "page").length;
}

(async () => {
  if (!fs.existsSync(EXE)) {
    console.error("[churn] 找不到 Electron：" + EXE + "（先 npm run build 或确认 runtime/ 在）");
    process.exit(2);
  }
  if (fs.existsSync(USER_DATA)) {
    try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch (e) { }
  }
  fs.mkdirSync(USER_DATA, { recursive: true });
  fs.mkdirSync(path.join(ROOT, "_tmp"), { recursive: true });

  const env = { ...process.env, FISH_MULTI: "1" };
// 自测不许上屏（见 main.js 的 TEST_HIDDEN）：窗口不进屏幕、不进任务栏，但照常渲染
env.FISH_TEST_HIDDEN = "1";
  // 环境里若带着这几个变量，electron 会以 node 模式启动并立刻抱怨参数
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CHROME_CRASHPAD_PIPE_NAME;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;

  console.log("[churn] 轮数 " + ROUNDS + "，面板 " + PANELS.map((p) => p.key).join("/"));
  const child = spawn(
    EXE,
    ["--remote-debugging-port=" + PORT, "--inspect=" + MAIN_PORT, "--user-data-dir=" + USER_DATA, "."],
    { cwd: ROOT, env, stdio: "ignore", windowsHide: true }
  );

  let pageWs = null;
  const consoleErrors = [];
  try {
    // 等主窗口
    let booted = false;
    for (let i = 0; i < 80; i++) {
      await sleep(500);
      const p = await mainPage();
      if (p) { booted = true; break; }
    }
    if (!booted) {
      console.error("[churn] 主窗口没起来（CDP " + PORT + " 连不上）");
      process.exit(2);
    }

    // 听主窗口的 console / 异常（只收事件，失效了也不影响判定之外的采样）
    try {
      const t = (await listTargets(PORT)).find((x) => x && x.type === "page" && /index\.html/.test(x.url || ""));
      if (t) {
        pageWs = connect(t.webSocketDebuggerUrl);
        await pageWs.ready;
        await pageWs.send("Runtime.enable").catch(() => { });
        pageWs.events.length = 0;
      }
    } catch (e) { }

    // 预热：先把每个面板开一次关一次，让窗口工厂、字体、适配器缓存都热起来。
    // 不预热就数基线，第一次的懒加载全会被算成泄漏。
    console.log("[churn] 预热…");
    for (const p of PANELS) {
      await inPage("d." + p.open);
      await sleep(p.waitOpen);
      await inPage("d." + p.close);
      await sleep(p.waitClose);
    }
    await sleep(1500);

    const base = await sampleMain();
    const baseTargets = await countTargets();
    if (!base) {
      console.error("[churn] 主进程采样失败（--inspect 连不上）");
      process.exit(2);
    }
    console.log(
      "[churn] 基线：窗口 " + base.windows + "，webContents " + base.contents + "，句柄 " + base.handles +
      "，RSS " + mb(base.rss) + "MB，调试目标 " + baseTargets +
      (base.note ? ("（" + base.note.trim() + "）") : "")
    );

    const rows = [];
    const problems = [];
    let maxWindows = base.windows;

    for (let r = 1; r <= ROUNDS; r++) {
      const started = Date.now();
      const perPanel = [];
      for (const p of PANELS) {
        const openedRes = await inPage("d." + p.open);
        const o = openedRes && openedRes.r;
        await sleep(p.waitOpen);
        // 窗口数只能从 /json/list 数：主进程 inspector 的求值上下文里没有 require，
        // 拿不到 electron.BrowserWindow（探针会记 no-require）。每个 BrowserWindow
        // 都会作为一个 page target 出现，所以这是最直接也最不依赖权限的信号。
        const openTargets = await countTargets();
        const mid = await sampleMain();
        if (mid) maxWindows = Math.max(maxWindows, mid.windows);
        const closedRes = await inPage("d." + p.close);
        const c = closedRes && closedRes.r;
        await sleep(p.waitClose);
        const offTargets = await countTargets();
        perPanel.push({
          key: p.key, openTargets, offTargets, windows: mid ? mid.windows : -1,
          openResult: o, closeResult: c,
        });
        if (o !== "ok") problems.push("轮 " + r + " " + p.key + " 打不开：" + o);
        if (c !== "ok") problems.push("轮 " + r + " " + p.key + " 关不掉：" + c);
        if (openTargets <= baseTargets) {
          problems.push("轮 " + r + " " + p.key + " 打开后没有新页面（目标 " + openTargets + " ≤ 基线 " + baseTargets + "），可能没真开");
        }
        if (offTargets > baseTargets) {
          problems.push("轮 " + r + " " + p.key + " 关掉后还留着 " + (offTargets - baseTargets) + " 个页面");
        }
      }
      await sleep(600);
      const s = await sampleMain();
      const targets = await countTargets();
      const row = {
        round: r,
        ms: Date.now() - started,
        windows: s ? s.windows : -1,
        contents: s ? s.contents : -1,
        windowsSeen: maxWindows,
        handles: s ? s.handles : -1,
        rss: s ? s.rss : 0,
        heap: s ? s.heapUsed : 0,
        targets,
        panels: perPanel,
      };
      rows.push(row);
      console.log(
        "[churn] 轮 " + String(r).padStart(2) + "/" + ROUNDS +
        "  窗口 " + row.windows + "/" + base.windows +
        "  内容 " + row.contents + "/" + base.contents +
        "  句柄 " + row.handles + "/" + base.handles +
        "  RSS " + mb(row.rss) + "MB" +
        "  目标 " + row.targets + "/" + baseTargets +
        "  " + (row.ms / 1000).toFixed(1) + "s"
      );
      if (s && s.windows > base.windows) {
        problems.push("轮 " + r + " 结束后多出 " + (s.windows - base.windows) + " 个窗口没关");
      }
      if (s && s.contents > base.contents + MAX_TARGET_DRIFT) {
        problems.push("轮 " + r + " 结束后多出 " + (s.contents - base.contents) + " 个 webContents 没释放");
      }
      if (targets > baseTargets + MAX_TARGET_DRIFT) {
        problems.push("轮 " + r + " 结束后调试目标 " + targets + " > 基线 " + baseTargets);
      }
    }

    const last = rows[rows.length - 1];
    const handleDelta = last.handles - base.handles;
    const rssDelta = mb(last.rss - base.rss);

    const errs = [];
    for (const ev of (pageWs && pageWs.events) || []) {
      if (ev.method === "Runtime.exceptionThrown") {
        const d = ev.params && ev.params.exceptionDetails || {};
        errs.push("异常：" + (d.text || "") + " " + ((d.exception && d.exception.description) || ""));
      } else if (ev.method === "Runtime.consoleAPICalled" && ev.params && ev.params.type === "error") {
        errs.push("console.error：" + (ev.params.args || []).map((a) => a.value || a.description || "").join(" "));
      } else if (ev.method === "Log.entryAdded") {
        const e = ev.params && ev.params.entry;
        if (e && e.level === "error") errs.push("日志：" + e.text);
      }
    }
    consoleErrors.push(...errs);

    if (handleDelta > MAX_HANDLE_DELTA) {
      problems.push("句柄涨了 " + handleDelta + "（上限 " + MAX_HANDLE_DELTA + "）");
    }
    if (rssDelta > MAX_RSS_GROWTH_MB) {
      problems.push("RSS 涨了 " + rssDelta + "MB（上限 " + MAX_RSS_GROWTH_MB + "MB）");
    }
    if (errs.length) problems.push("console 有 " + errs.length + " 条错误");

    console.log("");
    console.log("窗口峰值 : " + maxWindows + "（基线 " + base.windows + "）");
    console.log("面板残留 : 窗口 " + base.windows + " → " + last.windows + "，webContents " + base.contents + " → " + last.contents);
    console.log("句柄     : " + base.handles + " → " + last.handles + "（" + (handleDelta >= 0 ? "+" : "") + handleDelta + "）");
    console.log("RSS      : " + mb(base.rss) + " → " + mb(last.rss) + " MB（" + (rssDelta >= 0 ? "+" : "") + rssDelta + " MB）");
    console.log("调试目标 : " + baseTargets + " → " + last.targets);
    console.log("console  : " + (errs.length ? errs.length + " 条错误" : "无错误"));
    if (problems.length) {
      for (const p of problems) console.log("  ✗ " + p);
      console.log("判定     : FAIL");
    } else {
      console.log("判定     : PASS");
    }

    const out = {
      at: new Date().toISOString(),
      rounds: ROUNDS,
      panels: PANELS.map((p) => p.key),
      baseline: { windows: base.windows, contents: base.contents, handles: base.handles, rss: base.rss, targets: baseTargets, note: base.note },
      rows,
      maxWindows,
      consoleErrors,
      problems,
      pass: problems.length === 0,
    };
    const file = path.join(ROOT, "_tmp", "churn-" + out.at.replace(/[:.]/g, "-") + ".json");
    fs.writeFileSync(file, JSON.stringify(out, null, 2), "utf8");
    console.log("明细     : " + file);
    process.exitCode = problems.length === 0 ? 0 : 1;
  } catch (e) {
    console.error("[churn] 出错：" + (e && e.stack || e));
    process.exitCode = 2;
  } finally {
    if (pageWs) try { pageWs.close(); } catch (e) { }
    if (!KEEP) {
      killTree(child.pid);
      await sleep(800);
    }
  }
})();
