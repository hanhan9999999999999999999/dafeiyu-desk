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
const crypto = require("crypto");
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

// ---------- 6b. 安装目录里不能有调试日志 ----------
// electron-builder 会把整个 runtime/ 复制进来，开发机上 Chromium 留下的
// debug.log 会跟着进安装目录。发出去之前必须清掉（afterpack 负责删）。
{
  let logs = [];
  try {
    logs = fs.readdirSync(DIST).filter((f) => /\.log$/i.test(f));
  } catch (e) { /* ignore */ }
  check("安装目录没有调试日志", logs.length === 0, logs.join(", "));
}

// ---------- 6c. 发布说明必须和安装包对得上 ----------
// 发版说明里的体积与 SHA-256 是用户核对安装包的唯二依据；写错一位数，
// 用户按说明校验就会以为包被篡改。这里直接拿磁盘上的包去比。
function sha256File(file) {
  const h = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  const buf = Buffer.allocUnsafe(1 << 20);
  try {
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest("hex").toUpperCase();
}
{
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const v = pkg.version;
  const installer = path.join(path.dirname(DIST), "大肥鱼-" + v + "-安装包.exe");
  const notes = path.resolve(ROOT, "..", "docs", "RELEASE-" + v + ".md");
  if (!fs.existsSync(installer)) {
    check("发布说明与安装包一致（v" + v + "）", false, "找不到 " + path.basename(installer));
  } else if (!fs.existsSync(notes)) {
    check("发布说明与安装包一致（v" + v + "）", false, "缺少 docs/RELEASE-" + v + ".md");
  } else {
    const size = fs.statSync(installer).size;
    const text = fs.readFileSync(notes, "utf8");
    const sizeOk = text.includes(size.toLocaleString("en-US"));
    const sha = sha256File(installer);
    const shaOk = text.toUpperCase().includes(sha);
    check("发布说明与安装包一致（大小 + SHA-256）", sizeOk && shaOk,
      !sizeOk ? "大小不匹配，应为 " + size.toLocaleString("en-US") + " B"
        : (!shaOk ? "SHA-256 不匹配，应为 " + sha : ""));
  }
}

// ---------- 6d. 包里不带测试夹具（体积 / 文件数 / 长路径三条红线） ----------
// 背景（2026-11-14 实测）：安装包里曾带着 5647 个测试文件，光
// site-packages/onnx/backend/test/data 就是 5525 个 / 17.6 MB，占全部安装文件的
// 43%。安装与卸载的耗时主要是「文件数 × 单文件开销」堆出来的（1.9 GB / 12810
// 文件，覆盖安装实测约 130 秒），而且那条 203 字符的相对路径在深安装目录下
// 会顶到 MAX_PATH。三条线写死，别让它们被再带回来。
const tree = { files: [], dirs: new Set() };
(function walk(dir, rel) {
  let ents = [];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    const r = rel ? rel + "/" + e.name : e.name;
    if (e.isDirectory()) {
      tree.dirs.add(r);
      walk(p, r);
    } else {
      tree.files.push(r);
    }
  }
})(DIST, "");
{
  const testDirs = [...tree.dirs].filter((d) => /(^|\/)(test|tests)$/i.test(d));
  check("没有随包分发测试夹具目录", testDirs.length === 0,
    testDirs.length > 3 ? testDirs.slice(0, 3).join(", ") + " 等 " + testDirs.length + " 个" : testDirs.join(", "));
  check("安装文件数 ≤ 8000", tree.files.length <= 8000, tree.files.length + " 个");
  const longest = tree.files.reduce((m, f) => (f.length > m.length ? f : m), "");
  check("最长相对路径 ≤ 190 字符（MAX_PATH 余量）", longest.length <= 190,
    longest.length + " 字符：" + longest);
}

// ---------- 7. rvc ----------
must("resources/rvc/rvc_server.py");
// ---------- 8. 体积统计 ----------
let total = 0;
let count = tree.files.length;
for (const f of tree.files) {
  try {
    total += fs.statSync(path.join(DIST, f)).size;
  } catch (e) {
    /* ignore */
  }
}

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
