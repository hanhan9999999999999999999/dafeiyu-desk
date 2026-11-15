// TTS：优先 Edge 神经音色（和电脑端 DSH 的 TTS 插件同一套引擎），失败回落 Windows OneCore。
// 为什么换：OneCore 是系统 SAPI 音色，机械；Edge 的 zh-CN-XiaoxiaoNeural 等是神经音色，和电脑端听感一致。
// 之前我用 python edge-tts 失败过 —— 那是 v1 端点（speech.platform.bing.com）已废弃；
// 插件用的是 v2 端点 api.msedgeservices.com + Sec-MS-GEC 令牌，本文件复用插件内嵌的 worker 源码。
//
// 情感（2026-11-01 加）：Edge 免费端点实测拒收 mstts:express-as（code=1007 SSML is invalid，
// 合法 style 和乱写的 style 一律被拒，说明是解析阶段整条作废，不是"忽略"）。
// 所以情感只能落在 prosody 的 rate/pitch/volume 上，并且靠"每句话单独用一组参数合成"来做语气起伏。
// 参数表、标签解析、自动推断都在 ../tools/voice/emotion.mjs（语音领域的单一来源，本目录只消费）。
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EMOTIONS, DEFAULT_EMOTION, normalizeEmotion, emotionParams, inferEmotion,
  segmentByEmotion, stripEmotionTags, emotionCatalog, parseEmotionSpec,
} from './tools/voice/emotion.mjs';

// 让 server.mjs / 前端能直接从这里问到情感表，不用再找一条路径
export { EMOTIONS, DEFAULT_EMOTION, normalizeEmotion, emotionParams, stripEmotionTags, emotionCatalog, parseEmotionSpec };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER = process.env.PHONE_TTS_WORKER || path.join(HERE, 'tools', 'tts_onecore_worker.ps1');
const EDGE_WORKER = process.env.PHONE_EDGE_TTS_WORKER || path.join(HERE, 'tools', 'edge-tts-worker.cjs');
const OUTDIR = path.join(process.env.FISH_DATA_DIR || path.join(HERE, 'runtime'), 'tts');
const MAX_BYTES = Number(process.env.PHONE_TTS_MAX_BYTES || 128 * 1024 * 1024); // 总量上限，超了按最旧删
// 条数只是兜底护栏：真正生效的是下面的字节上限（128MB ÷ 平均 220KB ≈ 580 个），
// 原来卡在 240 会让缓存只用到一半就被迫淘汰 → 老消息重放要重新合成（0.5–8s）。
// 后来词库扩到 472 条并且全部预生成，600 这个数就顶到天花板了 —— 随便聊几轮
// 就会把预生成的词库当"最旧"挤掉，等于白做。抬到 1200 给对话留出余量。
const MAX_FILES = Number(process.env.PHONE_TTS_MAX_FILES || 1200);

// Edge 失败后的冷却期：这段时间内直接走本地音色，不再每条语音都卡满预算。
// 为什么需要：断网 / Edge 抽风时，每条语音都要先白等 6 秒（还可能 ×3 次重试）才出声，
// 那个体验比"一上来就是机械音"糟得多。成功一次立刻解除冷却。
let edgeDownUntil = 0;
// 冷却别设长：Edge 的失败多是随机抖动，5 分钟冷却会把整段对话都锁在惠惠（机械、偏快）上，
// 表现成「换过音色但听起来还是那个声音」。30 秒足够躲开连续故障，又能很快回到神经音色。
const EDGE_COOLDOWN_MS = Math.max(0, Number(process.env.PHONE_EDGE_COOLDOWN_MS || 30000));
const EDGE_TIMEOUT = Number(process.env.PHONE_EDGE_TIMEOUT_MS || 25000);
// 预热进行中：这段时间发来的请求给更大的等待预算，避免"刚好在预热那一秒发语音"
// 被 6 秒预算砍掉、回落成机械音。预热本身只跑一次，之后就一直是 null。
let warmupPromise = null;

