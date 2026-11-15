// 日志轮转回归：run.log 超过 2MB 要能一直轮转，不是只轮转一次。
//
// 为什么专门测这个：桌宠是常驻程序，开一整天很正常。旧实现在「第一次写」那一刻
// 才 stat 一次大小，之后就再没人管，日志能一路涨到几百兆；而且 Windows 的 rename
// 不覆盖已存在的目标，第二次轮转还会因为 run.log.1 已存在直接失败 —— 两个问题
// 叠在一起，症状是「用户机器上 run.log 有 300MB，客服不敢让用户发给开发者」。
//
// 做法：把 electron 的 app.getPath 打桩到临时目录，再直接 require src/log.js。
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

const MB = 1024 * 1024;
let pass = 0;
let fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass += 1; console.log("✅ " + name + (detail ? "  " + detail : "")); }
  else { fail += 1; console.log("❌ " + name + (detail ? "  → " + detail : "")); }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dfy-log-"));
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron") return { app: { getPath: () => tmp } };
  return origLoad.call(this, request, parent, isMain);
};

let log;
let logErr;
let LOG_FILE;
try {
  ({ log, logErr, LOG_FILE } = require(path.join(__dirname, "..", "src", "log.js")));
} finally {
  Module._load = origLoad;
}

const sizeOf = (p) => { try { return fs.statSync(p).size; } catch (e) { return -1; } };
const readOf = (p) => { try { return fs.readFileSync(p, "utf8"); } catch (e) { return null; } };
// log() 会同时 console.log；测试里要写 2MB 的行，不能真的打到终端上（会把输出冲没）。
// 只在这些调用期间静音 stdout，文件写入照常。
const quiet = (fn) => {
  const o1 = console.log;
  const o2 = console.error;
  console.log = () => { };
  console.error = () => { };
  try { fn(); } finally { console.log = o1; console.error = o2; }
};

check("日志文件落在 userData/run.log", LOG_FILE === path.join(tmp, "run.log"), LOG_FILE);

// ---------- 1. 启动时已有超大日志 → 第一次写就轮转 ----------
fs.writeFileSync(LOG_FILE, "x".repeat(3 * MB));
quiet(() => log("first line after startup"));
check("启动时超过 2MB 会轮转", sizeOf(LOG_FILE + ".1") >= 3 * MB, "run.log.1=" + sizeOf(LOG_FILE + ".1") + " B");
check("轮转后新日志从空开始", sizeOf(LOG_FILE) < 1024, sizeOf(LOG_FILE) + " B");
check("轮转没有丢掉新写的那一行", (readOf(LOG_FILE) || "").includes("first line after startup"));

// ---------- 2. 进程内继续跑到超过阈值 → 第二次轮转（旧实现在这里失败） ----------
const before1 = sizeOf(LOG_FILE + ".1");
quiet(() => log("y".repeat(2 * MB))); // 单行 2MB，写完后累计已经超过 256KB 的检查间隔
quiet(() => log("trigger the next rotation")); // 这次写之前会检查大小 → 触发第二次轮转
const got1 = sizeOf(LOG_FILE + ".1");
// 第二次轮转后 .1 应该是「刚写满 2MB 的那份」，比第一次的 3MB 小 —— 说明它真被替换了。
check("持续运行超过阈值会再次轮转", got1 > MB && got1 < before1, "run.log.1=" + got1 + " B（上一份 " + before1 + " B）");
check("第二次轮转的 .1 是新的那份", (readOf(LOG_FILE + ".1") || "").includes("yyyy"), "首字符 " + ((readOf(LOG_FILE + ".1") || "?").slice(0, 1)));
check("第二次轮转后 run.log 只剩新行", (readOf(LOG_FILE) || "").includes("trigger the next rotation") && sizeOf(LOG_FILE) < MB, sizeOf(LOG_FILE) + " B");
check("只留一份 .1（不堆积 .2/.3）", !fs.existsSync(LOG_FILE + ".2"), "run.log.2 " + (fs.existsSync(LOG_FILE + ".2") ? "存在" : "不存在"));

// ---------- 3. 普通写入不受影响 ----------
const beforeSize = sizeOf(LOG_FILE);
quiet(() => log("plain line"));
quiet(() => log("another", { a: 1 }));
const after = readOf(LOG_FILE) || "";
check("普通日志照常追加", after.includes("plain line") && after.includes('"a":1'), sizeOf(LOG_FILE) + " B（+" + (sizeOf(LOG_FILE) - beforeSize) + "）");
check("每行都有本地时间戳", /^\[\d{2}:\d{2}:\d{2}\.\d{3}\] /m.test(after));
quiet(() => logErr("boom"));
const errLine = (readOf(LOG_FILE) || "").split("\n").filter((l) => l.includes("boom")).pop() || "";
check("logErr 行带 ERR 前缀", /^\[\d{2}:\d{2}:\d{2}\.\d{3}\] ERR boom$/.test(errLine), errLine);

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { }
check("清理临时目录", !fs.existsSync(tmp), tmp);

console.log("\n结果：" + pass + " 通过，" + fail + " 失败");
process.exit(fail ? 1 : 0);
