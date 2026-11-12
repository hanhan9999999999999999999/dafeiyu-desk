#!/usr/bin/env node
/**
 * 打包产物自检：dist/win-unpacked 是不是「该有的都有」。
 *
 * 用法：
 *   node scripts/verify-pack.js                 # 默认看 dist/win-unpacked
 *   node scripts/verify-pack.js <目录>          # 指定别的解包目录
 *
 * 退出码：0 全过；1 有缺失。
 *
 * 为什么要它：打包的 `files` 是白名单，漏列一个 assets/voice 就会让安装版
 * `/voice/*.wav` 全 404，而这种问题只有装完点开才看得见。把「必须存在的
 * 文件清单」写成脚本，每次打包后跑一遍，比人肉记靠谱。
 */
const fs = require("fs");
const path = require("path");
const asar = require("@electron/asar");

const ROOT = path.resolve(__dirname, "..");
const DIST = path.resolve(process.argv[2] || path.join(ROOT, "dist", "win-unpacked"));

if (!fs.existsSync(DIST)) {
  console.error("找不到解包目录：" + DIST);
  console.error("先跑一次 node ./node_modules/electron-builder/cli.js --win --x64");
  process.exit(1);
}

let pass = 0;
let fail = 0;
const rows = [];

function check(name, ok, detail) {
  if (ok) {
    pass += 1;
    rows.push(["✅", name, detail || ""]);
  } else {
    fail += 1;
    rows.push(["❌", name, detail || ""]);
  }
}

function must(rel, minBytes) {
  const p = path.join(DIST, rel);
  let st = null;
  try {
    st = fs.statSync(p);
  } catch (e) {
    /* missing */
  }
  const floor = typeof minBytes === "number" ? minBytes : 1;
  const ok = !!st && (st.isDirectory() || st.size >= floor);
  let detail = "missing";
  if (st) {
    if (st.isDirectory()) detail = "dir";
    else detail = (st.size / 1024 / 1024).toFixed(1) + " MB";
  }
  check(rel, ok, detail);
  return st;
}

// ---------- 1. 根目录 ----------
must("大肥鱼.exe", 100 * 1024 * 1024);
must("resources/app.asar", 1024);
must("resources/elevate.exe", 1024);

// ---------- 2. app.asar 内容 ----------
let asarList = [];
try {
  asarList = asar
    .listPackage(path.join(DIST, "resources", "app.asar"))
    .map((s) => s.replace(/\\/g, "/"));
} catch (e) {
  check("读取 app.asar", false, String((e && e.message) || e));
}

const mustInAsar = [
  "/package.json",
  "/src/main.js",
  "/src/preload.js",
  "/src/index.html",
  "/src/settings.html",
  "/src/settings-renderer.js",
  "/src/welcome.html",
  "/src/boot.js",
  "/src/server.js",
  "/src/renderer.js",
  "/src/voice.js",
  "/assets/LICENSE.txt",
  "/assets/PRIVACY.txt",
  "/assets/icon.ico",
  "/assets/voice/body-1.wav",
];
for (const f of mustInAsar) check("asar " + f, asarList.includes(f));

// ---------- 3. resources 顶层目录 ----------
for (const d of ["assets", "bridge", "engine", "rvc", "src", "vendor"]) {
  must("resources/" + d);
}

// ---------- 4. resources/assets ----------
must("resources/assets/LICENSE.txt");
must("resources/assets/PRIVACY.txt");
must("resources/assets/icon.ico");
must("resources/assets/voice");
must("resources/assets/refvoice");

// 语音资源至少要有几个 wav，光有目录不算
let voiceCount = 0;
try {
  voiceCount = fs
    .readdirSync(path.join(DIST, "resources", "assets", "voice"))
    .filter((f) => f.toLowerCase().endsWith(".wav")).length;
} catch (e) {
  /* ignore */
}
check("resources/assets/voice/*.wav", voiceCount > 0, voiceCount + " 个");

// ---------- 5. engine ----------
for (const f of [
  "resources/engine/asr.mjs",
  "resources/engine/tts.mjs",
  "resources/engine/feiyu_server.py",
  "resources/engine/runtime/ffmpeg/ffmpeg.exe",
]) {
  must(f);
}

// ---------- 6. 模型必须不在包里 ----------
// 1.0.0 起明确「程序与模型分离」：模型版权归原画师，安装包不得随附。
// 这条一旦失败就是发版红线，不是「少带了一个资源」。
{
  const modelDir = path.join(DIST, "resources", "model");
  const exists = fs.existsSync(modelDir);
  let stray = [];
  if (exists) {
    try {
      stray = fs.readdirSync(modelDir).filter((f) => /\.(moc3|model3\.json|png|motion3\.json|exp3\.json)$/i.test(f));
    } catch (e) { /* ignore */ }
  }
  check("resources/model 不存在（模型不随包分发）", !exists, exists ? "发现 resources/model" : "");
  check("resources 下没有散落的 moc3/model3", stray.length === 0, stray.slice(0, 3).join(", "));
  // asar 里也顺手查一遍：有人把模型塞进 src/ 也会被这条抓住
  const inAsar = asarList.filter((f) => /\.(moc3|model3\.json)$/i.test(f));
  check("app.asar 里没有 moc3/model3", inAsar.length === 0, inAsar.slice(0, 3).join(", "));
}

// ---------- 7. rvc ----------
must("resources/rvc/rvc_server.py");

// ---------- 8. 体积统计 ----------
let total = 0;
let count = 0;
(function walk(dir) {
  let ents = [];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else {
      try {
        total += fs.statSync(p).size;
        count += 1;
      } catch (x) {
        /* ignore */
      }
    }
  }
})(DIST);

// ---------- 输出 ----------
const wName = rows.reduce((m, r) => Math.max(m, r[1].length), 0);
console.log("");
for (const r of rows) {
  console.log(r[0] + " " + r[1].padEnd(wName) + (r[2] ? "  " + r[2] : ""));
}
console.log("");
console.log(`结果：${pass} 通过，${fail} 失败`);
console.log(`体积：${(total / 1024 / 1024).toFixed(1)} MB / ${count} 文件`);

process.exit(fail ? 1 : 0);
