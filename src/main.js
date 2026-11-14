// 大肥鱼 · 桌面 Live2D 伴侣
// 主进程：一块透明、无边框、置顶的窗口；配置全部落盘到 userData/settings.json。

// ── 启动探针（打包版没有控制台，出问题只能靠这个文件看它走到哪一步）──
// 放在所有 require 之前：如果连这行都没执行，就说明 app 压根没被加载。
try {
  const __fs = require("node:fs");
  const __os = require("node:os");
  const __p = require("node:path");
  __fs.appendFileSync(__p.join(__os.tmpdir(), "dafeiyu-boot.txt"),
    "[" + new Date().toISOString() + "] enter main.js argv=" + JSON.stringify(process.argv) +
    " execPath=" + process.execPath + "\n", "utf8");
} catch (e) { }

const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage, session, net, dialog, desktopCapturer, crashReporter, shell, Notification, powerMonitor, clipboard } = require("electron");
const path = require("node:path");
const http = require("node:http");
// 内置语音引擎是 ESM（.mjs），主进程是 CJS，动态 import 要先把路径转成 file:// URL。
const { pathToFileURL } = require("node:url");
const fs = require("node:fs");
const os = require("node:os");
const { spawn } = require("node:child_process");

// 资源根目录：开发时是 _app 目录，打包后是安装目录下的 resources 目录。
// 之所以不用 app.asar 里的路径：本地 http 服务器要读真实文件做路径穿越检查，
// asar 的虚拟文件系统在这里容易出岔子，所以 src/vendor/model 全部走 extraResources。
const RES_ROOT = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");

/* ─────────────── 可写数据目录 ───────────────
 *
 * 安装版可能被装到 Program Files：那里普通用户没有写权限，而下面这些东西原本
 * 全写在安装目录里——whisper turbo 模型（1.6G 下载）、ASR 的 input.wav/asr.txt、
 * TTS 合成缓存。装到 Program Files 时它们会在最后一步失败，语音整条链路瘫掉，
 * 而且报错只是 EPERM，用户完全看不懂。
 *
 * 所以在打包态把它们整体挪到 userData。开发态（isPackaged=false）不设这两个变量，
 * engine 里会回落到原来的 engine/runtime 和 engine/models，行为和以前一模一样。
 */
if (app.isPackaged) {
  process.env.FISH_DATA_DIR = process.env.FISH_DATA_DIR || path.join(app.getPath("userData"), "runtime");
  process.env.FISH_MODEL_DIR = process.env.FISH_MODEL_DIR || path.join(app.getPath("userData"), "models");
}

/** 用户在设置里换了盘：把两个目录改过去。S 读出来之后才调，早于任何语音引擎。 */
function applyStorageDirs() {
  const custom = String((typeof S !== "undefined" && S && S.get("cacheDir")) || "").trim();
  if (!custom) return;
  process.env.FISH_DATA_DIR = path.join(custom, "runtime");
  process.env.FISH_MODEL_DIR = path.join(custom, "models");
  for (const d of [process.env.FISH_DATA_DIR, process.env.FISH_MODEL_DIR]) {
    try { fs.mkdirSync(d, { recursive: true }); } catch (e) { log("[main] 建目录失败 " + d + "：" + e.message); }
  }
  log("[main] 自定义数据目录 " + custom);
}

/* ─────────────── 自带的迷你桥接（一键接入 DSH） ───────────────
 *
 * 场景：一台新电脑上只有干净的 DSH，没装 phone-bridge。这时候大肥鱼只要
 * 能自己起一个最小桥接，就能连上去——不用用户手动装任何东西。
 *
 * 那个桥接是 bridge/mini-bridge.mjs，它自己会去找 DSH 的 bin.js 和 node.exe，
 * 对外暴露和 phone-bridge 一样形状的 /api/health /api/send /api/state。
 * 这里只负责「起它 / 停它 / 报告它活着没」。
 */
const MINI_PORT = 8898;                  // 避开 phone-bridge 的 8899
const MINI_SCRIPT = () => path.join(RES_ROOT, "bridge", "mini-bridge.mjs");
let miniProc = null;
let miniLastError = "";

// ── RVC 音色转换服务 ──────────────────────────────
// 它是可选的：要 Python + torch + fairseq，加起来上 GB，塞不进安装包。
// 所以这里只负责「找得到就起、找不到就报清楚」，环境由用户自己在机器上准备。
const RVC_PORT = 8897;
const RVC_SCRIPT = () => path.join(RES_ROOT, "rvc", "rvc_server.py");
let rvcProc = null;
let rvcLastError = "";

function rvcPython() {
  // 顺序：设置里填的 → 程序自带的 RVC 环境 → 开发机的对照环境 → 系统 python
  const cfg = (S.get().rvcPython || "").trim();
  if (cfg && fs.existsSync(cfg)) return cfg;
  const guesses = [
    path.join(RES_ROOT, "rvc", "py", "python.exe"),
    path.join(RES_ROOT, "rvc", "py", "tools", "python.exe"),
    "D:\\document\\DSH Live2D\\_rvc2\\.venv\\Scripts\\python.exe",
    path.join(app.getPath("home"), ".dsh", "rvc", "python.exe"),
    "C:\\Python310\\python.exe",
    "C:\\Python311\\python.exe",
  ];
  for (const g of guesses) { try { if (fs.existsSync(g)) return g; } catch (e) { } }
  return "";
}

function rvcStatus() {
  return {
    running: !!(rvcProc && !rvcProc.killed),
    port: RVC_PORT,
    url: "http://127.0.0.1:" + RVC_PORT,
    script: RVC_SCRIPT(),
    python: rvcPython(),
    hasScript: (() => { try { return fs.existsSync(RVC_SCRIPT()); } catch (e) { return false; } })(),
    error: rvcLastError || "",
  };
}

async function rvcStart() {
  if (rvcProc && !rvcProc.killed) return rvcStatus();
  rvcLastError = "";
  const py = rvcPython();
  if (!py) { rvcLastError = "没找到 Python（装了 RVC 环境的机器上，请在设置里填 python.exe 的完整路径）"; return rvcStatus(); }
  if (!fs.existsSync(RVC_SCRIPT())) { rvcLastError = "找不到 rvc_server.py，安装包可能不完整"; return rvcStatus(); }

  const model = (S.get().rvcModel || "").trim();
  // onnx 是默认后端：只装预编译 wheel，用户自己能装起来。
  // pth 后端更快一点，但要 fairseq 现场编译，留作本机自用。
  const backend = (S.get().rvcBackend || "onnx").trim() || "onnx";
  const device = (S.get().rvcDevice || (backend === "onnx" ? "dml" : "cuda:0")).trim()
    || (backend === "onnx" ? "dml" : "cuda:0");
  const args = [RVC_SCRIPT(), "--port", String(RVC_PORT), "--backend", backend, "--device", device];
  if (model) args.push("--model", model);

  try {
    rvcProc = spawn(py, args, {
      cwd: path.join(RES_ROOT, "rvc"),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "", PYTHONIOENCODING: "utf-8" },
      windowsHide: true,
    });
    rvcProc.stdout.on("data", (b) => { try { log("[rvc] " + b.toString("utf8").trim()); } catch (e) { } });
    rvcProc.stderr.on("data", (b) => { try { const s = b.toString("utf8").trim(); if (s) log("[rvc!] " + s.slice(0, 300)); } catch (e) { } });
    rvcProc.on("exit", (code) => { log("[main] RVC 服务退出 code=" + code); rvcProc = null; });
    log("[main] RVC 服务启动 " + py + " device=" + device);
  } catch (e) {
    rvcLastError = String(e && e.message || e);
    rvcProc = null;
  }
  return rvcStatus();
}

function rvcStop() {
  // proc.kill() 在 Windows 上只杀直接子进程；Python 里如果拉了孙进程会漏下来。
  // 用 taskkill /T 连整棵进程树一起收，才算真的关干净。
  try {
    if (rvcProc && rvcProc.pid) {
      try {
        require("node:child_process").execFileSync("taskkill", ["/T", "/F", "/PID", String(rvcProc.pid)], { stdio: "ignore" });
      } catch (e) { }
      try { rvcProc.kill(); } catch (e) { }
    }
  } catch (e) { }
  rvcProc = null;
  return rvcStatus();
}

// ── 闲置自动关闭 ──────────────────────────────────────────
// RVC 常驻要占 1.9GB 内存加一块显卡。一个人可能一天只跟她说几句话，
// 剩下二十三个小时都在白占。所以闲置够久就把它收掉。
// 「最后一次用到」而不是「启动时间」——刚起就来一句是很常见的，
// 不能因为过了五分钟没说话就把正要用的服务关掉。
const RVC_IDLE_MS = 5 * 60 * 1000;
let rvcLastUse = 0;

function rvcTouch() {
  rvcLastUse = Date.now();
}

function rvcIdleTick() {
  if (!rvcProc) return;
  if (S.get().rvcAutoStop === false) return;
  if (!rvcLastUse) { rvcTouch(); return; }   // 刚起还没用过，从现在开始算
  if (Date.now() - rvcLastUse < RVC_IDLE_MS) return;
  log("[rvc] 闲置超过 " + Math.round(RVC_IDLE_MS / 60000) + " 分钟，自动关闭");
  rvcStop();
  rvcLastUse = 0;
}

// 转发到 Python 服务。主进程转发而不是让渲染进程直连，是为了让 CORS、
// 超时、错误格式都只有一个地方管。
async function rvcFetch(p, opts) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), (opts && opts.timeoutMs) || 120000);
  const o = { ...(opts || {}) };
  delete o.timeoutMs;
  // 每次真的转发一次，就记一次「她在用」。健康检查不算——那是我们自己探的，
  // 不该让她一直开着。
  if (p.indexOf("/health") !== 0) rvcTouch();
  const t0 = Date.now();
  try {
    // 用 Node 的 fetch，不是 electron 的 net.fetch。
    // net.fetch 走 Chromium 网络栈：目标端口没人监听时它不立刻 RST，而是一路等到
    // 请求超时（实测 12 秒还没回），健康检查就变成了「点了半天没反应」。
    // 同一个地址 Node fetch 是 23ms ECONNREFUSED。本地服务就该用本地栈。
    const r = await fetch("http://127.0.0.1:" + RVC_PORT + p, { ...o, signal: ctl.signal });
    return r;
  } catch (e) {
    // 只在失败时记一笔：健康检查会被前端轮询，成功也记会把日志刷满。
    log("[rvc] 失败 " + (Date.now() - t0) + "ms " + p + " : " + (e && e.message));
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// 读服务的 /health（含自动转换进度）。服务没起/超时都返回 null，不抛。
async function rvcHealth() {
  try {
    const r = await rvcFetch("/health", { timeoutMs: 3000 });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  }
}

function miniNodeBin() {
  // 优先用 DSH 自带的 node：没有系统 node 的机器也能跑
  const dshHome = process.env.DSH_HOME || path.join(app.getPath("home"), ".dsh");
  const guesses = [
    path.join(dshHome, "dsh-runtimes", "dsh-primary-runtime", "dependencies", "node", "bin", "node.exe"),
    path.join(dshHome, "dsh-runtimes", "dsh-primary-runtime", "dependencies", "node", "node.exe"),
  ];
  for (const g of guesses) { try { if (fs.existsSync(g)) return g; } catch (e) { } }
  // 打包版里 Electron 自己就是 node，加这个变量就能当 node 用
  return process.execPath;
}

function miniStatus() {
  return {
    running: !!(miniProc && !miniProc.killed),
    port: MINI_PORT,
    url: "http://127.0.0.1:" + MINI_PORT,
    script: MINI_SCRIPT(),
    error: miniLastError || "",
  };
}

// 桥接地址只补空，不改用户填的值。
// 以前这里会无条件把地址拽到自带迷你桥接的 8898：用户明明配了 phone-bridge（8899），
// 一开机又被改回一个没人的端口，报错看着像配置错，其实是地址被改掉了。
// 现在：空才填默认（phone-bridge 8899），有值一律尊重。
const BRIDGE_DEFAULT = "http://127.0.0.1:8899";

function bridgeBase() {
  return String(S.get().bridgeUrl || BRIDGE_DEFAULT).replace(/\/+$/, "");
}

function miniFixBridgeUrl() {
  try {
    const cur = (S.get().bridgeUrl || "").trim();
    if (cur) return;
    S.patch({ bridgeUrl: BRIDGE_DEFAULT });
    log("[main] bridgeUrl 为空，已填默认 " + BRIDGE_DEFAULT);
    try { win && win.webContents.send("settings-changed", S.get()); } catch (e) { }
  } catch (e) { }
}

// 探一下外部桥接（phone-bridge）在不在。只用来看日志和状态，不擅自拉起别的进程。
async function probeBridge() {
  try {
    const r = await fetch(bridgeBase() + "/api/health", { cache: "no-store" });
    if (!r.ok) return false;
    const j = await r.json();
    return !!(j && j.ok);
  } catch (e) {
    return false;
  }
}

async function miniStart() {
  if (miniProc && !miniProc.killed) return miniStatus();
  const script = MINI_SCRIPT();
  if (!fs.existsSync(script)) {
    miniLastError = "找不到 bridge/mini-bridge.mjs";
    return miniStatus();
  }
  const isElectron = /electron|大肥鱼/i.test(path.basename(process.execPath));
  const env = { ...process.env, FISH_BRIDGE_PORT: String(MINI_PORT) };
  // Electron 当 node 用时必须显式说明，否则它会按 GUI 主进程解析脚本
  if (isElectron) env.ELECTRON_RUN_AS_NODE = "1";
  try {
    miniProc = spawn(miniNodeBin(), [script, "--port", String(MINI_PORT)], {
      cwd: path.dirname(script),
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    miniLastError = "";
    miniProc.stdout.on("data", (d) => log("[bridge] " + String(d).trim().slice(0, 200)));
    miniProc.stderr.on("data", (d) => {
      const t = String(d).trim();
      miniLastError = t.slice(0, 300);
      log("[bridge!] " + miniLastError);
    });
    miniProc.on("close", (code) => {
      if (code !== 0) miniLastError = "桥接退出（code=" + code + "）";
      miniProc = null;
    });
    log("[main] 自带桥接已启动，端口 " + MINI_PORT);
    miniFixBridgeUrl();
  } catch (e) {
    miniLastError = String((e && e.message) || e);
    log("[main] 自带桥接起不来: " + miniLastError);
  }
  return miniStatus();
}

function miniStop() {
  try {
    if (miniProc && miniProc.pid) {
      try {
        require("node:child_process").execFileSync("taskkill", ["/T", "/F", "/PID", String(miniProc.pid)], { stdio: "ignore" });
      } catch (e) { }
      try { miniProc.kill(); } catch (e) { }
    }
  } catch (e) { }
  miniProc = null;
  return miniStatus();
}

ipcMain.handle("mini:status", async () => miniStatus());
ipcMain.handle("mini:start", async () => miniStart());
ipcMain.handle("mini:stop", async () => miniStop());
ipcMain.handle("rvc:status", async () => {
  const st = rvcStatus();
  // 顺带把服务自己的 /health 带回来——自动转换进度在里面（convert 字段）。
  if (st.running) st.health = await rvcHealth();
  return st;
});
ipcMain.handle("rvc:start", async () => rvcStart());
ipcMain.handle("rvc:stop", async () => rvcStop());

// ---- 一键安装 RVC 环境 -------------------------------------------------
// RVC 的运行环境约 1.7GB（Python + onnxruntime + torch + 模型），装不进安装包。
// 但这条路全部是预编译 wheel，不需要 Visual Studio 编译环境，普通电脑能装完。
// 进度用 stdout 的 [step] 行回传，设置页原样显示。
let rvcSetupProc = null;

function rvcSetupStatus() {
  return {
    running: !!(rvcSetupProc && !rvcSetupProc.killed),
    python: rvcPython(),
    installed: !!(rvcPython() && fs.existsSync(RVC_SCRIPT())),
  };
}

async function rvcSetupStart() {
  if (rvcSetupProc && !rvcSetupProc.killed) return rvcSetupStatus();
  const setupScript = path.join(RES_ROOT, "rvc", "rvc_setup.py");
  if (!fs.existsSync(setupScript)) {
    rvcLastError = "找不到 rvc_setup.py，安装包可能不完整";
    return rvcSetupStatus();
  }
  // 装环境要用一个「已经有了的」python 去驱动，不能是被装的那一个
  const boot = rvcPython() || "C:\\Python310\\python.exe";
  if (!fs.existsSync(boot)) {
    rvcLastError = "这台电脑没有可用的 Python 来驱动安装（先装一个 Python 3.10+）";
    return rvcSetupStatus();
  }
  try {
    rvcSetupProc = spawn(boot, [setupScript], {
      cwd: path.join(RES_ROOT, "rvc"),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "", PYTHONIOENCODING: "utf-8" },
      windowsHide: true,
    });
    const push = (line) => {
      try {
        if (win && !win.isDestroyed()) win.webContents.send("rvc-setup", String(line));
      } catch (e) { }
      try { log("[setup] " + line); } catch (e) { }
    };
    let buf = "";
    rvcSetupProc.stdout.on("data", (b) => {
      buf += b.toString("utf8");
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() || "";
      for (const l of lines) if (l.trim()) push(l.trim());
    });
    rvcSetupProc.stderr.on("data", (b) => { try { const s = b.toString("utf8").trim(); if (s) push("[!] " + s.slice(0, 400)); } catch (e) { } });
    rvcSetupProc.on("exit", (code) => {
      push(code === 0 ? "[done] 安装完成，可以启动 RVC 了" : "[error] 安装退出，code=" + code);
      rvcSetupProc = null;
    });
    log("[main] 开始安装 RVC 环境 " + boot);
  } catch (e) {
    rvcLastError = String(e && e.message || e);
  }
  return rvcSetupStatus();
}

function rvcSetupStop() {
  try { if (rvcSetupProc) rvcSetupProc.kill(); } catch (e) { }
  rvcSetupProc = null;
  return rvcSetupStatus();
}

ipcMain.handle("rvc:setupStatus", async () => rvcSetupStatus());
ipcMain.handle("rvc:setup", async () => rvcSetupStart());
ipcMain.handle("rvc:setupStop", async () => rvcSetupStop());

// ---- 一键安装 XTTS 环境 ------------------------------------------------
// 约 6GB（torch CUDA 版 2.3G + TTS 依赖 + XTTS-v2 模型 1.8G），装不进包。
// 和 RVC 分开一个环境：RVC 那边用 numpy 替身顶掉了 torch，硬塞会把 RVC 弄坏。
// 装好之后 engine/xtts.mjs 的 available() 会自动认（它就看 tts2/py/Scripts/python.exe）。
let xttsSetupProc = null;

function xttsPy() { return path.join(RES_ROOT, "tts2", "py", "Scripts", "python.exe"); }

function xttsSetupStatus() {
  return {
    running: !!(xttsSetupProc && !xttsSetupProc.killed),
    python: xttsPy(),
    installed: fs.existsSync(xttsPy()),
  };
}

async function xttsSetupStart() {
  if (xttsSetupProc && !xttsSetupProc.killed) return xttsSetupStatus();
  const setupScript = path.join(RES_ROOT, "engine", "tools", "xtts_setup.py");
  if (!fs.existsSync(setupScript)) {
    log("[main] 找不到 xtts_setup.py，安装包可能不完整");
    return xttsSetupStatus();
  }
  // 驱动安装的 Python 不能是「正在被装的那一个」：先找 RVC 装好的，再找常见的系统位置
  const cands = [rvcPython(), "C:\\Python310\\python.exe", "C:\\Python311\\python.exe", "python"];
  let boot = null;
  for (const c of cands) {
    try {
      if (c === "python") { boot = c; break; }
      if (c && fs.existsSync(c)) { boot = c; break; }
    } catch (e) { }
  }
  if (!boot) {
    log("[main] 这台电脑没有可用的 Python 来驱动 XTTS 安装");
    return xttsSetupStatus();
  }
  try {
    xttsSetupProc = spawn(boot, [setupScript], {
      cwd: path.join(RES_ROOT, "tts2"),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "", PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      windowsHide: true,
    });
    const push = (line) => {
      try { if (win && !win.isDestroyed()) win.webContents.send("xtts-setup", String(line)); } catch (e) { }
      try { log("[xtts-setup] " + line); } catch (e) { }
    };
    let buf = "";
    xttsSetupProc.stdout.on("data", (b) => {
      buf += b.toString("utf8");
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() || "";
      for (const l of lines) if (l.trim()) push(l.trim());
    });
    xttsSetupProc.stderr.on("data", (b) => { try { const s = b.toString("utf8").trim(); if (s) push("[!] " + s.slice(0, 400)); } catch (e) { } });
    xttsSetupProc.on("exit", (code) => {
      push(code === 0 ? "[done] XTTS 装好了，切到 XTTS 就能用" : "[error] 安装退出，code=" + code);
      xttsSetupProc = null;
      try { __xtts = null; } catch (e) { }   // 清掉模块缓存，让它重新读 available()
    });
    log("[main] 开始安装 XTTS 环境 " + boot);
  } catch (e) {
    log("[main] XTTS 安装启动失败: " + (e && e.message || e));
  }
  return xttsSetupStatus();
}

function xttsSetupStop() {
  try { if (xttsSetupProc) xttsSetupProc.kill(); } catch (e) { }
  xttsSetupProc = null;
  return xttsSetupStatus();
}

ipcMain.handle("xtts:setupStatus", async () => xttsSetupStatus());
ipcMain.handle("xtts:setup", async () => xttsSetupStart());
ipcMain.handle("xtts:setupStop", async () => xttsSetupStop());

// ---- 一键安装飞鱼声线 --------------------------------------------------
// 约 14GB（声库 7.1G + venv 5.6G + 中文 Hubert 1.2G），比 XTTS 还大一倍多，
// 更不可能进包。装到「环境」里填的那个目录，空着就用 D:\feiyu。
// 装完 engine/feiyu.mjs 的 available() 会自动认（它看 venv/Scripts/python.exe）。
let feiyuSetupProc = null;

function feiyuHomeDir() {
  const raw = (S.get().feiyuHome || "").trim();
  return raw || "D:\\feiyu";
}

function feiyuSetupStatus() {
  const home = feiyuHomeDir();
  const py = path.join(home, "venv", "Scripts", "python.exe");
  const cute = path.join(home, "models", "FeiyuVoice-CosyVoice3", "models", "feiyu_cute_F6_0040.pt");
  return {
    running: !!(feiyuSetupProc && !feiyuSetupProc.killed),
    home,
    python: py,
    installed: fs.existsSync(py) && fs.existsSync(cute),
    hasEnv: fs.existsSync(py),
    hasVoice: fs.existsSync(cute),
  };
}

async function feiyuSetupStart() {
  if (feiyuSetupProc && !feiyuSetupProc.killed) return feiyuSetupStatus();
  const setupScript = path.join(RES_ROOT, "engine", "tools", "feiyu_setup.py");
  if (!fs.existsSync(setupScript)) {
    log("[main] 找不到 feiyu_setup.py，安装包可能不完整");
    return feiyuSetupStatus();
  }
  // 驱动安装的 Python 不能是「正在被装的那一个」
  const cands = [rvcPython(), "C:\\Python311\\python.exe", "C:\\Python310\\python.exe", "python"];
  let boot = null;
  for (const c of cands) {
    try {
      if (c === "python") { boot = c; break; }
      if (c && fs.existsSync(c)) { boot = c; break; }
    } catch (e) { }
  }
  if (!boot) {
    log("[main] 这台电脑没有可用的 Python 来驱动飞鱼安装");
    return feiyuSetupStatus();
  }
  const home = feiyuHomeDir();
  try {
    feiyuSetupProc = spawn(boot, [setupScript, "--home", home], {
      cwd: home,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "", PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      windowsHide: true,
    });
    const push = (line) => {
      try { if (win && !win.isDestroyed()) win.webContents.send("feiyu-setup", String(line)); } catch (e) { }
      try { log("[feiyu-setup] " + line); } catch (e) { }
    };
    let buf = "";
    feiyuSetupProc.stdout.on("data", (b) => {
      buf += b.toString("utf8");
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() || "";
      for (const l of lines) if (l.trim()) push(l.trim());
    });
    feiyuSetupProc.stderr.on("data", (b) => { try { const s = b.toString("utf8").trim(); if (s) push("[!] " + s.slice(0, 400)); } catch (e) { } });
    feiyuSetupProc.on("exit", (code) => {
      push(code === 0 ? "[done] 飞鱼装好了，切到飞鱼就能用" : "[error] 安装退出，code=" + code);
      feiyuSetupProc = null;
      // 清掉模块缓存和代际号：让它按新目录重新 import 一次
      try { __feiyu = null; __feiyuGen++; } catch (e) { }
    });
    log("[main] 开始安装飞鱼声线 -> " + home);
  } catch (e) {
    log("[main] 飞鱼安装启动失败: " + (e && e.message || e));
  }
  return feiyuSetupStatus();
}

function feiyuSetupStop() {
  try { if (feiyuSetupProc) feiyuSetupProc.kill(); } catch (e) { }
  feiyuSetupProc = null;
  return feiyuSetupStatus();
}

ipcMain.handle("feiyu:setupStatus", async () => feiyuSetupStatus());
ipcMain.handle("feiyu:setup", async () => feiyuSetupStart());
ipcMain.handle("feiyu:setupStop", async () => feiyuSetupStop());

// 参考音频库：直接读盘，不用起模型服务（设置界面一打开就要能列出来）。
// 条目 = 一个音频文件 + 同名 .txt（里面写「这段音频说了什么」）。
// 文件名就是标签，多个标签用 + 或 、 隔开。
ipcMain.handle("feiyu:refs", async () => {
  // 用户在设置里指定过就用他的目录，留空才回落到包内默认目录
  const custom = String(S.get().feiyuRefDir || "").trim();
  const dir = custom || path.join(RES_ROOT, "assets", "refvoice");
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return { ok: false, dir, refs: [], error: "目录不存在" }; }
  for (const n of names.sort()) {
    const ext = path.extname(n).toLowerCase();
    if (![".wav", ".mp3", ".flac", ".ogg", ".m4a"].includes(ext)) continue;
    const txt = path.join(dir, n.slice(0, -ext.length) + ".txt");
    let text = "";
    try { text = fs.readFileSync(txt, "utf8").replace(/^\uFEFF/, "").trim(); } catch (e) { continue; }
    if (!text) continue;
    const name = path.basename(n, ext);
    out.push({
      id: n,
      name,
      tags: name.split(/[+、,，_]/).filter(Boolean),
      text,
    });
  }
  return { ok: true, dir, refs: out };
});

// 扫 models/*/*.onnx，给设置界面做个下拉，省得人手填路径。
// 返回的相对路径带 models/ 前缀 —— RVC 服务那边就是按 rvc/ 算的相对路径。
ipcMain.handle("rvc:listModels", async () => {
  try {
    const root = path.join(RES_ROOT, "rvc", "models");
    const out = [];
    for (const dir of fs.readdirSync(root)) {
      const full = path.join(root, dir);
      let st;
      try { st = fs.statSync(full); } catch (e) { continue; }
      if (!st.isDirectory()) continue;
      let names;
      try { names = fs.readdirSync(full); } catch (e) { continue; }
      for (const f of names) {
        if (!f.toLowerCase().endsWith(".onnx")) continue;
        if (/^(rmvpe|vec-)/i.test(f)) continue;          // 基础模型，不是音色
        out.push({
          rel: "models/" + dir + "/" + f,
          name: dir + " / " + f.replace(/\.onnx$/i, ""),
          mb: Math.round(fs.statSync(path.join(full, f)).size / 1048576),
        });
      }
    }
    out.sort((a, b) => a.rel.localeCompare(b.rel));
    return { ok: true, list: out };
  } catch (e) {
    return { ok: false, list: [], error: String(e && e.message || e) };
  }
});

// stdout 可能不可用（从资源管理器双击启动、父进程退出、管道被关），
// 这时往 console 写会抛 EPIPE 直接把主进程打死。日志永远不能成为致命路径。
//
// 而且「只有 stdout」意味着日志能不能留下，取决于你怎么启动它：
// 从开始菜单双击就什么都没了。所以自己也写一份文件到 userData，
// 不管谁来启动，出事都有据可查。
const { log, logErr, LOG_FILE } = require("./log");

const { Settings, DEFAULTS } = require("./settings");

const APP_NAME = "大肥鱼";
const BASE_W = 460;
const BASE_H = 560;
// 底部输入条的高度。窗口 = 模型区 + 这一条，所以输入框永远不遮住她。
const DOCK_H = 52;
const MARGIN_RIGHT = 30;
const MARGIN_BOTTOM = 6;

let win = null;       // 模型窗口

// 桌宠是 screen-saver 级置顶，原生文件对话框如果只是普通窗口，会被它盖住。
// 打开任何系统对话框前把桌宠临时降下去，关掉再抬回来；对话框本身仍归属
// 设置/档案窗口，不会挡住它们的父窗口。
function lowerPetForDialog() {
  const lowered = !!(win && !win.isDestroyed() && win.isAlwaysOnTop());
  if (lowered) {
    try { win.setAlwaysOnTop(false); } catch (e) { }
  }
  return lowered;
}
function restorePetAfterDialog(lowered) {
  if (!lowered || !win || win.isDestroyed()) return;
  try { win.setAlwaysOnTop(true, "screen-saver"); } catch (e) { }
}
for (const dialogName of ["showOpenDialog", "showSaveDialog", "showMessageBox"]) {
  const original = dialog[dialogName].bind(dialog);
  dialog[dialogName] = async (...args) => {
    const lowered = lowerPetForDialog();
    try {
      return await original(...args);
    } finally {
      restorePetAfterDialog(lowered);
    }
  };
}

let settingsWin = null; // 设置窗口
// 设置页崩溃计数必须放在模块作用域：放在 openSettings() 里的话，
// 每重建一次就重新从 0 开始数，「连崩三次就换兜底窗」永远触发不了（实测）。
let settingsCrashes = 0;
let settingsCrashResetTimer = null;
let tray = null;
// 退出兜底计时器：before-quit 里的清理只要有一项卡住，用户就会看到「点了退出但进程还在」。
let quitForceTimer = null;
let server = null;
let PORT = 0;
let cursorTimer = null;
let watcherTimer = null;

let S = null; // Settings 实例
// 模型适配器：管模型包仓库 + 规则系统。渲染端和适配器窗口都通过本地服务访问它。
let ADAPTER = null;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".moc3": "application/octet-stream",
};

