// 闲置词缓存的逻辑自测。
//
// 这套东西最容易坏在四个地方，所以四条都真的验一遍：
//   一、缓存目录的命名（引擎/音色/句子哈希）—— 拼错了就永远不命中，症状是「缓存了但没变快」；
//   二、路径穿越（/idle/../../ 之类）—— 本地服务任何网页都能打，必须挡；
//   三、回落记账 —— 飞鱼失败回落 TTS 时，那句话不能存进飞鱼目录（否则以后一直用错的声音）；
//   四、增量 —— 第二次跑要跳过已有的，不然每次都要重合成 324 句。
//
// 用一个假的 HTTP 服务代替真引擎：合成要真模型，但缓存逻辑不该依赖模型。
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const { createIdleCache } = require("../src/idle-cache");
const Lines = require("../src/lines");

const AUDIO = Buffer.alloc(4096, 7);   // 假音频：只要 > 512 字节就会被当成有效文件

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log("✅ " + name); }
  else { fail += 1; console.log("❌ " + name + (extra ? "  → " + extra : "")); }
}

// 假引擎：/engine/tts 回一句「合好了」，/a.mp3 回一段假音频。
// mode=fallback 时故意报「其实是 tts 念的」，用来验回落记账。
function fakeEngine() {
  let mode = "ok";
  const srv = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/engine/tts") {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        const j = { ok: true, url: "/a.mp3", engine: mode === "fallback" ? "tts" : "feiyu", voice: mode === "fallback" ? "zh-CN-XiaoxiaoNeural" : "cute" };
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(j));
      });
      return;
    }
    if (req.url === "/a.mp3") {
      res.writeHead(200, { "content-type": "audio/mpeg", "content-length": AUDIO.length }).end(AUDIO);
      return;
    }
    res.writeHead(404).end("no");
  });
  return { srv, setMode: (m) => { mode = m; } };
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "idle-cache-test-"));
  const { srv, setMode } = fakeEngine();
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const port = srv.address().port;
  let child;
  try {
    const cache = createIdleCache({ root, base: () => "http://127.0.0.1:" + port });

    // ── 台词池 ──
    const all = Lines.idleLines();
    ok("闲置词池子摊平后不为空", all.length > 200, String(all.length));
    ok("闲置词去重（同一句只出现一次）", new Set(all.map((x) => x.text)).size === all.length);
    ok("每条都有 key 和 text", all.every((x) => x.key && x.text));
    ok("IDLE_KEYS 里的键都真实存在", Lines.IDLE_KEYS.every((k) => Array.isArray(Lines.LINES[k])));

    // ── 一开始是空的 ──
    const s0 = cache.status("feiyu", "cute");
    ok("初始状态：缓存 0 句", s0.cached === 0 && s0.total === all.length, JSON.stringify(s0));

    // ── 合成 5 句（limit 只给测试用）──
    const r1 = await cache.build({ engine: "feiyu", voice: "cute", limit: 5 });
    ok("合成 5 句成功", r1.cached === 5, JSON.stringify({ cached: r1.cached, failed: r1.failed }));
    ok("5 句都落了盘", cache.status("feiyu", "cute").files === 5);
    const lookup = cache.lookup("feiyu", "cute", all[0].text);
    ok("命中查询能拿到 URL", lookup.ok === true && /^\/idle\/feiyu\/cute\//.test(lookup.url), JSON.stringify(lookup));
    ok("不同音色不命中（缓存按音色分目录）", cache.lookup("feiyu", "other", all[0].text).ok === false);

    // ── 增量：再跑一次不该重合成 ──
    const r2 = await cache.build({ engine: "feiyu", voice: "cute", limit: 5 });
    ok("第二次跑跳过已缓存的句子", r2.failed === 0 && r2.cached === 5);

    // ── 路径穿越 ──
    ok("挡住 ../ 穿越", cache.resolveRel("feiyu/../../../etc/passwd") === null);
    ok("挡住异常文件名", cache.resolveRel("feiyu/cute/..%2F..%2Fpasswd") === null);
    ok("正常相对路径能解析", typeof cache.resolveRel("feiyu/cute/abc.mp3") === "string");

    // ── 回落记账：不能把 TTS 的声音存进飞鱼目录 ──
    setMode("fallback");
    const before = cache.status("xtts", "xtts").files;
    const r3 = await cache.build({ engine: "xtts", voice: "xtts", limit: 2 });
    ok("回落到别的引擎时不算命中、不落盘", r3.cached === 0 && cache.status("xtts", "xtts").files === before, JSON.stringify(r3));
    ok("回落失败会留下可读的原因", (r3.errors || []).length > 0, JSON.stringify(r3.errors));
    setMode("ok");

    // ── 清空 ──
    const c = cache.clear("feiyu", "cute");
    ok("清空删掉了文件", c.ok && c.removed === 5, JSON.stringify(c));
    ok("清空后查询不再命中", cache.lookup("feiyu", "cute", all[0].text).ok === false);

    // ── 目录列表 ──
    // 假引擎只会回 feiyu/cute 这套身份，所以这里也用 feiyu/cute 重建（换别的会被回落记账挡掉）。
    await cache.build({ engine: "feiyu", voice: "cute", limit: 2 });
    const list = cache.statusAll();
    ok("能列出各引擎/音色的占用", list.length >= 1 && list.every((x) => x.files > 0), JSON.stringify(list));
  } catch (e) {
    fail += 1;
    console.log("❌ 抛异常：" + (e && e.stack || e));
  } finally {
    // 先把连接收干净再关服务：直接 close 会挂在 keep-alive 上，
    // 后面 process 不退出，CI 里看着像卡死。
    await new Promise((r) => { srv.close(r); srv.closeAllConnections && srv.closeAllConnections(); });
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (e) { }
    console.log("\n结果：" + pass + " 通过，" + fail + " 失败");
    process.exitCode = fail ? 1 : 0;
  }
})();