// Edge 神经音色（本机逐个实测可合成）。id 直接用微软音色全名，和电脑端插件一致。
export const VOICES = [
  { id: 'zh-CN-XiaoxuanNeural', label: '晓萱 · 中文女声（主人选的，和电脑端同一个）', lang: 'zh', engine: 'edge' },
  { id: 'zh-CN-XiaoyiNeural', label: '晓伊 · 中文女声（偏亮）', lang: 'zh', engine: 'edge' },
  { id: 'zh-CN-XiaoxiaoNeural', label: '晓晓 · 中文女声（通用）', lang: 'zh', engine: 'edge' },
  { id: 'zh-CN-YunxiNeural', label: '云希 · 中文男声（温和）', lang: 'zh', engine: 'edge' },
  { id: 'zh-CN-YunjianNeural', label: '云健 · 中文男声（浑厚）', lang: 'zh', engine: 'edge' },
  { id: 'zh-CN-YunyangNeural', label: '云扬 · 中文男声（播音腔）', lang: 'zh', engine: 'edge' },
  { id: 'zh-CN-XiaobeiNeural', label: '晓北 · 中文女声（东北腔）', lang: 'zh', engine: 'edge' },
  { id: 'en-US-JennyNeural', label: 'Jenny · 英文女声', lang: 'en', engine: 'edge' },
  { id: 'en-US-GuyNeural', label: 'Guy · 英文男声', lang: 'en', engine: 'edge' },
];
export const DEFAULT_VOICE = 'zh-CN-XiaoxuanNeural';  // 主人 2026-10-31 指定：voice-message-01.mp3 就是她

// 老音色名（OneCore 时代）继续认，直接走本地系统音色，不联网
const ONECORE_IDS = ['Huihui', 'Yaoyao', 'Kangkang', 'Zira', 'David'];

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

let proc = null;
let buf = '';
const waiters = [];
let readyPromise = null;

function onLine(line) {
  if (waiters.length) waiters.shift()(line);
}
function nextLine(ms = 25000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('tts timeout')), ms);
    waiters.push((l) => { clearTimeout(t); resolve(l); });
  });
}

function start() {
  proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', WORKER], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (line) onLine(line);
    }
  });
  proc.stderr.on('data', () => {});
  proc.on('exit', () => {
    proc = null;
    readyPromise = null;
  });
}

async function ensure() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    start();
    const first = await nextLine(20000);
    if (!/READY/.test(first)) throw new Error('tts worker 没起来：' + first.slice(0, 120));
    return true;
  })();
  return readyPromise;
}

export function status() {
  return { running: !!proc, voices: VOICES, defaultVoice: DEFAULT_VOICE, dir: OUTDIR, engine: 'edge+onecore' };
}

// ---- Edge 神经音色：spawn 插件内嵌的零依赖 worker（stdin 传文本，stdout 给 OK <tmp.mp3>）----
// 位置参数协议（worker 侧 findVoiceArgs）：voice rate pitch volume [style]
// rate/pitch/volume 就是情感的全部表达手段，见文件顶部说明。
function synthEdge(text, voice, outFile, params) {
  // 默认也必须走 emotionParams —— 直接取 EMOTIONS.neutral 会跳过全局语速偏移
  const p0 = params || emotionParams(DEFAULT_EMOTION);
  return new Promise((resolve, reject) => {
    let p;
    try {
      // process.execPath 在 Electron 里是 electron.exe，不是 node。
      // 直接拿它跑一个 .cjs，Electron 会当成 GUI 主进程去解析 → 立刻退出。
      // 必须显式带 ELECTRON_RUN_AS_NODE=1，它才会以纯 Node 模式运行这个脚本。
      // （这台机器全局设过这个变量，但外层启动时被清掉了，所以这里每次都显式给。）
      p = spawn(process.execPath, [EDGE_WORKER, voice, p0.rate, p0.pitch, p0.volume], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      });
    } catch (e) {
      return reject(e);
    }
    let out = '';
    let err = '';
    let settled = false;
    const done = (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      e ? reject(e) : resolve();
    };
    p.stdout.setEncoding('utf8');
    p.stderr.setEncoding('utf8');
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { try { p.kill(); } catch {} done(new Error('edge tts 超时')); }, EDGE_TIMEOUT);
    p.on('error', (e) => done(e));
    p.on('close', (code) => {
      const m = /^OK (.+)$/m.exec(out);
      if (code === 0 && m) {
        const tmp = m[1].trim();
        try {
          fs.copyFileSync(tmp, outFile);
          try { fs.unlinkSync(tmp); } catch {}
          return done();
        } catch (e) {
          return done(e);
        }
      }
      done(new Error(String(err || out || ('exit ' + code)).replace(/\s+/g, ' ').slice(0, 180)));
    });
    p.stdin.end(text);
  });
}