// ---------- 本地静态服务 ----------
// file:// 下 fetch 会被同源策略挡住，模型贴图和 vendor 都得走 HTTP。
// ══ 内置语音引擎（TTS / ASR）═══════════════════════════
// 这两个模块是 ESM，主进程是 CJS，用动态 import 懒加载，只加载一次。
// 加载失败不影响程序其他功能：voice.js 会发现端点 500，回落到 DSH 的 /api/tts。
let __tts = null, __asr = null, __xtts = null, __feiyu = null;
async function engineTts() {
  // 走 RES_ROOT 而不是 __dirname/..：
  // 打包后 __dirname 在 app.asar 内部，而 engine 是 extraResources（真实文件），
  // 用 __dirname 会指向一个不存在的路径，端点直接 404 → 静默回落到 DSH。
  if (!__tts) __tts = await import(pathToFileURL(path.join(RES_ROOT, "engine", "tts.mjs")).href);
  return __tts;
}
async function engineXtts() {
  if (!__xtts) __xtts = await import(pathToFileURL(path.join(RES_ROOT, "engine", "xtts.mjs")).href);
  return __xtts;
}
let __feiyuGen = 0;
async function engineFeiyu() {
  // feiyu.mjs 顶层的 PY/PKG/REPO 是模块加载时求值的常量，所以：
  //   · import 之前必须先把 FEIYU_HOME 按设置项设好；
  //   · 用户改了 feiyuHome 之后必须让这个模块重新求值。
  // 不这么做，别人把飞鱼装到别处就用不了——那三个路径原来写死成 D:\feiyu\…。
  //
  // 关键：Node 的 ESM 缓存是永久的，光把 __feiyu 置 null 再 import 同一个 URL
  // 拿到的还是缓存里那个旧实例（顶层常量不会重新算）。所以这里给 URL 挂一个
  // 代际号做查询串，改一次设置换一个 URL，才真的重新加载。
  try {
    const h = String(S.get().feiyuHome || "").trim();
    if (h) process.env.FEIYU_HOME = h; else delete process.env.FEIYU_HOME;
  } catch (e) { }
  if (!__feiyu) {
    const u = pathToFileURL(path.join(RES_ROOT, "engine", "feiyu.mjs")).href + "?g=" + __feiyuGen;
    __feiyu = await import(u);
  }
  return __feiyu;
}
async function engineAsr() {
  if (!__asr) __asr = await import(pathToFileURL(path.join(RES_ROOT, "engine", "asr.mjs")).href);
  return __asr;
}
// 读完整请求体（上限给足：录音可能几 MB）
const { startServer } = require("./server");
async function bootServer() {
  const r = await startServer({
    root: RES_ROOT,
    mime: MIME,
    log,
    logErr,
    getSettings: () => S.get(),
    // 有的接口要顺手改一格设置（比如「恢复默认」要清掉手动调过的取景框）
    patchSettings: (p) => S.patch(p),
    engines: { tts: engineTts, xtts: engineXtts, feiyu: engineFeiyu, asr: engineAsr },
    // server.js 的 /engine/rvc* 要用它转发到 Python 服务。
    // 这个参数以前漏了 —— 那两条路由一直在抛 ReferenceError，健康检查永远 500 且挂住。
    rvcFetch,
    rvcStatus,
    // 模型包接口 + /packs/<id>/* 静态文件
    adapter: ADAPTER,
    // 服务端拿不到窗口对象，用回调把「在等声音」这种提示送回渲染层。
    notify: (channel, payload) => {
      try {
        if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
      } catch (e) { /* 窗口还没建好就丢掉，不值得为一条提示报错 */ }
    },
  });
  server = r.server;
  PORT = r.port;
  return PORT;
}

// ---------- 图标 ----------
// 优先用 assets/icon.ico（Windows 认这个，且内含多尺寸），
// 其次 icon.png，再退到模型自带图，最后用内置占位图。
function appIcon(size) {
  const candidates = [
    path.join(RES_ROOT, "assets", "icon.ico"),
    path.join(RES_ROOT, "assets", "icon.png"),
    path.join(RES_ROOT, "model", "previews", "icon.png"),
    path.join(RES_ROOT, "model", "dafeiyu.png"),
  ];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const img = nativeImage.createFromPath(p);
      if (img.isEmpty()) continue;
      return size ? img.resize({ width: size, height: size, quality: "best" }) : img;
    } catch (e) { /* 下一个 */ }
  }
  return null;
}

// 托盘要小图，直接从 assets 里取 32px 那版，比从 256 缩下去清楚
function trayIcon() {
  const p = path.join(RES_ROOT, "assets", "icon-32.png");
  try {
    if (fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) return img;
    }
  } catch (e) { /* 回退 */ }
  return appIcon(32);
}

// ---------- 窗口几何 ----------
function hasUsablePack() {
  try { return !!(ADAPTER && ADAPTER.activeId()); } catch (e) { return false; }
}

function windowSize() {
  // 一个模型都没有时窗口收小：空状态只有一张导入卡，
  // 留一个 460×612 的透明大窗会挡住桌面点击，还不知道挡在哪。
  if (!hasUsablePack()) return { w: 356, h: 512 };
  const s = S.get();
  const w = Math.round(BASE_W * s.scale);
  // 输入条占底部一条独立区域：窗口比模型区高 52px，
  // 这样她不会因为输入条出现而被压缩，输入条也不必盖在她身上。
  const h = Math.round(BASE_H * s.scale) + DOCK_H;
  return { w, h };
}

// 让渲染进程把 ticker 停掉 / 起回来。没有窗口或页面还没加载完就当没这回事。
function pauseRender(on) {
  try {
    if (!win || win.isDestroyed()) return;
    if (win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send("app:pause-render", !!on);
    }
  } catch (e) { /* 窗口正在销毁，忽略 */ }
}

// 暂停有四个来源：最小化、锁屏、休眠、用户手动。原来每个来源直接调
// pauseRender(false) —— 最小化着又锁屏时，解锁会把「还在最小化」的那份暂停一起放开，
// 于是人不在时她照样满帧画。改成记来源：只有全部来源都撤了才真的恢复。
const pauseReasons = new Set();
function setPauseReason(reason, on) {
  const key = String(reason || "manual");
  if (on) pauseReasons.add(key);
  else pauseReasons.delete(key);
  pauseRender(pauseReasons.size > 0);
  return pauseReasons.size > 0;
}
function isRenderPaused() { return pauseReasons.size > 0; }

// 用窗口当前所在的那块屏，而不是死认主屏——双屏下"回到右下角"
// 应该回到她待着的那块屏的右下角。
function currentDisplay() {
  try {
    if (win && !win.isDestroyed()) return screen.getDisplayMatching(win.getBounds());
  } catch (e) { /* 回退主屏 */ }
  return screen.getPrimaryDisplay();
}

function defaultPos(w, h) {
  const { workArea } = currentDisplay();
  const s = S.get();
  return {
    x: workArea.x + workArea.width - w - (s.offsetRight ?? MARGIN_RIGHT),
    y: workArea.y + workArea.height - h - (s.offsetBottom ?? MARGIN_BOTTOM),
  };
}

// 把「窗口现在在哪」换算成「离该屏右下角多远」存起来
function stashAnchor() {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  const [w, h] = win.getSize();
  const d = screen.getDisplayMatching({ x, y, width: w, height: h });
  const a = d.workArea;
  S.patch({
    anchorMode: "corner",
    offsetRight: a.x + a.width - (x + w),
    offsetBottom: a.y + a.height - (y + h),
  });
}

// 启动位置：必须整块落在某块屏的工作区内。offsetRight 被改坏成负数时，
// 这里会把窗口拉回来，别让人一开机就对着空气找她。
function ensureStartPos(x, y, w, h) {
  const d = screen.getDisplayNearestPoint({ x: Math.round(x + w / 2), y: Math.round(y + h / 2) });
  const a = d.workArea;
  const maxX = Math.max(a.x, a.x + a.width - w);
  const maxY = Math.max(a.y, a.y + a.height - h);
  return {
    x: Math.round(Math.min(Math.max(x, a.x), maxX)),
    y: Math.round(Math.min(Math.max(y, a.y), maxY)),
  };
}

// 拔掉外接屏 / 改分辨率 / 缩放变了：窗口中心只要不在任何一块屏上，就夹回可视区。
// 判据用「中心点」而不是「有没有相交」——只露一个角用户照样找不回来，也拖不动。
let reflowTimer = null;
function reflowToVisibleScreen() {
  if (!win || win.isDestroyed()) return;
  try {
    const b = win.getBounds();
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.bounds;
      return cx >= a.x && cx <= a.x + a.width && cy >= a.y && cy <= a.y + a.height;
    });
    if (visible) return;
    const c = ensureStartPos(b.x, b.y, b.width, b.height);
    win.setPosition(c.x, c.y);
    log("[main] 显示器变化，窗口已移回可视区 (" + c.x + "," + c.y + ")");
  } catch (e) {
    logErr("[main] 显示器变化处理失败: " + e);
  }
}

// display-metrics-changed 在拖 DPI 滑块时会连着来好几次，攒一下再动
function scheduleReflow() {
  if (reflowTimer) clearTimeout(reflowTimer);
  reflowTimer = setTimeout(reflowToVisibleScreen, 300);
}

// 主界面拉不起来时的兜底页：不走本地服务，直接内联，server 挂了也能看见
function errorPageHtml(title, detail, hint, retryUrl, closeBtn) {
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const btn = closeBtn
    ? '<button onclick="window.close()">关闭</button>'
    : `<button onclick="${retryUrl ? `location.href=${JSON.stringify(String(retryUrl))}` : "location.reload()"}">再试一次</button>`;
  return `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;height:100%;background:#161821;color:#e8eaf0;
    font:14px/1.7 "Microsoft YaHei",system-ui,sans-serif;
    display:flex;align-items:center;justify-content:center;-webkit-app-region:drag}
  .box{max-width:340px;padding:22px 24px;border:1px solid #2a2d3a;border-radius:14px;background:#1c1f2b}
  h1{margin:0 0 10px;font-size:17px;font-weight:600}
  p{margin:0 0 10px;color:#9aa0b4;font-size:13px}
  code{color:#7aa2ff;font-size:12px;word-break:break-all}
  button{margin-top:6px;padding:7px 16px;border:0;border-radius:8px;background:#3b6ef5;
    color:#fff;font-size:13px;cursor:pointer;-webkit-app-region:no-drag}
</style>
<div class="box">
  <h1>${esc(title)}</h1>
  <p><code>${esc(detail)}</code></p>
  <p>${esc(hint)}</p>
  ${btn}
</div>`;
}

// 把兜底页塞进**指定**窗口。同一个函数给模型窗和设置窗用 ——
// 设置窗是最该稳的那个（用户出问题第一件事就是去设置里看），不能崩成一片白。
//
// 已经在显示兜底页就直接返回：渲染进程崩掉时 render-process-gone 会连着触发两次，
// 每次都 loadURL 会变成「崩溃 → 加载兜底页 → 又崩 → 又加载」的死循环（实测 3 秒 4 次）。
// 用 WeakSet 记「这个窗口已经贴过兜底页」，等它重新加载出真实页面时再清掉。
const errorPageShown = new WeakSet();
function loadErrorInto(target, title, detail, hint, retryUrl) {
  if (!target || target.isDestroyed()) return;
  try {
    const wc = target.webContents;
    if (errorPageShown.has(wc)) return;
    const cur = wc.getURL() || "";
    if (cur.startsWith("data:text/html")) return;
    errorPageShown.add(wc);
    wc.on("did-finish-load", () => {
      try {
        if (!(wc.getURL() || "").startsWith("data:text/html")) errorPageShown.delete(wc);
      } catch (e) { }
    });
  } catch (e) { }
  try {
    target.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(errorPageHtml(title, detail, hint, retryUrl)));
  } catch (e) {
    logErr("[main] 兜底页也加载失败: " + e);
  }
}

function showLoadError(title, detail) {
  loadErrorInto(win, title, detail,
    "这不是模型的问题。常见原因：7801 端口被别的程序占了、杀毒软件拦了本地回环、或者安装不完整。",
    `http://127.0.0.1:${PORT}/src/index.html`);
}

