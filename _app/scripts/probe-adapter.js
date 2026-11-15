"use strict";
/**
 * 模型适配器的端到端真机链路：导入 → 体检 → 绑定 → 切过去 → 删掉在用的那个。
 *
 * 为什么值得单独一个探针：
 *   test-packs.js（30 条）用真 PackStore 但不开窗口；
 *   test-packs-http.js（41 条）用假适配器只验路由；
 *   verify:ui（55 条）走的是界面冒烟。
 *   三条加起来仍然没有一条回答「用户点导入、绑一个动作、切过去、桌宠真的换了，而且删包之后
 *   画面不会变成空白」——这条链上任何一环断了，用户看到的都是「适配器里好好的，主界面没反应」。
 *
 * 做法：起真窗口（隔离 userData），用真模型目录做导入源，全程只走 /api/packs 这一层
 * （适配器界面自己用的也是它），每一步都回读主窗口渲染端的状态。
 *
 * 用法：
 *   node scripts/probe-adapter.js
 *   node scripts/probe-adapter.js --src "D:\某模型目录" --keep
 */
const fs = require("node:fs");
const { makeTmp } = require("./lib/tmp");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const EXE = path.join(ROOT, "runtime", "electron.exe");
const PORT = Number(process.env.PROBE_PORT || 9297);
const MAIN_PORT = PORT + 1;

const argv = process.argv.slice(2);
const argOf = (name, def) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const KEEP = argv.includes("--keep");
// 默认用工作区里最小的一个真模型（19.6 MB / 27 文件）当导入源
const SRC = path.resolve(argOf("src", path.join(ROOT, "..", "mianfeimodelYUAN")));

const cdp = require("./lib/cdp");

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("✅ " + name); }
  else { fail++; failures.push(name + (extra ? " → " + extra : "")); console.log("❌ " + name + (extra ? " → " + extra : "")); }
}
function eq(name, actual, expected) {
  ok(name, actual === expected, "实际 " + JSON.stringify(actual) + "，期望 " + JSON.stringify(expected));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cleanEnv(extra) {
  const env = Object.assign({}, process.env, extra || {});
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CHROME_CRASHPAD_PIPE_NAME;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return env;
}

function killTree(pid) {
  try { spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }); } catch (e) { }
}

/** 在页面里跑一段 async 代码。页面自己有 fetch，能直接打本地服务。 */
async function inPage(expr, ms) {
  const r = await cdp.sampleFrom(PORT, (x) => x && x.type === "page" && /index\.html/.test(x.url || ""), expr, ms || 30000);
  return r;
}

const PAGE_FETCH = (p, opts) => `(async () => {
  // 只拼 origin：探针跑在开发服务器上（http://127.0.0.1:<port>/src/index.html），
  // 用 new URL(p, location.href) 在这里会偶发 "Invalid URL"，拼字符串最稳。
  const u = location.origin + ${JSON.stringify(p)};
  const r = await fetch(u, ${JSON.stringify(opts || {})});
  let j = null;
  try { j = await r.json(); } catch (e) { return JSON.stringify({ status: r.status, json: null, raw: "不是 JSON" }); }
  return JSON.stringify({ status: r.status, json: j });
})()`;

async function apiJson(p, opts) {
  // 注意：lib/cdp 的 evalOn 已经把返回值 JSON.parse 过了，这里拿到的是对象，不要再 parse 一次
  const v = await inPage(PAGE_FETCH(p, opts), 40000);
  if (v && typeof v === "object" && typeof v.status === "number") return v;
  return { status: 0, json: null, err: "返回结构不对：" + JSON.stringify(v).slice(0, 140) };
}

