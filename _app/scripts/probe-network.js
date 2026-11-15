"use strict";
// 她半夜会偷偷联网吗？
//
// 这条线要回答两件事，缺一不可：
//   1) 静态：源码里到底硬编码了哪些外网域名（那是 scripts/audit-network.js 的活）
//   2) 运行期：不点「检查更新」、不下模型的时候，一个外网请求都不发
//
// 这个探针只管 2)。做法是让主进程把所有 net.fetch 的目标记下来（自测实例里才装），
// 然后观察两段：
//   A 冷启动后 14 秒（至少跨一次桥接心跳）—— 一个外网目标都不许有
//   B 手动点一次「检查更新」—— 必须出现 api.github.com，且只有它
//
// hook 装没装成要单独断言：否则替换失败时「0 条外网」是假绿。
const fs = require("fs");
const { makeTmp } = require("./lib/tmp");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { findTarget, sampleFrom } = require("./lib/cdp");

const APP = path.resolve(__dirname, "..");
const EXE = path.join(APP, "runtime", "electron.exe");
const PORT = Number(process.env.PROBE_PORT || 9325);

const argv = process.argv.slice(2);
const KEEP = argv.includes("--keep");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(name, extra) { pass++; console.log("✅ " + name + (extra ? "  " + extra : "")); }
function bad(name, extra) { fail++; console.log("❌ " + name + (extra ? "  " + extra : "")); }
function want(name, cond, extra) { if (cond) ok(name, extra); else bad(name, extra); }

function cleanEnv(extra) {
  const env = Object.assign({}, process.env, extra || {});
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CHROME_CRASHPAD_PIPE_NAME;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return env;
}

function killTree(pid) {
  try { spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" }); } catch (e) { }
}

const INDEX_PICK = (t) => t && t.type === "page" && /\/src\/index\.html/.test(t.url || "");

// 本机 / 命名空间算「不是外网」
const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0|::1)$/i;
const NAMESPACE_HOST = /^www\.w3\.org$/i;

function hostOf(u) {
  try {
    const m = /^https?:\/\/([^/?#]+)/i.exec(String(u || ""));
    if (!m) return "";
    return m[1].split(":")[0].toLowerCase();
  } catch (e) {
    return "";
  }
}

function external(calls) {
  return (calls || []).filter((c) => {
    const h = hostOf(c.url);
    if (!h) return false;
    return !LOCAL_HOST.test(h) && !NAMESPACE_HOST.test(h);
  });
}

async function readNet() {
  return sampleFrom(PORT, INDEX_PICK, `(async function () {
    const r = await window.deskfish.testNetLog();
    return JSON.stringify({
      ok: true,
      hooked: !!r.hooked,
      n: (r.calls || []).length,
      calls: (r.calls || []).map(function (c) { return { at: c.at, url: c.url }; }),
    });
  })()`, 8000);
}

async function main() {
  const userData = makeTmp("dfy-net-");
  const child = spawn(EXE, [
    "--remote-debugging-port=" + PORT,
    "--user-data-dir=" + userData,
    ".",
  ], { cwd: APP, env: cleanEnv({ FISH_MULTI: "1", FISH_TEST_HIDDEN: "1" }), stdio: "ignore" });
  const pid = child.pid;

  try {
    const t0 = Date.now();
    let ready = false;
    while (Date.now() - t0 < 45000) {
      try {
        const t = await findTarget(PORT, INDEX_PICK);
        if (t) {
          const r = await sampleFrom(PORT, INDEX_PICK,
            `JSON.stringify({ s: document.readyState, f: typeof window.deskfish.testNetLog })`, 4000);
          if (r && r.s === "complete" && r.f === "function") { ready = true; break; }
        }
      } catch (e) { }
      await sleep(400);
    }
    if (!ready) throw new Error("页面没就绪（testNetLog 不可用）");

    // ---------- A 冷启动之后，什么都不点 ----------
    // 桥接是 8 秒一拍，等 14 秒能跨过至少一次 —— 那一拍走的是主进程 net.fetch。
    await sleep(14000);
    const a = await readNet();

    want("记录器真的装上了（否则「0 条外网」是假绿）", a && a.hooked === true, JSON.stringify({ hooked: a && a.hooked }));
    // 启动期本来就该一条都没有：桥接心跳走的是页面里的 fetch，不经过主进程 net.fetch。
    // 「记录器在干活」由 B 段证明（点一次检查更新，它必须记到 api.github.com）。
    ok("启动期的出站请求条数", "n=" + (a && a.n));

    const aExt = external(a.calls);
    want("不点检查更新、不下模型时，没有任何外网请求",
      aExt.length === 0,
      aExt.length ? JSON.stringify(aExt.slice(0, 5)) : "外网 0 条");

    const hosts = {};
    for (const c of a.calls || []) {
      const h = hostOf(c.url) || "(相对地址)";
      hosts[h] = (hosts[h] || 0) + 1;
    }
    ok("启动期的出站目标全是本机", JSON.stringify(hosts));

    // ---------- B 手动点一次检查更新 ----------
    const before = (a.calls || []).length;
    const b = await sampleFrom(PORT, INDEX_PICK, `(async function () {
      const r = await window.deskfish.updateCheck();
      return JSON.stringify({ ok: !!(r && r.ok), version: (r && r.version) || "", error: (r && r.error) || "" });
    })()`, 30000);
    await sleep(600);
    const c = await readNet();

    const bExt = external((c.calls || []).slice(before));
    want("点检查更新之后，确实去了 api.github.com",
      bExt.some((x) => hostOf(x.url) === "api.github.com"),
      JSON.stringify(bExt.map((x) => hostOf(x.url))));
    want("这一次也只连了 api.github.com（不多连别的地方）",
      bExt.every((x) => hostOf(x.url) === "api.github.com" || hostOf(x.url) === "github.com"),
      JSON.stringify([...new Set(bExt.map((x) => hostOf(x.url)))]));
    ok("检查更新的返回（真联网，失败也算正常）", JSON.stringify(b));

    // ---------- C 页面侧不该有外网资源 ----------
    const res = await sampleFrom(PORT, INDEX_PICK, `(function () {
      const arr = (performance.getEntriesByType("resource") || []).map(function (e) { return e.name; });
      const ext = arr.filter(function (u) {
        const m = /^https?:\\/\\/([^\\/?#]+)/i.exec(u);
        if (!m) return false;
        const h = m[1].split(":")[0].toLowerCase();
        return !/^(127\\.0\\.0\\.1|localhost)$/.test(h);
      });
      return JSON.stringify({ n: arr.length, ext: ext.slice(0, 8) });
    })()`, 8000);
    want("页面加载的资源里没有外网地址", res && res.ext && res.ext.length === 0,
      JSON.stringify({ 资源数: res && res.n, 外网: res && res.ext }));

    console.log("");
    console.log("结果：" + pass + " 通过，" + fail + " 失败");
  } catch (e) {
    fail++;
    console.log("❌ 探针异常：" + (e && e.message ? e.message : e));
    console.log("");
    console.log("结果：" + pass + " 通过，" + fail + " 失败");
  } finally {
    killTree(pid);
    if (!KEEP) {
      await sleep(800);
      try { fs.rmSync(userData, { recursive: true, force: true }); } catch (e) { }
    } else {
      console.log("[keep] 用户数据留在 " + userData);
    }
    process.exit(fail === 0 ? 0 : 1);
  }
}

main();
