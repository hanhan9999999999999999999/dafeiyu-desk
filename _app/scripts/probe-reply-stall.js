"use strict";
// round 26：等她回复这段，半截 / 一个字都没有 / 基线读不到，用户能不能知道
// 用法：node scripts/probe-reply-stall.js [--keep]
const fs = require("fs");
const { makeTmp } = require("./lib/tmp");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { sampleFrom, findTarget } = require("./lib/cdp");

const APP = path.resolve(__dirname, "..");
const EXE = path.join(APP, "runtime", "electron.exe");
const PORT = Number(process.argv.find((a) => /^--port=/.test(a))?.slice(7)) || 9311;
const KEEP = process.argv.includes("--keep");

const results = [];
const ok = (n, c, d) => { results.push({ n, c: !!c, d }); console.log((c ? "✅ " : "❌ ") + n + (d ? "  " + d : "")); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cleanEnv(extra) {
  const e = Object.assign({}, process.env, extra || {});
  delete e.ELECTRON_RUN_AS_NODE;
  delete e.CHROME_CRASHPAD_PIPE_NAME;
  delete e.ELECTRON_NO_ATTACH_CONSOLE;
  return e;
}

async function waitReady(port, ms = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await sampleFrom(port, (x) => x && x.type === "page" && /\/src\/index\.html/.test(x.url), `
        JSON.stringify((function () {
          const d = typeof window.__fishDebug === "function" ? window.__fishDebug() : null;
          return {
            s: document.readyState,
            model: !!(d && d.model),
            hasVoice: !!(window.FishVoice && typeof window.FishVoice.__waitReply === "function"),
            hasSay: !!window.FishSay,
          };
        })())
      `, 6000);
      if (r && r.s === "complete" && r.model && r.hasVoice && r.hasSay) return true;
    } catch (e) { }
    await sleep(400);
  }
  return false;
}

// 把 /api/state 换成可控的假响应；/api/send、/api/token 直接给成功。
const ARM = (mode, timeoutMs, oldAt) => `
JSON.stringify((function () {
  window.__said = [];
  const realSay = window.FishSay;
  window.FishSay = function (t) { try { window.__said.push(String(t)); } catch (e) { } };
  window.__fishReplyTimeoutMs = ${timeoutMs};
  const REAL_FETCH = window.fetch;
  const stateCalls = [];
  window.fetch = function (u, o) {
    const url = String(u && u.url ? u.url : u);
    if (url.indexOf("/api/health") >= 0) {
      // getToken() 打的就是这个：从 addresses[0].urlFull 里抠 ?t=
      return Promise.resolve(new Response(JSON.stringify({ app: "dsh-phone-bridge", addresses: [{ urlFull: "http://127.0.0.1:8899/?t=probe-token" }] }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    if (url.indexOf("/api/state") >= 0) {
      stateCalls.push(Date.now());
      let body;
      if (window.__probeMode === "partial") {
        body = { messages: [{ role: "assistant", id: "probe-1", at: Date.now(), text: "她说到一半就停了", completed: false }] };
      } else if (window.__probeMode === "stalled") {
        body = { messages: [] };
      } else if (window.__probeMode === "stale") {
        // 一条五分钟前的旧消息：基线读不到时绝不能把它当新回复
        body = { messages: [{ role: "assistant", id: "old-1", at: ${oldAt}, text: "这是五分钟前的旧话", completed: true }] };
      } else {
        body = { messages: [] };
      }
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }));
    }
    if (url.indexOf("/api/send") >= 0) {
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    if (url.indexOf("/api/token") >= 0) {
      return Promise.resolve(new Response(JSON.stringify({ token: "probe-token" }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    return REAL_FETCH.apply(window, arguments);
  };
  window.__probeMode = ${JSON.stringify(mode)};
  return { ok: true, mode: window.__probeMode, timeout: ${timeoutMs} };
})())
`;

const RUN = `
(async function () {
  const out = { started: Date.now() };
  try {
    await window.FishVoice.__waitReply("这是一句测试的提问");
    out.ok = true;
  } catch (e) {
    out.ok = false;
    out.error = String((e && e.message) || e);
  }
  out.ms = Date.now() - out.started;
  const iss = window.FishVoice.replyIssue ? window.FishVoice.replyIssue() : "no-api";
  out.issue = iss;
  out.said = window.__said ? window.__said.slice() : [];
  return JSON.stringify(out);
})()
`;