(async () => {
  if (!fs.existsSync(EXE)) { console.error("找不到 electron：" + EXE); process.exit(2); }
  if (!fs.existsSync(SRC)) { console.error("导入源不存在：" + SRC); process.exit(2); }

  const ud = makeTmp("dfy-adapter-");
  console.log("[probe-adapter] 导入源 " + SRC);
  console.log("[probe-adapter] userData " + ud);

  const child = spawn(EXE, [
    "--remote-debugging-port=" + PORT,
    "--inspect=" + MAIN_PORT,
    "--user-data-dir=" + ud,
    ".",
  ], { cwd: ROOT, env: cleanEnv({ FISH_MULTI: "1", FISH_TEST_HIDDEN: "1" }), stdio: "ignore", windowsHide: true });

  let exited = null;
  child.on("exit", (code) => { exited = code; });

  try {
    // ---------- 0. 等她起来 ----------
    const t0 = Date.now();
    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (exited !== null) break;
      const r = await cdp.findTarget(PORT, (x) => x && x.type === "page" && /index\.html/.test(x.url || "")).catch(() => null);
      if (r) { ready = true; break; }
      await sleep(500);
    }
    ok("主窗口起来了", ready, ready ? (Date.now() - t0) + "ms" : "等了 30 秒没等到页面");

    // 调试端口在页面刚建出来时就能看到 target，但那一刻文档可能还是 about:blank ——
    // 此时 location.origin 是 "null"，任何相对请求都会拼成 "null/api/..." 而失败。
    // 所以不能以「看得见 target」当起点，要等到 origin 是 http 且文档加载完。
    let ready2 = false;
    let lastState = null;
    for (let i = 0; i < 40; i++) {
      const r = await inPage("JSON.stringify({ o: location.origin, rs: document.readyState })", 8000).catch(() => null);
      lastState = r;
      if (r && /^http/.test(String(r.o)) && r.rs === "complete") { ready2 = true; break; }
      await sleep(500);
    }
    ok("页面加载完成、本地服务已就绪", ready2, JSON.stringify(lastState));

    // ---------- 1. 起点：没有模型 ----------
    const list0 = await apiJson("/api/packs");
    ok("一开始模型库能读", list0.json && list0.json.ok === true, JSON.stringify(list0).slice(0, 160));
    // 源码版带内置模型（_app\model），所以起点可能已经有 dafeiyu；
    // 打包版不带模型，起点才是空的。这里两种都算正常，只要求「不能指着一个不存在的包」。
    const active0 = await apiJson("/api/packs/active");
    const a0 = active0.json || {};
    ok("起点的当前模型是自洽的（空 或 内置包）", a0.ok !== true || a0.origin === "builtin" || a0.origin === "user" || a0.origin === "override", JSON.stringify(a0).slice(0, 160));

    // ---------- 2. 导入前先体检一次源目录 ----------
    const chk = await apiJson("/api/packs/check?path=" + encodeURIComponent(SRC));
    ok("导入前能先体检源目录", chk.json && chk.json.ok === true, JSON.stringify(chk.json).slice(0, 200));
    ok("源目录体检认为可以导入", !!(chk.json && chk.json.canImport !== false), JSON.stringify(chk.json && chk.json.verdict));

    // ---------- 3. 导入 ----------
    const tImp = Date.now();
    const imp = await apiJson("/api/packs/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: SRC, copy: true }),
    });
    const impMs = Date.now() - tImp;
    const newId = imp.json && imp.json.id;
    ok("导入成功并拿到 id", !!(imp.json && imp.json.ok && newId), JSON.stringify(imp.json).slice(0, 200));
    if (imp.json && imp.json.ok) ok("导入耗时不算离谱（< 30 秒）", impMs < 30000, impMs + "ms");

    if (newId) {
      // ---------- 4. 导入后的包是健康的 ----------
      const open1 = await apiJson("/api/packs/" + encodeURIComponent(newId));
      ok("回读这个包能打开", !!(open1.json && open1.json.ok), JSON.stringify(open1.json).slice(0, 200));
      const d1 = await apiJson("/api/packs/" + encodeURIComponent(newId) + "/diagnose");
      const verdict = d1.json && d1.json.verdict;
      ok("体检结论不是 broken", verdict !== "broken", "verdict=" + verdict);
      ok("体检没报缺模型文件", !!(d1.json && !d1.json.missingModel), JSON.stringify(d1.json && d1.json.missingModel));

      const libs = await apiJson("/api/packs/" + encodeURIComponent(newId) + "/builtin");
      ok("内置动作库能读", !!(libs.json && libs.json.ok), JSON.stringify(libs.json).slice(0, 160));

      const rec = await apiJson("/api/packs/" + encodeURIComponent(newId) + "/recommend");
      ok("推荐取景能算出来", !!(rec.json && rec.json.ok), JSON.stringify(rec.json).slice(0, 160));

      // ---------- 5. 绑定一个动作再存回去 ----------
      const before = await apiJson("/api/packs/" + encodeURIComponent(newId) + "/manifest");
      // /manifest 返回的就是配置本体（平铺，含 ok/id/displayName/motions/...），不是 { manifest: {...} }
      const mani = before.json && before.json.ok ? before.json : null;
      ok("能读到包清单", !!(mani && mani.id === newId), JSON.stringify(before.json).slice(0, 160));

      // save 只认白名单字段（displayName/description/author/license/version/cfgs/interaction），
      // 故意多塞一个 ui 键：它必须被丢掉，不能顺着用户输入写进配置文件。
      const stamp = "probe-adapter " + Date.now();
      const saved = await apiJson("/api/packs/" + encodeURIComponent(newId) + "/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: stamp, ui: { probeBind: "idle" } }),
      });
      ok("保存不报错", !!(saved.json && saved.json.ok), JSON.stringify(saved.json).slice(0, 200));

      const after = await apiJson("/api/packs/" + encodeURIComponent(newId) + "/manifest");
      ok("写进去的说明真的读回来了", !!(after.json && after.json.description === stamp), JSON.stringify(after.json && after.json.description).slice(0, 160));
      ok("不认识的键不会被写进配置（白名单生效）", !!(after.json && !after.json.ui), String(JSON.stringify(after.json && after.json.ui)).slice(0, 120));

      // ---------- 6. 切过去，主窗口要真的换 ----------
      const act = await apiJson("/api/packs/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: newId }),
      });
      ok("切换接口返回成功", !!(act.json && act.json.ok), JSON.stringify(act.json).slice(0, 200));

      // 切模型会让主窗口 reload（main.js 里 120ms 后 webContents.reload）
      // 切模型会让主窗口 reload（main.js 里 120ms 后 webContents.reload）：
      // 这段时间调试 target 会消失又回来，取不到就继续等，别当成失败。
      let modelReady = false;
      let seenUrl = "";
      let lastSeen = null;
      for (let i = 0; i < 70; i++) {
        await sleep(700);
        const r = await inPage(`JSON.stringify((() => {
          const d = (window.__fishDebug ? window.__fishDebug() : null);
          const nm = document.getElementById("noModel");
          return {
            href: location.href,
            hasDebug: !!d,
            model: !!(d && d.model),
            noModelCard: !!(nm && nm.classList.contains("on")),
            retryShown: !!document.getElementById("fish-retry"),
            bodyText: (document.body ? document.body.innerText : "").slice(0, 120),
          };
        })())`, 8000).catch(() => null);
        if (!r) continue;
        lastSeen = r;
        if (r.model === true) { modelReady = true; break; }
      }
      ok("切过去之后桌宠真的起来了（且不是空状态）", modelReady, JSON.stringify(lastSeen));

      const actNow = await apiJson("/api/packs/active");
      const actId = actNow.json && (actNow.json.id || (actNow.json.manifest && actNow.json.manifest.id));
      ok("当前生效的确实切成了新包", actId === newId, "active=" + actId + "，期望 " + newId);
      seenUrl = (actNow.json && actNow.json.url) || "";
      ok("生效配置里有可用的模型地址", /\.model3\.json/.test(String(seenUrl)), seenUrl);

      // ---------- 7. 复制一份 ----------
      const dupId = newId + "-copy";
      const dup = await apiJson("/api/packs/" + encodeURIComponent(newId) + "/duplicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newId: dupId, name: "复制品" }),
      });
      ok("能复制一份包", !!(dup.json && dup.json.ok), JSON.stringify(dup.json).slice(0, 200));

      // ---------- 8. 删掉正在用的那个 ----------
      const rm = await apiJson("/api/packs/" + encodeURIComponent(newId) + "/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      ok("删掉在用的包不报错", !!(rm.json && rm.json.ok), JSON.stringify(rm.json).slice(0, 200));

      await sleep(2500);
      const listAfter = await apiJson("/api/packs");
      const ids = ((listAfter.json && listAfter.json.packs) || []).map((p) => p.id);
      ok("被删的包已从列表消失", ids.indexOf(newId) < 0, ids.join(","));
      const actAfterRm = await apiJson("/api/packs/active");
      const actAfterId = actAfterRm.json && (actAfterRm.json.id || (actAfterRm.json.manifest && actAfterRm.json.manifest.id));
      ok("删完之后自动落到别的包（不是指着已经不存在的）", actAfterId !== newId, "active=" + actAfterId);

      // 画面不能变成一片空白：要么换了模型，要么明确显示空状态卡
      let state = null;
      for (let i = 0; i < 40; i++) {
        await sleep(700);
        const r = await inPage(`JSON.stringify((() => {
          const d = (window.__fishDebug ? window.__fishDebug() : null);
          const nm = document.getElementById("noModel");
          return {
            model: !!(d && d.model),
            noModelCard: !!(nm && nm.classList.contains("on")),
            retryShown: !!document.getElementById("fish-retry"),
            bodyText: (document.body ? document.body.innerText : "").slice(0, 120),
          };
        })())`, 8000).catch(() => null);
        if (!r) continue;
        state = r;
        if (state.model === true || state.noModelCard === true) break;
      }
      ok("删包之后画面有明确归属（有模型 或 空状态卡），不是空白",
        !!(state && (state.model === true || state.noModelCard === true)), JSON.stringify(state));
    }
  } catch (e) {
    fail++;
    failures.push("探针自己出错：" + String((e && e.message) || e));
    console.log("❌ 探针自己出错：" + String((e && e.message) || e));
  } finally {
    killTree(child.pid);
    await sleep(600);
    if (!KEEP) {
      try { fs.rmSync(ud, { recursive: true, force: true }); } catch (e) { console.log("[probe-adapter] userData 没删干净：" + ud); }
    } else {
      console.log("[probe-adapter] --keep，userData 留在 " + ud);
    }
  }

  console.log("");
  console.log("结果：" + pass + " 通过，" + fail + " 失败");
  if (fail) { console.log("失败项："); failures.forEach((f) => console.log("  - " + f)); }
  process.exit(fail ? 1 : 0);
})();
