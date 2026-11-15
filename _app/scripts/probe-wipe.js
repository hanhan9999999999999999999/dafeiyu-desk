"use strict";
// 「清除本机数据」到底清了什么、又保住了什么？
//
// 这个按钮是用户卖电脑 / 借人之前会点的最后一个东西，所以它必须两头都对：
//   · 该走的都走了（对话、故障、日志、缓存、崩溃快照、读不懂时留的备份）
//   · 不该走的别动（settings.json 里的密钥、用户自己导入的模型）
// 静态清单由 audit-privacy.js 对账，这里验真机行为。
const { spawn } = require("child_process");
const fs = require("fs");
const { makeTmp } = require("./lib/tmp");
const os = require("os");
const path = require("path");
const { sampleFrom } = require("./lib/cdp");

const APP = path.resolve(__dirname, "..");
const EXE = path.join(APP, "runtime", "electron.exe");
const PORT = Number(process.env.PROBE_PORT || 9327);
const KEEP = process.argv.includes("--keep");

const args = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const WAIT_MS = Number(argOf("wait", 15000));

const SECRET = "probe-secret-QWERTY-123";
const LINE = "清除之前说过的一句话";
const BAD = "chatlog.json.bad-2026-01-01T00-00-00-000Z";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const PAGE_PICK = (x) => x && x.type === "page" && /\/src\/index\.html/.test(x.url || "");
const PROBE =
  "JSON.stringify({ready:document.readyState,has:typeof(window.deskfish&&window.deskfish.dataWipe)==='function'})";

async function waitReady(deadline) {
  while (Date.now() < deadline) {
    try {
      const r = await sampleFrom(PORT, PAGE_PICK, PROBE, 4000);
      if (r && r.ready === "complete" && r.has) return true;
    } catch (e) { }
    await sleep(300);
  }
  return false;
}

const exists = (p) => {
  try { return fs.statSync(p).isFile(); } catch (e) { return false; }
};
const dirFiles = (p) => {
  try {
    let n = 0;
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const q = path.join(d, e.name);
        if (e.isDirectory()) walk(q);
        else n += 1;
      }
    };
    walk(p);
    return n;
  } catch (e) { return 0; }
};

