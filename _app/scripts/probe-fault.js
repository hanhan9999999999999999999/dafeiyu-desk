"use strict";
// round 30：故障记录 —— 用户报「刚才不行，重启了」时，诊断包里还有没有现场
// 用法：node scripts/probe-fault.js [--keep]
const fs = require("fs");
const { makeTmp } = require("./lib/tmp");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const { sampleFrom } = require("./lib/cdp");

const APP = path.resolve(__dirname, "..");
const EXE = path.join(APP, "runtime", "electron.exe");
const PORT = Number(process.argv.find((a) => /^--port=/.test(a))?.slice(7)) || 9315;
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

const PAGE = (x) => x && x.type === "page" && /\/src\/index\.html/.test(x.url);

function killTree(pid) {
  try { execFileSync("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore" }); } catch (e) { }
}

async function waitReady(ms = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await sampleFrom(PORT, PAGE, `
        JSON.stringify((function () {
          const d = typeof window.__fishDebug === "function" ? window.__fishDebug() : null;
          const df = window.deskfish || {};
          return {
            s: document.readyState,
            model: !!(d && d.model),
            canReport: typeof df.reportFault === "function",
            canList: typeof df.faultList === "function",
            canDiagTo: typeof df.diagExportTo === "function",
            canFinish: !!(window.FishVoice && typeof window.FishVoice.__finishReply === "function"),
          };
        })())
      `, 6000);
      if (r && r.s === "complete" && r.canReport && r.canList && r.canDiagTo && r.canFinish) return true;
    } catch (e) { }
    await sleep(400);
  }
  return false;
}

function start(userData) {
  return spawn(EXE, ["--remote-debugging-port=" + PORT, "--user-data-dir=" + userData, "."], {
    cwd: APP,
    env: cleanEnv({ FISH_MULTI: "1", FISH_TEST_HIDDEN: "1" }),
    stdio: "ignore",
  });
}

// 把语音引擎那几级全打断，让一次 __finishReply 真的走到「整条链路都没出声」
const ARM_SPEAK = `
JSON.stringify((function () {
  window.__said = [];
  window.FishSay = function (t) { try { window.__said.push(String(t)); } catch (e) { } };
  const REAL = window.fetch;
  window.__hit = [];
  window.fetch = function (u, o) {
    const url = String(u && u.url ? u.url : u);
    if (url.indexOf("/engine/") >= 0 || url.indexOf("/api/tts") >= 0) {
      window.__hit.push(url.replace(/^https?:\\/\\/[^/]+/, ""));
      return Promise.resolve(new Response("probe: engine down", { status: 503 }));
    }
    return REAL.apply(window, arguments);
  };
  return { ok: true };
})())
`;

const RUN_SPEAK = `
(async function () {
  const before = (await window.deskfish.faultList()).items.length;
  try { await window.FishVoice.__finishReply("这句是为了让整条语音链路都失败，看故障记录里留没留下现场。"); } catch (e) { }
  await new Promise((r) => setTimeout(r, 400));
  const after = (await window.deskfish.faultList()).items;
  return JSON.stringify({ before, after, hit: window.__hit || [], said: window.__said || [] });
})()
`;