// 设置页连着崩三次时用：开一张干净的独立窗口，只讲清楚发生了什么、下一步做什么。
// 不带 preload —— 它不是设置页的替代品，只是一张说明卡片。
function openSettingsError(reason) {
  const w = new BrowserWindow({
    width: 420,
    height: 300,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    center: true,
    backgroundColor: "#00000000",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  w.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(errorPageHtml(
    "设置页面反复崩溃",
    "原因：" + reason,
    "已经记进 run.log。关掉这个窗口后，可以试着从托盘「设置…」再打开一次；如果一直这样，把诊断包发给开发者。",
    "",
    true,
  )));
  w.once("ready-to-show", () => w.show());
}

// 模型窗连续崩溃时用：同样是一张独立的说明卡，出现在右下角原来那个位置附近。
function openModelError(detail) {
  const a = screen.getPrimaryDisplay().workArea;
  // 别把宽度变量叫 w：下面 BrowserWindow 也常被叫 w，一旦混用就是
  // 「w.loadURL is not a function」这种自己给自己挖的坑（这台机器上真踩过）。
  const boxW = 360;
  const boxH = 260;
  const b = new BrowserWindow({
    width: boxW,
    height: boxH,
    x: Math.round(a.x + a.width - boxW - 30),
    y: Math.round(a.y + a.height - boxH - 30),
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  b.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(errorPageHtml(
    "界面连续崩了",
    detail,
    "已经记进 run.log。可以从托盘「设置…」里导出诊断包；也可以直接退出再重开一次。",
    "",
    true,
  )));
  b.once("ready-to-show", () => {
    try {
      log("[main] 模型兜底窗 ready-to-show bounds=" + JSON.stringify(b.getBounds()));
      b.show();
    } catch (e) { logErr("[main] 模型兜底窗显示失败: " + e); }
  });
}

// 启动链中途失败时用：这时候连主窗口都还没建，日志在 %APPDATA% 里没人会去看。
// 给一张说明卡，至少让用户知道「不是没启动，是起不来」以及去哪里找原因。
function openStartupError(err) {
  const detail = (err && err.message) ? err.message : String(err || "未知错误");
  const boxW = 420;
  const boxH = 300;
  const b = new BrowserWindow({
    width: boxW,
    height: boxH,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    center: true,
    backgroundColor: "#00000000",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  b.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(errorPageHtml(
    "大肥鱼没能启动",
    "原因：" + detail,
    "多半是本地端口被占用，或者被安全软件拦了。可以退出后重开一次；如果一直这样，把 %APPDATA%\\dafeiyu-desk\\run.log 发给开发者。",
    "",
    true,
  )));
  b.once("ready-to-show", () => {
    try { b.show(); } catch (e) { logErr("[main] 启动失败窗显示失败: " + e); }
  });
  return b;
}

// ---------- 模型窗口 ----------
function createWindow() {  const s = S.get();
  const { w, h } = windowSize();

  // 位置永远按「离屏幕右下角多远」算，绝对坐标不参与决策；
  // 算出来的点也可能落在屏外（offset 被改坏、小屏大缩放），最后再夹一次。
  const raw = defaultPos(w, h);
  const p = ensureStartPos(raw.x, raw.y, w, h);
  const x = p.x;
  const y = p.y;

  win = new BrowserWindow({
    width: w,
    height: h,
    x: x,
    y: y,
    transparent: true,
    frame: false,
    // 透明窗口必须显式给全透明底色。不写的话，Electron 在某些机器上会退回
    // 系统默认底色，配合 DWM 的窗口描边就会出现「一圈边框」。
    backgroundColor: "#00000000",
    // 下面两个是 Windows 专用：
    //   thickFrame: false  —— 不画 Aero 边框（那圈 1px 的窗口描边就是它）
    //   roundedCorners: false —— Win11 不给窗口加圆角，否则透明四角会露白边
    // 窗口本来 resizable:false、hasShadow:false，放弃 Aero Snap 没有损失。
    thickFrame: false,
    roundedCorners: false,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: s.alwaysOnTop,
    fullscreenable: false,
    focusable: false,
    icon: appIcon(256) || undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  if (s.alwaysOnTop) // floating 这一级会被别的置顶窗口（全屏浏览器、IDE、录屏工具）压住。
  // 桌宠被挡住就等于不在，所以本体直接拉到最高一级；关掉置顶的开关仍然有效。
  win.setAlwaysOnTop(true, "screen-saver");
  win.setIgnoreMouseEvents(s.clickThrough, { forward: true });
  win.setOpacity(s.opacity);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  win.loadURL(`http://127.0.0.1:${PORT}/src/index.html`);

  // 启动就把窗口几何写进日志：排查「尺寸不对」时，
  // 第一条日志必须能回答「一开始是什么尺寸、在哪个位置」。
  try {
    const b0 = win.getBounds();
    const d0 = currentDisplay();
    log("[main] window ready win=" + b0.width + "x" + b0.height +
      " @" + b0.x + "," + b0.y +
      " offsetR=" + (d0.workArea.x + d0.workArea.width - (b0.x + b0.width)) +
      " offsetB=" + (d0.workArea.y + d0.workArea.height - (b0.y + b0.height)) +
      " scale=" + s.scale + " res=" + s.resolution);
  } catch (e) { }

  // 人走了就别画了：锁屏 / 休眠 / 最小化时把渲染停掉，回来再起。
  // Cubism 每帧是固定开销，只有「不画」能真正省下来。
  win.on("minimize", () => setPauseReason("minimize", true));
  win.on("restore", () => setPauseReason("minimize", false));
  // 托盘「隐藏」只是把窗口藏起来，不是最小化；藏起来时也没必要继续画。
  win.on("hide", () => setPauseReason("hidden", true));
  win.on("show", () => setPauseReason("hidden", false));

  win.on("closed", () => { win = null; });
  win.on("moved", () => {
    if (!win || win.isDestroyed()) return;
    stashAnchor();
  });

  win.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    log(`[renderer:${level}] ${message}  (${sourceId}:${line})`);
  });
  let loadFailCount = 0;
  let renderCrashCount = 0;
  // 不能在 did-finish-load 当下把崩溃计数清零：崩溃 → 自动 reload 会立刻再触发一次
  // did-finish-load，计数永远回到 0，「连续崩 4 次就停」那条路根本走不到（实测如此）。
  // 改成「页面稳定活过 20 秒，才算这一轮真的好了」。
  let crashResetTimer = null;
  win.webContents.on("did-finish-load", () => {
    loadFailCount = 0;
    if (crashResetTimer) clearTimeout(crashResetTimer);
    crashResetTimer = setTimeout(() => { renderCrashCount = 0; }, 20000);
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    log(`[load-fail] ${code} ${desc} ${url}`);
    // -3 = 自己触发的 reload/navigate 打断的，不算真失败
    if (code === -3) return;
    loadFailCount += 1;
    if (loadFailCount < 2) {
      setTimeout(() => { if (win && !win.isDestroyed()) win.reload(); }, 1200);
      return;
    }
    showLoadError("界面没能拉起来", `加载失败 ${code} ${desc || ""}`.trim());
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    logErr("[crash] 渲染进程没了:", details && details.reason);
    renderCrashCount += 1;
    if (renderCrashCount > 3) {
      // 崩掉的 webContents 是死的：往里面 loadURL，URL 会变、画面却全空。
      // 所以不把兜底页塞进这个窗口，而是换成一张干净的新窗。
      const reason = (details && details.reason) || "未知";
      logErr("[main] 模型窗连续崩溃，改用独立兜底窗");
      try { win.destroy(); } catch (e) { }
      win = null;
      setTimeout(() => {
        try { openModelError("渲染进程退出 " + renderCrashCount + " 次（" + reason + "），先停在这里，避免无限重启"); }
        catch (e) { logErr("[main] 打开模型兜底窗失败: " + e); }
      }, 400);
      return;
    }
    // 自动重开一次，用户不该看到空白窗
    if (win && !win.isDestroyed()) {
      setTimeout(() => { if (win && !win.isDestroyed()) win.reload(); }, 800);
    }
  });

  startCursorFeed();
}

// 全局鼠标位置：30fps 采样足够跟手，CPU 几乎为零
function startCursorFeed() {
  if (cursorTimer) clearInterval(cursorTimer);
  // 鼠标穿透开着的时候，整窗都不收鼠标事件——连输入框和语音键也点不到，
  // 那就等于"开了穿透就没法打字"。所以这里按位置动态松一下：
  // 指针进了底部输入条那一条，就临时恢复接收事件。
  let ignoring = null;
  cursorTimer = setInterval(() => {
    if (win === null || win.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    const [wx, wy] = win.getPosition();
    const [ww, wh] = win.getSize();
    if (S && S.get().clickThrough) {
      const overDock = p.x >= wx && p.x <= wx + ww &&
                       p.y >= wy + wh - DOCK_H - 10 && p.y <= wy + wh;
      const shouldIgnore = !overDock;
      if (shouldIgnore !== ignoring) {
        ignoring = shouldIgnore;
        try { win.setIgnoreMouseEvents(shouldIgnore, { forward: true }); } catch (e) { }
      }
    } else if (ignoring !== false) {
      ignoring = false;
    }
    win.webContents.send("cursor", { x: p.x, y: p.y, wx, wy, w: ww, h: wh });
  }, 33);
}

// 改尺寸节流。拖滑块时一秒钟能发几十次，Windows 的 setSize 跟不上，
// 会出现「最后一步没落地、但位置已经按新尺寸算了」→ 窗口顶出屏幕。
// 用 trailing debounce：连续调用一直推迟，停手 90ms 后**一定**执行一次。
let resizeTimer = null;

function doResize() {
  resizeTimer = null;
  if (!win || win.isDestroyed()) return;

  const { w, h } = windowSize();
  const pos = defaultPos(w, h);

  // 一次性设好位置和尺寸。
  // 不用「setSize 再 setPosition」：透明窗口上 setSize 是延迟生效的，
  // 中间任何一次 getBounds 都还是旧值，位置会按旧尺寸算，档位全错位。
  win.setBounds({ x: pos.x, y: pos.y, width: w, height: h });

  // 再校一次。Windows 对 transparent + focusable:false 窗口的首次
  // setBounds 偶尔会被系统吞掉（尤其从托盘唤起后第一次），补一次就稳了。
  setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    if (b.width !== w || b.height !== h || b.x !== pos.x || b.y !== pos.y) {
      win.setBounds({ x: pos.x, y: pos.y, width: w, height: h });
    }
    // setBounds 会让 DWM 重画一次窗口框架，那圈边框有时候会跟着回来。
    // 每次改完尺寸都把底色重新压成全透明，等于把边框擦掉。
    try { win.setBackgroundColor("#00000000"); } catch (e) { }
    if (win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send("relayout", {});
    }
    // 这条是「尺寸真的变了」的唯一证据。
    // 上面 applySettings 里那条 apply win= 打在 scheduleResize 之后、resize 之前，
    // 读到的永远是旧尺寸配新 scale —— 回归测试拿它断言会一直失败。
    try {
      const bb = win.getBounds();
      const dd = currentDisplay();
      log("[main] resized win=" + bb.width + "x" + bb.height +
        " @" + bb.x + "," + bb.y +
        " offsetR=" + (dd.workArea.x + dd.workArea.width - (bb.x + bb.width)) +
        " offsetB=" + (dd.workArea.y + dd.workArea.height - (bb.y + bb.height)) +
        " scale=" + S.get().scale);
    } catch (e) { }
  }, 70);
}

function scheduleResize() {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(doResize, 90);
}

function applySettings(patch) {
  const s = S.get();

  if (!win || win.isDestroyed()) return;

  // 尺寸变了就重设大小。位置按「离右下角多远」重算，
  // 这样放大时她往左/往上长，右下角永远钉住不动。
  if (patch && ("scale" in patch)) {
    scheduleResize();
  }
  // 每次应用设置都把窗口几何打出来，方便回归测试与排查
  try {
    const b = win.getBounds();
    const d = currentDisplay();
    log("[main] apply win=" + b.width + "x" + b.height +
      " @" + b.x + "," + b.y +
      " offsetR=" + (d.workArea.x + d.workArea.width - (b.x + b.width)) +
      " offsetB=" + (d.workArea.y + d.workArea.height - (b.y + b.height)) +
      " scale=" + s.scale + " res=" + s.resolution);
  } catch (e) { }
  if (patch && ("opacity" in patch)) win.setOpacity(s.opacity);
  if (patch && ("alwaysOnTop" in patch)) {
    if (s.alwaysOnTop) win.setAlwaysOnTop(true, "screen-saver");
    else win.setAlwaysOnTop(false);
  }
  if (patch && ("clickThrough" in patch)) {
    win.setIgnoreMouseEvents(s.clickThrough, { forward: true });
  }
  // 渲染侧要跟着变的项（锐化 / 分辨率 / 跟随 / 小动作 / 眨眼）
  if (win.webContents && !win.webContents.isDestroyed()) {
    win.webContents.send("settings-changed", s);
  }

  // 窗口尺寸一改，取景必须重算，否则模型还是按旧容器在放大，
  // 表现就是"窗口大了但只看得见一块衣领"。
  if (patch && ("scale" in patch) && win.webContents && !win.webContents.isDestroyed()) {
    setTimeout(() => {
      if (win && !win.isDestroyed()) win.webContents.send("relayout");
    }, 60);
  }
}

// ---------- 设置窗口 ----------
// ---------- 状态面板窗口 ----------
// 原来面板是主窗口里的一个 div，最远只能挪到主窗口边缘 —— 所谓「可拖动」实际上
// 只有 460×612 那点地方。要做成真能拖到屏幕任何地方，它必须有自己的窗口。
//
// 状态数据不用跨进程同步：localStorage 按 origin 共享，两个窗口读写的是同一份。
// 只有「做了动作要让她有反应」需要通知主窗口 —— 走 BroadcastChannel。
let petPanelWin = null;
let profileWin = null;

// 面板窗口的位置单独存一个小文件：它不属于「设置」（那是用户选项），
// 是窗口的临时状态。放 userData 下，换版本也不丢。
function petPanelPosPath() {
  return path.join(app.getPath("userData"), "petpanel-pos.json");
}
function readPetPanelPos() {
  try {
    const j = JSON.parse(fs.readFileSync(petPanelPosPath(), "utf8"));
    if (j && Number.isFinite(j.x) && Number.isFinite(j.y)) return { x: j.x, y: j.y };
  } catch (e) { }
  return null;
}
function savePetPanelPos(b) {
  try {
    fs.writeFileSync(petPanelPosPath(), JSON.stringify({ x: b.x, y: b.y }), "utf8");
  } catch (e) { }
}

// 记住的那点还在不在屏幕里？显示器拔了/分辨率变了之后要能自愈，
// 不然面板会弹在看不见的地方，用户以为没打开。
function petPanelPosOk(p) {
  if (!p) return false;
  try {
    const displays = screen.getAllDisplays();
    for (const d of displays) {
      const w = d.workArea;
      if (p.x >= w.x - 40 && p.x <= w.x + w.width - 60 &&
        p.y >= w.y - 20 && p.y <= w.y + w.height - 60) return true;
    }
  } catch (e) { }
  return false;
}

function openPetPanel() {
  if (petPanelWin && !petPanelWin.isDestroyed()) {
    petPanelWin.show();
    petPanelWin.focus();
    return;
  }

  const saved = readPetPanelPos();
  const usePos = petPanelPosOk(saved) ? saved : null;
  // 720 是完整内容的自然高度；高缩放的笔记本工作区可能只有 570 左右，
  // 这时窗口跟着工作区收，内容在面板内部滚动，至少不会跑到屏幕外面去。
  let panelH = 720;
  try {
    const base = win && !win.isDestroyed() ? win.getBounds() : screen.getPrimaryDisplay().bounds;
    const wa = screen.getDisplayMatching(base).workArea;
    panelH = Math.min(720, Math.max(520, wa.height - 16));
  } catch (e) { }

  petPanelWin = new BrowserWindow({
    width: 372,
    // 720 而不是 680：活动网格 + 食盆 + 互动按钮 + 页脚，680 时最后一行
    // 「最近活动」会被窗口底边切掉半个字（2026-11-08 实测）。
    height: panelH,
    minWidth: 372,
    minHeight: 480,
    ...(usePos ? { x: usePos.x, y: usePos.y } : {}),
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    thickFrame: false,
    roundedCorners: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: "大肥鱼 · 状态",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // 没存过位置就摆到主窗口左上角外侧一点点 —— 默认居中的话会正好盖住她。
  if (!usePos && win && !win.isDestroyed()) {
    try {
      const b = win.getBounds();
      // 用她所在的那块屏，而不是永远拿主屏；副屏上她也不会把面板甩回主屏。
      const wa = screen.getDisplayMatching(b).workArea;
      const px = Math.max(wa.x + 8, Math.min(b.x - 382, wa.x + wa.width - 380));
      const py = Math.max(wa.y + 8, Math.min(b.y + 8, wa.y + wa.height - panelH - 10));
      petPanelWin.setPosition(Math.round(px), Math.round(py));
    } catch (e) { }
  }

  petPanelWin.webContents.on("console-message", (_e, level, message, line, source) => {
    log("[petpanel:" + level + "] " + message + "  (" + (source || "") + ":" + line + ")");
  });

  petPanelWin.loadURL(`http://127.0.0.1:${PORT}/src/petpanel.html`);
  petPanelWin.once("ready-to-show", () => { petPanelWin.show(); notifyPanelState(); });

  // 跟着主窗口浮在最上层；主窗口置顶开关变了也带它一份
  try { petPanelWin.setAlwaysOnTop(true, "screen-saver"); } catch (e) { }

  // 拖完就记下来（moved 只在 Windows 上触发，够用）
  petPanelWin.on("moved", () => {
    try { savePetPanelPos(petPanelWin.getBounds()); } catch (e) { }
  });
  petPanelWin.on("close", () => {
    try { savePetPanelPos(petPanelWin.getBounds()); } catch (e) { }
  });

  petPanelWin.on("closed", () => { petPanelWin = null; notifyPanelState(); });
}

// 主窗需要知道面板在不在：面板开着时由面板说完成台词，关了则由主窗补一句。
// 轮询也能用，但开关的瞬间就同步过去更准。
function notifyPanelState() {
  try {
    if (win && !win.isDestroyed()) {
      win.webContents.send("pet:panel-state", !!(petPanelWin && !petPanelWin.isDestroyed()));
    }
  } catch (e) { }
}

function closePetPanel() {
  if (petPanelWin && !petPanelWin.isDestroyed()) petPanelWin.close();
}

// 相处档案：等级、今天、最近七天、徽章。
// 和状态面板一样是独立小窗，但内容更长，所以可以滚动、不跟主窗抢位置。
function openProfile() {
  // 设置页和档案都占一大块屏幕，同时开着只会互相压住；从设置里点「相处档案」
  // 或托盘打开档案时，把设置先收起来。
  try { if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close(); } catch (e) { }
  if (profileWin && !profileWin.isDestroyed()) {
    profileWin.show();
    profileWin.focus();
    return true;
  }
  let wa = screen.getPrimaryDisplay().workArea;
  let panelBounds = null;
  try {
    if (petPanelWin && !petPanelWin.isDestroyed()) {
      panelBounds = petPanelWin.getBounds();
      wa = screen.getDisplayMatching(panelBounds).workArea;
    }
  } catch (e) { }
  // 480×706 是设计尺寸；小屏/缩放 150% 时别把窗口顶出工作区。
  const width = Math.max(360, Math.min(480, wa.width - 24));
  const height = Math.max(520, Math.min(706, wa.height - 24));
  // 优先放在状态面板左边（右边通常已经被桌宠模型占了）；左边放不下再放右边，最后居中。
  let x = wa.x + Math.round((wa.width - width) / 2);
  let y = wa.y + Math.round((wa.height - height) / 2);
  try {
    if (panelBounds) {
      const b = panelBounds;
      const left = b.x - width - 10;
      const right = b.x + b.width + 10;
      if (left >= wa.x + 8) x = left;
      else if (right + width <= wa.x + wa.width - 8) x = right;
      y = Math.max(wa.y + 8, Math.min(b.y, wa.y + wa.height - height - 8));
    }
  } catch (e) { }

  profileWin = new BrowserWindow({
    width,
    height,
    x,
    y,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    thickFrame: false,
    roundedCorners: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: "大肥鱼 · 相处档案",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  try { profileWin.setAlwaysOnTop(true, "screen-saver"); } catch (e) { }
  profileWin.webContents.on("console-message", (_e, level, message, line, source) => {
    log("[profile:" + level + "] " + message + "  (" + (source || "") + ":" + line + ")");
  });
  profileWin.loadURL(`http://127.0.0.1:${PORT}/src/profile.html`);
  profileWin.once("ready-to-show", () => profileWin.show());
  profileWin.on("closed", () => { profileWin = null; });
  return true;
}

function closeProfile() {
  if (profileWin && !profileWin.isDestroyed()) profileWin.close();
}

function openSettings() {
  // 反方向同理：打开设置时收起档案，避免两个 480/900 宽的窗口叠在一起。
  try { if (profileWin && !profileWin.isDestroyed()) profileWin.close(); } catch (e) { }
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }

  const swa = (() => {
    try {
      if (win && !win.isDestroyed()) return screen.getDisplayMatching(win.getBounds()).workArea;
    } catch (e) { }
    return screen.getPrimaryDisplay().workArea;
  })();
  const sw = Math.min(900, swa.width - 24);
  const sh = Math.min(660, swa.height - 24);
  settingsWin = new BrowserWindow({
    width: sw,
    height: sh,
    x: Math.round(swa.x + (swa.width - sw) / 2),
    y: Math.round(swa.y + (swa.height - sh) / 2),
    minWidth: Math.min(760, sw),
    minHeight: Math.min(560, sh),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    resizable: true,
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    title: "大肥鱼 · 设置",
    icon: appIcon(256) || undefined,
    backgroundColor: "#0a0f1c",
    show: false,
  });
  settingsWin.webContents.on("console-message", (_e, level, message, line, source) => {
    log("[settings:" + level + "] " + message + "  (" + (source || "") + ":" + line + ")");
  });
  settingsWin.loadURL(`http://127.0.0.1:${PORT}/src/settings.html`);
  // 桌宠是 screen-saver 级置顶；设置、对话、看屏幕这些辅助窗也要同层，
  // 否则它们一和桌宠重叠就被压在下面，看起来像程序卡住了。
  try { settingsWin.setAlwaysOnTop(true, "screen-saver"); } catch (e) { }
  // 设置窗是最该稳的那个：用户出问题第一件事就是来这儿看。
  // 它要是白屏，用户就没有任何可以自救的地方了 —— 所以它也得有兜底页。
  settingsWin.webContents.on("did-fail-load", (_e, code, desc) => {
    if (code === -3) return; // 自己触发的取消/重载
    logErr("[main] 设置页加载失败 " + code + " " + desc);
    loadErrorInto(settingsWin, "设置页没能拉起来", "加载失败 " + code + " " + desc,
      "关掉设置窗再打开一次试试。如果一直这样，多半是安装不完整或本地服务没起来。",
      `http://127.0.0.1:${PORT}/src/settings.html`);
  });
  settingsWin.webContents.on("did-finish-load", () => {
    try {
      // 同理：重建后马上 did-finish-load，不能立刻清零，否则「连崩三次」永远数不到。
      if ((settingsWin.webContents.getURL() || "").startsWith("data:text/html")) return;
      if (settingsCrashResetTimer) clearTimeout(settingsCrashResetTimer);
      settingsCrashResetTimer = setTimeout(() => { settingsCrashes = 0; }, 20000);
    } catch (e) { }
  });
  settingsWin.webContents.on("render-process-gone", (_e, d) => {
    const reason = (d && d.reason) || "unknown";
    logErr("[main] 设置页渲染进程退出: " + reason);
    settingsCrashes += 1;
    // 崩掉的 webContents 是死的：再往里 loadURL，URL 会变、画面却全空，
    // 连 CDP 的 Runtime.evaluate 都不回话（实测）。所以不试图救它，销毁重开。
    try { settingsWin.destroy(); } catch (e) { }
    settingsWin = null;
    if (settingsCrashes <= 2) {
      setTimeout(() => {
        try { openSettings(); } catch (e) { logErr("[main] 重开设置窗失败: " + e); }
      }, 500);
      return;
    }
    // 连着崩三次，说明不是偶发：别再来回重开了，给一张写清原因的独立窗口。
    setTimeout(() => {
      try { openSettingsError(reason); } catch (e) { logErr("[main] 打开设置兜底窗失败: " + e); }
    }, 500);
  });
  settingsWin.once("ready-to-show", () => settingsWin.show());
  settingsWin.on("closed", () => { settingsWin = null; });
}

// ---------- 模型适配器窗口 ----------
// 和设置窗分开：设置是「调她怎么说话、怎么动」，适配器是「换一张皮」。
// 两件事的使用频率差几个数量级，塞在一个窗口里会让设置页变得又长又吓人。
// 1180×760 是三栏能舒展开的最小尺寸；允许拉伸 —— 调取景的人会想把预览拉大。
let adapterWin = null;

function openAdapter(id, step) {
  if (!ADAPTER) {
    try { openSettingsError("模型适配器没能初始化", "初始化失败", "看日志里的「模型适配器初始化失败」那行，通常是模型目录不可写。", `http://127.0.0.1:${PORT}/src/settings.html`); } catch (e) { }
    return;
  }
  if (adapterWin && !adapterWin.isDestroyed()) {
    adapterWin.show();
    adapterWin.focus();
    if (id) { try { adapterWin.webContents.send("adapter:select", String(id)); } catch (e) { } }
    // 已经开着窗口时再点「调整取景」：不重建窗口，只让她滚到取景那一步
    if (step) { try { adapterWin.webContents.send("adapter:focus-step", String(step)); } catch (e) { } }
    return;
  }

  adapterWin = new BrowserWindow({
    width: (() => {
      try {
        const wa = screen.getDisplayMatching(win && !win.isDestroyed() ? win.getBounds() : screen.getPrimaryDisplay().bounds).workArea;
        return Math.min(1180, Math.max(960, wa.width - 40));
      } catch (e) { return 1180; }
    })(),
    height: (() => {
      try {
        const wa = screen.getDisplayMatching(win && !win.isDestroyed() ? win.getBounds() : screen.getPrimaryDisplay().bounds).workArea;
        return Math.min(780, Math.max(620, wa.height - 40));
      } catch (e) { return 780; }
    })(),
    minWidth: 960,
    minHeight: 620,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    frame: false,
    title: "大肥鱼 · 模型适配器",
    icon: appIcon(256) || undefined,
    backgroundColor: "#12141c",
    show: false,
  });
  adapterWin.setAlwaysOnTop(true, "screen-saver");
  adapterWin.webContents.on("console-message", (_e, level, message, line, source) => {    log("[adapter:" + level + "] " + message + "  (" + (source || "") + ":" + line + ")");
  });
  const qs = [];
  if (id) qs.push("id=" + encodeURIComponent(id));
  if (step) qs.push("step=" + encodeURIComponent(step));
  adapterWin.loadURL(`http://127.0.0.1:${PORT}/src/adapter.html${qs.length ? "?" + qs.join("&") : ""}`);
  adapterWin.webContents.on("did-fail-load", (_e, code, desc) => {
    if (code === -3) return;
    logErr("[main] 适配器页加载失败 " + code + " " + desc);
    loadErrorInto(adapterWin, "模型适配器没拉起来", "加载失败 " + code + " " + desc,
      "关掉这个窗口再打开一次。如果一直这样，多半是安装不完整或本地服务没起来。",
      `http://127.0.0.1:${PORT}/src/adapter.html`);
  });
  adapterWin.once("ready-to-show", () => adapterWin.show());
  adapterWin.on("closed", () => { adapterWin = null; });
}

function closeAdapter() {
  if (adapterWin && !adapterWin.isDestroyed()) adapterWin.close();
}

// ---------- 首次运行引导 ----------
// 第一次打开时弹一张四行卡片：右键设置、两个快捷键、拖着我走。
// 点「知道了」写 firstRun=false，之后不再出现。
let welcomeWin = null;

async function fitWelcome() {
  // 高度跟着内容走：没有模型时会多一条提示，写死 368 会把按钮切掉
  if (!welcomeWin || welcomeWin.isDestroyed()) return;
  try {
    const h = await welcomeWin.webContents.executeJavaScript(
      'Math.ceil(Math.max(document.querySelector(".card").getBoundingClientRect().height, document.querySelector(".card").scrollHeight) + 24)'
    );
    if (h && h > 200 && welcomeWin && !welcomeWin.isDestroyed()) {
      welcomeWin.setContentSize(400, Math.min(640, h));
      welcomeWin.center();
    }
  } catch (e) { }
}

function openWelcome() {
  if (welcomeWin && !welcomeWin.isDestroyed()) {
    welcomeWin.show();
    welcomeWin.focus();
    return;
  }
  welcomeWin = new BrowserWindow({
    width: 400,
    height: 368,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    center: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  welcomeWin.loadURL(`http://127.0.0.1:${PORT}/src/welcome.html`);
  try { welcomeWin.setAlwaysOnTop(true, "screen-saver"); } catch (e) { }
  welcomeWin.once("ready-to-show", () => welcomeWin.show());
  welcomeWin.on("closed", () => { welcomeWin = null; });
}

ipcMain.handle("welcome:fit", async () => { await fitWelcome(); return true; });
ipcMain.handle("welcome:open", () => { openWelcome(); return true; });
ipcMain.handle("welcome:close", () => {
  try { S.patch({ firstRun: false }); } catch (e) { }
  try { if (welcomeWin && !welcomeWin.isDestroyed()) welcomeWin.close(); } catch (e) { }
  return true;
});

// ---------- 全局快捷键 ----------
// 想跟她说话时要先把鼠标挪到底部，很麻烦。按 Ctrl+Alt+F 直接把输入条叫出来：
// 窗口置顶 → 允许焦点 → 通知渲染进程展开面板并聚焦输入框。
// 注册失败不致命（可能被别的软件占了），只记一条日志。
// 快捷键从设置里读，不再写死。主人的机器上可能和别的软件撞键。
let hotkeyOk = false;
let boundAccels = [];
const STRETCH_ACCEL = "CommandOrControl+Alt+S";

function summonDock() {
  try {
    if (!win) { createWindow(); return; }
    if (win.isMinimized()) win.restore();
    win.show();                       // 透明窗口可能被 show 逻辑藏起来过
    win.setAlwaysOnTop(true, "screen-saver");
    win.setFocusable(true);
    win.focus();
    win.webContents.send("summon");
    // 透明 + 非激活窗口光 setFocusable 不够：DOM 焦点有了，OS 的输入焦点还没到，
    // 真实键盘敲进去的事件送不到页面（CDP 派发的却有效，很容易误判成绑定写错了）。
    // 先 show 一次让窗口「可激活」，再 focus，并把结果记下来。
    setTimeout(() => {
      try {
        if (!win.isVisible()) win.show();
        win.focus();
        log("[main] 热键唤出输入条 focused=" + win.isFocused());
      } catch (e) { }
    }, 60);
  } catch (e) {
    log("[main] 热键唤出失败: " + e);
  }
}

function registerHotkey() {
  try {
    const { globalShortcut } = require("electron");
    // 先摘掉上一次注册的键，再按当前设置重挂 —— 改键/清空都能即时生效。
    for (const a of boundAccels) {
      try { globalShortcut.unregister(a); } catch (e) { }
    }
    boundAccels = [];
    try { globalShortcut.unregister(STRETCH_ACCEL); } catch (e) { }

    const s = S.get();
    const summonKey = String(s.hotkeySummon || "").trim();
    const micKey = String(s.hotkeyMic || "").trim();
    const muteKey = String(s.hotkeyMute || "").trim();

    if (summonKey) {
      try {
        hotkeyOk = globalShortcut.register(summonKey, summonDock);
        if (hotkeyOk) boundAccels.push(summonKey);
        if (!hotkeyOk) log("[main] 唤出热键被占用，注册失败: " + summonKey);
        else log("[main] 唤出热键已注册: " + summonKey);
      } catch (e) { log("[main] 唤出热键无效: " + summonKey + " — " + e); }
    } else {
      hotkeyOk = false;
      log("[main] 唤出热键已清空，不注册");
    }

    if (micKey) {
      if (micKey === summonKey) {
        log("[main] 开麦热键和唤出热键相同，只保留唤出: " + micKey);
      } else {
        try {
          const micOk = globalShortcut.register(micKey, () => {
            // 语音按钮在渲染进程里。这里只发信号，开关状态由那边判断，
            // 避免主进程再维护一份「到底开没开」的状态导致两边不一致。
            try { if (win && !win.isDestroyed()) win.webContents.send("mic:toggle"); } catch (e) { }
          });
          if (micOk) boundAccels.push(micKey);
          log(micOk ? "[main] 开麦热键已注册: " + micKey : "[main] 开麦热键被占用，注册失败: " + micKey);
        } catch (e) { log("[main] 开麦热键无效: " + micKey + " — " + e); }
      }
    }

    if (muteKey) {
      if (muteKey === summonKey || muteKey === micKey) {
        log("[main] 静音热键和别的键相同，跳过: " + muteKey);
      } else {
        try {
          const muteOk = globalShortcut.register(muteKey, () => { toggleMuted(); });
          if (muteOk) boundAccels.push(muteKey);
          log(muteOk ? "[main] 静音热键已注册: " + muteKey : "[main] 静音热键被占用，注册失败: " + muteKey);
        } catch (e) { log("[main] 静音热键无效: " + muteKey + " — " + e); }
      }
    }

    // Ctrl+Alt+S：手动触发伸懒腰，用来调动作时不用干等它随机出现。
    // 只发给渲染进程，曲线数据在那边（renderer.js 的 STRETCH_CURVES），这里不重复存一份。
    const probeOk = globalShortcut.register(STRETCH_ACCEL, () => {
      try { if (win) win.webContents.send("act:stretch"); } catch (e) { }
    });
    if (probeOk) { boundAccels.push(STRETCH_ACCEL); log("[main] 动作热键已注册: Ctrl+Alt+S"); }
    else log("[main] 动作热键被占用: Ctrl+Alt+S");
  } catch (e) {
    log("[main] 热键注册异常: " + e);
  }
}


// ---------- 对话记录 ----------
// 底部输入条里的记录只活在这个进程里，最多 40 行，语音一关就看不见了。
// 这里单独落一份盘：主窗口还在跑的时候，记录随时能翻；重启之后也还在。
const CHAT_MAX = 3000;
let chatItems = null;
let chatSaveTimer = 0;
let chatlogWin = null;

function chatFile() {
  return path.join(app.getPath("userData"), "chatlog.json");
}

function chatLoad() {
  if (chatItems) return chatItems;
  chatItems = [];
  try {
    const raw = fs.readFileSync(chatFile(), "utf8");
    const j = JSON.parse(raw);
    const arr = Array.isArray(j) ? j : (j && Array.isArray(j.items) ? j.items : []);
    chatItems = arr
      .filter((m) => m && typeof m.text === "string" && m.text.trim())
      .map((m) => ({
        id: String(m.id || ""),
        role: m.role === "assistant" ? "assistant" : "user",
        text: String(m.text),
        at: Number(m.at) || Date.now(),
        streaming: !!m.streaming,
      }))
      .slice(-CHAT_MAX);
  } catch (e) {
    chatItems = [];
  }
  return chatItems;
}

function chatWriteNow() {
  try {
    fs.mkdirSync(path.dirname(chatFile()), { recursive: true });
    const tmp = chatFile() + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, items: chatItems || [] }), "utf8");
    fs.renameSync(tmp, chatFile());
  } catch (e) {
    log("[chat] 存盘失败: " + e);
  }
}

function chatSaveSoon() {
  clearTimeout(chatSaveTimer);
  chatSaveTimer = setTimeout(() => {
    chatSaveTimer = 0;
    chatWriteNow();
  }, 400);
}

// 退出时把还没落盘的那一条写掉：chatSaveSoon 是 400ms 防抖，
// 说完最后一句话就点退出，那条消息会直接丢掉（窗口关了、定时器也没了）。
function chatFlush() {
  if (!chatSaveTimer) return;
  clearTimeout(chatSaveTimer);
  chatSaveTimer = 0;
  chatWriteNow();
}

function chatBroadcast(item) {
  try {
    if (chatlogWin && !chatlogWin.isDestroyed()) chatlogWin.webContents.send("chat:update", item);
  } catch (e) { }
}

function chatAppend(raw) {
  const list = chatLoad();
  const now = Date.now();
  const text = String((raw && raw.text) || "");
  if (!text.trim()) return null;
  const role = raw && raw.role === "assistant" ? "assistant" : "user";
  const id = String((raw && raw.id) || "");
  let item = null;

  if (id) item = list.find((m) => m.id === id) || null;
  if (item) {
    item.text = text;
    item.streaming = !!(raw && raw.streaming);
    if (raw && raw.at) item.at = Number(raw.at) || item.at;
  } else {
    // 同一句话在 1.2 秒内被两条路径各报一次（比如语音识别 + 发送回显）时去重，
    // 但不合并「她」的重复语句——她真的可能连说两句一样的话。
    const dup = role === "user" && list.find((m) =>
      m.role === "user" && m.text === text && now - m.at < 1200);
    if (dup) return dup;
    item = {
      id: id || ("c" + now.toString(36) + Math.random().toString(36).slice(2, 6)),
      role,
      text,
      at: Number(raw && raw.at) || now,
      streaming: !!(raw && raw.streaming),
    };
    list.push(item);
    if (list.length > CHAT_MAX) list.splice(0, list.length - CHAT_MAX);
  }
  chatSaveSoon();
  chatBroadcast(item);
  return item;
}

function chatMerge(arr) {
  const list = chatLoad();
  let added = 0;
  for (const m of Array.isArray(arr) ? arr : []) {
    if (!m || typeof m.text !== "string" || !m.text.trim()) continue;
    const text = m.text;
    const role = m.role === "assistant" ? "assistant" : "user";
    const at = Number(m.at) || Date.now();
    const hit = list.find((x) => x.role === role && x.text === text && Math.abs(x.at - at) < 1500);
    if (hit) continue;
    list.push({ id: String(m.id || ("m" + at.toString(36) + Math.random().toString(36).slice(2, 5))), role, text, at, streaming: false });
    added += 1;
  }
  if (added) {
    list.sort((a, b) => a.at - b.at);
    if (list.length > CHAT_MAX) list.splice(0, list.length - CHAT_MAX);
    chatSaveSoon();
  }
  return added;
}

function chatBoundsFile() {
  return path.join(app.getPath("userData"), "chat-bounds.json");
}

function saveChatBounds(b) {
  try {
    fs.writeFileSync(chatBoundsFile(), JSON.stringify(b), "utf8");
  } catch (e) { }
}

function loadChatBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(chatBoundsFile(), "utf8"));
    if (b && b.width >= 300 && b.height >= 380) return b;
  } catch (e) { }
  return null;
}

function closeChatLog() {
  try { if (chatlogWin && !chatlogWin.isDestroyed()) chatlogWin.close(); } catch (e) { }
  chatlogWin = null;
}

function openChatLog() {
  if (chatlogWin && !chatlogWin.isDestroyed()) {
    chatlogWin.show();
    chatlogWin.focus();
    return true;
  }
  const b = loadChatBounds();
  const disp = (b ? screen.getDisplayMatching(b)
    : (win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay())).workArea;
  let width = b ? b.width : 440;
  let height = b ? b.height : 680;
  // 上次在高缩放屏上拖得很大，换回小屏时别让窗口比工作区还高。
  width = Math.max(340, Math.min(width, disp.width - 16));
  height = Math.max(420, Math.min(height, disp.height - 16));
  const x = b && Number.isFinite(b.x) ? Math.max(disp.x, Math.min(b.x, disp.x + disp.width - width)) : Math.round(disp.x + (disp.width - width) / 2);
  const y = b && Number.isFinite(b.y) ? Math.max(disp.y, Math.min(b.y, disp.y + disp.height - height)) : Math.round(disp.y + (disp.height - height) / 2);

  chatlogWin = new BrowserWindow({
    x, y, width, height,
    minWidth: 340,
    minHeight: 420,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    title: "大肥鱼 · 对话记录",
    icon: appIcon(256) || undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  chatlogWin.webContents.on("console-message", (_e, level, message, line, source) => {
    log("[chatlog:" + level + "] " + message + "  (" + (source || "") + ":" + line + ")");
  });
  chatlogWin.loadURL(`http://127.0.0.1:${PORT}/src/chatlog.html`);
  try { chatlogWin.setAlwaysOnTop(true, "screen-saver"); } catch (e) { }
  chatlogWin.once("ready-to-show", () => chatlogWin.show());
  const remember = () => {
    try { if (chatlogWin && !chatlogWin.isDestroyed()) saveChatBounds(chatlogWin.getBounds()); } catch (e) { }
  };
  chatlogWin.on("moved", remember);
  chatlogWin.on("resized", remember);
  chatlogWin.on("closed", () => { chatlogWin = null; });
  return true;
}

// ---------- 看屏幕（see_now 复刻） ----------
// 主人点「看屏幕」→ 主进程按间隔抓主屏 → 缩成 JPEG → 变化够大才送视觉模型
// → 她的点评回到监视窗 + 主窗气泡（可选朗读）。
// 关键点：抓屏和调模型都在主进程，渲染进程只拿 dataURL，不碰密钥、不受 CORS 限制。
const SEE_SYSTEM = [
  "你是大肥鱼，主人的桌面 Live2D 伴侣。",
  "你正在看主人此刻的电脑屏幕。用第一人称、口语化中文，说 1 到 2 句，总长不超过 80 字。",
  "只说你真的能从画面里看到的东西：在用什么软件、页面大概是什么、是在工作还是摸鱼。",
  "看不清就直说看不清，不要编造窗口标题、文件名、聊天内容或数字。",
  "可以关心、吐槽、好奇，但别像客服，也别用列表。",
  "只回这一句点评：不要调用任何工具，不要写日记，不要查记忆，也不要执行任何操作。",
].join("\n");

let seeWin = null;
let seeTimer = 0;
let seeRunning = false;
let seeBusy = false;
let seeLastSig = null;
let seeLastDiff = 0;
let seeLastAt = 0;
let seeLastAnalyze = 0;
let seeLastError = "";
let seeLastComment = "";
let seeLastCommentAt = 0;

function seeBoundsFile() {
  return path.join(app.getPath("userData"), "see-bounds.json");
}

function saveSeeBounds(b) {
  try { fs.writeFileSync(seeBoundsFile(), JSON.stringify(b), "utf8"); } catch (e) { }
}

function loadSeeBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(seeBoundsFile(), "utf8"));
    if (b && b.width >= 320 && b.height >= 420) return b;
  } catch (e) { }
  return null;
}

