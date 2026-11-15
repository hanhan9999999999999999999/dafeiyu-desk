/**
 * 语音识别（把手机录的话变成文字）—— 用 Windows 自带 System.Speech，离线、免费、不联网。
 *
 * 流程：手机录音(m4a/webm/wav) → ffmpeg 转 16k/单声道/16bit PCM → 固定文件 runtime/asr/input.wav
 *      → 起一个 powershell 跑 tools/asr_once.ps1 → 读 stdout 的 OK|文本。
 *
 * 为什么每次起进程而不是常驻 worker（实测结论，别改回去）：
 *   PowerShell 5.1 + System.Speech 里，只要 Recognize() 出现在 while/for 循环体内，
 *   第一次调用就报「没有将任何音频数据提供给识别器」；而进程只跑一次、Recognize 只调一次
 *   就正常。常驻进程里必然要循环 → 必然失败。代价是每次 ~2 秒启动，可以接受。
 *
 * 另外：SetInputToWaveFile 用的路径必须是脚本里的字面量，param/$env/Get-Content 都会
 * 触发同样的报错（见 asr_once.ps1 顶部注释），所以这里固定写 input.wav。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 注意：不能用 new URL(import.meta.url).pathname —— 路径里的空格会变成 %20
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'tools', 'asr_once.ps1');
// 这个文件已经在仓库里不存在了（现在只有 whisper 一条路）。留个判断，
// 别让「文件不在」变成一句看不懂的 PowerShell 报错。
const HAS_SCRIPT = (() => { try { return fs.existsSync(SCRIPT); } catch { return false; } })();
const WORK_DIR = path.join(process.env.FISH_DATA_DIR || path.join(HERE, 'runtime'), 'asr');

/** 这个模块的日志：带上 [asr] 前缀，主进程会把它写进 run.log */
function log(msg) { console.log('[asr] ' + msg); }
const INPUT_WAV = path.join(WORK_DIR, 'input.wav');
// 实测结论：base 比 small 稳。small 在低信噪比中文上容易「编句子」
// （把噪声翻成训练集里的常见句），幻觉比认错字危险得多，所以留 base。
// 后来补了 large-v3-turbo（1.6G）：同一句话 base 输出「我把燈／想挑案一点」，
// turbo 输出「主人，今天辛苦了，我把灯给你了」——认得准太多，值得多等 1.7 秒。
// 有 turbo 就用 turbo，没有就退回 base（老机器/没下完的情况）。
const WHISPER_MODEL_BASE = path.join(HERE, 'models', 'ggml-base.bin');
// turbo 是从网上下来的 1.6G，绝不能写进安装目录：装到 Program Files 时那里不可写，
// 下载会在最后一步 rename 失败。所以它和 WORK_DIR 一样走可写根。
// 开发时 FISH_MODEL_DIR 没设，仍旧落在 engine/models，和以前完全一致。
const WHISPER_MODEL_DIR = process.env.FISH_MODEL_DIR || path.join(HERE, 'models');
const WHISPER_MODEL_TURBO = path.join(WHISPER_MODEL_DIR, 'ggml-large-v3-turbo.bin');
// 不能写成模块加载时算死的常量：turbo 是后台按需下的，下完这个进程还得能接上。
// 所以每次用之前现查，文件在且够大才用 turbo。
function pickModel() {
  try {
    if (fs.existsSync(WHISPER_MODEL_TURBO) && fs.statSync(WHISPER_MODEL_TURBO).size > 800 * 1024 * 1024) {
      return WHISPER_MODEL_TURBO;
    }
  } catch (e) { }
  return WHISPER_MODEL_BASE;
}
const WHISPER_TURBO_URL = process.env.FISH_TURBO_URL || 'https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin';
const WHISPER_TXT = 'asr.txt';                 // whisper 的输出文件（相对 WORK_DIR）
const WHISPER_VAD = path.join(HERE, 'models', 'ggml-silero.bin');
const WHISPER_MIN_BYTES = 40 * 1024 * 1024;    // 模型文件小于这个数就当没装好
// 同音/近音纠正表：whisper 对专有名词容易听岔，靠这里补回来。
// 只做「整词替换」，不碰句子结构，避免误伤。
const FIXUPS = [
  // 「大肥鱼」三个字被听岔的花样，实测过的都列上
  // 名字三种错法：大肥X（字错）、大佛X（声母错）、大飛X（拼音近）
  [/大肥[云與与羽羽玉宇雨愚魚鱼余俞佛]/g, '大肥鱼'],
  [/大佛[云魚鱼玉宇]/g, '大肥鱼'],
  [/大飛[云魚鱼宇]/g, '大肥鱼'],
  [/大肥鱼鱼/g, '大肥鱼'],
  // 「阿菲」这一类：整段语音里名字被吞成两个字，实测出现过「阿菲，你好」。
  // 中文口语里「阿菲/阿飞/啊非」几乎不会是别的意思，收窄成「阿X」+ 常见同音字，
  // 不做无边界替换，避免误伤「飞」这类正常字。
  [/阿[菲飞非啡]/g, '大肥鱼'],
  [/啊[菲飞非啡]/g, '大肥鱼'],
  // 「大飞鱼 / 大非鱼 / 打肥鱼」：声母对、中间字错
  [/[大打][飞非菲]鱼/g, '大肥鱼'],
  // whisper 中文经常吐繁体，做一轮常用字收敛（只换独立字，不动词义）
  // 这张表是拿实际识别结果补出来的：跑一段普通话，把里面出现的繁体字全捞一遍，
  // 缺哪个补哪个。宁可多几个字，也别让「聲音」「聽聽」这种混在简体句子里。
  [/什麼/g, '什么'], [/這麽|這麼/g, '这么'], [/那麽|那麼/g, '那么'],
  [/說/g, '说'], [/與/g, '与'], [/現在/g, '现在'], [/時間/g, '时间'],
  [/麼/g, '么'], [/嗎/g, '吗'], [/們/g, '们'], [/這/g, '这'], [/個/g, '个'],
  // 声音相关（最常出现在「换了个声音」这类对话里）
  [/聲/g, '声'], [/聽/g, '听'], [/換/g, '换'], [/響/g, '响'],
  [/覺/g, '觉'], [/樣/g, '样'], [/對/g, '对'], [/開/g, '开'], [/關/g, '关'],
  [/點/g, '点'], [/還/g, '还'], [/會/g, '会'], [/過/g, '过'], [/來/g, '来'],
  [/話/g, '话'], [/語/g, '语'], [/實/g, '实'], [/經/g, '经'], [/總/g, '总'],
  [/為/g, '为'], [/無/g, '无'], [/幾/g, '几'], [/問/g, '问'],
  [/當/g, '当'], [/發/g, '发'], [/現/g, '现'], [/電/g, '电'], [/腦/g, '脑'],
  [/網/g, '网'], [/東/g, '东'], [/車/g, '车'], [/門/g, '门'], [/長/g, '长'],
  [/間/g, '间'], [/見/g, '见'], [/讓/g, '让'], [/從/g, '从'], [/裡/g, '里'],
  [/邊/g, '边'], [/頭/g, '头'], [/體/g, '体'], [/愛/g, '爱'], [/氣/g, '气'],
  [/錯/g, '错'], [/該/g, '该'], [/雖/g, '虽'], [/卻/g, '却'],
  [/並/g, '并'], [/單/g, '单'], [/雙/g, '双'], [/熱/g, '热'], [/輕/g, '轻'],
  [/難/g, '难'], [/興/g, '兴'], [/樂/g, '乐'], [/動/g, '动'],
  [/靜/g, '静'], [/識/g, '识'], [/應/g, '应'], [/歸/g, '归'], [/類/g, '类'],
  [/小代码[江酱將]/g, '小代码酱'],
  // large-v3-turbo 比 base 更爱吐繁体（它是多语种模型，中文走的是通用解码），
  // 下面这批是实测从它的输出里捞出来的，见到新的往这里加。
  [/燈/g, '灯'], [/調/g, '调'],
  [/記/g, '记'], [/訂/g, '订'], [/閱/g, '阅'], [/頻/g, '频'], [/題/g, '题'],
  [/謝/g, '谢'], [/準/g, '准'], [/備/g, '备'], [/幫/g, '帮'], [/夠/g, '够'],
  [/張/g, '张'], [/飯/g, '饭'], [/餓/g, '饿'], [/飲/g, '饮'], [/湯/g, '汤'],
  [/燒/g, '烧'], [/煙/g, '烟'], [/髮/g, '发'], [/藥/g, '药'], [/醫/g, '医'],
  [/復/g, '复'], [/習/g, '习'], [/練/g, '练'], [/寫/g, '写'], [/讀/g, '读'],
  [/書/g, '书'], [/頁/g, '页'], [/紙/g, '纸'], [/筆/g, '笔'], [/畫/g, '画'],
  [/貓/g, '猫'], [/鳥/g, '鸟'], [/魚/g, '鱼'], [/龍/g, '龙'],
  [/雲/g, '云'], [/風/g, '风'], [/陽/g, '阳'],
  [/陰/g, '阴'], [/葉/g, '叶'], [/樹/g, '树'], [/夢/g, '梦'],
  [/地希|地西|D ?S ?H/g, 'DSH'],
  // whisper 会把静音/噪声翻成字幕署名，这是它训练数据带来的幻觉
  [/[(（]\s*字幕[^)）]*[)）]/g, ''],
  [/[(（][A-Za-z][^)）]{0,12}[)）]/g, ''],
  // whisper 中文会在标点后补空格，统一收拾
  [/\s+/g, ' '],
];