const FFMPEG = process.env.PHONE_FFMPEG || 'ffmpeg';
const FFPROBE = process.env.PHONE_FFPROBE || 'ffprobe';

// mp3 时长（秒）：给前端语音条显示「0:12」用
function mp3Dur(file) {
  return new Promise((resolve) => {
    let cp;
    try {
      cp = spawn(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return resolve(0);
    }
    let s = '';
    cp.stdout.setEncoding('utf8');
    cp.stdout.on('data', (d) => { s += d; });
    cp.on('error', () => resolve(0));
    cp.on('close', () => resolve(Math.round((Number(s) || 0) * 10) / 10));
    setTimeout(() => { try { cp.kill(); } catch {} resolve(0); }, 8000);
  });
}

// wav -> mp3（老路径：OneCore 输出 wav 时用）
function toMp3(wavFile) {
  return new Promise((resolve) => {
    const mp3 = wavFile.replace(/\.wav$/, '.mp3');
    try {
      if (fs.existsSync(mp3) && fs.statSync(mp3).size > 800) return resolve(mp3);
    } catch {}
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try {
        if (ok && fs.existsSync(mp3) && fs.statSync(mp3).size > 800) return resolve(mp3);
      } catch {}
      resolve(wavFile);
    };
    let cp;
    try {
      cp = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-i', wavFile, '-ac', '1', '-b:a', '48k', mp3], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } catch {
      return finish(false);
    }
    cp.on('error', () => finish(false));
    cp.on('close', (code) => finish(code === 0));
    setTimeout(() => { try { cp.kill(); } catch {} finish(false); }, 20000);
  });
}

function wavDur(wavFile) {
  try {
    const sz = fs.statSync(wavFile).size - 44;
    if (sz <= 0) return 0;
    return Math.round((sz / 32000) * 10) / 10;
  } catch {
    return 0;
  }
}

// 预热：桥接启动后后台合成一句最短的话，把 node 进程、DNS、TLS 握手这些
// 「第一次才付」的成本提前花掉。用户第一次点语音时就不用等那 5–12 秒。
//
// 为什么必须真的连一次网：实测冷启动第一发要 12.1 秒，其中 DNS 解析独占 11.9 秒
// （Resolve-DnsName 实测 11896ms；缓存热了以后 dns.lookup 只要 43ms）。
// 所以「命中缓存就直接返回」的预热等于没做 —— 它只是读了个文件，网络路径依然冷。
// 这里命中缓存时改用一个一次性的假文本去真连，音频拿到就删。
//
// 另外这里**不能**走 synth()：synth() 只有 6 秒预算，冷启动 12 秒必然超时，
// 而超时会把边沿冷却打开，于是"启动后五分钟内所有语音都被误判成机械音"。
export async function warmup() {
  // 预热只跑一次；期间发来的真实请求共享这次连接尝试，别让它们各自再去冷解析一遍 DNS
  if (warmupPromise) return warmupPromise;
  warmupPromise = doWarmup().finally(() => { warmupPromise = null; });
  return warmupPromise;
}

