"use strict";
/**
 * 真机诊断：把 app 跑起来 → 从主窗口打开「模型适配器」→ 盯住适配器那个窗口的
 * 控制台、未捕获异常、失败的 HTTP 请求，十秒钟后自己收工并打印结论。
 *
 * 为什么要单独一个脚本：适配器是**另一个 BrowserWindow**，里面的错误不会出现在主窗口，
 * 静态检查也看不出「打开就报一句没有这个接口」这种运行期问题。
 *
 * 用法：
 *   node scripts/diag-adapter.js                 # 默认开 dafeiyu
 *   node scripts/diag-adapter.js --id dafeiyu    # 指定包
 *   node scripts/diag-adapter.js --keep          # 跑完不杀，方便自己接着点
 *   node scripts/diag-adapter.js --port 9241     # 换 CDP 端口
 *   node scripts/diag-adapter.js --json          # 只输出一行 JSON（给 automation 用）
 *
 * 退出码：0 = 适配器窗口没报错；1 = 有 error / 异常 / 4xx-5xx；2 = 起不来。
 */
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { makeTmp } = require("./lib/tmp");
const os = require("node:os");

const ROOT = path.resolve(__dirname, "..");
const argv = process.argv.slice(2);
function flag(n) { return argv.includes("--" + n); }
function opt(n, d) {
  const i = argv.indexOf("--" + n);
  if (i < 0) return d;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : d;
}

const PORT = Number(opt("port", 9241)) || 9241;
const PACK_ID = String(opt("id", "dafeiyu"));
const KEEP = flag("keep");
const AS_JSON = flag("json");
const WAIT_OPEN = Math.max(4000, Number(opt("wait", 9000)) || 9000);   // 主窗口起来 + 点开适配器
const WATCH_MS = Math.max(2000, Number(opt("watch", 5000)) || 5000);   // 适配器窗口观察多久
const USER_DATA = String(opt("user-data", "") || "");

const NOISE = [
  /Insecure Content-Security-Policy/i,
  /Electron Security Warning/i,
  /Autofill\./i,
  /DevTools listening/i,
  /Failed to load resource: net::ERR_(CONNECTION_REFUSED|FILE_NOT_FOUND|NAME_NOT_RESOLVED)/i,
];
function isNoise(t) { return NOISE.some((re) => re.test(t)); }
function killTree(pid) {
  if (!pid) return;
  try { spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch (e) { }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function listTargets() {
  try {
    const r = await fetch("http://127.0.0.1:" + PORT + "/json/list", { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  } catch (e) { return []; }
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  const events = [];
  ws.addEventListener("message", (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.id && pending.has(msg.id)) { const s = pending.get(msg.id); pending.delete(msg.id); s.resolve(msg); return; }
    if (msg.method) events.push(msg);
  });
  const ready = new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("CDP 握手超时")), 8000);
    ws.addEventListener("open", () => { clearTimeout(t); res(); });
    ws.addEventListener("error", () => { clearTimeout(t); rej(new Error("CDP 连接失败")); });
  });
  function send(method, params, timeoutMs) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      const t = setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(method + " 超时"));
      }, timeoutMs || 10000);
      try { ws.send(JSON.stringify({ id, method, params: params || {} })); }
      catch (e) { clearTimeout(t); pending.delete(id); reject(e); }
    });
  }
  return { ws, send, events, ready, close: () => { try { ws.close(); } catch (e) { } } };
}

async function evalIn(conn, expression, awaitPromise) {
  const r = await conn.send("Runtime.evaluate", {
    expression,
    awaitPromise: !!awaitPromise,
    returnByValue: true,
    userGesture: true,
  }, 15000);
  if (r.error) throw new Error(JSON.stringify(r.error));
  const d = r.result && r.result.result;
  if (r.result && r.result.exceptionDetails) {
    const ex = r.result.exceptionDetails;
    throw new Error((ex.exception && (ex.exception.description || ex.exception.value)) || ex.text || "页面求值异常");
  }
  return d ? d.value : undefined;
}

