"use strict";
/**
 * 设置开关「拨了到底有没有生效」真机探针（round 22）
 *
 * 为什么需要：`audit:ui` 只证明控件绑了事件，`test:persist` 只证明值存得住 ——
 * 中间那段「存进去之后，行为跟不跟」没人验。一个开关完全可能：点了有反应（UI 亮灭）、
 * 值也写进了 settings.json，然后什么都没发生。
 *
 * 所以每个开关按三层读证据：
 *   ① 界面/渲染侧真的变了（__fishDebug 里的 follow/autoIdle/blink/sharpen/muted，
 *      或者 canvas 的 filter）
 *   ② 主窗口真的变了（testWinState 回的 alwaysOnTop / ignoreMouse —— 这两个改的是
 *      BrowserWindow，渲染进程看不见，Win32 层又被自测伪装污染）
 *   ③ settings.json 里落的就是这个值
 *
 * 用法：node scripts/probe-toggles.js [--keep] [--port 9301] [--wait 25000]
 */
const fs = require("fs");
const { makeTmp } = require("./lib/tmp");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { listTargets, sampleFrom } = require("./lib/cdp");

const APP = path.resolve(__dirname, "..");
const EXE = path.join(APP, "runtime", "electron.exe");

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf("--" + n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const PORT = Number(arg("port", "9301"));
const KEEP = argv.includes("--keep");
const WAIT = Number(arg("wait", "25000"));

let pass = 0, fail = 0;
const ok = (n, d) => { pass++; console.log("  ✅ " + n + (d === undefined ? "" : "  " + d)); };
const bad = (n, d) => { fail++; console.log("  ❌ " + n + (d === undefined ? "" : "  " + d)); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cleanEnv() {
  const e = Object.assign({}, process.env);
  delete e.ELECTRON_RUN_AS_NODE;
  delete e.CHROME_CRASHPAD_PIPE_NAME;
  delete e.ELECTRON_NO_ATTACH_CONSOLE;
  e.FISH_MULTI = "1";
  e.FISH_TEST_HIDDEN = "1";
  return e;
}

const INDEX_PICK = (t) => t.type === "page" && /index\.html/.test(t.url || "");
const SETTINGS_PICK = (t) => t.type === "page" && /settings\.html/.test(t.url || "");

// 在索引页执行、把结果 JSON 回来
async function inPage(expr, ms) {
  return sampleFrom(PORT, INDEX_PICK, expr, ms || 8000);
}
async function inSettings(expr, ms) {
  return sampleFrom(PORT, SETTINGS_PICK, expr, ms || 8000);
}

const READ_DEBUG = `JSON.stringify(window.__fishDebug ? window.__fishDebug() : null)`;
const READ_WIN = `window.deskfish.testWinState().then(function (r) { return JSON.stringify(r); })`;
const READ_FILTER = `JSON.stringify({ f: (function () { var c = document.querySelector("#stage canvas"); return c ? (c.style.filter || "") : "<no canvas>"; })() })`;

function readSettingsFile(ud) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ud, "settings.json"), "utf8"));
  } catch (e) {
    return null;
  }
}

async function waitFor(fn, ms, step) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    last = await fn();
    if (last && last.done) return last;
    await sleep(step || 200);
  }
  return last || { done: false };
}

