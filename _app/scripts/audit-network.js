"use strict";
/**
 * 出站网络审计：这个程序到底会主动连哪些外面的地方。
 *
 * 为什么要有这个脚本
 * ------------------
 * 「不收集、不上传」是一句承诺，但承诺要靠代码守。用户装的是一个桌宠，
 * 它会读屏幕、会下模型、会连桥接 —— 任何一处悄悄加个上报域名，没人看得出来。
 *
 * 所以这里把 src/ 与 engine/ 里所有 http(s):// 的目标扫出来，分成三类：
 *   1. 本机（127.0.0.1 / localhost / [::1]）—— 允许，不限
 *   2. 用户自己填的（`${...}` 变量拼出来的）—— 允许，因为地址由用户决定
 *   3. 硬编码的外网域名 —— 必须在这份 ALLOW 表里，写清用途和出处
 *
 * 新增一个外网域名而没登记 → 这个脚本红，`npm run verify` 也跟着红。
 *
 * 用法：node scripts/audit-network.js
 */
const fs = require("fs");
const path = require("path");

const APP = path.resolve(__dirname, "..");
const DIRS = ["src", "engine"];
const SKIP_DIR = /(^|[\\/])(vendor|node_modules|\.cache|dist|_tmp|_test|py)([\\/]|$)/i;
const SKIP_FILE = /(\.min\.js|\.map)$/i;

// 硬编码外网白名单。每条都要能回答：谁在用、为什么要连、用户能不能改。
const ALLOW = [
  {
    host: "hf-mirror.com",
    why: "语音识别模型（whisper large-v3-turbo，约 1.6G）",
    where: "engine/asr.mjs",
    note: "只在用户第一次用语音输入（或手动点下载）时发生；环境变量 FISH_TURBO_URL 可整条替换成自己的地址",
  },
  {
    host: "api.github.com",
    why: "检查更新（问一下最新版本号）",
    where: "src/main.js",
    note: "只在用户点「检查更新」时发生，启动时不会自己跑",
  },
  {
    host: "github.com",
    why: "打开版本下载页 / 打开项目主页",
    where: "src/main.js",
    note: "由 shell.openExternal 交给浏览器，程序自己不请求",
  },
];

const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0|::1)$/i;
// XML / SVG 的命名空间长得像网址，但它永远不会被请求
const NAMESPACE = /^www\.w3\.org$/i;
// 出站必须走 fetch；`http.request(` / `https.get(` 这类直接调用会绕开审计点。
// 注意别写成 `/\.(request|get)\(/` —— 那会把 `S.get()` / `map.get()` / `q.get()` 全算进来。
const OUTBOUND_HTTP = /\bhttps?\.(request|get)\s*\(/;

function walk(dir, out) {
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (SKIP_DIR.test(p)) continue;
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|mjs|cjs)$/i.test(e.name) && !SKIP_FILE.test(e.name)) out.push(p);
  }
  return out;
}

const files = [];
for (const d of DIRS) walk(path.join(APP, d), files);

const URL_RE = /https?:\/\/([A-Za-z0-9._\-[\]:$]+)/g;
const found = new Map(); // host -> Set("file:line")
let totalUrls = 0;
let loopbackUrls = 0;
let dynamicUrls = 0;

for (const f of files) {
  let src;
  try {
    src = fs.readFileSync(f, "utf8");
  } catch (e) {
    continue;
  }
  const rel = path.relative(APP, f).replace(/\\/g, "/");
  const lines = src.split(/\r?\n/);
  lines.forEach((line, i) => {
    // 注释里的地址也算：注释常常在解释「我们会连哪里」，那正是要审的东西
    let m;
    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(line))) {
      const hostRaw = m[1];
      totalUrls += 1;
      if (hostRaw.indexOf("$") >= 0) {
        dynamicUrls += 1;
        continue;
      }
      // hostRaw 可能是 127.0.0.1:8899 / 127.0.0.1:PORT / 127.0.0.1: —— 一律取冒号前那段
      const host = hostRaw.split(":")[0].toLowerCase();
      if (!host) {
        dynamicUrls += 1;
        continue;
      }
      if (LOOPBACK.test(host) || NAMESPACE.test(host)) {
        loopbackUrls += 1;
        continue;
      }
      if (!found.has(host)) found.set(host, new Set());
      found.get(host).add(rel + ":" + (i + 1));
    }
  });
}

