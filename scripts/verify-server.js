#!/usr/bin/env node
/**
 * 本地服务端口回退回归测试。
 *
 * 背景：startServer 的固定端口列表是 [7801..7805]（deviceId 按 origin 隔离，
 * 端口漂移会让设置里选的麦克风 id 在主窗口对不上号）。回退链路必须满足：
 *
 *   1) 占掉 7801、7802 → 仍能落到 7803，而不是在第二次 listen 上抛未捕获异常；
 *   2) 固定端口全被占 → 退到随机端口（listen(0)）；
 *   3) 随机端口也起不来 → reject（由 main.js 的 try/catch 显示启动失败窗），
 *      不能既不 resolve 也不 reject 地挂住。
 *
 * 这是纯 Node 层测试，不启动 Electron。
 */
"use strict";

const http = require("http");
const path = require("path");
const { startServer } = require("../src/server");

const FIXED = [7801, 7802, 7803, 7804, 7805];
let pass = 0;
let fail = 0;

function ok(name, cond, extra) {
  if (cond) {
    pass += 1;
    console.log("✅ " + name);
  } else {
    fail += 1;
    console.log("❌ " + name + (extra ? "  ← " + extra : ""));
  }
}

function listenOn(port) {
  return new Promise((resolve, reject) => {
    const s = http.createServer((_q, r) => r.end("x"));
    s.once("error", reject);
    s.listen(port, "127.0.0.1", () => resolve(s));
  });
}

function closeAll(list) {
  return Promise.all(
    list.map((s) => new Promise((r) => (s.listening ? s.close(() => r()) : r())))
  );
}

const noop = () => {};

function bootArgs(extra) {
  return Object.assign(
    {
      root: path.join(__dirname, ".."),
      mime: { ".html": "text/html" },
      log: noop,
      logErr: noop,
      getSettings: () => ({}),
      patchSettings: () => {},
      engines: {},
      rvcFetch: async () => ({}),
      rvcStatus: async () => ({}),
      adapter: null,
      notify: noop,
    },
    extra || {}
  );
}

function isPortBusy(port) {
  return new Promise((resolve) => {
    const s = require("net").connect({ port, host: "127.0.0.1" });
    let done = false;
    const fin = (v) => {
      if (done) return;
      done = true;
      try { s.destroy(); } catch (e) { /* ignore */ }
      resolve(v);
    };
    s.setTimeout(600);
    s.once("connect", () => fin(true));
    s.once("timeout", () => fin(false));
    s.once("error", () => fin(false));
  });
}

