// 闲置词的语音预合成缓存。
//
// 为什么要它：她自己开口说一句「要不要喝口水」这种话，走正常 TTS 要 1–2 秒
// （飞鱼要先装载模型，第一句 25 秒）。而这类句子的集合是**固定的**——台词池写完就不动了。
// 所以最省事的做法是：选定引擎和音色之后，整套 324 句一次合成好存在本地，
// 触发时直接播文件，延迟 0，而且不占合成队列，不会跟主人真正要听的那句话抢。
//
// 三条设计约束（踩过坑才写下来）：
//   一、缓存必须按「引擎 + 音色」分目录。飞鱼换声线、TTS 换音色之后，
//       拿旧缓存播出来的是别人的声音——比没缓存更糟。
//   二、合成要走本机的 /engine/tts，不能自己直连引擎。
//       那条路已经有回落链、有 idle 计时、有 fellBack 记账，绕过去就等于把逻辑抄一遍。
//   三、可中断。324 句在慢机器上要十几分钟，主人随时会想停；
//       已经合成好的句子留着，下次接着补（增量）。
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const Lines = require("./lines");

const AUDIO_EXT = [".mp3", ".wav", ".m4a", ".ogg"];

function safeName(s) {
  return String(s || "").replace(/[^A-Za-z0-9_.@-]+/g, "_").slice(0, 64) || "default";
}

function keyOf(text) {
  return crypto.createHash("sha1").update(String(text), "utf8").digest("hex").slice(0, 16);
}

/**
 * @param {object} ctx
 * @param {string} ctx.root       缓存根目录（一般是 userData/idle-cache）
 * @param {() => string} ctx.base 本机服务地址，如 http://127.0.0.1:49812
 * @param {(m: string) => void} [ctx.log]
 */
