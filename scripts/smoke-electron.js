"use strict";
/**
 * 真机冒烟：把 app 就地跑起来，用 CDP 抓启动期的 console / 未捕获异常 / 关键全局，
 * 十几秒后自己收工。静态检查看不出「一启动就报错」这类问题，这个能。
 *
 * 用法：
 *   node scripts/smoke-electron.js              # 默认等 14 秒
 *   node scripts/smoke-electron.js --wait 25    # 多等一会儿（慢机器 / 首次加载模型）
 *   node scripts/smoke-electron.js --keep       # 跑完不杀进程，方便自己点两下
 *   node scripts/smoke-electron.js --port 9240  # 换 CDP 端口（默认 9231）
 *
 * 退出码：0 = 没有异常/console.error；1 = 有；2 = 起不来（连不上 CDP）。
 */
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);
const EXE = opt("exe", "") ? path.resolve(ROOT, opt("exe", "")) : path.join(ROOT, "runtime", "electron.exe");
function flag(name) {
  return argv.includes("--" + name);
}
function opt(name, dflt) {
  const i = argv.indexOf("--" + name);
  if (i < 0) return dflt;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : dflt;
}
const WAIT_MS = Math.max(3000, Number(opt("wait", 14000)) || 14000);
const PORT = Number(opt("port", 9231)) || 9231;
const KEEP = flag("keep");
// --eval "<表达式>" / --eval-file <文件>：跑完顺手在页面里求值并打印。
// 排查环境问题（GPU / 能力）时很省事；表达式里有引号就写进文件，别跟 shell 打架。
const EVAL_FILE = String(opt("eval-file", "") || "");
const EVAL_EXPR = EVAL_FILE
  ? (() => { try { return fs.readFileSync(EVAL_FILE, "utf8"); } catch (e) { console.error("[smoke] 读不到 " + EVAL_FILE); return ""; } })()
  : String(opt("eval", "") || "");

// 开发期噪音：Electron 自己会因为 Pixi 需要 unsafe-eval 而警告，这不是应用错误。
const NOISE = [
  /Insecure Content-Security-Policy/i,
  /Electron Security Warning/i,
  /Autofill\./i,
  /Failed to load resource: net::ERR_(CONNECTION_REFUSED|FILE_NOT_FOUND|NAME_NOT_RESOLVED)/i,
];

function isNoise(text) {
  return NOISE.some((re) => re.test(text));
}

function killTree(pid) {
  if (!pid) return;
  try {
    spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } catch (e) {
    /* 进程已经没了就算了 */
  }
}

async function listTargets() {
  try {
    const r = await fetch("http://127.0.0.1:" + PORT + "/json/list", { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  } catch (e) {
    return [];
  }
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  const events = [];
  ws.addEventListener("message", (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch (e) {
      return;
    }
    if (msg.id && pending.has(msg.id)) {
      const slot = pending.get(msg.id);
      pending.delete(msg.id);
      slot.resolve(msg);
      return;
    }
    if (msg.method) events.push(msg);
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP 握手超时")), 8000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("CDP 连接失败"));
    });
  });
  function send(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      const timer = setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(method + " 超时"));
      }, 10000);
      try {
        ws.send(JSON.stringify({ id, method, params: params || {} }));
      } catch (e) {
        clearTimeout(timer);
        pending.delete(id);
        reject(e);
      }
    });
  }
  return {
    ready,
    send,
    events,
    close() {
      try {
        ws.close();
      } catch (e) {
        /* ignore */
      }
    },
  };
}

function collect(events) {
  const out = [];
  for (const e of events) {
    if (e.method === "Runtime.exceptionThrown") {
      const d = (e.params && e.params.exceptionDetails) || {};
      const ex = d.exception || {};
      const text = String(ex.description || ex.value || d.text || "未知异常");
      out.push({ kind: "exception", text });
      continue;
    }
    if (e.method === "Runtime.consoleAPICalled") {
      const type = e.params && e.params.type;
      if (type !== "error" && type !== "assert") continue;
      const parts = ((e.params.args || []).map((a) => {
        if (a.value !== undefined) return String(a.value);
        if (a.description) return String(a.description);
        return String(a.type || "");
      }) || []);
      out.push({ kind: "console." + type, text: parts.join(" ").slice(0, 600) });
      continue;
    }
    if (e.method === "Log.entryAdded") {
      const en = (e.params && e.params.entry) || {};
      if (en.level !== "error") continue;
      out.push({ kind: "log", text: String(en.text || "").slice(0, 600) + (en.url ? "  @" + en.url : "") });
    }
  }
  return out.filter((p) => !isNoise(p.text));
}

