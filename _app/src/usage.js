// 「她到底花了多少 token」的账本。
//
// 为什么要单独一个模块：token 有两个来源，写法完全不一样 ——
//   1. DSH 对话：数字在 DSH 子进程的 session.event 里（bridge/runner-sdk.mjs 已经把它
//      摘出来，随 turn_end 交给 mini-bridge），大肥鱼这边只能经 HTTP 拉回来入账。
//   2. 自定义 API：数字就在 /chat/completions 的响应体里（choices 旁边那个 usage），
//      主进程转发时顺手记一笔即可。
// 两个来源最后都落到同一个文件（<userData>/usage.json），设置页只认这一份账。
//
// 这里只做「记账 + 汇总」，不含任何 UI 与 IPC —— 那两块分别在 main.js 与
// src/usage-page.js 里，改数字口径时只需要动这一个文件。
const fs = require("fs");
const path = require("path");

// 一轮对话一条记录。600 条约等于几个月的日常聊天；再往前就按 120 天一起清掉。
const MAX_TURNS = 600;
const KEEP_DAYS = 120;

function file(dir) {
  return path.join(dir, "usage.json");
}

function blank() {
  return { version: 1, turns: [] };
}

function read(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(file(dir), "utf8"));
    if (j && Array.isArray(j.turns)) {
      // 老账本里没有 cached 字段（1.6.3 之前记的），读的时候按同样的口径补出来，
      // 免得升级之后旧记录看着像「输入 + 输出 ≠ 合计」。
      const turns = j.turns.filter((t) => t && Number(t.at) > 0).map((t) => {
        if (t.cached == null) {
          const gap = Number(t.total || 0) - Number(t.prompt || 0) - Number(t.completion || 0);
          return Object.assign({}, t, { cached: gap > 0 ? gap : 0 });
        }
        return t;
      });
      return { version: 1, turns };
    }
  } catch (e) { /* 文件还没写、或者被手动改坏了，都当作空账本 */ }
  return blank();
}

function write(dir, data) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    // 先写临时文件再改名：中途断电也不会留下半个 JSON。
    const tmp = file(dir) + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data), "utf8");
    fs.renameSync(tmp, file(dir));
    return true;
  } catch (e) {
    return false;
  }
}

function num(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// 各家接口的字段名不完全一样：OpenAI 系是 prompt_tokens / completion_tokens，
// 有的网关写 input_tokens / output_tokens。这里统一成一套。
function normalize(rec) {
  if (!rec) return null;
  const prompt = num(rec.prompt != null ? rec.prompt : rec.prompt_tokens != null ? rec.prompt_tokens : rec.input_tokens);
  const completion = num(rec.completion != null ? rec.completion : rec.completion_tokens != null ? rec.completion_tokens : rec.output_tokens);
  const total = num(rec.total != null ? rec.total : rec.total_tokens) || prompt + completion;
  if (!prompt && !completion && !total) return null;      // 没有数字的轮次不值得占一行
  // DSH 报的 total_tokens 往往把「缓存命中的上下文」也算进去了（423 + 201 + 9088 = 9712），
  // 光看输入/输出/合计三个数会觉得对不上。这里把差额单独记成 cached，
  // 页面上写成「输入 423 + 缓存 9.1k」，合计就自洽了。
  const cached = num(rec.cached != null ? rec.cached : rec.cached_tokens) ||
    Math.max(0, total - prompt - completion);
  const src = rec.src === "dsh" || rec.src === "api" ? rec.src : "other";
  return {
    id: String(rec.id || (src + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8))),
    at: num(rec.at) || Date.now(),
    src,
    model: String(rec.model || "").slice(0, 60),
    prompt,
    completion,
    total,
    cached,
    ctxUsed: num(rec.ctxUsed),
    ctxMax: num(rec.ctxMax),
    note: String(rec.note || "").slice(0, 80),
  };
}

function prune(turns) {
  const cut = Date.now() - KEEP_DAYS * 86400000;
  let list = turns.filter((t) => Number(t.at) >= cut).sort((a, b) => a.at - b.at);
  if (list.length > MAX_TURNS) list = list.slice(list.length - MAX_TURNS);
  return list;
}

// 记一笔。同一个 id 重复送到（桥接轮询、页面刷新重放）时只算一次。
function add(dir, rec) {
  const t = normalize(rec);
  if (!t) return null;
  const data = read(dir);
  if (data.turns.some((x) => x.id === t.id)) return null;
  data.turns.push(t);
  data.turns = prune(data.turns);
  if (!write(dir, data)) return null;
  return t;
}

function addMany(dir, list) {
  const arr = Array.isArray(list) ? list : [];
  let n = 0;
  for (const rec of arr) { if (add(dir, rec)) n += 1; }
  return n;
}

function dayKey(ms) {
  const d = new Date(ms);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

const SRC_LABEL = { dsh: "DSH 对话", api: "自定义 API", other: "其他" };

function bucket(list) {
  const out = { turns: 0, tokens: 0, prompt: 0, completion: 0, cached: 0 };
  for (const t of list) {
    out.turns += 1;
    out.tokens += t.total;
    out.prompt += t.prompt;
    out.completion += t.completion;
    out.cached += t.cached || 0;
  }
  return out;
}

/**
 * 汇总给设置页看。
 * @param {string} dir 数据目录
 * @param {{days?: number, recent?: number}} opt
 */
function summary(dir, opt) {
  const o = opt || {};
  const days = Math.max(1, Math.min(60, Number(o.days) || 14));
  const recent = Math.max(1, Math.min(100, Number(o.recent) || 20));
  const turns = read(dir).turns;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekStart = todayStart - 6 * 86400000;

  const today = turns.filter((t) => t.at >= todayStart);
  const week = turns.filter((t) => t.at >= weekStart);
  const all = bucket(turns);

  // 来源分布
  const bySrc = [];
  for (const key of ["dsh", "api", "other"]) {
    const list = turns.filter((t) => t.src === key);
    if (!list.length) continue;
    const b = bucket(list);
    b.src = key;
    b.label = SRC_LABEL[key];
    b.share = all.tokens ? Math.round((b.tokens / all.tokens) * 1000) / 10 : 0;
    bySrc.push(b);
  }
  bySrc.sort((a, b) => b.tokens - a.tokens);

  // 近 N 天柱状：没有记录的那天也要有位置，否则图上会跳日期
  const series = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const start = todayStart - i * 86400000;
    const end = start + 86400000;
    const list = turns.filter((t) => t.at >= start && t.at < end);
    const d = new Date(start);
    series.push({
      day: start,
      label: String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"),
      tokens: bucket(list).tokens,
      turns: list.length,
    });
  }

  const last = turns.length ? turns[turns.length - 1] : null;
  return {
    ok: true,
    file: file(dir),
    today: bucket(today),
    week: bucket(week),
    total: all,
    bySrc,
    series,
    recent: turns.slice(-recent).reverse().map((t) => ({
      at: t.at, src: t.src, label: SRC_LABEL[t.src] || t.src,
      model: t.model, prompt: t.prompt, completion: t.completion, total: t.total,
      cached: t.cached || 0,
    })),
    ctx: last && last.ctxUsed ? { used: last.ctxUsed, max: last.ctxMax, at: last.at } : null,
    lastAt: last ? last.at : 0,
  };
}

function clear(dir) {
  return write(dir, blank());
}

module.exports = { file, read, add, addMany, summary, clear, normalize, MAX_TURNS, KEEP_DAYS };
