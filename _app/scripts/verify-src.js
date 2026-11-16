#!/usr/bin/env node
/**
 * 源码自检：页面引用、CSP、IPC 桥接是否对得上。
 *
 * 用法：node scripts/verify-src.js
 * 退出码：0 全过；1 有错误（⚠️ 只是提示，不算失败）。
 *
 * 查三件事：
 *   1. 每个 .html 都有 CSP
 *   2. 每个 <script src> / <link href> 指向的文件真的存在
 *   3. preload 里 invoke 的每个 channel，main 里都有 ipcMain.handle
 *      （反过来 main 有、preload 没暴露的，只给提示 —— 可能只是内部通道）
 */
const fs = require("fs");
const path = require("path");

const SRC = path.resolve(__dirname, "..", "src");

let pass = 0;
let fail = 0;
let warn = 0;
const rows = [];

function ok(n, d) {
  pass += 1;
  rows.push(["✅", n, d || ""]);
}
function bad(n, d) {
  fail += 1;
  rows.push(["❌", n, d || ""]);
}
function wrn(n, d) {
  warn += 1;
  rows.push(["⚠️", n, d || ""]);
}

// ---------- 1 & 2. HTML：CSP + 引用 ----------
const htmls = fs.readdirSync(SRC).filter((f) => f.toLowerCase().endsWith(".html"));

