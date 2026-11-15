"use strict";
/**
 * 语音输出侧探针：她说不出来的时候，会不会告诉用户一声。
 *
 * 为什么需要它：`speak()` 有五级降级链（飞鱼 → 分段流式 → RVC → 内置引擎 → DSH），
 * 每一级失败只 log 一句往下试，全挂时 `return false` —— 不抛错。调用方以前
 * 只 catch 不查返回值，于是「她一声不吭」永远走不到界面上。
 *
 * 这个探针不打桩内部函数，而是：
 *   1. 替换 `window.fetch`，让所有语音端点都失败（模拟引擎挂了）；
 *   2. 替换 `window.FishSay`，把她说的话记下来；
 *   3. 调真实的 `__finishReply()`（收到回复的入口）；
 *   4. 检查：返回值/错误码对、气泡里有一句人话、静音时不吵人。
 *
 * 用法：node scripts/probe-voice-out.js [--keep] [--port 9309]
 */
const { spawn } = require("child_process");
const fs = require("fs");
const { makeTmp } = require("./lib/tmp");
const os = require("os");
const path = require("path");
const { sampleFrom, findTarget } = require("./lib/cdp");

const APP = path.resolve(__dirname, "..");
const EXE = path.join(APP, "runtime", "electron.exe");
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const PORT = Number(arg("--port", "9309"));
const KEEP = argv.includes("--keep");
const USER_DATA = makeTmp("dfy-voiceout-");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log("  ✅ " + name + (extra ? "  " + extra : "")); }
  else { fail += 1; console.log("  ❌ " + name + (extra ? "  " + extra : "")); }
}

function cleanEnv() {
  const env = Object.assign({}, process.env, { FISH_MULTI: "1", FISH_TEST_HIDDEN: "1" });
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CHROME_CRASHPAD_PIPE_NAME;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return env;
}

const PAGE_PICK = (t) => t && t.type === "page" && /\/src\/index\.html/.test(t.url || "");

async function waitReady(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await sampleFrom(PORT, PAGE_PICK, "JSON.stringify({s:document.readyState,m:!!(window.__fishDebug&&window.__fishDebug().model),v:typeof (window.FishVoice&&window.FishVoice.speak),e:typeof (window.__fishVoiceErr&&window.__fishVoiceErr.voiceErrText)})", 4000);
      if (r && r.s === "complete" && r.m && r.v === "function" && r.e === "function") return r;
    } catch (e) { }
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

// 让所有语音端点都失败，并把她说的话记进 window.__said
const ARM = `(() => {
  if (window.__armed) return JSON.stringify({ ok: true, again: true });
  window.__armed = true;
  const realFetch = window.fetch.bind(window);
  let failed = [];
  window.fetch = function (u, o) {
    let s = "";
    try { s = typeof u === "string" ? u : (u && u.url) || ""; } catch (e) { }
    if (/\\/engine\\/tts|\\/engine\\/rvc|\\/api\\/tts|\\/engine\\/warm|\\/engine\\/unload/.test(s)) {
      failed.push(s);
      return Promise.resolve(new Response("engine probe: down", { status: 503 }));
    }
    return realFetch(u, o);
  };
  window.__said = [];
  const realSay = window.FishSay;
  window.FishSay = function (t, m, d) {
    window.__said.push(String(t || ""));
    try { if (realSay) return realSay.call(window, t, m, d); } catch (e) { }
  };
  window.__probeFailed = failed;
  return JSON.stringify({ ok: true });
})()`;

const RUN_FINISH = `(async () => {
  window.__said = [];
  const t0 = Date.now();
  try {
    await window.FishVoice.__finishReply("这是一句测试的回复，用来看看她说不出声时会不会讲原因。");
  } catch (e) { window.__finishErr = String((e && e.message) || e); }
  const err = window.FishVoice.speakError();
  return JSON.stringify({
    ms: Date.now() - t0,
    said: window.__said.slice(),
    err: err ? { code: err.code, short: err.short, detail: err.detail } : null,
    failErr: window.__finishErr || null,
    endpoints: (window.__probeFailed || []).slice(0, 6),
  });
})()`;

(async function main() {
  console.log("[probe] 启动 " + EXE);
  const child = spawn(EXE, ["--remote-debugging-port=" + String(PORT), "--user-data-dir=" + USER_DATA, "."], {
    cwd: APP, env: cleanEnv(), stdio: "ignore",
  });

  let hardFail = true;
  try {
    const ready = await waitReady(60000);
    if (!ready) throw new Error("页面没就绪（60 秒）");
    console.log("[probe] 页面就绪 " + JSON.stringify(ready));

    const armed = await sampleFrom(PORT, PAGE_PICK, ARM, 8000);
    ok("能拦住所有语音端点（模拟引擎全挂）", armed && armed.ok === true, JSON.stringify(armed));

    const r = await sampleFrom(PORT, PAGE_PICK, RUN_FINISH, 60000);
    ok("收到回复时不会抛错（失败要自己消化掉）", r && !r.failErr, r && r.failErr ? r.failErr : "");
    ok("确实试过语音端点（说明不是空跑）", r && r.endpoints && r.endpoints.length > 0,
      r && r.endpoints ? r.endpoints.join(" ") : "");

    ok("整条链失败后记下了原因", r && r.err && r.err.code, r && r.err ? r.err.code : "null");
    ok("原因归到 engine（第一处失败是内置引擎）", r && r.err && r.err.code === "engine");
    ok("那句原因写了下一步做什么", r && r.err && /设置|重装|日志|看看|关掉/.test(r.err.detail || ""),
      r && r.err ? r.err.detail : "");

    const said = (r && r.said) || [];
    ok("她说过话（正文 + 失败提示）", said.length >= 2, String(said.length));
    ok("正文照常弹了气泡", said.some((s) => /这是一句测试的回复/.test(s)));
    ok("失败时她说了一句人话，而不是沉默", said.some((s) => /说不出话|没起来|坏/.test(s)),
      said.join(" | ").slice(0, 90));
    ok("失败提示不是技术报错原文", !said.some((s) => /HTTP 503|Failed to fetch/.test(s)));

    // 静音时不该吵人
    const quiet = await sampleFrom(PORT, PAGE_PICK, `(async () => {
      window.FishVoice.setMuted(true);
      try { window.FishVoice.clearSpeakError(); } catch (e) { }
      window.__said = [];
      try { await window.FishVoice.__finishReply("静音时的这一句不该念叨原因。"); } catch (e) { }
      const said = window.__said.slice();
      window.FishVoice.setMuted(false);
      return JSON.stringify({ said: said });
    })()`, 30000);
    ok("静音时不弹失败提示（用户自己关的声音）",
      quiet && !quiet.said.some((s) => /说不出话|没起来|坏/.test(s)),
      quiet ? quiet.said.join(" | ").slice(0, 60) : "");

    hardFail = false;
  } catch (e) {
    console.log("  ❌ " + (e && e.message ? e.message : e));
    fail += 1;
  } finally {
    console.log("[probe] 收尾");
    try { child.kill(); } catch (e) { }
    try {
      require("child_process").execSync('taskkill /PID ' + child.pid + ' /T /F', { stdio: "ignore" });
    } catch (e) { }
    if (!KEEP) {
      try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch (e) { }
    } else {
      console.log("[probe] userData 保留在 " + USER_DATA);
    }
  }

  console.log("");
  console.log("结果：" + pass + " 通过，" + fail + " 失败");
  process.exit(fail || hardFail ? 1 : 0);
})();
