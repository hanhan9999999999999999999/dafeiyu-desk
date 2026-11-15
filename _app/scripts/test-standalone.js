"use strict";
// 独立完整性自检（1.5.0）
// 回答一个问题：「这台机器上没有别人的东西，用户双击就能用吗」。
// 四组：
//   ① 随包文件齐不齐（少一个就等于装完打不开）
//   ② 没有外部桥时，自带迷你桥能不能自己起来、答 /api/health、/api/state
//   ③ 桥接自愈的代码在不在（开机自检 / 90 秒巡看 / 进程死了重拉 / 地址改指 / 一键修复入口）
//   ④ 语音回落是不是「会说出来」，而不是只写一行日志
// 用法：node scripts/test-standalone.js     全部通过 exit 0，否则 1

const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const checks = [];
const add = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail === undefined ? "" : String(detail) });

function read(p) {
  try { return fs.readFileSync(path.join(ROOT, p), "utf8"); } catch (e) { return ""; }
}
function size(p) {
  try { return fs.statSync(path.join(ROOT, p)).size; } catch (e) { return -1; }
}

// ── ① 随包文件 ──────────────────────────────────────────────────────
// 只查「缺了就一定打不开 / 一定没声音」的那些，不追求列全。
const REQUIRED = [
  ["package.json", 500],
  ["src/main.js", 100000],
  ["src/preload.js", 2000],
  ["src/renderer.js", 100000],
  ["src/settings.html", 30000],
  ["src/settings-renderer.js", 60000],
  ["src/settings.js", 8000],
  ["src/server.js", 15000],
  ["src/voice.js", 50000],
  ["src/lines.js", 5000],
  ["src/tray-menu.js", 500],
  ["bridge/mini-bridge.mjs", 8000],
  ["engine/tts.mjs", 1000],
  ["engine/feiyu.mjs", 5000],
  ["engine/feiyu_server.py", 1000],
];
for (const [p, min] of REQUIRED) {
  const s = size(p);
  add("随包文件 " + p, s >= min, s < 0 ? "缺失" : s + " 字节（要 ≥ " + min + "）");
}

// 模型不随包发，但「没有模型也要能启动」这件事由别的用例保证；这里只看 assets 在不在。
add("assets 目录在（参考音频/图标都在里面）", fs.existsSync(path.join(ROOT, "assets")) === true);
const refDir = path.join(ROOT, "assets", "refvoice");
add("自带参考音频目录在（飞鱼没装也能用内置 TTS 说话，但声线素材要随包）",
  fs.existsSync(refDir), refDir);

// package.json 的自洽：main 指的文件真的在；version 是 1.x
const pkgRaw = read("package.json");
let pkg = {};
try { pkg = JSON.parse(pkgRaw); } catch (e) { }
add("package.json 能解析", !!pkg.name, pkg.name || "解析失败");
add("package.json 的 main 指向真实文件", !!pkg.main && size(pkg.main) > 1000, pkg.main || "(空)");
add("版本号形如 x.y.z", /^\d+\.\d+\.\d+$/.test(String(pkg.version || "")), pkg.version || "(空)");
add("运行时不依赖第三方包（除非打进 electron）",
  Object.keys(pkg.dependencies || {}).length === 0,
  "dependencies: " + Object.keys(pkg.dependencies || {}).join(",") || "(空)");

// ── ② 自带桥接自己起得来 ────────────────────────────────────────────
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

function waitHealth(url, ms) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const tick = async () => {
      try {
        const r = await fetch(url + "/api/health", { cache: "no-store" });
        if (r && r.ok) return resolve(await r.json());
      } catch (e) { }
      if (Date.now() - t0 > ms) return resolve(null);
      setTimeout(tick, 250);
    };
    tick();
  });
}

