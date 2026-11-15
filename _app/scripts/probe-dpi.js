// 高 DPI 屏上她会不会变成两倍大 —— 真机验证（round 18）
//
// 这条线一直没人验过：本机的截图和实测全在 100% 缩放（1920×1080）下做的。
// 而用户里有大量 4K @150%、笔记本 @125% / @200% 的机器。
// Electron 的窗口尺寸与位置都是 DIP（与缩放无关），理论上不会变；危险在于
// 「谁拿了物理像素当 DIP 用」—— canvas 的 width/height 是物理像素，
// style.width 与 getBoundingClientRect() 是 DIP，抄错一个单位就是「她撑成两倍」。
//
// 怎么验：用 --force-device-scale-factor=<f> 让 Chromium 以指定缩放启动，
// 逐档读回 devicePixelRatio、窗口 DIP 尺寸、canvas 的物理像素与 CSS 尺寸、模型状态。
// 判定：窗口 DIP 尺寸不随缩放变；canvas 物理像素 = DIP × 缩放 × 分辨率；
//      模型能起来、帧率不是 0（别把「渲染器崩在启动」当成「尺寸对了」）。
//
// 用法：node scripts/probe-dpi.js [--factors 1,1.25,1.5,2] [--port 9297] [--keep]
"use strict";

const fs = require("node:fs");
const { makeTmp } = require("./lib/tmp");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { sampleFrom, listTargets } = require("./lib/cdp");

const APP = path.join(__dirname, "..");
const EXE = path.join(APP, "runtime", "electron.exe");
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const PORT = Number(arg("port", "9297")) || 9297;
const KEEP = argv.includes("--keep");
// 想验「极致（3x）在 300% 屏上够不够」时传 --res 3
const RES = Number(arg("res", "0")) || 0;
const FACTORS = String(arg("factors", "1,1.25,1.5,2"))
  .split(",").map((x) => Number(x)).filter((x) => x > 0.2 && x <= 4);

// 窗口在 100% 缩放下的基准尺寸（main.js windowSize() 的无模型档是 356×512，
// 这里取的是加载模型后 index.html 的实际容器，允许几像素误差）
const BASE_W = 460;

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("    ✅ " + name + (detail ? "  " + detail : "")); }
  else { fail++; console.log("    ❌ " + name + (detail ? "  " + detail : "")); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function killTree(pid) {
  try { spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" }); } catch (e) { }
}
async function waitFor(fn, ms, step) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await sleep(step || 400);
  }
  return null;
}

const PROBE = `JSON.stringify((function () {
  const c = document.querySelector("#stage canvas") || document.querySelector("canvas");
  const r = c ? c.getBoundingClientRect() : null;
  const d = window.__fishDebug ? window.__fishDebug() : {};
  const st = getComputedStyle(document.documentElement);
  return {
    dpr: window.devicePixelRatio,
    innerW: window.innerWidth, innerH: window.innerHeight,
    cssW: c ? c.style.width : null, cssH: c ? c.style.height : null,
    pxW: c ? c.width : null, pxH: c ? c.height : null,
    rectW: r ? Math.round(r.width) : null, rectH: r ? Math.round(r.height) : null,
    maxFps: d.maxFps, res: d.res, model: !!d.model, fps: d.fps,
    zoom: st.zoom || "",
  };
})())`;

