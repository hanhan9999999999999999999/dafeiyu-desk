#!/usr/bin/env node
/**
 * test-voice-perf.js —— 1.6.0 的「开口快起来」不许悄悄退回去
 *
 * 这一版把首声从 2.5-3.0 秒压到 1.6-2.0 秒，靠的是四件事，每一件都能被一次
 * 无意的重构抹掉，而且抹掉之后功能「看着还正常」——只是又慢回去：
 *   ① 引擎每句都把 token_hop_len 拨回 25（它只增不复位，上一句会把下一句首块拖到 100 token）；
 *   ② 预热推理不在请求路径上（它每次 1.6-2.2 秒，等于把冷启动压在第一句上）；
 *   ③ 同一轮回复沿用同一条参考音（否则一句一个配音员）；
 *   ④ 客户端用一根时间轴播放（不再每块建一个 <audio>，块间留缝）。
 * 外加「首声 / 合成速度」这两项指标要真的从引擎报上来，否则设置页显示的是假数。
 *
 * 用法：node scripts/test-voice-perf.js
 */
const fs = require("fs");
const path = require("path");

const APP = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(APP, rel), "utf8");

const py = read("engine/feiyu_server.py");
const mjs = read("engine/feiyu.mjs");
const voice = read("src/voice.js");
const html = read("src/settings.html");
const shell = read("src/settings-shell.js");
const srender = read("src/settings-renderer.js");

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log("✅ " + name); }
  else { fail += 1; console.log("❌ " + name + (extra ? " —— " + extra : "")); }
}
function between(text, from, to) {
  const a = text.indexOf(from);
  if (a < 0) return "";
  const b = to ? text.indexOf(to, a + from.length) : text.length;
  return text.slice(a, b < 0 ? text.length : b);
}
/* 只截到一个顶层函数结束：函数之间的顺序会变，靠「下一个 def 名」容易截多截少，
 * 截多了会把别人的调用算进来（曾把 do_warm 里的预热判成请求路径上的预热）。 */
function funcBody(text, name) {
  const a = text.indexOf("def " + name + "(");
  if (a < 0) return "";
  const rest = text.slice(a + 4);
  const m = rest.match(/\n(?=def |class )/);
  return m ? rest.slice(0, m.index) : rest;
}