(async () => {
  const userData = makeTmp("dfy-fault-");
  const diagDir = path.join(userData, "diag-out");
  let child = start(userData);

  try {
    if (!await waitReady()) throw new Error("页面没就绪");
    console.log("页面就绪，端口 " + PORT);

    // ---- A 手动上报一条，字段原样收下 ----
    const a = await sampleFrom(PORT, PAGE, `
      (async function () {
        const r = await window.deskfish.faultList();
        const n0 = (r && r.items ? r.items : []).length;
        window.deskfish.reportFault({ kind: "mic", code: "probe-denied", short: "探测用的提示", detail: "探测用的下一步", raw: "probe raw line 原始错误" });
        await new Promise((r2) => setTimeout(r2, 300));
        const n1 = (await window.deskfish.faultList()).items;
        return JSON.stringify({ n0, last: n1[n1.length - 1] || null, count: n1.length });
      })()
    `, 12000);
    ok("上报一条之后记录数 +1", a && a.count === a.n0 + 1, JSON.stringify({ n0: a && a.n0, count: a && a.count }));
    ok("字段被原样收下（code/short/detail/raw）",
      a && a.last && a.last.code === "probe-denied" && a.last.short === "探测用的提示" &&
      a.last.detail === "探测用的下一步" && a.last.raw.indexOf("probe raw line") >= 0,
      JSON.stringify(a && a.last));
    ok("记了时间戳", a && a.last && a.last.at > 1e12, a && a.last && String(a.last.at));

    // ---- B 真触发一次说话失败：也进记录 ----
    await sampleFrom(PORT, PAGE, ARM_SPEAK, 8000);
    const b = await sampleFrom(PORT, PAGE, RUN_SPEAK, 40000);
    ok("说话整条链路失败时也记了一条", b && b.after.length === b.before + 1, JSON.stringify({ before: b && b.before, after: b && b.after && b.after.length }));
    const sp = b && b.after ? b.after[b.after.length - 1] : null;
    ok("那条标的是 speak", sp && sp.kind === "speak", sp && sp.kind);
    ok("带上了分类 code", sp && !!sp.code, sp && sp.code);
    ok("带上了原始错误（不是只有人话）", sp && /503|engine|down/i.test(String(sp.raw)), sp && String(sp.raw).slice(0, 80));
    ok("界面上仍然给人话", b && b.said.length >= 2, JSON.stringify(b && b.said));

    // ---- C 落盘 ----
    const ff = path.join(userData, "faults.json");
    ok("faults.json 已落盘", fs.existsSync(ff), ff);
    let stored = null;
    try { stored = JSON.parse(fs.readFileSync(ff, "utf8")); } catch (e) { }
    ok("落盘内容里有刚才那条", !!stored && JSON.stringify(stored).indexOf("probe-denied") >= 0, stored && String(JSON.stringify(stored).length) + " 字节");

    // ---- D 诊断包里能看见 ----
    const d = await sampleFrom(PORT, PAGE, `
      (async function () {
        const r = await window.deskfish.diagExportTo(${JSON.stringify(diagDir)});
        return JSON.stringify({ ok: !!(r && r.ok), files: (r && r.files) || [] });
      })()
    `, 20000);
    ok("诊断包导出成功", d && d.ok === true, JSON.stringify(d && d.files && d.files.length));
    const ft = path.join(diagDir, "故障记录.txt");
    ok("诊断包里有「故障记录.txt」", fs.existsSync(ft), ft);
    let ftext = "";
    try { ftext = fs.readFileSync(ft, "utf8"); } catch (e) { }
    ok("记录里写了是哪一类（麦克风 / 说话）", /麦克风/.test(ftext) && /说话/.test(ftext), ftext.split("\n").slice(0, 3).join(" | "));
    ok("记录里有原始错误", ftext.indexOf("probe raw line") >= 0, String(ftext.length) + " 字符");

    // ---- E 重启之后还在（用户报障最常见的情形）----
    killTree(child.pid);
    await sleep(1200);
    child = start(userData);
    if (!await waitReady()) throw new Error("重启后页面没就绪");
    const e = await sampleFrom(PORT, PAGE, `
      (async function () {
        const r = await window.deskfish.faultList();
        return JSON.stringify({ n: (r && r.items || []).length, hasOld: JSON.stringify(r).indexOf("probe-denied") >= 0 });
      })()
    `, 12000);
    ok("重启之后记录还在", e && e.n >= 2, e && String(e.n));
    ok("重启之后还能看到上一次那条", e && e.hasOld === true);

    // ---- F 只留最近 40 条 ----
    const f = await sampleFrom(PORT, PAGE, `
      (async function () {
        for (let i = 0; i < 60; i++) window.deskfish.reportFault({ kind: "mic", code: "flood-" + i, short: "洪水", raw: "f" + i });
        await new Promise((r) => setTimeout(r, 900));
        const items = (await window.deskfish.faultList()).items;
        return JSON.stringify({ n: items.length, first: items[0] && items[0].code, last: items[items.length - 1] && items[items.length - 1].code });
      })()
    `, 20000);
    ok("只留最近 40 条（不会无限长）", f && f.n === 40, f && String(f.n));
    ok("留下的是最新的那批", f && f.last === "flood-59", f && f.last);
    ok("最早的那条已经被挤掉", f && f.first !== "probe-denied", f && f.first);

    const pass = results.filter((x) => x.c).length;
    console.log("\n结果：" + pass + " 通过，" + (results.length - pass) + " 失败");
    if (!KEEP) {
      killTree(child.pid);
      await sleep(800);
      try { fs.rmSync(userData, { recursive: true, force: true }); } catch (err) { }
    }
    process.exit(pass === results.length ? 0 : 1);
  } catch (e) {
    console.error("探针失败：" + (e && e.message ? e.message : e));
    try { killTree(child.pid); } catch (e2) { }
    // 失败时也要收拾：否则每红一次就在临时目录里留一份 userData
    if (!KEEP) {
      await sleep(600);
      try { fs.rmSync(userData, { recursive: true, force: true }); } catch (e3) { }
    }
    process.exit(2);
  }
})();
