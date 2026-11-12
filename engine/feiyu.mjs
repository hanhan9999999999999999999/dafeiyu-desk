/**
 * 飞鱼声线（CosyVoice3）：直接生成，不是变声。
 *
 * 跟前面几套的分工
 *   Edge 晓萱：最快（0.6–2.6 秒），但就是个普通的通用女声。
 *   RVC：在 Edge 之后再加一道「换嗓子」，两道工序叠两道失真，中文翘舌音会卷。
 *   XTTS：从参考音频学音色，一次生成。缺点是把高频削掉了（质心 2484 vs 原声 3711），听着闷。
 *   飞鱼：CosyVoice3 + 专门训过的声线（cute / gentle），中文原生。
 *        实测质心 3411、>8kHz 占 15.14%、过零 3829，三项都贴着原声（3711 / 18.38 / 3880），
 *        平坦度 0.6748 甚至比原声还高 —— 气声没被抹掉，这正是 RVC 一直修不好的那件事。
 *
 * 为什么单独一个进程
 *   模型 3.5GB、常驻显存约 4.6GB。待机不该占着。所以这里是「按需拉起、空闲关掉」，
 *   真正的模型在 feiyu_server.py，第一次 /tts 才加载（冷启动约 16 秒，加载 llm 权重另算）。
 *
 * Python 环境在 D:\feiyu\venv（Python 3.11），跟 app 自带的 tts2/py（3.10）分开，
 * 因为 CosyVoice3 只吃 3.11，两个不能混。
 *
 * 设计原则跟 tts.mjs 一致：**任何一步出问题都回落 Edge，绝不让她没声**。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const APP = path.resolve(HERE, '..');

/** 飞鱼环境的根目录。**三个子路径都从它推导**，换位置只改这一个。
 *
 *  优先级：FEIYU_HOME 环境变量 → 包内 feiyu/（将来把环境塞进包时用）→ D:\feiyu（开发和主人现在的位置）。
 *
 *  为什么要有这一层：早先三个路径全写死成 D:\feiyu\…，别人装上包以后那个目录根本不存在，
 *  飞鱼直接哑掉——而「拿到包就能用所有功能」是主人的要求。环境变量由 main.js 在 import
 *  本模块**之前**按设置项 feiyuHome 设好（本文件顶层的常量只在模块加载时求值一次，
 *  所以改了设置必须让 main.js 把模块缓存丢掉重新 import）。
 */
const HOME = process.env.FEIYU_HOME
  || (fs.existsSync(path.join(APP, 'feiyu')) ? path.join(APP, 'feiyu') : path.join('D:', 'feiyu'));

/** Python 解释器：单独指定时用 FISH_FEIYU_PY，否则 <HOME>/venv。 */
export const PY = process.env.FISH_FEIYU_PY
  || path.join(HOME, 'venv', 'Scripts', 'python.exe');

const SCRIPT = path.join(HERE, 'feiyu_server.py');
const PORT = Number(process.env.FISH_FEIYU_PORT || 8895);
const BASE = `http://127.0.0.1:${PORT}`;

/** 模型包：manifest.json 在这里面，用它判断环境齐不齐。 */
export const PKG = process.env.FEIYU_PKG || path.join(HOME, 'models', 'FeiyuVoice-CosyVoice3');
const REPO = process.env.FEIYU_REPO || path.join(HOME, 'cosyvoice');

let child = null;
let idleTimer = null;
let starting = null;
let lastErr = '';
let ready = false;
let device = 'cpu';
let styles = [];
let curStyle = '';
// 当前进程用的参考音频目录。服务端在启动时读 FISH_FEIYU_REFS，
// 所以换目录必须重启子进程才生效，这里记下来做比对。
let lastRefDir = '';

const IDLE_MS = Number(process.env.FISH_FEIYU_IDLE_MS || 10 * 60 * 1000);

export function available() {
  return fs.existsSync(PY) && fs.existsSync(SCRIPT) && fs.existsSync(path.join(PKG, 'manifest.json'));
}

export function status() {
  return {
    available: available(),
    running: !!child,
    ready,
    device,
    style: curStyle,
    styles,
    port: PORT,
    pkg: PKG,
    lastError: lastErr,
  };
}

function log(...a) {
  try { console.log('[feiyu]', ...a); } catch {}
}