// 从事件流里把「说人话」的部分抽出来
function harvest(conn, bucket) {
  for (const ev of conn.events) {
    const m = ev.method;
    const p = ev.params || {};
    if (m === "Runtime.consoleAPICalled") {
      const text = (p.args || []).map((a) => {
        if (a.value !== undefined) return typeof a.value === "string" ? a.value : JSON.stringify(a.value);
        return a.description || a.type;
      }).join(" ");
      if (isNoise(text)) continue;
      if (p.type === "error") bucket.console.push(text);
      else if (p.type === "warning") bucket.warn.push(text);
      else bucket.log.push(text);
    } else if (m === "Runtime.exceptionThrown") {
      const ex = p.exceptionDetails || {};
      const text = (ex.exception && (ex.exception.description || ex.exception.value)) || ex.text || "未捕获异常";
      if (!isNoise(String(text))) bucket.exceptions.push(String(text).split("\n")[0]);
    } else if (m === "Log.entryAdded") {
      const e = p.entry || {};
      const text = e.text || "";
      if (isNoise(text)) continue;
      if (e.level === "error") bucket.console.push("[log] " + text);
      else if (e.level === "warning") bucket.warn.push("[log] " + text);
    } else if (m === "Network.responseReceived") {
      const r = p.response || {};
      const code = Number(r.status) || 0;
      if (code >= 400 && /^https?:\/\/(127\.0\.0\.1|localhost)/.test(String(r.url))) {
        bucket.http.push(code + " " + String(r.url).replace(/^https?:\/\/[^/]+/, ""));
      }
    } else if (m === "Network.loadingFailed") {
      const t = p.errorText || "";
      if (isNoise(t)) continue;
      if (!/ERR_ABORTED/.test(t)) bucket.netFail.push(t + " " + (p.requestId || ""));
    }
  }
  conn.events.length = 0;
}

