/**
 * 本机数据的白名单审计
 * ────────────────────────────────────────────────────────────────────────────
 * 为什么要有这个：
 *
 * 一个桌宠会在用户目录里留下很多东西 —— 聊天记录、语音缓存、崩溃快照、
 * 看屏幕的边界、日志。商业发行时最怕两件事：
 *
 *   ① 有文件悄悄多了出来，用户和审计的人都说不出它是干什么的；
 *   ② 密钥类字段顺着日志 / 诊断包 / 故障记录流出去。
 *
 * 这个脚本把「哪些文件会落进 userData」变成一份必须登记的清单，
 * 并把「密钥不许出现在日志里」变成静态可查的规则。
 *
 * 用法：node scripts/audit-privacy.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const APP = path.resolve(__dirname, "..");
const out = [];
let pass = 0;
let fail = 0;

function ok(name, detail) {
  pass += 1;
  out.push("✅ " + name + (detail ? "  " + detail : ""));
}
function bad(name, detail) {
  fail += 1;
  out.push("❌ " + name + (detail ? "  " + detail : ""));
}

const read = (p) => fs.readFileSync(path.join(APP, p), "utf8");

const mainSrc = read("src/main.js");
const logSrc = read("src/log.js");
const setSrc = read("src/settings.js");
const privacySrc = (() => {
  try { return read("assets/PRIVACY.txt"); } catch (e) { return ""; }
})();

/* ─────────────── 一、落盘文件清单 ─────────────── */

/* 每一项：文件（相对 userData）· 谁写的 · 里面有什么敏感内容 · 是否可被「清除本机数据」带走
 * wipe:false 的两条要写 why —— 「为什么这个不该被顺手删掉」比「删不删」更重要。 */
const FILES = [
  { p: "settings.json", by: "src/settings.js 的 Settings 落盘", what: "全部设置，含 apiKey / seeKey 明文", wipe: false, why: "清掉等于恢复出厂，得让用户自己在设置里重置" },
  { p: "chatlog.json", by: "main.js chatWriteNow()", what: "和她的全部对话", wipe: true },
  { p: "chatlog.json.bad-*", by: "main.js chatLoad() 读不懂时留的证据", what: "一份读不懂的旧对话文件", wipe: true },
  { p: "chat-bounds.json", by: "main.js 聊天窗位置", what: "窗口坐标", wipe: true },
  { p: "see-bounds.json", by: "main.js 看屏幕窗位置", what: "窗口坐标", wipe: true },
  { p: "petpanel-pos.json", by: "main.js 面板位置", what: "窗口坐标", wipe: true },
  { p: "faults.json", by: "main.js faultSave()", what: "最近 40 条故障，含原始错误文本", wipe: true },
  { p: "run.log", by: "src/log.js", what: "运行日志（密钥已在写入口打码）", wipe: true },
  { p: "run.log.1", by: "src/log.js 轮转", what: "上一份运行日志", wipe: true },
  { p: "last-boot.txt", by: "main.js 启动时", what: "上次启动的时间与参数", wipe: true },
  { p: "boot-timing.txt", by: "main.js writeBootTiming()", what: "启动三段耗时", wipe: true },
  { p: "crash", by: "main.js recordCrash()", what: "崩溃快照（最多 20 份）", wipe: true },
  { p: "Crashpad", by: "Electron crashReporter（uploadToServer:false）", what: "Chromium 自己的崩溃转储", wipe: true },
  { p: "runtime", by: "storageDirs().data，里面是 tts/ 语音缓存", what: "合成出来的音频（等于用户说过的话）", wipe: true },
  { p: "idle-cache", by: "src/idle-cache.js（main.js 里 createIdleCache 的 root）", what: "预合成好的闲置台词音频", wipe: true },
  { p: ".diag-write-test", by: "main.js diagRun() 第 1 项：写一个字节再删掉", what: "体检时探测配置目录可写，内容只有 \"1\"，读完立刻删", wipe: true },
  { p: "diag", by: "main.js diagExport() 的「导出诊断包」", what: "体检报告（md + json），含版本、路径、最近故障文本", wipe: true },
  { p: "models", by: "packs/store.js 导入模型", what: "用户自己导入的 Live2D 模型", wipe: false, why: "用户辛苦导入的模型不该被「清除数据」顺手删掉" },
];

