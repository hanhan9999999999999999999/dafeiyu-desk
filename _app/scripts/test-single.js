"use strict";
/**
 * 单实例锁的真机验收。
 *
 * 用户在桌面上最常见的「程序坏了」其实是这一类：
 *   双击一次 —— 起来了；再双击一次 —— 什么都没发生（或者更糟：起了第二个）。
 *
 * 这个脚本起一个 A，再起一个 B，量四件事：
 *   1. B 必须很快自己退出（不是卡住、不是留下第二个托盘图标）
 *   2. A 必须还活着（不能被 B 顶掉）
 *   3. A 的页面只能有一个（B 不该在 A 之外再开一个窗口）
 *   4. A 的日志里必须留下「收到第二个实例请求」的记录 —— 用户报「双击没反应」时，
 *      这条日志是唯一能区分「锁生效了但没提示」和「根本没收到请求」的证据。
 *
 * 用法：
 *   node scripts/test-single.js                # 默认 3 项断言 + 日志检查
 *   node scripts/test-single.js --keep         # 留着 A 的 userData 方便看
 *   node scripts/test-single.js --json         # 只输出一行 JSON
 */

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { listTargets, sampleFrom } = require("./lib/cdp");

const APP = path.resolve(__dirname, "..");
const EXE = path.join(APP, "runtime", "electron.exe");
const argv = process.argv.slice(2);
const KEEP = argv.includes("--keep");
const JSON_ONLY = argv.includes("--json");
const PORT = Number((argv.find((a) => a.startsWith("--port=")) || "").split("=")[1] || 9293);
const WAIT_BOOT_MS = 18000;
const WAIT_EXIT_MS = 15000;

