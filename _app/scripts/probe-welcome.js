"use strict";
// 第一次见到她的人，看到的第一屏是什么？
//
// 以前这张卡只讲操作（右键、热键、拖我），关掉之后用户打字、她没反应，
// 得到的是一句「没有填 API 地址」—— 四十个字符的技术话，没人知道该去哪儿填。
// 现在卡片开场就体检，把「她还缺什么」摆在最上面。这个探针验的就是那四条：
//   A 体检接口本身给出结构化的两项（模型 / 对话接口）
//   B 缺接口时卡片出现、说人话、给一个「去设置」的出口
//   C 填上接口之后那条自己消失（不能一直挂着吓人）
//   D 只用桥接的人，桥接通了就不该被告警
//   E 点「去设置」真的把设置窗打开，并且把这张卡关掉
const { spawn } = require("child_process");
const fs = require("fs");
const { makeTmp } = require("./lib/tmp");
const http = require("http");
const os = require("os");
const path = require("path");
const { sampleFrom, findTarget } = require("./lib/cdp");

const APP = path.resolve(__dirname, "..");
const EXE = path.join(APP, "runtime", "electron.exe");
const PORT = Number(process.env.PROBE_PORT || 9329);
const KEEP = process.argv.includes("--keep");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) {
    pass += 1;
    console.log("✅ " + name + (extra !== undefined ? "  " + fmt(extra) : ""));
  } else {
    fail += 1;
    console.log("❌ " + name + (extra !== undefined ? "  " + fmt(extra) : ""));
  }
};
const fmt = (x) => {
  try {
    const s = typeof x === "string" ? x : JSON.stringify(x);
    return s.length > 220 ? s.slice(0, 220) + "…" : s;
  } catch (e) {
    return String(x);
  }
};

