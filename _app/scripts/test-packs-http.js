"use strict";
/**
 * 模型包 HTTP 接口的路由回归：起一个真的 http server，把 packs/http.js 的 serve()
 * 挂上去，然后拿真请求打它。
 *
 * 为什么值得单独一个测试：
 *   /api/packs 这一层是适配器窗口唯一的数据来源。路由分支多、顺序敏感
 *   （/api/packs/rules 必须排在 /api/packs/:id 前面），而且「没有这个接口」
 *   这种 404 一旦发出去，用户看到的就是一句没法照做的黑话。
 *   这里把「接对了」和「没接住时说了什么」都钉住。
 *
 * 用法：node scripts/test-packs-http.js
 */
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const { serve } = require("../src/packs/http");

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
function has(name, actual, needle) {
  ok(name, String(actual).includes(needle), "实际 " + JSON.stringify(actual) + "，应包含 " + JSON.stringify(needle));
}

// 一个够用的假适配器：只要路由能走通、返回值能落进 JSON，就不需要真的去扫模型目录。
const calls = [];
const fakeAdapter = {
  list: () => ({ packs: [{ id: "dafeiyu", origin: "builtin", displayName: "大肥鱼" }], active: "dafeiyu" }),
  rules: { schema: () => ({ fields: [] }) },
  getManifest: (id) => (id === undefined || id === "dafeiyu" ? { id: "dafeiyu", scale: 1 } : null),
  activate: (id) => { calls.push("activate:" + id); return { active: id }; },
  open: (id) => (id === "dafeiyu" ? { id: "dafeiyu", verdict: "usable", score: 96 } : null),
  check: (id) => (id === "dafeiyu" ? { ok: true, score: 96 } : null),
  inspectPath: (p) => ({ path: p, ok: true }),
  builtin: () => ({ scenes: [], actionCount: 0, paramRefs: [] }),
  autofill: () => ({ applied: 0 }),
  recommendLayout: () => ({ viewBox: {} }),
  diagnose: () => ({ errors: [], warnings: [] }),
  save: (id, b) => ({ id, saved: true, got: b }),
  duplicate: (id, n) => ({ id: n }),
  resetConfig: () => ({ reset: true }),
  remove: () => ({ removed: true }),
  exportManifest: () => ({ id: "dafeiyu", exported: true }),
  activeId: () => "dafeiyu",
  importDir: (p) => ({ imported: p }),
  importArchive: (p) => ({ importedArchive: p }),
};

const logs = [];
const ctx = {
  adapter: fakeAdapter,
  logErr: (m) => logs.push(String(m)),
  notify: (ch, id) => logs.push("notify:" + ch + ":" + id),
  patchSettings: () => { },
};

let base = "";
let server = null;

