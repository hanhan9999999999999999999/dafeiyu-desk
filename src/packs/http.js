"use strict";
// 模型包的 HTTP 接口。
//
// 为什么不塞进 server.js：那边的路由已经是一条 400 行的 if/else 长链，再挂十几个
// 模型接口会变成一坨。这里做成「给我 url，我来判要不要接管」的独立模块，server.js
// 只要在链子最前面调一次就行。以后加规则相关的接口也只改这个文件。
//
// 两条路由前缀：
//   /api/packs...   适配器窗口用的 JSON 接口（只给本机，不带鉴权，靠 127.0.0.1 绑定）
//   /packs/<id>/..  模型文件本体（贴图、moc3、physics…），渲染端直接当静态资源拉

const fs = require("fs");
const path = require("path");
const M = require("./manifest");

// 模型包只需要这几种。故意不收 .html/.js/.svg：包是用户从外面拖进来的，
// 里面塞一个 html 就能在本服务的 origin 下跑脚本 —— 虽然只绑了 127.0.0.1，
// 但同源策略对它自己的端口是完全放开的，没必要留这个口子。
const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".json": "application/json; charset=utf-8",
  ".moc3": "application/octet-stream",
  ".physics3": "application/json; charset=utf-8",
  ".cdi3": "application/json; charset=utf-8",
  ".motion3": "application/json; charset=utf-8",
  ".exp3": "application/json; charset=utf-8",
  ".pose3": "application/json; charset=utf-8",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

const BODY_LIMIT = 6 * 1024 * 1024;

function json(res, code, obj) {
  const buf = Buffer.from(JSON.stringify(obj), "utf8");
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": buf.length,
    "cache-control": "no-store",
  });
  res.end(buf);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error("请求体太大"), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(Object.assign(new Error("JSON 解析失败: " + e.message), { statusCode: 400 })); }
    });
    req.on("error", reject);
  });
}

// 把 /packs/<id>/a/b.png 拆成 id 和相对路径，并挡掉穿越。
function parsePackPath(url) {
  const rest = url.slice("/packs/".length);
  const i = rest.indexOf("/");
  if (i <= 0) return null;
  const id = rest.slice(0, i);
  let rel = rest.slice(i + 1);
  try { rel = decodeURIComponent(rel); } catch (e) { return null; }
  if (!M.ID_RE.test(id)) return null;
  if (!M.isSafeRel(rel)) return null;
  return { id, rel };
}

function servePackFile(req, res, url, ctx) {
  const parsed = parsePackPath(url);
  if (!parsed) { res.writeHead(404).end("not found"); return true; }
  const hit = ctx.adapter.store.dirOf(parsed.id);
  if (!hit) { res.writeHead(404).end("not found"); return true; }
  const ext = path.extname(parsed.rel).toLowerCase();
  const type = MIME[ext];
  if (!type) { res.writeHead(403).end("forbidden type"); return true; }

  // 覆盖层（本机配置）只有 pet.json，模型本体还在安装目录 —— 静态文件也要回落，
  // 否则用户改一次配置，贴图和 moc3 就全 404，主窗口直接白屏。
  const pick = (base) => {
    if (!base) return "";
    const p = path.join(base, parsed.rel);
    const relTo = path.relative(base, p);
    if (relTo.startsWith("..") || path.isAbsolute(relTo)) return "";
    try { return fs.statSync(p).isFile() ? p : ""; } catch (e) { return ""; }
  };
  const full = pick(hit.dir) || pick(hit.base);
  if (!full) { res.writeHead(404).end("not found"); return true; }

  let st;
  try { st = fs.statSync(full); } catch (e) { res.writeHead(404).end("not found"); return true; }
  if (!st.isFile()) { res.writeHead(404).end("not found"); return true; }

  // 大文件（moc3 十几兆、贴图几兆）走 Range：Chromium 的 <img> 和 Live2D 引擎
  // 都会带 Range 来要；不回 Range 也能用，但每次全量重读会明显拖慢切换模型。
  const range = req.headers.range;
  const total = st.size;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
    if (m) {
      let start = m[1] === "" ? null : Number(m[1]);
      let end = m[2] === "" ? null : Number(m[2]);
      if (start === null) { start = Math.max(0, total - (end || 0)); end = total - 1; }
      else if (end === null || end >= total) end = total - 1;
      if (start > end || start >= total) {
        res.writeHead(416, { "content-range": "bytes */" + total }).end();
        return true;
      }
      res.writeHead(206, {
        "content-type": type,
        "content-length": end - start + 1,
        "content-range": "bytes " + start + "-" + end + "/" + total,
        "accept-ranges": "bytes",
        "cache-control": "no-store",
      });
      fs.createReadStream(full, { start, end }).pipe(res);
      return true;
    }
  }
  res.writeHead(200, {
    "content-type": type,
    "content-length": total,
    "accept-ranges": "bytes",
    "cache-control": "no-store",
  });
  fs.createReadStream(full).pipe(res);
  return true;
}

