"use strict";
/*
 * lib/tmp.js 的单元测试（不启动 Electron）。
 *
 * 守的是「探针的临时目录建得出来就收得回去」：
 *   - makeTmp 建的目录里有 .probe-pid，写的是本进程；
 *   - 判活看 pid，不看文件名；
 *   - 死进程的目录能清，活进程的目录一根头发都不动；
 *   - 没写 pid 的旧目录按时间兜底；
 *   - --dry 只列不删；
 *   - KEEP=1 时什么都不删。
 *
 * 纪律：sweepStale 默认扫真实的 %TEMP%，而单测里会把门槛设成 0 秒 ——
 * 那会把别人留下的目录一起删掉。所以这里一律传 root=<隔离目录>，
 * 并且专门有一条断言守着「单测不许动真实的 %TEMP%」。
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const tmp = require("./lib/tmp");

let pass = 0;
let fail = 0;
const bad = [];

function ok(name, detail) {
  pass += 1;
  console.log("✅ " + name + (detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))));
}

function no(name, detail) {
  fail += 1;
  bad.push(name);
  console.log("❌ " + name + (detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail))));
}

function t(name, cond, detail) {
  if (cond) ok(name, detail);
  else no(name, detail);
}

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "dfy-tmptest-root-"));
const created = [];

function mkRaw(prefix) {
  const d = fs.mkdtempSync(path.join(ROOT, prefix));
  created.push(d);
  return d;
}

function writePid(dir, pid) {
  fs.writeFileSync(path.join(dir, tmp.PIDFILE), String(pid), "utf8");
}

function cleanup() {
  try {
    fs.rmSync(ROOT, { recursive: true, force: true });
  } catch (e) {
    /* 忽略 */
  }
}

function main() {
  /* 0. 隔离根：所有造出来的目录都在它下面 */
  t("造了一个隔离的临时根", fs.existsSync(ROOT) && path.dirname(ROOT) === path.resolve(os.tmpdir()), ROOT);
  t("隔离根自己也带 dfy- 前缀（否则 sweep 看不见）", /^dfy-/.test(path.basename(ROOT)));

  /* 1. makeTmp */
  const mine = tmp.makeTmp("dfy-tmptest-live-");
  created.push(mine);
  t("makeTmp 建出了目录", fs.existsSync(mine), mine);
  t("目录里有 .probe-pid", fs.existsSync(path.join(mine, tmp.PIDFILE)));
  t(
    "pid 文件写的是本进程",
    Number(fs.readFileSync(path.join(mine, tmp.PIDFILE), "utf8").trim()) === process.pid,
    process.pid
  );

  /* 2. 判活 */
  t("pidAlive(自己) 是 true", tmp.pidAlive(process.pid) === true);
  t("pidAlive(999999) 是 false", tmp.pidAlive(999999) === false);
  t("pidAlive(0) 是 false", tmp.pidAlive(0) === false);

  /* 3. 死 pid 的目录会被清 */
  const dead = mkRaw("dfy-tmptest-dead-");
  writePid(dead, 999999);
  const r1 = tmp.sweepStale({ root: ROOT, olderThanMs: 0 });
  t("扫描根就是隔离根，不是真实 %TEMP%", r1.root === ROOT, r1.root);
  t(
    "死进程留下的目录被清掉",
    !fs.existsSync(dead) && r1.removed.some((x) => x.dir === dead),
    r1.removed.filter((x) => x.dir === dead).map((x) => x.why)
  );

  /* 4. 活 pid 的目录一根头发都不动 */
  const alive = mkRaw("dfy-tmptest-alive-");
  writePid(alive, process.pid);
  const r2 = tmp.sweepStale({ root: ROOT, olderThanMs: 0 });
  t("活进程的目录没被动", fs.existsSync(alive));
  t(
    "而且记在 kept 里，写明了原因",
    r2.kept.some((x) => x.dir === alive && /还在跑/.test(x.why)),
    r2.kept.filter((x) => x.dir === alive).map((x) => x.why)
  );

  /* 5. 没有 pid 标记：按时间兜底 */
  const nopid = mkRaw("dfy-tmptest-nopid-");
  const r3 = tmp.sweepStale({ root: ROOT, olderThanMs: 3600000 });
  t("没标记但很新的目录，默认不动", fs.existsSync(nopid) && !r3.removed.some((x) => x.dir === nopid));
  const r4 = tmp.sweepStale({ root: ROOT, olderThanMs: 0 });
  t(
    "把门槛放到 0 秒它就清掉",
    !fs.existsSync(nopid) && r4.removed.some((x) => x.dir === nopid),
    r4.removed.filter((x) => x.dir === nopid).map((x) => x.why)
  );

  /* 6. dry：只列不删 */
  const dryDir = mkRaw("dfy-tmptest-dry-");
  writePid(dryDir, 999999);
  const r5 = tmp.sweepStale({ root: ROOT, olderThanMs: 0, dry: true });
  t("dry 模式列出了它", r5.removed.some((x) => x.dir === dryDir && x.dry === true));
  t("dry 模式一个都没删", fs.existsSync(dryDir));

  /* 7. 不在自己前缀里的目录不碰 */
  const other = mkRaw("notfish-");
  writePid(other, 999999);
  const r6 = tmp.sweepStale({ root: ROOT, olderThanMs: 0 });
  t("不是 dfy- 前缀的目录不碰", fs.existsSync(other) && !r6.removed.some((x) => x.dir === other));

  /* 8. KEEP=1 时 sweepMine 什么都不删 */
  const keepDir = tmp.makeTmp("dfy-tmptest-keep-");
  created.push(keepDir);
  process.env.KEEP = "1";
  tmp.sweepMine();
  t("KEEP=1 时退出钩子不删东西", fs.existsSync(keepDir));
  delete process.env.KEEP;
  tmp.sweepMine();
  t("去掉 KEEP 之后 sweepMine 会清掉自己建的", !fs.existsSync(keepDir));
}

try {
  main();
} finally {
  cleanup();
  console.log("\n结果：" + pass + " 通过，" + fail + " 失败");
  if (fail) console.log("失败项：" + bad.join(" / "));
}
process.exit(fail ? 1 : 0);