function seeConfig() {
  const s = S.get();
  return {
    base: String(s.seeBase || s.apiBase || "").replace(/\/+$/, ""),
    key: String(s.seeKey || s.apiKey || ""),
    model: String(s.seeModel || s.apiModel || "").trim(),
    interval: Math.max(0.8, Math.min(6, Number(s.seeInterval) || 1.6)),
    gap: Math.max(3, Math.min(60, Number(s.seeGap) || 7)),
    speak: !!s.seeSpeak,
  };
}

function seeStatus() {
  const c = seeConfig();
  return {
    running: seeRunning,
    busy: seeBusy,
    model: c.model,
    base: c.base,
    interval: c.interval,
    gap: c.gap,
    speak: c.speak,
    lastAt: seeLastAt,
    lastDiff: Math.round(seeLastDiff * 1000) / 1000,
    lastError: seeLastError,
    lastComment: seeLastComment,
    lastCommentAt: seeLastCommentAt,
    hasVision: !!(miniStatus().running || (c.base && c.model)),
  };
}

function seePush(channel, payload) {
  for (const w of [seeWin, win]) {
    try {
      if (w && !w.isDestroyed() && w.webContents) w.webContents.send(channel, payload);
    } catch (e) { }
  }
}

function seeSignature(img) {
  const small = img.resize({ width: 48, height: 27, quality: "good" });
  const bmp = small.toBitmap();
  const sig = new Uint8Array(48 * 27);
  for (let i = 0; i < sig.length; i += 1) {
    sig[i] = Math.round((bmp[i * 4] + bmp[i * 4 + 1] + bmp[i * 4 + 2]) / 3);
  }
  return sig;
}

function seeSigDiff(a, b) {
  if (!a || !b || a.length !== b.length) return 1;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / (a.length * 255);
}

async function seeCapture() {
  const primary = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 1280, height: 720 },
    fetchWindowIcons: false,
  });
  if (!sources || !sources.length) throw new Error("没有拿到屏幕画面");
  const want = String(primary.id);
  const src = sources.find((x) => String(x.display_id) === want) || sources[0];
  const img = src.thumbnail;
  if (!img || img.isEmpty()) throw new Error("屏幕截图是空的（可能被系统权限拦了）");
  const jpeg = img.toJPEG(78);
  return {
    img,
    dataUrl: "data:image/jpeg;base64," + jpeg.toString("base64"),
    at: Date.now(),
    size: img.getSize(),
  };
}


async function seeViaBridge(prompt, dataUrl) {
  const st = miniStatus();
  // 发行版不再自动拉起自带桥接（它要磁盘上有独立的 DSH bin.js），8898 上很可能是
  // 别人的服务。没在跑就直接说清楚，别拿 50 秒去等一个必然失败的连接。
  if (!st.running) {
    throw new Error("自带的视觉桥没在运行。这是开发态才有的通道，去「设置 → 看屏幕」填一个能看图的接口，或者把「用哪个通道」切到外部接口");
  }
  const base = st.url;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 50000);
  try {
    const r = await net.fetch(base + "/api/vision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image: dataUrl, prompt }),
      signal: ctl.signal,
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || !j.ok) {
      throw new Error((j && j.error) || ("本地视觉接口 " + r.status));
    }
    return String(j.text || "").trim();
  } finally {
    clearTimeout(timer);
  }
}

