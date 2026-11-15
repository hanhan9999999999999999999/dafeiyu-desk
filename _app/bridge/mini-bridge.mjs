// 大肥鱼自带的迷你桥接：只做三件事——健康检查、发一句话、把对话状态拿回来。
//
// 为什么要有它：原来的手机桥接（phone-bridge）是一整套东西——手机 UI、记忆、
// 推送、ASR/TTS、多会话管理，几千行。新电脑上只有一个干净 DSH 的时候，那套
// 装不起来也跑不动。这个文件的目的就是「只要这台机器有 DSH，大肥鱼就能连上」。
//
// 它做的事：
//   1. 自己找 DSH 的 bin.js 和 node.exe（环境变量 → 常见安装位置 → PATH 里找）
//   2. 起一个常驻的 DSH 子进程，走 stdio JSON-RPC（复用 runner-sdk.mjs）
//   3. 对外暴露跟 phone-bridge 一样形状的 /api/health、/api/send、/api/state
//      —— 这样大肥鱼那边的代码一行都不用改
//
// 用法：node mini-bridge.mjs [--port 8899] [--profile phone-lite]

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { SdkRunner } from './runner-sdk.mjs';

const ARGS = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = ARGS.indexOf(name);
  return i >= 0 && ARGS[i + 1] ? ARGS[i + 1] : dflt;
};

const PORT = Number(argOf('--port', process.env.FISH_BRIDGE_PORT || 8899));
const PROVIDER = process.env.FISH_DSH_PROVIDER || 'deepseek-account';
const MODEL = process.env.FISH_DSH_MODEL || 'deepseek-flash';
// 语音陪伴以「快」为先：deepseek-flash 的 low 已经能正常调用工具和记忆，
// 只是少绕几圈内部推理；要更深可以显式 FISH_DSH_EFFORT=high / max。
const EFFORT = process.env.FISH_DSH_EFFORT || 'low';

// DSH 的 --profile 必须给一个**存在**的名字，给空串会直接
// `error: --profile needs a name` 然后退出。新电脑上不能假设装了哪个，
// 所以按「最省资源的先试」排个序，挑第一个真实存在的。
// phone-lite 是手机桥接那套精简预设；没有就退到 headless / desktop。
const PROFILE = (() => {
  const forced = argOf('--profile', process.env.PHONE_DSH_PROFILE || '');
  if (forced) return forced;
  const dir = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'profiles');
  const want = ['phone-sdk', 'phone-lite', 'headless', 'desktop', 'web'];
  for (const name of want) {
    try { if (fs.existsSync(path.join(dir, name))) return name; } catch (e) { }
  }
  // 一个都没有就用第一个找到的；再没有就交给 DSH 报错
  try {
    const all = fs.readdirSync(dir).filter((x) => !x.startsWith('_'));
    if (all.length) return all[0];
  } catch (e) { }
  return '';
})();
const TOKEN = process.env.FISH_BRIDGE_TOKEN || crypto.randomBytes(9).toString('hex');
const MAX_MESSAGES = 200;

const log = (...a) => {
  try { console.log('[mini]', ...a); } catch (e) { }
};

/* ───────────────────────── 找 DSH ───────────────────────── */