function killTree(pid) {
  try { spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" }); } catch (e) { }
}

function cleanEnv(extra) {
  const env = Object.assign({}, process.env, extra || {});
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CHROME_CRASHPAD_PIPE_NAME;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return env;
}

const MAIN_PICK = (x) => x && x.type === "page" && /\/src\/index\.html/.test(x.url || "");
const WELCOME_PICK = (x) => x && x.type === "page" && /\/src\/welcome\.html/.test(x.url || "");
const SETTINGS_PICK = (x) => x && x.type === "page" && /\/src\/settings\.html/.test(x.url || "");

const sleep30 = () => sleep(300);

async function waitMain(deadline) {
  while (Date.now() < deadline) {
    try {
      const r = await sampleFrom(
        PORT,
        MAIN_PICK,
        "JSON.stringify({ready:document.readyState,model:!!(window.__fishDebug&&window.__fishDebug().model)})",
        4000
      );
      if (r && r.ready === "complete" && r.model) return true;
    } catch (e) { }
    await sleep30();
  }
  return false;
}

async function waitWelcome(deadline) {
  while (Date.now() < deadline) {
    try {
      const r = await sampleFrom(
        PORT,
        WELCOME_PICK,
        "JSON.stringify({ready:document.readyState,has:!!document.getElementById('todo'),fn:typeof renderTodo})",
        4000
      );
      if (r && r.ready === "complete" && r.has && r.fn === "function") return r;
    } catch (e) { }
    await sleep30();
  }
  return null;
}

async function inWelcome(expr, timeoutMs) {
  return await sampleFrom(PORT, WELCOME_PICK, expr, timeoutMs || 12000);
}

async function inMain(expr, timeoutMs) {
  return await sampleFrom(PORT, MAIN_PICK, expr, timeoutMs || 12000);
}

/* 一次读全「卡片现在长什么样」：隐藏没、几项、说了什么、有没有出口按钮 */
const READ_TODO = `(async () => {
  await renderTodo();
  const b = document.getElementById("todo");
  return JSON.stringify({
    hidden: !!b.hidden,
    n: b.children.length,
    text: (b.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 300),
    go: Array.from(b.querySelectorAll(".go")).map((x) => x.textContent),
  });
})()`;

(async () => {
  const userData = makeTmp("dfy-welcome-");
  let child = null;
  let bridgeSrv = null;

  const boot = () =>
    spawn(EXE, ["--remote-debugging-port=" + PORT, "--user-data-dir=" + userData, "."], {
      cwd: APP,
      env: cleanEnv({ FISH_MULTI: "1", FISH_TEST_HIDDEN: "1" }),
      stdio: "ignore",
    });

  try {
    child = boot();
    const up = await waitMain(Date.now() + 40000);
    ok("主窗口起来了", up);
    if (!up) throw new Error("主窗口没起来");

    /* ── 打开引导卡 ───────────────────────────────────────────── */
    await inMain("window.deskfish.openWelcome()");
    const w = await waitWelcome(Date.now() + 20000);
    ok("引导卡打开了，体检容器在", !!w, w);

    /* ── A. 体检接口的结构 ────────────────────────────────────── */
    const pre = await inWelcome(
      `(async () => {
        const r = await window.deskfish.welcomePrecheck();
        return JSON.stringify({
          ok: r.ok,
          keys: (r.items || []).map((x) => x.key),
          bools: (r.items || []).every((x) => typeof x.ok === "boolean"),
          need: (r.items || []).filter((x) => !x.ok).map((x) => x.need),
          bridgeOk: r.bridgeOk,
        });
      })()`
    );
    ok("体检接口返回成功", pre && pre.ok === true, pre && pre.ok);
    ok("体检项正好是「模型」和「对话接口」两项", pre && pre.keys && pre.keys.join(",") === "model,talk", pre && pre.keys);
    ok("每项都带布尔状态", pre && pre.bools === true);
    // 有没有缺项取决于这台机器：桥接在跑的时候两项都齐。所以这里只验结构，
    // 「缺项写了人话标题」留到 B 段——那里缺什么是我们自己造出来的。
    ok("桥接状态是布尔（不是 undefined）", pre && typeof pre.bridgeOk === "boolean", pre && pre.bridgeOk);

    /* ── B. 缺接口：卡片出现、说人话、给出口 ───────────────────── */
    // 死端口 = 桥接一定不通；apiBase 清空 = 两条路都没有
    await inMain(
      `window.deskfish.settingsPatch({ apiBase: "", bridgeUrl: "http://127.0.0.1:59998" })`,
      15000
    );
    await sleep(400);
    const bPre = await inWelcome(
      `(async () => { const r = await window.deskfish.welcomePrecheck(); return JSON.stringify({ need: (r.items || []).filter((x) => !x.ok).map((x) => x.need), talkOk: (r.items || [])[1] && (r.items || [])[1].ok }); })()`
    );
    ok("缺的那项在接口里也标成了不齐", !!(bPre && bPre.talkOk === false), bPre);
    ok("缺的那项带了人话标题", !!(bPre && bPre.need && bPre.need.indexOf("还差一个对话接口") >= 0), bPre && bPre.need);
    const b = await inWelcome(READ_TODO);
    ok("缺接口时卡片看得见", b && b.hidden === false, b && b.hidden);
    ok("说的是「还差一个对话接口」", !!(b && b.text && b.text.indexOf("还差一个对话接口") >= 0), b && b.text);
    ok("告诉了他该去哪儿填", !!(b && b.text && b.text.indexOf("OpenAI 兼容") >= 0), b && b.text);
    ok("给了一个「去设置」的出口", !!(b && b.go && b.go.indexOf("去设置") >= 0), b && b.go);
    ok("没模型时不重复喊（这台机器有内置模型）", !!(b && b.text && b.text.indexOf("还差一个模型") < 0), b && b.text);
    ok("提示里不出现技术错误原文", !!(b && b.text && !/HTTP \d|Failed to fetch|ECONNREFUSED/.test(b.text)), b && b.text);

    /* ── C. 填上接口：那条自己消失 ────────────────────────────── */
    await inMain(`window.deskfish.settingsPatch({ apiBase: "https://api.deepseek.com/v1" })`, 15000);
    await sleep(400);
    const c = await inWelcome(READ_TODO);
    ok("填上接口之后卡片收起来了", c && c.hidden === true, c && c.hidden);

    /* ── D. 只用桥接的人：桥接通就不该被告警 ──────────────────── */
    const bridgePort = await new Promise((res) => {
      bridgeSrv = http.createServer((req, r2) => {
        r2.writeHead(200, { "content-type": "application/json" });
        r2.end('{"app":"probe-bridge"}');
      });
      bridgeSrv.listen(0, "127.0.0.1", () => res(bridgeSrv.address().port));
    });
    await inMain(
      `window.deskfish.settingsPatch({ apiBase: "", bridgeUrl: "http://127.0.0.1:${bridgePort}" })`,
      15000
    );
    await sleep(400);
    const dp = await inWelcome(
      `(async () => { const r = await window.deskfish.welcomePrecheck(); return JSON.stringify({ bridgeOk: r.bridgeOk, items: (r.items || []).map((x) => ({ k: x.key, ok: x.ok })) }); })()`
    );
    const talkOk = dp && dp.items && dp.items.find && dp.items.find((x) => x.k === "talk");
    ok("桥接通了，体检说「对话接口」齐了", !!(talkOk && talkOk.ok === true), dp && dp.items);
    const d = await inWelcome(READ_TODO);
    ok("只用桥接的人看不到「还差一个对话接口」", d && d.hidden === true && (d.text || "").indexOf("还差一个对话接口") < 0, d && d);

    /* ── E. 点「去设置」：真开设置窗，并且把卡片关掉 ───────────── */
    await inMain(
      `window.deskfish.settingsPatch({ apiBase: "", bridgeUrl: "http://127.0.0.1:59998" })`,
      15000
    );
    await sleep(400);
    await inWelcome(READ_TODO);
    const clicked = await inWelcome(
      `(async () => {
        const b = document.getElementById("todo");
        const go = b.querySelector(".go");
        if (!go) return JSON.stringify({ clicked: false });
        go.click();
        return JSON.stringify({ clicked: true, label: go.textContent });
      })()`
    );
    ok("点到了「去设置」", clicked && clicked.clicked === true, clicked);

    let setTarget = null;
    const sDeadline = Date.now() + 15000;
    while (Date.now() < sDeadline) {
      try {
        const t = await findTarget(PORT, SETTINGS_PICK);
        if (t) {
          const r = await sampleFrom(
            PORT,
            SETTINGS_PICK,
            "JSON.stringify({ready:document.readyState,has:!!document.getElementById('alwaysOnTop')})",
            4000
          );
          if (r && r.ready === "complete" && r.has) {
            setTarget = r;
            break;
          }
        }
      } catch (e) { }
      await sleep30();
    }
    ok("设置窗真的打开了", !!setTarget, setTarget);

    await sleep(600);
    const wt = await findTarget(PORT, WELCOME_PICK);
    ok("引导卡自己关掉了", !wt, wt ? "(还在)" : undefined);

    const fr = await inMain("window.deskfish.settingsGet().then((s) => JSON.stringify({ firstRun: s.firstRun }))");
    ok("关掉之后不再重复弹（firstRun 已置 false）", fr && fr.firstRun === false, fr);
  } catch (e) {
    fail += 1;
    console.log("❌ 探针异常: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  } finally {
    if (bridgeSrv) {
      try { bridgeSrv.close(); } catch (e) { }
    }
    if (child) killTree(child.pid);
    await sleep(800);
    if (!KEEP) {
      try { fs.rmSync(userData, { recursive: true, force: true }); } catch (e) { }
    } else {
      console.log("保留现场: " + userData);
    }
    console.log("\n结果：" + pass + " 通过，" + fail + " 失败");
    process.exit(fail ? 1 : 0);
  }
})();