async function doWarmup() {
  const voice = DEFAULT_VOICE;
  const emoKey = DEFAULT_EMOTION;
  const params = emotionParams(emoKey);
  const t0 = Date.now();
  try {
    fs.mkdirSync(OUTDIR, { recursive: true });
    const base = '嗯';
    const stem = cacheStemFor(base, voice, emoKey, params);
    const cachedFile = path.join(OUTDIR, stem + '.mp3');
    const cached = fs.existsSync(cachedFile) && fs.statSync(cachedFile).size > 800;
    // 命中缓存 → 用带时间戳的假文本绕开缓存，真正走一次 DNS/TLS；合成完立刻删
    const text = cached ? base + Date.now() : base;
    const target = cached ? path.join(OUTDIR, 'warmup-' + Date.now() + '.mp3') : cachedFile;
    const p = synthEdge(text, voice, target, params);
    p.catch(() => {});   // 与 synth() 同理：超时后它仍可能 reject，别让进程被 unhandledRejection 杀掉
    await p;
    const sz = fs.existsSync(target) ? fs.statSync(target).size : 0;
    if (cached) { try { fs.unlinkSync(target); } catch {} }
    if (sz < 1000) throw new Error('合成结果为空');
    return { ok: true, ms: Date.now() - t0, cached };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: String((e && e.message) || e).slice(0, 120) };
  }
}

// 缓存 key 算法（纯函数，专门抽出来是为了能单测它 —— 这里错一次就是"播放永远只有第一次那个语气"）
//
// 规则：key 里必须同时含「情感名」和「最终的三参数」，两者任一变化都要换 key。
// 为什么连情感名都要进 key：neutral 和 happy 万一哪天参数撞了（比如都调成 -8%），
// 只按参数算 key 会让两条不同语义的语音共用一份缓存，将来一改参数就串味。
//
// 注意：加情感功能时 key 算法整体换了代，**磁盘上旧的 600 个缓存不再命中**。
// 这是有意的 —— 语速统一调慢过（RATE_SHIFT），旧音频的语速本来就和现在不一致，
// 继续命中反而是错的。旧文件留在 runtime/tts 由 prune 按容量自然淘汰，不用手动清。
export function cacheStemFor(clean, voice, emoKey, params) {
  const base = clean + '|' + voice;
  const p = params || emotionParams(DEFAULT_EMOTION);
  const payload = base + '|emo:' + (emoKey || DEFAULT_EMOTION) + '|' + p.rate + '|' + p.pitch + '|' + p.volume;
  return crypto.createHash('sha1').update(payload).digest('hex').slice(0, 16);
}