// 依次看：显式指定的环境变量 → 本机 DSH 安装位置 → PATH 里的 dsh。
// 任何一条能同时给出 node 和 bin.js 就成了。
function findDsh() {
  const candidates = [];

  const envBin = process.env.DSH_BIN;
  const envNode = process.env.PHONE_DSH_NODE || process.env.DSH_NODE;
  if (envBin) candidates.push({ bin: envBin, node: envNode });

  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  // node.exe：dsh-runtimes 下面的运行时目录会被 DSH 改名
  // （原来是 dsh-primary-runtime，现在叫 dsh-next-primary-runtime），
  // 写死一个名字就会「明明装着却找不到」。这里把目录全列一遍再拼路径。
  const nodeGuesses = [];
  const rtRoot = path.join(dshHome, 'dsh-runtimes');
  try {
    for (const d of fs.readdirSync(rtRoot)) {
      nodeGuesses.push(path.join(rtRoot, d, 'dependencies', 'node', 'bin', 'node.exe'));
      nodeGuesses.push(path.join(rtRoot, d, 'dependencies', 'node', 'node.exe'));
    }
  } catch (e) { }
  nodeGuesses.push(path.join(dshHome, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'));

  // bin.js：DSH 本体。桌面版装在 <安装目录>\resources\app\node_modules\@deepseek-ai\dsh\lib\bin.js，
  // 安装目录同样可能搬家（这台机器从 D:\deepseekharness 搬到了 D:\DSH\DSH NEXT）。
  const installDirs = [
    process.env.DSH_INSTALL_DIR,
    'D:\\DSH\\DSH NEXT',
    'D:\\deepseekharness',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'DSH NEXT'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'deepseekharness'),
    path.join(process.env.ProgramFiles || '', 'DSH NEXT'),
    path.join(process.env.ProgramFiles || '', 'deepseekharness'),
  ].filter(Boolean);
  const binGuesses = [];
  for (const dir of installDirs) {
    binGuesses.push(path.join(dir, 'resources', 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'));
    binGuesses.push(path.join(dir, 'resources', 'app', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'));
  }
  binGuesses.push(path.join(dshHome, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'));

  for (const node of nodeGuesses) {
    for (const bin of binGuesses) candidates.push({ bin, node });
  }
  // 实在找不到就用当前进程的 node —— 它要是 node 就能跑
  for (const bin of binGuesses) candidates.push({ bin, node: process.execPath });

  for (const c of candidates) {
    try {
      if (!c.bin || !fs.existsSync(c.bin)) continue;
      if (!c.node || !fs.existsSync(c.node)) continue;
      return c;
    } catch (e) { }
  }
  return null;
}

/* ───────────────────────── 会话状态 ───────────────────────── */

const messages = [];       // {id, role, text, at}
let busy = false;
let queued = 0;
let sessionId = '';
let lastError = '';

function push(role, text) {
  const m = { id: crypto.randomUUID(), role, text: String(text || ''), at: Date.now() };
  messages.push(m);
  if (messages.length > MAX_MESSAGES) messages.splice(0, messages.length - MAX_MESSAGES);
  return m;
}

const found = findDsh();
let runner = null;
let visionRunner = null;
let visionSessionId = '';

async function getRunner() {
  if (runner && runner.alive) return runner;
  if (!found) throw new Error('这台机器上没找到 DSH（bin.js 或 node.exe）');
  runner = new SdkRunner({
    node: found.node,
    bin: found.bin,
    // 不指定 profile：--profile phone-lite 需要一份动态生成的预设文件，
    // 新电脑上不一定有。留空就走 DSH 自己的默认配置，只要有登录就能跑。
    profile: PROFILE,
    cwd: process.cwd(),
    env: process.env,
    log: (tag, msg) => log(`[${tag}]`, msg),
    timeoutMs: 180000,
  });
  await runner.ensure({
    provider: PROVIDER,
    model: MODEL,
    reasoningEffort: EFFORT,
  });
  log('DSH 进程已就绪', path.basename(found.bin), `(${PROVIDER}/${MODEL}/${EFFORT})`);
  return runner;
}


async function getVisionRunner() {
  if (visionRunner && visionRunner.alive) return visionRunner;
  if (!found) throw new Error('这台机器上没找到 DSH（bin.js 或 node.exe）');
  visionRunner = new SdkRunner({
    node: found.node,
    bin: found.bin,
    profile: PROFILE,
    cwd: process.cwd(),
    env: process.env,
    log: (tag, msg) => log('[vision ' + tag + ']', msg),
    timeoutMs: 120000,
  });
  await visionRunner.ensure({
    provider: PROVIDER,
    model: MODEL,
    // 看屏幕只要一句随口点评，不需要高推理档；低档明显更快。
    reasoningEffort: process.env.FISH_VISION_EFFORT || 'low',
  });
  log('看屏幕用的 DSH 会话已就绪');
  return visionRunner;
}

/* ───────────────────────── HTTP ───────────────────────── */

function json(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(b),
    'cache-control': 'no-store',
    // 别的机器（或手机）来连的时候不该被浏览器拦
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
  });
  res.end(b);
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const chunks = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// 对方自报的地址：换设备时可以直接挑一个填进去。
function addresses() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const [nic, list] of Object.entries(nets)) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      // ZeroTier / Tailscale 这类虚拟网卡给的地址换 Wi-Fi 也不变，优先列
      const virtual = /zero|tailscale|zt|wintun|tap/i.test(nic);
      out.push({
        url: `http://${a.address}:${PORT}`,
        // 客户端是从 urlFull 里取 ?t= 拿 token 的（phone-bridge 就是这个形状），
        // 少这个字段它会报「桥接没给出凭证」。
        urlFull: `http://${a.address}:${PORT}/?t=${encodeURIComponent(TOKEN)}`,
        nic,
        label: virtual ? '虚拟局域网（换 Wi-Fi / 用流量也能连）' : '局域网（同一 Wi-Fi 下）',
        priority: virtual ? 0 : 1,
      });
    }
  }
  out.sort((x, y) => x.priority - y.priority);
  return out;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    });
    return res.end();
  }

  // 健康检查：大肥鱼的「测试连接」就是打这个
  if (p === '/api/health') {
    return json(res, 200, {
      app: 'dsh-phone-bridge',     // 故意报这个名字，客户端用它判断对面是不是桥接
      mini: true,
      ok: true,
      token: TOKEN,
      sessionId,
      model: MODEL,
      cwd: process.cwd(),
      busy,
      queued,
      dsh: found ? { bin: found.bin, node: found.node } : null,
      addresses: addresses(),
      error: lastError || undefined,
    });
  }

  // 发一句：立刻返回，真正的回复通过 /api/state 轮询拿
  if (p === '/api/send' && req.method === 'POST') {
    let body = '';
    try { body = await readBody(req); } catch (e) { return json(res, 400, { ok: false, error: 'body 读不动' }); }
    let j = {};
    try { j = JSON.parse(body); } catch (e) { return json(res, 400, { ok: false, error: '不是 JSON' }); }
    const text = String(j.text || '').trim();
    if (!text) return json(res, 400, { ok: false, error: '没内容' });

    push('user', text);
    queued += 1;
    // 不 await：这一轮可能跑几十秒，不能把 HTTP 请求挂在那儿
    (async () => {
      busy = true;
      queued = Math.max(0, queued - 1);
      let acc = '';
      // 流式占位：第一个 text delta 就建一条 assistant 消息，之后原地更新。
      // 以前要等 runTurn 整轮结束才 push，前端只能等整段生成完才开口，
      // 这就是「飞鱼出声慢」最大的一段延迟。
      let live = null;
      let firstTextAt = 0;
      try {
        const r = await getRunner();
        await r.runTurn({
          text,
          sessionId: sessionId || undefined,
          onSession: (sid) => { sessionId = sid; },
          onEvent: (ev) => {
            // runner-sdk 把模型输出拆成一条条 {type:'text', text}，
            // 拼起来才是这一轮完整的回复。
            if (process.env.FISH_BRIDGE_DEBUG) {
              try { log('ev', JSON.stringify(ev).slice(0, 240)); } catch (e) { }
            }
            if (ev.type === 'text' && ev.text) {
              acc += ev.text;
              if (!live) {
                firstTextAt = Date.now();
                live = {
                  id: 'a' + crypto.randomUUID(),
                  role: 'assistant',
                  text: acc,
                  at: firstTextAt,
                  streaming: true,
                };
                messages.push(live);
                if (messages.length > MAX_MESSAGES) messages.splice(0, messages.length - MAX_MESSAGES);
              } else {
                live.text = acc;
              }
            }
            if (ev.type === 'session' && ev.sessionId) sessionId = ev.sessionId;
          },
        });
        lastError = '';
      } catch (e) {
        lastError = String((e && e.message) || e);
        log('这一轮失败:', lastError);
        // DSH 子进程自己死掉的时候，真正的原因只在它的 stderr 里。
        try {
          if (runner && runner.stderrTail) log('DSH stderr:\n' + runner.stderrTail.slice(-1500));
        } catch (e2) { }
        if (!acc) acc = '（这边出了点问题：' + lastError + '）';
      } finally {
        if (!acc.trim()) acc = '（这边出了点问题：' + (lastError || '没有拿到回复') + '）';
        if (live) {
          live.text = acc.trim();
          live.streaming = false;
        } else {
          push('assistant', acc.trim());
        }
        busy = false;
      }
    })();

    return json(res, 200, { ok: true, id: crypto.randomUUID() });
  }

  // 看屏幕：收一张 dataURL 截图，交给独立的 DSH 会话看，再把一句话带回来。
  // 用独立 runner / 独立 session，避免把「看屏幕」的提问混进聊天记录。
  if (p === '/api/vision' && req.method === 'POST') {
    let body = '';
    try { body = await readBody(req, 12 * 1024 * 1024); } catch (e) { return json(res, 400, { ok: false, error: '图片太大或读不动' }); }
    let j = {};
    try { j = JSON.parse(body); } catch (e) { return json(res, 400, { ok: false, error: '不是 JSON' }); }
    const raw = String(j.image || '');
    const m = raw.match(/^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);
    const mimeType = m ? m[1] : 'image/jpeg';
    const data = (m ? m[2] : raw).replace(/\s+/g, '');
    const prompt = String(j.prompt || '').trim();
    if (!data) return json(res, 400, { ok: false, error: '没有图片' });
    if (!prompt) return json(res, 400, { ok: false, error: '没有提示词' });
    try {
      const vr = await getVisionRunner();
      let texts = [];
      const r = await vr.runTurn({
        text: prompt,
        image: { data, mimeType },
        sessionId: visionSessionId || undefined,
        onSession: (sid) => { visionSessionId = sid; },
        onEvent: (ev) => {
          if (ev.type === 'text' && ev.text) texts.push(String(ev.text));
        },
      });
      // runner 可能同时推 attempt（半成品）和 message（定稿）；取最长的那份。
      let text = texts.sort((a, b) => b.length - a.length)[0] || '';
      text = text.replace(/^["“」『]+|["”」』]+$/g, '').replace(/\s+/g, ' ').trim();
      if (!text) return json(res, 502, { ok: false, error: (r && r.error) || '视觉模型没有给出内容（模型支持图片吗？）' });
      return json(res, 200, { ok: true, text, model: MODEL, ms: 0 });
    } catch (e) {
      const msg = String((e && e.message) || e);
      log('看屏幕失败:', msg);
      return json(res, 502, { ok: false, error: msg });
    }
  }

  // 拿状态：大肥鱼按「最后一条消息的时间戳」往后找新回复，所以这里只要给数组。
  // since=毫秒 时只回这之后的消息（含边界），轮询从 80KB 降到几百字节；
  // 流式消息的 at 不变，所以同一个 id 会反复出现，前端按 id 增量读正文。
  if (p === '/api/state') {
    const since = Number(u.searchParams.get('since') || 0) || 0;
    const list = since ? messages.filter((m) => (Number(m.at) || 0) >= since) : messages;
    return json(res, 200, {
      ok: true,
      sessionId,
      busy,
      queued,
      model: MODEL,
      messages: list.map((m) => ({
        id: m.id, role: m.role, text: m.text, at: m.at,
        streaming: !!m.streaming,
        turnId: m.id, completed: !m.streaming, thinking: '', tools: [], steps: [],
      })),
    });
  }

  return json(res, 404, { ok: false, error: '没有这个接口' });
});

