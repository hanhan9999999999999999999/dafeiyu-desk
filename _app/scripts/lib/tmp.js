"use strict";
/*
 * 探针与测试脚本共用的临时目录。
 *
 * 为什么要有这个文件：
 *   以前每个探针自己 `fs.mkdtempSync(...)`，清理靠 `finally`。三条路会漏：
 *     1. try 里 `process.exit(2)` —— Node 的 process.exit 不执行 finally；
 *     2. 外层 `.catch(e => process.exit(1))` 没接清理；
 *     3. 被外部杀掉（工具超时、Ctrl-C）—— 任何 finally 都来不及。
 *   于是 %TEMP% 里攒下了二十几个 dfy-* 目录。
 *
 * 这里做三件事：
 *   - makeTmp(prefix)：建目录、写 .probe-pid、登记；进程退出（含 Ctrl-C）时同步删；
 *   - sweepStale()：扫 %TEMP% 下自己前缀的旧目录，按 .probe-pid 判活，死的删掉；
 *   - KEEP=1 时全程不动手（探针要留着现场排障）。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const PIDFILE = ".probe-pid";
const PREFIX = /^dfy-/;
const DEFAULT_AGE_MS = 60 * 60 * 1000;

const live = new Set();
let hooked = false;
let swept = false;

function keep() {
  return process.env.KEEP === "1";
}

function rmrf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 });
    return true;
  } catch (e) {
    return false;
  }
}

function sweepMine() {
  if (keep()) return;
  for (const p of live) rmrf(p);
  live.clear();
}

function hook() {
  if (hooked) return;
  hooked = true;
  process.on("exit", sweepMine);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
    try {
      process.on(sig, () => {
        sweepMine();
        process.exit(1);
      });
    } catch (e) {
      /* 某些平台没有这个信号 */
    }
  }
}

function makeTmp(prefix) {
  /* 第一次建目录时顺手扫一遍旧残骸（默认只清「没有 pid 标记且超过一小时」的）。
     不做这一步的话，被 kill -9 掉的那些永远没人收 —— exit 钩子根本没机会跑。
     门槛留在一小时、判活看 pid，所以不会碰到正在跑的另一个探针。 */
  if (!swept && !keep()) {
    swept = true;
    try {
      sweepStale();
    } catch (e) {
      /* 扫不动就算了，不能因为清垃圾把探针本身搞挂 */
    }
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    fs.writeFileSync(path.join(dir, PIDFILE), String(process.pid), "utf8");
  } catch (e) {
    /* 写不进去也能用，只是判活会退回看时间 */
  }
  live.add(dir);
  hook();
  return dir;
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    /* EPERM 说明进程还在，只是不归我管 */
    return !!e && e.code === "EPERM";
  }
}

function judge(dir, olderThanMs) {
  let pid = 0;
  try {
    pid = Number(fs.readFileSync(path.join(dir, PIDFILE), "utf8").trim()) || 0;
  } catch (e) {
    pid = 0;
  }
  if (pid) {
    return pidAlive(pid)
      ? { ok: false, why: "pid " + pid + " 还在跑" }
      : { ok: true, why: "pid " + pid + " 已经不在了" };
  }
  let mtime = 0;
  try {
    mtime = fs.statSync(dir).mtimeMs;
  } catch (e) {
    return { ok: false, why: "看不到" };
  }
  /* 注意 Math.max(0, …)：Windows 的文件系统时间精度会让 mtimeMs 比 Date.now() 大 1 毫秒，
     减出来是 -1。不夹一下的话，「门槛 0 秒」这条会随机判成「还没到期」——
     这条测试在修之前就是三次错一次。 */
  const age = Math.max(0, Date.now() - mtime);
  if (age < olderThanMs) {
    return { ok: false, why: "没有 pid 标记，而且才 " + Math.round(age / 1000) + " 秒" };
  }
  return { ok: true, why: "没有 pid 标记，已经 " + Math.round(age / 60000) + " 分钟" };
}

function sweepStale(opts) {
  const o = opts || {};
  const olderThanMs = typeof o.olderThanMs === "number" ? o.olderThanMs : DEFAULT_AGE_MS;
  const dry = !!o.dry;
  /* root 只在测试里指定 —— 单测必须扫自己的隔离目录，
     否则「把门槛设成 0 秒」的用例会把真实 %TEMP% 里别人留下的东西一起删掉。 */
  const root = o.root ? path.resolve(o.root) : os.tmpdir();
  const removed = [];
  const kept = [];
  let names = [];
  try {
    names = fs.readdirSync(root);
  } catch (e) {
    return { removed, kept, root, error: String(e && e.message) };
  }
  for (const name of names) {
    if (!PREFIX.test(name)) continue;
    const dir = path.join(root, name);
    if (live.has(dir)) continue;
    let st = null;
    try {
      st = fs.statSync(dir);
    } catch (e) {
      continue;
    }
    if (!st.isDirectory()) continue;
    const j = judge(dir, olderThanMs);
    if (!j.ok) {
      kept.push({ dir, why: j.why });
      continue;
    }
    if (dry) {
      removed.push({ dir, why: j.why, dry: true });
      continue;
    }
    if (rmrf(dir)) removed.push({ dir, why: j.why });
    else kept.push({ dir, why: "删不掉（可能还被占着）" });
  }
  return { removed, kept, root };
}

module.exports = { makeTmp, sweepStale, sweepMine, pidAlive, PIDFILE, DEFAULT_AGE_MS };

if (require.main === module) {
  const dry = process.argv.indexOf("--dry") >= 0;
  const ageArg = process.argv.indexOf("--age");
  const olderThanMs = ageArg > 0 ? Number(process.argv[ageArg + 1]) * 1000 : DEFAULT_AGE_MS;
  const r = sweepStale({ dry, olderThanMs });
  console.log((dry ? "只列不删" : "清理") + "：可用 " + r.removed.length + " 个，保留 " + r.kept.length + " 个");
  for (const x of r.removed) console.log((dry ? "  会删 " : "  删了 ") + path.basename(x.dir) + "  — " + x.why);
  for (const x of r.kept) console.log("  留着 " + path.basename(x.dir) + "  — " + x.why);
}