async function oneFactor(f, idx) {
  const ud = makeTmp("dfy-dpi-");
  const port = PORT + idx;
  const env = Object.assign({}, process.env, { FISH_MULTI: "1", FISH_TEST_HIDDEN: "1" });
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CHROME_CRASHPAD_PIPE_NAME;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;

  console.log("");
  console.log("— 缩放 " + Math.round(f * 100) + "% —");
  const child = spawn(EXE, [
    "--force-device-scale-factor=" + f,
    "--remote-debugging-port=" + port,
    "--user-data-dir=" + ud,
    ".",
  ], { cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let tail = "";
  child.stdout.on("data", (b) => { tail += String(b); });
  child.stderr.on("data", (b) => { tail += String(b); });

  try {
    const ready = await waitFor(async () => {
      const ts = await listTargets(port);
      const pg = ts.find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
      if (!pg) return null;
      const s = await sampleFrom(port, (t) => t.type === "page" && t.webSocketDebuggerUrl,
        `JSON.stringify((function(){ const d = window.__fishDebug ? window.__fishDebug() : null; return { model: !!(d && d.model) }; })())`, 8000);
      return s && s.model ? true : null;
    }, 45000, 500);

    if (!ready) {
      ok("模型起来了（" + Math.round(f * 100) + "%）", false, "40 秒内没等到 model=true");
      console.log("      末尾日志：" + tail.slice(-300).replace(/\s+/g, " "));
      return;
    }
    await sleep(1500);

    // --res 3：先把清晰度调到「极致」再量，验它能不能救 250%/300% 的屏
    if (RES) {
      await sampleFrom(port, (t) => t.type === "page" && /index\.html/.test(t.url || "") && t.webSocketDebuggerUrl,
        `(async () => { await window.deskfish.settingsPatch({ resolution: ${RES} }); await new Promise((r) => setTimeout(r, 1600)); return JSON.stringify({ ok: true }); })()`,
        20000);
    }

    const r = await sampleFrom(port, (t) => t.type === "page" && /index\.html/.test(t.url || "") && t.webSocketDebuggerUrl, PROBE, 15000);
    if (!r) { ok("读到运行态（" + Math.round(f * 100) + "%）", false); return; }
    console.log("      " + JSON.stringify(r));

    // dpr 可能是 1.2499999 / 1.5000001，别用全等
    ok("devicePixelRatio 跟随缩放", Math.abs(r.dpr - f) < 0.02, "dpr=" + r.dpr);
    // 窗口尺寸是 DIP，换缩放不该变 —— 这一条是「她会不会变两倍大」的核心
    ok("窗口 DIP 宽度不随缩放变", Math.abs(r.innerW - BASE_W) <= 8, "innerW=" + r.innerW + "（基准 " + BASE_W + "）");
    ok("canvas 的 CSS 宽度等于窗口宽度（铺满，没被 px 写死）",
      r.rectW !== null && Math.abs(r.rectW - r.innerW) <= 4, "rect=" + r.rectW + " inner=" + r.innerW);
    // PIXI 的 autoDensity 把 CSS 尺寸写成 canvas.width / resolution，
    // 所以 canvas 的物理像素 = 逻辑尺寸 × resolution，devicePixelRatio 由浏览器自己换算 ——
    // 我第一版把 dpr 也乘了进去，150% / 200% 三档全红，其实是断言错，不是产品错。
    const wantPx = Math.round(r.innerW * (Number(r.res) || 1));
    ok("canvas 物理像素 = 窗口 DIP × 渲染分辨率（autoDensity 已含缩放）",
      r.pxW !== null && Math.abs(r.pxW - wantPx) <= 4,
      "px=" + r.pxW + " 期望 " + wantPx + "（res=" + r.res + "）");
    // 真正该守的是「别糊」：屏幕要的物理像素不能超过画布给的。
    // 清晰度只有三档（标准 1x / 清晰 2x / 极致 3x），所以：
    //   dpr ≤ 2 → 默认「清晰」就够，不够就是产品问题；
    //   dpr > 2 → 只有开了「极致」才追得上，这时如实判，别把取舍说成缺陷。
    const screenPx = Math.round(r.innerW * r.dpr);
    const enough = r.pxW >= screenPx - 2;
    if (r.dpr <= 2.02) {
      ok("画布像素不低于这块屏要的（高 DPI 下也不糊）", enough,
        "画布 " + r.pxW + " ≥ 屏幕 " + screenPx);
    } else if (Number(r.res) >= 3) {
      ok("「极致」在 " + Math.round(r.dpr * 100) + "% 屏上像素够", enough,
        "画布 " + r.pxW + " ≥ 屏幕 " + screenPx);
    } else {
      ok("超过 200% 的屏需要「极致」才追得上（当前 res=" + r.res + "，属已知取舍）", true,
        "画布 " + r.pxW + " < 屏幕 " + screenPx + " —— 用 --res 3 验「极致」够不够");
    }
    ok("模型在跑（不是空壳）", r.model === true && Number(r.fps) > 3, "fps=" + r.fps + " maxFps=" + r.maxFps);
    ok("没有多余的 zoom 变换", !r.zoom || r.zoom === "1" || r.zoom === "normal", "zoom=" + (r.zoom || "(空)"));
  } catch (e) {
    ok("探针没抛错（" + Math.round(f * 100) + "%）", false, String(e && e.message || e));
  } finally {
    killTree(child.pid);
    if (!KEEP) { try { fs.rmSync(ud, { recursive: true, force: true }); } catch (e) { } }
  }
}

(async () => {
  if (!fs.existsSync(EXE)) { console.log("找不到 " + EXE); process.exit(2); }
  console.log("[dpi] 逐档缩放启动，共 " + FACTORS.length + " 档：" + FACTORS.map((f) => Math.round(f * 100) + "%").join(" / "));
  for (let i = 0; i < FACTORS.length; i++) await oneFactor(FACTORS[i], i);
  console.log("");
  console.log("probe-dpi：" + pass + " 通过，" + fail + " 失败");
  process.exit(fail ? 1 : 0);
})();
