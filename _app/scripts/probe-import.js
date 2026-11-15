// 导入期间主进程还活着吗 —— 真机验证（round 13）
//
// 背景：导入以前是同步 copyFileSync，几百兆的包一拷就是几十秒，主进程在这段时间里
// 不处理任何 IPC/HTTP：窗口拖不动、托盘点不动，Windows 超时还会盖一层「未响应」。
// 改成 fs.promises 之后应该能「一边复制一边照常应答」。
//
// 怎么验：页面上同时开两条路 ——
//   ① POST /api/packs/import 导入一个 600 文件的包（几十秒内能跑完的量级）
//   ② 每 150ms 打一次 GET /api/packs，记下每次往返耗时
// 若主进程被堵死，②的请求会全部堆到①结束之后才返回（ms 很大、at 挤在末尾）；
// 若没被堵死，导入期间就有一串 ms < 500 的小往返。
//
// 用法：node scripts/probe-import.js [--files 600] [--kb 300] [--keep]
"use strict";

const fs = require("node:fs");
const { makeTmp } = require("./lib/tmp");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { sampleFrom, listTargets } = require("./lib/cdp");

const APP = path.join(__dirname, "..");
const EXE = path.join(APP, process.platform === "win32" ? "runtime" : "runtime", process.platform === "win32" ? "electron.exe" : "electron");

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const FILES = Math.max(50, Number(arg("files", "600")) || 600);
const KB = Math.max(4, Number(arg("kb", "300")) || 300);
const KEEP = argv.includes("--keep");
const PORT = Number(arg("port", "9291")) || 9291;

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  ✅ " + name + (detail ? "  " + detail : "")); }
  else { fail++; console.log("  ❌ " + name + (detail ? "  " + detail : "")); }
}

function killTree(pid) {
  try {
    if (process.platform === "win32") spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-pid, "SIGKILL");
  } catch (e) { }
}

async function waitFor(fn, ms, step) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, step || 300));
  }
  return null;
}

function makePack(dir, files, kb) {
  fs.mkdirSync(path.join(dir, "tex"), { recursive: true });
  // 最小的 model3：只要能被 findModel3 认出来就行，这里不真加载
  fs.writeFileSync(path.join(dir, "probe.model3.json"), JSON.stringify({
    Version: 3,
    FileReferences: { Moc: "probe.moc3", Textures: ["tex/t0.png"] },
  }), "utf8");
  fs.writeFileSync(path.join(dir, "probe.moc3"), "MOC3", "utf8");
  fs.writeFileSync(path.join(dir, "pet.json"), JSON.stringify({ id: "probe-import", live2d: { model: "probe.model3.json" } }), "utf8");
  const chunk = Buffer.alloc(Math.max(1, kb) * 1024, 0x41);
  for (let i = 0; i < files; i++) fs.writeFileSync(path.join(dir, "tex", "t" + i + ".png"), chunk);
}

