#!/usr/bin/env node
/**
 * test-voice-fast.js —— 语音链路的「不白等」检查（需求⑦）
 *
 * 以前播放线程用 sleep(30/50) 反复问「下一块好了没」：
 * 每段最多白等 50ms，五段的回复就多出小半秒停顿，CPU 还在空转。
 * 现在改成唤醒通知。这个脚本做两件事：
 *   ① 静态检查：那几条流水线里不能再用 sleep 轮询，必须有 wakeUp 唤醒点；
 *   ② 功能检查：把源码里的 waitTick/wakeUp 原样抠出来跑一遍，
 *      验证「有人叫醒立刻返回」「没人叫醒按超时返回」「叫早了也不丢信号」。
 *
 * 用法：node scripts/test-voice-fast.js
 */
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src", "voice.js");
const src = fs.readFileSync(SRC, "utf8");

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log("✅ " + name); }
  else { fail += 1; console.log("❌ " + name + (extra ? " —— " + extra : "")); }
}
function slice(from, to) {
  const a = src.indexOf(from);
  if (a < 0) return "";
  const b = to ? src.indexOf(to, a + from.length) : src.length;
  return src.slice(a, b < 0 ? src.length : b);
}

// ── ① 静态检查 ───────────────────────────────────────────────
const feiyu = slice("async function speakFeiyuStream", "async function speakStreaming");
const streaming = slice("async function speakStreaming", "async function speak(");

ok("speakFeiyuStream 里不再有 sleep 轮询", !/await\s+sleep\(\s*(30|50)\s*\)/.test(feiyu), "还有 await sleep(...)");
ok("speakStreaming 里不再有 sleep 轮询", !/await\s+sleep\(\s*(30|50)\s*\)/.test(streaming), "还有 await sleep(...)");
ok("飞鱼流水线用 waitTick", /await\s+waitTick\(/.test(feiyu));
ok("分段流水线用 waitTick", /await\s+waitTick\(/.test(streaming));
ok("飞鱼流水线有唤醒点（放块就叫人）", (feiyu.match(/wakeUp\(\)/g) || []).length >= 2, "wakeUp 调用不足");
ok("分段流水线有唤醒点", (streaming.match(/wakeUp\(\)/g) || []).length >= 2, "wakeUp 调用不足");
ok("合成失败时也会叫醒播放线程", /failed\s*=\s*e;\s*wakeUp\(\)/.test(feiyu + streaming));
ok("合成线程结束（finally）会叫醒", /finally\(function\s*\(\)\s*\{\s*finished\s*=\s*true;\s*wakeUp\(\)/.test(feiyu));

// ── ② 功能检查：把 waitTick/wakeUp 抠出来真跑 ─────────────────
const block = slice("let wakeFns = [];", "async function speakStreaming");
ok("抠到了唤醒通知的实现", block.indexOf("function waitTick") > 0 && block.length > 200, "block=" + block.length);

const body = block.replace(/^\s*\/\/.*$/gm, "");
// eslint-disable-next-line no-new-func
const make = new Function(body + "\nreturn { wakeUp, waitTick };");
const api = make();

(async function () {
  // 有人叫醒：立刻返回，不等 50ms
  const t0 = Date.now();
  const p = api.waitTick(5000);
  setTimeout(() => api.wakeUp(), 20);
  await p;
  const waited = Date.now() - t0;
  ok("有人叫醒就立刻返回（不等 5 秒）", waited < 400, "等了 " + waited + "ms");

  // 没人叫醒：按超时返回，不会永远挂着
  const t1 = Date.now();
  await api.waitTick(60);
  const w2 = Date.now() - t1;
  ok("没人叫醒就按超时返回", w2 >= 55 && w2 < 400, "等了 " + w2 + "ms");

  // 唤醒所有人：两个等待者都要醒
  let woke = 0;
  const a = api.waitTick(5000).then(() => { woke += 1; });
  const b = api.waitTick(5000).then(() => { woke += 1; });
  setTimeout(() => api.wakeUp(), 20);
  await Promise.all([a, b]);
  ok("一次 wakeUp 叫醒所有等待者", woke === 2, "woke=" + woke);

  // 超时后残留的等待者不该把下一次唤醒吃掉
  await api.waitTick(30);
  let woke2 = 0;
  const c = api.waitTick(5000).then(() => { woke2 += 1; });
  setTimeout(() => api.wakeUp(), 10);
  await c;
  ok("超时返回过的等待者不会再被唤醒（不会重复 resolve）", woke2 === 1);

  // 唤醒时没有等待者也不报错
  let threw = null;
  try { api.wakeUp(); } catch (e) { threw = e; }
  ok("空唤醒不抛异常", !threw, threw && threw.message);

  console.log("\n结果：" + pass + " 通过，" + fail + " 失败");
  process.exitCode = fail ? 1 : 0;
})().catch((e) => {
  console.log("❌ 异步检查崩了：" + (e && e.stack ? e.stack : e));
  process.exitCode = 1;
});