function createIdleCache(ctx) {
  const root = ctx.root;
  const base = ctx.base;
  const log = ctx.log || (() => { });

  let job = null;   // {engine, voice, total, done, failed, startedAt, cancelled}
  let abortFlag = false;

  function dirOf(engine, voice) {
    return path.join(root, safeName(engine), safeName(voice));
  }

  function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  // 找一句话的缓存文件：扩展名不固定（引擎可能回 mp3 也可能回 wav），所以扫目录。
  function fileOf(engine, voice, text) {
    const dir = dirOf(engine, voice);
    const k = keyOf(text);
    for (const ext of AUDIO_EXT) {
      const f = path.join(dir, k + ext);
      try { if (fs.statSync(f).size > 512) return f; } catch (e) { }
    }
    return null;
  }

  function relOf(engine, voice, text) {
    const f = fileOf(engine, voice, text);
    if (!f) return null;
    return "/idle/" + encodeURIComponent(safeName(engine)) + "/" + encodeURIComponent(safeName(voice)) + "/" + path.basename(f);
  }

  // 给本地服务用的白名单解析：只认 引擎/音色/文件名，挡掉路径穿越。
  function resolveRel(rel) {
    const parts = String(rel || "").split("/").filter(Boolean);
    if (parts.length !== 3) return null;
    const [e, v, name] = parts;
    if (!/^[A-Za-z0-9_.@-]{1,64}$/.test(name) || name.includes("..")) return null;
    const f = path.join(root, safeName(e), safeName(v), name);
    if (!f.startsWith(root)) return null;
    return f;
  }

  function listFiles(engine, voice) {
    const dir = dirOf(engine, voice);
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { return []; }
    const out = [];
    for (const n of names) {
      const ext = path.extname(n).toLowerCase();
      if (!AUDIO_EXT.includes(ext)) continue;
      try {
        const st = fs.statSync(path.join(dir, n));
        if (st.isFile() && st.size > 512) out.push({ name: n, size: st.size, at: st.mtimeMs });
      } catch (e) { }
    }
    return out;
  }

  function status(engine, voice) {
    const all = Lines.idleLines();
    const files = listFiles(engine, voice);
    const bytes = files.reduce((a, b) => a + b.size, 0);
    const cached = all.filter((it) => fileOf(engine, voice, it.text)).length;
    return {
      engine: engine || "",
      voice: voice || "",
      total: all.length,
      cached,
      missing: Math.max(0, all.length - cached),
      files: files.length,
      bytes,
      at: files.length ? Math.max(...files.map((f) => f.at)) : 0,
      busy: !!(job && job.engine === engine && job.voice === voice),
      done: job && job.engine === engine && job.voice === voice ? job.done : 0,
      failed: job && job.engine === engine && job.voice === voice ? job.failed : 0,
    };
  }

  // 每个引擎/音色各有一份缓存，设置页要能一眼看到占了多少地方。
  function statusAll() {
    let engines = [];
    try { engines = fs.readdirSync(root); } catch (e) { return []; }
    const out = [];
    for (const e of engines) {
      const ed = path.join(root, e);
      let voices = [];
      try { voices = fs.readdirSync(ed); } catch (e2) { continue; }
      for (const v of voices) {
        const files = listFiles(e, v);
        if (!files.length) continue;
        out.push({
          engine: e, voice: v, files: files.length,
          bytes: files.reduce((a, b) => a + b.size, 0),
          at: Math.max(...files.map((f) => f.at)),
        });
      }
    }
    return out.sort((a, b) => b.at - a.at);
  }

  async function synthOne(text, engine, voice) {
    const url = base() + "/engine/tts";
    // 只有 text 和 voice 会被服务端用到：走哪个引擎由当前设置决定（voiceOut），
    // 这里传 engine 只是记账，不参与分派——分派逻辑在 /engine/tts 里，不抄第二份。
    const body = JSON.stringify({ text, voice, idle: true });
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    if (!r.ok) throw new Error("合成失败 HTTP " + r.status);
    const j = await r.json();
    if (!j || !j.ok || !j.url) throw new Error((j && (j.err || j.error)) || "合成没有返回音频");
    // 缓存要按「谁真的出了声」记账：飞鱼失败回落 TTS 时，这句是 TTS 的音色，
    // 存进飞鱼目录下次就会被当成飞鱼的声音播出去。
    const realEngine = j.engine || engine;
    const realVoice = j.voice || voice;
    if (realEngine !== engine || (realVoice && realVoice !== voice)) {
      throw new Error("回落了（" + realEngine + "/" + (realVoice || "?") + "），跳过");
    }
    const audio = await fetch(base() + j.url);
    if (!audio.ok) throw new Error("取音频失败 HTTP " + audio.status);
    const buf = Buffer.from(await audio.arrayBuffer());
    if (buf.length < 512) throw new Error("音频太短，当作失败");
    const ext = /\.wav$/i.test(j.url) ? ".wav" : ".mp3";
    const dir = ensureDir(dirOf(engine, voice));
    const f = path.join(dir, keyOf(text) + ext);
    fs.writeFileSync(f, buf);
    return f;
  }

  // 逐句补缓存。已经有的跳过；失败记一笔继续下一句（一句坏了不该让整批停）。
  async function build(opts) {
    const engine = safeName(opts && opts.engine);
    const voice = safeName(opts && opts.voice);
    if (!engine) throw new Error("没有指定引擎");
    if (job) throw new Error("已经在合成了");
    const all = Lines.idleLines();
    // limit 只给自测用：324 句真合一遍要好几分钟，测试只验逻辑，抽前 N 句就够。
    const capped = (opts && opts.limit > 0) ? all.slice(0, opts.limit) : all;
    const todo = capped.filter((it) => !fileOf(engine, voice, it.text));
    abortFlag = false;
    job = { engine, voice, total: todo.length, done: 0, failed: 0, startedAt: Date.now(), cancelled: false };
    const onProgress = (opts && opts.onProgress) || (() => { });
    // 合成中途主人换了引擎或音色：这批缓存已经没意义了，立刻停。
    // 不停的话，前半批是飞鱼、后半批是 TTS，全都混进同一个目录。
    const stillWanted = (opts && opts.match) || (() => true);
    log("[idle] 开始预合成 " + engine + "/" + voice + " 共 " + todo.length + " 句（已有 " + (all.length - todo.length) + "）");
    onProgress({ ...status(engine, voice), phase: "start" });
    const errors = [];
    try {
      for (const it of todo) {
        if (abortFlag) { job.cancelled = true; break; }
        if (!stillWanted()) {
          log("[idle] 引擎或音色变了，停止这批合成");
          job.cancelled = true;
          errors.push("中途换了引擎或音色，已停下");
          break;
        }
        try {
          await synthOne(it.text, engine, voice);
          job.done += 1;
        } catch (e) {
          job.failed += 1;
          if (errors.length < 5) errors.push(String((e && e.message) || e));
          // 整批第一句就失败，多半不是「这一句坏了」而是环境没起来：
          // 继续硬跑只会刷 300 条同样的错误，还可能把引擎拖死。
          if (job.done === 0 && job.failed >= 3) {
            log("[idle] 连续失败，停止：" + errors[0]);
            job.cancelled = true;
            break;
          }
        }
        if (job.done % 5 === 0 || job.done + job.failed === job.total) {
          onProgress({ ...status(engine, voice), phase: "progress" });
        }
      }
    } finally {
      const doneJob = job;
      job = null;
      log("[idle] 结束 " + engine + "/" + voice + "：成功 " + doneJob.done + " 失败 " + doneJob.failed + (doneJob.cancelled ? "（中途停下）" : ""));
      onProgress({ ...status(engine, voice), phase: "done", errors });
    }
    return { ...status(engine, voice), ok: true, errors };
  }

  function cancel() {
    abortFlag = true;
    return { ok: true };
  }

  function running() {
    return job ? { ...job } : null;
  }

  // 清缓存：只删自己建的目录。engine 给了就删那一个，不给就全删。
  function clear(engine, voice) {
    const target = engine ? (voice ? dirOf(engine, voice) : path.join(root, safeName(engine))) : root;
    if (!target.startsWith(root)) return { ok: false, err: "路径不对" };
    let removed = 0;
    let bytes = 0;
    const walk = (dir) => {
      let names = [];
      try { names = fs.readdirSync(dir); } catch (e) { return; }
      for (const n of names) {
        const f = path.join(dir, n);
        let st = null;
        try { st = fs.statSync(f); } catch (e) { continue; }
        if (st.isDirectory()) { walk(f); try { fs.rmdirSync(f); } catch (e) { } continue; }
        try { fs.unlinkSync(f); removed += 1; bytes += st.size; } catch (e) { }
      }
    };
    walk(target);
    // 根目录本身留着：下次合成直接写进来，不用再判断存在性。
    if (target !== root) { try { fs.rmdirSync(target); } catch (e) { } }
    log("[idle] 清缓存 " + target + " 删除 " + removed + " 个文件");
    return { ok: true, removed, bytes };
  }

  return {
    root,
    dirOf,
    status,
    statusAll,
    build,
    cancel,
    running,
    clear,
    lookup: (engine, voice, text) => {
      const rel = relOf(engine, voice, text);
      return rel ? { ok: true, url: rel } : { ok: false };
    },
    resolveRel,
  };
}

module.exports = { createIdleCache, keyOf, safeName };
