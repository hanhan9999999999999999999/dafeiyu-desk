// 设置改完当场生效吗 —— 真机验证（round 17）
//
// 用户在设置里把帧率从 30 调到 20、把清晰度从 2x 调到 1x、或者关掉锐化，
// 期待的是「立刻变」，不是「重启之后才变」。界面上一旦要重启，就得明说；
// 而这里要验的正是「不需要重启」这条路真的通。
//
// 怎么验：一条表达式里连着改两轮设置，每轮等 1.4 秒再读回真实运行态：
//   · canvas.style.filter       ← 锐化（最直观，且不受空闲降档影响）
//   · ticker.maxFPS / calm      ← 帧率上限（空闲 8 秒后会降档，期望值要按 calm 算）
//   · renderer.resolution       ← 清晰度（同样受 calm 影响）
//   · window.innerWidth         ← scale（窗口真的变宽了才算生效）
// 另外放一个 window.__probeMark：如果哪一步触发了整页重载，标记会消失 ——
// 「改个设置闪一下」也是用户能感知的毛病。
//
// 用法：node scripts/probe-settings.js [--port 9295] [--keep]
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
const PORT = Number(arg("port", "9295")) || 9295;
const KEEP = argv.includes("--keep");

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ✅ " + name + (detail ? "  " + detail : "")); }
  else { fail++; console.log("  ❌ " + name + (detail ? "  " + detail : "")); }
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
    await sleep(step || 300);
  }
  return null;
}

const PROBE = `(async () => {
  const dbg = () => (window.__fishDebug ? window.__fishDebug() : {});
  const cv = () => document.querySelector("#stage canvas") || document.querySelector("canvas");
  const snap = () => {
    const d = dbg();
    return {
      maxFps: d.maxFps, res: d.res, calm: !!d.calm, fps: d.fps,
      filter: cv() ? String(cv().style.filter) : "(no canvas)",
      w: window.innerWidth, h: window.innerHeight,
    };
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__probeMark = 1;

  const out = { before: snap() };
  out.p1 = await window.deskfish.settingsPatch({ fpsCap: 20, resolution: 1, sharpen: false });
  await wait(1500);
  out.after1 = snap();
  out.p2 = await window.deskfish.settingsPatch({ fpsCap: 30, resolution: 2, sharpen: true });
  await wait(1500);
  out.after2 = snap();
  out.p3 = await window.deskfish.settingsPatch({ scale: 1.2 });
  await wait(1000);
  out.after3 = snap();
  out.p4 = await window.deskfish.settingsPatch({ scale: 1 });
  await wait(800);
  out.after4 = snap();
  out.markAlive = window.__probeMark === 1;
  out.url = location.href;
  return out;
})()`;