const allowMap = new Map(ALLOW.map((a) => [a.host.toLowerCase(), a]));
const unknown = [];
for (const [host, where] of found) {
  if (!allowMap.has(host)) unknown.push({ host, where: [...where] });
}
const unused = ALLOW.filter((a) => !found.has(a.host.toLowerCase()));

let pass = 0;
let fail = 0;
function ok(name, detail) {
  pass += 1;
  console.log("✅ " + name + (detail ? "  " + detail : ""));
}
function bad(name, detail) {
  fail += 1;
  console.log("❌ " + name + (detail ? "  " + detail : ""));
}

console.log(
  "[audit] 扫了 " + files.length + " 个文件，见到 " + totalUrls + " 处 URL（其中 " + loopbackUrls + " 处本机/命名空间、" + dynamicUrls + " 处由变量拼）"
);
console.log("");
console.log("硬编码的外网目标：");
if (!found.size) console.log("  （一个都没有）");
for (const [host, where] of [...found].sort()) {
  const a = allowMap.get(host);
  console.log("  " + host + (a ? "  " + a.why : "  ⚠ 没登记"));
  console.log("      出处：" + [...where].join("、"));
  if (a) console.log("      备注：" + a.note);
}
console.log("");

ok("扫到的文件不是空集", files.length + " 个");

if (unknown.length === 0) {
  ok("没有未登记的外网域名", "共 " + found.size + " 个，全部在白名单里");
} else {
  for (const u of unknown) bad("发现未登记的外网域名：" + u.host, u.where.join("、"));
}

if (unused.length === 0) {
  ok("白名单没有过期条目");
} else {
  for (const a of unused) bad("白名单里的 " + a.host + " 已经没有任何代码在用（该删就删）");
}

// 白名单里登记的「出处」必须真的存在 —— 免得有人把地址挪走、白名单还留着挡路
for (const a of ALLOW) {
  const where = [...(found.get(a.host.toLowerCase()) || [])];
  if (!where.length) continue;
  if (where.some((w) => w.indexOf(a.where + ":") === 0)) {
    ok(a.host + " 出现在登记的位置（" + a.where + "）");
  } else {
    bad(a.host + " 的出处和登记不符", "登记 " + a.where + "，实际 " + where.join("、"));
  }
}

// 启动路径上不许出现「检查更新」的自动调用：这条最容易被后来的改动破坏
const autoUpdate = [];
for (const f of files) {
  const rel = path.relative(APP, f).replace(/\\/g, "/");
  if (rel !== "src/main.js") continue;
  const src = fs.readFileSync(f, "utf8");
  src.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*checkUpdate\s*\(\s*\)\s*;/.test(line)) autoUpdate.push(rel + ":" + (i + 1) + " " + line.trim());
  });
}
if (autoUpdate.length === 0) {
  ok("启动路径上没有自动检查更新");
} else {
  for (const a of autoUpdate) bad("发现可能自动执行的检查更新：" + a);
}

// 出站必须经过 net.fetch 或 node fetch，不能有 http.request 绕过审计点
const rawHttp = [];
for (const f of files) {
  const rel = path.relative(APP, f).replace(/\\/g, "/");
  const src = fs.readFileSync(f, "utf8");
  src.split(/\r?\n/).forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "");
    if (OUTBOUND_HTTP.test(code) && !/createServer|\.listen\(/.test(code)) {
      rawHttp.push(rel + ":" + (i + 1) + " " + line.trim());
    }
  });
}
if (rawHttp.length === 0) {
  ok("没有绕过 net.fetch 的裸 http 出站调用");
} else {
  for (const r of rawHttp) bad("发现裸 http 出站调用（绕过审计点）：" + r);
}

console.log("");
console.log("结果：" + pass + " 通过，" + fail + " 失败");
process.exit(fail === 0 ? 0 : 1);