function req(pathname, opts) {
  const u = base + pathname;
  return fetch(u, Object.assign({ cache: "no-store" }, opts || {})).then(async (r) => {
    let body = null;
    try { body = await r.json(); } catch (e) { }
    return { status: r.status, body };
  });
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dfy-packs-http-"));
  server = http.createServer((rq, rs) => {
    const u = new URL(rq.url, "http://127.0.0.1");
    if (!serve(rq, rs, u.pathname, u.searchParams, ctx)) {
      rs.writeHead(404, { "content-type": "text/plain" }).end("static miss");
    }
  });
  await new Promise((res) => server.listen(0, "127.0.0.1", res));
  base = "http://127.0.0.1:" + server.address().port;

  // ── 1. 正常路由 ────────────────────────────────────────────
  let r = await req("/api/packs");
  eq("GET /api/packs 状态 200", r.status, 200);
  ok("GET /api/packs 返回 ok:true", r.body && r.body.ok === true);
  eq("GET /api/packs 带出包数量", r.body.packs.length, 1);

  r = await req("/api/packs/rules");
  eq("/api/packs/rules 不被当成 id=rules", r.status, 200);
  ok("rules 返回 rules 字段", r.body && r.body.rules && Array.isArray(r.body.rules.fields));

  r = await req("/api/packs/active");
  eq("GET /api/packs/active 200", r.status, 200);
  eq("active 带出 id", r.body.id, "dafeiyu");

  r = await req("/api/packs/dafeiyu");
  eq("GET /api/packs/:id 200", r.status, 200);
  eq("open 带出判定", r.body.verdict, "usable");

  r = await req("/api/packs/dafeiyu/manifest");
  eq("GET /:id/manifest 200", r.status, 200);
  eq("manifest 带出 scale", r.body.scale, 1);

  r = await req("/api/packs/dafeiyu/builtin");
  eq("GET /:id/builtin 200", r.status, 200);
  ok("builtin 带出 motionCount", r.body && r.body.motionCount === 0);

  r = await req("/api/packs/check?id=dafeiyu");
  eq("GET /api/packs/check?id= 200", r.status, 200);

  r = await req("/api/packs/check?path=" + encodeURIComponent("E:\\some\\dir"));
  eq("GET /api/packs/check?path= 200", r.status, 200);
  eq("inspectPath 收到原路径", r.body.path, "E:\\some\\dir");

  r = await req("/api/packs/dafeiyu/save", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scale: 1.2 }),
  });
  eq("POST /:id/save 200", r.status, 200);
  eq("save 收到 body", r.body.got && r.body.got.scale, 1.2);

  r = await req("/api/packs/active", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "dafeiyu" }),
  });
  eq("POST /api/packs/active 200", r.status, 200);
  ok("切换模型后补发了 pack-changed", logs.some((x) => x === "notify:pack-changed:dafeiyu"));

  // ── 2. 找不到的包：是 404，但说的是人话 ────────────────────
  r = await req("/api/packs/nosuchpack");
  eq("不存在的包回 404", r.status, 404);
  eq("不存在的包文案", r.body.error, "找不到这个模型包");

  // ── 3. 没接住的接口：404 必须带够信息，否则没法排查 ─────────
  r = await req("/api/packs/deep/nested/thing");
  eq("未接住的 GET 回 404", r.status, 404);
  eq("未接住的文案", r.body.error, "没有这个接口");
  eq("404 回带 url", r.body.url, "/api/packs/deep/nested/thing");
  eq("404 回带 method", r.body.method, "GET");
  has("404 回带 hint", r.body.hint, "重启应用");

  const before = logs.length;
  await req("/api/packs/deep/nested/thing");
  eq("同一个 miss 不重复写日志", logs.length, before);
  ok("第一次 miss 写了日志", logs.some((x) => x.includes("没有这个接口") && x.includes("GET /api/packs/deep/nested/thing")));

  r = await req("/api/packs/dafeiyu/unknownverb");
  eq("已存在 id + 未知子路径也回 404", r.status, 404);
  eq("未知子路径 method 记录正确", r.body.method, "GET");
  eq("未知子路径 url 完整", r.body.url, "/api/packs/dafeiyu/unknownverb");

  r = await req("/api/packs/dafeiyu/save");
  eq("POST 接口用 GET 打 → 404（不是 500）", r.status, 404);
  eq("GET 打 save 的 method 是 GET", r.body.method, "GET");

  // ── 4. 不该被接管的路径要原样交回去 ───────────────────────
  const notOurs = await fetch(base + "/src/index.html");
  eq("非 /api/packs 路径交回静态兜底", notOurs.status, 404);
  eq("静态兜底文案", await notOurs.text(), "static miss");

  // ── 5. /packs/ 静态资源：只认包内文件，不许穿目录 ──────────
  // 注意 servePackFile 取的是 ctx.adapter.store.dirOf(id)（返回 { dir, base }），
  // 不是 adapter.dirOf —— 只挂 adapter.dirOf 会让整个分支直接抛错，测出来的是假绿。
  const packDir = path.join(tmp, "dafeiyu");
  fs.mkdirSync(packDir, { recursive: true });
  fs.writeFileSync(path.join(packDir, "a.txt"), "hello");
  fakeAdapter.store = { dirOf: () => ({ dir: packDir, base: packDir }) };

  r = await fetch(base + "/packs/dafeiyu/a.txt");
  eq("包内文件正常返回", r.status, 200);
  eq("包内文件内容", await r.text(), "hello");

  r = await fetch(base + "/packs/dafeiyu/nosuch.txt");
  eq("包内不存在的文件 404", r.status, 404);

  fs.writeFileSync(path.join(tmp, "secret.txt"), "TOPSECRET");
  r = await fetch(base + "/packs/dafeiyu/..%2Fsecret.txt");
  ok("穿目录（上级文件）不放行", r.status === 404 || r.status === 403, "实际 " + r.status);
  if (r.status === 200) ok("穿目录时没漏内容", !(await r.text()).includes("TOPSECRET"));

  r = await fetch(base + "/packs/dafeiyu/..%2F..%2Fetc%2Fpasswd");
  ok("穿目录（多层）不放行", r.status === 404 || r.status === 403, "实际 " + r.status);

  server.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }

  console.log("");
  console.log("结果：" + pass + " 通过，" + fail + " 失败");
  if (fail) { failures.forEach((f) => console.log("  × " + f)); process.exit(1); }
}

main().catch((e) => {
  console.error("test-packs-http 自己出错：" + (e && e.stack || e));
  if (server) try { server.close(); } catch (err) { }
  process.exit(2);
});