async function seeAnalyze(dataUrl, diff) {
  const c = seeConfig();
  const s = S.get();
  const hint = seeLastComment
    ? "你上次看的时候说：「" + seeLastComment.slice(0, 60) + "」。这次换个角度，别重复。"
    : "";
  const prompt = SEE_SYSTEM + "\n\n" +
    (hint ? hint + "\n" : "") +
    "这是主人现在的屏幕（" + new Date().toLocaleTimeString("zh-CN") + "）。看一眼，随口说一句。";

  // 默认走大肥鱼自带的 DSH 桥接：不需要另配 Key，模型能看图就能用。
  // 如果主人在设置里明确填了「看屏幕接口地址」，就尊重他的配置优先走 HTTP。
  const preferHttp = !!String(s.seeBase || "").trim();
  if (!preferHttp) {
    try {
      let text = await seeViaBridge(prompt, dataUrl);
      text = text.replace(/^["“」『]+|["”」』]+$/g, "").replace(/\s+/g, " ").trim();
      if (text) {
        if (text.length > 180) text = text.slice(0, 178) + "…";
        return { text, model: "DSH 本地", diff };
      }
      throw new Error("本地视觉接口没有给出内容");
    } catch (e) {
      if (!c.base || !c.model) {
        const raw = String((e && e.message) || e);
        // 把一个英文字段名译成人话；接口没配的时候用户不该看见 not found / 404 这种原文
        const friendly = /not found|404|ECONNREFUSED|ERR_CONNECTION/i.test(raw)
          ? "本地视觉通道连不上（发行版不自带）"
          : raw;
        throw new Error("这一眼没看成：" + friendly);
      }
      // 配置了外部接口就继续往下试
    }
  }

  if (!c.base) throw new Error("还没配置视觉模型：设置 → 看屏幕，填接口地址");
  if (!c.model) throw new Error("还没配置视觉模型：设置 → 看屏幕，填模型名");

  const headers = { "content-type": "application/json" };
  if (c.key) headers.authorization = "Bearer " + c.key;
  const body = {
    model: c.model,
    messages: [
      { role: "system", content: SEE_SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    temperature: 0.85,
    max_tokens: 220,
    stream: false,
  };

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60000);
  try {
    const r = await net.fetch(c.base + "/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!r.ok) {
      let detail = "";
      try { detail = (await r.text()).slice(0, 220); } catch (e) { }
      throw new Error("视觉接口 " + r.status + (detail ? "：" + detail : ""));
    }
    const j = await r.json().catch(() => null);
    const msg = j && j.choices && j.choices[0] && j.choices[0].message;
    let text = String((msg && msg.content) || "").trim();
    if (!text) throw new Error("视觉模型没有给出内容（模型支持图片吗？）");
    text = text.replace(/^["“」『]+|["”」』]+$/g, "").replace(/\s+/g, " ").trim();
    if (text.length > 180) text = text.slice(0, 178) + "…";
    return { text, model: (j && j.model) || c.model, diff };
  } finally {
    clearTimeout(timer);
  }
}

async function seeTick(force) {
  if (seeBusy) return { ok: false, busy: true };
  if (!seeRunning && !force) return { ok: false, idle: true };
  seeBusy = true;
  let statusDirty = true;
  try {
    const f = await seeCapture();
    seeLastAt = f.at;
    const sig = seeSignature(f.img);
    const diff = seeLastSig ? seeSigDiff(seeLastSig, sig) : 1;
    seeLastSig = sig;
    seeLastDiff = diff;

    try {
      if (seeWin && !seeWin.isDestroyed()) {
        seeWin.webContents.send("see:frame", {
          dataUrl: f.dataUrl, at: f.at, diff: Math.round(diff * 1000) / 1000,
        });
      }
    } catch (e) { }

    const c = seeConfig();
    const now = Date.now();
    const gapMs = c.gap * 1000;
    const bigChange = diff >= 0.09 && now - seeLastAnalyze >= 3000;
    const smallChange = diff >= 0.02 && now - seeLastAnalyze >= gapMs;
    if (!force && !bigChange && !smallChange) return { ok: true, skipped: true, diff };

    seeLastAnalyze = now;
    const r = await seeAnalyze(f.dataUrl, diff);
    seeLastError = "";
    seeLastComment = r.text;
    seeLastCommentAt = Date.now();
    seePush("see:comment", { text: r.text, at: seeLastCommentAt, model: r.model });
    seePush("see:say", { text: r.text, at: seeLastCommentAt });
    return { ok: true, text: r.text, diff };
  } catch (e) {
    seeLastError = String((e && e.message) || e);
    seePush("see:error", { error: seeLastError, at: Date.now() });
    return { ok: false, error: seeLastError };
  } finally {
    seeBusy = false;
    if (statusDirty) seePush("see:status", seeStatus());
  }
}

function seeStart() {
  seeStop(false);
  seeRunning = true;
  seeLastSig = null;
  seeLastError = "";
  const c = seeConfig();
  // 先抓一帧，别让监视窗空着。
  seeTick(true);
  seeTimer = setInterval(() => { seeTick(false); }, Math.round(c.interval * 1000));
  seePush("see:status", seeStatus());
  log("[see] 开始看屏幕，间隔 " + c.interval + "s，模型 " + (c.model || "未配置"));
  return seeStatus();
}

function seeStop(broadcast) {
  if (seeTimer) clearInterval(seeTimer);
  seeTimer = 0;
  seeRunning = false;
  if (broadcast !== false) seePush("see:status", seeStatus());
}

function closeSeeWatch() {
  seeStop(false);
  try { if (seeWin && !seeWin.isDestroyed()) seeWin.close(); } catch (e) { }
  seeWin = null;
}

function openSeeWatch() {
  if (seeWin && !seeWin.isDestroyed()) {
    seeWin.show();
    seeWin.focus();
    if (!seeRunning) seeStart();
    return true;
  }
  const b = loadSeeBounds();
  const disp = (b ? screen.getDisplayMatching(b)
    : (win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay())).workArea;
  let width = b ? b.width : 430;
  let height = b ? b.height : 660;
  width = Math.max(360, Math.min(width, disp.width - 16));
  height = Math.max(460, Math.min(height, disp.height - 16));
  const x = b && Number.isFinite(b.x)
    ? Math.max(disp.x, Math.min(b.x, disp.x + disp.width - width))
    : Math.round(disp.x + disp.width - width - 24);
  const y = b && Number.isFinite(b.y)
    ? Math.max(disp.y, Math.min(b.y, disp.y + disp.height - height))
    : Math.round(disp.y + Math.round((disp.height - height) / 2));

  seeWin = new BrowserWindow({
    x, y, width, height,
    minWidth: 360,
    minHeight: 460,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    title: "看屏幕 · 大肥鱼",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  seeWin.setAlwaysOnTop(true, "screen-saver");
  seeWin.loadURL("http://127.0.0.1:" + PORT + "/src/seewatch.html");
  seeWin.once("ready-to-show", () => {
    try { seeWin.show(); } catch (e) { }
    seeStart();
  });
  const save = () => {
    try {
      if (!seeWin || seeWin.isDestroyed()) return;
      const r = seeWin.getBounds();
      saveSeeBounds({ x: r.x, y: r.y, width: r.width, height: r.height });
    } catch (e) { }
  };
  seeWin.on("moved", save);
  seeWin.on("resized", save);
  seeWin.on("closed", () => { seeStop(false); seeWin = null; });
  return true;
}

// ---------- 托盘 ----------
// 托盘里的「检查更新」：不打开设置窗也能查。
// 没有窗口焦点时（用户从托盘点），用无父窗口的自由对话框。
async function checkUpdateFromTray() {
  let r = null;
  try {
    r = await checkUpdate();
  } catch (e) {
    r = { ok: false, error: String((e && e.message) || e) };
  }
  const cur = "v" + ((r && r.current) || app.getVersion());
  const buttons = ["好"];
  let text = "";
  if (!r || !r.ok) {
    text = "检查失败：" + ((r && r.error) || "未知原因");
    buttons.push("打开 GitHub 页面");
  } else if (r.empty) {
    text = "仓库里还没有发布过版本。";
    buttons.push("打开 GitHub 页面");
  } else if (r.newer) {
    text = "发现新版本 v" + r.latest + "（当前 " + cur + "）。\n\n要不要现在去下载页看看？";
    buttons.unshift("打开下载页");
  } else {
    text = "已经是最新的（" + cur + "）。";
  }
  let pick = 0;
  try {
    const res = await dialog.showMessageBox({
      type: r && r.ok && !r.newer && !r.empty ? "info" : "question",
      title: "检查更新",
      message: "大肥鱼 " + cur,
      detail: text,
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1,
      noLink: true,
    });
    pick = res.response;
  } catch (e) {
    logErr("[main] 打开更新对话框失败: " + e);
    return;
  }
  if (buttons[pick] === "打开下载页" || buttons[pick] === "打开 GitHub 页面") {
    try {
      await shell.openExternal((r && r.page) || UPDATE_PAGE);
    } catch (e) {
      logErr("[main] 打开下载页失败: " + e);
    }
  }
}

// 启动后静默检查一次：用户不该为了知道有没有新版本，自己去翻设置页。
// 24 小时内只查一次 —— GitHub 匿名接口每小时 60 次，正常使用绰绰有余。
const UPDATE_CHECK_GAP = 24 * 3600 * 1000;

function notifyUpdate(r) {
  const title = "大肥鱼有新版本 v" + r.latest;
  const body = "当前是 v" + r.current + "，点这里去下载页看看。";
  try {
    const n = new Notification({ title, body });
    n.on("click", () => {
      try { shell.openExternal(r.page || UPDATE_PAGE); } catch (e) { logErr("[main] 打开下载页失败: " + e); }
    });
    n.show();
    return;
  } catch (e) {
    logErr("[main] 系统通知不可用: " + e);
  }
  // 系统通知被关掉时退托盘气球，至少别静默失败。
  try {
    if (tray && tray.displayBalloon) tray.displayBalloon({ title, content: body, iconType: "info" });
  } catch (e) { }
}

async function silentUpdateCheck() {
  try {
    const s = S.get();
    if (Date.now() - (Number(s.lastUpdateCheckAt) || 0) < UPDATE_CHECK_GAP) return;
    const r = await checkUpdate();
    // 失败也记一次：不然断网时每次启动都要白等 9 秒超时。
    try { S.patch({ lastUpdateCheckAt: Date.now() }); } catch (e) { }
    if (!r || !r.ok || r.empty || !r.newer) return;
    // 同一个版本只提醒一次，别每次都来敲门。
    if (String(s.lastUpdateNotice || "") === String(r.latest)) return;
    updateAvailable = String(r.latest);
    refreshTrayMenu();
    try { S.patch({ lastUpdateNotice: String(r.latest) }); } catch (e) { }
    notifyUpdate(r);
    log("[main] 发现新版本 v" + r.latest + "（当前 v" + r.current + "）");
  } catch (e) {
    logErr("[main] 静默检查更新失败: " + e);
  }
}

function scheduleUpdateCheck() {
  // 启动那几秒有更要紧的事（服务、模型、语音），更新检查排在 25 秒后。
  const t = setTimeout(() => { silentUpdateCheck(); }, 25000);
  if (t.unref) t.unref();
}

function makeTray() {
  let icon = trayIcon();
  if (!icon || icon.isEmpty()) {
    icon = nativeImage.createFromBuffer(Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHElEQVQ4jWNgYGD4z0AswK4YXzGuYnzFuIoBAK1gBAFq0n0iAAAAAElFTkSuQmCC",
      "base64"
    ));
  }
  tray = new Tray(icon);
  tray.setToolTip(APP_NAME);
  tray.on("double-click", () => { if (win) win.isVisible() ? win.hide() : win.show(); });
  refreshTrayMenu();
}

// 托盘菜单不能就地改某一项的标题，只能整份重建。
// 抽成模板之后，「检查更新」这一项才能带上「有新版本」的标记。
let updateAvailable = "";

// 静音是「她还能说话，但不出声」：识别、对话、气泡全照常，只拦播放。
// 设置页、快捷键、托盘三个入口都落到这里，避免三份状态各说各话。
function setMuted(on) {
  const next = !!on;
  if (!S) return next;
  if (S.get().mute === next) {
    // 幂等：同一个状态重复点（比如快捷键连按）不该多写一次盘。
    try { refreshTrayMenu(); } catch (e) { }
    return next;
  }
  S.patch({ mute: next });
  applySettings({ mute: next });
  try { refreshTrayMenu(); } catch (e) { }
  log("[main] 静音 " + (next ? "开" : "关"));
  return next;
}
function toggleMuted() {
  return setMuted(!(S && S.get().mute));
}

// 托盘快捷互动：主进程不认识养成数据，交给主窗里的 pet.js 执行。
// 食盆顺序和 pet.js 的 FOODS 下标一一对应，加零食时两边一起改。
const TRAY_FOODS = ["小鱼干", "布丁", "热可可", "月亮糕"];
function quickPet(kind, extra) {
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send("pet:quick", Object.assign({ kind }, extra || {}));
  } catch (e) { }
}

function refreshTrayMenu() {
  if (!tray) return;
  try {
    tray.setContextMenu(Menu.buildFromTemplate(trayTemplate()));
  } catch (e) { logErr("[main] 重建托盘菜单失败: " + e); }
}

function trayTemplate() {
  return [
    { label: "显示 / 隐藏", click: () => { if (win) win.isVisible() ? win.hide() : win.show(); } },
    {
      label: "喂她一口",
      submenu: TRAY_FOODS.map((name, i) => ({
        label: name,
        click: () => quickPet("feed", { idx: i }),
      })),
    },
    { label: "摸摸头", click: () => quickPet("pet") },
    {
      label: "静音",
      type: "checkbox",
      checked: !!(S && S.get().mute),
      click: (item) => setMuted(item.checked),
    },
    {
      label: "暂停动效（省电）",
      type: "checkbox",
      checked: pauseReasons.has("manual"),
      click: (item) => { setPauseReason("manual", item.checked); refreshTrayMenu(); },
    },
    { label: "看屏幕…", click: openSeeWatch },
    { label: "相处档案…", click: openProfile },
    { label: "对话记录…", click: openChatLog },
    { label: "模型适配器…", click: () => openAdapter("") },
    { label: "设置…", click: openSettings },
    { label: updateAvailable ? "检查更新（v" + updateAvailable + " 可用）" : "检查更新…", click: () => { checkUpdateFromTray(); } },
    { label: "重置位置", click: resetPosition },
    { type: "separator" },
    // 设置窗一旦打不开，用户就没有任何出口了。这两个入口不经过设置窗：
    // 诊断包直接弹选目录框（没有可聚焦窗口时用自由对话框），日志直接在资源管理器里选中。
    {
      label: "导出诊断包…",
      click: async () => {
        try {
          const r = await exportDiag();
          if (r && r.ok) { try { await shell.openPath(r.dir); } catch (e) { } }
          else if (r && r.error) logErr("[main] 托盘导出诊断包失败: " + r.error);
        } catch (e) { logErr("[main] 托盘导出诊断包异常: " + e); }
      },
    },
    {
      label: "打开运行日志",
      click: () => {
        try {
          if (!LOG_FILE || !fs.existsSync(LOG_FILE)) return logErr("[main] 还没有日志文件");
          shell.showItemInFolder(LOG_FILE);
        } catch (e) { logErr("[main] 打开运行日志失败: " + e); }
      },
    },
    { label: "再看一次新手引导", click: () => { try { openWelcome(); } catch (e) { logErr("[main] 打开引导失败: " + e); } } },
    { type: "separator" },
    { label: "退出", click: () => app.quit() },
  ];
}

function resetPosition() {
  if (!win || win.isDestroyed()) return;
  const { w, h } = windowSize();
  S.patch({ offsetRight: MARGIN_RIGHT, offsetBottom: MARGIN_BOTTOM });
  const raw = defaultPos(w, h);
  // 默认位置是按当前屏算的，但分辨率/缩放偶尔会让它落到边界外，再夹一次更稳。
  const p = ensureStartPos(raw.x, raw.y, w, h);
  win.setPosition(p.x, p.y);
  log("[main] 位置已重置 (" + p.x + "," + p.y + ")");
}

// ---------- DSH 活跃度 ----------
// DSH 的 /api/pet/state 要会话 cookie，独立进程拿不到；
// 但每个会话都在往 session.v4.jsonl.zstd 追加内容，看最近写入时间就够了。
const SESSIONS_ROOT = path.join(process.env.USERPROFILE || "C:\\Users\\Administrator", ".dsh", "sessions");
const SESSION_FILE = "session.v4.jsonl.zstd";

function newestSessionWrite() {
  let newest = 0;
  let dirs = [];
  try {
    dirs = fs.readdirSync(SESSIONS_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch (e) {
    return 0;
  }
  for (const d of dirs) {
    const wsDir = path.join(SESSIONS_ROOT, d.name);
    let subs = [];
    try {
      subs = fs.readdirSync(wsDir, { withFileTypes: true }).filter((x) => x.isDirectory());
    } catch (e) {
      continue;
    }
    for (const s of subs) {
      try {
        const st = fs.statSync(path.join(wsDir, s.name, SESSION_FILE));
        if (st.mtimeMs > newest) newest = st.mtimeMs;
      } catch (e) { /* 这个会话没文件 */ }
    }
  }
  return newest;
}

function startDshWatcher() {
  if (watcherTimer) clearInterval(watcherTimer);
  watcherTimer = setInterval(() => {
    const age = Date.now() - newestSessionWrite();
    const state = age < 20000 ? "busy" : age < 90000 ? "recent" : "idle";
    if (win && !win.isDestroyed()) win.webContents.send("dsh-activity", { state, age });
  }, 2000);
}

// 每分钟看一次 RVC 是不是闲着。间隔取 60 秒而不是 5 分钟，
// 是为了「最多多关一分钟」，不会出现「已经闲置十分钟了还开着」。
let rvcIdleTimer = null;
function startRvcIdleWatch() {
  if (rvcIdleTimer) clearInterval(rvcIdleTimer);
  rvcIdleTimer = setInterval(rvcIdleTick, 60000);
}

// ---------- IPC ----------
// 拖动：全程在主进程算位移。
// 渲染进程的 screenX 是 DIP，跨到缩放不同的屏幕会跳变，
// 用它累加位移在双屏上会直接算飞。主进程的 getCursorScreenPoint
// 和 setPosition 用同一套坐标，跨屏才稳。
let dragAnchor = null;

// ══ 桥接连通性检测 ═════════════════════════════════════
// 打对方的 /api/health。用 net 模块而不是全局 fetch：
// 它走 Chromium 的网络栈但没有页面同源策略，测局域网地址不会被拦。
ipcMain.handle("bridge:test", async (_e, url) => {
  const started = Date.now();
  const target = String(url || "").replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(target)) {
    return { ok: false, ms: 0, error: "地址要以 http:// 或 https:// 开头" };
  }
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    const r = await net.fetch(target + "/api/health", { signal: ctl.signal });
    clearTimeout(timer);
    const ms = Date.now() - started;
    if (!r.ok) return { ok: false, ms, error: "HTTP " + r.status + "（端口通了，但不是 phone-bridge？）" };
    const j = await r.json().catch(() => null);
    if (!j || j.app !== "dsh-phone-bridge") {
      return { ok: false, ms, error: "连上了，但对方不是 DSH 桥接服务" };
    }
    return {
      ok: true,
      ms,
      sessionId: j.sessionId || "",
      model: j.model || "",
      cwd: j.cwd || "",
      busy: !!j.busy,
      queued: Number(j.queued) || 0,
      // 对方自报的可用地址：换设备时可以直接挑一个填进去
      addresses: Array.isArray(j.addresses)
        ? j.addresses.map((a) => ({ label: a.label || "", url: a.url || "", nic: a.nic || "" }))
        : [],
    };
  } catch (e) {
    const ms = Date.now() - started;
    const msg = String((e && e.message) || e);
    return {
      ok: false,
      ms,
      error: /abort/i.test(msg) ? "超时（6 秒没响应，可能不在同一网络）" : msg,
    };
  }
});

ipcMain.handle("api:chat", async (_e, req0) => {
  // 渲染进程不能直接 fetch 外部接口：页面在 127.0.0.1:7801，外部域名没有 CORS 头，
  // 浏览器会把响应拦掉（请求其实发出去了，只是拿不回来）。主进程没有同源限制，
  // 所有 API 对话都从这里转一道。
  const base = String((req0 && req0.apiBase) || "").replace(/\/+$/, "");
  const key = String((req0 && req0.apiKey) || "");
  const model = String((req0 && req0.apiModel) || "").trim();
  const messages = Array.isArray(req0 && req0.messages) ? req0.messages : [];
  if (!base) return { ok: false, error: "没有填 API 地址" };
  if (!model) return { ok: false, error: "没有填模型名" };
  if (!messages.length) return { ok: false, error: "没有要发的内容" };

  const headers = { "content-type": "application/json" };
  if (key) headers.authorization = "Bearer " + key;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 90000);
    const r = await net.fetch(base + "/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature: Number(req0 && req0.temperature) || 0.85,
        max_tokens: Number(req0 && req0.maxTokens) || 600,
        stream: false,
      }),
      signal: ctl.signal,
    });
    clearTimeout(timer);
    if (!r.ok) {
      let detail = "";
      try { detail = (await r.text()).slice(0, 200); } catch (e) { }
      return { ok: false, error: "API 返回 " + r.status + (detail ? "：" + detail : "") };
    }
    const j = await r.json().catch(() => null);
    const msg = j && j.choices && j.choices[0] && j.choices[0].message;
    const reply = String((msg && msg.content) || "").trim();
    if (!reply) return { ok: false, error: "API 没给出内容" };
    return { ok: true, reply, model: (j && j.model) || model };
  } catch (e) {
    const msg = String((e && e.message) || e);
    return { ok: false, error: /abort/i.test(msg) ? "超时（90 秒没响应）" : msg };
  }
});