(async () => {
  const userData = makeTmp("dfy-stall-");
  const child = spawn(EXE, ["--remote-debugging-port=" + PORT, "--user-data-dir=" + userData, "."], {
    cwd: APP,
    env: cleanEnv({ FISH_MULTI: "1", FISH_TEST_HIDDEN: "1" }),
    stdio: "ignore",
  });

  try {
    if (!await waitReady(PORT)) throw new Error("页面没就绪");
    console.log("页面就绪，端口 " + PORT);

    // ---- A 半截 ----
    const oldAt = Date.now() - 5 * 60 * 1000;
    await sampleFrom(PORT, (x) => x && x.type === "page" && /\/src\/index\.html/.test(x.url), ARM("partial", 2500, oldAt), 8000);
    let r = await sampleFrom(PORT, (x) => x && x.type === "page" && /\/src\/index\.html/.test(x.url), RUN, 30000);
    ok("半截也不算异常（不会抛错）", r && r.ok === true, r && r.error);
    ok("半截会被记成 partial", r && r.issue && r.issue.code === "partial", JSON.stringify(r && r.issue));
    ok("半截记下半截的字数", r && r.issue && r.issue.chars > 0, r && r.issue && String(r.issue.chars));
    ok("半截会补一句「没说完」", r && r.said.some((s) => s.indexOf("没说完") >= 0), JSON.stringify(r && r.said));
    ok("那句里写了等了多久", r && r.said.some((s) => /等了\s*\d+\s*秒/.test(s)), JSON.stringify(r && r.said));

    // ---- B 一个字都没有 ----
    await sampleFrom(PORT, (x) => x && x.type === "page" && /\/src\/index\.html/.test(x.url), ARM("stalled", 2500, oldAt), 8000);
    r = await sampleFrom(PORT, (x) => x && x.type === "page" && /\/src\/index\.html/.test(x.url), RUN, 30000);
    ok("完全没有回复会被记成 stalled", r && r.issue && r.issue.code === "stalled", JSON.stringify(r && r.issue));
    ok("完全没有回复时会说话（不再依赖台词库）", r && r.said.some((s) => s.indexOf("还没回我") >= 0), JSON.stringify(r && r.said));
    ok("那句话说明了等多久", r && r.said.some((s) => /等了\s*\d+\s*秒/.test(s)), JSON.stringify(r && r.said));

    // ---- C 基线读不到时，旧消息不许当成新回复 ----
    const armC = `
      JSON.stringify((function () {
        window.__said = [];
        window.FishSay = function (t) { try { window.__said.push(String(t)); } catch (e) { } };
        window.__fishReplyTimeoutMs = 2500;
        const REAL_FETCH = window.fetch;
        let first = true;
        window.fetch = function (u) {
          const url = String(u && u.url ? u.url : u);
    if (url.indexOf("/api/health") >= 0) {
      // getToken() 打的就是这个：从 addresses[0].urlFull 里抠 ?t=
      return Promise.resolve(new Response(JSON.stringify({ app: "dsh-phone-bridge", addresses: [{ urlFull: "http://127.0.0.1:8899/?t=probe-token" }] }), { status: 200, headers: { "content-type": "application/json" } }));
    }
          if (url.indexOf("/api/state") >= 0) {
            if (first) { first = false; return Promise.reject(new Error("probe: state down")); }
            return Promise.resolve(new Response(JSON.stringify({ messages: [{ role: "assistant", id: "old-1", at: ${oldAt}, text: "这是五分钟前的旧话", completed: true }] }), { status: 200, headers: { "content-type": "application/json" } }));
          }
          if (url.indexOf("/api/token") >= 0) return Promise.resolve(new Response(JSON.stringify({ token: "probe-token" }), { status: 200 }));
          return REAL_FETCH.apply(window, arguments);
        };
        return { ok: true };
      })())
    `;
    await sampleFrom(PORT, (x) => x && x.type === "page" && /\/src\/index\.html/.test(x.url), armC, 8000);
    r = await sampleFrom(PORT, (x) => x && x.type === "page" && /\/src\/index\.html/.test(x.url), RUN, 30000);
    ok("基线读不到时不会把五分钟前的旧话当回复", r && r.issue && r.issue.code === "stalled", JSON.stringify(r && r.issue));
    ok("基线读不到时也没有半截", r && r.issue && r.issue.code !== "partial", JSON.stringify(r && r.issue));

    // ---- D 正常收到：不该留 state ----
    const armD = `
      JSON.stringify((function () {
        window.__said = [];
        window.FishSay = function (t) { window.__said.push(String(t)); };
        window.__fishReplyTimeoutMs = 3000;
        const REAL_FETCH = window.fetch;
        window.fetch = function (u) {
          const url = String(u && u.url ? u.url : u);
    if (url.indexOf("/api/health") >= 0) {
      // getToken() 打的就是这个：从 addresses[0].urlFull 里抠 ?t=
      return Promise.resolve(new Response(JSON.stringify({ app: "dsh-phone-bridge", addresses: [{ urlFull: "http://127.0.0.1:8899/?t=probe-token" }] }), { status: 200, headers: { "content-type": "application/json" } }));
    }
          if (url.indexOf("/api/state") >= 0) {
            return Promise.resolve(new Response(JSON.stringify({ messages: [{ role: "assistant", id: "new-1", at: Date.now(), text: "这是一句正常的回复。", completed: true, streaming: false }] }), { status: 200, headers: { "content-type": "application/json" } }));
          }
          if (url.indexOf("/api/token") >= 0) return Promise.resolve(new Response(JSON.stringify({ token: "probe-token" }), { status: 200 }));
          return REAL_FETCH.apply(window, arguments);
        };
        return { ok: true };
      })())
    `;
    await sampleFrom(PORT, (x) => x && x.type === "page" && /\/src\/index\.html/.test(x.url), armD, 8000);
    r = await sampleFrom(PORT, (x) => x && x.type === "page" && /\/src\/index\.html/.test(x.url), RUN, 30000);
    ok("正常收到回复时不留问题标记", r && r.issue === null, JSON.stringify(r && r.issue));
    ok("正常收到时她说了那句话", r && r.said.some((s) => s.indexOf("正常的回复") >= 0), JSON.stringify(r && r.said));

    const pass = results.filter((x) => x.c).length;
    console.log("\n结果：" + pass + " 通过，" + (results.length - pass) + " 失败");
    if (!KEEP) {
      try { child.kill(); } catch (e) { }
      await sleep(600);
      try { fs.rmSync(userData, { recursive: true, force: true }); } catch (e) { }
    }
    process.exit(pass === results.length ? 0 : 1);
  } catch (e) {
    console.error("探针失败：" + (e && e.message ? e.message : e));
    try { child.kill(); } catch (e2) { }
    process.exit(2);
  }
})();