// 父进程（大肥鱼）没了就自己退出。
// 主进程的 before-quit 只覆盖正常退出；崩溃或被 taskkill 时它不触发，
// 这里留下的 node.exe 会一直占着端口。
const __ppid = process.ppid;
if (__ppid && __ppid > 0) {
  setInterval(() => {
    let alive = true;
    try {
      process.kill(__ppid, 0);   // 只发信号 0，探活不死人
    } catch (e) {
      alive = false;
    }
    if (!alive) {
      log('父进程 ' + __ppid + ' 已退出，跟着关');
      process.exit(0);
    }
  }, 2000).unref?.();
}

server.listen(PORT, '0.0.0.0', () => {
  log(`迷你桥接已启动 http://127.0.0.1:${PORT}`);
  log('配对码: ' + TOKEN);
  if (found) {
    log('DSH: ' + found.bin);
    log('node: ' + found.node);
    // 看屏幕用的是独立会话；第一轮冷启动要几十秒。空闲时先在后台把它叫醒，
    // 等主人点「看屏幕」时第一句点评就不用再等进程初始化。
    setTimeout(() => {
      getVisionRunner()
        .then(() => log('看屏幕会话预热完成'))
        .catch((e) => log('看屏幕会话预热失败: ' + String((e && e.message) || e)));
    }, 6000).unref?.();
  } else {
    log('没找到 DSH —— 健康检查会一直报错，装好 DSH 再启动就行');
  }
});

const bye = () => {
  try { runner && runner.shutdown && runner.shutdown(); } catch (e) { }
  try { visionRunner && visionRunner.shutdown && visionRunner.shutdown(); } catch (e) { }
  process.exit(0);
};
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