async function main() {
  const exe = path.join(ROOT, "runtime", "electron.exe");
  if (!fs.existsSync(exe)) {
    console.error("[diag] 找不到 " + exe + "，先跑一次 npm run deps 或用 --exe 指定");
    process.exit(2);
  }
  const ud = USER_DATA || makeTmp("dfy-diag-");
  // --seed-override：先人为做出一份「本机配置覆盖内置包」——userDir 里只放 pet.json，
  // 模型本体仍在 _app\model。这正是用户点过「保存并应用」之后的状态，
  // 也是 missingModel 误判（红色「模型文件不存在」）的那个现场。
  if (flag("seed-override")) {
    const src = path.join(ROOT, "model");
    const dst = path.join(ud, "models", "dafeiyu");
    fs.mkdirSync(dst, { recursive: true });
    for (const f of ["pet.json", "voice.json"]) {
      const s = path.join(src, f);
      if (fs.existsSync(s)) fs.copyFileSync(s, path.join(dst, f));
    }
    if (!AS_JSON) console.log("[diag] 已铺覆盖层：" + dst + "（只有配置，没有 .moc3）");
  }
  const args = [
    "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + ud,
    "." + path.sep + "",
  ];
  // DSH / CI 的 shell 会带 ELECTRON_RUN_AS_NODE=1，Electron 会当 Node 跑，
  // 然后抱怨 "bad option: --remote-debugging-port" 并立刻退出。必须清掉。
  const env = Object.assign({}, process.env, { FISH_MULTI: "1", FISH_TEST_HIDDEN: "1" });
  for (const k of ["ELECTRON_RUN_AS_NODE", "CHROME_CRASHPAD_PIPE_NAME", "ELECTRON_NO_ATTACH_CONSOLE"]) delete env[k];
  const child = spawn(exe, args, {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env,
  });
  const childOut = [];
  child.stdout.on("data", (b) => childOut.push(String(b)));
  child.stderr.on("data", (b) => childOut.push(String(b)));

  const cleanup = () => { if (!KEEP) killTree(child.pid); };
  process.on("exit", cleanup);

  // 等主窗口
  let main = null;
  const deadline = Date.now() + WAIT_OPEN;
  while (Date.now() < deadline) {
    const list = await listTargets();
    const page = list.find((t) => t.type === "page" && /index\.html/i.test(String(t.url)));
    if (page) { main = page; break; }
    await sleep(300);
  }
  if (!main) {
    if (AS_JSON) console.log(JSON.stringify({ ok: false, stage: "boot", stderr: childOut.join("").slice(-2000) }));
    else { console.error("[diag] 主窗口没起来（CDP 连不上）。子进程输出尾部："); console.error(childOut.join("").slice(-2000)); }
    cleanup(); process.exit(2);
  }

  const mainConn = connect(main.webSocketDebuggerUrl);
  await mainConn.ready;
  await mainConn.send("Runtime.enable").catch(() => { });
  await mainConn.send("Log.enable").catch(() => { });
  await sleep(1500);

  // 先看主窗口认不认识这个包、当前的包列表。
  // 注意：preload 只暴露 openAdapter / onPackChanged 这几个方法，**没有** listPacks；
  // 包列表走的是同源 HTTP 接口 /api/packs（适配器窗口用的那一套）。
  const before = await evalIn(mainConn, `(async () => {
    const out = { hasApi: !!window.deskfish, hasOpenAdapter: !!(window.deskfish && window.deskfish.openAdapter) };
    try {
      const r = await fetch("/api/packs", { cache: "no-store" });
      const j = await r.json();
      out.httpStatus = r.status;
      out.packs = j && j.ok ? (j.packs || []).map((p) => ({ id: p.id, origin: p.origin, missingModel: !!p.missingModel })) : null;
      out.apiError = j && j.ok ? null : (j && j.error) || null;
    } catch (e) { out.err = String((e && e.message) || e); }
    return out;
  })()`, true).catch((e) => ({ err: String(e.message || e) }));

  // 打开适配器
  const opened = await evalIn(mainConn, `(async () => {
    try {
      if (!window.deskfish) return { ok: false, err: "主窗口没有 deskfish 接口" };
      if (!window.deskfish.openAdapter) return { ok: false, err: "主窗口没有 openAdapter 接口" };
      const r = await window.deskfish.openAdapter(${JSON.stringify(PACK_ID)}, "");
      return { ok: true, r: r === undefined ? null : r };
    } catch (e) { return { ok: false, err: String(e && e.message || e) }; }
  })()`, true).catch((e) => ({ ok: false, err: String(e.message || e) }));

  // 等适配器窗口出现
  let adp = null;
  const adl = Date.now() + 12000;
  while (Date.now() < adl) {
    const list = await listTargets();
    adp = list.find((t) => t.type === "page" && /adapter\.html/i.test(String(t.url)));
    if (adp) break;
    await sleep(250);
  }
  if (!adp) {
    const list = await listTargets();
    const payload = { ok: false, stage: "adapter-window", opened, before, targets: list.map((t) => ({ type: t.type, url: t.url })), stderr: childOut.join("").slice(-1500) };
    if (AS_JSON) console.log(JSON.stringify(payload));
    else {
      console.error("[diag] 适配器窗口没出现。openAdapter 返回：" + JSON.stringify(opened));
      console.error("[diag] 当时的 target：" + JSON.stringify(payload.targets));
      console.error(childOut.join("").slice(-1500));
    }
    mainConn.close(); cleanup(); process.exit(2);
  }

  // 盯住适配器：从头开 Log/Network/Runtime 已晚，至少能抓它后续的动作与重载
  const adConn = connect(adp.webSocketDebuggerUrl);
  await adConn.ready;
  await adConn.send("Runtime.enable").catch(() => { });
  await adConn.send("Log.enable").catch(() => { });
  await adConn.send("Network.enable").catch(() => { });
  const bucket = { console: [], warn: [], log: [], exceptions: [], http: [], netFail: [] };

  // 主动重载一次：让「刚打开」的整条链路从头走一遍，错误才抓得到
  await adConn.send("Page.enable").catch(() => { });
  await adConn.send("Page.reload", { ignoreCache: true }).catch(() => { });
  await sleep(WATCH_MS);
  harvest(adConn, bucket);
  // 主窗口也可能抱怨（[fish] 模型包接口不可用…）
  const mainBucket = { console: [], warn: [], log: [], exceptions: [], http: [], netFail: [] };
  harvest(mainConn, mainBucket);

  // 适配器自己怎么看待这个包
  const state = await evalIn(adConn, `(() => {
    try {
      const d = document.querySelector("#verdict, .verdict");
      const score = document.querySelector("#score, .score");
      const errs = [].slice.call(document.querySelectorAll(".issue.bad, .issue.err, .err, .error")).map((e) => (e.textContent || "").trim()).filter(Boolean).slice(0, 12);
      const warns = [].slice.call(document.querySelectorAll(".issue.warn, .warn")).map((e) => (e.textContent || "").trim()).filter(Boolean).slice(0, 12);
      return {
        url: location.href,
        title: document.title,
        ready: document.readyState,
        verdict: d ? (d.textContent || "").trim().slice(0, 80) : "",
        score: score ? (score.textContent || "").trim().slice(0, 20) : "",
        errors: errs, warnings: warns,
        bodyHead: (document.body ? document.body.innerText : "").split("\\n").map(s => s.trim()).filter(Boolean).slice(0, 14),
      };
    } catch (e) { return { err: String(e && e.message || e) }; }
  })()`).catch((e) => ({ err: String(e.message || e) }));

  const payload = {
    ok: bucket.console.length === 0 && bucket.exceptions.length === 0 && bucket.http.filter((h) => !/^404 /.test(h)).length === 0,
    packId: PACK_ID,
    userData: ud,
    opened,
    mainWindow: {
      hasApi: before.hasApi,
      hasOpenAdapter: before.hasOpenAdapter,
      httpStatus: before.httpStatus,
      apiError: before.apiError || null,
      packs: Array.isArray(before.packs) ? before.packs : null,
      err: before.err || null,
    },
    adapter: state,
    adapterConsole: bucket,
    mainConsole: mainBucket,
  };

  if (AS_JSON) {
    console.log(JSON.stringify(payload));
  } else {
    const L = [];
    L.push("[diag] 隔离配置：" + ud);
    L.push("[diag] openAdapter -> " + JSON.stringify(opened));
    L.push("[diag] 主窗口有接口：" + before.hasApi + "（openAdapter: " + before.hasOpenAdapter + "）"
      + (before.apiError ? "  /api/packs 报：" + before.apiError : "")
      + (before.httpStatus ? "  /api/packs " + before.httpStatus : ""));
    if (Array.isArray(before.packs)) L.push("[diag] 包列表：" + before.packs.map((p) => p.id + "(" + p.origin + (p.missingModel ? ",缺模型" : "") + ")").join(", "));
    L.push("");
    L.push("── 适配器窗口 ──");
    L.push("  url：" + state.url);
    L.push("  判定：" + (state.verdict || "(空)") + "   分数：" + (state.score || "(空)"));
    if (state.errors && state.errors.length) state.errors.forEach((t) => L.push("  ✗ " + t));
    if (state.warnings && state.warnings.length) state.warnings.forEach((t) => L.push("  ! " + t));
    if (state.bodyHead && state.bodyHead.length) L.push("  页面文字：" + state.bodyHead.join(" / "));
    L.push("");
    const dump = (name, b) => {
      const n = b.console.length + b.exceptions.length + b.http.length + b.netFail.length + b.warn.length;
      L.push("── " + name + "（" + n + " 条）──");
      b.exceptions.forEach((t) => L.push("  异常: " + t));
      b.console.forEach((t) => L.push("  错误: " + t));
      b.http.forEach((t) => L.push("  HTTP: " + t));
      b.netFail.forEach((t) => L.push("  网络: " + t));
      b.warn.forEach((t) => L.push("  警告: " + t));
      if (!n) L.push("  （干净）");
    };
    dump("适配器", bucket);
    dump("主窗口", mainBucket);
    const bad = bucket.http.filter((h) => /^4|^5/.test(h));
    if (bad.length) {
      L.push("");
      L.push("！！有 " + bad.length + " 个失败请求，逐个看：");
      bad.forEach((h) => L.push("   " + h));
    }
    console.log(L.join("\n"));
  }

  adConn.close(); mainConn.close(); cleanup();
  process.exit(payload.ok ? 0 : 1);
}

main().catch((e) => {
  console.error("[diag] 脚本自己出错：" + (e && e.stack || e));
  process.exit(2);
});