ipcMain.handle("api:test", async (_e, cfg) => {
  // 用一句最短的话去打一次 /chat/completions，验证地址、key、模型名三样都对。
  // 故意走主进程而不是渲染进程：主进程没有同源限制，测外网接口不会被 CORS 拦。
  const started = Date.now();
  const base = String((cfg && cfg.apiBase) || "").replace(/\/+$/, "");
  const key = String((cfg && cfg.apiKey) || "");
  const model = String((cfg && cfg.apiModel) || "").trim();
  if (!/^https?:\/\//i.test(base)) {
    return { ok: false, ms: 0, error: "接口地址要以 http:// 或 https:// 开头" };
  }
  if (!model) return { ok: false, ms: 0, error: "还没填模型名" };

  const headers = { "content-type": "application/json" };
  if (key) headers.authorization = "Bearer " + key;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30000);
    const r = await net.fetch(base + "/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "用一句话跟我打个招呼" }],
        max_tokens: 60,
        temperature: 0.7,
        stream: false,
      }),
      signal: ctl.signal,
    });
    clearTimeout(timer);
    const ms = Date.now() - started;
    if (!r.ok) {
      let detail = "";
      try { detail = (await r.text()).slice(0, 160); } catch (e) { }
      return { ok: false, ms, error: "HTTP " + r.status + (detail ? "：" + detail : "") };
    }
    const j = await r.json().catch(() => null);
    const msg = j && j.choices && j.choices[0] && j.choices[0].message;
    const reply = String((msg && msg.content) || "").trim();
    if (!reply) return { ok: false, ms, error: "对面回了，但内容为空（模型名对不对？）" };
    return { ok: true, ms, model: (j && j.model) || model, reply };
  } catch (e) {
    const ms = Date.now() - started;
    const msg = String((e && e.message) || e);
    return {
      ok: false,
      ms,
      error: /abort/i.test(msg) ? "超时（30 秒没响应）" : msg,
    };
  }
});

ipcMain.on("win:focusable", (_e, v) => {
  // 打字时要能拿焦点，打完再放回去，避免把别的窗口焦点抢走。
  try {
    if (!win || win.isDestroyed()) return;
    win.setFocusable(!!v);
    if (v) win.focus();
    // 切换可聚焦状态同样会让 DWM 重画框架，顺手把底色压回全透明。
    try { win.setBackgroundColor("#00000000"); } catch (e) { }
  } catch (e) { }
});

ipcMain.on("win:dragStart", () => {
  if (!win || win.isDestroyed()) return;
  const p = screen.getCursorScreenPoint();
  const [x, y] = win.getPosition();
  dragAnchor = { cx: p.x, cy: p.y, wx: x, wy: y };
});

ipcMain.on("win:dragMove", () => {
  if (!win || win.isDestroyed() || dragAnchor === null) return;
  const p = screen.getCursorScreenPoint();
  const nx = Math.round(dragAnchor.wx + (p.x - dragAnchor.cx));
  const ny = Math.round(dragAnchor.wy + (p.y - dragAnchor.cy));
  win.setPosition(nx, ny);
});

ipcMain.on("win:dragEnd", () => {
  dragAnchor = null;
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  S.patch({ x, y });
});

ipcMain.on("win:moveBy", (_e, dx, dy) => {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  win.setPosition(Math.round(x + dx), Math.round(y + dy));
});

ipcMain.on("dsh-state", (_e, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send("dsh-state", payload);
});

ipcMain.handle("settings:get", () => ({ ...S.get(), version: app.getVersion() }));

// 快捷键当前的注册情况：设置里要能看出「填了但被别的软件占了」。
ipcMain.handle("hotkey:status", () => {
  const s = S.get();
  return {
    summon: s.hotkeySummon || "",
    mic: s.hotkeyMic || "",
    mute: s.hotkeyMute || "",
    bound: boundAccels.slice(),
  };
});