(async () => {
  const userData = makeTmp("dfy-wipe-");

  /* 启动之前先摆好「上一次运行留下的东西」：语音缓存、崩溃快照、读不懂的旧备份、用户模型。
   * 这些在真机上都是历史文件，只有从磁盘上预先放好才验得准。 */
  const ttsDir = path.join(userData, "runtime", "tts");
  const crashDir = path.join(userData, "crash");
  const modelDir = path.join(userData, "models", "mypack");
  fs.mkdirSync(ttsDir, { recursive: true });
  fs.mkdirSync(crashDir, { recursive: true });
  fs.mkdirSync(modelDir, { recursive: true });
  fs.writeFileSync(path.join(ttsDir, "probe-1.wav"), Buffer.alloc(2048, 7));
  fs.writeFileSync(path.join(ttsDir, "probe-2.wav"), Buffer.alloc(1024, 7));
  fs.writeFileSync(path.join(crashDir, "probe-crash.txt"), "boom\n", "utf8");
  fs.writeFileSync(path.join(modelDir, "pet.json"), JSON.stringify({ id: "mypack" }), "utf8");
  fs.writeFileSync(path.join(userData, BAD), '{"version":1,"items":[{"text":"旧的一句', "utf8");

  const child = spawn(EXE, ["--remote-debugging-port=" + PORT, "--user-data-dir=" + userData, "."], {
    cwd: APP,
    env: cleanEnv({ FISH_MULTI: "1", FISH_TEST_HIDDEN: "1" }),
    stdio: "ignore",
  });

  const results = [];
  const ok = (name, cond, detail) => {
    results.push({ name, pass: !!cond, detail });
    console.log((cond ? "✅ " : "❌ ") + name + (detail !== undefined ? "  " + JSON.stringify(detail) : ""));
  };

  try {
    if (!(await waitReady(Date.now() + WAIT_MS))) throw new Error("页面没准备好（" + WAIT_MS + "ms）");
    await sleep(1000);

    /* ── 造数据：走真 IPC 写对话与故障，走真 settings:patch 写密钥 ── */
    await sampleFrom(
      PORT,
      PAGE_PICK,
      "window.deskfish.chatAppend({role:'user',text:" + JSON.stringify(LINE) + "})" +
        ".then(function(){return window.deskfish.reportFault({kind:'probe',code:'before-wipe',short:'清除前的故障',raw:'raw line'});})" +
        ".then(function(){return window.deskfish.settingsPatch({apiKey:" + JSON.stringify(SECRET) + "});})" +
        ".then(function(){return 'done';})",
      8000
    );
    await sleep(1800); // 等 chatSaveSoon 的 400ms 防抖落盘

    const chatPath = path.join(userData, "chatlog.json");
    const faultPath = path.join(userData, "faults.json");
    const setPath = path.join(userData, "settings.json");
    const readOr = (p) => { try { return fs.readFileSync(p, "utf8"); } catch (e) { return ""; } };

    ok("清除前：对话记录已落盘", readOr(chatPath).indexOf(LINE) >= 0);
    ok("清除前：故障记录已落盘", readOr(faultPath).indexOf("before-wipe") >= 0);
    ok("清除前：设置里存了密钥", readOr(setPath).indexOf(SECRET) >= 0);
    ok("清除前：语音缓存有文件", dirFiles(ttsDir) === 2, dirFiles(ttsDir));
    ok("清除前：崩溃快照有文件", dirFiles(crashDir) === 1, dirFiles(crashDir));
    ok("清除前：读不懂的旧备份在", exists(path.join(userData, BAD)));
    ok("清除前：用户导入的模型在", exists(path.join(modelDir, "pet.json")));

    /* ── 清 ── */
    const r = await sampleFrom(PORT, PAGE_PICK, "window.deskfish.dataWipe().then(function(r){return r;})", 20000);
    ok("清除返回成功", r && r.ok === true, r && { removed: (r.removed || []).length, failed: r.failed });
    ok("没有一项删不掉", r && Array.isArray(r.failed) && r.failed.length === 0, r && r.failed);
    /* 别数条数：这台机器上到底存在几个窗口位置文件、日志轮转到第几份，每次都不同。
     * 该断言的是「关键的这些都在删掉的名单里」。 */
    {
      const rm = (r && r.removed) || [];
      const has = (n) => rm.some((x) => x.replace(/\\/g, "/").indexOf(n) >= 0);
      const need = ["chatlog.json", "faults.json", "runtime/tts/probe-1.wav", "crash/probe-crash.txt"];
      const miss = need.filter((n) => !has(n));
      ok("该删的关键项都在名单里", miss.length === 0, miss.length ? miss : rm.length + " 项");
    }

    /* ── 该走的 ── */
    await sleep(300);
    ok("对话记录文件没了", !exists(chatPath));
    ok("故障记录文件没了", !exists(faultPath));
    ok("语音缓存清空了", dirFiles(ttsDir) === 0, dirFiles(ttsDir));
    ok("崩溃快照清空了", dirFiles(crashDir) === 0, dirFiles(crashDir));
    ok("读不懂的旧备份也没了（那里面也是用户说的话）", !exists(path.join(userData, BAD)));
    const left = fs.readdirSync(userData).filter((f) => /^chatlog\.json\.bad-/.test(f));
    ok("数据目录里不剩任何 .bad- 备份", left.length === 0, left);

    /* ── 该留的 ── */
    ok("设置还在", exists(setPath));
    ok("设置里的密钥没被顺手清掉", readOr(setPath).indexOf(SECRET) >= 0);
    ok("用户导入的模型还在", exists(path.join(modelDir, "pet.json")));

    /* ── 内存也得清：否则下一次写盘会把刚删的写回来 ── */
    const after = await sampleFrom(PORT, PAGE_PICK, "window.deskfish.chatList().then(function(r){return {n:(r.items||[]).length};})", 6000);
    ok("内存里的对话记录也清了（不会下次写盘又回来）", after && after.n === 0, after && after.n);

    const pass = results.filter((x) => x.pass).length;
    const fail = results.length - pass;
    console.log("\n结果：" + pass + " 通过，" + fail + " 失败");
    killTree(child.pid);
    if (!KEEP) { await sleep(600); try { fs.rmSync(userData, { recursive: true, force: true }); } catch (e) { } }
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.error("探针失败：" + (e && e.message ? e.message : e));
    try { killTree(child.pid); } catch (e2) { }
    if (!KEEP) { await sleep(600); try { fs.rmSync(userData, { recursive: true, force: true }); } catch (e3) { } }
    process.exit(2);
  }
})();