for (const h of htmls) {
  const full = path.join(SRC, h);
  const text = fs.readFileSync(full, "utf8");

  if (!/Content-Security-Policy/i.test(text)) bad(h + " 缺少 CSP");
  else ok(h + " 有 CSP");

  const refs = [];
  for (const m of text.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) refs.push(["script", m[1]]);
  for (const m of text.matchAll(/<link[^>]*\shref="([^"]+)"/g)) refs.push(["link", m[1]]);

  for (const [kind, ref] of refs) {
    if (/^(https?:)?\/\//.test(ref) || ref.startsWith("data:")) continue;
    const p = ref.startsWith("/")
      ? path.join(SRC, "..", ref.slice(1))
      : path.resolve(SRC, ref);
    if (fs.existsSync(p)) ok(`${h} → ${ref}`);
    else bad(`${h} → ${ref}（${kind}）不存在`);
  }
}

// ---------- 3. IPC 桥接 ----------
const mainSrc = fs.readFileSync(path.join(SRC, "main.js"), "utf8");
const preloadSrc = fs.readFileSync(path.join(SRC, "preload.js"), "utf8");

const handled = new Set();
for (const m of mainSrc.matchAll(/ipcMain\.handle\(\s*"([^"]+)"/g)) handled.add(m[1]);

const invoked = new Set();
for (const m of preloadSrc.matchAll(/invoke\(\s*"([^"]+)"/g)) invoked.add(m[1]);

for (const ch of [...invoked].sort()) {
  if (handled.has(ch)) ok("IPC " + ch);
  else bad("preload 调用了未注册的 IPC：" + ch);
}
for (const ch of [...handled].sort()) {
  if (!invoked.has(ch)) wrn("main 注册了但 preload 没暴露：" + ch);
}

// ---------- 4. getElementById 的 id 在引用它的 html 里存在 ----------
// 这一项防的是「els.xxx 是 null → addEventListener 抛错 → 整个面板初始化失败」。
// 动态创建的元素（createElement 之后 .id = "x"）不算缺失，先把它们收集起来。
for (const js of fs.readdirSync(SRC).filter((f) => f.endsWith(".js"))) {
  const jsText = fs.readFileSync(path.join(SRC, js), "utf8");
  const ids = [...jsText.matchAll(/getElementById\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]);
  // 有页面习惯把取元素包成 $("x")（adapter.js 就是）。只在文件里确实定义了
  // 「$ = (id) => document.getElementById(id)」时才按这个模式再收一遍，
  // 免得把别的 $("...") 当成元素 id。
  if (/const\s+\$\s*=\s*\([^)]*\)\s*=>\s*document\.getElementById/.test(jsText)) {
    for (const m of jsText.matchAll(/(?<![\w.$])\$\(\s*"([^"]+)"\s*\)/g)) ids.push(m[1]);
  }
  if (!ids.length) continue;

  const dynamic = new Set(
    [...jsText.matchAll(/\.id\s*=\s*"([^"]+)"/g)].map((m) => m[1])
  );

  // 谁引用了这个 js，就在谁里面找 id
  const owners = htmls.filter((h) =>
    fs.readFileSync(path.join(SRC, h), "utf8").includes(js)
  );
  if (!owners.length) {
    wrn(`${js} 没有页面引用，跳过 id 检查`);
    continue;
  }

  const union = new Set();
  for (const h of owners) {
    const t = fs.readFileSync(path.join(SRC, h), "utf8");
    for (const m of t.matchAll(/\sid="([^"]+)"/g)) union.add(m[1]);
  }

  for (const id of [...new Set(ids)].sort()) {
    if (dynamic.has(id)) continue;
    if (union.has(id)) ok(`${js} #${id}`);
    else bad(`${js} 引用了不存在的 #${id}`);
  }
}

// ---------- 5. 文档与许可：README 链接可达、两份 LICENSE 不漂移 ----------
// 这一项防的是「README 里写着 BUILD.md，仓库里却没有」和
// 「安装器读根目录 LICENSE、应用读 assets/LICENSE，两份各改一半」。
const APP = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(APP, "package.json"), "utf8"));
const readmePath = path.join(APP, "README.md");

if (!fs.existsSync(readmePath)) {
  bad("README.md 不存在");
} else {
  const md = fs.readFileSync(readmePath, "utf8");
  const links = new Set();
  for (const m of md.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) links.add(m[1]);
  for (const m of md.matchAll(/(?:src|href)="([^"]+)"/g)) links.add(m[1]);

  for (const raw of [...links].sort()) {
    if (/^(https?:|mailto:|#|data:)/i.test(raw)) continue;
    const rel = decodeURI(raw.split("#")[0].split("?")[0]);
    if (!rel) continue;
    if (fs.existsSync(path.resolve(APP, rel))) ok("README → " + rel);
    else bad("README → " + rel + " 不存在");
  }

  if (md.includes("version-" + pkg.version + "-")) ok("README 版本徽章 = " + pkg.version);
  else bad(`README 版本徽章不是 ${pkg.version}`);
}

const licRoot = path.join(APP, "LICENSE.txt");
const licAssets = path.join(APP, "assets", "LICENSE.txt");
if (!fs.existsSync(licRoot) || !fs.existsSync(licAssets)) {
  bad("LICENSE.txt 或 assets/LICENSE.txt 缺失");
} else if (fs.readFileSync(licRoot, "utf8") === fs.readFileSync(licAssets, "utf8")) {
  ok("LICENSE.txt 与 assets/LICENSE.txt 一致");
} else {
  bad("LICENSE.txt 与 assets/LICENSE.txt 不一致（安装许可页会显示旧条款）");
}

const changelog = path.resolve(APP, "..", "CHANGELOG.md");
if (!fs.existsSync(changelog)) {
  wrn("没有找到 ../CHANGELOG.md");
} else if (fs.readFileSync(changelog, "utf8").includes("## " + pkg.version)) {
  ok("CHANGELOG 有 " + pkg.version + " 段落");
} else {
  bad("CHANGELOG.md 没有 " + pkg.version + " 段落");
}

// ---------- 5b. HTML 引用的本地脚本/样式必须存在 ----------
// 改文件名最容易漏一处，而页面加载 404 只表现为「某个按钮没反应」——
// 没有构建步骤替我们查，就自己查。
{
  const srcDir = path.join(APP, "src");
  const htmls = fs.readdirSync(srcDir).filter((f) => f.endsWith(".html"));
  const missing = [];
  for (const h of htmls) {
    const html = fs.readFileSync(path.join(srcDir, h), "utf8");
    for (const m of html.matchAll(/<(?:script|link)[^>]+(?:src|href)="([^"]+)"/g)) {
      const raw = m[1];
      if (/^(https?:|data:|#)/i.test(raw)) continue;
      const p = path.resolve(srcDir, raw.split("?")[0].split("#")[0]);
      if (!fs.existsSync(p)) missing.push(h + " → " + raw);
    }
  }
  if (missing.length === 0) ok("HTML 引用的本地脚本/样式都存在（" + htmls.length + " 个页面）");
  else bad("HTML 引用了不存在的文件：" + missing.slice(0, 4).join("，"));
}

// ---------- 5c. 主窗的无障碍契约 ----------
// 气泡是桌宠唯一的「说话」出口：读屏要知道它会变；出错提示要能被打断读出来；
// 输入框只有 placeholder 不算名字。这三条一改就静默退化，钉住。
{
  const html = fs.readFileSync(path.join(APP, "src", "index.html"), "utf8");
  const tagOf = (id) => (html.match(new RegExp('<[^>]+id="' + id + '"[^>]*>')) || [""])[0];
  const bubble = tagOf("bubble");
  const err = tagOf("err");
  const input = tagOf("dockInput");
  const okBubble = /role="status"/.test(bubble) && /aria-live="polite"/.test(bubble);
  const okErr = /role="alert"/.test(err) && /aria-live="assertive"/.test(err);
  const okInput = /aria-label="[^"]+"/.test(input);
  if (okBubble) ok("主窗气泡是 live region（role=status / aria-live=polite）");
  else bad("主窗气泡缺少 role=status 或 aria-live=polite");
  if (okErr) ok("主窗错误条可被读屏打断（role=alert / aria-live=assertive）");
  else bad("主窗错误条缺少 role=alert 或 aria-live=assertive");
  if (okInput) ok("主窗输入框有可读名称（aria-label）");
  else bad("主窗输入框只有 placeholder，没有 aria-label");
}

// ---------- 5d. 每个表单控件都要有可读名称 ----------
// 设置页大量控件旁边是 <div class="label">，读屏读不到；placeholder 也不是名字。
// 全部用 aria-label（或 aria-labelledby）钉住，新增控件忘了写就红。
{
  const srcDir = path.join(APP, "src");
  const bare = [];
  let total = 0;
  for (const h of fs.readdirSync(srcDir).filter((f) => f.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(srcDir, h), "utf8");
    for (const m of html.matchAll(/<(input|select|textarea)\b[^>]*>/g)) {
      total += 1;
      if (!/aria-label="/.test(m[0]) && !/aria-labelledby="/.test(m[0])) {
        const id = (m[0].match(/id="([^"]+)"/) || [])[1] || "(无 id)";
        bare.push(h + " → " + id);
      }
    }
  }
  if (bare.length === 0) ok("表单控件都有可读名称（" + total + " 个）");
  else bad("表单控件缺少 aria-label：" + bare.slice(0, 4).join("，"));
}

// ---------- 6. 主进程的兜底网（崩溃 / 子进程 / 监听泄漏） ----------
// 桌宠是常驻程序：崩了没人看见、监听泄漏只会让内存慢慢涨。
// 这几条都是「打包版没控制台就等于没有」的东西，必须在这儿钉住。
{
  const main = fs.readFileSync(path.join(SRC, "main.js"), "utf8");
  const need = [
    ["未捕获异常写进 crash 目录", /process\.on\("uncaughtException"/],
    ["未处理 Promise 拒绝写进 crash 目录", /process\.on\("unhandledRejection"/],
    ["子进程崩溃（GPU/utility）有记录", /app\.on\("child-process-gone"/],
    ["Node 警告（监听泄漏前兆）写进日志", /process\.on\("warning"/],
    ["原生崩溃落本地 minidump", /crashReporter\.start/],
    ["单实例锁（防重复开两份）", /requestSingleInstanceLock/],
    ["渲染进程崩溃有处理", /render-process-gone/],
  ];
  for (const [name, re] of need) {
    if (re.test(main)) ok(name);
    else bad(name + "（main.js 里找不到）");
  }
  // child-process-gone 里 killed 是我们自己退出时杀子进程，不能当崩溃刷屏
  if (/reason\s*!==\s*"killed"/.test(main)) ok("子进程退出忽略自己杀的（killed）");
  else bad("child-process-gone 没排除 killed，退出时会刷一堆假崩溃");
}

// ---------- 7. 模型包：覆盖层判定与 404 的可诊断性 ----------
// 2026-11-14 主人报的两个现象，都得在这儿钉住，否则以后一改就回退：
//   ① 「模型文件不存在（只剩配置）」红色 34 分 —— 用户点过「保存并应用」之后，
//      本机覆盖层里只有 pet.json，模型本体还在安装目录；只查 dir 不查 base 就必然误判。
//   ② 「没有这个接口」—— 光回一句话没法排查，404 必须带上 url / method，并写进 run.log。
{
  const store = fs.readFileSync(path.join(SRC, "packs", "store.js"), "utf8");
  if (/hasModel\(hit\.dir\)\s*\|\|\s*hasModel\(hit\.base\)/.test(store)) {
    ok("覆盖层判定同时看用户目录与内置目录");
  } else {
    bad("store.js 的 missingModel 只查了一处目录，覆盖层会被误判成「模型文件不存在」");
  }
  if (/const hasModel = \(d\) =>/.test(store)) ok("hasModel 抽成了单点判断（两处共用）");
  else bad("store.js 没有 hasModel 单点判断，容易只改一处");

  const http = fs.readFileSync(path.join(SRC, "packs", "http.js"), "utf8");
  if (/function notFound\(res, url, method, ctx\)/.test(http)) ok("404 统一走 notFound()");
  else bad("packs/http.js 没有了 notFound()，404 又会退回一句没法排查的话");
  if (/url,\s*\n\s*method,/.test(http) || /method,\s*\n\s*hint:/.test(http)) ok("404 回包带 url / method / hint");
  else bad("404 回包没带 url / method / hint");
  if (/logErr\("\[packs\] 没有这个接口："\s*\+\s*key/.test(http)) ok("没接住的接口写进 run.log（含方法+路径）");
  else bad("没接住的接口没写日志，用户反馈时无从定位");
  if (/reportedMiss\.has\(key\)/.test(http)) ok("同一个 miss 只记一次日志（不会被轮询刷满）");
  else bad("404 日志没有去重，界面轮询会把 run.log 刷满");

  const adapter = fs.readFileSync(path.join(SRC, "adapter.js"), "utf8");
  if (/j\.hint\s*&&\s*\/没有这个接口\//.test(adapter)) ok("适配器把 hint 一起显示给用户");
  else bad("适配器没把 404 的 hint 带给用户，界面还是只有一句「没有这个接口」");
}

// ---------- 8. 长跑/真机探针自己的可靠性 ----------
// 探针出问题会被当成产品出问题（2026-11-14 撞过两次）：
//   ① soak 复用一条 CDP 长连接采样，对端大约一分钟后不再回应 → 第 61 秒起全是
//      「Runtime.evaluate 超时」，整轮采样空白，判定直接 FAIL；
//   ② verify:ui 的主进程 eval 只给 60 秒，刚构建完磁盘忙时 quick-pet-esc 跑不完
//      → 只跑到 10 条就退出，隔几秒重跑又 55 条全过。
// 这两条都会制造「假红灯」，必须钉住。
{
  const SCRIPTS = path.resolve(__dirname);
  const cdp = fs.readFileSync(path.join(SCRIPTS, "lib", "cdp.js"), "utf8");
  const soak = fs.readFileSync(path.join(SCRIPTS, "soak.js"), "utf8");
  if (/async function evalOnce\(wsUrl/.test(cdp)) ok("长跑采样用一次性连接（不复用长连接）");
  else bad("lib/cdp.js 没有一次性连接的 evalOnce，长连接一分钟被掐后会采不到数据");
  if (/await sampleFrom\(MAIN_PORT/.test(soak) && /await sampleFrom\(PORT/.test(soak)) {
    ok("主进程与页面采样都走 sampleFrom()");
  } else {
    bad("soak.js 采样没有走 sampleFrom()，又退回复用长连接了");
  }
  if (/evalOn\(mainC,|evalOn\(pageC,/.test(soak)) bad("soak.js 还在复用长连接求值，会再次出现整轮空白");
  else ok("没有复用长连接求值的旧写法");
  if (/isClosed:\s*\(\)\s*=>\s*closed/.test(cdp)) ok("连接关闭状态可查询（断了能重连）");
  else bad("connect() 没暴露 isClosed，断了之后会继续读死连接");
  if (/async function reconnectPageEvents\(/.test(cdp) && /reconnectPageEvents\(PORT\)/.test(soak)) {
    ok("页面 console 事件连接断了会重连");
  } else {
    bad("页面事件连接断了不重连，后面几十轮其实没在听 console");
  }
  if (/WARMUP_MS/.test(soak) && /const warm = samples\.filter\(\(s\) => s\.t >= WARMUP_MS/.test(soak)) {
    ok("判定只用预热之后的样本（启动爬升不算泄漏）");
  } else {
    bad("soak.js 没隔离预热期，启动加载模型的爬升会被算成泄漏");
  }
  for (const c of ["MAX_RSS_PER_HOUR_MB", "MAX_RSS_TOTAL_MB", "MAX_HANDLE_DELTA", "MAX_RENDER_HEAP_MB"]) {
    if (new RegExp("const " + c + "\\s*=").test(soak)) ok("红线常量在：" + c);
    else bad("soak.js 缺红线常量 " + c);
  }

  const smoke = fs.readFileSync(path.join(SCRIPTS, "smoke-electron.js"), "utf8");
  const mainEvalTimeout = /includeCommandLineAPI: true,\s*\n\s*\},\s*(\d+)\)/.exec(smoke);
  if (mainEvalTimeout && Number(mainEvalTimeout[1]) >= 150000) ok("主进程 eval 超时 ≥150 秒（磁盘忙时不假失败）");
  else bad("主进程 eval 超时又改回 " + (mainEvalTimeout ? mainEvalTimeout[1] : "未知") + "，构建后跑 verify:ui 会假失败");

  const ui = fs.readFileSync(path.join(SCRIPTS, "test-ui.js"), "utf8");
  if (/主进程 eval 失败/.test(ui)) ok("探针超时时把原因带进断言 detail");
  else bad("test-ui.js 又把探针失败原因吞掉了，失败只剩一个 null");
}

// ---------- 9. 自测永不上屏（FISH_TEST_HIDDEN） ----------
// 2026-11-14 主人投诉的原话：「跑UI测试 老是挡住我看东西」「你告诉我我怎么用电脑？」
// 自测窗口一个个弹到桌面，把他正在用的东西顶掉。三条踩过的坑都要钉住：
//   ① 改 BrowserWindow.prototype.show / 赋值 electron.BrowserWindow 都没用
//      （后者是只读 getter，赋值被静默忽略，还会骗过自检）；
//   ② show:false / hide() 会让页面变 hidden，Chromium 把 rAF 压到 1fps，
//      量出来的 fps 是 1，性能断言全成假的；
//   ③ 光在 BW 里设 opacity 不够：主窗创建后还会 win.setOpacity(s.opacity) 再改回来。
// 正确做法 = 窗口照常显示（all layers 正常跑帧），但 alpha=0 + 点击穿透 + 不进任务栏。
{
  const SCRIPTS = path.resolve(__dirname);
  const mainSrc = fs.readFileSync(path.join(SCRIPTS, "..", "src", "main.js"), "utf8");

  if (/const TEST_HIDDEN = process\.env\.FISH_TEST_HIDDEN === "1";/.test(mainSrc)) {
    ok("自测隐藏开关 TEST_HIDDEN 从环境变量读");
  } else {
    bad("main.js 没有 TEST_HIDDEN 开关，自测又会弹到桌面上");
  }
  for (const sw of ["disable-renderer-backgrounding", "disable-background-timer-throttling", "disable-backgrounding-occluded-windows"]) {
    if (new RegExp('appendSwitch\\("' + sw + '"\\)').test(mainSrc)) ok("关掉后台节流的开关在：" + sw);
    else bad("缺 appendSwitch(\"" + sw + "\")，透明窗口下 rAF 可能被压低");
  }
  if (/function BW\(opts\) \{\s*\n\s*const w = new BrowserWindow\(opts\);/.test(mainSrc)) {
    ok("所有窗口走同一个 BW() 工厂");
  } else {
    bad("找不到 BW() 窗口工厂");
  }
  if (/if \(!TEST_HIDDEN\) return w;/.test(mainSrc)) ok("BW() 在正式运行时原样返回（不改变用户看到的窗口）");
  else bad("BW() 没按 TEST_HIDDEN 分支，正式运行也可能被透明化");
  const rawNew = (mainSrc.match(/new BrowserWindow\(/g) || []).length;
  if (rawNew === 1) ok("只有 BW() 内部一处 new BrowserWindow（没有漏网的窗口）");
  else bad("还有 " + (rawNew - 1) + " 处窗口没走 BW()，它们会直接上屏");
  const bwCalls = (mainSrc.match(/(?<![A-Za-z_.])BW\(\{/g) || []).length;
  if (bwCalls >= 10) ok("窗口工厂调用点 " + bwCalls + " 处");
  else bad("只找到 " + bwCalls + " 处 BW( 调用，应该 ≥10");
  for (const [re, label] of [
    [/w\.setOpacity\(0\)/, "隐藏靠 alpha=0（不是 hide()，hide 会掉到 1fps）"],
    [/w\.setIgnoreMouseEvents\(true, \{ forward: true \}\)/, "隐藏窗口点击穿透（看不见也点不到）"],
    [/w\.setSkipTaskbar\(true\)/, "隐藏窗口不进任务栏"],
  ]) {
    if (re.test(mainSrc)) ok(label);
    else bad("BW() 缺少：" + label);
  }
  if (/if \(\s*!\s*TEST_HIDDEN\s*\)/.test(mainSrc) && !/function BW\(opts\) \{[\s\S]{0,600}?w\.hide\(\)/.test(mainSrc)) {
    ok("BW() 没有用 hide()（用 hide 会让渲染掉到 1fps）");
  } else {
    bad("BW() 里出现 hide()，性能数据会失真");
  }
  const occl = (mainSrc.match(/win\.setOpacity\(TEST_HIDDEN \? 0 : s\.opacity\)/g) || []).length;
  if (occl >= 2) ok("主窗创建与设置补丁都用 TEST_HIDDEN 覆盖 opacity（" + occl + " 处）");
  else bad("主窗的 setOpacity(s.opacity) 没被 TEST_HIDDEN 接管，窗口还是会被改回不透明（找到 " + occl + " 处）");
  if (/win\.setVisibleOnAllWorkspaces\(true, \{ visibleOnFullScreen: false \}\)/.test(mainSrc)) {
    ok("setVisibleOnAllWorkspaces 还在（改 opacity 时别把它冲掉）");
  } else {
    bad("主窗的 setVisibleOnAllWorkspaces 丢了");
  }

  for (const f of ["smoke-electron.js", "soak.js", "churn.js", "diag-adapter.js"]) {
    let src = "";
    try { src = fs.readFileSync(path.join(SCRIPTS, f), "utf8"); } catch (e) { }
    if (!src) { bad("找不到脚本 " + f); continue; }
    if (/FISH_TEST_HIDDEN["']?\s*[:=]\s*["']1["']/.test(src)) ok(f + " 启动子进程时打开了隐藏");
    else bad(f + " 没设 FISH_TEST_HIDDEN=1，跑起来会抢屏");
  }

  let probe = "";
  try { probe = fs.readFileSync(path.join(SCRIPTS, "probe-hidden.js"), "utf8"); } catch (e) { }
  if (!probe) {
    bad("缺 scripts/probe-hidden.js，没法验证「真的看不见」");
  } else {
    if (/GetLayeredWindowAttributes/.test(probe)) ok("探针读 Win32 分层窗口 alpha（不是猜的）");
    else bad("probe-hidden.js 没读真实 alpha");
    if (/alpha !== "0"/.test(probe)) ok("探针把「不透明」判成失败");
    else bad("probe-hidden.js 没有判 alpha≠0 的失败分支");
  }
}

// ---------- 10. 源码注释不许留编码事故的残骸 ----------
//
// 来历：这个仓库被一次批量文本处理伤过，汉字被替换成 U+2026（…）、标点被替换成 ?，
// 于是留下「// 状…?」「// 扢…有可变状态集中在这里」这种读不懂的残句。
// 2026-11-14 一次修掉 210 行（renderer 178 + settings 32）。这一节防止再出现：
// 两条判据都只打注释，不碰字符串和代码，所以不会有误报。
{
  const scanFiles = [];
  const walkSrc = (dir, depth) => {
    if (depth > 3) return;
    let list = [];
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const ent of list) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) { if (ent.name !== "node_modules" && ent.name !== "vendor") walkSrc(p, depth + 1); }
      else if (/\.(js|html|css)$/.test(ent.name)) scanFiles.push(p);
    }
  };
  walkSrc(path.join(APP, "src"), 0);

  // ① 「…?」这个组合在中文里不成立，出现就是坏了
  const broken = [];
  // ② 损坏时还会吐出这些生僻字（「所」→扢、「屏」→扢、「看」→睢、「开」→弢…）
  const WEIRD = "扢睢弢仢朢靃霢訢濢锢徢";
  const weird = [];
  for (const f of scanFiles) {
    const t = fs.readFileSync(f, "utf8");
    const rel = path.relative(APP, f).replace(/\\/g, "/");
    t.split(/\r?\n/).forEach((s, i) => {
      const k = s.indexOf("//");
      if (k < 0 || s.slice(0, k).trim() !== "") return;   // 只看纯注释行
      if (/\u2026\?/.test(s)) broken.push(`${rel}:${i + 1}`);
      if ([...WEIRD].some((ch) => s.includes(ch))) weird.push(`${rel}:${i + 1}`);
    });
  }
  if (broken.length === 0) ok(`源码注释没有「…?」残骸（扫了 ${scanFiles.length} 个文件）`);
  else bad(`源码注释仍有「…?」残骸 ${broken.length} 行`, broken.slice(0, 5).join(" "));
  if (weird.length === 0) ok("源码注释没有损坏时混进来的生僻字");
  else bad(`源码注释里有编码事故留下的生僻字 ${weird.length} 行`, weird.slice(0, 5).join(" "));

  if (scanFiles.length >= 20) ok("注释扫描覆盖到了 src 下的全部脚本与页面");
  else bad(`注释扫描只找到 ${scanFiles.length} 个文件，可能路径变了`);
}

// ---------- 11. 启动性能基线 ----------
//
// 商业软件得能回答「双击之后多久能看到画面」。这里守三件事：
//   ① scripts/perf.js 存在，四段预算都在，且走 cdp 库的 sampleFrom（不许拿长连接采样）
//   ② 主进程把启动各段耗时落成 boot-timing.txt —— 用户报「启动慢」时才有据可查
//   ③ perf 的判定能失败（exit 1），不然它只是打印数字的脚本
{
  const perfPath = path.join(APP, "scripts", "perf.js");
  let perf = "";
  try { perf = fs.readFileSync(perfPath, "utf8"); } catch (e) { perf = ""; }
  if (perf) ok("启动性能脚本存在");
  else bad("scripts/perf.js 不见了");

  for (const k of ["toTargetMs", "toDomMs", "toModelMs", "pageHeapMb", "longFrames"]) {
    if (new RegExp("\\b" + k + "\\s*:").test(perf)) ok(`性能预算包含 ${k}`);
    else bad(`性能预算缺少 ${k}`);
  }
  if (/require\("\.\/lib\/cdp"\)/.test(perf)) ok("perf 复用 scripts/lib/cdp.js");
  else bad("perf 没有复用 cdp 库（采样会各自实现，容易退回长连接）");
  if (/sampleFrom\(PORT/.test(perf)) ok("perf 每拍现连采样（不拿长连接）");
  else bad("perf 采样没走 sampleFrom");
  if (/perf-history\.json/.test(perf)) ok("perf 把每轮数字追加进历史");
  else bad("perf 没有历史记录，比不了「这次比上次慢多少」");
  if (/process\.exit\(sum\.ok \? 0 : 1\)/.test(perf)) ok("perf 判定失败时退出码非 0");
  else bad("perf 不会失败，等于只打印数字");

  // 主进程侧的启动计时
  if (/const BOOT_T0 = Date\.now\(\);/.test(mainSrc)) ok("主进程记了启动起点");
  else bad("main.js 没有 BOOT_T0");
  for (const m of ['bootMark("ready")', 'bootMark("server")', 'bootMark("window")']) {
    if (mainSrc.includes(m)) ok(`启动里程碑 ${m}`);
    else bad(`启动里程碑缺失 ${m}`);
  }
  if (/boot-timing\.txt/.test(mainSrc)) ok("启动耗时落成 boot-timing.txt");
  else bad("main.js 没有写 boot-timing.txt");
  if (/writeBootTiming\(\)/.test(mainSrc)) ok("首帧加载完就写一份启动耗时");
  else bad("writeBootTiming() 没有被调用");
  if (pkg.scripts && pkg.scripts.perf) ok("package.json 有 perf 入口");
  else bad("package.json 没有 perf 脚本");
}

// ---------- 12. 第一次打开的人有事可做 ----------
// 空状态卡是每个新用户看到的第一屏，之前一条自动化都没有（真机验收现在在
// scripts/probe-empty.js，这里钉静态契约：东西在不在、文案里的关键字有没有丢）。
// 少一条的下场很具体：用户不知道 Cubism 2 不支持，就会反复导一个永远导不进来的模型。
{
  const SCRIPTS = path.resolve(__dirname);
  const html = fs.readFileSync(path.join(APP, "src", "index.html"), "utf8");
  const rsrc = fs.readFileSync(path.join(APP, "src", "renderer.js"), "utf8");

  if (/<details[^>]+id="nmHelp"/.test(html)) ok("空状态卡有「什么样的文件才认」折叠块");
  else bad("index.html 没有 #nmHelp 折叠块");
  if (/\.model3\.json/.test(html) && /Cubism 2/.test(html)) ok("折叠块写明要 .model3.json、且 Cubism 2 不支持");
  else bad("折叠块没写清文件形态（缺 .model3.json 或 Cubism 2 的说明）");
  if (/\.nm-help summary\s*\{/.test(html)) ok("折叠块有 summary 样式（否则会显示成裸列表）");
  else bad("index.html 缺 .nm-help summary 样式");
  if (/\.nm-help\[open\] summary::before/.test(html)) ok("折叠块展开/收起有箭头状态");
  else bad("折叠块没有展开状态指示（[open] summary::before）");
  // 失败提示要换行：nmTip 是 div，没有 pre-line 的话十几行会挤成一坨
  if (/\.nm-tip\s*\{[^}]*white-space:\s*pre-line/.test(html)) ok("提示区支持换行（white-space: pre-line）");
  else bad(".nm-tip 缺 white-space: pre-line，多行提示会挤成一行");

  if (/SELF_CHECK/.test(rsrc) && /card 住了对一下这三条|卡住了对一下这三条/.test(rsrc)) ok("导入失败时给三条自查");
  else bad("renderer.js 没有导入失败的自查提示（SELF_CHECK）");
  const selfChecks = (rsrc.match(/SELF_CHECK/g) || []).length;
  if (selfChecks >= 3) ok(`两条失败分支都带上了自查（SELF_CHECK 共 ${selfChecks} 处）`);
  else bad(`SELF_CHECK 只在 ${selfChecks} 处出现，应该 ≥3（定义 + 两个 catch/失败分支）`);

  // 启动失败：只给「重试」是死路，必须有「换一个模型」
  if (/mk\("换一个模型"/.test(rsrc)) ok("模型加载失败时有「换一个模型」出口");
  else bad("模型加载失败只有重试按钮，坏模型用户只能卸载");
  if (/openAdapter\(PACK && PACK\.id/.test(rsrc)) ok("「换一个模型」直接进模型适配器");
  else bad("「换一个模型」没有接 openAdapter");
  if (/模型文件找到了，但没能加载起来/.test(rsrc)) ok("加载失败先说清「文件在、加载不了」，不是甩一行技术错误");
  else bad("加载失败文案没解释「文件在 vs 加载不了」的区别");
  if (/模型没能启动"/.test(rsrc)) bad("还留着旧文案「模型没能启动」，没解释原因");
  else ok("旧的一句式失败文案已替换");

  if (fs.existsSync(path.join(SCRIPTS, "probe-empty.js"))) ok("有空状态的真机验收脚本 probe-empty.js");
  else bad("缺 scripts/probe-empty.js");
  const pe = fs.existsSync(path.join(SCRIPTS, "probe-empty.js"))
    ? fs.readFileSync(path.join(SCRIPTS, "probe-empty.js"), "utf8") : "";
  if (/scrollH\s*<=\s*.*winH/.test(pe)) ok("探针会检查展开说明后有没有被顶出窗口");
  else bad("探针没检查内容溢出（356×512 的窗口很容易顶出去）");
  if (/dist", "win-unpacked"/.test(pe)) ok("探针跑的是打包版（源码版带内置模型，走不到空状态）");
  else bad("探针没指定打包版，测不到真正的空状态");
  if (pkg.scripts && pkg.scripts["probe:empty"]) ok("package.json 有 probe:empty 入口");
  else bad("package.json 没有 probe:empty 脚本");
}

// ---------- 13. 诊断包要能自己说明白 ----------
// 用户报「她不见了」「启动好慢」时，唯一能拿到的证据就是这个包。
// boot-timing.txt 是本轮新写的文件、显示器信息是这轮才加进包的 —— 少一样，
// 客服就只能靠猜；而这些静态看着都在，只有真跑一次才知道写没写进去。
{
  const mainSrc = fs.readFileSync(path.join(SRC, "main.js"), "utf8");
  const preSrc = fs.readFileSync(path.join(SRC, "preload.js"), "utf8");
  const diagProbe = path.join(__dirname, "test-diag.js");
  const hasProbe = fs.existsSync(diagProbe);
  const probeSrc = hasProbe ? fs.readFileSync(diagProbe, "utf8") : "";
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const t13 = (n, c, d) => { if (c) ok(n, d); else bad(n); };

  t13("诊断包里有显示器.txt（换屏/跑到屏幕外全靠它）", /put\("显示器\.txt"/.test(mainSrc));
  t13("显示器.txt 记了每块屏的尺寸与缩放比例", /scaleFactor/.test(mainSrc) && /缩放 /.test(mainSrc));
  t13("显示器.txt 记了她现在在哪块屏", /她现在在哪: /.test(mainSrc));
  t13("诊断包带上了 boot-timing.txt 与 last-boot.txt",
    /\["boot-timing\.txt", "last-boot\.txt"\]/.test(mainSrc));
  t13("诊断包仍带运行日志与脱敏设置",
    /put\("运行日志\.log"/.test(mainSrc) && /sanitizeSettings/.test(mainSrc));
  t13("exportDiag 支持直接给目录（测试不弹对话框）",
    /async function exportDiag\(dirOverride\)/.test(mainSrc) && /if \(forced\)/.test(mainSrc));
  t13("不弹框通道只在隔离实例里注册",
    /!app\.isPackaged \|\| process\.env\.FISH_MULTI === "1"/.test(mainSrc) &&
    /ipcMain\.handle\("diag:exportTo"/.test(mainSrc));
  t13("preload 里的 diagExportTo 也只在隔离实例里有",
    /diagExportTo: process\.env\.FISH_MULTI === "1"/.test(preSrc));
  t13("有诊断包的真机验收脚本 test-diag.js", hasProbe);
  t13("探针把包写进临时目录并逐项检查",
    /diagExportTo\(/.test(probeSrc) && /mkdtempSync|makeTmp/.test(probeSrc));
  t13("探针检查 boot-timing 三段都在",
    /ready=\\d\+ms/.test(probeSrc) && /window=\\d\+ms/.test(probeSrc));
  t13("探针检查设置.json 没泄漏密钥", /apiKey/.test(probeSrc));
  t13("package.json 有 test:diag 入口", !!(pkg.scripts && pkg.scripts["test:diag"]));
}

// ---------- 14. 安装路径不能只验纯 ASCII ----------
// 真实用户十有八九把软件装进中文目录，而安装回归原来只装到 os.tmpdir() 的
// 纯 ASCII 临时目录 —— 等于没验。这一轮补了中文路径段，顺带查清「静默安装的
// /D= 在第一个空格处截断」这个静默失败。这里把形状钉住，别让人顺手删掉。
{
  const inst = fs.readFileSync(path.join(__dirname, "test-install.js"), "utf8");
  const proj = fs.readFileSync(path.join(__dirname, "..", "..", "PROJECT.md"), "utf8");
  const t14 = (n, c, d) => { if (c) ok(n, d); else bad(n); };

  t14("安装回归里有中文路径段", /大肥鱼安装回归-/.test(inst));
  t14("中文路径段验的是「主程序落在目标路径」", /装进中文目录后主程序在目标路径/.test(inst));
  t14("中文路径段盯住父目录有没有被塞东西", /中文路径安装没有往父目录里塞东西/.test(inst));
  t14("中文路径段验卸载后不留文件", /中文路径卸载后没有留下文件/.test(inst));
  t14("安装器调用统一走 runInstaller", /const runInstaller = async \(installer, dir, timeoutMs\) =>/.test(inst));
  t14("传参用 windowsVerbatimArguments（/D= 不能带引号）",
    /windowsVerbatimArguments: true/.test(inst));
  t14("中文路径段可以跳过（SKIP_CJK）", /process\.env\.SKIP_CJK !== "1"/.test(inst));
  t14("PROJECT.md 记下了 /D= 空格截断这个坑", /\/D=/.test(proj) && /空格/.test(proj));
}

// ---------- 15. 升级不能丢用户的设置 ----------
// 用户装新版本时最怕设置被重置、聊天记录消失。test-upgrade.js 真跑一遍：
// 装 → 起 → 改设置 → 覆盖装 → 再起 → 逐项核对。这里守住它的形状，
// 以及「卸载不碰真实 %APPDATA%」这条只能靠前后快照比对的断言。
{
  const upPath = path.join(__dirname, "test-upgrade.js");
  const hasUp = fs.existsSync(upPath);
  const up = hasUp ? fs.readFileSync(upPath, "utf8") : "";
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const t15 = (n, c, d) => { if (c) ok(n, d); else bad(n); };

  t15("有升级回归脚本 test-upgrade.js", hasUp);
  t15("跑的是真安装包（覆盖安装，不是只改文件）", /runInstaller\(installer, dir/.test(up) && /覆盖安装/.test(up));
  t15("验证设置项真的保留（音量 / 分辨率 / 静音 / 首次引导）",
    /升级后音量还是用户设的/.test(up) && /升级后分辨率还是用户设的/.test(up) &&
    /升级后静音状态还在/.test(up) && /首次引导已完成/.test(up));
  t15("验证聊天记录与面板位置也保留", /升级前的聊天记录还在/.test(up) && /升级后面板位置还在/.test(up));
  t15("用前后快照比对真实 %APPDATA%（安装/卸载不能碰它）",
    /function snapshot\(dir\)/.test(up) && /front 一致|前后一致/.test(up));
  t15("卸载后注册表与快捷方式都轮询确认（NSIS 卸载是异步的）",
    /const uninstGone = await waitFor/.test(up) && /const scGone = await waitFor/.test(up));
  t15("测试夹具不往 models 里放 model3（会被当成包去加载）",
    !/mypack\.model3\.json/.test(up));
  t15("package.json 有 test:upgrade 入口", !!(pkg.scripts && pkg.scripts["test:upgrade"]));
}

// ---------- 16. 导入要么整份进来，要么一点都不留 ----------
// 用户拖进来一个两三百兆的整合包，拷到八成时磁盘满了 —— 以前会在 models 里留半个包，
// 下一次扫描照样把它列成一个模型（名字乱、参数全默认），再导一次又多一个 -2。
// 现在先拷进 .importing-* 临时目录，成功才改名顶上；失败清干净、错误原样抛给界面。
// 另一条：目录太深 / 文件数到顶时以前是静默 return，包能装上但少贴图，界面只表现为发黑。
{
  const storeSrc = fs.readFileSync(path.join(SRC, "packs", "store.js"), "utf8");
  const mainSrc = fs.readFileSync(path.join(SRC, "main.js"), "utf8");
  const rendSrc = fs.readFileSync(path.join(SRC, "renderer.js"), "utf8");
  const packTest = fs.readFileSync(path.join(__dirname, "test-packs.js"), "utf8");
  const t16 = (n, c, d) => { if (c) ok(n, d); else bad(n); };

  t16("导入先拷到 .importing-* 临时目录", /\.importing-/.test(storeSrc));
  t16("导入失败会删掉临时目录（不留半个包）", /rmSync\(tmp, \{ recursive: true, force: true \}\)/.test(storeSrc));
  t16("导入成功才改名顶上", /renameSync\(tmp/.test(storeSrc));
  t16("目录太深不再是静默 return", /why: "目录层数超过 "/.test(storeSrc));
  t16("文件数到顶不再是静默 return", /why: "文件数超过 "/.test(storeSrc));
  t16("超限会标 truncated", /stat\.truncated = true/.test(storeSrc));
  t16("importDir 把 truncated 交给调用方", /truncated: !!stat\.truncated/.test(storeSrc));
  t16("model:import 把 truncated 透给界面", /truncated: !!out\.truncated/.test(mainSrc) &&
    /skippedReason/.test(mainSrc));
  t16("界面上明说了「有文件没复制进来」", /if \(r\.truncated\)/.test(rendSrc) &&
    /没复制进来/.test(rendSrc));
  t16("截断时不再直接 reload（否则提示被刷掉）",
    /if \(r\.truncated\)[\s\S]{0,400}?return;/.test(rendSrc) &&
    !/if \(r\.truncated\)[\s\S]{0,80}?location\.reload/.test(rendSrc));
  t16("test-packs 覆盖了中途失败与超限两条",
    /导入中途失败后，models 里没有留下半个包/.test(packTest) &&
    /目录太深时返回值标了 truncated/.test(packTest));
}

// ---------- 17. 导入时界面要知道它在动 ----------
// 导入一个几百兆的整合包要几十秒。以前整段是同步 copyFileSync：主进程被堵死，
// 窗口拖不动、托盘点不动，Windows 超时还会盖一层「未响应」；界面上只有一句
// 「正在导入…」，用户分不清在动还是死了。现在复制走 fs.promises + 节流报进度。
{
  const storeSrc = fs.readFileSync(path.join(SRC, "packs", "store.js"), "utf8");
  const mainSrc = fs.readFileSync(path.join(SRC, "main.js"), "utf8");
  const preSrc = fs.readFileSync(path.join(SRC, "preload.js"), "utf8");
  const rendSrc = fs.readFileSync(path.join(SRC, "renderer.js"), "utf8");
  const packTest = fs.readFileSync(path.join(__dirname, "test-packs.js"), "utf8");
  const t17 = (n, c, d) => { if (c) ok(n, d); else bad(n); };

  t17("importDir 是 async（主进程不被拷贝堵死）", /async importDir\(srcDir, opts\)/.test(storeSrc));
  t17("_copyTree 也是 async，递归有 await", /async _copyTree\(/.test(storeSrc) &&
    /await this\._copyTree\(from, to, stat, depth \+ 1, opts\)/.test(storeSrc));
  t17("复制用 fs.promises 而不是同步 API", /await fs\.promises\.copyFile\(/.test(storeSrc) &&
    !/fs\.copyFileSync\(/.test(storeSrc));
  t17("进度按 16 个文件 / 200ms 节流", /stat\.files % 16 !== 0/.test(storeSrc) &&
    /200/.test(storeSrc));
  t17("结尾补发一次 done 进度（免得停在 99%）", /done: true/.test(storeSrc));
  t17("model:import 把进度转给窗口，并且 await 了导入",
    /webContents\.send\("model:import-progress"/.test(mainSrc) &&
    /await ADAPTER\.importDir\(src, opts\)/.test(mainSrc) &&
    /await ADAPTER\.importArchive\(src, opts\)/.test(mainSrc));
  t17("preload 暴露了订阅且能退订", /onModelImportProgress: \(fn\) =>/.test(preSrc) &&
    /removeListener\("model:import-progress"/.test(preSrc));
  t17("界面在 finally 里退订（三条 return 都不漏）",
    /if \(unsub\) \{ try \{ unsub\(\); \} catch \(e\) \{ \} unsub = null; \}/.test(rendSrc) &&
    /finally \{/.test(rendSrc));
  t17("界面上写的是「正在复制：N 个文件（X MB）」而不是干等一句「正在导入」",
    /正在复制：/.test(rendSrc) && /个文件/.test(rendSrc));
  t17("test-packs 覆盖了进度、done 与「不给回调也能用」",
    /导入过程会报进度/.test(packTest) && /最后一次进度标了 done/.test(packTest) &&
    /不给 onProgress 也能正常导入/.test(packTest));
  // 真机探针：导入期间主进程还得应答 —— 这个静态看代码看不出来。
  const impProbe = path.join(__dirname, "probe-import.js");
  const impSrc = fs.existsSync(impProbe) ? fs.readFileSync(impProbe, "utf8") : "";
  t17("有真机探针：导入期间并发打 /api/packs 量往返",
    /\/api\/packs\/import/.test(impSrc) && /const pings = \[\]/.test(impSrc));
  t17("探针的窗口按导入起止算，不是拿 importMs 硬比",
    /impStart/.test(impSrc) && /p\.at >= \(r\.impStart \|\| 0\)/.test(impSrc));
  t17("package.json 有 probe:import 入口", !!(pkg && pkg.scripts && pkg.scripts["probe:import"]));
}

// ---------- 18. 配置层的规则回归 ----------
// 设置里有六十多个键、十来条夹取与类型校验，它们决定「手改配置会不会把人搞没」
// 「换版本设置会不会被重置」。这些规则是纯函数，值得无头测一遍；
// 下面同时钉住三个已经踩过的坑，别被顺手改回去。
{
  const schemaTest = path.join(__dirname, "test-settings-schema.js");
  const hasTest = fs.existsSync(schemaTest);
  const tt = hasTest ? fs.readFileSync(schemaTest, "utf8") : "";
  const setSrc = fs.readFileSync(path.join(SRC, "settings.js"), "utf8");
  const pkg2 = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));

  if (hasTest) ok("有配置层规则回归 test-settings-schema.js");
  else bad("没有 test-settings-schema.js，配置校验只能靠人眼");
  if (/require\("\.\.\/src\/settings"\)/.test(tt)) ok("它直接测 sanitize/migrate，不启动 Electron");
  else bad("规则回归没直接 require src/settings");
  if (/幂等/.test(tt) && /sanitize\(DEFAULTS\)/.test(tt)) ok("测了幂等：默认值洗两遍不变");
  else bad("没测幂等，sanitize 可能越洗越偏");
  if (/未知键被丢掉/.test(tt)) ok("测了未知键被丢弃（配置文件是能手改的）");
  else bad("没测未知键");
  if (/activePack 带 \.\.\//.test(tt)) ok("测了模型包 id 的路径穿越");
  else bad("没测 activePack 穿越");
  // 只要 sanitize / migrate 被导出来就行；导出表以后会长（比如 SECRET_KEYS），
  // 用字面量全等会把这些无害的增长判成失败。
  if (/module\.exports = \{[^}]*\bsanitize\b[^}]*\bmigrate\b[^}]*\}/.test(setSrc)) ok("settings 导出了 sanitize/migrate");
  else bad("settings 没导出 sanitize/migrate，测试没法直接喂边界值");
  if (/if \(key === "viewBox"\) continue;/.test(setSrc)) ok("通用循环会跳过 viewBox（否则夹取被覆盖）");
  else bad("通用循环没跳过 viewBox，手改 h:9 就能让取景框缩成一点");
  if (/viewBox: \{ \.\.\.DEFAULTS\.viewBox \}/.test(setSrc)) ok("viewBox 深拷贝，不污染 DEFAULTS");
  else bad("viewBox 与 DEFAULTS 共用对象，改一处会污染全局默认值");
  if (/if \(val === null \|\| val === undefined\) \{ out\[key\] = null; continue; \}/.test(setSrc)) ok("x/y 的 null 不再被转成 0");
  else bad("x/y 把 null 转成了 0，等于记成「在左上角」");
  if (pkg2.scripts && /test-settings-schema/.test(String(pkg2.scripts.test || ""))) ok("规则回归挂在 npm test 链上");
  else bad("test-settings-schema 没挂进 npm test，写了也没人跑");
}

// ---------- 19. 设置要活得比进程久 ----------
// 原来 test-persist 只验「音量 + 缩放」两项，而设置里有六十多个键、
// 每个键都要经过 patch → save → load → sanitize 四道关。任何一道漏了，
// 用户的表现都是「我明明调过，怎么又变回去了」。
{
  const pers = fs.readFileSync(path.join(__dirname, "test-persist.js"), "utf8");
  const pkg3 = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const fields = (pers.match(/^  [a-zA-Z]+:/gm) || []).length;
  if (fields >= 10) ok("持久化回归覆盖 " + fields + " 个设置项（不是只验音量缩放）");
  else bad("持久化回归只覆盖 " + fields + " 个字段，太薄");
  if (/settings\.json 已落盘且是合法 JSON/.test(pers)) ok("它检查了写盘本身，而不只是内存里的值");
  else bad("没查 settings.json 是否真落盘");
  if (/项设置全部原样活过重启/.test(pers)) ok("有一条汇总断言直接回答「全活了吗」");
  else bad("缺汇总断言，逐项都绿也可能整体有漏");
  if (/超采样回到 2/.test(pers) && /取景矩形回到默认/.test(pers)) ok("恢复默认也验了多项，不只看音量");
  else bad("恢复默认只验了音量/缩放");
  if (/test-persist/.test(String(pkg3.scripts.verify || ""))) ok("持久化回归挂在 npm run verify 上");
  else bad("test-persist 没挂进 verify 链，写了也没人跑");
  if (pkg3.scripts && pkg3.scripts["test:persist"]) ok("也能单独跑：npm run test:persist");
  else bad("没有 test:persist 脚本入口");
}

// ---------- 20. 二次启动要有回应 ----------
// 用户双击第二次时最容易出现「没反应」：锁生效了但界面没动静，或者窗口在屏幕外
// isVisible() 仍为 true、focus() 拉不回来。这几条钉住「必须有回应、并且能被诊断」。
{
  const mainSrc = fs.readFileSync(path.join(SRC, "main.js"), "utf8");
  const singlePath = path.join(__dirname, "test-single.js");
  const hasSingle = fs.existsSync(singlePath);
  const single = hasSingle ? fs.readFileSync(singlePath, "utf8") : "";
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const sec = (mainSrc.split('app.on("second-instance"')[1] || "").slice(0, 1600);
  // 唤醒动作已抽成共用函数：窗口重建 / 夹回 / 置前都写在 resurfaceMainWindow 里。
  const rf = (mainSrc.split("function resurfaceMainWindow(why)")[1] || "").slice(0, 1200);
  const tg = (mainSrc.split("function toggleMainWindow()")[1] || "").slice(0, 600);
  // 反例断言只看代码行：注释里会提到被禁掉的写法（比如这段改动自己的说明）。
  const mainCode = mainSrc.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const t20 = (n, c, d) => { if (c) ok(n, d); else bad(n); };

  t20("有二次启动的真机验收脚本", hasSingle);
  t20("探针会真的再起一个进程去抢锁", /const B = start\(userData, baseEnv, false\);/.test(single));
  t20("探针验了第二个实例的退出码", /bExit\.code === 0/.test(single));
  t20("探针验了第一个实例没被顶掉", single.includes("A 没被第二个实例顶掉"));
  t20("探针验了页面数没变（没多开窗口）", single.includes("没有在 A 之外再开窗口"));
  t20("探针验了日志里留下了请求记录", single.includes("收到第二个实例请求"));
  t20("second-instance 里打了日志（「双击没反应」唯一的证据）",
    /log\("\[main\] 收到第二个实例的启动请求/.test(sec));
  t20("主窗口不在时会重建，不是静默 return", /if \(!win \|\| win\.isDestroyed\(\)\) \{[\s\S]{0,400}?createWindow\(\);/.test(rf));
  t20("先把窗口夹回可视区（不等 300ms 防抖）", /reflowToVisibleScreen\(\);/.test(rf));
  t20("把窗口提到最上层", /win\.moveTop\(\)/.test(rf));
  t20("二次启动调的是共用函数，不是自己再写一遍", /resurfaceMainWindow\("二次启动"\)/.test(sec));
  t20("托盘「显示 / 隐藏」也调共用函数", /resurfaceMainWindow\(/.test(tg));
  t20("托盘点下去留了日志（隐藏/叫回各一条）", tg.includes("主窗口收起来") && tg.includes("主窗口叫回来"));
  t20("托盘不许再自己写 isVisible() ? hide() : show()",
    !/win\.isVisible\(\) \? win\.hide\(\) : win\.show\(\)/.test(mainCode));
  t20("package.json 有 test:single 入口", !!(pkg.scripts && pkg.scripts["test:single"]));
}

// ---------- 21. 托盘菜单 ----------
// 托盘是「主窗关掉 / 最小化」之后唯一的入口，而这 16 项以前一条断言都没有。
// 原生菜单自动化点不到，所以把模板抽成纯函数逐项验（scripts/test-tray.js）。
{
  const traySrc = path.join(SRC, "tray-menu.js");
  const hasTrayMod = fs.existsSync(traySrc);
  const trayMod = hasTrayMod ? fs.readFileSync(traySrc, "utf8") : "";
  const trayTest = path.join(__dirname, "test-tray.js");
  const hasTrayTest = fs.existsSync(trayTest);
  const pkg20 = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const t21 = (n, c, d) => { if (c) ok(n, d); else bad(n); };

  t21("托盘菜单抽成了独立模块", hasTrayMod);
  t21("模块导出 buildTrayMenu", /module\.exports = \{ buildTrayMenu \}/.test(trayMod));
  t21("模板里没有一处 win / tray / app 直接调用（纯函数）",
    !/\bwin\.|\btray\.|\bapp\./.test(trayMod));
  t21("「显示 / 隐藏」调 toggleWindow，不是自己 hide/show",
    /label: "显示 \/ 隐藏", click: \(\) => c\.toggleWindow\(\)/.test(trayMod));
  t21("静音项是 checkbox 且状态来自设置", /type: "checkbox"/.test(trayMod) && /checked: !!s\.mute/.test(trayMod));
  t21("食物子菜单下标对齐（feed + idx）", /quickPet\("feed", \{ idx: i \}\)/.test(trayMod));
  t21("main.js 用模板而不是内联数组", /return buildTrayMenu\(\{/.test(mainSrc));
  t21("main.js 把真实动作都喂进去了",
    /toggleWindow: toggleMainWindow/.test(mainSrc) && /quit: \(\) => app\.quit\(\)/.test(mainSrc));
  t21("有托盘离线测试", hasTrayTest);
  t21("托盘测试挂在 npm test 上", !!(pkg20.scripts && /test-tray\.js/.test(pkg20.scripts.test || "")));
}


// ---------- 22. 设置项：改了就生效，而且每个键都得有人读 ----------
// 两件事：① 「改完要不要重启」以前没人验过 —— 真机探针连改两轮设置再看运行态；
// ② anchorMode 那种「存得下去但没人读」的键，要有个常驻红线拦住。
{
  const auditP = path.join(__dirname, "audit-settings.js");
  const probeP = path.join(__dirname, "probe-settings.js");
  const hasAudit = fs.existsSync(auditP);
  const auditSrc = hasAudit ? fs.readFileSync(auditP, "utf8") : "";
  const hasProbe = fs.existsSync(probeP);
  const probeSrc = hasProbe ? fs.readFileSync(probeP, "utf8") : "";
  const pkg22 = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const t22 = (n, c, d) => { if (c) ok(n, d); else bad(n); };

  t22("有「每个设置键都得有人读」的审计脚本", hasAudit);
  t22("审计会递归扫子目录（packs/ 里的消费方也算）",
    /readdirSync\(dir, \{ withFileTypes: true \}\)/.test(auditSrc) && /walk\(p, out\)/.test(auditSrc));
  t22("审计登记了 anchorMode 这个只写不读的键，并写明原因",
    /anchorMode:\s*"[^"]*free[^"]*"/.test(auditSrc));
  t22("审计在有死键时以非零码退出", /process\.exit\(fail \? 1 : 0\)/.test(auditSrc));
  t22("审计会报「白名单里的键已经有消费方了」", /stale/.test(auditSrc));
  t22("审计挂在 npm run verify 上", !!(pkg22.scripts && /audit-settings\.js/.test(pkg22.scripts.verify || "")));
  t22("有真机探针：改完设置当场读运行态", hasProbe && /settingsPatch\(/.test(probeSrc));
  t22("探针至少改了帧率 / 清晰度 / 锐化 / 缩放四类",
    /fpsCap: 20/.test(probeSrc) && /resolution: 1/.test(probeSrc) && /sharpen: false/.test(probeSrc) && /scale: 1\.2/.test(probeSrc));
  // 空闲 8 秒后 tick 会把 fps 压到 min(15, fpsCap)：期望值必须按 calm 算，硬写 20 会误报
  t22("探针的帧率期望值按 calm 空闲降档算，而不是硬写", /calm \? Math\.min\(15, 20\) : 20/.test(probeSrc));
  t22("探针会检查全程没有整页重载（改设置不该闪一下）", /__probeMark/.test(probeSrc) && /markAlive/.test(probeSrc));
  t22("两条入口都进了 package.json",
    !!(pkg22.scripts && pkg22.scripts["audit:settings"] && pkg22.scripts["probe:settings"]));
}

// ---------- 23. 高 DPI 屏上的窗口与画布 ----------
// 所有截图与实测都在 100% 缩放下做的，而用户里有大量 4K@150% / 笔记本@250%。
// 这条线要守的是「窗口不会在高 DPI 下变成两倍大」，以及「画布像素够不够」。
{
  const dpiP = path.join(__dirname, "probe-dpi.js");
  const hasDpi = fs.existsSync(dpiP);
  const dpiSrc = hasDpi ? fs.readFileSync(dpiP, "utf8") : "";
  const pkg23 = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const t23 = (n, c, d) => { if (c) ok(n, d); else bad(n); };

  t23("有高 DPI 真机探针", hasDpi);
  t23("用 --force-device-scale-factor 逐档启动", /--force-device-scale-factor=/.test(dpiSrc) && /for \(let i = 0; i < FACTORS\.length/.test(dpiSrc));
  t23("读回 devicePixelRatio 做核对", /dpr: window\.devicePixelRatio/.test(dpiSrc));
  t23("断言窗口 DIP 尺寸不随缩放变（不会变两倍大）",
    /窗口 DIP 宽度不随缩放变/.test(dpiSrc) && /Math\.abs\(r\.innerW - BASE_W\)/.test(dpiSrc));
  t23("断言 canvas 物理像素 = DIP × 渲染分辨率（autoDensity 已含缩放）",
    /autoDensity 已含缩放/.test(dpiSrc) && /r\.innerW \* \(Number\(r\.res\) \|\| 1\)/.test(dpiSrc));
  t23("超过 200% 时按「极致才追得上」分档，而不是判缺陷",
    /超过 200% 的屏需要「极致」才追得上/.test(dpiSrc));
  t23("支持 --res 验「极致（3x）」够不够", /settingsPatch\(\{ resolution: \$\{RES\} \}\)/.test(dpiSrc));
  t23("一行窗口尺寸基准写死在脚本里，别处改了尺寸要一起改", /const BASE_W = 460;/.test(dpiSrc));
  t23("探针入口进了 package.json", !!(pkg23.scripts && pkg23.scripts["probe:dpi"]));
}

// ---------- 24. 动作曲线只有一份实现 ----------
// 这条段守的不是「功能对不对」，而是「没有第二份实现」。
// curve（点击回弹）和 lerpAt（动作播放）本来是同一套 Catmull-Rom，各写一份、
// 只差零跨度兜底 —— 改一处漏一处是迟早的事，收进 lib/curve.js 之后由单元测试钉住。
{
  const libDir = path.join(APP, "src", "lib");
  const curveFile = path.join(libDir, "curve.js");
  const libCode = fs.existsSync(curveFile) ? fs.readFileSync(curveFile, "utf8") : "";
  const rnd = fs.readFileSync(path.join(APP, "src", "renderer.js"), "utf8");
  const idx = fs.readFileSync(path.join(APP, "src", "index.html"), "utf8");

  if (libCode) ok("lib/curve.js 存在");
  else bad("lib/curve.js 不存在");

  if (/return \{ curve, clampNum \}/.test(libCode)) ok("lib 导出 curve 与 clampNum");
  else bad("lib 没导出 curve/clampNum");

  if (/module\.exports = factory\(\)/.test(libCode) && /root\.__fishCurve = factory\(\)/.test(libCode))
    ok("lib 是 UMD：浏览器挂 __fishCurve、Node 里能直接 require");
  else bad("lib 不是 UMD 形态");

  if (/Math\.max\(1e-6, p2\[0\] - p1\[0\]\)/.test(libCode)) ok("零跨度用 Math.max(1e-6, span) 兜底");
  else bad("零跨度兜底不见了");

  if (/window\.__fishCurve/.test(rnd)) ok("renderer 从 __fishCurve 取实现");
  else bad("renderer 没引用 __fishCurve");

  // 反例：不许再留一份自己的 Catmull-Rom（函数签名 + 基函数同时出现才算）
  const ownCurve = /const curve = \(t, pts\) =>/.test(rnd) && /2 \* p0\[1\] - 5 \* p1\[1\]/.test(rnd);
  if (!ownCurve) ok("renderer 里没有第二份 Catmull-Rom 实现");
  else bad("renderer 里又出现了一份自己的曲线实现");

  const ownLerp = /const lerpAt = \(pts, t\) =>/.test(rnd);
  if (!ownLerp) ok("lerpAt 不再有自己的函数体");
  else bad("lerpAt 又有自己的实现了");

  if (/const lerpAt = curve;/.test(rnd)) ok("lerpAt 是 curve 的别名");
  else bad("lerpAt 没有指向 curve");

  const clampDecls = (rnd.match(/const clampNum = /g) || []).length;
  if (clampDecls === 1) ok("clampNum 只有一处声明（引用或兜底，不是两份实现）", String(clampDecls));
  else bad("clampNum 声明数不对：" + clampDecls);

  // index.html 的加载顺序：lib 必须在 renderer 之前，否则 __fishCurve 还是 undefined
  const iLib = idx.indexOf('src="lib/curve.js"');
  const iRnd = idx.indexOf('src="renderer.js"');
  if (iLib > 0 && iRnd > iLib) ok("index.html 先加载 lib/curve.js 再加载 renderer.js");
  else bad("lib/curve.js 没在 renderer.js 之前加载");

  if (pkg.scripts["test:curve"]) ok("有 npm run test:curve");
  else bad("没有 test:curve 入口");

  const SCRIPTS = path.resolve(__dirname);
  const tc = path.join(SCRIPTS, "test-curve.js");
  if (fs.existsSync(tc)) ok("scripts/test-curve.js 存在");
  else bad("scripts/test-curve.js 不存在");

  // 单测必须拿旧实现做对照，否则「收走两份」这件事没有任何证据
  const tcCode = fs.existsSync(tc) ? fs.readFileSync(tc, "utf8") : "";
  if (/与旧的 lerpAt 在/.test(tcCode)) ok("单测拿旧实现做等价对照");
  else bad("单测没有和旧实现对照");
}
// ---------- 25. 模型适配器的端到端链路 ----------
// 适配器这条线以前只有两层：PackStore 的单元（test-packs）与路由的假适配器（test-packs-http）。
// 「导入 → 体检 → 保存 → 切过去 → 删掉在用的那个」这一整串，没有任何一条能证明它真的通。
{
  const SCRIPTS25 = path.resolve(__dirname);
  const probe = path.join(SCRIPTS25, "probe-adapter.js");
  const has = fs.existsSync(probe);
  const src = has ? fs.readFileSync(probe, "utf8") : "";
  const t25 = (n, c, d) => { if (c) ok(n, d); else bad(n); };

  t25("有适配器端到端探针", has);
  t25("探针走的是真实的 /api/packs 接口", /\/api\/packs/.test(src) && /\/api\/packs\/import/.test(src));
  t25("探针用真模型目录做导入源（不是假数据）", /mianfeimodelYUAN/.test(src));
  t25("探针跑的是隔离的 userData", /mkdtempSync|makeTmp/.test(src) && /--user-data-dir=/.test(src));
  t25("探针自己会清理（--keep 才留）", /KEEP/.test(src) && /rmSync\(ud/.test(src));
  t25("切模型之后会等渲染端真的把模型拉起来", /切过去之后桌宠真的起来了/.test(src));
  t25("会验「删掉正在用的包」不留空白", /删包之后画面有明确归属/.test(src));
  t25("会验保存时未知键被白名单挡掉", /不认识的键不会被写进配置/.test(src));
  t25("探针不要在 devtools 里拼相对 URL（origin 可能是 null）", /location\.origin \+/.test(src) && !/new URL\(\$\{JSON\.stringify\(p\)\}, location\.href\)/.test(src));
  t25("有 probe:adapter 入口", !!(pkg.scripts && pkg.scripts["probe:adapter"] === "node scripts/probe-adapter.js"));
}

// ---------- 26. 界面控件不能是死的 ----------
// 设置窗 76 个、其它窗口 34 个可交互元素，全靠逐个 $("id").addEventListener 绑。
// 「加了个开关忘了接」静态看不出来、单测抓不到、真机冒烟只觉得「界面能开」。
{
  const SCRIPTS26 = path.resolve(__dirname);
  const auditPath = path.join(SCRIPTS26, "audit-ui-bindings.js");
  const testPath = path.join(SCRIPTS26, "test-ui-bindings.js");
  const hasAudit = fs.existsSync(auditPath);
  const auditSrc = hasAudit ? fs.readFileSync(auditPath, "utf8") : "";
  const testSrc = fs.existsSync(testPath) ? fs.readFileSync(testPath, "utf8") : "";
  const t26 = (n, c, d) => { if (c) ok(n, d); else bad(n); };

  t26("有界面控件接线审计脚本", hasAudit);
  t26("审计支持 --src（能在假目录上自测）", /--src/.test(auditSrc));
  t26("审计认得「键值形式收集控件」的写法", /re4\s*=/.test(auditSrc) && /对象字面量里用短名收集/.test(auditSrc));
  t26("审计会扫内联 <script>", /inline/.test(auditSrc));
  t26("审计有自测（否则判据松紧没人知道）", fs.existsSync(testPath));
  t26("自测会造一间假 src", /mkdtempSync/.test(testSrc) && /page\.html/.test(testSrc));
  t26("自测敢断言「只在注释里提到也是死键」", /只在注释里提到的是死键/.test(testSrc));
  t26("自测对真实 src 要求 0 个死键", /真实 src 里没有被落下的控件/.test(testSrc));
  t26("有 audit:ui 入口", !!(pkg.scripts && pkg.scripts["audit:ui"] === "node scripts/audit-ui-bindings.js"));
  t26("自测挂在 npm test 上", String(pkg.scripts && pkg.scripts.test || "").indexOf("test-ui-bindings") >= 0);

  // 本轮真修的那个：参考音频目录框以前只能靠「选文件夹」写入，手打不生效
  const srPath = path.join(APP, "src", "settings-renderer.js");
  const srSrc = fs.existsSync(srPath) ? fs.readFileSync(srPath, "utf8") : "";
  const seg = (() => {
    const a = srSrc.indexOf("if (els.feiyuRefDir)");
    if (a < 0) return "";
    const b = srSrc.indexOf("if (els.feiyuRefPick)", a);
    return srSrc.slice(a, b > a ? b : a + 900);
  })();
  t26("参考音频目录能手打（有 change 提交）", /addEventListener\("change"/.test(seg));
  t26("参考音频目录按回车也能提交", /addEventListener\("keydown"/.test(seg) && /Enter/.test(seg));

  const pinPath = path.join(SCRIPTS26, "probe-settings-input.js");
  const pinSrc = fs.existsSync(pinPath) ? fs.readFileSync(pinPath, "utf8") : "";
  t26("有「手打设置项」的真机探针", !!pinSrc);
  t26("探针读的是真实落盘的 settings.json", /settings\.json/.test(pinSrc) && /user-data-dir=/.test(pinSrc));
  t26("探针会派发 change 事件（模拟人打完切走）", /new Event\("change"/.test(pinSrc));
  t26("探针验了非法值会被同一套校验清掉", /被同一套校验清掉/.test(pinSrc));
  t26("有 probe:settings-input 入口", !!(pkg.scripts && pkg.scripts["probe:settings-input"] === "node scripts/probe-settings-input.js"));
}

// ---------- 27. 设置开关：存进去之后，行为跟不跟 ----------
// round 22：audit:ui 只证明控件绑了事件，test:persist 只证明值存得住，
// 中间那段「拨了之后真的生效吗」一直是空白。这一段的断言守的是那套三层取证。
{
  const SCRIPTS27 = path.resolve(__dirname);
  const probeT = fs.readFileSync(path.join(SCRIPTS27, "probe-toggles.js"), "utf8");
  const mainT = fs.readFileSync(path.join(APP, "src", "main.js"), "utf8");
  const rendT = fs.readFileSync(path.join(APP, "src", "renderer.js"), "utf8");
  const preT = fs.readFileSync(path.join(APP, "src", "preload.js"), "utf8");
  const setT = fs.readFileSync(path.join(APP, "src", "settings-renderer.js"), "utf8");
  const t27 = (n, c, d) => { if (c) ok(n, d); else bad(n); };

  t27("有开关生效探针 probe-toggles.js", probeT.indexOf("testWinState") >= 0 && probeT.indexOf("openSettings") >= 0);
  t27("探针按三层取证（渲染侧 / 主窗口 / 存盘）",
    probeT.indexOf("READ_DEBUG") >= 0 && probeT.indexOf("READ_WIN") >= 0 && probeT.indexOf("readSettingsFile") >= 0);
  t27("探针覆盖至少 6 个开关", (probeT.match(/key: "/g) || []).length >= 6);
  t27("探针会核对「拨回来也回得去」", probeT.indexOf("拨回来也回得去") >= 0);
  t27("探针有连点两下的断言", probeT.indexOf("连点两下") >= 0);
  t27("调试口带开关状态（follow/autoIdle/blink/sharpen/fpsCap）",
    rendT.indexOf("follow: followCursor") >= 0 &&
    rendT.indexOf("autoIdle: autoIdle") >= 0 &&
    rendT.indexOf("blink: blinkEnabled") >= 0 &&
    rendT.indexOf("sharpen: sharpenOn") >= 0 &&
    rendT.indexOf("fpsCap: fpsCap") >= 0);
  t27("主进程有自测专用 winState 通道",
    mainT.indexOf('ipcMain.handle("__test:winState"') >= 0 && mainT.indexOf("win.isAlwaysOnTop()") >= 0);
  t27("winState 通道只在自测实例注册", (function () {
    const i = mainT.indexOf('ipcMain.handle("__test:winState"');
    const gate = mainT.indexOf('if (!app.isPackaged || process.env.FISH_MULTI === "1")');
    if (i < 0 || gate < 0) return false;
    // 判「在自测块起始之后」而不是「附近 600 字符内有 FISH_MULTI」：
    // 自测块里每加一个通道，后面的都会离起点越来越远，按距离判会一批一批地假红。
    return i > gate;
  })());
  t27("applySettings 记住 ignoreMouse（Electron 没有 getter）", mainT.indexOf("win.__ignoreMouse = !!s.clickThrough;") >= 0);
  t27("preload 在自测实例里暴露 testWinState", preT.indexOf("testWinState: process.env.FISH_MULTI") >= 0);
  t27("开关是乐观更新（连点不吞第二次）", setT.indexOf("const next = !cur[key];") >= 0 && setT.indexOf("cur[key] = next;") >= 0);
  t27("写盘失败会把界面纠正回来", (function () {
    // 注意看的是「重新拉设置并重画」那一句：toast 本身在 try 里还有一处同文案的，
    // 拿 indexOf 取第一处会抓到它，断言就永远绿（也永远证明不了什么）。
    const j = setT.indexOf("paint(await api.settingsGet())");
    if (j < 0) return false;
    return setT.slice(Math.max(0, j - 600), j).indexOf("catch (e)") >= 0;
  })());
  t27("有 probe:toggles 入口", !!pkg.scripts["probe:toggles"]);
}

// ---------- 28. 快捷键：注册上了 ≠ 按下去会发生 ----------
{
  const SCRIPTS28 = path.resolve(__dirname);
  const main28 = fs.readFileSync(path.join(APP, "src", "main.js"), "utf8");
  const pre28 = fs.readFileSync(path.join(APP, "src", "preload.js"), "utf8");
  const set28 = fs.readFileSync(path.join(APP, "src", "settings-renderer.js"), "utf8");
  const probe28 = path.join(SCRIPTS28, "probe-hotkeys.js");
  const hasProbe28 = fs.existsSync(probe28);
  const pr28 = hasProbe28 ? fs.readFileSync(probe28, "utf8") : "";
  const t28 = (n, c, d) => { if (c) ok(n, d); else bad(n); };

  t28("有快捷键真机探针", hasProbe28);
  t28("探针走自测专用的唤出通道", /__test:summon|testSummon\(/.test(pr28));
  t28("探针验了「唤出之后仍然不置顶」", /唤出之后仍然不置顶/.test(pr28));
  t28("探针验了撞车文案", /撞车时文案说是「同一个键」/.test(pr28));

  // summonDock 里不许再无条件下置顶
  const summon28 = main28.slice(main28.indexOf("function summonDock()"), main28.indexOf("function summonDock()") + 2200);
  t28("summonDock 里按用户的「总在最前」决定置顶", /S\.get\(\)\.alwaysOnTop/.test(summon28));
  t28("summonDock 不再无条件 setAlwaysOnTop(true)", !/win\.setAlwaysOnTop\(true, "screen-saver"\);\s*\r?\n\s*win\.setFocusable/.test(summon28));

  t28("主进程记下被跳过的键", /let skippedAccels = \[\];/.test(main28));
  t28("每轮注册前清空 skipped", /boundAccels = \[\];\s*\r?\n\s*skippedAccels = \[\];/.test(main28));
  t28("撞车的键会进 skipped", /skippedAccels\.push\(\{ accel: micKey/.test(main28));
  t28("hotkey:status 返回 skipped", /skipped: skippedAccels\.slice\(\),/.test(main28));

  t28("__test:summon 只在自测块里注册", main28.indexOf('ipcMain.handle("__test:summon"') > main28.indexOf('if (!app.isPackaged || process.env.FISH_MULTI === "1")'));
  t28("preload 的 testSummon 也只在自测实例里", /testSummon: process\.env\.FISH_MULTI === "1"/.test(pre28));

  t28("界面区分「自己撞车」与「被别的软件占用」", /dupMap/.test(set28) && /先看是不是自己撞的/.test(set28));
  t28("撞车的键不能因为 bound 里有就当成已生效", /if \(dupMap\.has\(key\)\) \{ dup\.push/.test(set28));
  t28("有 probe:hotkeys 入口", !!(pkg.scripts && pkg.scripts["probe:hotkeys"]));
}

// ---------- 第 29 段：麦克风失败要说人话 ----------
{
  const SCRIPTS29 = path.resolve(__dirname);
  const t29 = (n, c, d) => { if (c) ok(n, d); else bad(n); };

  const miclib = path.join(APP, "src", "lib", "micerr.js");
  const libSrc = fs.existsSync(miclib) ? fs.readFileSync(miclib, "utf8") : "";
  t29("有 lib/micerr.js", libSrc.length > 500);
  t29("micerr 是 UMD（浏览器挂全局 + Node 可 require）",
    /root\.__fishMicErr\s*=\s*api/.test(libSrc) && /module\.exports\s*=\s*api/.test(libSrc));
  for (const code of ["denied", "nodevice", "busy", "unsupported", "insecure", "aborted", "lost"]) {
    t29("分类里有 " + code, libSrc.indexOf('code: "' + code + '"') >= 0);
  }
  t29("认不出来的也有兜底一句", /code:\s*"other"/.test(libSrc) && /detail:/.test(libSrc));
  t29("每类都带 short（她说的）和 detail（能照着做的）",
    (libSrc.match(/short:/g) || []).length >= 8 && (libSrc.match(/detail:/g) || []).length >= 8);

  const voice = fs.readFileSync(path.join(APP, "src", "voice.js"), "utf8");
  t29("voice.js 记住上一次失败原因", /let lastMicError = null;/.test(voice));
  t29("失败时按钮回到关，并对她说一句",
    /lastMicError = micErrText\(e\);/.test(voice) && /setBtn\("off"\);/.test(voice) && /FishSay\(lastMicError\.short/.test(voice));
  t29("失败信息对外可读（micError / clearMicError）",
    /micError: \(\) => lastMicError/.test(voice) && /clearMicError:/.test(voice));
  t29("开麦成功会清掉上次的错误", /lastMicError = null;[\s\S]{0,220}watchMicTrack\(\);/.test(voice));
  t29("盯着轨道断开（ended / mute）",
    /addEventListener\("ended", lost\)/.test(voice) && /addEventListener\("mute", lost\)/.test(voice));
  t29("断开后自动关麦并说话", /lastMicError = micErrText\(\{ name: "Lost"/.test(voice) && /noti\("setVoice", false\)/.test(voice));
  // 反例：以前的写法是 catch 里只有一行 log 就 return false，界面毫无反应
  t29("不许退回「只记日志、界面无反应」", !/catch \(e\) \{\s*log\("拿不到麦克风: " \+ \(e && e\.message \? e\.message : e\)\);\s*enabling = false;\s*return false;/.test(voice));

  const idx = fs.readFileSync(path.join(APP, "src", "index.html"), "utf8");
  const iMic = idx.indexOf('src="lib/micerr.js"');
  const iVoice = idx.indexOf('src="voice.js"');
  t29("index.html 在 voice.js 之前加载 micerr", iMic > 0 && iVoice > iMic);

  const setHtml = fs.readFileSync(path.join(APP, "src", "settings.html"), "utf8");
  t29("设置页有麦克风提示行", /id="micHint"/.test(setHtml));
  t29("设置页也加载 micerr", /src="lib\/micerr\.js"/.test(setHtml));

  const setJs = fs.readFileSync(path.join(APP, "src", "settings-renderer.js"), "utf8");
  t29("设置页权限失败不再空 catch", /function showMicHint\(text, warn\)/.test(setJs) && /showMicHint\(micErrDetail\(e\), true\)/.test(setJs));
  t29("一个设备都没有时也解释一句", /没检测到任何麦克风/.test(setJs));
  t29("留了自测入口 settingsMic", /window\.settingsMic = \{/.test(setJs) && /refresh: \(s\) => fillMicDevices/.test(setJs));

  const probe = path.join(SCRIPTS29, "probe-mic.js");
  const prSrc = fs.existsSync(probe) ? fs.readFileSync(probe, "utf8") : "";
  t29("有 probe-mic.js", prSrc.length > 2000);
  t29("探针用假麦克风（不抢用户真设备）", /--use-fake-device-for-media-stream/.test(prSrc));
  t29("探针覆盖四类失败并验归类",
    /NotAllowedError/.test(prSrc) && /NotFoundError/.test(prSrc) && /NotReadableError/.test(prSrc) && /OverconstrainedError/.test(prSrc));
  t29("探针验了「失败时她会说一句」", /失败时没说一句话/.test(prSrc));
  t29("探针验了掉线自动关麦", /__dropMic/.test(prSrc) && /掉线后自动关掉麦克风|掉线后按钮还亮着/.test(prSrc));
  t29("探针验了设置页提示行", /settingsMic\.refresh\(\)/.test(prSrc) && /允许桌面应用访问麦克风/.test(prSrc));
  t29("npm 里有 probe:mic 入口", !!pkg.scripts["probe:mic"]);
}


  // ---------- 第 30 段：说话失败要有人话 ----------
  {
    const SCRIPTS30 = path.resolve(__dirname);
    const voice30 = fs.readFileSync(path.join(APP, "src", "voice.js"), "utf8");
    const vlib30 = path.join(APP, "src", "lib", "voiceerr.js");
    const vlibSrc = fs.existsSync(vlib30) ? fs.readFileSync(vlib30, "utf8") : "";
    const idx30 = fs.readFileSync(path.join(APP, "src", "index.html"), "utf8");
    const pkg30 = JSON.parse(fs.readFileSync(path.join(APP, "package.json"), "utf8"));
    const t30 = (n, c, d) => { if (c) ok(n, d); else bad(n); };

    t30("语音错误分类表存在", vlibSrc.length > 0);
    t30("分类表是 UMD（浏览器与 Node 都能用）",
      /root\.__fishVoiceErr = api/.test(vlibSrc) && /module\.exports = api/.test(vlibSrc));
    t30("七类都在（bridge/rvc/missing/engine/noaudio/timeout/offline）",
      ["bridge", "rvc", "missing", "engine", "noaudio", "timeout", "offline"].every((c) => vlibSrc.indexOf('code: "' + c + '"') >= 0));
    t30("有兜底 other，不会出现空文案", /const OTHER = \{/.test(vlibSrc) && /code: "other"/.test(vlibSrc));
    t30("每类都有 short 与 detail（说人话 + 说下一步）",
      (vlibSrc.match(/short: "/g) || []).length >= 8 && (vlibSrc.match(/detail:/g) || []).length >= 8);

    t30("voice.js 存了「整链失败」的原因", /let lastSpeakError = null;/.test(voice30));
    t30("speak() 每处失败都记一处原因（note）",
      (voice30.match(/note\(e\);/g) || []).length >= 4);
    t30("只记第一处失败，回落的不覆盖它", /if \(!lastSpeakError\) lastSpeakError = voiceErrText\(e\)/.test(voice30));
    t30("整条链都没出声时会说一句人话", /function notifySpeakFailed\(\)/.test(voice30) && /FishSay\(err\.short/.test(voice30));
    t30("收到回复的入口会检查 speak 的返回值", /const ok = await speak\(clean\);\s*\n\s*if \(ok === false\) notifySpeakFailed\(\);/.test(voice30));
    t30("只有出声的入口也检查", /__finishReply: \(text\) => finishReply\(text\)/.test(voice30));
    t30("静音时不念叨（用户自己关的声音）", /function notifySpeakFailed\(\) \{\s*\n\s*if \(muted\) return;/.test(voice30));
    t30("对外能读到最后一次说话失败",
      /speakError: \(\) => lastSpeakError/.test(voice30) && /clearSpeakError:/.test(voice30));
    t30("反例：不许退回「只 catch 不查返回值」",
      !/try \{\s*\n\s*await speak\(clean\);\s*\n\s*\} catch/.test(voice30));

    t30("index.html 在 voice.js 之前加载分类表",
      idx30.indexOf("lib/voiceerr.js") >= 0 && idx30.indexOf("lib/voiceerr.js") < idx30.indexOf("voice.js"));

    t30("有分类表的单元测试", fs.existsSync(path.join(SCRIPTS30, "test-voiceerr.js")));
    const tv30 = fs.existsSync(path.join(SCRIPTS30, "test-voiceerr.js"))
      ? fs.readFileSync(path.join(SCRIPTS30, "test-voiceerr.js"), "utf8") : "";
    t30("单测覆盖「最具体的先匹配」（RVC 不被误判成引擎）", /不被误判成 engine/.test(tv30));
    t30("单测覆盖「任何输入都有兜底」", /任何输入都返回完整的 code\/short\/detail/.test(tv30));

    t30("有真机探针", fs.existsSync(path.join(SCRIPTS30, "probe-voice-out.js")));
    const pv30 = fs.existsSync(path.join(SCRIPTS30, "probe-voice-out.js"))
      ? fs.readFileSync(path.join(SCRIPTS30, "probe-voice-out.js"), "utf8") : "";
    t30("探针拦的是真实语音端点（不是打桩内部函数）", pv30.indexOf("engine") >= 0 && pv30.indexOf("api") >= 0);
    t30("探针走真实的「收到回复」入口", /__finishReply/.test(pv30));
    t30("探针验了「失败时不沉默」", /而不是沉默/.test(pv30));
    t30("探针验了「静音时不弹失败提示」", /静音时不弹失败提示/.test(pv30));

    t30("npm 有 test:voiceerr 入口", !!(pkg30.scripts && pkg30.scripts["test:voiceerr"]));
    t30("npm 有 probe:voice-out 入口", !!(pkg30.scripts && pkg30.scripts["probe:voice-out"]));
    t30("单测挂在 npm test 上", (pkg30.scripts.test || "").indexOf("test-voiceerr") >= 0);
  }

// ---------- 31. 等她回复：半截 / 一个字都没有，用户能不能知道 ----------
{
  const SCRIPTS31 = path.resolve(__dirname);
  const t31 = (n, c, d) => { if (c) ok(n, d); else bad(n); };
  const v31 = fs.readFileSync(path.join(APP, "src", "voice.js"), "utf8");
  const p31 = path.join(SCRIPTS31, "probe-reply-stall.js");
  const pv31 = fs.existsSync(p31) ? fs.readFileSync(p31, "utf8") : "";

  t31("有 probe-reply-stall.js", !!pv31);
  t31("探针走真实的 __waitReply", pv31.indexOf("FishVoice.__waitReply") >= 0);
  t31("探针拦了 /api/health（getToken 靠它拿 t）", pv31.indexOf('/api/health') >= 0);
  t31("探针cover 半截 / 完全没回 / 基线读不到三种情况", pv31.indexOf('"partial"') >= 0 && pv31.indexOf('"stalled"') >= 0 && pv31.indexOf('五分钟前的旧话') >= 0);

  t31("waitReply 有「这一轮出没出问题」的记录位", /let lastReplyIssue = null;/.test(v31));
  t31("snapshotCount 记录基线读没读到", /snapOk = true;/.test(v31) && /snapOk = false;/.test(v31));
  t31("拿不到基线时只认最近一分钟（不许把旧的当新回复）", /const since = snapOk \? sinceRaw : Math\.max\(0, Date\.now\(\) - 60000\);/.test(v31));
  t31("半截有专门的标记", /code: "partial", waited: waitedSec, chars: full\.length/.test(v31));
  t31("半截会补一句「没说完」", v31.indexOf('好像没说完') >= 0);
  t31("完全没回复会说话，且说明等多久", /code: "stalled", waited: waitedSec/.test(v31) && v31.indexOf('还没回我……（等了 ') >= 0);
  t31("**反例**：不许再要求 FishLines 才肯说话", v31.indexOf('window.FishSay && window.FishLines') < 0);
  t31("超时可以注入（自测不用真等 90 秒）", v31.indexOf('__fishReplyTimeoutMs') >= 0);
  t31("对外能看到 replyIssue", /replyIssue: \(\) => lastReplyIssue/.test(v31));
  t31("对外能走一遍 __waitReply", /__waitReply: \(text\) => waitReply/.test(v31));
  t31("有 probe:reply 入口", !!(pkg.scripts && pkg.scripts["probe:reply"]));
}

// ---------- 第 32 段：对话记录的文件格式层 ----------
{
  const SCRIPTS32 = path.resolve(__dirname);
  const t32 = (n, c, d) => { if (c) ok(n, d); else bad(n); };
  const libFile = path.join(APP, "src", "lib", "chatfile.js");
  const libSrc = fs.existsSync(libFile) ? fs.readFileSync(libFile, "utf8") : "";
  const main32 = fs.readFileSync(path.join(APP, "src", "main.js"), "utf8");
  const test32 = fs.readFileSync(path.join(SCRIPTS32, "test-chatfile.js"), "utf8");
  const probe32 = fs.readFileSync(path.join(SCRIPTS32, "probe-chat.js"), "utf8");

  t32("对话记录的文件格式层存在", !!libSrc);
  t32("它是 UMD（浏览器与 Node 都能用）", libSrc.indexOf("module.exports = api") >= 0 && libSrc.indexOf("__fishChatFile") >= 0);
  t32("解析会如实报出丢了几条、裁了几条",
    /dropped:\s*dropped/.test(libSrc) && /cut:\s*cut/.test(libSrc));
  t32("读不懂分三种：空 / 不是 JSON / 结构不对",
    libSrc.indexOf('error: "empty"') >= 0 && libSrc.indexOf('error: "json"') >= 0 && libSrc.indexOf('error: "shape"') >= 0);
  t32("序列化带 version", /version:\s*VERSION/.test(libSrc));
  t32("坏文件名把冒号点号换掉（Windows 不允许）", /\.replace\(\/\[\.:]\/g,.-"\)/.test(libSrc) || libSrc.indexOf("/[:.]/g") >= 0);

  t32("main.js 用的是这个层，不是自己 JSON.parse",
    main32.indexOf('require("./lib/chatfile")') >= 0 && main32.indexOf("CHATFILE.parseChat(raw)") >= 0);
  t32("上限也从这一层来（不许两处各写一个 3000）",
    /const CHAT_MAX = CHATFILE\.MAX;/.test(main32));
  t32("读不懂时先把原文件留一份",
    main32.indexOf("CHATFILE.badName(chatFile()") >= 0 && /copyFileSync\(chatFile\(\), keep\)/.test(main32));
  t32("留完备份要写日志（不许静默）", /对话记录读不懂（" \+ r\.error/.test(main32));
  t32("写盘走 serializeChat", main32.indexOf("CHATFILE.serializeChat(chatItems") >= 0);
  t32("反例：chatLoad 里不许再自己 JSON.parse 吞掉错误",
    (() => {
      const i = main32.indexOf("function chatLoad()");
      const j = main32.indexOf("function chatWriteNow()");
      const body = i >= 0 && j > i ? main32.slice(i, j) : "";
      return body.indexOf("JSON.parse(raw)") < 0;
    })());

  t32("单测存在，并且专门测了读不懂的几种",
    test32.indexOf("半截 JSON 报 json") >= 0 && test32.indexOf("没有 items 数组报 shape") >= 0);
  t32("单测验了往返一致", test32.indexOf("往返之后") >= 0);
  t32("真机探针存在，验重启后还在",
    probe32.indexOf("重启之后那句用户的话还在") >= 0 && probe32.indexOf("重启之后那句她的话也在") >= 0);
  t32("真机探针验了坏文件留备份", probe32.indexOf("坏文件被留了一份 .bad-") >= 0);
  t32("probe:chat 与 test:chatfile 都挂上了",
    !!pkg.scripts["probe:chat"] && !!pkg.scripts["test:chatfile"] &&
    (pkg.scripts.test || "").indexOf("test-chatfile.js") >= 0);
}
// ---------- 33. 切模型与「只换规则」是两条通路 ----------
{
  const SCRIPTS33 = path.resolve(__dirname);
  const main33 = fs.readFileSync(path.join(APP, "src", "main.js"), "utf8");
  const pre33 = fs.readFileSync(path.join(APP, "src", "preload.js"), "utf8");
  const ren33 = fs.readFileSync(path.join(APP, "src", "renderer.js"), "utf8");
  const probe33 = fs.readFileSync(path.join(SCRIPTS33, "probe-switch.js"), "utf8");
  const t33 = (n, c, d) => { if (c) ok(n, d); else bad(n); };

  t33("切模型的探针存在", fs.existsSync(path.join(SCRIPTS33, "probe-switch.js")));
  t33("探针用 localStorage 计数页面加载次数", probe33.indexOf("localStorage.setItem('__nav'") >= 0);
  t33("计数脚本挂在每个新文档上（不是当前文档）", probe33.indexOf("Page.addScriptToEvaluateOnNewDocument") >= 0);
  t33("探针用页面 origin 而不是调试端口发请求", probe33.indexOf("learnOrigin") >= 0 && probe33.indexOf("location.origin") >= 0);
  t33("探针断言「切一次模型，页面只重载一次」", probe33.indexOf("切一次模型，页面只重载一次") >= 0);
  t33("探针断言「只换规则不重载页面」", probe33.indexOf("只换规则不重载页面") >= 0);
  t33("探针断言取景值读得到", probe33.indexOf("取景值读得到") >= 0);

  t33("adapter:reload 发的是 pack-rules", /ipcMain\.handle\("adapter:reload"[\s\S]{0,400}?send\("pack-rules"/.test(main33));
  // 反例：改取景不许再走 pack-changed（那条在渲染端等于整页 reload）
  {
    const i = main33.indexOf('ipcMain.handle("adapter:reload"');
    const blk = i < 0 ? "" : main33.slice(i, i + 500);
    t33("反例：adapter:reload 不许发 pack-changed", blk.length > 0 && blk.indexOf('"pack-changed"') < 0);
  }

  t33("preload 暴露了 onPackRules", pre33.indexOf("onPackRules:") >= 0 && pre33.indexOf('ipcRenderer.on("pack-rules"') >= 0);
  t33("页面有 applyPackRules 且不 reload", ren33.indexOf("async function applyPackRules()") >= 0 && /async function applyPackRules\(\)[\s\S]{0,700}?layout\(\);/.test(ren33));
  t33("页面订阅了 pack-rules", /onPackRules\(\(\) => \{ applyPackRules\(\); \}\)/.test(ren33));
  t33("换模型那一路仍然整页 reload（两条通路没混）", /onPackChanged\(\(\) => \{ location\.reload\(\); \}\)/.test(ren33));
  t33("__fishDebug 能读出取景与包 id", ren33.indexOf("viewY: viewBox.y") >= 0 && ren33.indexOf("packId: PACK && PACK.id") >= 0);
  t33("有 probe:switch 入口", pkg.scripts["probe:switch"] === "node scripts/probe-switch.js");
}

// ---------- 第 34 段：旧版留在设置里的取景，得搬进模型 ----------
{
  const SCRIPTS34 = path.resolve(__dirname);
  const t34 = (n, c, d) => { if (c) ok(n, d); else bad(n); };
  const main34 = fs.readFileSync(path.join(APP, "src", "main.js"), "utf8");
  const pr34 = path.join(SCRIPTS34, "probe-viewbox-migrate.js");
  const has34 = fs.existsSync(pr34);
  const pv34 = has34 ? fs.readFileSync(pr34, "utf8") : "";

  t34("旧取景的迁移函数还在", /function migrateLegacyViewBox\(\)/.test(main34));
  t34("迁移只在能确定归属时才动手（有 pack 标记）", /const pid = String\(vb\.pack \|\| ""\)\.trim\(\);/.test(main34) && /if \(!pid\) return;/.test(main34));
  t34("内置包不搬（不猜，也不给它凭空造覆盖层）", /rec\.origin === "builtin"/.test(main34) && main34.indexOf("它改不了，原样留着") >= 0);
  t34("包已经不在时也不搬", main34.indexOf("但这个模型已经不在") >= 0);
  t34("搬的时候写的是模型的 layout", /ADAPTER\.save\(pid, \{ cfgs: \{ layout: \{ viewY: y, viewH: h \} \} \}\)/.test(main34));
  t34("搬完清掉设置里的旧值", /S\.patch\(\{ viewBox: \{\} \}\)/.test(main34));
  t34("搬成功要留日志", main34.indexOf("旧取景已搬进模型") >= 0);
  t34("启动时延迟调用，不挡首屏", /setTimeout\(\(\) => \{ try \{ migrateLegacyViewBox\(\); \}/.test(main34) && main34.indexOf("}, 2500);") >= 0);
  t34("迁移包在 try 里，出错只记日志", /catch \(e\) \{\s*\r?\n\s*logErr\("\[migrate\] 搬旧取景时出错/.test(main34));
  t34("探针存在", has34);
  t34("探针覆盖三种情况（可搬 / 包不在 / 没有标记）", pv34.indexOf("A 旧取景搬进了模型自己的 layout") >= 0 && pv34.indexOf("B 包不在时旧取景原样留着") >= 0 && pv34.indexOf("C 没有模型标记时原样留着") >= 0);
  t34("探针验第二次启动不会被改回默认", pv34.indexOf("A2 再启动一次不会被改回默认") >= 0);
  t34("探针读的是模型自己的 live2d.layout", pv34.indexOf("mf.live2d.layout") >= 0);
  t34("有 probe:viewbox 入口", !!(pkg.scripts && pkg.scripts["probe:viewbox"]));
}
// ---------- 35. 故障记录要留得下来 ----------
{
  const SCRIPTS35 = path.resolve(__dirname);
  const main35 = fs.readFileSync(path.join(APP, "src", "main.js"), "utf8");
  const pre35 = fs.readFileSync(path.join(APP, "src", "preload.js"), "utf8");
  const vc35 = fs.readFileSync(path.join(APP, "src", "voice.js"), "utf8");
  const pf35 = path.join(SCRIPTS35, "probe-fault.js");
  const pv35 = fs.existsSync(pf35) ? fs.readFileSync(pf35, "utf8") : "";
  const t35 = (n, c, d) => { if (c) ok(n, d); else bad(n); };

  t35("主进程有故障环形缓冲", /const FAULT_MAX = \d+;/.test(main35) && /let faultRing = \[\];/.test(main35));
  t35("故障落盘用 tmp + rename（不会写坏）", /writeFileSync\(tmp, JSON\.stringify\(\{ version: 1, items: faultRing \}/.test(main35) && /fs\.renameSync\(tmp, f\)/.test(main35));
  t35("上报只收白名单字段（页面塞不进任意结构）", /const rec = \{[\s\S]{0,300}?raw: String\(o\.raw \|\| ""\)\.slice\(0, 600\)/.test(main35) && /slice\(0, 32\)/.test(main35));
  t35("启动时把上一次的故障读回来", /app\.whenReady\(\)\.then\(async \(\) => \{\s*\nfaultLoad\(\);|app\.whenReady\(\)\.then\(async \(\) => \{[\s\S]{0,40}?faultLoad\(\);/.test(main35));
  t35("诊断包里有故障记录.txt", /put\("故障记录\.txt", faultText\(\)\)/.test(main35));
  t35("记录里同时给人话和原始错误", /她说的: /.test(main35) && /原始错误: /.test(main35));
  t35("渲染进程有上报通道", /ipcMain\.on\("fault:report"/.test(main35) && /ipcMain\.handle\("fault:list"/.test(main35));
  t35("preload 暴露 reportFault / faultList", /reportFault: \(rec\) => ipcRenderer\.send\("fault:report", rec\)/.test(pre35) && /faultList: \(\) => ipcRenderer\.invoke\("fault:list"\)/.test(pre35));
  t35("语音侧三处失败都上报（说话 / 麦克风 / 掉线）", /reportFault\("speak", err\)/.test(vc35) && (vc35.split('reportFault("mic", lastMicError)').length - 1) >= 2, "mic 上报 " + (vc35.split('reportFault("mic", lastMicError)').length - 1) + " 处");
  t35("等回复的两种失败也上报", /reportFault\("reply", \{ code: "partial"/.test(vc35) && /reportFault\("reply", \{ code: "stalled"/.test(vc35));
  t35("探针存在且覆盖三条链路", fs.existsSync(pf35) && pv35.indexOf("probe-denied") >= 0 && pv35.indexOf("__finishReply") >= 0 && pv35.indexOf("diagExportTo") >= 0);
  t35("探针验了「重启之后还在」", pv35.indexOf("重启之后") >= 0 && pv35.indexOf("killTree") >= 0);
  t35("探针验了上限（不会无限长）", pv35.indexOf("只留最近 40 条") >= 0);
  t35("有 probe:fault 入口", !!(pkg.scripts && pkg.scripts["probe:fault"]));
}
// ---------- 36. 人不在的时候，别再往渲染进程推坐标 ----------
// 锁屏 / 休眠 / 最小化 / 手动暂停，这四个来源都走 setPauseReason。
// 暂停的全部意义就是省电，而每 33ms 一次 IPC 会把渲染进程反复唤醒。
{
  const SCRIPTS36 = path.resolve(__dirname);
  const main36 = fs.readFileSync(path.join(APP, "src", "main.js"), "utf8");
  const pre36 = fs.readFileSync(path.join(APP, "src", "preload.js"), "utf8");
  const pc36 = (() => { try { return fs.readFileSync(path.join(SCRIPTS36, "probe-cursor.js"), "utf8"); } catch (e) { return ""; } })();
  const t36 = (n, c, d) => { if (c) ok(n, d); else bad(n); };

  t36("有坐标推送的探针", pc36.length > 200);
  t36("探针用测试通道模拟「人不在」", /testPauseRender\(/.test(pc36) && /testCursorFeed\(/.test(pc36));
  t36("探针验了「正常时一直在推」", pc36.indexOf("正常运行时坐标一直在推") >= 0);
  t36("探针验了「暂停时一帧都不推」", pc36.indexOf("暂停之后一帧都不该推") >= 0);
  t36("探针验了「恢复之后接着推」", pc36.indexOf("恢复之后接着推") >= 0);

  t36(
    "推送前有人不在就退出的守卫",
    main36.indexOf('    if (isRenderPaused() || !win.isVisible()) return;') >= 0
  );
  t36(
    "守卫必须在 send 之前（顺序错了等于没守）",
    (() => {
      const g = main36.indexOf("if (isRenderPaused() || !win.isVisible()) return;");
      const s = main36.indexOf('win.webContents.send("cursor"');
      return g > 0 && s > g;
    })()
  );
  t36("真的发出去了几帧有计数", main36.indexOf("cursorSent += 1;") >= 0);
  t36(
    "暂停开关与计数都只在自测块里注册",
    main36.indexOf('ipcMain.on("__test:pauseRender"') >= 0 &&
      main36.indexOf('ipcMain.handle("__test:cursorFeed"') >= 0 &&
      /if \(!app\.isPackaged \|\| process\.env\.FISH_MULTI === "1"\)/.test(main36)
  );
  t36(
    "preload 两个通道都按 FISH_MULTI 才暴露",
    /testPauseRender: process\.env\.FISH_MULTI === "1"/.test(pre36) &&
      /testCursorFeed: process\.env\.FISH_MULTI === "1"/.test(pre36)
  );
  t36(
    "反例：不许在暂停时也把穿透逻辑跑一遍再退回",
    !/setIgnoreMouseEvents[\s\S]{0,200}?if \(isRenderPaused\(\)\) return;/.test(main36)
  );
  t36("有 probe:cursor 入口", !!(pkg.scripts && pkg.scripts["probe:cursor"]));
}
// ---------- 第 37 段：人不在的时候，所有周期任务都得停 ----------
{
  const SCRIPTS37 = path.resolve(__dirname);
  const main37 = fs.readFileSync(path.join(APP, "src", "main.js"), "utf8");
  const rend37 = fs.readFileSync(path.join(APP, "src", "renderer.js"), "utf8");
  const pre37 = fs.readFileSync(path.join(APP, "src", "preload.js"), "utf8");
  const probe37Path = path.join(SCRIPTS37, "probe-idle.js");
  const probe37 = fs.existsSync(probe37Path) ? fs.readFileSync(probe37Path, "utf8") : "";
  const t37 = (n, c, d) => { if (c) ok(n, d); else bad(n); };

  // 探针本身
  t37("有「人不在时周期任务是否停」的探针", !!probe37);
  t37("探针用 __test:pauseRender 模拟锁屏", probe37.indexOf("testPauseRender(true)") >= 0);
  t37("探针读主进程的扫描计数", probe37.indexOf("testIdleStats") >= 0);
  t37("探针验了「暂停后扫描不再跑」", probe37.indexOf("暂停后 DSH 活跃度扫描不再跑") >= 0);
  t37("探针验了「暂停后桥接不再跑」", probe37.indexOf("暂停后桥接轮询不再跑") >= 0);
  t37("探针验了「恢复立刻补一拍」", probe37.indexOf("恢复的那一下桥接立刻补一拍") >= 0);

  // 主进程：活跃度扫描
  const watcher37 = main37.indexOf("function startDshWatcher()");
  const guardAt = main37.indexOf('if (isRenderPaused() || !win || win.isDestroyed() || !win.isVisible()) return;', watcher37);
  const scanAt = main37.indexOf("Date.now() - newestSessionWrite()", watcher37);
  t37("活跃度扫描有暂停守卫", guardAt > 0);
  t37("守卫在真正扫盘之前（不然白扫一趟再退出）", guardAt > 0 && scanAt > guardAt);

  // 主进程：截图
  t37("截图 tick 有暂停守卫", main37.indexOf("if (!force && isRenderPaused()) return { ok: false, paused: true };") >= 0);

  // 自测通道只在自测实例里注册
  const testBlock37 = main37.slice(main37.indexOf('if (!app.isPackaged || process.env.FISH_MULTI === "1")'), main37.indexOf('if (!app.isPackaged || process.env.FISH_MULTI === "1")') + 6000);
  t37("__test:idleStats 只在自测块里注册", testBlock37.indexOf('ipcMain.handle("__test:idleStats"') >= 0);
  t37("preload 的 testIdleStats 也只在自测下暴露", /testIdleStats:\s*process\.env\.FISH_MULTI === "1"/.test(pre37));

  // 渲染进程：暂停状态只能有一个来源
  t37("renderPaused 有一个只读出口给外部用", rend37.indexOf("window.__fishPausedNow = () => renderPaused;") >= 0);
  const poll37 = rend37.slice(rend37.indexOf("const pollDsh = () => {"), rend37.indexOf("const pollDsh = () => {") + 900);
  t37("桥接轮询通过出口读暂停状态", poll37.indexOf("window.__fishPausedNow") >= 0);
  t37("反例：桥接轮询不许直接引用 renderPaused", poll37.indexOf("if (renderPaused)") < 0);

  t37("有 npm run probe:idle 入口", pkg.scripts["probe:idle"] === "node scripts/probe-idle.js");
}

// ---------- 38. 出站网络：到底会连哪些外面 ----------
{
  const SCRIPTS38 = path.resolve(__dirname);
  const AUD38 = fs.readFileSync(path.join(SCRIPTS38, "audit-network.js"), "utf8");
  const PV38 = fs.readFileSync(path.join(SCRIPTS38, "probe-network.js"), "utf8");
  const main38 = fs.readFileSync(path.join(APP, "src", "main.js"), "utf8");
  const pre38 = fs.readFileSync(path.join(APP, "src", "preload.js"), "utf8");
  let priv38 = "";
  try { priv38 = fs.readFileSync(path.join(APP, "assets", "PRIVACY.txt"), "utf8"); } catch (e) { }
  const t38 = (n, c, d) => { if (c) ok(n, d); else bad(n); };

  t38("有出站网络审计脚本", AUD38.indexOf("const ALLOW") >= 0);
  t38("白名单登记了三个外网域名",
    AUD38.indexOf('host: "hf-mirror.com"') >= 0 &&
    AUD38.indexOf('host: "api.github.com"') >= 0 &&
    AUD38.indexOf('host: "github.com"') >= 0);
  t38("每个白名单条目都写了用途和备注",
    AUD38.indexOf("why:") >= 0 && AUD38.indexOf("note:") >= 0 && AUD38.indexOf("where:") >= 0);
  t38("本机地址与 XML 命名空间不算外网",
    AUD38.indexOf("const LOOPBACK =") >= 0 && AUD38.indexOf("const NAMESPACE =") >= 0);
  t38("会报「没有未登记的外网域名」", AUD38.indexOf("没有未登记的外网域名") >= 0);
  t38("会报白名单过期", AUD38.indexOf("白名单没有过期条目") >= 0);
  t38("会查启动路径上有没有自动检查更新", AUD38.indexOf("启动路径上没有自动检查更新") >= 0);
  t38("会查出站有没有绕过 net.fetch",
    AUD38.indexOf("const OUTBOUND_HTTP") >= 0 && AUD38.indexOf("没有绕过 net.fetch 的裸 http 出站调用") >= 0);
  t38("裸 http 判据只认 http.request / https.get（不吃掉 S.get / map.get）",
    /OUTBOUND_HTTP = \/\\bhttps\\?\\\.\(request\|get\)/.test(AUD38) || AUD38.indexOf("别写成") >= 0);

  t38("有真机出站探针", PV38.indexOf("__test:netLog") >= 0 || PV38.indexOf("testNetLog") >= 0);
  t38("探针先验「记录器装上了」，否则 0 条是假绿",
    PV38.indexOf("hooked") >= 0 && PV38.indexOf("假绿") >= 0);
  t38("探针验「不点检查更新就没有外网请求」", PV38.indexOf("没有任何外网请求") >= 0);
  t38("探针真的点一次检查更新（走 updateCheck）", PV38.indexOf("window.deskfish.updateCheck()") >= 0);
  t38("探针验页面加载的资源里没有外网地址", PV38.indexOf("页面加载的资源里没有外网地址") >= 0);

  t38("主进程装了 net.fetch 记录器", main38.indexOf("const __netLog = [];") >= 0 && main38.indexOf("__netHooked") >= 0);
  const testAt38 = main38.indexOf('if (!app.isPackaged || process.env.FISH_MULTI === "1") {');
  const netAt38 = main38.indexOf('ipcMain.handle("__test:netLog"');
  t38("记录器通道只在自测实例里注册", testAt38 >= 0 && netAt38 > testAt38);
  t38("preload 暴露了 testNetLog", pre38.indexOf("testNetLog") >= 0);

  t38("隐私说明补上了「检查更新」这一处",
    priv38.indexOf("检查更新") >= 0 && priv38.indexOf("api.github.com") >= 0);
  t38("隐私说明里不再写一个不是默认值的 api.deepseek.com",
    priv38.indexOf("api.deepseek.com") < 0);

  t38("两个入口都在 package.json 里",
    !!pkg.scripts["audit:network"] && !!pkg.scripts["probe:network"]);
  t38("静态审计挂在 npm run verify 上", String(pkg.scripts.verify || "").indexOf("audit-network.js") >= 0);
}


// ---------- 39. 本机数据：清除的时候清什么、留什么 ----------
{
  const SCRIPTS39 = path.resolve(__dirname);
  const AUD39 = fs.readFileSync(path.join(SCRIPTS39, "audit-privacy.js"), "utf8");
  const PV39 = fs.readFileSync(path.join(SCRIPTS39, "probe-wipe.js"), "utf8");
  const main39 = fs.readFileSync(path.join(APP, "src", "main.js"), "utf8");
  const pre39 = fs.readFileSync(path.join(APP, "src", "preload.js"), "utf8");
  const setHtml39 = fs.readFileSync(path.join(APP, "src", "settings.html"), "utf8");
  const setJs39 = fs.readFileSync(path.join(APP, "src", "settings-renderer.js"), "utf8");
  const t39 = (n, c, d) => { if (c) ok(n, d); else bad(n); };

  t39("有本机数据审计脚本", AUD39.indexOf("const FILES = [") >= 0);
  t39("登记表把设置与模型标成不清理，并写明了理由",
    /p: "settings\.json"[\s\S]{0,200}wipe: false[\s\S]{0,80}why:/.test(AUD39) &&
    /p: "models"[\s\S]{0,160}wipe: false[\s\S]{0,80}why:/.test(AUD39));
  t39("会红：有没登记的落盘路径", AUD39.indexOf("有没登记的落盘路径") >= 0);
  t39("会红：清单条目对不上代码", AUD39.indexOf("清单里有对不上代码的条目") >= 0);
  t39("会红：脱敏集合漏了密钥字段", AUD39.indexOf("诊断包会漏掉这些密钥字段") >= 0);
  t39("反例：快捷键不该被当成密钥", AUD39.indexOf("!/^hotkey/i.test(k)") >= 0);
  t39("会红：把整份设置写进日志", AUD39.indexOf("没有把整份设置写进日志的调用") >= 0);

  t39("有清除本机数据的探针", PV39.indexOf("dataWipe") >= 0);
  t39("探针验了「设置还在」与「模型还在」",
    PV39.indexOf("设置还在") >= 0 && PV39.indexOf("用户导入的模型还在") >= 0);
  t39("探针验了内存里的记录也清了", PV39.indexOf("内存里的对话记录也清了") >= 0);

  const at39 = main39.indexOf('ipcMain.handle("data:wipe"');
  const wipe39 = at39 < 0 ? "" : main39.slice(at39, at39 + 4200);
  t39("主进程有 data:wipe 通道", at39 >= 0);
  t39("删之前先确认路径落在数据目录里",
    wipe39.indexOf("const inside = (p) => {") >= 0 && wipe39.indexOf("path.relative(U, p)") >= 0);
  t39("清完把内存里的对话也清掉", wipe39.indexOf("chatItems = null;") >= 0);
  t39("清完把待写盘的定时器也撤掉", wipe39.indexOf("clearTimeout(chatSaveTimer)") >= 0);
  t39("反例：不许整目录递归删数据根",
    wipe39.indexOf("fs.rmSync(U") < 0 && wipe39.indexOf("rmSync(userData") < 0);
  t39("反例：清除清单里不许出现 settings.json 与 models",
    wipe39.indexOf('"settings.json"') < 0 && wipe39.indexOf('"models"') < 0);

  t39("preload 暴露了 dataWipe", pre39.indexOf('dataWipe: () => ipcRenderer.invoke("data:wipe")') >= 0);
  t39("设置页有这个按钮", setHtml39.indexOf('id="dataWipe"') >= 0);
  t39("点之前先问，并且说清了「不会动」什么",
    setJs39.indexOf("els.dataWipe.addEventListener") >= 0 && setJs39.indexOf("不会动：设置（含 API Key）") >= 0);

  t39("有 npm run audit:privacy 入口", pkg.scripts["audit:privacy"] === "node scripts/audit-privacy.js");
  t39("有 npm run probe:wipe 入口", pkg.scripts["probe:wipe"] === "node scripts/probe-wipe.js");
  t39("本机数据审计挂在 verify 链上", String(pkg.scripts.verify || "").indexOf("audit-privacy") >= 0);
}

// ---------- 40. 引导卡：第一眼就说清她还缺什么 ----------
  {
    const SCRIPTS40 = path.resolve(__dirname);
    const main40 = fs.readFileSync(path.join(APP, "src", "main.js"), "utf8");
    const pre40 = fs.readFileSync(path.join(APP, "src", "preload.js"), "utf8");
    const wjs40 = fs.readFileSync(path.join(APP, "src", "welcome.js"), "utf8");
    const whtml40 = fs.readFileSync(path.join(APP, "src", "welcome.html"), "utf8");
    const pv40 = fs.readFileSync(path.join(SCRIPTS40, "probe-welcome.js"), "utf8");
    const t40 = (name, cond, detail) => { if (cond) ok(name, detail); else bad(name); };

    const iPre = main40.indexOf('ipcMain.handle("welcome:precheck"');
    const preSlice = iPre >= 0 ? main40.slice(iPre, iPre + 2200) : "";
    t40("主进程有开场体检通道", iPre > 0);
    t40("体检给出「模型」与「对话接口」两项", /key: "model"/.test(preSlice) && /key: "talk"/.test(preSlice));
    t40("两条路都算齐：填了接口，或者桥接通", preSlice.indexOf("const talk = !!base || bridgeOk;") >= 0);
    t40("桥接探测有超时（不能卡住引导卡）", preSlice.indexOf("AbortSignal.timeout(2000)") >= 0);
    t40("体检复用 hasUsablePack，不另写一份有没有模型的判断", preSlice.indexOf("hasUsablePack()") >= 0);

    t40("引导页会跑体检", wjs40.indexOf("async function renderTodo()") >= 0 && wjs40.indexOf("renderTodo();") >= 0);
    t40("体检走 IPC 问主进程", wjs40.indexOf("window.deskfish.welcomePrecheck()") >= 0);
    t40("麦克风只在系统明确关掉时才提（prompt 不打扰）", /state === "denied"/.test(wjs40) && wjs40.indexOf("navigator.permissions.query") >= 0);
    t40("每一项都带一个「去设置 / 去导入」的出口", wjs40.indexOf('it.act === "settings" || it.act === "adapter"') >= 0 && wjs40.indexOf('go.textContent = it.act === "settings" ? "去设置" : "去导入";') >= 0);
    t40("出口按钮先关卡片再开窗（不然两张卡叠在一起）", /go\.addEventListener\("click", \(\) => \{\s*close\(\);/.test(wjs40));
    t40("收起时把上一次的内容也清掉", wjs40.indexOf("box.hidden = true;") >= 0 && wjs40.indexOf('box.innerHTML = "";') >= 0);
    t40("卡片变高之后重新量一次窗口", wjs40.indexOf("window.deskfish.welcomeFit") >= 0);
    t40("反例：引导页不许再回到「只提示没模型」那个 id", wjs40.indexOf('getElementById("nomo")') < 0 && whtml40.indexOf('id="nomo"') < 0);
    t40("提示说的是人话，带具体去哪儿填", preSlice.indexOf("OpenAI 兼容") >= 0 && preSlice.indexOf("去设置") >= 0);
    t40("页面上有体检容器", whtml40.indexOf('id="todo"') >= 0 && whtml40.indexOf("class=\"todo\"") >= 0);

    t40("preload 暴露了体检通道", pre40.indexOf("welcomePrecheck:") >= 0);
    t40("探针存在", pv40.length > 500);
    t40("探针覆盖「缺接口 / 填上 / 只用桥接 / 点去设置」四段", ["缺接口时卡片看得见", "填上接口之后卡片收起来了", "只用桥接的人", "设置窗真的打开了"].every((s) => pv40.indexOf(s) >= 0));
    t40("探针自己起一个假桥接验「桥接通也算齐」", pv40.indexOf("createServer") >= 0 && pv40.indexOf("api/health") < 0);
    t40("探针断言提示里不出现技术错误原文", pv40.indexOf("Failed to fetch|ECONNREFUSED") >= 0);
    t40("npm 里有 probe:welcome", !!(pkg.scripts && pkg.scripts["probe:welcome"]));
  }

// ============================================================
// 41. 探针的临时目录：建得出来，就一定收得回去（round 36）
// ============================================================
{
  const SCRIPTS41 = path.resolve(__dirname);
  const t41 = (name, cond, detail) => {
    if (cond) ok(name, detail);
    else bad(name);
  };

  const libPath = path.join(SCRIPTS41, "lib", "tmp.js");
  t41("有一个共用的临时目录助手", fs.existsSync(libPath));
  const lib = fs.existsSync(libPath) ? fs.readFileSync(libPath, "utf8") : "";
  t41("它导出 makeTmp 与 sweepStale", /module\.exports\s*=\s*\{[^}]*makeTmp/.test(lib) && lib.indexOf("sweepStale") >= 0);
  t41("进程退出时收拾自己建的目录", lib.indexOf('process.on("exit"') >= 0);
  t41("Ctrl-C / kill 也收拾", lib.indexOf("SIGINT") >= 0 && lib.indexOf("SIGTERM") >= 0);
  t41("每个目录里写一个 pid 标记", lib.indexOf('PIDFILE = ".probe-pid"') >= 0);
  t41("判活用 process.kill(pid, 0)", /process\.kill\(\s*pid\s*,\s*0\s*\)/.test(lib));
  t41("KEEP=1 时一律不动手", lib.indexOf('KEEP === "1"') >= 0);
  t41("能指定扫描根（单测要隔离）", /const root = o\.root/.test(lib));
  t41("支持 --dry 只列不删", lib.indexOf("require.main === module") >= 0 && lib.indexOf("--dry") >= 0);
  t41("第一次建目录时顺手扫一遍旧残骸（被 kill -9 掉的那些也能收）", /if \(!swept && !keep\(\)\)/.test(lib));
  t41("年龄要夹到 0（Windows 的 mtime 会比 now 大 1 毫秒）", /const age = Math\.max\(0, Date\.now\(\) - mtime\)/.test(lib));

  const probes = fs.readdirSync(SCRIPTS41).filter((f) => /^probe-.*\.js$/.test(f) && fs.statSync(path.join(SCRIPTS41, f)).isFile());
  const raw = probes.filter((f) => fs.readFileSync(path.join(SCRIPTS41, f), "utf8").indexOf("fs.mkdtempSync") >= 0);
  t41("探针里不再有裸的 fs.mkdtempSync（反例）", raw.length === 0, raw.join(","));

  const noLib = probes.filter((f) => {
    const s = fs.readFileSync(path.join(SCRIPTS41, f), "utf8");
    return s.indexOf("makeTmp") >= 0 && s.indexOf('require("./lib/tmp")') < 0;
  });
  t41("用了 makeTmp 的都真的 require 了它", noLib.length === 0, noLib.join(","));

  const diagBad = ["diag-adapter.js", "perf.js", "test-diag.js"].filter((f) => {
    const p2 = path.join(SCRIPTS41, f);
    if (!fs.existsSync(p2)) return false;
    const s = fs.readFileSync(p2, "utf8");
    return s.indexOf("fs.mkdtempSync") >= 0 || s.indexOf("makeTmp") < 0;
  });
  t41("诊断脚本也改过来了", diagBad.length === 0, diagBad.join(","));

  const unitPath = path.join(SCRIPTS41, "test-tmp.js");
  t41("有临时目录助手的单测", fs.existsSync(unitPath));
  const unit = fs.existsSync(unitPath) ? fs.readFileSync(unitPath, "utf8") : "";
  t41("单测在隔离根里跑，不碰真实 %TEMP%", unit.indexOf("root: ROOT") >= 0 && unit.indexOf("扫描根就是隔离根") >= 0);
  t41("单测守着「活进程的目录不动」", unit.indexOf("活进程的目录没被动") >= 0);
  t41("有 npm run clean:tmp 与 test:tmp", !!(pkg.scripts["clean:tmp"] && pkg.scripts["test:tmp"]));
  t41("单测挂在 npm test 链上", String(pkg.scripts.test || "").indexOf("test-tmp.js") >= 0);
}

/* 【第 42 段】 */
/* ---------- 42. 订阅要有人管（监听器泄漏） ---------- */
const SC42 = path.resolve(__dirname);
const audit42 = fs.readFileSync(path.join(SC42, "audit-listeners.js"), "utf8");
const reg42 = fs.readFileSync(path.join(SC42, "lib", "listeners-reg.json"), "utf8");
const leak42 = fs.readFileSync(path.join(SC42, "probe-leak.js"), "utf8");
const main42 = fs.readFileSync(path.join(APP, "src", "main.js"), "utf8");
const pre42 = fs.readFileSync(path.join(APP, "src", "preload.js"), "utf8");

const t42 = (name, cond, detail) => { if (cond) ok(name, detail); else bad(name); };

t42("有订阅审计脚本", audit42.length > 300);
t42("审计按「文件 + 订阅键 + 次数」比对，不是只数总数",
  audit42.indexOf('who + "." + m[1]') >= 0);
t42("审计会拦「深层订阅」（缩进 ≥6 说明写在会被重复调用的函数里）", /ind >= 6/.test(audit42));
t42("深层订阅允许登记例外，但例外不许过期", audit42.indexOf("staleExcept") >= 0 && audit42.indexOf("exceptWhere") >= 0);
t42("审计只许 ipcRenderer.on 出现在 preload.js", audit42.indexOf("ipcOutsidePreload") >= 0);
t42("登记表带 counts 与 except 两段", reg42.indexOf('"counts"') >= 0 && reg42.indexOf('"except"') >= 0);
t42("登记表里每条例外都写了理由", (reg42.match(/"why":/g) || []).length >= 4);

t42("有真机探针", leak42.length > 800);
t42("探针量的是监听器数，不是只看句柄", leak42.indexOf("testListeners") >= 0);
t42("探针覆盖三条热路径（改设置 / 开关设置窗 / 开关适配器）",
  leak42.indexOf("settingsPatch") >= 0 && leak42.indexOf("openSettings") >= 0 && leak42.indexOf("openAdapter") >= 0);
t42("探针对长生命周期 emitter 要求「完全相等」，不是「涨幅小」",
  leak42.indexOf("sumOf(afterA.app) === bApp") >= 0 && leak42.indexOf("sumOf(afterC.power) === bPow") >= 0);
t42("探针断言窗口数回到基线", leak42.indexOf("B 之后窗口数回到基线") >= 0);
t42("探针在采基线前先等引导卡弹完（否则 1 → 2 会假失败）",
  leak42.indexOf("await sleep(4500)") >= 0 && leak42.indexOf("closeWelcome") >= 0);
t42("探针对句柄只许降或微涨（降是好事，别当成断言失败）",
  leak42.indexOf("hDelta <= 2") >= 0);

t42("主进程有监听器快照通道", main42.indexOf('ipcMain.handle("__test:listeners"') >= 0);
t42("快照通道只在自测实例注册（位置在自测块起始之后）",
  main42.indexOf('ipcMain.handle("__test:listeners"') > main42.indexOf('if (!app.isPackaged || process.env.FISH_MULTI === "1")'));
t42("快照真的去数 app / ipcMain / powerMonitor / screen，并算句柄种类",
  main42.indexOf("ipc: snap(ipcMain)") >= 0 && main42.indexOf("power: snap(powerMonitor)") >= 0 &&
  main42.indexOf("screen: snap(screen)") >= 0 && main42.indexOf("kinds[k] = (kinds[k] || 0) + 1") >= 0);
t42("preload 暴露 testListeners，且只给自测实例",
  /testListeners:\s*process\.env\.FISH_MULTI === "1"/.test(pre42));
t42("npm 有 audit:listeners 与 probe:leak 两个入口",
  !!pkg.scripts["audit:listeners"] && !!pkg.scripts["probe:leak"]);
t42("订阅审计挂在 npm run verify 上",
  String(pkg.scripts.verify || "").indexOf("audit-listeners.js") >= 0);

  t42(
    "--write-reg 重写登记表时保留 except（不能把「为什么安全」抹掉）",
    /except: Array\.isArray\(prev\.except\)/.test(audit42)
  );

// 【第 43 段】功耗审计：空闲时到底省了多少
{
  const SCRIPTS43 = path.resolve(__dirname);
  const t43 = (name, cond, detail) => {
    if (cond) ok(name, detail);
    else bad(name);
  };
  const pp = path.join(SCRIPTS43, "probe-power.js");
  t43("有功耗探针 probe-power.js", fs.existsSync(pp));
  const pv43 = fs.existsSync(pp) ? fs.readFileSync(pp, "utf8") : "";
  t43("探针通过自测通道读进程指标", pv43.indexOf("window.deskfish.testMetrics") >= 0);
  t43("探针用 cursor 推送模拟「主人动了一下」", pv43.indexOf("testNudge") >= 0);
  t43("空闲前先等过降帧门槛（≥8 秒）", /sleep\(9\d{3}\)/.test(pv43) || /sleep\(1[0-9]{4}\)/.test(pv43));
  t43("断言活动时帧率会升回去", pv43.indexOf("活动时帧率高于") >= 0);
  t43("断言空闲时帧率压得住", pv43.indexOf("空闲时帧率一直压在") >= 0);
  t43("断言渲染进程自己的 CPU（不是只看总和）", pv43.indexOf("渲染进程（Tab）CPU") >= 0);
  t43("断言回到活动后帧率升回去", pv43.indexOf("回到活动后帧率升回") >= 0);
  t43(
    "TaskDuration 恒为 0 时不许当判据（本版本实测返回空）",
    pv43.indexOf("if (taskMs > 0)") >= 0 && pv43.indexOf("没累计") >= 0
  );
  const main43 = fs.readFileSync(path.join(APP, "src", "main.js"), "utf8");
  const pre43 = fs.readFileSync(path.join(APP, "src", "preload.js"), "utf8");
  const blockStart43 = main43.indexOf('if (!app.isPackaged || process.env.FISH_MULTI === "1")');
  t43(
    "__test:metrics 只在自测实例注册",
    main43.indexOf('ipcMain.handle("__test:metrics"') > blockStart43
  );
  t43(
    "__test:nudge 只在自测实例注册",
    main43.indexOf('ipcMain.on("__test:nudge"') > blockStart43
  );
  t43("nudge 走的是真实的 cursor 推送路径", /webContents\.send\(\s*"cursor"/.test(main43));
  t43("preload 暴露 testMetrics（条件同自测）", /testMetrics:[\s\S]{0,120}FISH_MULTI/.test(pre43));
  t43("preload 暴露 testNudge（条件同自测）", /testNudge:[\s\S]{0,120}FISH_MULTI/.test(pre43));
  const pkg43 = JSON.parse(fs.readFileSync(path.join(APP, "package.json"), "utf8"));
  t43("有 probe:power 入口", !!pkg43.scripts["probe:power"]);
}


// 【第 44 段】掉线重连：她断了之后不能一直挂着「思考」，回来要自己接上
{
  const APP44 = path.resolve(__dirname, "..");
  const RD44 = fs.readFileSync(path.join(APP44, "src", "renderer.js"), "utf8");
  const PR44 = fs.readFileSync(path.join(__dirname, "probe-reconnect.js"), "utf8");
  const t44 = (name, cond, detail) => {
    if (cond) ok(name, detail);
    else bad(name);
  };

  t44("探针存在且能跑", PR44.length > 2000);
  t44("探针自己起一个假桥（不动用户的 DSH）", PR44.indexOf("http.createServer") >= 0 && PR44.indexOf("/api/health") >= 0);
  t44(
    "假桥给了 CORS 头（不然跨源 fetch 会被拦，看起来和桥挂了没区别）",
    PR44.indexOf("access-control-allow-origin") >= 0
  );
  t44(
    "探针覆盖了六种情况：正常 / 忙 / 断 / 回来 / 端口上是别人 / 抖动",
    ["接上一个好的桥之后是「连着」", "桥说忙的时候她挂着思考相", "桥断了之后状态标成断开",
      "桥回来之后状态回到连着", "端口上答话的不是自家桥也算断", "一次抖动之后仍然是连着"]
      .every((s) => PR44.indexOf(s) >= 0)
  );
  t44("探针断言断线时她说了人话", PR44.indexOf("断的时候她主动说了一句") >= 0);
  t44("探针断言回来时她说「连上了」", PR44.indexOf("回来的时候她说了一句「连上了」") >= 0);
  t44("探针只比对新增的话，不在整段历史里搜关键词", PR44.indexOf("saidCount") >= 0);

  t44("renderer 记了 dshLink / dshFail", RD44.indexOf("let dshLink =") >= 0 && RD44.indexOf("let dshFail =") >= 0);
  t44("连续两次失败才算断（一次抖动不该让她变脸）", RD44.indexOf("if (dshFail < 2 || dshLink === \"down\") {") >= 0);
  // 1.6.2：断线时先自愈一次，说清「哪个地址不通、改走了随身桥接」，
  // 不再用一句笼统的「连不上 DSH」把用户丢在那儿。
  t44(
    "断线时说的是「哪个地址不通」，而不是笼统的「连不上」",
    RD44.indexOf("原来那个地址（") >= 0 && RD44.indexOf("随身桥接也没起来") >= 0
  );
  t44("报过断之后仍然定期再自愈（不是说完就不管）", RD44.indexOf("dshFail % 3 === 0") >= 0);
  t44("回来时说了一句「连上了」", RD44.indexOf("连上了，我在。") >= 0);
  t44("失败分支不再吞掉错误（catch 里要调 setLink(false)）", RD44.indexOf(".catch(() => { setLink(false); })") >= 0);

  const poll44 = RD44.slice(RD44.indexOf("const pollDsh = () =>"), RD44.indexOf("setInterval(pollDsh, 8000);"));
  t44("桥报告的忙记在自己那一格里", poll44.indexOf("busyByBridge =") >= 0);
  t44("桥那条通路不再自己写 phase（必须走 syncBusy）", poll44.indexOf('phase = "thinking"') < 0);
  t44("端口上答话的不是自家桥也算断", poll44.indexOf("setLink(ours)") >= 0);

  const act44 = RD44.slice(RD44.indexOf("window.deskfish.onDshActivity"), RD44.indexOf("// 一个人待着的时候偶尔自言自语"));
  t44("watcher 那条通路也走 syncBusy", act44.indexOf("busyByWatcher = busy;") >= 0 && act44.indexOf("syncBusy();") >= 0);
  t44("watcher 不再自己抢着写 phase", act44.indexOf('phase = "thinking"') < 0);
  t44(
    "两个「忙」取并集，不是谁最后写谁赢",
    /function syncBusy\(\) \{\s*\n\s*if \(busyByWatcher \|\| busyByBridge\) phase = "thinking";/.test(RD44)
  );
  t44("断线时把桥的「忙」清掉（不能一边断线一边声称在忙）",
    /dshLink = "down";\s*\n\s*busyByBridge = false;/.test(RD44));
  t44(
    "调试面能读到 phase / link",
    RD44.indexOf("    phase,") >= 0 && RD44.indexOf("    link: dshLink,") >= 0
  );

  t44("有 npm 入口 probe:reconnect", !!pkg.scripts && typeof pkg.scripts["probe:reconnect"] === "string");
  // 这台机器上出现过一次 24/2，当时控制台只剩最后几行，查不出是哪两条。
  const TI44 = fs.readFileSync(path.join(__dirname, "test-install.js"), "utf8");
  t44("test:install 失败时把失败项收起来", TI44.indexOf("const FAILS = [];") >= 0 && TI44.indexOf("FAILS.push(") >= 0);
  t44("失败时把完整报告写到 _tmp/install-report.json", TI44.indexOf("install-report.json") >= 0);
  t44("冒烟启动失败要带上输出尾巴（以前 stdio 是 ignore，什么都看不到）",
    TI44.indexOf("const cap = !!opt.capture;") >= 0 && TI44.indexOf("tail(smoke") >= 0);
  t44("报告里包含每一条断言的结果，不只是失败那几条", TI44.indexOf("all: NOTE") >= 0);
}

// ---------- 输出 ----------
const wName = rows.reduce((m, r) => Math.max(m, r[1].length), 0);
console.log("");
for (const r of rows) {
  console.log(r[0] + " " + r[1].padEnd(wName) + (r[2] ? "  " + r[2] : ""));
}
console.log("");
console.log(`结果：${pass} 通过，${fail} 失败，${warn} 提示（main 有 ${handled.size} 个 IPC，preload 暴露 ${invoked.size} 个）`);

process.exit(fail ? 1 : 0);