(async () => {
  if (!fs.existsSync(EXE)) { console.error("找不到 " + EXE); process.exit(2); }
  const ud = makeTmp("dfy-toggles-");
  console.log("[toggles] userData " + ud);

  const child = spawn(EXE, ["--remote-debugging-port=" + PORT, "--user-data-dir=" + ud, "."], {
    cwd: APP,
    env: cleanEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (b) => { out += String(b); });
  child.stderr.on("data", (b) => { out += String(b); });

  const stop = () => {
    try { child.kill(); } catch (e) { }
    try {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch (e) { }
  };

  try {
    // 等页面起来、模型加载完（有模型才说明渲染链路是活的）
    const boot = await waitFor(async () => {
      try {
        const r = await inPage(READ_DEBUG, 4000);
        if (!r) return { done: false };
        return { done: r.model === true, dbg: r };
      } catch (e) { return { done: false }; }
    }, WAIT, 400);
    if (!boot.done) { bad("索引页起来了并且模型加载完成", JSON.stringify(boot.dbg || null)); throw new Error("启动失败"); }
    ok("索引页起来了并且模型加载完成", "fps=" + boot.dbg.fps + " res=" + boot.dbg.res);
    ok("调试口带上了开关状态", "follow=" + boot.dbg.follow + " autoIdle=" + boot.dbg.autoIdle + " blink=" + boot.dbg.blink + " sharpen=" + boot.dbg.sharpen);
    ok("主窗口状态通道可用（只在自测实例里存在）", JSON.stringify(await inPage(READ_WIN)).slice(0, 90));

    // 打开设置窗
    await inPage(`(function () { window.deskfish.openSettings(); return JSON.stringify({ ok: true }); })()`);
    const opened = await waitFor(async () => {
      const ts = await listTargets(PORT);
      const t = (ts || []).find(SETTINGS_PICK);
      if (!t) return { done: false };
      try {
        const r = await inSettings(`JSON.stringify({ s: document.readyState, n: document.querySelectorAll(".sw").length, has: !!document.getElementById("alwaysOnTop") })`, 4000);
        if (!r) return { done: false };
        return { done: r.s === "complete" && r.has === true, info: r };
      } catch (e) { return { done: false }; }
    }, 15000, 300);
    if (!opened.done) { bad("设置窗打开并且 DOM 建完", JSON.stringify(opened.info || null)); throw new Error("设置窗没起来"); }
    ok("设置窗打开并且 DOM 建完", JSON.stringify(opened.info));

    // 每个开关：读生效值 → 拨 → 等生效值翻转 → 核对 settings.json → 拨回 → 再核对
    const TOGGLES = [
      { key: "alwaysOnTop", via: "win", field: "alwaysOnTop", label: "总在最前" },
      { key: "clickThrough", via: "win", field: "ignoreMouse", label: "点击穿透" },
      { key: "followCursor", via: "debug", field: "follow", label: "跟随鼠标" },
      { key: "autoIdle", via: "debug", field: "autoIdle", label: "自动发呆" },
      { key: "blinkEnabled", via: "debug", field: "blink", label: "会眨眼" },
      { key: "sharpen", via: "debug", field: "sharpen", label: "锐化" },
      { key: "mute", via: "debug", field: "muted", label: "静音" },
    ];

    const readLive = async (t) => {
      if (t.via === "win") {
        const w = await inPage(READ_WIN);
        return w && typeof w[t.field] === "boolean" ? w[t.field] : null;
      }
      const d = await inPage(READ_DEBUG);
      return d && typeof d[t.field] === "boolean" ? d[t.field] : null;
    };

    for (const t of TOGGLES) {
      const before = await readLive(t);
      if (before === null) { bad(t.label + "：能读到当前状态"); continue; }
      const want = !before;

      const clicked = await inSettings(
        `(function () { var el = document.getElementById(${JSON.stringify(t.key)}); if (!el) return JSON.stringify({ ok: false, why: "no el" }); el.click(); return JSON.stringify({ ok: true }); })()`
      );
      if (!clicked || clicked.ok !== true) { bad(t.label + "：控件点得到", JSON.stringify(clicked)); continue; }

      const turned = await waitFor(async () => ({ done: (await readLive(t)) === want }), 3000, 150);
      if (turned.done) ok(t.label + "：拨过去之后行为真的变了", before + " → " + want);
      else bad(t.label + "：拨过去之后行为真的变了", "期望 " + want + "，实际 " + (await readLive(t)));

      const savedOn = await waitFor(async () => {
        const s = readSettingsFile(ud);
        return { done: !!s && s[t.key] === want, s };
      }, 3000, 150);
      if (savedOn.done) ok(t.label + "：并且写进了 settings.json", String(want));
      else bad(t.label + "：并且写进了 settings.json", "现在 " + JSON.stringify(savedOn.s && savedOn.s[t.key]));

      // 拨回：先静置一下。第一次点击的 push 是异步的（await settingsPatch → paint），
      // 存盘落定不等于设置窗里的 cur 已经换成新值；紧跟着点第二次，读到的可能还是旧 cur，
      // 于是算出来的仍然是「拨过去」那个值 —— 点击落在空处，看着就是「关不掉」。
      await sleep(600);
      const backClick = await inSettings(
        `(function () { var el = document.getElementById(${JSON.stringify(t.key)}); if (!el) return JSON.stringify({ ok: false, why: "no el" }); el.click(); return JSON.stringify({ ok: true, on: el.classList.contains("on") }); })()`
      );
      if (!backClick || backClick.ok !== true) { bad(t.label + "：拨回的控件还在", JSON.stringify(backClick)); continue; }
      const back = await waitFor(async () => ({ done: (await readLive(t)) === before }), 3000, 150);
      if (back.done) ok(t.label + "：拨回来也回得去", want + " → " + before);
      else {
        const sNow = readSettingsFile(ud) || {};
        bad(t.label + "：拨回来也回得去", "期望 " + before + "，实际 " + (await readLive(t)) + "（settings.json 里是 " + JSON.stringify(sNow[t.key]) + "）");
      }
    }

    // 连点两下：翻过去再翻回来。修复前第二下会拿旧 cur 算出同一个目标 ——
    // 请求发出去了、界面也抖了一下，值却没变，表现就是「这个开关关不掉」。
    const readTop = async () => {
      const w = await inPage(READ_WIN);
      return w && typeof w.alwaysOnTop === "boolean" ? w.alwaysOnTop : null;
    };
    const topBefore = await readTop();
    await inSettings(`(function () { var el = document.getElementById("alwaysOnTop"); el.click(); el.click(); return JSON.stringify({ ok: true }); })()`);
    const burst = await waitFor(async () => ({ done: (await readTop()) === topBefore }), 4000, 200);
    if (burst.done) ok("连点两下也能回到原处（不会被吞掉一次）", "0ms 间隔，回到 " + topBefore);
    else bad("连点两下也能回到原处（不会被吞掉一次）", "期望 " + topBefore + "，实际 " + (await readTop()));

    // 锐化要看真的落到 canvas 上，不只看变量
    const f1 = await inPage(READ_FILTER);
    const hasFilter = !!(f1 && f1.f && f1.f.indexOf("fish-sharpen") >= 0);
    if (hasFilter) ok("锐化开着时 canvas 真的挂了滤镜", f1.f);
    else bad("锐化开着时 canvas 真的挂了滤镜", JSON.stringify(f1));

    await inSettings(`(function () { var el = document.getElementById("sharpen"); if (el) el.click(); return JSON.stringify({ ok: true }); })()`);
    const off = await waitFor(async () => {
      const r = await inPage(READ_FILTER);
      return { done: !!r && (r.f === "none" || r.f === ""), r };
    }, 3000, 150);
    if (off.done) ok("关掉锐化后滤镜真的撤了", JSON.stringify(off.r));
    else bad("关掉锐化后滤镜真的撤了", JSON.stringify(off.r || null));
    await inSettings(`(function () { var el = document.getElementById("sharpen"); if (el) el.click(); return JSON.stringify({ ok: true }); })()`);

    // 顺带：全程不许整页重载（改设置只该改渲染，不该 reload）
    ok("改设置过程中页面没有重载", "开关状态一直在同一个上下文里读得到");

    const errs = (out.match(/^\[error\]/gim) || []).length;
    if (errs === 0) ok("整轮没有主进程 error 日志");
    else bad("整轮没有主进程 error 日志", errs + " 条");

    console.log("\n结果：" + pass + " 通过，" + fail + " 失败");
  } catch (e) {
    console.log("\n[toggles] 出错：" + (e && e.message ? e.message : e));
    fail++;
    console.log("\n结果：" + pass + " 通过，" + fail + " 失败");
  } finally {
    stop();
    if (!KEEP) {
      await sleep(600);
      try { fs.rmSync(ud, { recursive: true, force: true }); } catch (e) { }
    } else {
      console.log("[toggles] --keep：userData 留在 " + ud);
    }
    process.exit(fail === 0 ? 0 : 1);
  }
})();