const PROBE = `(() => {
  const t = (k) => { try { return typeof window[k]; } catch (e) { return "err"; } };
  const out = { href: "", ready: "", globals: {}, errText: "", noModel: null, debug: null };
  out.href = location.href;
  out.ready = document.readyState;
  for (const k of ["PIXI", "Live2D", "FishModel", "FishVoice", "FishSay", "FishPet", "FishLines", "FishPanel", "FishMotions"]) out.globals[k] = t(k);
  const errEl = document.getElementById("err");
  out.errText = errEl ? String(errEl.textContent || "").trim().slice(0, 300) : "";
  const nm = document.getElementById("noModel");
  if (nm) {
    const cs = getComputedStyle(nm);
    out.noModel = cs.display !== "none" && cs.visibility !== "hidden";
  }
  try {
    if (typeof window.__fishDebug === "function") out.debug = window.__fishDebug();
  } catch (e) {
    out.debugFail = String((e && e.message) || e);
  }
  return JSON.stringify(out);
})()`;

(async () => {
  if (!fs.existsSync(EXE)) {
    console.error("找不到 Electron 运行时：" + EXE);
    process.exit(2);
  }

  // DSH / CI 的 shell 会带 ELECTRON_RUN_AS_NODE=1，Electron 会当 Node 跑然后立刻退出。
  // 这两个变量必须摘掉，否则十次有十次是「假崩」。
  const env = Object.assign({}, process.env);
  for (const k of ["ELECTRON_RUN_AS_NODE", "CHROME_CRASHPAD_PIPE_NAME", "ELECTRON_NO_ATTACH_CONSOLE"]) delete env[k];

  console.log("[smoke] 启动 " + EXE + " (CDP " + PORT + ")");
  const child = spawn(EXE, ["--remote-debugging-port=" + PORT].concat(EXE.includes("win-unpacked") ? [] : ["."]), {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false,
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => { stdout += d.toString("utf8"); });
  child.stderr.on("data", (d) => { stderr += d.toString("utf8"); });

  let exited = false;
  child.on("exit", (code, sig) => {
    exited = true;
    if (code !== null && code !== 0) console.log("[smoke] 进程退出 code=" + code + " sig=" + sig);
  });

  const page = await new Promise((resolve) => {
    const deadline = Date.now() + 25000;
    (async function tick() {
      if (exited) return resolve(null);
      const ts = await listTargets();
      const hit = ts.find((t) => t && t.type === "page" && /index\.html/i.test(String(t.url || ""))) || ts.find((t) => t && t.type === "page");
      if (hit && hit.webSocketDebuggerUrl) return resolve(hit);
      if (Date.now() > deadline) return resolve(null);
      setTimeout(tick, 400);
    })();
  });

  if (!page) {
    console.error("[smoke] 连不上调试端口（应用没起来，或 25 秒内没出窗口）");
    if (stdout.trim()) console.error("--- stdout ---\n" + stdout.trim().slice(-2000));
    if (stderr.trim()) console.error("--- stderr ---\n" + stderr.trim().slice(-2000));
    if (!KEEP) killTree(child.pid);
    process.exit(2);
  }

  console.log("[smoke] 已连上：" + page.url);
  const cdp = connect(page.webSocketDebuggerUrl);
  try {
    await cdp.ready;
  } catch (e) {
    console.error("[smoke] " + e.message);
    if (!KEEP) killTree(child.pid);
    process.exit(2);
  }
  await Promise.all([
    cdp.send("Runtime.enable").catch(() => {}),
    cdp.send("Log.enable").catch(() => {}),
    cdp.send("Page.enable").catch(() => {}),
  ]);

  console.log("[smoke] 观察 " + Math.round(WAIT_MS / 1000) + " 秒…");
  await new Promise((r) => setTimeout(r, WAIT_MS));

  let probe = null;
  try {
    const res = await cdp.send("Runtime.evaluate", { expression: PROBE, returnByValue: true, awaitPromise: false });
    const raw = res && res.result && res.result.result && res.result.result.value;
    if (raw) probe = JSON.parse(raw);
  } catch (e) {
    console.log("[smoke] 取状态失败：" + e.message);
  }

  const problems = collect(cdp.events);

  if (EVAL_EXPR) {
    try {
      const r = await cdp.send("Runtime.evaluate", { expression: EVAL_EXPR, returnByValue: true, awaitPromise: true });
      const v = r && r.result && r.result.result;
      const text = v && v.value !== undefined ? v.value : (v && v.description) || "(undefined)";
      console.log("[smoke] eval → " + (typeof text === "string" ? text : JSON.stringify(text)));
    } catch (e) {
      console.log("[smoke] eval 失败：" + e.message);
    }
  }

  // --shot <png 路径>：把当前窗口截下来，看真实排版比看代码可靠。
  const SHOT = String(opt("shot", "") || "");
  if (SHOT) {
    try {
      const r = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      const b64 = r && r.result && r.result.data;
      if (b64) {
        fs.mkdirSync(path.dirname(path.resolve(ROOT, SHOT)), { recursive: true });
        fs.writeFileSync(path.resolve(ROOT, SHOT), Buffer.from(b64, "base64"));
        console.log("[smoke] 截图 → " + SHOT);
      } else {
        console.log("[smoke] 截图没数据");
      }
    } catch (e) {
      console.log("[smoke] 截图失败：" + e.message);
    }
  }

  // --shot-settings：把设置中心打开，按页签挨个截图。值可以是
  //   纯路径                 → 只截当前页
  //   page=path,page=path    → page 就是 data-page（overview/appearance/…）
  //   page@2=path            → 先点页签，再点第 2 个二级页签（0 起），用来截「变身引擎」这种子页
  const SHOT_SETTINGS = String(opt("shot-settings", "") || "");
  if (SHOT_SETTINGS) {
    const shots = SHOT_SETTINGS.split(",").map((x) => x.trim()).filter(Boolean).map((x) => {
      const i = x.indexOf("=");
      const spec = i > 0 ? x.slice(0, i) : "";
      const at = spec.indexOf("@");
      return {
        page: at > 0 ? spec.slice(0, at) : spec,
        sub: at > 0 ? Math.max(0, parseInt(spec.slice(at + 1), 10) || 0) : -1,
        file: i > 0 ? x.slice(i + 1) : x,
      };
    });
    try {
      await cdp.send("Runtime.evaluate", {
        expression: "(window.deskfish && window.deskfish.openSettings) ? (window.deskfish.openSettings(), 'opened') : 'no-api'",
        returnByValue: true,
      });
      await new Promise((r) => setTimeout(r, 2600));
      const ts = await listTargets();
      const st = ts.find((t) => /settings\.html/i.test(String(t.url || "")));
      if (!st || !st.webSocketDebuggerUrl) throw new Error("没等到设置窗口");
      const c2 = connect(st.webSocketDebuggerUrl);
      await c2.ready;
      await c2.send("Page.enable").catch(() => { });
      // 老版本 Chromium 上不 enable 也能 evaluate，但实测这台的设置窗口
      // 不 enable 时 Runtime.evaluate 会回 undefined，加上就正常了。
      await c2.send("Runtime.enable").catch(() => { });
      // 等一帧，别截到淡入动画中间。
      await new Promise((r) => setTimeout(r, 500));
      // --eval-settings "<js>"：截之前先在设置窗口里跑一段脚本，用来点按钮
      // （检查更新、试听、测试连接…）再截结果。--eval-wait 控制点完等多久。
      const EVAL_SETTINGS = String(opt("eval-settings", "") || "");
      if (EVAL_SETTINGS) {
        let evSrc = EVAL_SETTINGS;
        // 引号多的脚本就别在命令行里跟 PowerShell 打架了，写文件用 @路径
        if (evSrc.charAt(0) === "@") {
          try { evSrc = fs.readFileSync(path.resolve(ROOT, evSrc.slice(1)), "utf-8"); }
          catch (e) { console.log("[smoke] 读不到 eval 文件：" + e.message); evSrc = ""; }
        }
        if (evSrc) {
          const er = await c2.send("Runtime.evaluate", {
            expression: evSrc, returnByValue: true, awaitPromise: true,
          });
          const ev = er && er.result && er.result.result && er.result.result.value;
          console.log("[smoke] settings eval → " + (typeof ev === "string" ? ev : JSON.stringify(ev)));
          const wms = Math.max(300, Number(opt("eval-wait", 2000)) || 2000);
          await new Promise((r) => setTimeout(r, wms));
        }
      }
      for (const shot of shots) {
        if (shot.page) {
          const expr = "(()=>{const b=document.querySelector('.tab[data-page=\"" + shot.page +
            "\"]');if(!b)return 'no-tab';b.click();return b.dataset.page;})()";
          const r0 = await c2.send("Runtime.evaluate", { expression: expr, returnByValue: true });
          const got = r0 && r0.result && r0.result.result && r0.result.result.value;
          if (got === "no-tab") { console.log("[smoke] 没有这个页签：" + shot.page); continue; }
          await new Promise((r) => setTimeout(r, 460));
        }
        if (shot.sub >= 0) {
          // 二级页签：`.subtab` 跟随当前页，点第 sub 个
          const expr2 = "(()=>{const t=document.querySelectorAll('.subpage.on .subtab, .subtab');" +
            "if(!t[" + shot.sub + "])return 'no-sub';t[" + shot.sub + "].click();return t[" + shot.sub +
            "].textContent.trim();})()";
          const r1 = await c2.send("Runtime.evaluate", { expression: expr2, returnByValue: true });
          const gotSub = r1 && r1.result && r1.result.result && r1.result.result.value;
          if (gotSub === "no-sub") { console.log("[smoke] 没有第 " + shot.sub + " 个二级页签"); continue; }
          await new Promise((r) => setTimeout(r, 420));
        }
        // 被主窗挡住时合成器不出新帧，截出来是上一帧的字节。
        await c2.send("Page.bringToFront").catch(() => { });
        await new Promise((r) => setTimeout(r, 260));
        const r2 = await c2.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        const b64 = r2 && r2.result && r2.result.data;
        if (!b64) { console.log("[smoke] 截图没数据：" + shot.file); continue; }
        const out = path.resolve(ROOT, shot.file);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, Buffer.from(b64, "base64"));
        console.log("[smoke] 设置页截图 → " + shot.file + (shot.page ? "  (" + shot.page + ")" : ""));
      }
      c2.close();
    } catch (e) {
      console.log("[smoke] 设置页截图失败：" + e.message);
    }
  }

  // --eval-wins "petpanel=<js>,chatlog=@path.js"
  // 向任意「已经打开」的窗口执行脚本：用来点按钮、聚焦元素、改状态后再截图。
  const EVAL_WINS = String(opt("eval-wins", "") || "");
  if (EVAL_WINS) {
    const jobs = EVAL_WINS.split(",").map((x) => x.trim()).filter(Boolean).map((x) => {
      const i = x.indexOf("=");
      return i > 0 ? { pat: x.slice(0, i), src: x.slice(i + 1) } : null;
    }).filter(Boolean);
    await new Promise((r) => setTimeout(r, 900));
    const ts = await listTargets();
    for (const j of jobs) {
      const t = ts.find((x) => String(x.url || "").toLowerCase().indexOf(j.pat.toLowerCase()) >= 0);
      if (!t || !t.webSocketDebuggerUrl) { console.log("[smoke] 没找到窗口：" + j.pat); continue; }
      let src = j.src;
      if (src.startsWith("@")) {
        const f = path.resolve(ROOT, src.slice(1));
        try { src = fs.readFileSync(f, "utf8"); } catch (e) { console.log("[smoke] 读不到 " + f + "：" + e.message); continue; }
      }
      try {
        const c4 = connect(t.webSocketDebuggerUrl);
        await c4.ready;
        await c4.send("Runtime.enable").catch(() => { });
        const r4 = await c4.send("Runtime.evaluate", {
          expression: src, returnByValue: true, awaitPromise: true, userGesture: true,
        });
        const v = r4 && r4.result && r4.result.result && r4.result.result.value;
        const ex = r4 && r4.result && r4.result.exceptionDetails;
        console.log("[smoke] 窗口 eval(" + j.pat + ") → " + (ex ? "异常: " + (ex.text || "") : JSON.stringify(v)));
        await new Promise((r) => setTimeout(r, 350));
        c4.close();
      } catch (e) {
        console.log("[smoke] 窗口 eval 失败 " + j.pat + "：" + e.message);
      }
    }
  }

  // --shot-wins "chatlog=_shots/c.png,petpanel=_shots/pp.png"
  // 通用版：按 URL 片段找「已经打开」的窗口截图，配合 --eval 先把它们叫出来。
  const SHOT_WINS = String(opt("shot-wins", "") || "");
  if (SHOT_WINS) {
    const want = SHOT_WINS.split(",").map((x) => x.trim()).filter(Boolean).map((x) => {
      const i = x.indexOf("=");
      return i > 0 ? { pat: x.slice(0, i), file: x.slice(i + 1) } : null;
    }).filter(Boolean);
    await new Promise((r) => setTimeout(r, 1200));
    const ts = await listTargets();
    for (const w of want) {
      const t = ts.find((x) => String(x.url || "").toLowerCase().indexOf(w.pat.toLowerCase()) >= 0);
      if (!t || !t.webSocketDebuggerUrl) { console.log("[smoke] 没找到窗口：" + w.pat); continue; }
      try {
        const c3 = connect(t.webSocketDebuggerUrl);
        await c3.ready;
        await c3.send("Page.enable").catch(() => { });
        await new Promise((r) => setTimeout(r, 450));
        await c3.send("Page.bringToFront").catch(() => { });
        await new Promise((r) => setTimeout(r, 260));
        const rr = await c3.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        const b64 = rr && rr.result && rr.result.data;
        if (!b64) { console.log("[smoke] 截图没数据：" + w.pat); c3.close(); continue; }
        const out = path.resolve(ROOT, w.file);
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, Buffer.from(b64, "base64"));
        console.log("[smoke] 窗口截图 → " + w.file + "  (" + w.pat + ")");
        c3.close();
      } catch (e) {
        console.log("[smoke] 截图失败 " + w.pat + "：" + e.message);
      }
    }
  }

  cdp.close();
  if (!KEEP) killTree(child.pid);
  // 让 WebSocket / taskkill 把手收干净再退出；直接 process.exit 会在 Node 24
  // 撞上 libuv 的 UV_HANDLE_CLOSING 断言，把一次正常的冒烟变成退出码 1。
  await new Promise((r) => setTimeout(r, 300));

  console.log("");
  console.log("========== 冒烟结果 ==========");
  if (probe) {
    console.log("页面      : " + probe.ready + "  " + probe.href);
    const globals = probe.globals || {};
    const missing = Object.keys(globals).filter((k) => globals[k] === "undefined");
    console.log("全局对象  : " + (missing.length ? "缺 " + missing.join(", ") : "全在"));
    console.log("空状态卡  : " + (probe.noModel ? "显示（没有可用模型）" : "隐藏"));
    if (probe.errText) console.log("错误条    : " + probe.errText);
    if (probe.debug) console.log("自检      : " + JSON.stringify(probe.debug));
    if (probe.debugFail) console.log("自检失败  : " + probe.debugFail);
  } else {
    console.log("页面状态  : 取不到");
  }
  if (problems.length) {
    console.log("");
    console.log("发现 " + problems.length + " 条错误：");
    for (const p of problems.slice(0, 40)) console.log("  [" + p.kind + "] " + p.text.replace(/\s+/g, " ").slice(0, 400));
    if (problems.length > 40) console.log("  …还有 " + (problems.length - 40) + " 条");
  } else {
    console.log("错误      : 无");
  }
  console.log("==============================");

  process.exit(problems.length ? 1 : 0);
})().catch((e) => {
  console.error("[smoke] 崩了：" + ((e && e.stack) || e));
  process.exit(2);
});