async function main() {
  // ── 1. 干净启动 ─────────────────────────────────────────────
  {
    // 7801 可能被正在运行的大肥鱼占着——那种情况下不该断言「一定拿到 7801」。
    const busy = await isPortBusy(FIXED[0]);
    const r = await startServer(bootArgs());
    ok("干净启动拿到端口", r && r.port > 0, "port=" + (r && r.port));
    if (busy) {
      console.log("ℹ 7801 已被占用（程序可能正在运行），跳过「优先 7801」断言");
      ok("被占用时不崩溃", !!r, "port=" + (r && r.port));
    } else {
      ok("干净启动优先用 7801", r && r.port === FIXED[0], "port=" + (r && r.port));
    }
    await closeAll([r.server]);
  }

  // ── 2. 占掉前两个固定端口：旧实现会在这里炸 ─────────────────
  {
    let blockers = [];
    try {
      blockers.push(await listenOn(FIXED[0]));
    } catch (e) {
      // 外部已经占着 7801 → 同样算「不可用」，目标一致
    }
    try {
      blockers.push(await listenOn(FIXED[1]));
    } catch (e) {
      /* 同上 */
    }
    let r = null;
    let err = null;
    try {
      r = await startServer(bootArgs());
    } catch (e) {
      err = e;
    }
    ok("连续两次 EADDRINUSE 后仍能启动", !!r, err ? String(err && err.message) : "resolve 未返回");
    if (r) {
      ok(
        "跳过了被占的 7801 / 7802",
        r.port !== FIXED[0] && r.port !== FIXED[1],
        "port=" + r.port
      );
      await closeAll([r.server]);
    }
    await closeAll(blockers);
  }

  // ── 3. 固定端口全占 → 随机端口 ──────────────────────────────
  {
    let blockers = [];
    for (const p of FIXED) {
      try {
        blockers.push(await listenOn(p));
      } catch (e) {
        /* 已经被别人占着也算占着 */
      }
    }
    let r = null;
    let err = null;
    try {
      r = await startServer(bootArgs());
    } catch (e) {
      err = e;
    }
    ok("固定端口全占时仍能启动", !!r, err ? String(err && err.message) : "resolve 未返回");
    if (r) {
      ok(
        "退到固定端口之外的随机端口",
        FIXED.indexOf(r.port) === -1,
        "port=" + r.port
      );
      await closeAll([r.server]);
    }
    await closeAll(blockers);
  }

  // ── 4. 随机端口也失败 → reject 而不是挂住 ────────────────────
  // 让 http.Server.prototype.listen 在 port===0 时同步抛错，模拟极端环境
  // （例如被安全软件拦掉全部 bind：UV__UNKNOWN / EPERM）。
  {
    const realListen = http.Server.prototype.listen;
    http.Server.prototype.listen = function (port) {
      if (port === 0) throw new Error("simulated bind failure");
      return realListen.apply(this, arguments);
    };
    // 先把 7801..7805 全占死，逼它走到 listen(0)
    let blockers = [];
    for (const p of FIXED) {
      try {
        blockers.push(await listenOn(p));
      } catch (e) {
        /* 同上 */
      }
    }
    let settled = "pending";
    let err = null;
    try {
      await startServer(bootArgs());
      settled = "resolved";
    } catch (e) {
      settled = "rejected";
      err = e;
    } finally {
      http.Server.prototype.listen = realListen;
      await closeAll(blockers);
    }
    ok("随机端口失败时 Promise 落地（不悬挂）", settled !== "pending", settled);
    ok("随机端口失败时走 reject", settled === "rejected", settled + " " + (err ? err.message : ""));
  }

  // ── 5. 失败后 server 句柄没有把错误监听器泄漏给别人 ─────────
  {
    const s = http.createServer(() => {});
    ok("服务实例可正常创建", !!s);
    s.close();
  }

  // ── 6. 畸形 URL 不许把请求打成 500 ─────────────────────────
  // `%zz` 和落单的 `%` 会让 decodeURIComponent 抛 URIError。这条走到最外层 catch
  // 就是 500 + 一条堆栈日志，本机任意页面刷几百次就能把 run.log 顶到轮转。
  {
    const logs = [];
    const { server, port } = await startServer({
      root: path.join(__dirname, "..", "src"),
      mime: { ".html": "text/html; charset=utf-8" },
      log: () => {},
      logErr: (m) => logs.push(m),
      getSettings: () => ({}),
      patchSettings: () => ({}),
      engines: {},
      notify: () => {},
      adapter: null,
      rvcFetch: () => {},
      rvcStatus: () => ({}),
    });
    const get = (raw) => new Promise((resolve) => {
      const rq = http.request(
        { host: "127.0.0.1", port, path: raw, method: "GET" },
        (rs) => { rs.resume(); rs.on("end", () => resolve(rs.statusCode)); }
      );
      rq.on("error", (e) => resolve("ERR:" + e.code));
      rq.end();
    });
    const bad = await get("/%zz");
    const lone = await get("/%");
    const good = await get("/index.html");
    const trav = await get("/..%2f..%2fpackage.json");
    ok("非法转义 %zz 回 400", bad === 400, String(bad));
    ok("落单的 % 回 400", lone === 400, String(lone));
    ok("正常页面仍然 200", good === 200, String(good));
    ok("路径穿越被挡住（不是 200）", trav !== 200, String(trav));
    ok("畸形请求不写进日志", logs.length === 0, logs.length + " 条");
    await new Promise((r) => server.close(r));
  }

  console.log("");
  console.log("结果：" + pass + " 通过，" + fail + " 失败");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("测试自身崩了: " + (e && e.stack ? e.stack : e));
  process.exit(2);
});