export async function synth(text, voice, emotion, intensity) {
  const askedRaw = voice || DEFAULT_VOICE;
  const askedObj = VOICES.find((x) => x.id === askedRaw);
  const useOneCore = ONECORE_IDS.includes(askedRaw) || !askedObj;
  const asked = useOneCore && !ONECORE_IDS.includes(askedRaw) ? DEFAULT_VOICE : askedRaw;
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('空文本');
  const clipped = clean.slice(0, 1200);

  // 情感：认不出就按 neutral，绝不因为一个拼错的情感名把语音整条搞挂
  const emoKey = normalizeEmotion(emotion) || DEFAULT_EMOTION;
  // 必须走 emotionParams 而不是直接读 EMOTIONS[emoKey]：
  // 前者会套上全局语速偏移（RATE_SHIFT）与强度缩放，后者是原始设计值。直接读表 = 偏移永远不生效，
  // 而且缓存 key 会以为语速没变 —— 这正是"改了参数但听起来没变"那类最难查的 bug。
  const params = emotionParams(emoKey, intensity);

  fs.mkdirSync(OUTDIR, { recursive: true });
  const stem = cacheStemFor(clipped, asked, emoKey, params);
  const key = stem + '.mp3';
  const cached = path.join(OUTDIR, key);
  if (fs.existsSync(cached) && fs.statSync(cached).size > 800) {
    return {
      file: cached, name: key, cached: true, ms: 0, voice: asked, asked, fellBack: false,
      chars: clipped.length, dur: await mp3Dur(cached), engine: 'edge', emotion: emoKey,
    };
  }

  // 1) Edge 神经音色（除了明确要求老 OneCore 音色）
  if (!ONECORE_IDS.includes(asked)) {
    const t0 = Date.now();
    // 冷却期内直接用本地音色，不让用户白等预算
    if (Date.now() < edgeDownUntil) {
      const oc = await synthOneCore(clipped, asked, stem + '.oc');
      return Object.assign(oc, { edgeError: 'edge cooling down', fellBack: true, emotion: emoKey });
    }
    try {
      // 给 Edge 一个总预算：首连偶发 1006 时它会内部重试、拖到 13 秒以上。
      // 超过预算就先回落本地音色出声（音质差但立刻能听），后台那次仍会完成并写入缓存。
      const BUDGET = warmupPromise
        ? Math.max(15000, Number(process.env.PHONE_EDGE_BUDGET_MS || 6000))
        : Math.max(1500, Number(process.env.PHONE_EDGE_BUDGET_MS || 6000));
      // 重试：Edge 免费端点的 1006 / "audio too small: 0" 是随机抖动，
      // 一次失败就掉到 OneCore（惠惠，机械 + 语速快）会让整段听感跳档，所以先重试几次。
      const TRIES = Math.max(1, Number(process.env.PHONE_EDGE_TRIES || 3));
      let lastErr = null;
      for (let i = 0; i < TRIES; i++) {
        // race 超时**不会取消** synthEdge，它之后仍可能 reject。
        // 不在这里挂一个 catch，Node 24 会把它当 unhandledRejection 直接杀进程 ——
        // 现象是"手机端用着用着服务自己没了"，日志里只有一行 uncaught 就断了，极难对到 TTS 上。
        const p = synthEdge(clipped, asked, cached, params);
        p.catch(() => {});
        try {
          await Promise.race([
            p,
            new Promise(function (_, rej) { setTimeout(function () { rej(new Error('edge budget ' + BUDGET + 'ms')); }, BUDGET); }),
          ]);
          const sz = fs.existsSync(cached) ? fs.statSync(cached).size : 0;
          if (sz < 1000) throw new Error('合成结果为空');
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          try { fs.unlinkSync(cached); } catch {}
          await new Promise((r) => setTimeout(r, 250 + i * 350));
        }
      }
      if (lastErr) throw lastErr;
      edgeDownUntil = 0;   // 成功一次立刻解除冷却
      prune();
      return {
        file: cached, name: key, cached: false, ms: Date.now() - t0, voice: asked, asked, fellBack: false,
        chars: clipped.length, dur: await mp3Dur(cached), engine: 'edge', emotion: emoKey,
      };
    } catch (e) {
      // 网络不通就回落本地系统音色，别让用户点了没声音
      edgeDownUntil = Date.now() + EDGE_COOLDOWN_MS;
      try { fs.unlinkSync(cached); } catch {}
      // OneCore 用 .oc 后缀：它和 Edge 写的是同一个内容位置，如果同名，
      // 超时后后台 Edge 完成会把 OneCore 的音频覆盖掉，于是返回值说 onecore、实际文件是 edge，
      // dur / engine 全部对不上。分开命名后两条路径互不踩。
      const f = await synthOneCore(clipped, asked, stem + '.oc');
      return Object.assign(f, { edgeError: String(e.message || e).slice(0, 160), fellBack: true, emotion: emoKey });
    }
  }

  const oc = await synthOneCore(clipped, asked, stem + '.oc');
  return Object.assign(oc, { emotion: emoKey });
}