const MAX_BYTES = 12 * 1024 * 1024;
const CHUNK_SEC = 28;   // 单段最长秒数（System.Speech 一次 Recognize 处理不完很长的音频）
const CHUNK_MIN = 12;   // 一段最短秒数，太短会把一句话切碎
const MAX_CHUNKS = 4;   // 一次最多几段（约 110 秒），再多就让用户分次说
const PAD_MS = 120;     // 每段前后补的静音毫秒数（避免识别器卡在字的半个音上）

let busy = false;

function ffmpegBin() {
  if (process.env.PHONE_FFMPEG) return process.env.PHONE_FFMPEG;
  // 包里自带的那份排第一 —— 用户机器上不会有系统 ffmpeg，
  // 以前这里先去翻 winget 目录，翻不到就退回 'ffmpeg' 走 PATH，
  // 结果在别人电脑上语音识别直接 ENOENT。
  const packed = path.join(HERE, 'runtime', 'ffmpeg', 'ffmpeg.exe');
  try {
    if (fs.existsSync(packed)) return packed;
  } catch (e) { }
  try {
    const base = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
    for (const d of fs.readdirSync(base)) {
      if (!/Gyan\.FFmpeg/i.test(d)) continue;
      for (const sub of fs.readdirSync(path.join(base, d))) {
        const p = path.join(base, d, sub, 'bin', 'ffmpeg.exe');
        if (fs.existsSync(p)) return p;
      }
    }
  } catch { }
  return 'ffmpeg';
}