// 状态面板：开 / 关 / 问一句它在不在
ipcMain.handle("chat:open", () => openChatLog());
ipcMain.handle("chat:close", () => { closeChatLog(); return true; });
ipcMain.handle("chat:isOpen", () => !!(chatlogWin && !chatlogWin.isDestroyed()));
ipcMain.handle("chat:list", () => ({ ok: true, items: chatLoad() }));
ipcMain.handle("chat:append", (_e, item) => ({ ok: true, item: chatAppend(item) }));
ipcMain.handle("chat:merge", (_e, arr) => ({ ok: true, added: chatMerge(arr), items: chatLoad() }));
ipcMain.handle("chat:export", async (_e, text) => {
  try {
    const body = String(text || "");
    if (!body.trim()) return { ok: false, error: "还没有聊过天" };
    const now = new Date();
    const p2 = (n) => (n < 10 ? "0" + n : String(n));
    const stamp = now.getFullYear() + p2(now.getMonth() + 1) + p2(now.getDate()) + "-" + p2(now.getHours()) + p2(now.getMinutes());
    const r = await dialog.showSaveDialog(dialogParent(), {
      title: "导出对话记录",
      defaultPath: "大肥鱼对话-" + stamp + ".md",
      filters: [{ name: "Markdown", extensions: ["md"] }, { name: "文本", extensions: ["txt"] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    require("node:fs").writeFileSync(r.filePath, body, "utf-8");
    log("[main] 对话记录已导出 " + r.filePath);
    return { ok: true, path: r.filePath };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});
ipcMain.handle("chat:clear", () => {
  chatItems = [];
  chatSaveSoon();
  try { if (chatlogWin && !chatlogWin.isDestroyed()) chatlogWin.webContents.send("chat:cleared"); } catch (e) { }
  return { ok: true };
});

// 相处档案：独立窗口 + 导出 Markdown
ipcMain.handle("pet:panel-open", () => !!(petPanelWin && !petPanelWin.isDestroyed()));

// 活动结算认领：renderer 用 sendSync 拿一次性令牌。
// 两个窗口（主窗 / 状态面板）同时到点时，只有一个能拿到 true。
const settleClaims = new Map();
ipcMain.on("pet:claim-settle", (e, key) => {
  const k = String(key || "");
  if (!k) { e.returnValue = false; return; }
  if (settleClaims.has(k)) { e.returnValue = false; return; }
  settleClaims.set(k, Date.now());
  if (settleClaims.size > 500) {
    const cutoff = Date.now() - 6 * 60 * 60 * 1000;
    for (const [oldKey, at] of settleClaims) {
      if (at < cutoff) settleClaims.delete(oldKey);
    }
    while (settleClaims.size > 500) settleClaims.delete(settleClaims.keys().next().value);
  }
  e.returnValue = true;
});

ipcMain.handle("clipboard:write", (_e, text) => {
  try {
    clipboard.writeText(String(text || ""));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle("profile:open", () => openProfile());
ipcMain.handle("profile:close", () => { closeProfile(); return true; });
ipcMain.handle("profile:export", async (_e, text) => {
  try {
    const body = String(text || "");
    if (!body.trim()) return { ok: false, error: "还没有可以导出的记录" };
    const now = new Date();
    const p2 = (n) => (n < 10 ? "0" + n : String(n));
    const stamp = now.getFullYear() + p2(now.getMonth() + 1) + p2(now.getDate()) + "-" + p2(now.getHours()) + p2(now.getMinutes());
    const r = await dialog.showSaveDialog(dialogParent(), {
      title: "导出相处档案",
      defaultPath: "大肥鱼相处档案-" + stamp + ".md",
      filters: [{ name: "Markdown", extensions: ["md"] }, { name: "文本", extensions: ["txt"] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    require("node:fs").writeFileSync(r.filePath, body, "utf-8");
    log("[main] 相处档案已导出 " + r.filePath);
    return { ok: true, path: r.filePath };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

// 看屏幕
ipcMain.handle("see:open", () => openSeeWatch());
ipcMain.handle("see:close", () => { closeSeeWatch(); return true; });
ipcMain.handle("see:start", () => seeStart());
ipcMain.handle("see:stop", () => { seeStop(); return seeStatus(); });
ipcMain.handle("see:status", () => seeStatus());
ipcMain.handle("see:snapshot", async () => {
  // 设置里「试一眼」：抓当前屏幕直接分析一次，不要求监视窗开着。
  const r = await seeTick(true);
  return r;
});

ipcMain.handle("pet:open", () => { openPetPanel(); return true; });
ipcMain.handle("pet:close", () => { closePetPanel(); return true; });
ipcMain.handle("pet:isOpen", () => !!(petPanelWin && !petPanelWin.isDestroyed()));

// 主窗口右键：弹一个原生菜单，把常用的几个入口摆出来。
// 以前右键是「直接打开设置」——想换模型、想看对话记录都得先进设置再找，绕两跳。
ipcMain.handle("window:menu", (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w || w.isDestroyed()) return false;
  const t = [
    { label: "设置…", click: () => { openSettings(); } },
    { label: "模型适配器…", click: () => { openAdapter(); } },
    { type: "separator" },
    { label: "对话记录…", click: () => { openChatLog(); } },
    { label: "相处档案…", click: () => { openProfile(); } },
    { label: "看屏幕…", click: () => { openSeeWatch(); } },
    { label: "看看她…", click: () => { openPetPanel(); } },
    {
      label: "喂她一口",
      submenu: TRAY_FOODS.map((name, i) => ({
        label: name,
        click: () => quickPet("feed", { idx: i }),
      })),
    },
    { label: "摸摸头", click: () => quickPet("pet") },
    { type: "separator" },
    { label: "重置位置", click: () => { resetPosition(); } },
    {
      label: updateAvailable ? "检查更新（v" + updateAvailable + " 可用）" : "检查更新…",
      click: () => { checkUpdateFromTray(); },
    },
    { type: "separator" },
    { label: "退出", click: () => { app.quit(); } },
  ];
  try {
    Menu.buildFromTemplate(t).popup({ window: w });
    return true;
  } catch (x) {
    logErr("[main] 右键菜单弹出失败：" + x);
    return false;
  }
});

ipcMain.handle("settings:patch", async (_e, patch) => {
  const next = S.patch(patch);
  // 写盘失败时 S.lastSaveError 才有值：主进程没有控制台，必须落进 run.log，否则用户
  // 改完设置以为生效了、重启才发现全没——而且查不到任何原因。
  if (S.lastSaveError) logErr("[main] 设置写盘失败：" + S.lastSaveError);
  applySettings(patch);
  // 托盘里有「静音」「暂停动效」两个复选项，设置页改了也要同步勾选状态。
  refreshTrayMenu();
  if (patch && (Object.prototype.hasOwnProperty.call(patch, "hotkeyMic") || Object.prototype.hasOwnProperty.call(patch, "hotkeySummon") || Object.prototype.hasOwnProperty.call(patch, "hotkeyMute"))) {
    registerHotkey();
  }
  // 开机自启写的是注册表，可能被拦。等它跑完，把「注册表里到底有没有」一起带回去，
  // 免得面板显示已开启、用户下次开机才发现根本没起。
  const auto = await applyLaunchAtLogin(next.launchAtLogin);
  // 飞鱼环境的根目录变了 → 丢掉模块缓存，下次用时按新路径重新 import。
  // feiyu.mjs 顶层的 PY/PKG/REPO 是加载时求值的常量，不重载的话改了设置也不生效。
  // 光置 null 不够：Node 的 ESM 缓存按 URL 记，同一个 URL 永远返回旧实例。
  // 所以同时把代际号加一，engineFeiyu() 会用新 URL 真正重新加载。
  if (patch && Object.prototype.hasOwnProperty.call(patch, "feiyuHome")) {
    try { __feiyu = null; __feiyuGen++; } catch (e) { }
  }
  // 把「这次到底存上没有」一并告诉前端：面板上改了一个值，
  // 如果写盘失败还照常刷新，用户会以为已经生效，重启才发现全回去了。
  return {
    ...next, version: app.getVersion(), ok: !S.lastSaveError, error: S.lastSaveError || "",
    autostart: { ok: auto.ok, error: auto.error },
  };
});

ipcMain.handle("settings:reset", async () => {
  const next = S.reset();
  if (S.lastSaveError) logErr("[main] 恢复默认后写盘失败：" + S.lastSaveError);
  registerHotkey();
  applySettings({ scale: next.scale, opacity: next.opacity, alwaysOnTop: next.alwaysOnTop, clickThrough: next.clickThrough });
  resetPosition();
  const auto = await applyLaunchAtLogin(next.launchAtLogin);
  return {
    ...next, version: app.getVersion(), ok: !S.lastSaveError, error: S.lastSaveError || "",
    autostart: { ok: auto.ok, error: auto.error },
  };
});

// ---- 配置导出 / 导入：换设备时导一次，导进去就能用 ----
// 导出的只该是「怎么连、长什么样」，不该带体积大的东西或本机专属路径。
// 导出配置带哪些字段。
// 三类故意不导：
//   位置类（x / y / anchorMode / offsetRight / offsetBottom）—— 绝对坐标换机器可能跑到屏幕外
//   机器路径类（rvcPython）—— 每台机器上 python 装在哪都不一样
//   密钥类（apiKey）—— 不该落进一个随手能发出去的文件里
const EXPORTABLE = [
  "bridgeUrl", "voiceId", "micDevice", "scale", "opacity", "resolution",
  "sharpen", "fpsCap", "alwaysOnTop", "clickThrough", "followCursor", "autoIdle",
  "blinkEnabled", "dockAutoHide", "launchAtLogin",
  // 取景和快捷键是最「个人」的两项：换台机器重新调一遍很烦，必须跟着配置走。
  // 位置（offsetRight/offsetBottom/x/y）不带 —— 屏幕不一样，搬过去反而乱。
  "viewBox", "hotkeySummon", "hotkeyMic", "hotkeyMute",
  // 语音输出
  "voiceOut", "rvcBackend", "rvcDevice", "rvcPitch", "rvcAutoStop", "rvcModel", "volume",
  "voiceWarm", "xttsSpeed", "feiyuStyle", "feiyuSpeed",
  // 回复模型
  "replyMode", "apiBase", "apiModel",
  // 看屏幕（密钥 seeKey 不导出）
  "seeModel", "seeBase", "seeInterval", "seeGap", "seeSpeak",
];

// 系统对话框（选文件 / 选目录 / 保存）必须挂在能获得焦点的窗口上。
// win 是 focusable:false 的透明置顶窗，拿它当 parent 时对话框挂不上去，
// 会**静默返回 canceled** —— 用户看到的就是「点了没反应」，日志里也没有任何东西。
// 设置页发起的对话框一律走这里。
function dialogParent() {
  try {
    if (settingsWin && !settingsWin.isDestroyed()) return settingsWin;
  } catch (e) { }
  // 千万别退回 win：它是 focusable:false 的透明置顶模型窗，挂上去对话框会静默取消。
  // 没有能聚焦的窗口时宁可不要父窗口——系统会把对话框当成独立窗口弹出来。
  return undefined;
}

ipcMain.handle("settings:export", async () => {
  try {
    const cur = S.get();
    const blob = {};
    for (const k of EXPORTABLE) if (cur[k] !== undefined) blob[k] = cur[k];
    const payload = {
      app: "dafeiyu-desk",
      version: app.getVersion(),
      exportedAt: new Date().toISOString(),
      settings: blob,
    };
    const r = await dialog.showSaveDialog(dialogParent(), {
      title: "导出大肥鱼配置",
      defaultPath: "dafeiyu-config.json",
      filters: [{ name: "配置文件", extensions: ["json"] }],
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    require("node:fs").writeFileSync(r.filePath, JSON.stringify(payload, null, 2), "utf-8");
    log("[main] 配置已导出 " + r.filePath);
    return { ok: true, path: r.filePath, count: Object.keys(blob).length };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

/* ─────────────── 存储 ───────────────
 * 语音缓存和 whisper 模型默认在 userData 下（设置里能换盘）。这里只做三件事：
 * 报占用、打开目录、清缓存。
 * 清缓存刻意不碰 models/——turbo 有 1.6G，删了要重下一遍，用户大概率只是想
 * 腾点 TTS 的空间。
 */
function storageDirs() {
  return {
    data: process.env.FISH_DATA_DIR || path.join(app.getPath("userData"), "runtime"),
    models: process.env.FISH_MODEL_DIR || path.join(app.getPath("userData"), "models"),
  };
}

function dirSize(dir) {
  let bytes = 0;
  let files = 0;
  const walk = (d) => {
    let list;
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const ent of list) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else {
        try { bytes += fs.statSync(p).size; files += 1; } catch (e) { }
      }
    }
  };
  walk(dir);
  return { bytes, files };
}

ipcMain.handle("storage:info", () => {
  const d = storageDirs();
  const cache = dirSize(path.join(d.data, "tts"));
  const models = dirSize(d.models);
  return {
    custom: String((S && S.get("cacheDir")) || ""),
    defaultDir: path.join(app.getPath("userData"), "runtime"),
    dataDir: d.data,
    modelDir: d.models,
    cacheBytes: cache.bytes,
    cacheFiles: cache.files,
    modelBytes: models.bytes,
  };
});

ipcMain.handle("storage:open", async () => {
  const d = storageDirs();
  try { fs.mkdirSync(d.data, { recursive: true }); } catch (e) { }
  const err = await shell.openPath(d.data);
  return { ok: !err, error: err || "" };
});

ipcMain.handle("storage:clear", async () => {
  const ttsDir = path.join(storageDirs().data, "tts");
  let n = 0;
  let bytes = 0;
  try {
    for (const f of fs.readdirSync(ttsDir)) {
      const p = path.join(ttsDir, f);
      try {
        const st = fs.statSync(p);
        if (st.isFile()) { bytes += st.size; fs.unlinkSync(p); n += 1; }
      } catch (e) { }
    }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
  log("[main] 清理语音缓存 " + n + " 个文件 / " + Math.round(bytes / 1048576) + "MB");
  return { ok: true, count: n, bytes };
});

/* ─────────────── 关于 / 诊断包 ───────────────
 *
 * 商业发行必须给用户一个「我看得出问题出在哪」的入口。这里只做四件事：
 * 报版本与环境、把许可文件读出来给用户看、打开数据目录、一键打诊断包。
 *
 * 诊断包不压缩、不联网、不上传：就是一个文件夹，里面几份纯文本，用户可以
 * 自己打开看，也可以整个发给客服。密钥类字段在落盘前打码。
 */

function diagStamp() {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + "-" +
    p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds())
  );
}

/** 设置里有 API Key / 视觉 Key，导出前统一打码；嵌套对象也走一遍。 */
function sanitizeSettings(obj) {
  const SECRET = new Set(["apiKey", "seeKey", "miniToken", "token", "password"]);
  const out = {};
  for (const k of Object.keys(obj || {})) {
    const v = obj[k];
    if (SECRET.has(k)) out[k] = v ? "<已隐藏>" : "";
    else if (v && typeof v === "object" && !Array.isArray(v)) out[k] = sanitizeSettings(v);
    else out[k] = v;
  }
  return out;
}

ipcMain.handle("about:info", () => {
  const d = storageDirs();
  return {
    version: app.getVersion(),
    electron: process.versions.electron,
    chromium: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    osType: os.type(),
    osVersion: os.release(),
    packaged: app.isPackaged,
    userData: app.getPath("userData"),
    dataDir: d.data,
    modelDir: d.models,
    // 上次启动时设置文件读坏了的话，把备份路径告诉界面，让用户知道「设置被重置过」。
    settingsBroken: S && S.lastLoadError ? { ...S.lastLoadError } : null,
    // 最近一次写盘失败的原因（磁盘满 / 权限 / 路径被占）。正常是 null。
    settingsSaveError: S ? S.lastSaveError : null,
  };
});

// ---------- 检查更新 ----------
// 只做「手动问一句」，不静默替换安装包：NSIS 安装版在运行时替换 asar/资源，
// 一旦中途失败，用户面前就只剩一个打不开的程序，很难自己救回来。
// 所以这里负责查、负责告诉，下载和安装交给用户在浏览器里完成。
const UPDATE_REPO = "hanhan9999999999999999999/dafeiyu-desk";
const UPDATE_API = "https://api.github.com/repos/" + UPDATE_REPO + "/releases/latest";
const UPDATE_PAGE = "https://github.com/" + UPDATE_REPO + "/releases/latest";

// 只解析到主.次.修 + 后缀；预发布版本按「后缀非空 = 更旧」处理。
function verParts(v) {
  const m = String(v || "").trim().replace(/^v/i, "")
    .match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?/);
  if (!m) return null;
  return { n: [+m[1] || 0, +m[2] || 0, +m[3] || 0], pre: m[4] || "" };
}
// 返回 > 0 表示 a 比 b 新
function verCmp(a, b) {
  const x = verParts(a);
  const y = verParts(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (x.n[i] !== y.n[i]) return x.n[i] - y.n[i];
  }
  // 1.2.0 比 1.2.0-beta 新
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre > y.pre ? 1 : -1;
}

async function checkUpdate() {
  const current = app.getVersion();
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 9000);
    // 走 Electron 的 net 而不是 node:https：它使用 Chromium 的网络栈和系统代理，
    // 开了代理的机器不会因为「程序不走代理」而永远查不到更新。
    const r = await net.fetch(UPDATE_API, {
      signal: ctl.signal,
      headers: {
        // GitHub API 不带 User-Agent 会直接 403
        "user-agent": "dafeiyu-desk/" + current,
        accept: "application/vnd.github+json",
      },
    });
    clearTimeout(timer);
    // 404 = 仓库还没有发布过 Release（或者仓库改名了）。不是错误，是「没有版本」。
    if (r.status === 404) {
      return { ok: true, current, latest: "", newer: false, empty: true, page: UPDATE_PAGE };
    }
    if (r.status === 403 || r.status === 429) {
      return {
        ok: false,
        current,
        page: UPDATE_PAGE,
        error: "查询太频繁了（GitHub 限流），过一会儿再试",
      };
    }
    if (!r.ok) {
      return { ok: false, current, page: UPDATE_PAGE, error: "更新服务返回 HTTP " + r.status };
    }
    const j = await r.json().catch(() => null);
    if (!j || (!j.tag_name && !j.name)) {
      return { ok: false, current, page: UPDATE_PAGE, error: "更新信息格式不对" };
    }
    const latest = String(j.tag_name || j.name).replace(/^v/i, "");
    const notes = String(j.body || "").trim();
    return {
      ok: true,
      current,
      latest,
      newer: verCmp(latest, current) > 0,
      // 本地这版比 GitHub 上发的还新（内测/自己编译的），前端据此换套说法，
      // 不然「已是最新版本（v1.2.0）」配「GitHub 上最新是 v1.1.3」看着像自相矛盾。
      ahead: verCmp(current, latest) > 0,
      page: j.html_url || UPDATE_PAGE,
      publishedAt: j.published_at || "",
      prerelease: !!j.prerelease,
      notes: notes.length > 1400 ? notes.slice(0, 1400) + "\n…（完整说明见下载页）" : notes,
    };
  } catch (e) {
    const msg = String((e && e.message) || e);
    return {
      ok: false,
      current,
      page: UPDATE_PAGE,
      error: /abort/i.test(msg)
        ? "连不上 GitHub（9 秒超时），可能是网络或代理问题"
        : msg,
    };
  }
}
ipcMain.handle("update:check", () => checkUpdate());

ipcMain.handle("update:open", async (_e, url) => {
  const u = String(url || UPDATE_PAGE);
  // 只允许打开 GitHub 页面：这个 URL 来自网络响应，不能直接交给 openExternal。
  if (!/^https:\/\/(github\.com|api\.github\.com)\//i.test(u)) {
    return { ok: false, error: "只允许打开 GitHub 页面" };
  }
  try {
    await shell.openExternal(u);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle("about:license", () => {
  // 开发态是 _app/assets/LICENSE.txt；打包态有两个可能的位置：
  //   ① app.asar 内 assets/LICENSE.txt（package.json 的 files 已显式收进去）
  //   ② resources/assets/LICENSE.txt（extraResources 全量复制 assets）
  // 两条都试一遍：asar 里的文件缺失时 fs 会直接 ENOENT，不会自动回落到外面那份。
  const cands = [
    path.join(__dirname, "..", "assets", "LICENSE.txt"),
    path.join(__dirname, "..", "LICENSE.txt"),
    path.join(RES_ROOT, "assets", "LICENSE.txt"),
    path.join(RES_ROOT, "LICENSE.txt"),
  ];
  for (const p of cands) {
    try {
      return { ok: true, path: p, text: fs.readFileSync(p, "utf8") };
    } catch (e) { /* 换下一个候选 */ }
  }
  return { ok: false, error: "安装包里没有找到许可文件（LICENSE.txt）" };
});

ipcMain.handle("privacy:read", () => {
  // 和 license 同一套候选顺序：开发态读 _app/assets，打包态读 asar 内或 extraResources。
  // fs 读 asar 里缺失的文件会直接 ENOENT，不会自动回落到外层，所以两条都要试。
  const cands = [
    path.join(__dirname, "..", "assets", "PRIVACY.txt"),
    path.join(RES_ROOT, "assets", "PRIVACY.txt"),
    path.join(RES_ROOT, "PRIVACY.txt"),
  ];
  for (const p of cands) {
    try {
      return { ok: true, path: p, text: fs.readFileSync(p, "utf8") };
    } catch (e) { /* 换下一个候选 */ }
  }
  return { ok: false, error: "安装包里没有找到隐私说明（PRIVACY.txt）" };
});

// 抽成函数：诊断包导出既要给 IPC 用，也要给「上次崩溃了」的提示用。
async function exportDiag() {
  let dir = "";
  try {
    // 父窗口用设置窗，不要用模型窗口：模型窗是 focusable:false 的透明置顶窗，
    // 系统目录选择器挂不上去，表现就是「点了按钮什么也没发生」。
    const r = await dialog.showOpenDialog(dialogParent(), {
      title: "选一个文件夹放诊断包",
      buttonLabel: "放在这里",
      properties: ["openDirectory", "createDirectory"],
    });
    if (r.canceled || !r.filePaths || !r.filePaths.length) return { ok: false, canceled: true };
    dir = path.join(r.filePaths[0], "大肥鱼诊断-" + diagStamp());
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }

  const made = [];
  const put = (name, text) => {
    try {
      fs.writeFileSync(path.join(dir, name), text, "utf8");
      made.push(name);
    } catch (e) { /* 单个文件失败不影响其它 */ }
  };

  const sd = storageDirs();
  const cache = dirSize(path.join(sd.data, "tts"));
  const models = dirSize(sd.models);
  let cpu = "未知";
  try {
    const cs = os.cpus();
    if (cs && cs.length) cpu = cs[0].model + " ×" + cs.length;
  } catch (e) { }

  put("系统信息.txt", [
    "大肥鱼 · 诊断报告",
    "生成时间: " + new Date().toLocaleString("zh-CN"),
    "",
    "版本: " + app.getVersion(),
    "运行形态: " + (app.isPackaged ? "安装版" : "开发模式"),
    "Electron: " + process.versions.electron,
    "Chromium: " + process.versions.chrome,
    "Node: " + process.versions.node,
    "V8: " + process.versions.v8,
    "系统: " + os.type() + " " + os.release() + " (" + process.arch + ")",
    "CPU: " + cpu,
    "内存: " + (Math.round((os.totalmem() / 1073741824) * 10) / 10) + " GB",
    "",
    "userData: " + app.getPath("userData"),
    "数据目录: " + sd.data,
    "模型目录: " + sd.models,
    "语音缓存: " + cache.files + " 个文件 / " + Math.round(cache.bytes / 1048576) + " MB",
    "识别模型: " + Math.round(models.bytes / 1048576) + " MB",
  ].join("\n"));

  // 日志只带尾部：run.log 上限 2MB，整份发过去客服也读不完。
  try {
    if (LOG_FILE) {
      const cur = fs.readFileSync(LOG_FILE, "utf8");
      put("运行日志.log", cur.split("\n").slice(-4000).join("\n"));
      try {
        const old = fs.readFileSync(LOG_FILE + ".1", "utf8");
        put("运行日志.1.log", old.split("\n").slice(-2000).join("\n"));
      } catch (e) { /* 没有轮转文件是常态 */ }
    }
  } catch (e) { }

  try {
    const cd = path.join(app.getPath("userData"), "crash");
    const files = fs.readdirSync(cd).filter((f) => f.endsWith(".txt")).sort().slice(-10);
    for (const f of files) {
      try { put("崩溃-" + f, fs.readFileSync(path.join(cd, f), "utf8")); } catch (e) { }
    }
  } catch (e) { }

  try { put("设置.json", JSON.stringify(sanitizeSettings(S ? S.get() : {}), null, 2)); } catch (e) { }

  log("[main] 诊断包已导出 " + dir + "（" + made.length + " 个文件）");
  return { ok: true, dir, files: made };
}

ipcMain.handle("diag:export", () => exportDiag());

// ---- 上次是不是崩过：启动后问一句，别让用户自己去翻文件夹 ----
// 崩溃记录只写本地（crashReporter uploadToServer:false），但没人会主动去
// %APPDATA% 里找。如果最近 7 天有崩溃且还没提示过，就在这里问一次。
function checkLastCrash() {
  try {
    if (!fs.existsSync(CRASH_DIR)) return;
    const files = fs
      .readdirSync(CRASH_DIR)
      .filter((f) => f.startsWith("crash-") && f.endsWith(".txt"))
      .sort();
    if (!files.length) return;
    const newest = files[files.length - 1];
    let ageDays = 0;
    try {
      ageDays = (Date.now() - fs.statSync(path.join(CRASH_DIR, newest)).mtimeMs) / 86400000;
    } catch (e) {
      /* ignore */
    }
    if (ageDays > 7) return;
    if (S && S.get("lastCrashSeen") === newest) return;
    if (S) S.patch({ lastCrashSeen: newest });

    const when = newest
      .replace(/^crash-/, "")
      .replace(/\.txt$/, "")
      .replace("T", " ")
      .slice(0, 19);
    dialog
      .showMessageBox({
        type: "warning",
        title: "上次运行出过一次问题",
        message: "检测到一次异常退出（" + when + "）。",
        detail:
          "崩溃记录只保存在本地，不会自动上传。\n要不要导出一份诊断包？里面只有日志、系统信息和设置（密钥会打码）。",
        buttons: ["导出诊断包", "打开崩溃记录", "先不用"],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      })
      .then(async (r) => {
        if (r.response === 0) {
          const res = await exportDiag();
          if (res && res.ok) shell.openPath(res.dir);
        } else if (r.response === 1) {
          shell.openPath(CRASH_DIR);
        }
      })
      .catch(() => {
        /* ignore */
      });
  } catch (e) {
    log("[main] 崩溃检查失败: " + e);
  }
}

ipcMain.handle("diag:open", async (_e, p) => {
  try {
    const err = await shell.openPath(String(p || ""));
    return { ok: !err, error: err || "" };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

// 打开运行日志：直接在文件管理器里选中，省得用户去 %APPDATA% 里翻。
ipcMain.handle("log:open", () => {
  try {
    if (!LOG_FILE || !fs.existsSync(LOG_FILE)) return { ok: false, error: "还没有日志文件" };
    shell.showItemInFolder(LOG_FILE);
    return { ok: true, path: LOG_FILE };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

// ---- 语音识别模型（whisper turbo，1.6G，不随安装包发）----
// 用户有权知道这 1.6G 是谁在下、下到哪了、能不能停 —— 别学流氓软件偷偷吃盘。
ipcMain.handle("asr:turbo", async () => {
  try {
    const m = await engineAsr();
    const st = m.turboState ? m.turboState() : { present: false };
    let size = 0;
    try {
      const f = path.join(st.dir || "", "ggml-large-v3-turbo.bin");
      if (st.dir && fs.existsSync(f)) size = fs.statSync(f).size;
    } catch (e) { /* 文件刚被删掉也会走到这，size 保持 0 */ }
    return { ok: true, size, ...st };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});
ipcMain.handle("asr:turbo-action", async (_e, action) => {
  try {
    const m = await engineAsr();
    if (action === "cancel") {
      if (m.cancelTurbo) m.cancelTurbo();
      log("[main] 用户取消了 turbo 下载");
      return { ok: true };
    }
    if (action === "start") {
      if (m.ensureTurbo) m.ensureTurbo(true);
      log("[main] 用户手动开始下载 turbo（1.6G）");
      return { ok: true };
    }
    return { ok: false, error: "未知操作：" + action };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});


ipcMain.handle("settings:pickAudio", async () => {
  // XTTS 的参考音频：让用户自己挑，别让他手打一条 Windows 路径
  try {
    const r = await dialog.showOpenDialog(dialogParent(), {
      title: "选一段参考音频（3–10 秒干净人声最好）",
      properties: ["openFile"],
      filters: [{ name: "音频", extensions: ["wav", "mp3", "m4a", "flac", "ogg"] }],
    });
    if (r.canceled || !r.filePaths || !r.filePaths.length) return "";
    return r.filePaths[0];
  } catch (e) {
    return "";
  }
});

ipcMain.handle("settings:pickFolder", async () => {
  // 飞鱼的参考音频文件夹：用户自己塞一批 wav+txt 进去，路径由他定
  try {
    const r = await dialog.showOpenDialog(dialogParent(), {
      title: "选参考音频文件夹（一个 wav + 同名 .txt，txt 里写它说了什么）",
      properties: ["openDirectory"],
    });
    if (r.canceled || !r.filePaths || !r.filePaths.length) return "";
    return r.filePaths[0];
  } catch (e) {
    return "";
  }
});

// ---------- 模型适配器 ----------
ipcMain.handle("adapter:open", (_e, id, step) => {
  openAdapter(typeof id === "string" ? id : "", typeof step === "string" ? step : "");
  return { ok: true };
});
ipcMain.on("adapter:close", () => closeAdapter());

// 选模型文件夹。用户手上大多是一个「解压出来、里面一堆贴图和 model3.json」的目录，
// 所以选中的目录自己可能就是包，也可能是「上一级」。两种都由 store 的探测兜住。
ipcMain.handle("adapter:pickDir", async () => {
  try {
    const r = await dialog.showOpenDialog(adapterWin && !adapterWin.isDestroyed() ? adapterWin : dialogParent(), {
      title: "选一个 Live2D 模型文件夹",
      properties: ["openDirectory"],
      buttonLabel: "导入",
    });
    if (r.canceled || !r.filePaths || !r.filePaths.length) return { ok: false, canceled: true };
    return { ok: true, path: r.filePaths[0] };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

// 切模型：写 settings，然后让主窗口整个重载 —— 换模型等于换一份渲染参数，
// 增量改比重载更容易漏（贴图、参数索引、动作库全是新的）。
// 导入压缩包：和选文件夹分开两个入口。
// Windows 的文件对话框不支持「既能选文件夹又能选文件」，混在一个按钮里就会出现
// 「点进去什么都选不了」——所以界面上给两个按钮，各走各的对话框。
ipcMain.handle("adapter:pickArchive", async () => {
  try {
    const r = await dialog.showOpenDialog(adapterWin && !adapterWin.isDestroyed() ? adapterWin : dialogParent(), {
      title: "选一个 Live2D 模型压缩包",
      properties: ["openFile"],
      filters: [{ name: "ZIP 压缩包", extensions: ["zip"] }],
      buttonLabel: "导入",
    });
    if (r.canceled || !r.filePaths || !r.filePaths.length) return { ok: false, canceled: true };
    return { ok: true, path: r.filePaths[0] };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

// 主窗口「还没有模型」时的一键导入：不用先打开适配器，选完直接装好并切过去。
// kind: "zip"（默认）| "folder" —— Windows 的文件对话框不能既选文件又选文件夹，
// 所以这里也分两条路，界面上给两个入口。
ipcMain.handle("model:import", async (_e, kind) => {
  if (!ADAPTER) return { ok: false, error: "适配器没有初始化" };
  try {
      const isDir = kind === "folder";
      const r = await dialog.showOpenDialog(dialogParent(), isDir
        ? { title: "选一个 Live2D 模型文件夹", properties: ["openDirectory"], buttonLabel: "导入" }
        : {
          title: "选一个 Live2D 模型压缩包",
          properties: ["openFile"],
          filters: [{ name: "ZIP 压缩包", extensions: ["zip"] }],
          buttonLabel: "导入",
        });
      if (r.canceled || !r.filePaths || !r.filePaths.length) return { ok: false, canceled: true };
      const src = r.filePaths[0];
      const out = isDir ? ADAPTER.importDir(src, { copy: true }) : ADAPTER.importArchive(src, { copy: true });
      if (!out || !out.id) return { ok: false, error: "导入没有返回模型 id" };
      try { ADAPTER.activate(out.id); } catch (e) { log("[model:import] 切换模型失败 " + (e && e.message)); }
      // 空状态的小窗 → 有模型的正常尺寸（doResize 会按右下角锚点重排）
      try { doResize(); } catch (e) { }
      try { if (win && !win.isDestroyed()) win.webContents.send("pack-changed", out.id); } catch (e) { }
      log("[model:import] 已导入 " + out.id);
      return { ok: true, id: out.id, name: out.displayName || out.id };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle("adapter:activate", (_e, id) => {
  if (!ADAPTER) return { ok: false, error: "适配器没有初始化" };
  try {
    // 切之前先体检。模型文件/贴图缺失的包切过去只有一个结果：
    // 桌宠整个消失，界面上没有任何解释（渲染端只会连报 Network error 重试三次）。
    // 与其让用户以为程序坏了，不如在这里拦住并说清原因。
    const d = ADAPTER.diagnose(id);
    if (d && d.verdict === "broken") {
      return { ok: false, error: "这个模型还不能用 — " + (d.headline || "体检没通过") };
    }
    const r = ADAPTER.activate(id);
    if (!r || r.ok === false) return r || { ok: false, error: "切换失败" };
    try { doResize(); } catch (e) { }
    if (win && !win.isDestroyed()) {
      win.webContents.send("pack-changed", id);
      // 等一帧再 reload，让渲染端有机会先把表情收一下，不然是硬切
      setTimeout(() => { try { if (win && !win.isDestroyed()) win.webContents.reload(); } catch (e) { } }, 120);
    }
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

// 保存后让主窗口重新读一遍配置（不重载模型，只换规则：取景/表情/动作路由）
ipcMain.handle("adapter:reload", () => {
  try {
    if (win && !win.isDestroyed()) win.webContents.send("pack-changed", ADAPTER ? ADAPTER.activeId() : "");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

ipcMain.handle("settings:import", async () => {
  try {
    const r = await dialog.showOpenDialog(dialogParent(), {
      title: "导入大肥鱼配置",
      properties: ["openFile"],
      filters: [{ name: "配置文件", extensions: ["json"] }],
    });
    if (r.canceled || !r.filePaths || !r.filePaths.length) return { ok: false, canceled: true };
    const st = require("node:fs").statSync(r.filePaths[0]);
    if (st.size > 2 * 1024 * 1024) {
      return { ok: false, error: "配置文件太大了（超过 2 MB），请确认选的是大肥鱼的配置" };
    }
    const raw = require("node:fs").readFileSync(r.filePaths[0], "utf-8");
    const j = JSON.parse(raw);
    if (!j || j.app !== "dafeiyu-desk" || !j.settings) {
      return { ok: false, error: "这不是大肥鱼的配置文件" };
    }
    // 只取认识的键；S.patch 内部还会再过一遍 sanitize
    const patch = {};
    for (const k of EXPORTABLE) if (j.settings[k] !== undefined) patch[k] = j.settings[k];
    const next = S.patch(patch);
    if (S.lastSaveError) logErr("[main] 导入配置后写盘失败：" + S.lastSaveError);
    // 整包交给 applySettings：它会把 settings-changed 发给渲染进程，
    // 取景（viewBox）这类只有渲染侧认识的项才会立刻生效。
    applySettings(patch);
    // 导入的是一整包设置，该跟着生效的都得跟着生效 —— 否则用户要重启一次才看见效果，
    // 甚至以为「导进来了但没用」。
    if (["hotkeyMic", "hotkeySummon", "hotkeyMute"].some((k) => Object.prototype.hasOwnProperty.call(patch, k))) {
      registerHotkey();
    }
    if (Object.prototype.hasOwnProperty.call(patch, "feiyuHome")) {
      try { __feiyu = null; __feiyuGen++; } catch (e) { }
    }
    const auto = await applyLaunchAtLogin(next.launchAtLogin);
    log("[main] 配置已从 " + r.filePaths[0] + " 导入，" + Object.keys(patch).length + " 项");
    return {
      ok: true,
      count: Object.keys(patch).length,
      autostart: { ok: auto.ok, error: auto.error },
      settings: { ...next, version: app.getVersion(), ok: !S.lastSaveError, error: S.lastSaveError || "" },
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});

// ---- 自动化测试通道（只有带 FISH_TEST 启动时才响应）----
// 用来复现「连续拖滑块」，全程走与真实操作完全相同的 applySettings 路径。
const TEST_MODE = process.env.FISH_TEST === "1";

ipcMain.handle("test:scale", (_e, v) => {
  if (!TEST_MODE) return { ok: false, reason: "not-in-test-mode" };
  const scale = Math.max(0.5, Math.min(2.0, Number(v) || 1));
  const next = S.patch({ scale });
  applySettings({ scale });
  return { ok: true, scale: next.scale };
});

ipcMain.handle("test:geom", () => {
  if (!TEST_MODE) return { ok: false };
  if (!win || win.isDestroyed()) return { ok: false };
  const b = win.getBounds();
  const d = currentDisplay();
  return {
    ok: true,
    scale: S.get().scale,
    resolution: S.get().resolution,
    win: { w: b.width, h: b.height, x: b.x, y: b.y },
    offsetRight: d.workArea.x + d.workArea.width - (b.x + b.width),
    offsetBottom: d.workArea.y + d.workArea.height - (b.y + b.height),
  };
});

ipcMain.on("settings:open", openSettings);ipcMain.on("settings:close", () => {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
});
ipcMain.on("settings:reset-position", resetPosition);
ipcMain.on("quit", () => app.quit());

// ---------- 开机自启 ----------
// 只写 HKCU\...\Run，不装服务、不动系统目录。
// 注意：开机自启必须绕过 ELECTRON_RUN_AS_NODE=1，否则 electron 会当 node 跑。
// 注册表才是真相：设置里的 launchAtLogin 只表示「用户想要」，
// 真正决定开机起不起得来的是 HKCU\...\Run 里那一项。
function readAutostartReg() {
  return new Promise((resolve) => {
    try {
      const reg = require("node:child_process");
      reg.execFile(
        "reg",
        ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "DafeiyuDesk"],
        { windowsHide: true },
        (err, stdout) => {
          if (err) return resolve({ present: false, value: "" });
          resolve({ present: true, value: String(stdout || "") });
        }
      );
    } catch (e) {
      resolve({ present: false, value: "" });
    }
  });
}

// 返回 Promise<{ok, error}>。调用方要么 await，要么就认了「改了但可能没成」。
// 原来这里的回调是 `() => {}`：reg add 被安全软件或组策略拦掉时，
// 开关照样是「开」、界面照样没有异常，下次开机却不会自动启动 —— 用户完全查不到原因。
async function applyLaunchAtLogin(enabled) {
  try {
    if (process.platform !== "win32") return { ok: true, error: "" };
    const exe = process.execPath;
    const reg = require("node:child_process");
    const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    const want = !!enabled;

    if (want) {
      // 用 cmd /c set 清掉变量再起 electron。
      // 注意：只有开发版（electron.exe）需要把项目目录当参数传进去；
      // 打包版的大肥鱼.exe 自己知道去哪找 app.asar，多传一个 resources 路径
      // 反而会被它当成"要打开的文件"，然后启动失败——开机自启就静默失效。
      // CHROME_CRASHPAD_PIPE_NAME 也得清：从别的 Electron 应用（编辑器、启动器）
      // 的终端里注册自启时，它会跟着继承下来，Electron 起来就去连一个不存在的
      // crashpad 管道，然后 STATUS_BREAKPOINT 秒退——查都查不出来。
      const clean = "set ELECTRON_RUN_AS_NODE= && set CHROME_CRASHPAD_PIPE_NAME=";
      const cmd = app.isPackaged
        ? `cmd.exe /c "${clean} && start "" "${exe}""`
        : `cmd.exe /c "${clean} && start "" "${exe}" "${RES_ROOT}""`;
      await new Promise((resolve) => {
        reg.execFile("reg", ["add", RUN_KEY, "/v", "DafeiyuDesk", "/t", "REG_SZ", "/d", cmd, "/f"], { windowsHide: true },
          (err, stdout, stderr) => resolve({ err, stdout, stderr }));
      });
    } else {
      await new Promise((resolve) => {
        reg.execFile("reg", ["delete", RUN_KEY, "/v", "DafeiyuDesk", "/f"], { windowsHide: true },
          (err, stdout, stderr) => resolve({ err, stdout, stderr }));
      });
    }

    // 写完回读一次：不看返回值，只看注册表里现在有没有这一项。
    const st = await readAutostartReg();
    if (want !== st.present) {
      const why = want ? "写入注册表失败，可能被安全软件或组策略拦了" : "删除注册表项失败";
      logErr("[main] 开机自启设置没生效：" + why);
      return { ok: false, error: why };
    }
    return { ok: true, error: "" };
  } catch (e) {
    logErr("[main] 开机自启异常：" + ((e && e.message) || e));
    return { ok: false, error: String((e && e.message) || e) };
  }
}

// 设置页要显示「开关是开的，但注册表里没有」这种矛盾状态。
ipcMain.handle("autostart:status", async () => {
  const want = !!S.get("launchAtLogin");
  const st = await readAutostartReg();
  return { want, present: st.present, ok: want === st.present };
});

// ---------- 崩溃兜底 ----------
// 商业发行版不能「悄悄死掉、用户什么都看不到」。
// 主进程的任何未捕获异常 / 未处理 Promise 都落进 userData/crash/，
// 用户报「她自己没了」时，这是唯一能还原现场的东西。
// 这里同步写：异步写在进程被系统杀掉时可能一个字都落不下去，代价是单次 <1ms。
const CRASH_DIR = (() => {
  try { return path.join(app.getPath("userData"), "crash"); } catch (e) { return null; }
})();
let crashWrites = 0;

function recordCrash(kind, err) {
  const stack = err && err.stack ? String(err.stack) : String(err);
  try { logErr("[" + kind + "]", stack); } catch (e) { }
  if (!CRASH_DIR) return;
  // 同一个进程连续报错会刷屏（比如某个 33ms 定时器每次都抛），
  // 每轮最多留 5 份，超出的只计数 —— 别让程序自己的错误把自己的磁盘写满。
  if (crashWrites >= 5) return;
  crashWrites++;
  try {
    fs.mkdirSync(CRASH_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(CRASH_DIR, "crash-" + new Date().toISOString().replace(/[:.]/g, "-") + ".txt"),
      "kind=" + kind +
      "\ntime=" + new Date().toISOString() +
      "\nversion=" + app.getVersion() +
      "\nelectron=" + (process.versions.electron || "") +
      "\nplatform=" + process.platform + " " + process.arch +
      "\n\n" + stack + "\n",
      "utf8",
    );
    // 只留最近 20 份：崩溃日志是诊断材料，不是归档。
    const list = fs.readdirSync(CRASH_DIR)
      .filter((n) => n.startsWith("crash-") && n.endsWith(".txt")).sort();
    while (list.length > 20) {
      const victim = list.shift();
      try { fs.unlinkSync(path.join(CRASH_DIR, victim)); } catch (e) { }
    }
  } catch (e) { }
}

process.on("uncaughtException", (err) => recordCrash("uncaughtException", err));
process.on("unhandledRejection", (reason) => recordCrash("unhandledRejection", reason));

// 原生崩溃（C++ / GPU 层）走 Electron 自己的 minidump，只落本地不上传：
// 没有服务器可传，但用户机器上那份 dump 在排查驱动崩溃时不可替代。
try {
  crashReporter.start({ uploadToServer: false });
} catch (e) { }

// crashReporter 只负责写，不负责删：每崩一次就在 Crashpad/reports 留一个几百 KB 的 .dmp，
// 崩得多的话会一直涨（本机实测 72 个 / 38.3MB，而且没有任何上限）。
// 启动时清一遍：只留最近 10 个、总量不超过 20MB。
function pruneCrashDumps() {
  const dir = path.join(app.getPath("userData"), "Crashpad", "reports");
  let removed = 0;
  let kept = 0;
  let keptBytes = 0;
  try {
    if (!fs.existsSync(dir)) return;
    const files = [];
    for (const n of fs.readdirSync(dir)) {
      if (!n.toLowerCase().endsWith(".dmp")) continue;
      const p = path.join(dir, n);
      try {
        const st = fs.statSync(p);
        if (st.isFile()) files.push({ p: p, m: st.mtimeMs, s: st.size });
      } catch (e) { }
    }
    files.sort((a, b) => b.m - a.m); // 新的在前
    const MAX_FILES = 10;
    const MAX_BYTES = 20 * 1024 * 1024;
    for (const f of files) {
      if (kept < MAX_FILES && (keptBytes + f.s) <= MAX_BYTES) { kept++; keptBytes += f.s; continue; }
      try { fs.unlinkSync(f.p); removed++; } catch (e) { }
    }
  } catch (e) {
    logErr("[main] 清理崩溃转储失败: " + e);
    return;
  }
  if (removed) {
    log("[main] 清理旧崩溃转储 " + removed + " 个（保留 " + kept + " 个 / " + Math.round(keptBytes / 1024) + "KB）");
  }
}
pruneCrashDumps();

// Windows 的 AppUserModelID 决定任务栏分组、通知来源和跳转列表归属。
// 必须在 ready 之前设：第一次建窗口时系统已经按 exe 路径归过组了，之后再改不回来。
try { app.setAppUserModelId("com.dafeiyu.desk"); } catch (e) { }

// ---------- 窗口安全 ----------
// 这个应用只加载本地 http://127.0.0.1 页面。任何向外的导航和 window.open
// 都不是功能，而是漏洞面 —— 一个手滑的 <a href> 就能把挂件变成一台浏览器。
app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    log("[main] blocked window.open: " + url);
    return { action: "deny" };
  });
  contents.on("will-navigate", (event, url) => {
    let ok = false;
    try {
      const u = new URL(url);
      ok = u.protocol === "file:" ||
        ((u.protocol === "http:" || u.protocol === "https:") &&
          (u.hostname === "127.0.0.1" || u.hostname === "localhost"));
    } catch (e) { ok = false; }
    if (!ok) {
      log("[main] blocked navigation: " + url);
      event.preventDefault();
    }
  });
});

// ---------- 生命周期 ----------
const gotLock = app.requestSingleInstanceLock();
// 打包版没有控制台，console.log 等于扔进黑洞，所以这里落个文件。
// 排「启动后立刻退出、什么都不显示」时很有用，用户报「起不来」也让他发这个文件。
// 必须写 userData 不能写 resources —— 装到 Program Files 之后那里是只读的。
try {
  require("node:fs").writeFileSync(require("node:path").join(app.getPath("userData"), "last-boot.txt"),
    new Date().toISOString() +
    "\ngotLock=" + gotLock + "\npackaged=" + app.isPackaged +
    "\nexecPath=" + process.execPath + "\nresources=" + process.resourcesPath +
    "\nuserData=" + app.getPath("userData") + "\nargv=" + JSON.stringify(process.argv) + "\n",
    "utf8");
} catch (e) { }
if (!gotLock && !process.env.FISH_MULTI) {
  // FISH_MULTI=1 时允许再起一个实例，只给开发/自测用：
  // 打包版和开发版共用 userData，单实例锁会让第二个直接退出，测不了。
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!win || win.isDestroyed()) return;
    // 用户又双击了一次快捷方式 —— 这里必须给出可见回应，否则看起来就像「程序没反应」。
    // show() 不够：窗口可能被别的窗口盖着，或者在屏幕外（拔过显示器）。
    if (!win.isVisible()) win.show();
    win.focus();
    scheduleReflow();
  });
}

app.on("window-all-closed", (e) => { e.preventDefault(); });

// 启动看门狗：正常路径几秒内就有窗口。20 秒还什么都没有，说明启动链里某一步
// 静默失败了（典型是本地服务起不来）——那种情况用户看到的就是「双击没反应」。
// 与其留一个看不见的僵尸进程，不如给一张说明卡。
setTimeout(() => {
  try {
    const hasWin = (win && !win.isDestroyed()) || (settingsWin && !settingsWin.isDestroyed());
    const hasTray = !!(tray && typeof tray.isDestroyed === "function" && !tray.isDestroyed());
    if (hasWin || hasTray) return;
    logErr("[main] 启动 20 秒后仍无窗口也无托盘，判定启动失败");
    openStartupError(new Error("启动超时：20 秒内没有出现窗口"));
  } catch (e) { }
}, 20000);

app.whenReady().then(async () => {
  log("[boot] whenReady 入口");
  S = new Settings(app.getPath("userData"));
  log("[boot] Settings 就绪");
  // 锁屏 / 休眠时停渲染。powerMonitor 只能在 ready 之后用，而且人走开时
  // Cubism 的每帧开销一分不少，只有真的不画才省得下来。
  try {
    powerMonitor.on("lock-screen", () => { setPauseReason("lock", true); log("[main] 锁屏，暂停渲染"); });
    powerMonitor.on("unlock-screen", () => { setPauseReason("lock", false); log("[main] 解锁，恢复渲染"); });
    powerMonitor.on("suspend", () => { setPauseReason("suspend", true); log("[main] 系统休眠，暂停渲染"); });
    powerMonitor.on("resume", () => { setPauseReason("suspend", false); log("[main] 系统唤醒，恢复渲染"); });
  } catch (e) {
    logErr("[main] 挂 powerMonitor 失败: " + e);
  }
  // 设置文件读坏时 load() 会另存一份 .bad-<时间戳> 再用默认值启动，这里留一条能查的日志。
  if (S.lastLoadError) {
    logErr("[main] settings.json 读取失败，已备份到 " + (S.lastLoadError.backup || "（备份失败）") + "：" + S.lastLoadError.error);
  }
  applyStorageDirs();
  app.setName(APP_NAME);
  log("[boot] 存储目录与应用名就绪");

  // 模型适配器要在 app.setName 之后建：用户包的默认位置在 userData 下，
  // 而 userData 的目录名取决于 app 名。
  try {
    const { ModelAdapter } = require("./packs");
    ADAPTER = new ModelAdapter({
      root: RES_ROOT,
      // applyStorageDirs() 可能已经把模型目录挪到别的盘（设置里改过存储位置）
      userDir: process.env.FISH_MODEL_DIR || path.join(app.getPath("userData"), "models"),
      motionsFile: path.join(RES_ROOT, "src", "motions.js"),
      getSettings: () => S.get(),
      patchSettings: (p) => S.patch(p),
      log, logErr,
    });
    log("[main] 模型包目录 " + ADAPTER.userDir);
  } catch (e) {
    logErr("[main] 模型适配器初始化失败: " + (e && e.stack ? e.stack : e));
  }

  // 麦克风权限：默认是拒绝的，不显式放行 getUserMedia 会直接失败。
  // 只放行 media，别的权限（地理、通知、剪贴板）一律拒。
  try {
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === "media" || permission === "audioCapture");
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
      return permission === "media" || permission === "audioCapture";
    });
  } catch (e) {
    log("[main] permission handler failed: " + e);
  }

  try {
    await bootServer();
  } catch (e) {
    // 本地服务起不来（端口被占、被安全软件拦、文件缺失），后面 createWindow 一律没法显示页面。
    // 不接住的话就是一个「双击没反应」的僵尸进程：没有窗口、没有托盘、日志里只有一条 unhandledRejection。
    logErr("[main] 本地服务启动失败: " + (e && e.stack ? e.stack : e));
    try { if (!tray) makeTray(); } catch (x) { logErr("[main] 启动失败后建托盘也没成功: " + x); }
    try { openStartupError(e); } catch (x) { logErr("[main] 打开启动失败窗失败: " + x); }
    return;
  }
  log("[boot] 本地服务就绪，准备建窗口");
  createWindow();
  log("[boot] 窗口已创建");

  // 拔掉外接屏 / 改分辨率：把窗口拉回还亮着的那块屏，别让用户对着空气找她
  try {
    screen.on("display-removed", scheduleReflow);
    screen.on("display-added", scheduleReflow);
    screen.on("display-metrics-changed", scheduleReflow);
  } catch (e) {
    log("[main] 显示器事件注册失败: " + e);
  }

  makeTray();
  startDshWatcher();
  startRvcIdleWatch();
  applyLaunchAtLogin(S.get("launchAtLogin"));
  registerHotkey();
  scheduleUpdateCheck();

  // 首次运行引导：等模型把第一帧画出来再弹，别一开机就糊在脸上。
  // 老配置里没有 firstRun 字段时按「首次」处理——这个版本之前没人见过这张卡片。
  if (S.get("firstRun") !== false) {
    setTimeout(() => {
      try { openWelcome(); } catch (e) { log("[main] 引导窗打开失败: " + e); }
    }, 4200);
  }

  // 上次崩过就问一句。放 9 秒：让它排在引导卡和模型首帧之后，
  // 别一起挤在开机那几秒里，也别在用户正看着欢迎卡时糊一个系统弹窗上去。
  setTimeout(() => {
    try { checkLastCrash(); } catch (e) { log("[main] 崩溃检查失败: " + e); }
  }, 9000);

  // 上次选的是 RVC 的话，开机就把转换服务拉起来——不然第一句话要等它冷启动，
  // 那几秒会全压在第一句的延迟上，体感很差。
  if ((S.get().voiceOut || "tts") === "rvc") {
    setTimeout(() => { rvcStart().catch((e) => log("[main] RVC 自动启动失败: " + e)); }, 2500);
  }

  // 只用外部那一个桥（phone-bridge，默认 8899），不再自动拉起自带的迷你桥接。
  // 迷你桥接要求磁盘上有独立的 DSH bin.js，而这台机器是打包版（DSH 在 app.asar 里），
  // 它必然找不到 → 每次开机都报一句「没找到 DSH」，白起一个进程还占着 8898。
  miniFixBridgeUrl();
  if ((S.get().replyMode || "dsh") === "dsh") {
    setTimeout(() => {
      probeBridge()
        .then((ok) => log(ok ? "[main] 外部桥接已就绪：" + bridgeBase() : "[main] 外部桥接未响应，检查 phone-bridge 是否在跑"))
        .catch((e) => log("[main] 桥接探测失败: " + e));
    }, 3000);
  }

  // turbo 模型没随包发（1.6G 会让 NSIS 压不出来）。
  // 以前是启动 8 秒后直接静默下：用户装完什么都没干，硬盘先少 1.6G，而且关不掉。
  // 现在先问一句，选「以后再说」就不再弹，想下随时去设置 → 语音识别模型点「下载」。
  setTimeout(() => {
    const ask = async () => {
      try {
        const m = await engineAsr();
        const st = m.turboState ? m.turboState() : { present: false };
        if (st.present || S.get("turboAsked") === true) return;
        const parent = settingsWin && !settingsWin.isDestroyed() ? settingsWin : win;
        const r = await dialog.showMessageBox(parent, {
          type: "question",
          title: "语音识别模型",
          message: "语音识别模型还没下载（约 1.6G）。",
          detail: "不下也能用：语音输入会退回小模型，准确率低一些。\n" +
            "下载在后台进行，可以随时在「设置 → 语音识别模型」里暂停或继续，\n" +
            "也可以在那里改缓存位置（默认在系统用户目录）。",
          buttons: ["现在下载", "以后再说"],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        });
        S.patch({ turboAsked: true });
        if (r.response === 0) {
          log("[main] 用户同意下载 turbo（1.6G）");
          m.ensureTurbo(true);
        } else {
          log("[main] 用户暂不下载 turbo");
        }
      } catch (e) {
        log("[main] turbo 询问失败: " + e);
      }
    };
    // 首启的引导卡还没关，别把对话框叠上去。
    if (S.get("firstRun") !== false) setTimeout(ask, 30000);
    else ask();
  }, 8000);

  app.on("activate", () => { if (win === null) createWindow(); });

  // 自动化测试：模拟连续拖动滑块（1.0 → 1.8 → 1.0，每 50ms 一档）
  // 走的是与设置面板完全相同的 applySettings 路径。
  // FISH_TEST_ONCE=<数值>：改一次就停，用来验证「设置里输入一个数字」这条路径。
  if (process.env.FISH_TEST === "1" && process.env.FISH_TEST_ONCE) {
    const once = Math.max(0.5, Math.min(2.0, Number(process.env.FISH_TEST_ONCE) || 1));
    setTimeout(() => {
      const before = win.getBounds();
      log("[test] once before " + before.width + "x" + before.height);
      S.patch({ scale: once });
      applySettings({ scale: once });
      log("[test] once applied scale=" + once);
      setTimeout(() => {
        const b = win.getBounds();
        const d = currentDisplay();
        log("[test] once after " + b.width + "x" + b.height + " @" + b.x + "," + b.y +
          // 高度要带上输入条那 52px，否则这份"期望值"永远比实际小 52，
          // 回归脚本会一直报假失败。
          " expect=" + Math.round(BASE_W * once) + "x" + (Math.round(BASE_H * once) + DOCK_H) +
          " offsetR=" + (d.workArea.x + d.workArea.width - (b.x + b.width)) +
          " offsetB=" + (d.workArea.y + d.workArea.height - (b.y + b.height)));
      }, 900);
    }, 5000);
  }

  // FISH_TEST_SWEEP=0.8,1.6,1.0,1.4,1.2
  // 按顺序来回改大小，每档等 1.1 秒，专门复现「调整大小时模型被裁歪」。
  // 每档打印窗口尺寸 / canvas 物理尺寸 / 渲染侧 layout 参数，用来核对
  // fit 是否始终与窗口尺寸成线性——不成线性就说明取景跑偏了。
  if (process.env.FISH_TEST_SWEEP) {
    const steps = process.env.FISH_TEST_SWEEP.split(",")
      .map((x) => Math.max(0.5, Math.min(2.0, Number(x) || 1)))
      .filter((x) => Number.isFinite(x));
    setTimeout(() => {
      let i = 0;
      const next = () => {
        if (i >= steps.length) { log("[sweep] done"); return; }
        const v = steps[i++];
        S.patch({ scale: v });
        applySettings({ scale: v });
        setTimeout(() => {
          if (!win || win.isDestroyed()) return;
          const b = win.getBounds();
          const d = currentDisplay();
          log("[sweep] #" + i + " scale=" + v + " win=" + b.width + "x" + b.height +
            " offsetR=" + (d.workArea.x + d.workArea.width - (b.x + b.width)) +
            " offsetB=" + (d.workArea.y + d.workArea.height - (b.y + b.height)));
          next();
        }, 1100);
      };
      next();
    }, 6000);
  }

  // FISH_TEST_VOICE=<一句话>：跳过麦克风，把这句话直接走完
  // 「发送 → DSH 回复 → TTS 播放」，用来验证语音链路的后半段。
  if (process.env.FISH_TEST_VOICE) {
    const say = process.env.FISH_TEST_VOICE;
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      log("[test] voice say=" + say);
      win.webContents.send("fish-test-voice", say);
    }, 8000);
  }

  if (process.env.FISH_TEST === "1") {
    const to = Number(process.env.FISH_TEST_TO) || 1.0;
    setTimeout(async () => {
      const seq = [];
      for (let v = 1.0; v <= to + 1e-6; v += 0.02) seq.push(Math.round(v * 100) / 100);
      if (to < 1.0) {
        for (let v = 1.0; v >= to - 1e-6; v -= 0.02) seq.push(Math.round(v * 100) / 100);
      }
      log("[test] drag begin, " + seq.length + " steps, target=" + to);
      for (let i = 0; i < seq.length; i += 1) {
        await ipcMain.emit; // 保持同步节奏，不用额外依赖
        S.patch({ scale: seq[i] });
        applySettings({ scale: seq[i] });
        await new Promise((r) => setTimeout(r, 50));
      }
      log("[test] drag end");
      setTimeout(() => {
        const b = win.getBounds();
        const d = currentDisplay();
        log("[test] final scale=" + S.get().scale +
          " win=" + b.width + "x" + b.height +
          " @" + b.x + "," + b.y +
          " offsetR=" + (d.workArea.x + d.workArea.width - (b.x + b.width)) +
          " offsetB=" + (d.workArea.y + d.workArea.height - (b.y + b.height)));
        log("[test] DONE");
      }, 1200);
    }, 8000);
  }
});

app.on("before-quit", () => {
  if (cursorTimer) clearInterval(cursorTimer);
  if (watcherTimer) clearInterval(watcherTimer);
  if (rvcIdleTimer) clearInterval(rvcIdleTimer);
  // 先把没落盘的对话写掉，再开始拆服务（拆服务可能卡住，见下面的 3 秒兜底）。
  try { chatFlush(); } catch (e) { }
  if (server) server.close();
  // 大肥鱼一关，它拉起来的附属服务必须一起走。
  // 不然 RVC 的 python.exe 和桥接的 node.exe 会变成孤儿，下次启动还占着端口。
  try { rvcStop(); } catch (e) { }
  try { miniStop(); } catch (e) { }
  // 一键安装那个 python 会再拉 pip，裸 kill() 只杀它自己。
  try {
    if (rvcSetupProc && rvcSetupProc.pid) {
      require("node:child_process").execFileSync(
        "taskkill", ["/T", "/F", "/PID", String(rvcSetupProc.pid)], { stdio: "ignore" },
      );
    }
  } catch (e) { }

  // 清理里只要有一项卡住（比如 taskkill 等一个不肯死的 python 进程），
  // 用户看到的就是「点了退出，窗口没了，进程还在」——再点快捷方式也没反应（单实例锁）。
  // 给 3 秒宽限，还不走就直接结束：这时候优雅已经不重要了。
  if (!quitForceTimer) {
    quitForceTimer = setTimeout(() => {
      logErr("[main] 退出清理超过 3 秒，强制结束进程");
      app.exit(0);
    }, 3000);
    try { quitForceTimer.unref(); } catch (e) { }
  }
});

app.on("will-quit", () => {
  if (quitForceTimer) { clearTimeout(quitForceTimer); quitForceTimer = null; }
});
