"use strict";
/**
 * 设置窗里「手打一个路径」到底存不存得住 —— 真机验证。
 *
 * 背景：`#feiyuRefDir` 这个输入框以前只有「选文件夹」按钮会写它，用键盘改完
 * 按回车、切走，什么都不会发生；框看着能编辑，其实是个摆设。
 * 这一版补了 change + Enter 提交，这里就验它真的写进 settings.json 了，
 * 并且验它走的还是同一套校验（手打一个没有分隔符的串会被 sanitize 清空）。
 *
 * 用法：node scripts/probe-settings-input.js [--keep]
 */
const fs = require("node:fs");
const { makeTmp } = require("./lib/tmp");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { sampleFrom, findTarget } = require("./lib/cdp");

const APP = path.resolve(__dirname, "..");
const EXE = path.join(APP, "runtime", "electron.exe");
const PORT = 9299;
const KEEP = process.argv.includes("--keep");

let pass = 0;
let fail = 0;
function ok(n, e) { pass++; console.log("  ✅ " + n + (e ? " → " + e : "")); }
function bad(n, e) { fail++; console.log("  ❌ " + n + (e ? " → " + e : "")); }
function t(n, c, e) { if (c) ok(n, e); else bad(n, e); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cleanEnv(extra) {
  const env = Object.assign({}, process.env, extra || {});
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CHROME_CRASHPAD_PIPE_NAME;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return env;
}

async function main() {
  const ud = makeTmp("dfy-setinput-");
  const child = spawn(EXE, [
    "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + ud,
    ".",
  ], {
    cwd: APP,
    env: cleanEnv({ FISH_MULTI: "1", FISH_TEST_HIDDEN: "1" }),
    stdio: "ignore",
  });

  try {
    // 1. 等主窗把模型拉起来（脚本注入的时机下限）
    let ready = null;
    for (let i = 0; i < 90; i++) {
      try {
        const r = await sampleFrom(PORT, (x) => x && x.type === "page" && /index\.html/.test(x.url),
          'JSON.stringify({ o: location.origin, s: document.readyState, m: !!(window.__fishDebug && window.__fishDebug().model) })',
          4000);
        if (r && r.s === "complete" && r.m) { ready = r; break; }
      } catch (e) { }
      await sleep(400);
    }
    t("桌宠起来了", !!ready, ready ? ready.o : "超时");

    // 2. 打开设置窗
    await sampleFrom(PORT, (x) => x && x.type === "page" && /index\.html/.test(x.url),
      'JSON.stringify({ sent: (window.deskfish.openSettings(), true) })', 4000);

    let st = null;
    for (let i = 0; i < 30; i++) {
      st = await findTarget(PORT, (x) => x && x.type === "page" && /settings\.html/.test(x.url));
      if (st) break;
      await sleep(300);
    }
    t("设置窗打开了", !!st, st ? st.url : "没等到 settings.html");

    if (st) {
      // 2b. 等设置窗自己把脚本跑完：target 出现 ≠ 页面里已经有那些控件
      //     （和 probe-adapter 那个坑同源：/json/list 列得早，document 还没解析完）
      let dom = null;
      for (let i = 0; i < 25; i++) {
        try {
          const r = await sampleFrom(PORT, (x) => x && x.type === "page" && /settings\.html/.test(x.url),
            'JSON.stringify({ s: document.readyState, n: document.querySelectorAll("input,select,button").length, has: !!document.getElementById("feiyuRefDir") })',
            4000);
          dom = r;
          if (r && r.s === "complete" && r.has) break;
        } catch (e) { }
        await sleep(300);
      }
      t("设置窗的 DOM 已经建完", !!(dom && dom.s === "complete"), dom ? JSON.stringify(dom) : "读不到");

      // 3. 在设置窗里手打一个合法路径并提交（change）
      const typed = "D:\\feiyu\\refvoice";
      const r1 = await sampleFrom(PORT, (x) => x && x.type === "page" && /settings\.html/.test(x.url),
        'JSON.stringify((function(){var e=document.getElementById("feiyuRefDir");' +
        'if(!e) return {ok:false,why:"找不到 #feiyuRefDir"};' +
        'e.value=' + JSON.stringify(typed) + ';' +
        'e.dispatchEvent(new Event("change",{bubbles:true}));' +
        'return {ok:true,value:e.value};})())', 6000);
      t("设置窗里有 #feiyuRefDir 且能派发 change", !!(r1 && r1.ok), r1 ? JSON.stringify(r1) : "");

      // 4. 等主进程落盘，读 settings.json
      const sfile = path.join(ud, "settings.json");
      let saved = null;
      for (let i = 0; i < 25; i++) {
        try {
          const j = JSON.parse(fs.readFileSync(sfile, "utf8"));
          if (j && typeof j.feiyuRefDir === "string" && j.feiyuRefDir) { saved = j; break; }
        } catch (e) { }
        await sleep(200);
      }
      t("手打的路径写进了 settings.json", !!saved, saved ? JSON.stringify(saved.feiyuRefDir) : "5 秒没落盘");
      if (saved) t("落盘的值就是打进去的那个", saved.feiyuRefDir === typed, saved.feiyuRefDir);

      // 5. 再打一个不合法的（没有分隔符）——sanitize 该把它清空
      await sampleFrom(PORT, (x) => x && x.type === "page" && /settings\.html/.test(x.url),
        'JSON.stringify((function(){var e=document.getElementById("feiyuRefDir");' +
        'e.value="就是一个词";e.dispatchEvent(new Event("change",{bubbles:true}));return {ok:true};})())', 6000);
      let cleared = false;
      for (let i = 0; i < 20; i++) {
        await sleep(200);
        try {
          const j = JSON.parse(fs.readFileSync(sfile, "utf8"));
          if (j && j.feiyuRefDir === "") { cleared = true; break; }
        } catch (e) { }
      }
      t("手打的非法值被同一套校验清掉", cleared, cleared ? "feiyuRefDir = \"\"" : "4 秒后仍是旧值");
    }
  } finally {
    try { child.kill(); } catch (e) { }
    await sleep(600);
    if (!KEEP) {
      for (let i = 0; i < 10; i++) {
        try { fs.rmSync(ud, { recursive: true, force: true }); break; } catch (e) { await sleep(400); }
      }
    }
  }

  console.log("");
  console.log("结果：" + pass + " 通过 " + fail + " 失败");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("探针异常：" + (e && e.stack || e));
  process.exit(2);
});