async function synthOneCore(clipped, asked, stem) {
  // 中文文本却选了英文音色 → OneCore 会合成出空音频，换中文
  const cjk = (clipped.match(/[\u4e00-\u9fff]/g) || []).length;
  const needZh = cjk >= 2 && cjk / clipped.length > 0.2;
  const askedObj = VOICES.find((x) => x.id === asked);
  let v = ONECORE_IDS.includes(asked) ? asked : 'Huihui';
  let fellBack = false;
  if (needZh && !['Huihui', 'Yaoyao', 'Kangkang'].includes(v)) { v = 'Huihui'; fellBack = true; }
  const wav = path.join(OUTDIR, stem + '.wav');
  await ensure();
  const t0 = Date.now();
  proc.stdin.write(b64(clipped) + '|' + b64(wav.replace(/\\/g, '/')) + '|' + b64(v) + '\n');
  const line = await nextLine(40000);
  if (!line.startsWith('OK|')) throw new Error('合成失败：' + line.slice(0, 200));
  const parts = line.split('|');
  try {
    const sz = fs.statSync(wav).size;
    if (sz < 1000) throw new Error('这个音色读不出这段文字（' + v + '），换一个音色试试');
  } catch (e) {
    if (String(e.message).indexOf('这个音色') === 0) { try { fs.unlinkSync(wav); } catch {} throw e; }
  }
  const finalFile = await toMp3(wav);
  prune();
  const finalName = finalFile.endsWith('.mp3') ? stem + '.mp3' : stem + '.wav';
  return {
    file: finalFile, name: finalName, cached: false, ms: Number(parts[1]) || Date.now() - t0,
    voice: parts[3] || v, asked, fellBack, chars: clipped.length, dur: wavDur(wav), engine: 'onecore',
  };
}

function prune() {
  try {
    const names = fs.readdirSync(OUTDIR).filter((f) => f.endsWith('.wav') || f.endsWith('.mp3'));
    const withTime = names
      .map((f) => { const p = path.join(OUTDIR, f); const st = fs.statSync(p); return { f, p, t: st.mtimeMs, sz: st.size }; })
      .sort((a, b) => a.t - b.t);
    // ① 数量上限
    let drop = Math.max(0, withTime.length - MAX_FILES);
    // ② 总量上限：从最旧的开始删，直到降到上限以内
    let total = withTime.reduce((s, x) => s + x.sz, 0);
    let i = 0;
    while (total > MAX_BYTES && i < withTime.length) { total -= withTime[i].sz; i++; drop = Math.max(drop, i); }
    for (let k = 0; k < drop; k++) { try { fs.unlinkSync(withTime[k].p); } catch {} }
  } catch {}
}

export function audioPath(name) {
  if (!/^[a-f0-9]{8,32}\.(wav|mp3)$/.test(String(name || ''))) return null;
  const f = path.join(OUTDIR, name);
  return fs.existsSync(f) ? f : null;
}

export function stop() {
  try { proc && proc.stdin.end(); } catch {}
  try { proc && proc.kill(); } catch {}
  proc = null;
  readyPromise = null;
}