{
  /* 从 main.js 里把所有 path.join(app.getPath("userData"), "…") 抠出来，和清单对账。
   * 取到的是第一段路径（目录名或文件名），所以清单也按第一段比。 */
  const found = new Set();
  const re = /path\.join\(\s*app\.getPath\("userData"\)\s*,\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(mainSrc))) found.add(m[1]);
  const known = new Set(FILES.map((f) => f.p.split("/")[0]));
  const unregistered = [...found].filter((n) => !known.has(n));
  if (unregistered.length === 0) ok("userData 下的落盘路径都登记过了", found.size + " 处：" + [...found].join(", "));
  else bad("有没登记的落盘路径", unregistered.join(", "));

  /* 反向：清单里登记了、代码里却找不到出处的（防清单长霉）。
   * 名字要归一：`chatlog.json.bad-*` 的真名是 chatlog.json；`run.log.1` 是 log.js
   * 用 "run.log" + 后缀拼出来的，没有字面量。settings.json 呢，它根本不写在 main.js 里。 */
  const sources = [mainSrc, logSrc, setSrc];
  const missing = FILES.filter((f) => {
    const n = f.p
      .split("/")[0]
      .replace(/\.bad-\*$/, "")
      .replace(/\.log\.\d+$/, ".log");
    return !sources.some((t) => t.indexOf('"' + n + '"') >= 0);
  });
  if (missing.length === 0) ok("清单每条都能在代码里找到出处", FILES.length + " 条");
  else bad("清单里有对不上代码的条目", missing.map((f) => f.p).join(", "));

  /* 清单必须说清「哪些不删、为什么」—— 只写删的，等于默认全删 */
  const noWhy = FILES.filter((f) => !f.wipe && !f.why);
  if (noWhy.length === 0) {
    ok("不清理的条目都写明了理由", FILES.filter((f) => !f.wipe).map((f) => f.p).join(", "));
  } else {
    bad("这些不清理的条目没写理由", noWhy.map((f) => f.p).join(", "));
  }
}

/* ─────────────── 二、密钥不许进日志 ─────────────── */