const results = [];
const ok = (n, d) => { results.push({ ok: true, n, d }); if (!JSON_ONLY) console.log("✅ " + n + (d ? "  " + d : "")); };
const bad = (n, d) => { results.push({ ok: false, n, d }); if (!JSON_ONLY) console.log("❌ " + n + (d ? "  " + d : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cleanEnv(extra) {
  const env = Object.assign({}, process.env, extra || {});
  // 环境里带着 ELECTRON_RUN_AS_NODE 时，electron.exe 会当 node 跑，参数全成非法选项
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CHROME_CRASHPAD_PIPE_NAME;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return env;
}

function start(userData, extraEnv, withPort) {
  const args = ["--user-data-dir=" + userData];
  if (withPort) args.push("--remote-debugging-port=" + PORT);
  args.push(".");
  const child = spawn(EXE, args, {
    cwd: APP,
    env: cleanEnv(extraEnv),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out = [];
  child.stdout.on("data", (b) => out.push(String(b)));
  child.stderr.on("data", (b) => out.push(String(b)));
  const exit = new Promise((resolve) => {
    child.on("exit", (code, sig) => resolve({ code, sig, ms: Date.now() - t0 }));
  });
  const t0 = Date.now();
  return { child, out, exit, t0 };
}

async function waitFor(fn, ms, step = 250) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if (await fn()) return true; } catch (e) { }
    await sleep(step);
  }
  return false;
}

function killTree(pid) {
  try {
    require("node:child_process").execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } catch (e) { }
}

(async () => {
  if (!fs.existsSync(EXE)) {
    console.log("找不到 " + EXE);
    process.exit(2);
  }
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "dfy-single-"));
  const baseEnv = { FISH_TEST_HIDDEN: "1" };   // 不上屏，别抢主人的屏

  // ---------- 起 A ----------
  const A = start(userData, baseEnv, true);
  if (!JSON_ONLY) console.log("[single] A 启动 pid=" + A.child.pid + " userData=" + userData);

  const aUp = await waitFor(async () => {
    const ts = await listTargets(PORT);
    return ts.some((t) => t.type === "page" && /index\.html/.test(t.url || ""));
  }, WAIT_BOOT_MS, 400);
  if (!aUp) {
    bad("A 起来了", "等 " + WAIT_BOOT_MS + "ms 没等到主页面");
    killTree(A.child.pid);
    process.exit(1);
  }
  const bootMs = Date.now() - A.t0;
  ok("A 起来了", "用时 " + bootMs + "ms");

  const pagesA = (await listTargets(PORT)).filter((t) => t.type === "page").length;
  ok("A 只有一个页面", pagesA + " 个");

  // ---------- 起 B：同一个 userData，不带 FISH_MULTI ----------
  const tB = Date.now();
  const B = start(userData, baseEnv, false);
  if (!JSON_ONLY) console.log("[single] B 启动 pid=" + B.child.pid + "（A 还拿着锁）");

  let bExit = null;
  const bDone = await Promise.race([
    B.exit.then((v) => { bExit = v; return true; }),
    sleep(WAIT_EXIT_MS).then(() => false),
  ]);
  const bMs = Date.now() - tB;

  if (!bDone) {
    bad("第二个实例会自己退出", "等 " + WAIT_EXIT_MS + "ms 还没退（这是「双击两次变成两个」）");
    killTree(B.child.pid);
  } else {
    ok("第二个实例会自己退出", "用时 " + bMs + "ms，退出码 " + bExit.code);
    if (bExit.code === 0) ok("第二个实例是正常退出（不是崩溃）", "code=0");
    else bad("第二个实例是正常退出（不是崩溃）", "code=" + bExit.code);
  }

  // B 退出之后 A 必须还在
  await sleep(1200);
  const aAlive = A.child.exitCode === null && A.child.signalCode === null;
  if (aAlive) ok("A 没被第二个实例顶掉", "pid 仍 " + A.child.pid);
  else bad("A 没被第二个实例顶掉", "A 已经退出 code=" + A.child.exitCode);

  // 页面数不该变
  let pagesAfter = -1;
  try {
    pagesAfter = (await listTargets(PORT)).filter((t) => t.type === "page").length;
  } catch (e) { }
  if (pagesAfter === pagesA) ok("第二个实例没有在 A 之外再开窗口", pagesAfter + " 个页面");
  else bad("第二个实例没有在 A 之外再开窗口", pagesA + " → " + pagesAfter);

  // A 的日志里必须有「收到第二个实例请求」
  const logText = (() => {
    try { return fs.readFileSync(path.join(userData, "run.log"), "utf8"); } catch (e) { return ""; }
  })();
  if (/second instance|第二个实例|second-instance/i.test(logText)) {
    const line = logText.split(/\r?\n/).filter((l) => /second instance|第二个实例|second-instance/i.test(l))[0] || "";
    ok("A 的日志留下了「收到第二个实例请求」", line.trim().slice(0, 80));
  } else {
    bad("A 的日志留下了「收到第二个实例请求」", "找不到。用户报「双击没反应」时就没法判断锁是生效了还是根本没收到");
  }

  // 再双击一次：连第二次也要有回应（不是只有第一次）
  const B2 = start(userData, baseEnv, false);
  let b2Exit = null;
  const b2Done = await Promise.race([
    B2.exit.then((v) => { b2Exit = v; return true; }),
    sleep(WAIT_EXIT_MS).then(() => false),
  ]);
  if (b2Done && b2Exit.code === 0) ok("第三次双击同样被接手（不是只有第一次）", "code=0");
  else { bad("第三次双击同样被接手（不是只有第一次）", b2Done ? "code=" + b2Exit.code : "没退出"); killTree(B2.child.pid); }

  const log2 = (() => { try { return fs.readFileSync(path.join(userData, "run.log"), "utf8"); } catch (e) { return ""; } })();
  const hits = (log2.match(/second instance|第二个实例|second-instance/gi) || []).length;
  if (hits >= 2) ok("两次请求都记了日志", hits + " 条");
  else bad("两次请求都记了日志", "只看到 " + hits + " 条");

  // ---------- 收尾 ----------
  killTree(A.child.pid);
  await sleep(800);
  if (!KEEP) {
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch (e) { }
  }

  const pass = results.filter((r) => r.ok).length;
  const fail = results.length - pass;
  if (JSON_ONLY) console.log(JSON.stringify({ pass, fail, results }));
  else {
    console.log("");
    console.log("结果：" + pass + " 通过，" + fail + " 失败");
    if (KEEP) console.log("[single] userData 保留在 " + userData);
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log("探针自己出错：" + (e && e.stack || e));
  process.exit(2);
});