function run(cmd, args, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true, cwd: WORK_DIR });
    let out = '';
    let err = '';
    const t = setTimeout(() => {
      try { p.kill(); } catch {}
      reject(new Error('处理超时'));
    }, timeoutMs);
    p.stdout.on('data', (d) => (out += d.toString('utf8')));
    p.stderr.on('data', (d) => (err += d.toString('utf8')));
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('exit', (c) => {
      clearTimeout(t);
      if (c === 0) resolve(out);
      else reject(new Error((err || out || '命令失败').trim().slice(0, 300)));
    });
  });
}

function ffmpegDuration(file) {
  return new Promise((resolve) => {
    const p = spawn(ffmpegBin(), ['-i', file, '-hide_banner'], { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('exit', () => {
      const m = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(err);
      if (!m) return resolve(0);
      resolve(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
    });
    p.on('error', () => resolve(0));
  });
}

/**
 * 找静音点（返回每段静音的中间时刻，秒）。
 * 靠它把长录音切在"人停下来的地方"，而不是每 28 秒一刀切在字中间。
 */
function silencePoints(file) {
  return new Promise((resolve) => {
    const p = spawn(ffmpegBin(),
      ['-hide_banner', '-i', file, '-af', 'silencedetect=noise=-35dB:d=0.35', '-f', 'null', '-'],
      { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', () => resolve([]));
    p.on('exit', () => {
      const pts = [];
      const re = /silence_start:\s*([\d.]+)[\s\S]*?silence_end:\s*([\d.]+)/g;
      let m;
      while ((m = re.exec(err))) {
        const a = Number(m[1]);
        const b = Number(m[2]);
        if (Number.isFinite(a) && Number.isFinite(b) && b > a) pts.push((a + b) / 2);
      }
      resolve(pts);
    });
  });
}

/** 按静音点规划切段：每段不超过 CHUNK_SEC，且尽量落在停顿处 */
function planChunks(total, points) {
  const plan = [];
  let cur = 0;
  let guard = 0;
  while (cur < total - 0.4 && guard < 20) {
    guard += 1;
    const limit = Math.min(cur + CHUNK_SEC, total);
    if (limit >= total - 0.4) { plan.push({ start: cur, dur: total - cur }); break; }
    const lo = cur + CHUNK_MIN;
    let cut = 0;
    for (const pt of points) if (pt >= lo && pt <= limit && pt > cut) cut = pt;
    const end = cut || limit;
    plan.push({ start: cur, dur: end - cur });
    cur = end;
  }
  if (!plan.length) plan.push({ start: 0, dur: total });
  return plan.filter((x) => x.dur > 0.5);
}

async function transcode(input, output, ss, dur) {
  const args = ['-y', '-loglevel', 'error'];
  if (ss) args.push('-ss', String(ss));
  if (dur) args.push('-t', String(dur));
  args.push(
    '-i', input,
    '-ac', '1', '-ar', '16000', '-acodec', 'pcm_s16le',
    // 前后各补一点静音：切点即使落在半个字上，识别器也有完整的起止
    '-af', `adelay=${PAD_MS}|${PAD_MS},apad=pad_dur=0.15`,
    // 关键：不带这两个参数会留 LIST/INFO 块，System.Speech 会拒绝解析
    '-map_metadata', '-1', '-fflags', '+bitexact', '-f', 'wav', output,
  );
  await run(ffmpegBin(), args, 60000);
}


/** whisper 的路子：ffmpeg 自带滤镜，模型缺失就返回 null 让调用方回退。 */

/**
 * 拼 whisper 滤镜串。
 * VAD 很关键：没有它，静音段会被「听」成字（实测出现过一个孤零零的「媽」，
 * 以及 (字幕:J Chong) 这种把噪声翻成字幕署名的幻觉）。
 */
function whisperFilter() {
  const esc = (p) => "'" + p.replace(/\\/g, '/').replace(/:/g, '\\:') + "'";
  const __model = pickModel();
  let af = 'whisper=model=' + esc(__model) + ':language=zh';
  if (fs.existsSync(WHISPER_VAD) && fs.statSync(WHISPER_VAD).size > 500 * 1024) {
    af += ':vad_model=' + esc(WHISPER_VAD) + ':vad_threshold=0.5';
  }
  af += ':destination=' + WHISPER_TXT + ':format=text';
  return af;
}

async function transcribeWhisper() {
  try {
    // 必须在这里自己取一次。以前写的是 whisperFilter() 里的局部变量 __model，
    // 在这个函数里根本不存在 → 每次都在第一行抛 ReferenceError 被空 catch 吞掉，
    // whisper 一次都没跑成过，现象只是「识别没结果」。
    const __model = pickModel();
    if (!fs.existsSync(__model)) return null;
    if (fs.statSync(__model).size < WHISPER_MIN_BYTES) return null;
    const outPath = path.join(WORK_DIR, WHISPER_TXT);
    try { fs.unlinkSync(outPath); } catch {}
    // ffmpeg 滤镜里的路径要转义：反斜杠换正斜杠，冒号前加反斜杠，整体用单引号包住
    const modelArg = "'" + __model.replace(/\\/g, '/').replace(/:/g, '\\:') + "'";
    await run(
      ffmpegBin(),
      [
        '-y', '-loglevel', 'error',
        '-i', path.basename(INPUT_WAV),
        '-af', whisperFilter(),
        '-f', 'null', '-',
      ],
      180000,
    );
    if (!fs.existsSync(outPath)) {
      log('whisper 没写出结果文件: ' + outPath);
      return null;
    }
    const text = fs.readFileSync(outPath, 'utf8').trim();
    try { fs.unlinkSync(outPath); } catch {}
    return text || null;
  } catch (e) {
    // 以前这里是空 catch 直接 return null，「whisper 不行」就成了一句没有下文的结论。
    // 实际原因（模型缺失 / ffmpeg 报错 / 滤镜拼错）全都看不到。
    log('whisper 失败: ' + (e && e.message ? e.message : e));
    return null;
  }
}

/**
 * large-v3-turbo 的尾巴幻觉：它见过的语料里全是带字幕的视频，一段话说完会在末尾
 * 自己「念」一句版权/订阅提示（实测冒出过「请不吝点赞 订阅 转发 打赏支持明镜与点点栏目」）。
 *
 * 只在**句末**出现时才删 —— 主人真说「记得订阅」的时候不能给他吞了。
 */
const TAIL_HALLUCINATION = /(请不吝点赞|点赞.{0,4}订阅|订阅.{0,4}转发|打赏支持|明镜与点点栏目|明鏡與點點欄目|字幕由.{0,14}提供|中文字幕由.{0,14}提供|Amara\.org|MING PAO|优优独播剧场|獨播劇場|YoYo Television|Television Series|Exclusive|谢谢大家|謝謝大家|感谢观看|感謝觀看|下期再见|下期再見|字幕组|字幕組)/i;

function dropTailHallucination(text) {
  let s = String(text || '').trim();
  if (!s) return s;
  // 按句切开，从尾部往前，凡是命中幻觉特征的整句丢掉
  const parts = s.split(/(?<=[。！？!?…])/);
  while (parts.length && TAIL_HALLUCINATION.test(parts[parts.length - 1])) parts.pop();
  s = parts.join('').trim().replace(/[，,、]\s*$/, '');
  return s;
}

/** 同音词纠正。 */
function applyFixups(text) {
  let out = dropTailHallucination(text);
  for (const [re, to] of FIXUPS) out = out.replace(re, to);
  return out.replace(/\s+/g, ' ').replace(/ ?([,.!?]) ?/g, '$1').trim();
}


/** 把一段音频转成文字。audio: Buffer；ext: m4a/webm/wav/ogg */
export async function transcribe(audio, ext = 'm4a') {
  // 下面这几条是「输入不合格」，不是「服务坏了」。打上 badInput 标记，
  // 让 HTTP 层回 400 —— 否则调用方看到 500 会以为识别引擎挂了，转头去回落别的通道。
  const bad = (msg) => { const e = new Error(msg); e.badInput = true; return e; };
  if (!Buffer.isBuffer(audio) || audio.length < 400) throw bad('录音太短了，再说一次？');
  if (audio.length > MAX_BYTES) throw bad('录音太大了（超过 12MB）');
  if (busy) throw bad('上一个录音还在识别，稍等一下');
  busy = true;
  const t0 = Date.now();
  fs.mkdirSync(WORK_DIR, { recursive: true });
  const src = path.join(WORK_DIR, 'source.' + (String(ext).toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'));
  try {
    fs.writeFileSync(src, audio);
    const total = await ffmpegDuration(src);
    let plan = [{ start: 0, dur: 0 }];
    if (total > CHUNK_SEC) {
      plan = planChunks(total, await silencePoints(src));
      if (plan.length > MAX_CHUNKS) {
        throw bad(`这条录音有 ${Math.round(total)} 秒，一次最多认 ${MAX_CHUNKS * CHUNK_SEC} 秒左右，分两次说？`);
      }
    }
    const texts = [];
    // 纠错前的原文也留着：界面上「你说」显示 raw、「发出」显示 text，
    // 才看得出「大肥鱼」这三个字到底被听成了什么。
    const raws = [];
    for (const seg of plan) {
      await transcode(src, INPUT_WAV, seg.start, seg.dur);
      if (!fs.existsSync(INPUT_WAV) || fs.statSync(INPUT_WAV).size < 1000) {
        if (plan.length > 1) continue;   // 多段时某段没声音，跳过继续
        throw bad('这段录音里没有声音');
      }
      // 主路是 whisper（ffmpeg 滤镜）。System.Speech 那条备用路早就没脚本了，
      // 只有脚本确实存在时才回退——否则会把「whisper 没成」变成一句看不懂的
      // PowerShell 参数报错，让人以为是别的地方坏了。
      let piece = await transcribeWhisper();
      let raw = piece || '';
      if (piece) {
        piece = applyFixups(piece);
      } else if (HAS_SCRIPT) {
        const out = await run(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT],
          90000,
        );
        const line = out.split(/\r?\n/).find((l) => /^(OK|ERR)\|/.test(l)) || '';
        if (line.startsWith('ERR|')) throw new Error(line.slice(4).trim() || '识别失败');
        raw = line.slice(3).trim();
        piece = applyFixups(raw);
      } else {
        throw new Error('语音识别没跑通：whisper 没出结果，备用脚本也不在（详见 run.log 里的 [asr] 那几行）');
      }
      if (piece) { texts.push(piece); raws.push(raw); }
    }
    return {
      text: texts.join('').trim(),
      raw: raws.join('').trim(),
      ms: Date.now() - t0,
      chunks: plan.length,
      total: Math.round(total),
    };
  } finally {
    busy = false;
    try { fs.unlinkSync(src); } catch {}
    try { fs.unlinkSync(INPUT_WAV); } catch {}
  }
}

export function status() {
  return { busy, script: SCRIPT, model: path.basename(pickModel()) };
}

// ── turbo 按需下载 ───────────────────────────────────────────────
// 1.6G 的东西不该塞进安装包：包会到 2.5G，NSIS 直接压不出来（实测卡在
// x64_app_files 那条 File 指令上）。所以打包时排除它，第一次跑起来在后台静默下。
// 下完 pickModel() 下次查询就会切到 turbo，不用重启。
let turboJob = null;   // { got, total, done, error, cancelled, attempt }

const TURBO_MIN_BYTES = 800 * 1024 * 1024;

function turboPresent() {
  try {
    return fs.existsSync(WHISPER_MODEL_TURBO) && fs.statSync(WHISPER_MODEL_TURBO).size > TURBO_MIN_BYTES;
  } catch (e) {
    return false;
  }
}

export function turboState() {
  return { present: turboPresent(), dir: WHISPER_MODEL_DIR, ...(turboJob || {}) };
}

/** 取消正在跑的下载。已经下完的部分留在 .part 里，下次接着下。 */
export function cancelTurbo() {
  if (!turboJob || turboJob.done) return false;
  turboJob.cancelled = true;
  turboJob.error = "已取消";
  return true;
}

export function ensureTurbo(force) {
  if (turboPresent()) {
    turboJob = { done: true, got: 0, total: 0, error: "", cancelled: false, attempt: 0 };
    return turboJob;
  }
  // 正在下：直接返回同一个 job，别开第二条连接抢带宽
  if (turboJob && !turboJob.done && !turboJob.error && !turboJob.cancelled) return turboJob;
  // 上次被取消：启动时那次自动检查不重启，用户手动点「继续」时 force=true 才重来
  if (!force && turboJob && turboJob.cancelled && !turboJob.done) return turboJob;

  const job = { got: 0, total: 0, done: false, error: "", cancelled: false, attempt: 0 };
  turboJob = job;

  (async () => {
    try { fs.mkdirSync(WHISPER_MODEL_DIR, { recursive: true }); } catch (e) { }
    const tmp = WHISPER_MODEL_TURBO + ".part";

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (job.cancelled) break;
      job.attempt = attempt;

      // 断点续传：上一条命令下了一半的 .part 接着用
      let offset = 0;
      try { offset = fs.statSync(tmp).size; } catch (e) { offset = 0; }
      if (offset > TURBO_MIN_BYTES) {
        try { fs.renameSync(tmp, WHISPER_MODEL_TURBO); job.done = true; job.error = ""; break; } catch (e) { }
      }

      try {
        const headers = offset > 0 ? { Range: "bytes=" + offset + "-" } : {};
        const res = await fetch(WHISPER_TURBO_URL, { redirect: "follow", headers });
        // 镜像站不认 Range 就别硬拼，老老实实从头下
        if (offset > 0 && res.status !== 206) {
          offset = 0;
          try { fs.unlinkSync(tmp); } catch (e) { }
        }
        if (res.status !== 206 && !res.ok) throw new Error("HTTP " + res.status);

        const len = Number(res.headers.get("content-length") || 0);
        job.total = len ? len + offset : 0;
        job.got = offset;

        const out = fs.createWriteStream(tmp, { flags: offset > 0 ? "a" : "w" });
        const reader = res.body.getReader();
        for (;;) {
          if (job.cancelled) {
            try { await new Promise((r) => out.end(r)); } catch (e) { }
            throw new Error("已取消");
          }
          const { done, value } = await reader.read();
          if (done) break;
          job.got += value.length;
          if (!out.write(Buffer.from(value))) {
            await new Promise((r) => out.once("drain", r));
          }
        }
        await new Promise((r) => out.end(r));

        const size = (() => { try { return fs.statSync(tmp).size; } catch (e) { return 0; } })();
        if (size <= TURBO_MIN_BYTES) throw new Error("下载不完整（" + size + " 字节）");
        fs.renameSync(tmp, WHISPER_MODEL_TURBO);
        job.done = true;
        job.error = "";
        log("[asr] turbo 下载完成 " + Math.round(size / 1048576) + "MB");
        break;
      } catch (e) {
        // 用户主动取消不算失败：error 留空，让 UI 走「已暂停」而不是「下载失败」
        if (job.cancelled) { job.error = ""; job.got = (() => { try { return fs.statSync(tmp).size; } catch (x) { return job.got; } })(); break; }
        job.error = String((e && e.message) || e);
        log("[asr] turbo 第 " + attempt + " 次失败：" + job.error);
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 3000 * attempt));
          job.error = "";
        }
      }
    }
  })();
  return job;
}

// 给测试用：单独验纠错和幻觉清理，不用真的走一遍录音
export const __test = { applyFixups, dropTailHallucination };