async function testBridge() {
  const port = await freePort();
  const script = path.join(ROOT, "bridge", "mini-bridge.mjs");
  const env = { ...process.env, FISH_BRIDGE_PORT: String(port) };
  delete env.ELECTRON_RUN_AS_NODE;      // 这里用真 node 跑，别让 electron 的变量干扰
  const child = spawn(process.execPath, [script, "--port", String(port)], {
    cwd: path.dirname(script),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let out = "";
  child.stdout.on("data", (d) => { out += String(d); });
  child.stderr.on("data", (d) => { out += String(d); });
  try {
    const base = "http://127.0.0.1:" + port;
    const h = await waitHealth(base, 12000);
    add("没有外部桥时，自带桥能起来并答 /api/health", !!h, h ? "port " + port : out.trim().slice(-200) || "12 秒没答话");
    if (h) {
      add("自带桥报告的身份对（客户端靠这个字段判断对面是不是桥）", h.app === "dsh-phone-bridge", h.app);
      add("自带桥标了 mini=true（前端据此区分 phone-bridge）", h.mini === true, h.mini);
      add("自带桥给了令牌（语音/发消息都要它）", String(h.token || "").length >= 16, (h.token || "").length + " 位");
      add("自带桥带了本机地址列表（手机连接页要显示）", Array.isArray(h.addresses), JSON.stringify(h.addresses || null).slice(0, 80));
      // 空文本要 400，不能 200 假装收到了
      let code = 0;
      try {
        const r = await fetch(base + "/api/send", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "  " }),
        });
        code = r.status;
      } catch (e) { code = -1; }
      add("空消息被拒（400），不会假装排进队列", code === 400, "HTTP " + code);
      let st = null;
      try {
        const r = await fetch(base + "/api/state", { cache: "no-store" });
        st = await r.json();
      } catch (e) { }
      add("/api/state 能读出状态（前端靠它轮询回复）", !!st && typeof st === "object", JSON.stringify(st || null).slice(0, 100));
    }
  } finally {
    // 收干净再退：kill 之后立刻 process.exit 会让 libuv 报
    // "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"。
    try { child.stdout.destroy(); } catch (e) { }
    try { child.stderr.destroy(); } catch (e) { }
    try { child.kill(); } catch (e) { }
    await new Promise((r) => {
      const t = setTimeout(r, 1500);
      child.once("exit", () => { clearTimeout(t); r(); });
    });
  }
}

// ── ③ 桥接自愈的代码在不在 ──────────────────────────────────────────
function testSelfHeal() {
  const main = read("src/main.js");
  const pre = read("src/preload.js");
  add("有 bridgeEnsure（一键把「能说话」这条路弄通）", /async function bridgeEnsure\(/.test(main));
  add("开机就走 bridgeEnsure，不再只探一次", /bridgeEnsure\(\)\s*\n?\s*\.then/.test(main));
  add("有 90 秒巡检（桥被安全软件带走后能自己回来）",
    /bridgeWatchTimer = setInterval\(/.test(main) && /90 \* 1000/.test(main));
  add("桥进程退出会安排重拉", /miniScheduleRestart\("exit code=/.test(main));
  add("重拉有退避，不会把 CPU 烧掉", /MINI_BACKOFF/.test(main) && /miniRestartStamps/.test(main));
  add("只在 bridgeUrl 是本机地址时才改指自带桥（远端配置不动）",
    /isLoopbackUrl/.test(main) && /桥接地址不是本机/.test(main));
  add("退出时不再重拉（appQuitting）", /appQuitting = true/.test(main));
  add("preload 暴露了 bridgeEnsure", /bridgeEnsure:\s*\(opt\)/.test(pre));
  add("IPC 注册了 bridge:ensure", /ipcMain\.handle\("bridge:ensure"/.test(main));
}

// ── ④ 语音回落要说出来 ──────────────────────────────────────────────
function testFallbackHonesty() {
  const server = read("src/server.js");
  const voice = read("src/voice.js");
  add("服务端把「换了谁」写进响应（fellBack）", /fellBack/.test(server) && /fallbackFrom/.test(server));
  add("飞鱼环境不全时说明缺什么", /missingParts\(/.test(server));
  add("前端会把回落说出来（不是只写日志）", /function noteFallback\(/.test(voice) && /FishSay\(/.test(voice));
  add("回落提示有节流（不会每句都念一遍）", /FALLBACK_QUIET_MS/.test(voice));
  add("回落同时进故障报告（诊断页能看到）", /reportFault\("voice-fallback"/.test(voice));
  add("三条出声路径都记回落（speakLocal / speakRvc / synthChunk）",
    /noteFallback\(j, "speakLocal"\)/.test(voice) &&
    /noteFallback\(j, "speakRvc"\)/.test(voice) &&
    /noteFallback\(j, "synthChunk"\)/.test(voice));
}

// ── 跑 ──────────────────────────────────────────────────────────────
(async () => {
  testSelfHeal();
  testFallbackHonesty();
  await testBridge();
  let fail = 0;
  for (const c of checks) {
    if (!c.ok) fail += 1;
    console.log((c.ok ? "  ✅ " : "  ❌ ") + c.name + (c.detail ? " → " + c.detail : ""));
  }
  console.log("\n结果：" + (checks.length - fail) + " 通过 " + fail + " 失败");
  // 不显式 process.exit：子进程 stdio 和 fetch 连接还在收尾，硬退会让 libuv 报
  // "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"。
  // 设 exitCode 让它自然退出；万一有句柄挂着，3 秒兜底再退。
  process.exitCode = fail ? 1 : 0;
  const guard = setTimeout(() => process.exit(fail ? 1 : 0), 3000);
  guard.unref();
})().catch((e) => {
  console.error("自检崩了：" + (e && e.stack || e));
  process.exit(1);
});
