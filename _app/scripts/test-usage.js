// 用量账本的行为测试 + 接线断言。
//
// 账本最容易错的两处：同一轮被记两次（桥接轮询会重复送）、以及「归零的记录占一行」
// （有的网关不返回 usage，硬记一条 0 token 会让「最近几轮」全是 0）。
// 这里用临时目录真跑 usage.js，不碰用户数据。
const fs = require("fs");
const os = require("os");
const path = require("path");

const APP = path.join(__dirname, "..");
const usage = require(path.join(APP, "src", "usage.js"));

let pass = 0;
let fail = 0;
function ok(name) { pass += 1; console.log("  ✅ " + name); }
function bad(name, why) { fail += 1; console.log("  ❌ " + name + (why ? "  —— " + why : "")); }
function check(name, cond, why) { if (cond) ok(name); else bad(name, why); }

function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "fish-usage-"));
  return d;
}

function main() {
  console.log("用量账本");
  const dir = tmpDir();
  const file = usage.file(dir);

  // ① 没有数字的轮次不该占一行
  check("没有 token 数字的记录被丢掉", usage.add(dir, { src: "dsh", model: "x" }) === null);

  // ② 正常入账
  const t1 = usage.add(dir, { id: "a1", at: Date.now(), src: "dsh", model: "deepseek-flash", prompt: 120, completion: 80 });
  check("记一轮：总量 = 输入 + 输出", !!t1 && t1.total === 200);
  check("落盘文件真的写出来了", fs.existsSync(file));

  // ③ 同一个 id 重复送到只算一次（桥接每 45 秒会重问一遍）
  const dup = usage.add(dir, { id: "a1", at: Date.now(), src: "dsh", prompt: 120, completion: 80 });
  check("同一轮重复送到不会重复记账", dup === null);

  // ④ 各家字段名不一样，也要认（input_tokens / output_tokens）
  usage.add(dir, { id: "b1", at: Date.now(), src: "api", model: "gpt-4o-mini", input_tokens: 300, output_tokens: 100 });
  usage.add(dir, { id: "c1", at: Date.now(), src: "api", model: "gpt-4o-mini", total_tokens: 50 });

  const s = usage.summary(dir, { days: 14, recent: 10 });
  check("今天合计 = 200 + 400 + 50", s.today.tokens === 650, "实测 " + s.today.tokens);
  check("今天轮数 = 3", s.today.turns === 3, "实测 " + s.today.turns);
  check("输入合计 = 120 + 300", s.today.prompt === 420, "实测 " + s.today.prompt);
  check("累计与今天一致（都是今天记的）", s.total.tokens === 650);
  check("来源分成两组", s.bySrc.length === 2, "实测 " + s.bySrc.length);
  check("来源占比加起来约 100%", Math.abs(s.bySrc.reduce((a, x) => a + x.share, 0) - 100) < 0.2);
  check("近 14 天一天一格", s.series.length === 14, "实测 " + s.series.length);
  check("最后一格是今天且有钱", s.series[13].tokens === 650, "实测 " + s.series[13].tokens);
  check("最近几轮按时间倒序", s.recent.length === 3 && s.recent[0].total === 50, JSON.stringify(s.recent.map((x) => x.total)));

  // ⑤ 120 天前的旧账在写入时被裁掉
  usage.add(dir, { id: "old", at: Date.now() - 121 * 86400000, src: "dsh", prompt: 999, completion: 1 });
  const s2 = usage.summary(dir, { days: 14 });
  check("超过 120 天的旧记录被裁掉", s2.total.turns === 3, "实测 " + s2.total.turns);

  // ⑥ 清空
  check("清空返回成功", usage.clear(dir) === true);
  check("清空后账本是 0", usage.summary(dir, { days: 14 }).total.turns === 0);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }

  // ⑦ 接线：三处入口都还在
  console.log("接线");
  const read = (rel) => fs.readFileSync(path.join(APP, rel), "utf8");
  const mainSrc = read("src/main.js");
  const bridgeSrc = read("bridge/mini-bridge.mjs");
  const serverSrc = read("src/server.js");
  const htmlSrc = read("src/settings.html");
  const pageSrc = read("src/usage-page.js");

  check("主进程有 recordUsage()", mainSrc.includes("function recordUsage(o)"));
  check("自定义 API 回话时入账", mainSrc.includes('src: "api"') && mainSrc.includes("usage: (j && j.usage) || null"));
  check("主进程会去桥接收 DSH 的账", mainSrc.includes("async function usagePull()") && mainSrc.includes('/api/usage?since='));
  check("巡检时顺带收账", mainSrc.includes("usagePull().catch(() => { });"));
  check("IPC：usage:summary / usage:clear", mainSrc.includes('ipcMain.handle("usage:summary"') && mainSrc.includes('ipcMain.handle("usage:clear"'));
  check("服务端把账本挂成 /usage/summary", serverSrc.includes('url === "/usage/summary"'));
  check("服务端支持清空 /usage/clear", serverSrc.includes('url === "/usage/clear"'));
  check("迷你桥记 turn_end 的 usage", bridgeSrc.includes("noteUsage(ev.usage, MODEL)"));
  check("迷你桥有 /api/usage", bridgeSrc.includes("p === '/api/usage'"));
  check("迷你桥的账本有上限", bridgeSrc.includes("const USAGE_MAX = 500;"));
  check("设置页有「用量」页签", htmlSrc.includes('data-page="usage"'));
  check("设置页引了 usage-page.js", htmlSrc.includes('src="usage-page.js"'));
  check("页面读的是 /usage/summary", pageSrc.includes('fetch("/usage/summary"'));
  check("页面能清空", pageSrc.includes('fetch("/usage/clear"'));

  console.log("\n结果：" + pass + " 通过、" + fail + " 失败");
  process.exit(fail ? 1 : 0);
}

main();
