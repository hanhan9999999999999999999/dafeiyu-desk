// 时间轴播放器的行为测试（真跑，不打桩在字符串上）。
//
// 背景：用户报「语音第一句没说完、卡一半，下一句就出来了，后面很流畅」。
// 根因是 createPcmPlayer().end() 在「块还在 decodeAudioData 里」时就判定播完，
// 调用方立刻去播下一句，第一句被盖住。
// 这里用假的 AudioContext 复现那个时序，钉住「end() 必须等解码链 + 等时间轴」。
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "src", "voice.js");
const src = fs.readFileSync(SRC, "utf8");

let pass = 0;
let fail = 0;
function ok(name) { pass += 1; console.log("  ✅ " + name); }
function bad(name, why) { fail += 1; console.log("  ❌ " + name + (why ? "  —— " + why : "")); }
function check(name, cond, why) { if (cond) ok(name); else bad(name, why); }

// 从源码里抠出一个函数声明（按花括号配对），用来在没有浏览器的地方真跑。
function extractFn(name) {
  const head = "function " + name + "(";
  const i = src.indexOf(head);
  if (i < 0) throw new Error("找不到 " + head);
  let j = src.indexOf("{", i);
  let depth = 0;
  for (let k = j; k < src.length; k += 1) {
    const ch = src[k];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (!depth) return src.slice(i, k + 1);
    }
  }
  throw new Error(name + " 的花括号没配平");
}

// 假 AudioContext：时间由测试自己推，解码按固定延迟异步完成。
function makeEnv(decodeMs) {
  const clock = { t: 0 };
  const made = [];
  const ctx = {
    state: "running",
    resume() { },
    get currentTime() { return clock.t; },
    createGain() {
      const g = { gain: { value: 1 }, connect() { }, disconnect() { } };
      return g;
    },
    decodeAudioData() {
      return new Promise((r) => setTimeout(() => r({ duration: 0.5 }), decodeMs));
    },
    createBufferSource() {
      const s = {
        buffer: null, onended: null, startAt: 0,
        connect() { }, disconnect() { },
        start(t) { s.startAt = t; },
        stop() { if (s.onended) s.onended(); },
      };
      made.push(s);
      return s;
    },
  };
  return { clock, ctx, made };
}

function build(makeGraph, env, logFn) {
  const body = extractFn("createPcmPlayer");
  const factory = new Function(
    "ensureMouthGraph", "mouthCtx", "mouthAnalyser", "muted", "volume", "log",
    body + "\nreturn " + "createPcmPlayer;"
  );
  return factory(makeGraph, env.ctx, null, false, 1, logFn || function () { })();
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
function settled(p) {
  const s = { v: false };
  p.then(() => { s.v = true; });
  return s;
}

async function main() {
  console.log("时间轴播放器");
  const env = makeEnv(40);
  const player = build(() => true, env, function () { });
  check("createPcmPlayer 能造出播放器", !!player);

  // ① 关键回归：块还在解码时就调 end()，不能立刻算播完。
  const bytes = new Uint8Array([1, 2, 3, 4]);
  player.push(bytes);
  const s1 = settled(player.end());
  await wait(10);
  check("解码没落地时 end() 不提前收工（第一句不会被下一句盖掉）", s1.v === false);
  await wait(120);                     // 40ms 解码 + 时间轴 0.5s 起步
  env.clock.t = 2.0;                   // 把时间推过时间轴
  // arm() 的收工定时器是按「当时的时间轴长度」定的（约 600ms），所以这里等够。
  await wait(800);
  check("时间轴走完后 end() 正常 resolve", s1.v === true);

  // ② 一块都没有时，end() 应该立刻收工，不让人白等。
  const env2 = makeEnv(40);
  const p2 = build(() => true, env2, function () { });
  const t0 = Date.now();
  await p2.end();
  check("没排任何块时 end() 立刻返回", Date.now() - t0 < 100, "等了 " + (Date.now() - t0) + "ms");

  // ③ 两块首尾相接：总时长应该是两块之和（采样级不留缝）。
  const env3 = makeEnv(5);
  const p3 = build(() => true, env3, function () { });
  p3.push(new Uint8Array([1]));
  p3.push(new Uint8Array([2]));
  await wait(80);
  const d = p3.duration;
  check("两块首尾相接，总时长 = 0.5 + 0.5", Math.abs(d - 1.0) < 0.12, "实测 " + d.toFixed(3));

  // ④ stop() 之后不会再排新块（打断时要立刻静音）。
  const env4 = makeEnv(5);
  const p4 = build(() => true, env4, function () { });
  p4.push(new Uint8Array([1]));
  await wait(30);
  p4.stop();
  const before = p4.duration;
  p4.push(new Uint8Array([2]));
  await wait(30);
  check("stop() 之后 push 不再排片", Math.abs(p4.duration - before) < 0.001);

  // ⑤ 静态面：drain 不得抢首句的话筒，也不该再走 <audio> 老路。
  const drain = src.slice(src.indexOf("async drain()"), src.indexOf("async drain()") + 2600);
  check("drain() 等首句播完", drain.includes("await pcmPlayer.wait()"));
  check("drain() 用时间轴续播而不是每句 new Audio", drain.includes("await player.push(new Uint8Array(buf))"));

  console.log("\n结果：" + pass + " 通过、" + fail + " 失败");
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("崩了：" + (e && e.stack ? e.stack : e));
  process.exit(2);
});
