// 本地静态服务 + 内置语音引擎路由。
//
// 为什么必须有这个服务：file:// 协议下 fetch 会被同源策略挡住，
// 模型贴图、vendor 脚本、音频全都读不出来。所以窗口里的一切都走 http://127.0.0.1:PORT。
//
// 端口为什么固定：Chromium 的 deviceId 是按 origin 隔离的。每次启动换端口 →
// origin 变 → 设置窗口里选的麦克风，主窗口认不出同一个设备。

const http = require("node:http");
const fs = require("node:fs");

const path = require("node:path");
const { pathToFileURL } = require("node:url");
const packHttp = require("./packs/http");

function readBody(req, limit = 24 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on("data", (c) => {
      n += c.length;
      if (n > limit) { reject(new Error("请求体过大")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// JSON 请求体：空 body 当 `{}`，解析失败给 400 而不是冒到全局 catch 变成 500。
// 前端拿到 400 + 明确文案，才知道「是我发的数据有问题」，而不是「引擎挂了」。
async function readJson(req, limit) {
  const raw = (await readBody(req, limit)).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    const err = new Error("请求体不是合法 JSON");
    err.statusCode = 400;
    throw err;
  }
}

function startServer(opts) {
  const { root, mime, log, logErr, getSettings, patchSettings, engines, notify, adapter, rvcFetch, rvcStatus } = opts;
  const srv = http.createServer((req, res) => {
    try {
      // 所有响应统一带的安全头。挂件跑在本地，真正的威胁不是远端攻击者，
      // 而是「某个页面被当成浏览器用」：嗅探出来的 MIME 会执行、被别的窗口 iframe
      // 进来能点、referer 会把本机路径带出去。三条头各堵一头。
      try {
        res.setHeader("x-content-type-options", "nosniff");
        res.setHeader("x-frame-options", "DENY");
        res.setHeader("referrer-policy", "no-referrer");
      } catch (e) { /* 头已发出去就跳过，不能让安全头本身把请求搞崩 */ }

      const url = decodeURIComponent((req.url || "/").split("?")[0]);
      const q = new URLSearchParams((req.url || "").split("?")[1] || "");

      // ── 模型包：适配器接口 + 模型文件本体 ──────────
      // 挂在所有路由最前面。它自己判前缀，不是 /api/packs* 或 /packs/* 就返回 false，
      // 让后面的 TTS/RVC/静态兜底照常走。
      if (adapter) {
        let handled = false;
        try { handled = packHttp.serve(req, res, url, q, { adapter, logErr, notify, patchSettings }); }
        catch (e) { logErr("[server] 模型包接口出错: " + (e && e.stack ? e.stack : e)); }
        if (handled) return;
      }

      // ── 内置 TTS：文字 → 音频文件 ──────────────────
      // ── 有哪些声音可选（设置页的下拉用） ──────────
      if (url === "/engine/voices" && req.method === "GET") {
        (async () => {
          try {
            const tts = await engines.tts();
            res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
            res.end(JSON.stringify({ ok: true, voices: tts.VOICES || [], defaultVoice: tts.DEFAULT_VOICE || "" }));
          } catch (e) {
            res.writeHead(Number(e && e.statusCode) || 500, { "content-type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
          }
        })();
        return;
      }

      // 预热：应用启动时如果选的是飞鱼，先在后台把模型装进显存。
      // 不生成音频，只为把那 17-22 秒从「她第一次开口」挪到「刚启动没人看」的时候。
      if (url === "/engine/warm" && req.method === "POST") {
        (async () => {
          try {
            const st = getSettings();
            const f = await engines.feiyu();
            if (!f.available()) throw new Error("飞鱼环境不全");
            const r = await f.warm({ style: st.feiyuStyle || "cute", refDir: st.feiyuRefDir || "", timeout: 240000 });
            res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
            res.end(JSON.stringify(r));
          } catch (e) {
            const msg = String(e && e.message || e);
            log("[main] 飞鱼预热失败: " + msg);
            res.writeHead(Number(e && e.statusCode) || 500, { "content-type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: false, error: msg }));
          }
        })();
        return;
      }

      // 反向开关：用户把「启动时预热」关掉时立刻还内存。
      if (url === "/engine/unload" && req.method === "POST") {
        (async () => {
          try {
            const f = await engines.feiyu();
            if (f && f.release) f.release();
            res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
          }
        })();
        return;
      }

      if (url === "/engine/tts" && req.method === "POST") {
        (async () => {
          try {
            const body = await readJson(req);

            // ── 飞鱼（CosyVoice3）：中文原生，不卷舌 ──
            // 放在 XTTS 前面：飞鱼比 XTTS 慢一点（rtf 1.19 vs 0.31），
            // 但音色明显更贴原声（质心 3411 / >8k 15.14% / 过零 3829，对比原声 3711 / 18.38 / 3880）。
            if ((getSettings().voiceOut || "") === "feiyu") {
              try {
                const f = await engines.feiyu();
                if (!f.available()) throw new Error("飞鱼环境不全");
                const r = await f.synth(body.text, {
                  style: getSettings().feiyuStyle || "cute",
                  speed: Number(getSettings().feiyuSpeed) || 0,
                  // 空字符串 = 让服务按这句话的情绪自己挑参考音频
                  ref: getSettings().feiyuRef || "",
                  // 用户自己指定的参考音频文件夹；留空 = 包内 assets/refvoice
                  refDir: getSettings().feiyuRefDir || "",
                  // 冷启动要加载 24 秒，先让她说一句「等一下」，
                  // 不然前端就是干等二十几秒，看着像死了。
                  onWait: () => {
                    // startServer 里没有 win（它属于 main.js 的窗口作用域），
                    // 由 main.js 通过 opts.notify 传进来。
                    try { notify && notify("tts-waiting", "等一下……我在准备声音。"); } catch (e) { }
                  },
                });
                const name = path.basename(r.file);
                res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
                res.end(JSON.stringify({
                  ok: true, name, url: `/engine/audio/${name}`,
                  dur: r.dur || 0, engine: "feiyu", cached: r.cached, voice: "feiyu",
                  ref: r.ref || "",
                }));
                return;
              } catch (e) {
                log("[main] 飞鱼失败，回落: " + (e && e.message || e));
              }
            }

            // ── XTTS：直接从参考音频克隆音色，不走「先念再转换」那两道工序 ──
            // 只在设置里明确选了 xtts 时才走；任何一步出问题都回落 Edge，
            // 绝不让她没声（这是整条语音链的第一原则）。
            if ((getSettings().voiceOut || "") === "xtts") {
              try {
                const x = await engines.xtts();
                if (!x.available()) throw new Error("XTTS 环境不全");
                const r = await x.synth(body.text, {
                  ref: getSettings().xttsRef || undefined,
                  speed: Number(getSettings().xttsSpeed) || 1,
                });
                const name = path.basename(r.file);
                res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
                res.end(JSON.stringify({
                  ok: true, name, url: `/engine/audio/${name}`,
                  dur: r.dur || 0, engine: "xtts", cached: r.cached, voice: "xtts",
                }));
                return;
              } catch (e) {
                log("[main] XTTS 失败，回落 Edge: " + (e && e.message || e));
              }
            }

            const tts = await engines.tts();
            const r = await tts.synth(body.text, body.voice, body.emotion, body.intensity);
            res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
            res.end(JSON.stringify({
              ok: true,
              name: r.name,
              url: `/engine/audio/${r.name}`,
              dur: r.dur,
              engine: r.engine,
              cached: r.cached,
              // 实际用的音色（引擎可能回落），前端日志里带上，换声音出问题好查
              voice: r.voice || r.asked || "",
            }));
          } catch (e) {
            res.writeHead(Number(e && e.statusCode) || 500, { "content-type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
          }
        })();
        return;
      }

      // ── 飞鱼流式：边合成边吐，首块 2-3 秒就能开口 ──────────
      // /engine/tts 是「整段算完再回文件」，30 字要等 8-12 秒；这条把
      // feiyu_server 的 NDJSON 原样转给渲染进程，第一个 chunk 到了就能播，
      // 后面的在她说话的时候继续算（合成线程和播放线程并行）。
      if (url === "/engine/tts_stream" && req.method === "POST") {
        (async () => {
          let started = false;
          const send = (obj) => {
            try { res.write(JSON.stringify(obj) + "\n"); } catch (e) { }
          };
          try {
            const body = await readJson(req);
            const f = await engines.feiyu();
            if (!f.available()) throw new Error("飞鱼环境不全");
            const st = getSettings();
            res.writeHead(200, {
              "content-type": "application/x-ndjson; charset=utf-8",
              "cache-control": "no-store",
              "x-accel-buffering": "no",
            });
            started = true;
            const it = f.stream(body.text, {
              style: st.feiyuStyle || "cute",
              speed: Number(st.feiyuSpeed) || 0,
              ref: st.feiyuRef || "",
              refDir: st.feiyuRefDir || "",
              onMeta: (m) => send({ t: "meta", ready: m.ready, fp16: m.fp16, device: m.device, style: m.style }),
              onFirst: (m) => send({ t: "first", ms: m.ms }),
              onDone: (m) => send({ t: "done", ms: m.ms, firstMs: m.firstMs, chunks: m.chunks }),
            });
            for await (const c of it) {
              send({ t: "chunk", i: c.i, n: c.n, dur: c.dur, b64: c.wav.toString("base64") });
            }
            res.end();
          } catch (e) {
            const msg = String(e && e.message || e);
            log("[main] 飞鱼流式失败: " + msg);
            if (!started) {
              res.writeHead(Number(e && e.statusCode) || 500, { "content-type": "application/json; charset=utf-8" });
              res.end(JSON.stringify({ ok: false, error: msg }));
            } else {
              send({ t: "err", error: msg });
              try { res.end(); } catch (e2) { }
            }
          }
        })();
        return;
      }

      // ── RVC：音频二进制 → 换音色的音频二进制 ────────
      if (url === "/engine/rvc/health" && req.method === "GET") {
        (async () => {
          try {
            const r = await rvcFetch("/health", { timeoutMs: 3500 });
            const j = await r.json();
            res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
            res.end(JSON.stringify({ ...j, proc: rvcStatus() }));
          } catch (e) {
            // catch 里也不能假设 rvcStatus 安全：它自己抛出去的话就没有人写 res，
            // 前端会一直等到超时（这个坑真踩过 —— rvcStatus 忘了从 main.js 传进来）。
            let st = null;
            try { st = rvcStatus(); } catch (e2) { st = { error: "状态读取失败：" + (e2 && e2.message) }; }
            res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
            res.end(JSON.stringify({ ok: false, error: String(e && e.message || e), proc: st }));
          }
        })();
        return;
      }

      if (url === "/engine/rvc" && req.method === "POST") {
        (async () => {
          try {
            const buf = await readBody(req, 64 * 1024 * 1024);
            const pitch = q.get("pitch") || "0";
            const f0 = q.get("f0") || "rmvpe";
            const r = await rvcFetch("/convert?f0=" + encodeURIComponent(f0) + "&pitch=" + encodeURIComponent(pitch), {
              method: "POST",
              headers: { "content-type": "audio/wav" },
              body: buf,
              timeoutMs: 120000,
            });
            if (!r.ok) {
              const t = await r.text();
              res.writeHead(Number(e && e.statusCode) || 500, { "content-type": "application/json; charset=utf-8" });
              res.end(JSON.stringify({ ok: false, error: t.slice(0, 500) }));
              return;
            }
            const out = Buffer.from(await r.arrayBuffer());
            res.writeHead(200, { "content-type": "audio/wav", "content-length": String(out.length), "cache-control": "no-store" });
            res.end(out);
          } catch (e) {
            res.writeHead(Number(e && e.statusCode) || 500, { "content-type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: false, error: String(e && e.message || e) }));
          }
        })();
        return;
      }

      // ── 内置 ASR：音频二进制 → 文字 ────────────────
      if (url === "/engine/asr" && req.method === "POST") {
        (async () => {
          try {
            const buf = await readBody(req);
            const asr = await engines.asr();
            const r = await asr.transcribe(buf, q.get("ext") || "wav");
            res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
            res.end(JSON.stringify({ ok: true, text: r.text, raw: r.raw, ms: r.ms }));
          } catch (e) {
            // 输入不合格（太短/太大/没声音/上一条还在认）不是服务故障，回 400 并带 badInput。
            // 回 500 会让 voice.js 以为引擎挂了，转头去回落那条早已下线的 /api/asr-legacy（404）。
            const bad = !!(e && e.badInput);
            res.writeHead(bad ? 400 : 500, { "content-type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ ok: false, badInput: bad, error: String(e && e.message || e) }));
          }
        })();
        return;
      }

      // ── 取回合成好的音频 ───────────────────────────
      // 必须支持 Range：<audio> 播放时通常会带 `Range: bytes=0-` 来边下边播，
      // 服务端如果只会回 200 全量，Chromium 会判成「源不支持」（MediaError code=4），
      // 表现就是「合成成功、取得到文件、但一播就失败」。
      if (url.startsWith("/engine/audio/")) {
        (async () => {
          try {
            const name = url.slice("/engine/audio/".length);
            const tts = await engines.tts();
            // audioPath 内部校验文件名格式，挡掉路径穿越
            const f = tts.audioPath(name);
            if (!f) { res.writeHead(404).end("not found"); return; }
            const stat = fs.statSync(f);
            // stat 成功不代表能读：路径可能是个目录（大小 0），readFileSync 会抛 EISDIR。
            if (!stat.isFile()) { res.writeHead(404).end("not found"); return; }
            const total = stat.size;
            const type = f.endsWith(".mp3") ? "audio/mpeg" : "audio/wav";
            const range = req.headers.range;
            const m = range && /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
            if (m) {
              let start = m[1] === "" ? null : Number(m[1]);
              let end = m[2] === "" ? null : Number(m[2]);
              if (start === null && end === null) {
                res.writeHead(416, { "content-range": "bytes */" + total }).end();
                return;
              }
              if (start === null) {           // 只要末尾 N 字节
                start = Math.max(0, total - end);
                end = total - 1;
              } else if (end === null || end >= total) {
                end = total - 1;
              }
              if (start > end || start >= total) {
                res.writeHead(416, { "content-range": "bytes */" + total }).end();
                return;
              }
              res.writeHead(206, {
                "content-type": type,
                "content-length": end - start + 1,
                "content-range": "bytes " + start + "-" + end + "/" + total,
                "accept-ranges": "bytes",
                "cache-control": "no-store",
              });
              fs.createReadStream(f, { start, end }).pipe(res);
              return;
            }
            // 先读出来再发头。如果先 writeHead(200) 再 readFileSync，
            // 读失败时头已经出去了，catch 里的 writeHead(500) 会抛 ERR_HTTP_HEADERS_SENT，
            // 客户端却还按已发的 content-length 等着 —— 连接就这么挂死。
            const buf = fs.readFileSync(f);
            res.writeHead(200, {
              "content-type": type,
              "content-length": buf.length,
              "accept-ranges": "bytes",
              "cache-control": "no-store",
            });
            res.end(buf);
          } catch (e) {
            // 别把 String(e) 直接回给调用方：里面有完整的本机路径和堆栈。
            // 本地服务也不是人人可读的——任何网页都能用 <img> 打这个端口。
            logErr("[server] 音频读取失败: " + e);
            res.writeHead(500, { "content-type": "text/plain; charset=utf-8" }).end("internal error");
          }
        })();
        return;
      }

      // ── 语气词：预生成在 assets/voice/，不参与 TTS 的 LRU 清理 ────────
      // 点击她时立刻要出声，走合成太慢，所以是固定的 23 条短音（0.2–0.5 秒）。
      if (url.startsWith("/voice/")) {
        (async () => {
          try {
            const name = url.slice("/voice/".length);
            // 只认 字母数字-_. 且不能含 ..，挡掉路径穿越
            if (!/^[a-z0-9_.-]+$/i.test(name) || name.includes("..")) {
              res.writeHead(403).end("forbidden");
              return;
            }
            const dir = path.join(__dirname, "..", "assets", "voice");
            const f = path.join(dir, name);
            if (!f.startsWith(dir) || !fs.existsSync(f)) { res.writeHead(404).end("not found"); return; }
            const stat = fs.statSync(f);
            // stat 成功不代表能读：路径可能是个目录（大小 0），readFileSync 会抛 EISDIR。
            if (!stat.isFile()) { res.writeHead(404).end("not found"); return; }
            const total = stat.size;
            const type = f.endsWith(".mp3") ? "audio/mpeg" : "audio/wav";
            const range = req.headers.range;
            const m = range && /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
            if (m) {
              let start = m[1] === "" ? null : Number(m[1]);
              let end = m[2] === "" ? null : Number(m[2]);
              if (start === null && end === null) {
                res.writeHead(416, { "content-range": "bytes */" + total }).end();
                return;
              }
              if (start === null) {
                start = Math.max(0, total - end);
                end = total - 1;
              } else if (end === null || end >= total) {
                end = total - 1;
              }
              if (start > end || start >= total) {
                res.writeHead(416, { "content-range": "bytes */" + total }).end();
                return;
              }
              res.writeHead(206, {
                "content-type": type,
                "content-length": end - start + 1,
                "content-range": "bytes " + start + "-" + end + "/" + total,
                "accept-ranges": "bytes",
                "cache-control": "no-store",
              });
              fs.createReadStream(f, { start, end }).pipe(res);
              return;
            }
            // 先读出来再发头。如果先 writeHead(200) 再 readFileSync，
            // 读失败时头已经出去了，catch 里的 writeHead(500) 会抛 ERR_HTTP_HEADERS_SENT，
            // 客户端却还按已发的 content-length 等着 —— 连接就这么挂死。
            const buf = fs.readFileSync(f);
            res.writeHead(200, {
              "content-type": type,
              "content-length": buf.length,
              "accept-ranges": "bytes",
              "cache-control": "no-store",
            });
            res.end(buf);
          } catch (e) {
            // 别把 String(e) 直接回给调用方：里面有完整的本机路径和堆栈。
            // 本地服务也不是人人可读的——任何网页都能用 <img> 打这个端口。
            logErr("[server] 音频读取失败: " + e);
            res.writeHead(500, { "content-type": "text/plain; charset=utf-8" }).end("internal error");
          }
        })();
        return;
      }

      const rel = url === "/" ? "/src/index.html" : url;
      const full = path.join(root, rel);
      // 只判 startsWith(root) 不够：`C:\app\resources-evil` 也以 `C:\app\resources` 开头。
      // path.relative 不以 `..` 开头、且不是绝对路径（跨盘时它会返回绝对路径），才算真的在根下面。
      const relToRoot = path.relative(root, full);
      if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
        res.writeHead(403).end();
        return;
      }
      fs.readFile(full, (err, buf) => {
        if (err) { res.writeHead(404).end("not found"); return; }
        res.writeHead(200, {
          "content-type": mime[path.extname(full).toLowerCase()] || "application/octet-stream",
          "cache-control": "no-store",
        });
        res.end(buf);
      });
    } catch (e) {
      logErr("[server] 请求处理失败: " + (e && e.stack ? e.stack : e));
      try {
        if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" }).end("internal error");
        else res.end();
      } catch (x) { /* 连接已断，写不回去就算了 */ }
    }
  });
  // 端口必须固定：Chromium 的 deviceId 是按 origin 隔离的，
  // 每次启动换端口 → origin 变 → 设置窗口里选的麦克风 id 在主窗口对不上号。
  // 7801 被占就往后试几个，全都占才退回随机端口。
  const FIXED = [7801, 7802, 7803, 7804, 7805];
  return new Promise((resolve) => {
    let i = 0;
    const tryListen = () => {
      const onErr = () => {
        srv.removeListener("listening", onOk);
        i += 1;
        if (i < FIXED.length) { srv.listen(FIXED[i], "127.0.0.1"); }
        else { srv.listen(0, "127.0.0.1"); }
      };
      const onOk = () => {
        srv.removeListener("error", onErr);
        port = srv.address().port;
        log("[main] 本地服务端口 " + port);
        resolve({ server: srv, port });
      };
      srv.once("error", onErr);
      srv.once("listening", onOk);
      srv.listen(FIXED[i], "127.0.0.1");
    };
    tryListen();
  });
}

module.exports = { startServer };
