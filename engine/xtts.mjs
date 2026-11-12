/**
 * XTTS-v2 语音克隆：拿一段参考音频，把文字念成那个人的声音。
 *
 * 跟 rvc 的分工
 *   RVC 是「转换」：先让 Edge 念，再把音色换成目标声线 —— 多一道工序，也多一道失真。
 *   XTTS 是「直接生成」：从参考音频里学出音色，一次就念出来。所以它不受 RVC 那个
 *   ContentVec 16kHz 特征粒度的限制，中文翘舌音不会被压成平舌。
 *
 * 为什么要单独一个进程
 *   torch + XTTS 常驻 1.9GB 显存。待机时不该占着。所以这里只是「按需拉起、空闲关掉」，
 *   真正的模型在 xtts_server.py 里，第一次 /tts 请求才加载（冷启动约 60 秒）。
 *
 * 设计原则跟 tts.mjs 一致：**任何一步出问题都回落 Edge，绝不让她没声**。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const HERE = import.meta.dirname;
const APP = path.resolve(HERE, '..');
const PY = path.join(APP, 'tts2', 'py', 'Scripts', 'python.exe');
const SCRIPT = path.join(HERE, 'xtts_server.py');
const PORT = Number(process.env.FISH_XTTS_PORT || 8896);
const BASE = `http://127.0.0.1:${PORT}`;

/** 参考音频：默认拿内置的那段晓萱。用户可以在设置里换成任何 wav/mp3。 */
export const DEFAULT_REF = path.join(APP, 'assets', 'voice', 'ref-晓萱.mp3');

let child = null;
let idleTimer = null;
let starting = null;
let lastErr = '';
let ready = false;
let device = 'cpu';
let usedOnce = false;

const IDLE_MS = Number(process.env.FISH_XTTS_IDLE_MS || 10 * 60 * 1000);

export function available() {
  return fs.existsSync(PY) && fs.existsSync(SCRIPT);
}

export function status() {
  return {
    available: available(),
    running: !!child,
    ready,
    device,
    port: PORT,
    ref: DEFAULT_REF,
    refExists: fs.existsSync(DEFAULT_REF),
    lastError: lastErr,
  };
}

function log(...a) {
  try { console.log('[xtts]', ...a); } catch {}
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

/** 起进程。已经在跑就直接返回；正在起的那次会复用，不会起两个。 */
async function ensure(loadNow) {
  if (!available()) throw new Error('XTTS 环境不全（缺 python 或脚本）');

  const alive = await ping();
  if (alive) {
    ready = !!alive.ready;
    device = alive.device || device;
    return;
  }

  if (starting) return starting;

  starting = (async () => {
    log('启动服务', PORT);
    child = spawn(PY, [SCRIPT, String(PORT)], {
      cwd: APP,
      windowsHide: true,
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

    // 最多等 20 秒让 HTTP 起来（模型还没加载，服务本身几秒就能接受请求）
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      const h = await ping(500);
      if (h && h.ok) {
        log('服务就绪');
        return;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error('XTTS 服务没起来');
  })().finally(() => { starting = null; });

  return starting;
}

function touchIdle() {
  usedOnce = true;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    // 空闲太久就把显存还回去。下次要用会重新加载，这 60 秒由下一次对话承担，
    // 比一直占着 1.9GB 更划算 —— 她大部分时间是待机的。
    log('空闲超时，卸载模型');
    fetch(`${BASE}/unload`, { method: 'POST' }).catch(() => {});
    ready = false;
  }, IDLE_MS);
  if (idleTimer.unref) idleTimer.unref();
}

/**
 * 合成。
 * @param {string} text
 * @param {{ref?:string, lang?:string, speed?:number, timeout?:number}} opts
 * @returns {Promise<{file:string, ms:number, cached:boolean, engine:'xtts'}>}
 */
export async function synth(text, opts = {}) {
  const clean = String(text || '').trim();
  if (!clean) throw new Error('空文本');
  const ref = opts.ref || DEFAULT_REF;
  if (!fs.existsSync(ref)) throw new Error('参考音频不存在: ' + ref);

  await ensure(true);
  touchIdle();

  const body = JSON.stringify({
    text: clean,
    ref,
    lang: opts.lang || 'zh-cn',
    speed: opts.speed == null ? 1.0 : opts.speed,
  });

  const r = await fetch(`${BASE}/tts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(opts.timeout || 180000),
  });
  const obj = await r.json().catch(() => ({}));
  if (!obj.ok) {
    lastErr = obj.error || '未知错误';
    ready = false;
    throw new Error(lastErr);
  }
  ready = true;
  device = (await ping(300))?.device || device;
  return { file: obj.file, ms: obj.ms | 0, dur: obj.dur || 0, cached: !!obj.cached, engine: 'xtts' };
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