// ── ① 引擎：hop 复位 ─────────────────────────────────────────
const synth = funcBody(py, "synth_stream");
ok("截到了 synth_stream 本体", synth.length > 500, "len=" + synth.length);
ok("有 reset_hop()（把 token_hop_len 拨回起点）", /def reset_hop\(/.test(py));
ok("hop 起点读 STATE[\"hop0\"]", /STATE\.get\("hop0"\)/.test(funcBody(py, "hop_start") + funcBody(py, "reset_hop")));
ok("load_model 里记下了 hop0", /STATE\["hop0"\]\s*=/.test(py));
ok("synth_stream 每句进锁后复位", /with STATE\["lock"\][\s\S]{0,200}reset_hop\(\)/.test(synth), "没在锁内调用 reset_hop");
ok("hop 起点可以用环境变量压（默认 25）", /FISH_FEIYU_HOP0/.test(py));

// ── ② 引擎：预热不在请求路径上 ───────────────────────────────
ok("synth_stream 里不再调 warm_infer", !/warm_infer\(/.test(synth), "请求路径上又出现了预热");
ok("/warm 里一次把所有参考音色预抽完", /参考音色已全部预抽/.test(py));
ok("warm_infer 前后都复位 hop（预热自己也会把 hop 推高）",
  (between(py, "def warm_infer(", "def do_warm(").match(/reset_hop\(\)/g) || []).length >= 2);

// ── ③ 参考音：粘性 + 回落链 ─────────────────────────────────
ok("有 resolve_ref_sticky（同一轮回复锁定音色）", /def resolve_ref_sticky\(/.test(py));
ok("synth_stream 用的是粘性版本", /resolve_ref_sticky\(/.test(synth));
ok("参考音有回落链（manifest 里写错也能出声）", /def resolve_ref\(/.test(py));
ok("粘性窗口不小于 20 秒（长回复的后半段不能换人）",
  (function () {
    const m = /def resolve_ref_sticky\([^)]*ttl\s*=\s*([\d.]+)/.exec(py);
    return m ? Number(m[1]) >= 20 : false;
  })());

// ── ④ 指标：引擎报、Node 转、界面显示 ────────────────────────
ok("perf 里有 firstMs（首块离开引擎的时刻）", /"firstMs"\s*:/.test(py));
ok("perf 里有 audioSec（这次合成了多少秒音频）", /"audioSec"\s*:/.test(py));
ok("perf 里有 cachedSentences（几句是缓存秒回的）", /"cachedSentences"\s*:/.test(py));
ok("/health 把 perf 带出来", /"perf"\s*:\s*STATE\.get\("perf"\)/.test(py), "health 没带 perf");
ok("feiyu.mjs 记 lastPerf", /let lastPerf = null/.test(mjs) && /lastPerf = \{/.test(mjs));
ok("feiyu.mjs 的 status() 带 perf", /export function status\([\s\S]{0,600}perf:\s*lastPerf/.test(mjs));
ok("设置页有「首声」这一列", /id="engFactFirst"/.test(html));
ok("设置页有「合成速度」这一列", /id="engFactRtf"/.test(html));
ok("首声分档上色（2 秒绿 / 3 秒黄）", /2000/.test(srender) && /3000/.test(srender) && /engPerf/.test(srender));
ok("概览有「开口速度」卡", /id="ovFirst"/.test(html));
ok("概览卡真的去读引擎指标", /feiyu_status/.test(shell) && /perf/.test(shell));

// 体检里那一项：没有它，用户只能说「感觉有点慢」，慢在哪一环没人知道。
const mainSrc = read("src/main.js");
const diagBlock = between(mainSrc, 'push("feiyuPerf"', "// 7 XTTS");
ok("体检里有「开口速度」这一项", /开口速度/.test(diagBlock));
ok("体检读的是引擎实测的 firstMs", /Number\(perf\.firstMs\)/.test(mainSrc));
ok("超过 3 秒才判慢（别把正常波动报成故障）", /first > 3000/.test(diagBlock));
ok("引擎没加载时说清楚要等她说过一句话，而不是报错", /skip/.test(diagBlock));


// ── ⑤ 客户端播放：一根时间轴 ─────────────────────────────────
ok("有 createPcmPlayer（时间轴播放器）", /function createPcmPlayer\(/.test(voice));
ok("块是 push 进时间轴，而不是每块建 Blob URL", /player\.push\(bytes\)/.test(voice));
ok("按采样级首尾相接排（start(at)）", /src\.start\(/.test(between(voice, "function createPcmPlayer(", "function playAudio(")));
ok("没有 WebAudio 时保留 <audio> 回落", /URL\.createObjectURL\(new Blob\(\[bytes\]/.test(voice));
ok("没有把 cudnn.benchmark 打开（流式分块下它会把每块都 autotune 一遍）",
  !/cudnn\.benchmark\s*=\s*True/.test(py), "又打开了 cudnn.benchmark");

// ── ⑥ 功能检查：把首块门槛抠出来真跑 ─────────────────────────
const fnSrc = between(voice, "function feiyuFirstBlockReady(", "async function speakFeiyuStream");
ok("抠到了首块门槛的实现", fnSrc.indexOf("firstDur >= 0.8") > 0, "src=" + fnSrc.length);
// eslint-disable-next-line no-new-func
const feiyuFirstBlockReady = new Function(fnSrc + "\nreturn feiyuFirstBlockReady;")();

ok("还没拿到块时不开播", feiyuFirstBlockReady(0, 0, true) === false);
ok("首块够长（0.9s）立刻开播，不再等第二块", feiyuFirstBlockReady(1, 0.9, true) === true);
ok("首块太短（0.4s 语气词）才等第二块", feiyuFirstBlockReady(1, 0.4, true) === false);
ok("第二块到了无论如何都开播（不能无限等）", feiyuFirstBlockReady(2, 0.1, true) === true);
ok("没有时间轴播放器时一块就够（<audio> 顺序播）", feiyuFirstBlockReady(1, 0.2, false) === true);

// ── ⑦ 首句早切：别为了等第一个句号把开口拖后半秒 ────────────────
const cutSrc = between(voice, "function firstCutAt(", "// 把累计文本里")
  + between(voice, "function takeSentences(", "// 边等文字、边合成、边播");
// eslint-disable-next-line no-new-func
const takeSentences = new Function(cutSrc + "\nreturn takeSentences;")();
const tk = (buf, firstCut) => takeSentences(buf, false, firstCut).list;

ok("首句等句号：没有标点时一个字都不切", tk("我刚刚看了一眼你的屏幕", true).length === 0);
ok("首句在逗号处先切一小口", JSON.stringify(tk("我刚刚看了一眼你的屏幕，", true)) === JSON.stringify(["我刚刚看了一眼你的屏幕，"]));
ok("同一个逗号，非首句不切（后面几句照旧等句号）", tk("我刚刚看了一眼你的屏幕，", false).length === 0);
ok("太短的一口（「嗯，」）不单独念", tk("嗯，我把语音那条路又量了一遍，", true).length === 0);
{
  // 句号优先，且「短尾巴」（<6 字）继续攒着 —— 这两条是原有行为，别被首句早切改掉。
  const r = takeSentences("我还没看到你的屏幕。我这就去。", false, true);
  ok("有句号时照旧按句号切（首句早切不许盖掉它）",
    JSON.stringify(r.list) === JSON.stringify(["我还没看到你的屏幕。"]));
  ok("句号之后的短尾巴留在 rest 里等下一段", r.rest === "我这就去。");
}
ok("首句早切要传 !firstStream（只在还没开口时生效）", /takeSentences\(buf, false, !firstStream\)/.test(voice));
ok("头 3 秒按 150ms 催（首声窗口里每多等 200ms 就直接晚 200ms）",
  /waited < 3000 \? 150/.test(voice), "轮询间隔被改回去了");

// ── ⑧ 说话时的「停止」：想让她闭嘴不该只能去按麦克风键 ─────────────
const dockSrc = read("src/dock.js");
const mainHtml = read("src/index.html");
ok("语音模块暴露了 isSpeaking / stop", /isSpeaking:\s*\(\)\s*=>/.test(voice) && /\bstop:\s*\(\)\s*=>/.test(voice));
ok("输入条按状态轮询（不是靠回调，漏一条就会卡在「停止」上）", /setInterval\(syncSpeak, 200\)/.test(dockSrc));
ok("说话时发送键变成「停止」", /sendBtn\.classList\.toggle\("stop"/.test(dockSrc));
ok("说话时点发送是打断，不是发消息", /if \(isSpeaking\(\)\) \{\s*\n\s*stopSpeak\(\);/.test(dockSrc));
ok("停止态有独立配色（红，不跟主题走）", /#dock \.send\.stop\s*\{/.test(mainHtml));
ok("停止态的呼吸动画尊重 prefers-reduced-motion",
  /@media \(prefers-reduced-motion: reduce\) \{\s*\n\s*#dock \.send\.stop \{ animation: none; \}/.test(mainHtml));

console.log("\n结果：" + pass + " 通过，" + fail + " 失败");
process.exitCode = fail ? 1 : 0;