// 返回 true 表示这个请求已经被接管（调用方不要再走静态兜底）。
function serve(req, res, url, q, ctx) {
  const method = req.method || "GET";
  const isGet = method === "GET" || method === "HEAD";

  if (url.startsWith("/packs/")) {
    if (!isGet) { res.writeHead(405).end(); return true; }
    return servePackFile(req, res, url, ctx);
  }

  if (!url.startsWith("/api/packs")) return false;

  const { adapter } = ctx;
  const api = (fn) => {
    Promise.resolve()
      .then(fn)
      .then((r) => {
        // null 是「没这个东西」：open/getManifest/check 对没找到的 id 都返回 null，
        // 不能包装成 ok:true 的空对象，否则界面会拿到一个 undefined 到处炸。
        if (r == null) return json(res, 404, { ok: false, error: "找不到这个模型包" });
        json(res, 200, Object.assign({ ok: true }, r));
      })
      .catch((e) => {
        const code = Number(e && e.statusCode) || 500;
        if (code >= 500) ctx.logErr("[packs] " + (e && e.stack ? e.stack : e));
        json(res, code, { ok: false, error: String((e && e.message) || e) });
      });
  };

  // ── 列表 / 规则表 / 目录检查 / 导入 ───────────────────────────
  // 注意顺序：/api/packs/rules 必须排在 /api/packs/:id 前面，否则会被当成 id="rules"。
  if (url === "/api/packs" && isGet) { api(() => adapter.list()); return true; }
  if (url === "/api/packs/rules" && isGet) { api(() => ({ rules: adapter.rules.schema() })); return true; }

  // 当前生效模型的运行时配置。渲染端启动时只调这一个，不用先知道 id。
  if (url === "/api/packs/active" && isGet) { api(() => adapter.getManifest()); return true; }

  if (url === "/api/packs/active" && method === "POST") {
    api(async () => {
      const b = await readBody(req, BODY_LIMIT);
      const r = adapter.activate(b.id);
      // 走 HTTP 切换模型的调用方（适配器、自动化脚本）不会经过 main 的 IPC，
      // 主窗口收不到通知就会一直显示上一个模型 —— 这里补发同一条消息。
      try { if (ctx.notify) ctx.notify("pack-changed", b.id); } catch (e) { }
      return r;
    });
    return true;
  }

  if (url === "/api/packs/check" && isGet) {
    const p = q.get("path");
    // path= 是「这个外部目录 / 压缩包能不能导入」；id= 是「这个已安装的包还健康吗」。
    if (p) api(() => adapter.inspectPath(p));
    else api(() => adapter.check(q.get("id") || ""));
    return true;
  }

  if (url === "/api/packs/import" && method === "POST") {
    api(async () => {
      const b = await readBody(req, BODY_LIMIT);
      const opts = { id: b.id, name: b.name, displayName: b.name, copy: b.copy !== false };
      // 路径以 .zip 结尾就走解包导入；不靠前端传「类型」，免得前端判断和实际文件不一致
      if (/\.zip$/i.test(String(b.path || ""))) return adapter.importArchive(b.path, opts);
      return adapter.importDir(b.path, opts);
    });
    return true;
  }

  const m = /^\/api\/packs\/([a-z0-9][a-z0-9_-]{0,63})(\/[a-z]+)?$/.exec(url);
  if (!m) { json(res, 404, { ok: false, error: "没有这个接口" }); return true; }
  const id = m[1];
  const sub = m[2] || "";

  if (!sub && isGet) { api(() => adapter.open(id)); return true; }
  if (sub === "/manifest" && isGet) { api(() => adapter.getManifest(id)); return true; }
  if (sub === "/diagnose" && isGet) { api(() => adapter.diagnose(id)); return true; }
  if (sub === "/autofill" && isGet) { api(() => adapter.autofill(id)); return true; }
  if (sub === "/recommend" && isGet) { api(() => adapter.recommendLayout(id)); return true; }
  if (sub === "/builtin" && isGet) {
    api(() => {
      const b = adapter.builtin();
      return { scenes: b.scenes, motionCount: b.actionCount, paramRefs: b.paramRefs };
    });
    return true;
  }
  if (sub === "/save" && method === "POST") {
    api(async () => {
      const b = await readBody(req, BODY_LIMIT);
      return adapter.save(id, b);
    });
    return true;
  }
  if (sub === "/duplicate" && method === "POST") {
    api(async () => {
      const b = await readBody(req, BODY_LIMIT);
      return adapter.duplicate(id, b.newId, b.name);
    });
    return true;
  }
  if (sub === "/reset" && method === "POST") {
    api(async () => {
      const r = adapter.resetConfig(id);
      if (!r) return null;
      // 用户重置的正好是当前在用的模型：让主窗口重读配置（取景/表情/动作路由都变了）
      if (id === adapter.activeId()) {
        // 取景在 settings.viewBox 里还留着「给这个包调过的那一框」，它的优先级高于包默认值。
        // 不清掉的话用户点完「恢复默认」会发现画面一点没变 —— 因为真正生效的是那一框。
        try { ctx.patchSettings({ viewBox: { y: -0.02, h: 0.40, pack: "" } }); } catch (e) { }
      }
      if (id === adapter.activeId() && ctx.notify) {
        try { ctx.notify("pack-changed", id); } catch (e) { }
      }
      return r;
    });
    return true;
  }
  if (sub === "/remove" && method === "POST") {
    api(async () => {
      const b = await readBody(req, BODY_LIMIT);
      const was = adapter.activeId();
      const r = adapter.remove(id, { force: !!b.force });
      // 删掉的正好是当前在用的那个：主窗口还指着它，得让它换到新的包上。
      // 否则画面靠缓存还撑着，下一次操作就空白了 —— 用户会以为是「删东西把软件删坏了」。
      if (r && adapter.activeId() !== was && ctx.notify) {
        try { ctx.notify("pack-changed", adapter.activeId()); } catch (e) { }
      }
      return r;
    });
    return true;
  }
  if (sub === "/export" && isGet) {
    api(() => adapter.exportManifest(id));
    return true;
  }

  json(res, 404, { ok: false, error: "没有这个接口" });
  return true;
}

module.exports = { serve, MIME };