async function ping(ms = 800) {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(ms) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/** 起进程。已经在跑就复用；正在起的那次会共享同一个 promise，不会起两个。
 *  refDir：参考音频文件夹。留空就用包内的 assets/refvoice。
 *  服务端读 FISH_FEIYU_REFS 这个环境变量，所以必须在 spawn 时就定下来——
 *  改了目录要重启服务才生效（stop() 一下就行）。 */
async function ensure(refDir) {
  if (!available()) throw new Error('飞鱼环境不全（缺 venv / 脚本 / manifest）');

  const alive = await ping();
  if (alive) {
    ready = !!alive.ready;
    device = alive.device || device;
    styles = alive.styles || styles;
    curStyle = alive.style || curStyle;
    return;
  }

  if (starting) return starting;

  starting = (async () => {
    if (refDir) {
      // 换过目录、服务又在跑：先停，否则它的 REFDIR 还是旧的
      if (child && lastRefDir && lastRefDir !== refDir) await stop();
      lastRefDir = refDir;
    }
    log('启动服务', PORT);
    child = spawn(PY, [SCRIPT], {
      cwd: APP,
      windowsHide: true,
      env: {
        ...process.env,
        FEIYU_PKG: PKG,
        FEIYU_REPO: REPO,
        FISH_FEIYU_PORT: String(PORT),
        ...(lastRefDir ? { FISH_FEIYU_REFS: lastRefDir } : {}),
        // 这两个是血泪：不加 UNBUFFERED，子进程的 print 全被叼在缓冲区里，
        // 出 503 的时候 log 里一个字都没有，只剩一个空 body。
        // 不加 IOENCODING/UTF8，中文日志到主进程会变成一堆问号。
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (b) => log(String(b).trim()));
    child.stderr.on('data', (b) => {
      const s = String(b).trim();
      if (s) log('stderr', s.slice(0, 400));
    });
    child.on('exit', (code) => {
      log('退出', code);
      child = null;
      ready = false;
    });

    // 最多等 25 秒让 HTTP 起来。模型是懒加载的，服务本身几秒就能收请求。
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) {
      const h = await ping(500);
      if (h && h.ok) {
        styles = h.styles || [];
        log('服务就绪，声线', styles.join('/'));
        return;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error('飞鱼服务没起来');
  })().finally(() => { starting = null; });

  return starting;
}

function touchIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    // 空闲就还显存。下次要用会重新加载（十几秒），由下一次对话承担，
    // 比一直占着 4.6GB 划算 —— 她大部分时间是待机的。
    log('空闲超时，卸载模型');
    fetch(`${BASE}/unload`, { method: 'POST' }).catch(() => {});
    ready = false;
  }, IDLE_MS);
  if (idleTimer.unref) idleTimer.unref();
}

/**
 * 合成。
 * @param {string} text
 * @param {{style?:'cute'|'gentle', speed?:number, ref?:string, refDir?:string, timeout?:number}} opts
 *   ref：参考音频文件名（比如「温柔.wav」）或标签（比如「撒娇」）。
 *        留空 = 让服务按文本情绪自己挑。参考音频文件夹默认 assets/refvoice/。
 *   refDir：换个参考音频文件夹（用户在设置里指定）。改这个要重启服务才生效。
 * @returns {Promise<{file:string, ms:number, dur:number, cached:boolean, ref:string, engine:'feiyu'}>}
 */
export async function synth(text, opts = {}) {
  const clean = String(text || '').trim();
  if (!clean) throw new Error('空文本');

  await ensure(opts.refDir);
  touchIdle();

  // 服务活着不等于模型装好了。第一次 / 空闲卸载之后，/tts 会同步阻塞加载 24 秒左右，
  // 这期间调用方什么都不知道，体感就是「她哑了」。先报一声再等。
  if (!ready) {
    try {
      if (typeof opts.onWait === 'function') opts.onWait({ phase: 'load', est: 24 });
    } catch (e) { /* 回调自己出错不影响合成 */ }
  }

  const style = opts.style || 'cute';
  const body = JSON.stringify({
    text: clean,
    style,
    speed: opts.speed == null ? 0 : opts.speed,
    ref: opts.ref || '',
  });

  const r = await fetch(`${BASE}/tts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(opts.timeout || 300000),
  });
  const obj = await r.json().catch(() => ({}));
  if (!obj.ok) {
    lastErr = obj.error || '未知错误';
    ready = false;
    throw new Error(lastErr);
  }
  ready = true;
  curStyle = style;
  device = (await ping(300))?.device || device;
  return {
    file: obj.file, ms: obj.ms | 0, dur: obj.dur || 0,
    cached: !!obj.cached, ref: obj.ref || '', engine: 'feiyu',
  };
}

/**
 * 预热：把模型和默认声线先装进显存。
 * 不产生音频，只为了用户第一次开口时不用等 17-22 秒的冷加载。
 */
export async function warm(opts = {}) {
  try {
    await ensure(opts.refDir);
    touchIdle();
    const r = await fetch(`${BASE}/warm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ style: opts.style || 'cute' }),
      signal: AbortSignal.timeout(opts.timeout || 240000),
    });
    const obj = await r.json().catch(() => ({}));
    if (!obj.ok) throw new Error(obj.error || '预热失败');
    ready = true;
    device = obj.device || device;
    curStyle = obj.style || curStyle;
    log('预热完成', (obj.ms | 0) + 'ms', obj.style || '', obj.device || '');
    return obj;
  } catch (e) {
    lastErr = String(e && e.message ? e.message : e);
    log('预热失败（不影响之后按需加载）', lastErr);
    return { ok: false, error: lastErr };
  }
}