(async () => {
  if (!fs.existsSync(EXE)) { console.log("找不到 " + EXE); process.exit(2); }
  const ud = makeTmp("dfy-settings-");
  const env = Object.assign({}, process.env, { FISH_MULTI: "1", FISH_TEST_HIDDEN: "1" });
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CHROME_CRASHPAD_PIPE_NAME;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;

  console.log("[settings] 启动应用（隐藏窗口）…");
  const child = spawn(EXE, ["--remote-debugging-port=" + PORT, "--user-data-dir=" + ud, "."], {
    cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let log = "";
  child.stdout.on("data", (b) => { log += String(b); });
  child.stderr.on("data", (b) => { log += String(b); });

  try {
    const ready = await waitFor(async () => {
      const ts = await listTargets(PORT);
      const pg = ts.find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
      if (!pg) return null;
      const s = await sampleFrom(PORT, (t) => t.type === "page" && t.webSocketDebuggerUrl,
        `JSON.stringify((function(){ const d = window.__fishDebug ? window.__fishDebug() : null; return { has: !!d, model: !!(d && d.model) }; })())`, 8000);
      return s && s.model ? pg.url : null;
    }, 40000, 500);
    if (!ready) {
      console.log("❌ 模型没起来，测不了运行态");
      console.log(log.slice(-600));
      process.exit(2);
    }
    console.log("[settings] 页面就绪：" + ready);
    await sleep(1200);

    const r = await sampleFrom(PORT, (t) => t.type === "page" && /index\.html/.test(t.url || "") && t.webSocketDebuggerUrl, PROBE, 60000);
    if (!r || !r.before) { console.log("❌ 探针没拿到结果"); process.exit(1); }

    const b = r.before, a1 = r.after1, a2 = r.after2, a3 = r.after3, a4 = r.after4;
    console.log("  [基线] " + JSON.stringify(b));
    console.log("  [20/1x/无锐化] " + JSON.stringify(a1));
    console.log("  [30/2x/锐化]  " + JSON.stringify(a2));
    console.log("  [scale 1.2]   w=" + a3.w + "  [scale 1] w=" + a4.w);

    ok("设置层接受了新值（fpsCap 20）", !!(r.p1 && Number(r.p1.fpsCap) === 20), JSON.stringify(r.p1 && r.p1.fpsCap));
    ok("锐化当场关掉（不用重启）", !/sharpen/i.test(a1.filter), a1.filter || "(空)");
    ok("清晰度当场降到 1x", Number(a1.res) === 1, "res=" + a1.res);
    // 空闲 8 秒后 tick 会自动降档到 min(15, fpsCap)，期望值要按 calm 算，别硬写 20
    const want1 = a1.calm ? Math.min(15, 20) : 20;
    ok("帧率上限当场变 20（calm 时按降档算）", Number(a1.maxFps) === want1,
      "maxFps=" + a1.maxFps + " calm=" + a1.calm + " 期望 " + want1);

    ok("设置层接受了回滚值（fpsCap 30）", !!(r.p2 && Number(r.p2.fpsCap) === 30), JSON.stringify(r.p2 && r.p2.fpsCap));
    ok("锐化当场恢复", /sharpen/i.test(a2.filter), a2.filter || "(空)");
    const want2res = a2.calm ? 1 : 2;
    ok("清晰度回到 2x（calm 时保持 1x）", Number(a2.res) === want2res, "res=" + a2.res + " calm=" + a2.calm);
    const want2 = a2.calm ? Math.min(15, 30) : 30;
    ok("帧率上限回到 30（calm 时按降档算）", Number(a2.maxFps) === want2, "maxFps=" + a2.maxFps + " 期望 " + want2);

    // 空闲时 maxFps 恒 15 会掩盖「改没生效」，这一条只在非 calm 时有意义
    if (!a1.calm && !a2.calm) {
      ok("两档帧率确实不同（20 → 30，说明真的吃到了设置）", a1.maxFps !== a2.maxFps,
        a1.maxFps + " → " + a2.maxFps);
    } else {
      ok("calm 空闲降档生效（maxFps 被压到 15）",
        Number(a1.maxFps) === 15 && Number(a2.maxFps) === 15, "两轮都是 15");
    }

    ok("缩放当场生效（窗口真的变宽了）", Number(a3.w) > Number(a2.w) + 8, a2.w + " → " + a3.w);
    ok("缩放回 1 之后宽度回落", Number(a4.w) < Number(a3.w) - 8, a3.w + " → " + a4.w);
    ok("全程没有整页重载（改设置不该闪一下）", r.markAlive === true && /index\.html/.test(String(r.url)),
      "markAlive=" + r.markAlive);
  } catch (e) {
    console.log("❌ 探针抛错：" + (e && e.message || e));
    fail++;
  } finally {
    killTree(child.pid);
    if (!KEEP) { try { fs.rmSync(ud, { recursive: true, force: true }); } catch (e) { } }
  }

  console.log("");
  console.log("probe-settings：" + pass + " 通过，" + fail + " 失败");
  process.exit(fail ? 1 : 0);
})();