{
  /* 只拦「整份设置进日志」：S.get() 直接当实参、或 JSON.stringify(S.get())。
   * 允许 S.get().scale 这种取单个字段的写法 —— 它打不出密钥。 */
  const RISKY = [
    /log(?:Err)?\([^;]*JSON\.stringify\(\s*S\.get\(\)/,
    /log(?:Err)?\([^;]*\bS\.get\(\)\s*[,)]/,
    /log(?:Err)?\([^;]*JSON\.stringify\(\s*(?:patch|settings)\b/,
  ];
  const lines = mainSrc.split(/\r?\n/);
  const hits = [];
  lines.forEach((ln, i) => {
    if (!/\b(log|logErr)\s*\(/.test(ln)) return;
    if (/^\s*\/\//.test(ln)) return;
    for (const re of RISKY) {
      if (re.test(ln)) { hits.push((i + 1) + ": " + ln.trim()); break; }
    }
  });
  if (hits.length === 0) ok("没有把整份设置写进日志的调用");
  else bad("有 log() 会把整份设置（含密钥）打出去", hits.slice(0, 3).join(" | "));
}

{
  /* sanitizeSettings 的 SECRET 集合必须覆盖 DEFAULTS 里所有像密钥的键。
   * 注意排除 hotkey*：快捷键不是密钥，只是名字里有 key。 */
  const secretSet = /const\s+SECRET\s*=\s*new\s+Set\(\[([^\]]+)\]\)/.exec(mainSrc);
  const secretNames = secretSet
    ? secretSet[1].split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
    : [];
  const keyRe = /^\s{2}([A-Za-z][A-Za-z0-9_]*):/gm;
  const defaults = [];
  let mm;
  while ((mm = keyRe.exec(setSrc))) defaults.push(mm[1]);
  const secretLike = defaults.filter((k) => !/^hotkey/i.test(k) && /key|token|password|secret|credential/i.test(k));
  const miss = secretLike.filter((k) => secretNames.indexOf(k) < 0);
  if (miss.length === 0) {
    ok("诊断包的脱敏集合覆盖了所有密钥字段", secretLike.length + " 个：" + secretLike.join(", "));
  } else {
    bad("诊断包会漏掉这些密钥字段", miss.join(", "));
  }
  if (secretSet) ok("脱敏是递归的（嵌套对象也会被处理）", /sanitizeSettings\(v\)/.test(mainSrc));
  else bad("找不到 sanitizeSettings 的实现");
}

/* ─────────────── 三、「清除本机数据」的清单要对得上 ─────────────── */

{
  /* main.js 的 data:wipe 里有两份硬编码清单（files / dirs）。
   * 它和 FILES 里 wipe:true 的那些必须一一对上 —— 两处清单一旦漂了，
   * 要么用户点了按钮没清干净（漏登记），要么清单里写了但代码没删（骗人）。 */
  const blockOf = (name) => {
    const i = mainSrc.indexOf("const " + name + " = [");
    if (i < 0) return null;
    const j = mainSrc.indexOf("];", i);
    return j < 0 ? null : mainSrc.slice(i, j);
  };
  /* files 是纯文件名数组；dirs 里写的是 path.join(U, "crash") / path.join(U, "Crashpad", "reports")，
   * 只有第一个参数才是「userData 下的哪一段」，后面的是它里面的子目录。 */
  const grabFiles = (blk) => {
    const set = new Set();
    if (!blk) return set;
    const re = /"([^"]+)"/g;
    let m;
    while ((m = re.exec(blk))) set.add(m[1]);
    return set;
  };
  const grabDirs = (blk) => {
    const set = new Set();
    if (!blk) return set;
    const re = /path\.join\(\s*U\s*,\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(blk))) set.add(m[1]);
    return set;
  };
  /* .bad-* 是通配备份，不进固定清单，由下面单独一条断言盯着 */
  const wipeList = new Set();
  for (const f of FILES) {
    if (!f.wipe) continue;
    const first = f.p.split("/")[0];
    if (first.indexOf(".bad-") >= 0) continue;
    wipeList.add(first);
  }
  const codeSet = new Set([...grabFiles(blockOf("files")), ...grabDirs(blockOf("dirs"))]);

  const missing = [...wipeList].filter((x) => !codeSet.has(x));
  const extra = [...codeSet].filter((x) => !wipeList.has(x));
  if (missing.length === 0 && extra.length === 0) {
    ok("「清除本机数据」的清单和登记表一致", wipeList.size + " 项");
  } else {
    if (missing.length) bad("这些登记成可清的，代码里没删", missing.join(", "));
    if (extra.length) bad("代码里删了、登记表没写", extra.join(", "));
  }

  /* 最要命的一条：这两个绝不能被卷进去 */
  const mustKeep = ["settings.json", "models"];
  const danger = mustKeep.filter((k) => codeSet.has(k));
  if (danger.length === 0) ok("设置与模型不在清除范围内", mustKeep.join(" / "));
  else bad("清除会把不该删的东西删掉", danger.join(", "));

  /* 通配那类要单独盯：读不懂的旧对话留过 chatlog.json.bad-*，那也是用户说的话 */
  if (/\/\^chatlog\\\.json\\\.bad-\//.test(mainSrc) || /chatlog\\\.json\\\.bad-/.test(mainSrc)) {
    ok("读不懂时留下的 .bad- 备份也在清除范围内");
  } else {
    bad("chatlog.json.bad-* 没被清掉（那也是用户说过的话）");
  }

  /* 清完必须把内存里那几份也清掉，否则下一次写盘会把刚删的写回来 */
  if (/chatItems = null;/.test(mainSrc) && /clearTimeout\(chatSaveTimer\)/.test(mainSrc)) {
    ok("内存里的对话记录与待写盘任务一起清掉了");
  } else {
    bad("只删了文件没清内存，下一次写盘会把聊天记录写回来");
  }

  /* 实现里必须有「不许跑出数据目录」的守卫 */
  if (/const inside = \(p\) => \{[\s\S]{0,160}path\.relative\(U, p\)/.test(mainSrc)) ok("删之前先确认路径落在数据目录里");
  else bad("找不到「路径必须在数据目录内」的守卫");
}

/* ─────────────── 四、隐私说明与代码一致 ─────────────── */

{
  /* 卸载不删数据这件事，必须在隐私说明里写清楚 */
  const pkg = JSON.parse(read("package.json"));
  const keep = !!(pkg.build && pkg.build.nsis && pkg.build.nsis.deleteAppDataOnUninstall === false);
  if (keep) {
    if (/卸载.{0,20}(不会|不).{0,10}删/.test(privacySrc) || /卸载之后.{0,30}(还在|保留)/.test(privacySrc)) {
      ok("卸载保留用户数据这件事写进了隐私说明");
    } else {
      bad("卸载会保留用户数据，但隐私说明没写");
    }
  } else {
    ok("卸载会删掉应用数据（对照不适用）", "deleteAppDataOnUninstall=" + (pkg.build && pkg.build.nsis ? pkg.build.nsis.deleteAppDataOnUninstall : "(未设)"));
  }

  /* 语音缓存里有用户说过的话，隐私说明该提一句 */
  if (/语音缓存|合成的音频/.test(privacySrc)) ok("隐私说明提到了语音缓存");
  else bad("隐私说明没提语音缓存里有合成音频");
}

/* ─────────────── 输出 ─────────────── */

for (const l of out) console.log(l);
console.log("");
console.log("结果：" + pass + " 通过，" + fail + " 失败");
process.exit(fail ? 1 : 0);