/**
 * 流式合成：一句一句往回吐 WAV，前端拿到第一块就能开口。
 *
 * 跟 synth() 的区别只在哪一刻出声：synth() 要等整段算完（30 字约 8-12 秒），
 * stream() 第一块通常 2-3 秒就到（短句优先切），后面边播边合。
 *
 * 服务端 /tts_stream 回的是 NDJSON（每行一个事件），这里把它拆成事件流：
 *   meta  → onMeta({ready, fp16, device, style})
 *   first → onFirst({ms})         第一块音频到达的时刻
 *   chunk → 本函数 yield {i, n, dur, wav}
 *   done  → onDone({ms, firstMs, chunks})
 *   err   → 抛出去，让上层回落到非流式
 *
 * @param {string} text
 * @param {{style?:string, speed?:number, ref?:string, refDir?:string, timeout?:number,
 *          onMeta?:Function, onFirst?:Function, onDone?:Function}} opts
 */
export async function* stream(text, opts = {}) {
  const clean = String(text || '').trim();
  if (!clean) throw new Error('空文本');

  await ensure(opts.refDir);
  touchIdle();

  const style = opts.style || 'cute';
  const body = JSON.stringify({
    text: clean,
    style,
    speed: opts.speed == null ? 0 : opts.speed,
    ref: opts.ref || '',
  });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeout || 600000);
  try {
    const r = await fetch(`${BASE}/tts_stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: ac.signal,
    });
    if (!r.ok || !r.body) throw new Error('飞鱼流式未就绪 HTTP ' + r.status);

    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        if (ev.t === 'meta') {
          if (ev.ready === false) ready = false;
          try { opts.onMeta && opts.onMeta(ev); } catch {}
        } else if (ev.t === 'first') {
          try { opts.onFirst && opts.onFirst(ev); } catch {}
        } else if (ev.t === 'done') {
          ready = true;
          curStyle = style;
          try { opts.onDone && opts.onDone(ev); } catch {}
        } else if (ev.t === 'err') {
          lastErr = ev.error || '飞鱼流式出错';
          ready = false;
          throw new Error(lastErr);
        } else if (ev.t === 'chunk') {
          ready = true;
          yield { i: ev.i | 0, n: ev.n | 0, dur: Number(ev.dur) || 0, wav: Buffer.from(ev.b64 || '', 'base64') };
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

/** 参考音频文件夹里有哪些条目（给设置界面下拉用）。服务没起也能拿到，会先拉起来。 */export async function refs(timeout, refDir) {
  try {
    await ensure(refDir);
    const r = await fetch(`${BASE}/refs`, { signal: AbortSignal.timeout(timeout || 8000) });
    const obj = await r.json();
    return obj.refs || [];
  } catch (e) {
    lastErr = String(e && e.message ? e.message : e);
    return [];
  }
}

/** 空闲计时器要在 before-quit 里清掉，否则进程退不干净。 */
export function stop() {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
  if (child) {
    try { child.kill(); } catch {}
    child = null;
  }
  ready = false;
}