// 按句子切段：长回复分成多段各自合成、前端连着播
export function splitText(text, max = 380) {
  const clean = String(text || '').replace(/\r/g, '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const segs = clean.split(/(?<=[。！？!?；;…\n])/).map((x) => x.trim()).filter(Boolean);
  const out = [];
  let cur = '';
  for (const s0 of segs) {
    if ((cur + s0).length <= max) { cur += s0; continue; }
    if (cur) { out.push(cur); cur = ''; }
    if (s0.length <= max) { cur = s0; continue; }
    for (let i = 0; i < s0.length; i += max) out.push(s0.slice(i, i + max));
  }
  if (cur) out.push(cur);
  return out;
}

// 分段计划：情感优先，长度其次。**必须是纯函数**，这是本文件最容易埋雷的地方。
// 原因：synthFirst 先返回第一段，前端播完再来 /api/tts?all=1 取剩余，
// 那一次会重新算一遍分段。两次结果只要差一点点，parts 的数量/顺序就错位，
// 表现是"长回复后半段串到别的句子上"或"少播一段"，而且只在长文本+情绪切换时偶发，极难复现。
// 所以：无随机、无时间、无外部状态，输入相同输出必然相同。
export function planSegments(text, forceEmotion, segMax) {
  // segMax 显式给了就全局统一用它（测试、调参用）；没给就按每一档自己的节奏来——
  // 疲惫的人说不了长句、兴奋的人一长串不带喘，这个差别比调快慢更像真人。
  const explicitMax = segMax == null || segMax === '' ? null : Math.max(120, Number(segMax) || 380);
  const clean = String(text || '').replace(/\r/g, '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  // 1) 先按显式标签 / 文本推断切出情感段
  const raw = segmentByEmotion(clean, forceEmotion);

  // 2) 相邻同情感、同强度合并：语气没变就不该多切一刀，多一段就多一个播放间隙
  const merged = [];
  for (const s of raw) {
    const t = String(s.text || '').trim();
    if (!t) continue;
    const it = s.intensity == null ? 1 : s.intensity;
    const last = merged[merged.length - 1];
    if (last && last.emotion === s.emotion && last.intensity === it) last.text += t;
    else merged.push({ text: t, emotion: s.emotion, intensity: it });
  }

  // 3) 每段再按长度切（单段太长会让第一声等很久，实测 660 字单段要 14.7 秒）
  const out = [];
  for (const seg of merged) {
    const pr = emotionParams(seg.emotion, seg.intensity);
    const maxN = explicitMax == null
      ? Math.max(120, Number(process.env.PHONE_TTS_SEG || 0) || pr.segMax || 380)
      : explicitMax;
    if (seg.text.length <= maxN) { out.push({ ...seg, segMax: maxN, gap: pr.gap }); continue; }
    for (const piece of splitText(seg.text, maxN)) {
      const t = String(piece || '').trim();
      if (t) out.push({ text: t, emotion: seg.emotion, intensity: seg.intensity, segMax: maxN, gap: pr.gap });
    }
  }
  return out;
}

// 多段合成：按情感分段，每段用自己的 prosody 参数独立合成
export async function synthParts(text, voice, emotion, onProgress) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('空文本');
  const t0 = Date.now();
  const segs = planSegments(clean, emotion, process.env.PHONE_TTS_SEG || null);
  if (!segs.length) throw new Error('空文本');
  const parts = [];
  let total = 0;
  let fellBack = false;
  let usedVoice = voice;
  let engine = 'edge';
  let edgeError = '';
  // 进度回调：前端那根语音条的进度条靠它走（分段是并发的，所以按「完成了几段」计数）
  let doneCount = 0;
  const tick = (phase) => {
    if (typeof onProgress !== 'function') return;
    try { onProgress(doneCount, segs.length, phase); } catch (_) {}
  };
  tick('start');
  // 两路并发：Edge 每段是独立子进程，并发 2 能把长文本的等待近乎减半；
  // OneCore 是常驻单进程串行 worker，并发只是排队，不会出错
  const CONC = Math.max(1, Number(process.env.PHONE_TTS_CONCURRENCY || 2));
  const results = new Array(segs.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < segs.length) {
      const i = cursor++;
      try {
        results[i] = await synth(segs[i].text, voice, segs[i].emotion, segs[i].intensity);
      } catch (e) {
        results[i] = { __err: e };
      }
      doneCount += 1;
      tick('seg');
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONC, segs.length) }, worker));
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (!r || r.__err) throw (r && r.__err) || new Error('分段合成失败');
    usedVoice = r.voice || usedVoice;
    if (r.fellBack) fellBack = true;
    if (r.edgeError && !edgeError) edgeError = r.edgeError;   // 只记第一条，够定位就行
    if (r.engine) engine = r.engine;
    parts.push({ name: r.name, dur: r.dur || 0, cached: !!r.cached, emotion: r.emotion || segs[i].emotion, intensity: segs[i].intensity || 1, gapAfter: segs[i].gap || 0 });
    total += r.dur || 0;
  }
  return {
    parts,
    dur: total,
    voice: usedVoice,
    fellBack,
    engine,
    edgeError,
    ms: Date.now() - t0,
    chars: clean.length,
    name: parts.length ? parts[0].name : '',
    cached: parts.length > 0 && parts.every((x) => x.cached),
    emotion: parts.length ? parts[0].emotion : DEFAULT_EMOTION,
    emotions: [...new Set(parts.map((x) => x.emotion))],
  };
}

