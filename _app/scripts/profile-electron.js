"use strict";
/**
 * 渲染进程 CPU 采样：跑起来、等它进入空闲档，然后采 10 秒 V8 CPU profile，
 * 按函数聚合自身耗时，输出热点表。定位「挂件空转很高」这类问题时先用它，别靠猜。
 *
 * 用法：
 *   node scripts/profile-electron.js                 # 采 10 秒
 *   node scripts/profile-electron.js --warm 25 --span 12
 *   node scripts/profile-electron.js --port 9232
 */
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..");
const EXE = path.join(ROOT, "runtime", "electron.exe");
const argv = process.argv.slice(2);
function opt(name, dflt) {
  const i = argv.indexOf("--" + name);
  if (i < 0) return dflt;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : dflt;
}
const PORT = Number(opt("port", 9232)) || 9232;
const WARM_MS = (Number(opt("warm", 25)) || 25) * 1000;
const SPAN_MS = (Number(opt("span", 10)) || 10) * 1000;
// --main：采主进程（Node inspector）。默认采渲染进程（页面 CDP）。
const MAIN = argv.includes("--main");

function killTree(pid) {
  if (!pid) return;
  try {
    spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  } catch (e) {
    /* ignore */
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
    }
  });
  const ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("CDP 握手超时")), 8000);
    ws.addEventListener("open", () => { clearTimeout(t); resolve(); });
    ws.addEventListener("error", () => { clearTimeout(t); reject(new Error("CDP 连接失败")); });
  });
  function send(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      const timer = setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(method + " 超时"));
      }, 30000);
      try {
        ws.send(JSON.stringify({ id, method, params: params || {} }));
      } catch (e) {
        clearTimeout(timer);
        pending.delete(id);
        reject(e);
      }
    });
  }
  return { ready, send, close: () => { try { ws.close(); } catch (e) { } } };
}

function summarize(profile) {
  const nodes = profile.nodes || [];
  const byId = new Map();
  for (const n of nodes) byId.set(n.id, n);
  // samples 是采样到的 node id 序列，按出现次数当作自身耗时（approximate self time）
  const hits = new Map();
  for (const [i, s] of (profile.samples || []).entries()) {
    hits.set(s, (hits.get(s) || 0) + 1);
  }
  const rows = [];
  for (const [id, count] of hits) {
    const n = byId.get(id);
    if (!n) continue;
    const cf = n.callFrame || {};
    const url = String(cf.url || "");
    const name = cf.functionName || "(anonymous)";
    const file = url ? url.split("/").pop() : "(native)";
    rows.push({
      count,
      key: name + "  ·  " + file + (cf.lineNumber >= 0 ? ":" + (cf.lineNumber + 1) : ""),
    });
  }
  rows.sort((a, b) => b.count - a.count);
  const total = (profile.samples || []).length || 1;
  return { rows, total };
}

(async () => {
  if (!fs.existsSync(EXE)) {
    console.error("找不到 Electron 运行时：" + EXE);
    process.exit(2);
  }
  const env = Object.assign({}, process.env);
  for (const k of ["ELECTRON_RUN_AS_NODE", "CHROME_CRASHPAD_PIPE_NAME", "ELECTRON_NO_ATTACH_CONSOLE"]) delete env[k];

  console.log("[prof] 启动 (CDP " + PORT + (MAIN ? "，主进程" : "，渲染进程") + ")");
  const child = spawn(EXE, [MAIN ? "--inspect=" + PORT : "--remote-debugging-port=" + PORT, "."], {
    cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: false,
  });
  child.stderr.on("data", () => { });

  const page = await new Promise((resolve) => {
    const deadline = Date.now() + 25000;
    (async function tick() {
      const ts = await listTargets();
      const hit = MAIN
        ? ts.find((t) => t && t.webSocketDebuggerUrl)
        : ts.find((t) => t && t.type === "page" && /index\.html/i.test(String(t.url || "")));
      if (hit && hit.webSocketDebuggerUrl) return resolve(hit);
      if (Date.now() > deadline) return resolve(null);
      setTimeout(tick, 400);
    })();
  });
  if (!page) {
    console.error("[prof] 连不上调试端口");
    killTree(child.pid);
    process.exit(2);
  }

  const cdp = connect(page.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send("Profiler.enable").catch(() => { });
  await cdp.send("Profiler.setSamplingInterval", { interval: 1000 }).catch(() => { });

  console.log("[prof] 预热 " + WARM_MS / 1000 + " 秒（等它进入空闲档）…");
  await new Promise((r) => setTimeout(r, WARM_MS));

  const st = await cdp.send("Runtime.evaluate", {
    expression: "JSON.stringify(window.__fishDebug ? window.__fishDebug() : null)",
    returnByValue: true,
  }).catch(() => null);
  const stateRaw = st && st.result && st.result.result && st.result.result.value;
  console.log("[prof] 采样前状态：" + (stateRaw || "取不到"));

  console.log("[prof] 采样 " + SPAN_MS / 1000 + " 秒…");
  await cdp.send("Profiler.start");
  await new Promise((r) => setTimeout(r, SPAN_MS));
  const res = await cdp.send("Profiler.stop");
  const profile = (res && res.result && res.result.profile) || null;

  cdp.close();
  killTree(child.pid);

  if (!profile) {
    console.error("[prof] 没拿到 profile");
    process.exit(2);
  }
  const { rows, total } = summarize(profile);
  console.log("");
  console.log("========== 热点（自身耗时占比，采样 " + total + " 次）==========");
  for (const r of rows.slice(0, 25)) {
    const pct = ((r.count / total) * 100).toFixed(1);
    console.log(String(pct).padStart(5) + "%  " + r.key);
  }
  console.log("=========================================================");
  process.exit(0);
})().catch((e) => {
  console.error("[prof] 崩了：" + ((e && e.stack) || e));
  process.exit(2);
});
