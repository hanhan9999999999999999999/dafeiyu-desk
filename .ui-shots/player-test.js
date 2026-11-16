// 用真 AudioContext 量一遍「时间轴播放器」：解码、排片、end() 到底等多久。
// 目的：把「第一句被掐断」这件事变成可复现的数字，而不是靠日志猜。
// 结果写进 document.title，用 Edge --dump-dom 读回来。
const fs = require("fs");
const path = require("path");

const SRC = path.resolve(__dirname, "..", "_app", "src", "voice.js");
const src = fs.readFileSync(SRC, "utf8");

// 从真源码里抠出 createPcmPlayer（与线上跑的是同一份实现，不是复制品）
const start = src.indexOf("  function createPcmPlayer() {");
if (start < 0) throw new Error("找不到 createPcmPlayer");
let i = src.indexOf("{", start);
let depth = 0, end = -1;
for (let k = i; k < src.length; k += 1) {
  const ch = src[k];
  if (ch === "{") depth += 1;
  else if (ch === "}") { depth -= 1; if (depth === 0) { end = k + 1; break; } }
}
const fnSrc = src.slice(start, end).trim();

const page = `<!doctype html><meta charset="utf-8"><title>pending</title>
<body><pre id="out">running…</pre>
<script>
const log = () => {};
let muted = false, volume = 1, mouthRaf = 0;
let mouthCtx = null, mouthAnalyser = null;
function ensureMouthGraph() {
  if (!mouthCtx) { mouthCtx = new AudioContext(); mouthAnalyser = mouthCtx.createAnalyser(); mouthAnalyser.connect(mouthCtx.destination); }
  return true;
}
${fnSrc}
function wav(seconds, freq) {
  const sr = 24000, n = Math.round(sr * seconds);
  const buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
  const str = (o, s) => { for (let k = 0; k < s.length; k += 1) dv.setUint8(o + k, s.charCodeAt(k)); };
  str(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); str(8, "WAVEfmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, "data"); dv.setUint32(40, n * 2, true);
  for (let k = 0; k < n; k += 1) dv.setInt16(44 + k * 2, Math.round(Math.sin((2 * Math.PI * freq * k) / sr) * 8000), true);
  return new Uint8Array(buf);
}

(async () => {
  const out = {};
  try {
    await ensureMouthGraph();
    await mouthCtx.resume();
    const p = createPcmPlayer();
    out.ctxState = mouthCtx.state;
    const parts = [wav(0.8, 440), wav(1.2, 550), wav(1.0, 660)];
    const t0 = performance.now();
    // 模拟真实节奏：块是「陆续到达」的，不是一次给齐
    for (const b of parts) { p.push(b); await new Promise((r) => setTimeout(r, 120)); }
    out.scheduledAt = +((performance.now() - t0) / 1000).toFixed(3);
    const tEnd0 = performance.now();
    await p.end();
    out.endWait = +((performance.now() - tEnd0) / 1000).toFixed(3);
    out.wall = +((performance.now() - t0) / 1000).toFixed(3);
    out.audio = +p.duration.toFixed(3);
    out.delta = +(out.wall - out.audio).toFixed(3);
    out.expect = 3.0;
    out.verdict = Math.abs(out.wall - 3.0) < 0.35 ? "GApLESS-OK" : "MISMATCH";
  } catch (e) {
    out.error = String((e && e.message) || e);
  }
  document.title = JSON.stringify(out);
  document.getElementById("out").textContent = JSON.stringify(out, null, 2);
})();
</script></body>`;

fs.writeFileSync(path.join(__dirname, "player-test.html"), page);
console.log("wrote player-test.html");