// 只等第一段就返回，剩下的在后台继续合成 —— 长回复「点了就出声」，不用等整段
export async function synthFirst(text, voice, emotion, onProgress) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error('空文本');
  // 这里必须和 synthParts 用同一个 planSegments，否则前端后续取剩余会对不上（见 planSegments 注释）
  const segs = planSegments(clean, emotion, process.env.PHONE_TTS_SEG || null);
  if (!segs.length) throw new Error('空文本');
  if (segs.length <= 1) return await synthParts(clean, voice, emotion, onProgress);
  const total = segs.length;
  const tick = (done) => {
    if (typeof onProgress !== 'function') return;
    try { onProgress(done, total, 'seg'); } catch (_) {}
  };
  tick(0);
  const first = await synth(segs[0].text, voice, segs[0].emotion, segs[0].intensity);
  tick(1);
  // 后台把剩下的补上（成功后进缓存，前端下次请求就是秒回）
  (async () => {
    for (let i = 1; i < segs.length; i++) {
      try { await synth(segs[i].text, voice, segs[i].emotion, segs[i].intensity); } catch (_) {}
      tick(i + 1);
    }
  })();
  return {
    parts: [{ ...first, intensity: segs[0].intensity || 1, gapAfter: segs[0].gap || 0 }],
    name: first.name || '',
    ms: first.ms || 0,
    dur: first.dur || 0,
    voice: first.voice,
    engine: first.engine,
    // 这两个别丢：前端/日志靠它们判断"为什么这次是机械音"，丢了就只能猜
    fellBack: !!first.fellBack,
    edgeError: first.edgeError || '',
    chars: clean.length,
    segs: segs.length,
    more: segs.length - 1,
    cached: !!first.cached,
    emotion: first.emotion || segs[0].emotion,
    emotions: [...new Set(segs.map((s) => s.emotion))],
  };
}

// 语音缓存占用：给出数量/字节，并提供清理（手机上你会关心它到底占了多少）
export function cacheStats() {
  try {
    const files = fs.readdirSync(OUTDIR).filter((f) => /\.(mp3|wav)$/.test(f));
    let bytes = 0;
    let newest = 0;
    for (const f of files) {
      try { const st = fs.statSync(path.join(OUTDIR, f)); bytes += st.size; if (st.mtimeMs > newest) newest = st.mtimeMs; } catch (_) {}
    }
    return { count: files.length, bytes, newest, max: MAX_FILES, maxBytes: MAX_BYTES };
  } catch (_) { return { count: 0, bytes: 0, newest: 0, max: MAX_FILES, maxBytes: MAX_BYTES }; }
}

export function cacheClear() {
  let n = 0;
  try {
    for (const f of fs.readdirSync(OUTDIR)) {
      if (!/\.(mp3|wav)$/.test(f)) continue;
      try { fs.unlinkSync(path.join(OUTDIR, f)); n++; } catch (_) {}
    }
  } catch (_) {}
  return n;
}

/** 按上限清理一次（启动时调一次；老版本留下的缓存目录也能顺势瘦下来）。 */
export function cachePrune() {
  const before = cacheStats();
  prune();
  const after = cacheStats();
  return { dropped: before.count - after.count, bytes: before.bytes - after.bytes, ...after };
}