async function main() {
  if (!fs.existsSync(EXE)) { console.log("找不到 electron：" + EXE); process.exit(2); }
  const tmpRoot = makeTmp("dfy-probe-import-");
  const srcDir = path.join(tmpRoot, "probe-import-pack");
  const ud = path.join(tmpRoot, "user");
  makePack(srcDir, FILES, KB);
  console.log("[probe] 造的包：" + FILES + " 个文件 × " + KB + "KB ≈ " + Math.round(FILES * KB / 1024) + " MB");

  const env = Object.assign({}, process.env, { FISH_MULTI: "1", FISH_TEST_HIDDEN: "1" });
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CHROME_CRASHPAD_PIPE_NAME;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;

  console.log("[probe] 启动 electron（隐藏窗口）…");
  const child = spawn(EXE, ["--remote-debugging-port=" + PORT, "--user-data-dir=" + ud, "."], {
    cwd: APP, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let out = "";
  child.stdout.on("data", (d) => { out += String(d); });
  child.stderr.on("data", (d) => { out += String(d); });

  try {
    const target = await waitFor(async () => {
      const list = await listTargets(PORT);
      const pg = list.find((t) => t.type === "page" && /index\.html/.test(t.url || ""));
      return pg ? pg.url : null;
    }, 40000, 400);
    if (!target) { console.log("❌ 页面没起来"); console.log(out.slice(-800)); process.exit(2); }
    console.log("[probe] 页面已起：" + target);
    await new Promise((r) => setTimeout(r, 2500));

    // 一条表达式跑完全程：并发开 ping，再发起导入，最后把两次的时间线交回来。
    const expr = `(async () => {
      const SRC = ${JSON.stringify(srcDir)};
      const t0 = Date.now();
      // 先量一条基线：不导入时 /api/packs 本来就要多久，用来区分
      // 「主进程被堵住」和「这个接口本来就慢」。
      const base = [];
      for (let i = 0; i < 3; i++) {
        const a = Date.now();
        try { const r = await fetch("/api/packs", { cache: "no-store" }); await r.text(); } catch (e) { }
        base.push(Date.now() - a);
      }
      base.sort((x, y) => x - y);
      const baseMs = base[1] || 0;
      const pings = [];
      let stop = false;
      const loop = (async () => {
        while (!stop) {
          const a = Date.now();
          try { const r = await fetch("/api/packs", { cache: "no-store" }); await r.text(); } catch (e) { }
          pings.push({ at: Date.now() - t0, ms: Date.now() - a });
          await new Promise((r) => setTimeout(r, 150));
        }
      })();
      const impStart = Date.now() - t0;
      const a2 = Date.now();
      let j = null, err = "";
      try {
        const r = await fetch("/api/packs/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ path: SRC }),
        });
        j = await r.json();
      } catch (e) { err = String(e && e.message || e); }
      const importMs = Date.now() - a2;
      stop = true;
      await loop;
      return JSON.stringify({
        ok: !!(j && j.ok), id: (j && j.id) || "", err, importMs,
        pings: pings.slice(0, 200), baseMs, impStart,
      });
    })()`;

    const r = await sampleFrom(PORT, (t) => t && t.type === "page" && /index\.html/.test(t.url || "") && t.webSocketDebuggerUrl, expr, 180000);
    if (!r) { console.log("❌ 求值没拿到结果"); process.exit(1); }

    console.log("[probe] 导入耗时 " + r.importMs + "ms，成功=" + r.ok + (r.err ? "，错误=" + r.err : ""));
    const pings = Array.isArray(r.pings) ? r.pings : [];
    console.log("  [明细] " + pings.slice(0, 16).map((p) => p.at + "/" + p.ms).join("  "));
    const impEnd = (r.impStart || 0) + r.importMs;
    const during = pings.filter((p) => p.at >= (r.impStart || 0) && p.at <= impEnd);
    const okMs = Math.max(400, (r.baseMs || 0) * 3);
    const healthy = during.filter((p) => p.ms <= okMs);
    console.log("[probe] 导入窗口 " + (r.impStart || 0) + "–" + impEnd + "ms；总共 " + pings.length +
      " 次心跳，窗口内 " + during.length + " 次，其中 " + healthy.length + " 次在 " + okMs + "ms 内");

    ok("导入本身成功", r.ok, r.id ? "id=" + r.id : "");
    ok("导入期间主进程仍在应答（心跳在基线的 3 倍以内）", healthy.length >= 3,
      healthy.length + " 次 / 阈值 " + okMs + "ms / 基线 " + (r.baseMs || 0) + "ms");
    ok("导入期间的心跳不是全堆到结束才回", healthy.length >= Math.max(1, Math.floor(during.length * 0.5)),
      healthy.length + "/" + during.length);
    ok("导入后包出现在列表里", await sampleFrom(PORT, (t) => t && t.type === "page" && /index\.html/.test(t.url || "") && t.webSocketDebuggerUrl,
      `(async () => { const r = await fetch("/api/packs"); const j = await r.json(); return JSON.stringify({ hit: (j.packs || []).some((p) => p.id === "probe-import-pack") }); })()`, 20000)
      .then((x) => !!(x && x.hit)).catch(() => false));
  } catch (e) {
    console.log("❌ 探针抛错：" + (e && e.message || e));
    fail++;
  } finally {
    killTree(child.pid);
    if (!KEEP) { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) { } }
    else console.log("[probe] 保留：" + tmpRoot);
  }

  console.log("");
  console.log("probe-import：" + pass + " 通过，" + fail + " 失败");
  process.exit(fail ? 1 : 0);
}

main();
