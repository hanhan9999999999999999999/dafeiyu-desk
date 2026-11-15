"use strict";
// 空状态卡的真机验收 —— 每个新用户第一眼看到的就是它，之前一条自动化都没覆盖。
//
// 为什么必须用打包版：源码版 `_app\model` 里带着内置模型，一启动就有模型，
// 永远走不到空状态。打包版按设计不带模型（版权在原画师手上，不随包分发），
// 干净 userData 启动进去就是空状态卡 —— 这才是用户装完第一次打开的真实画面。
//
// 量的是四件事：
//   ① 卡片真的显示出来了（#noModel 有 .on），不是一片透明窗口；
//   ② 两个导入按钮可见可点（用户得有事可做）；
//   ③ 「什么样的文件才认」能展开，且展开后内容真的在窗口里（356×512 很窄，
//      展开把内容顶出窗口 = 用户看不到最后两条，等于白写）；
//   ④ 窗口尺寸还是空状态那一档（有过模型时窗口会变大，尺寸错说明判定错）。
//
// 用法：node scripts/probe-empty.js [--wait 20000] [--port 9271] [--keep]
// 退出码：0 = 全部通过；1 = 有不符合项；2 = 起不来 / 找不到打包版。

const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { makeTmp } = require("./lib/tmp");
const os = require("node:os");
const { sampleFrom } = require("./lib/cdp");

const ROOT = path.join(__dirname, "..");
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const WAIT_MS = Number(arg("wait", "20000"));
const PORT = Number(arg("port", "9271"));
const KEEP = argv.includes("--keep");

const EXE = path.join(ROOT, "dist", "win-unpacked", "大肥鱼.exe");

// 一次求值把要看的都取回来。help 那个 details 顺手打开再读，
// 因为「展开后会不会顶出窗口」只有展开才量得到。
const PROBE = `JSON.stringify((function () {
  var box = document.getElementById("noModel");
  var zip = document.getElementById("nmZip");
  var dir = document.getElementById("nmDir");
  var tip = document.getElementById("nmTip");
  var help = document.getElementById("nmHelp");
  function vis(el) { return !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }
  var helpOpen = false, helpItems = 0, helpText = "";
  if (help) {
    try {
      help.open = true;
      helpOpen = help.open === true;
      helpItems = help.querySelectorAll("li").length;
      helpText = help.textContent.replace(/\\s+/g, " ").trim();
    } catch (e) { }
  }
  var card = box ? box.querySelector(".nm-card") : null;
  return {
    on: !!box && box.classList.contains("on"),
    zipVisible: vis(zip),
    dirVisible: vis(dir),
    tipText: tip ? tip.textContent.trim() : "",
    helpTag: help ? help.tagName : "",
    helpOpen: helpOpen,
    helpItems: helpItems,
    helpText: helpText,
    cardH: card ? card.offsetHeight : 0,
    winW: window.innerWidth,
    winH: window.innerHeight,
    scrollH: document.documentElement.scrollHeight,
    model: !!(document.getElementById("stage") && document.getElementById("stage").querySelector("canvas"))
  };
})())`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function killTree(pid) {
  try { spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch (e) { }
}

async function main() {
  if (!fs.existsSync(EXE)) {
    console.log("✗ 找不到打包版：" + EXE);
    console.log("  空状态只在打包版出现（源码版带内置模型），先跑 npm run build。");
    process.exit(2);
  }

  const ud = makeTmp("dfy-empty-");
  const env = Object.assign({}, process.env, { FISH_MULTI: "1", FISH_TEST_HIDDEN: "1" });
  for (const k of ["ELECTRON_RUN_AS_NODE", "CHROME_CRASHPAD_PIPE_NAME", "ELECTRON_NO_ATTACH_CONSOLE"]) delete env[k];

  console.log("[empty] 启动打包版（隔离 userData，窗口透明不抢屏）");
  const child = spawn(EXE, ["--remote-debugging-port=" + PORT, "--user-data-dir=" + ud], {
    env, stdio: "ignore", windowsHide: true,
  });
  child.on("error", (e) => { console.log("✗ 起不来：" + e.message); process.exit(2); });

  const t0 = Date.now();
  let data = null;
  let lastErr = null;
  while (Date.now() - t0 < WAIT_MS) {
    try {
      const d = await sampleFrom(PORT, (x) => x && x.type === "page" && /index\.html/.test(x.url || ""), PROBE, 8000);
      if (d && d.on) { data = d; break; }
      if (d) lastErr = "页面在，但空状态卡没显示出来";
    } catch (e) {
      lastErr = e.message;
    }
    await sleep(400);
  }

  if (!KEEP) killTree(child.pid);
  const cleanup = () => { try { fs.rmSync(ud, { recursive: true, force: true }); } catch (e) { } };

  if (!data) {
    console.log("✗ 没等到空状态卡：" + (lastErr || "页面始终没就绪"));
    console.log("  如果这时内置模型被装上了，空状态本来就不会出现 —— 先清 userData 再试。");
    setTimeout(() => { cleanup(); process.exit(2); }, 500);
    return;
  }

  console.log("");
  console.log("[empty] 卡片高 " + data.cardH + "px，窗口 " + data.winW + "×" + data.winH +
    "，展开说明后文档高 " + data.scrollH + "px");
  console.log("[empty] 提示：" + JSON.stringify(data.tipText));
  console.log("[empty] 说明：" + JSON.stringify(data.helpText.slice(0, 120)) + "…");
  console.log("");

  const fails = [];
  const ok = (yes, label, detail) => {
    if (yes) console.log("✅ " + label + (detail ? "  " + detail : ""));
    else { console.log("❌ " + label + (detail ? "  " + detail : "")); fails.push(label); }
  };

  ok(data.on === true, "空状态卡真的显示了（不是一片透明窗口）");
  ok(!data.model, "确实没有模型在跑（走的是『还没装』这条路）");
  ok(data.zipVisible, "「导入压缩包」按钮可见");
  ok(data.dirVisible, "「选择解压后的文件夹」按钮可见");
  ok(/Cubism 3 \/ 4/.test(data.tipText), "提示里写明了支持的版本", JSON.stringify(data.tipText));
  ok(data.helpTag === "DETAILS", "「什么样的文件才认」是可展开块", data.helpTag);
  ok(data.helpOpen === true, "展开块点得开");
  ok(data.helpItems >= 4, "说明至少四条", data.helpItems + " 条");
  ok(/model3\.json/.test(data.helpText), "说明写了 .model3.json（用户要认的就是这个文件）");
  ok(/Cubism 2/.test(data.helpText), "说明写了 Cubism 2 不支持（最常见的失败原因）");
  // 这条最容易漏：356×512 的窗口，说明展开把内容顶出去就白写了
  ok(data.scrollH <= data.winH, "展开后内容没被顶出窗口", data.scrollH + " ≤ " + data.winH);
  ok(data.winW === 356 && data.winH === 512, "窗口仍是空状态那一档 356×512", data.winW + "×" + data.winH);

  console.log("");
  console.log(fails.length ? "结果：" + fails.length + " 项不符合" : "结果：全部通过 —— 第一次打开的人有事可做、知道该拿什么来");
  setTimeout(() => { cleanup(); process.exit(fails.length ? 1 : 0); }, 500);
}

main().catch((e) => { console.log("✗ 探针自己挂了：" + (e && e.message)); process.exit(2); });
