"use strict";
/**
 * audit-listeners：订阅要有人管。
 *
 * 为什么单独做这个：churn / soak 只看句柄总数，而 EventEmitter 上的监听器
 * 堆积在句柄里是看不见的 —— 句柄不变、内存涨得慢、功能还「正常」，
 * 只是每次触发那个事件，回调多跑一遍。
 *
 * 三条判据：
 *   1. 每个文件的「订阅键」（who.kind("ev")）与次数，必须与
 *      scripts/lib/listeners-reg.json 完全一致 —— 新增一处订阅就红，
 *      逼着写的人回答一句「它为什么不会堆」。
 *   2. 缩进 ≥6 的订阅一律红：那说明它写在某个会被重复调用的函数里。
 *   3. ipcRenderer.on 只许出现在 preload.js（渲染侧各窗口必须在 preload
 *      走一遍，否则每次页面重开都多一份监听，而 preload 只加载一次）。
 *
 * 重新生成登记（只在确认过每一处都安全之后）：
 *   node scripts/audit-listeners.js --write-reg
 */
const fs = require("fs");
const path = require("path");

const APP = path.resolve(__dirname, "..");
const SRC = path.join(APP, "src");
const REG_FILE = path.join(__dirname, "lib", "listeners-reg.json");

const SKIP_DIR = /^(node_modules|_tmp|vendor|lib)$/;

function walk(d, acc) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIR.test(e.name)) continue;
      walk(p, acc);
    } else if (/\.js$/.test(e.name)) acc.push(p);
  }
  return acc;
}

function scan() {
  const files = walk(SRC, []);
  const counts = {};
  const deep = [];
  let ipcOutsidePreload = [];

  for (const f of files) {
    const rel = path.relative(APP, f).replace(/\\/g, "/");
    const lines = fs.readFileSync(f, "utf8").split(/\r?\n/);
    lines.forEach((l, i) => {
      const m = l.match(/\.(on|once|addListener)\(\s*["'`]([\w:.-]+)["'`]/);
      if (!m) return;
      const pre = l.slice(0, m.index);
      const who = (pre.match(/([A-Za-z_$][\w$]*)\s*$/) || [])[1] || "?";
      const key = who + "." + m[1] + '("' + m[2] + '")';
      counts[rel] = counts[rel] || {};
      counts[rel][key] = (counts[rel][key] || 0) + 1;

      const ind = (l.match(/^\s*/) || [""])[0].length;
      if (ind >= 6) deep.push(rel + ":" + (i + 1) + "  " + key + "（缩进 " + ind + "）");

      if (/^ipcRenderer\.(on|once|addListener)$/.test(who + "." + m[1]) && !/preload\.js$/.test(rel)) {
        ipcOutsidePreload.push(rel + ":" + (i + 1) + "  " + key);
      }
    });
  }
  return { files: files.length, counts, deep, ipcOutsidePreload };
}

function main() {
  const { files, counts, deep, ipcOutsidePreload } = scan();
  let pass = 0, fail = 0;
  const ok = (n, e) => { pass++; console.log("✅ " + n + (e ? "  " + e : "")); };
  const bad = (n, e) => { fail++; console.log("❌ " + n + (e ? "  " + e : "")); };
  const want = (n, c, e) => (c ? ok(n, e) : bad(n, e));

  const total = Object.values(counts).reduce((a, o) => a + Object.values(o).reduce((x, y) => x + y, 0), 0);

  if (process.argv.includes("--write-reg")) {
    fs.mkdirSync(path.dirname(REG_FILE), { recursive: true });
    /* 重写只更新 counts。note 与 except 是人写的说明 —— 被脚本抹掉之后，
     * 「这几处深层订阅为什么安全」就没人记得了，下一个人只会把它删掉。 */
    let prev = {};
    try {
      prev = JSON.parse(fs.readFileSync(REG_FILE, "utf8"));
    } catch (e) {
      prev = {};
    }
    const out = {
      note: prev.note || "订阅登记：新增一处订阅要在这里加一次计数，并确认它只注册一次。",
      counts,
      except: Array.isArray(prev.except) ? prev.except : [],
    };
    fs.writeFileSync(REG_FILE, JSON.stringify(out, null, 2) + "\n", "utf8");
    console.log(
      "已写入登记表 " +
        path.relative(APP, REG_FILE) +
        "（" + Object.keys(counts).length + " 个文件 / " + total + " 处订阅 / except " + out.except.length + " 条）"
    );
    return;
  }

  if (!fs.existsSync(REG_FILE)) {
    bad("登记表存在", path.relative(APP, REG_FILE) + " 不在");
    console.log("结果：" + pass + " 通过，" + fail + " 失败");
    process.exitCode = 1;
    return;
  }

  const rawReg = JSON.parse(fs.readFileSync(REG_FILE, "utf8"));
  const reg = rawReg.counts || rawReg;
  const except = rawReg.except || [];
  const exceptWhere = new Set(except.map((x) => x.where));

  /* ① 逐文件逐键比对 */
  const added = [];
  const removed = [];
  const filesAll = new Set([...Object.keys(reg), ...Object.keys(counts)]);
  for (const rel of filesAll) {
    const a = reg[rel] || {};
    const b = counts[rel] || {};
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const x = a[k] || 0;
      const y = b[k] || 0;
      if (y > x) added.push(rel + "  " + k + "  " + x + " → " + y);
      else if (y < x) removed.push(rel + "  " + k + "  " + x + " → " + y);
    }
  }

  /* ② 深层订阅：要么整改，要么在 except 里写明为什么安全 */
  const deepUnexcused = deep.filter((d) => !exceptWhere.has(d.split("  ")[0]));
  /* ③ except 不许过期：写着的每一处都得真的还在 */
  const deepWhere = new Set(deep.map((d) => d.split("  ")[0]));
  const staleExcept = except.filter((x) => !deepWhere.has(x.where)).map((x) => x.where);

  want("扫到了源码", files > 0 && total > 0, files + " 个文件 / " + total + " 处订阅");
  want("没有新增订阅（新增要先回答「它为什么不会堆」，再登记）", added.length === 0, added.slice(0, 6).join("；"));
  want("没有悄悄少掉的订阅（少掉多半是删代码时连带删了）", removed.length === 0, removed.slice(0, 6).join("；"));
  want("深层订阅要么整改、要么登记了理由", deepUnexcused.length === 0, deepUnexcused.slice(0, 4).join("；"));
  want("except 里没有过期条目", staleExcept.length === 0, staleExcept.join("；"));
  want("ipcRenderer.on 只在 preload.js 里出现", ipcOutsidePreload.length === 0, ipcOutsidePreload.slice(0, 4).join("；"));
  want("登记表结构完整", !!reg && typeof reg === "object" && except.length > 0, Object.keys(reg).length + " 个文件 / except " + except.length + " 条");;

  console.log("");
  console.log("结果：" + pass + " 通过，" + fail + " 失败");
  if (fail) process.exitCode = 1;
}

main();
