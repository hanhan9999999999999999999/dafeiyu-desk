// 安装/卸载回归：静默装到临时目录 → 检查产物与快捷方式 → 冒烟启动 →
// 覆盖安装（再跑一次同一个安装包）→ 静默卸载。
// 只动临时目录与本次安装写入的快捷方式，不碰已安装在默认目录的副本。
// 用法：node scripts/test-install.js [安装包路径]
//
// 覆盖安装这一段的由来（2026-11-14 实测）：对已安装目录再跑 /S 时，NSIS 会把
// 旧安装删掉再整份解一遍 1.9 GB，耗时约 130 秒；早期用 180 秒超时去测，正好
// 卡在边上，被误判成「卡死」。这里给它 600 秒，并把「装完之后快捷方式与卸载器
// 还在不在」当成断言 —— 那才是用户升级时真会踩到的东西。
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const pkg = require(path.join(ROOT, "package.json"));
const NOTE = [];
let pass = 0, fail = 0;
const FAILS = [];
let HAD_CRASH = false;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log("✅ " + name + (detail ? "  " + detail : "")); }
  else {
    fail++;
    console.log("❌ " + name + (detail ? "  → " + detail : ""));
    // 失败项单独留一份：这台机器上偶然出现过 24/2，事后翻控制台只剩最后几行，
    // 查不出是哪两条。现在每条失败都进报告。
    FAILS.push({ at: new Date().toISOString(), name, detail: detail || "" });
  }
  NOTE.push({ name, ok, detail: detail || "" });
};

// 安装包本身的耗时预算。慢机器上覆盖安装会更久，这里给足余量；
// 真正要守的是「能装完 + 装完东西还在」，不是秒表。
const INSTALL_TIMEOUT_MS = 600000;
const UNINSTALL_TIMEOUT_MS = 300000;

function findInstaller(arg) {
  if (arg) return path.resolve(arg);
  const dist = path.join(ROOT, "dist");
  const cands = fs.readdirSync(dist)
    .filter((f) => /^大肥鱼-.*-安装包\.exe$/.test(f))
    .map((f) => path.join(dist, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return cands[0];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(exe, args, timeoutMs, extra) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const opt = Object.assign({}, extra || {});
    // capture：把子进程的输出收下来（默认丢掉，冒烟启动失败时完全看不到原因）
    const cap = !!opt.capture;
    delete opt.capture;
    if (cap) opt.stdio = ["ignore", "pipe", "pipe"];
    else if (!opt.stdio) opt.stdio = "ignore";
    const p = spawn(exe, args, Object.assign({ windowsHide: true }, opt));
    let out = "";
    if (cap && p.stdout) {
      p.stdout.on("data", (b) => { if (out.length < 8000) out += String(b); });
      p.stderr.on("data", (b) => { if (out.length < 8000) out += String(b); });
    }
    const done = (r) => resolve(Object.assign({ ms: Date.now() - t0, out: cap ? out.slice(-2000) : "" }, r));
    const timer = setTimeout(() => { try { p.kill(); } catch (e) { } done({ code: -1, timeout: true }); }, timeoutMs);
    p.on("exit", (code) => { clearTimeout(timer); done({ code }); });
    p.on("error", (e) => { clearTimeout(timer); done({ code: -1, error: String(e.message || e) }); });
  });
}

// NSIS 的 /D= 必须是最后一个参数，而且**不能加引号**，哪怕路径里有空格
// （官方文档原话）。Node 的 spawn 默认会给含空格的参数补引号，所以这里统一
// windowsVerbatimArguments —— 路径不含空格时两种传法等价，含空格时只有这种能用。
// 但注意：实测 NSIS 自己的 /D 解析仍会在第一个空格处截断，见第 4 段注释。
// NSIS 安装器偶尔会在写文件阶段以异常码退出 —— 实测过一次 `0xC0000005`
// （ACCESS_VIOLATION），只跑了 2 秒就退，正常要 96–120 秒。之后连跑 5 轮全绿，
// 单做「纯中文路径静默安装」也连跑 5 轮全绿，查不到产品侧原因；看起来是这台
// 机器上索引/杀毒在跟它抢刚写出来的 1.9 GB 文件。
// 处理：遇到异常退出码重试一次，并把「第一次崩过」写进结果 ——
// 断言要的是「最终装好了」，但证据不许吞掉（报告里能查到 retried / firstCode）。
const isCrashCode = (code) =>
  Number.isInteger(code) && code !== 0 && (code >>> 0) >= 0xc0000000;

const runInstaller = async (installer, dir, timeoutMs) => {
  const first = await run(installer, ["/S", "/D=" + dir], timeoutMs, {
    windowsVerbatimArguments: true,
  });
  if (first.timeout || !isCrashCode(first.code)) return first;
  HAD_CRASH = true;
  console.warn(
    "[install] 安装器异常退出 code=0x" +
      (first.code >>> 0).toString(16).toUpperCase() +
      "（用时 " + Math.round(first.ms / 1000) + "s），重试一次"
  );
  const second = await run(installer, ["/S", "/D=" + dir], timeoutMs, {
    windowsVerbatimArguments: true,
  });
  second.retried = true;
  second.firstCode = first.code;
  return second;
};

const tail = (s) => {
  const v = String(s || "").trim();
  if (!v) return "";
  const one = v.replace(/\s+/g, " ");
  return "  · 输出尾部: " + (one.length > 300 ? one.slice(-300) : one);
};

// 删测试目录：刚卸载完的目录经常被索引/杀毒短暂占住，rmSync 一次删不掉。
// 以前只删一次、catch 吞掉，然后在 E:\Temp 里留一个空目录（实测 2026-11-15）。
// 现在重试几轮，并且把「目录还在但里面是空的」当成已清理 —— 断言要守的是
// 「不留下文件」，不是「目录项必须消失」。
async function rmdirHard(dir, tries) {
  const n = tries || 6;
  for (let i = 0; i < n; i += 1) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch (e) { }
    if (!fs.existsSync(dir)) return { gone: true, left: 0 };
    await sleep(500);
  }
  let left = 0;
  try { left = countFiles(dir); } catch (e) { }
  return { gone: false, left };
}

async function waitFor(fn, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(400);
  }
  return false;
}

function shortcuts() {
  const home = process.env.USERPROFILE || "";
  const appdata = process.env.APPDATA || "";
  return {
    desktop: path.join(home, "Desktop", "大肥鱼.lnk"),
    start: path.join(appdata, "Microsoft", "Windows", "Start Menu", "Programs", "大肥鱼.lnk"),
  };
}

function countFiles(dir) {
  let out = 0;
  const walk = (d) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else out += 1;
    }
  };
  walk(dir);
  return out;
}

const secs = (ms) => (ms / 1000).toFixed(1) + " 秒";

(async () => {
  const installer = findInstaller(process.argv[2]);
  if (!installer || !fs.existsSync(installer)) {
    console.error("找不到安装包：" + (installer || "dist/大肥鱼-*-安装包.exe"));
    process.exit(2);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dafeiyu-install-"));
  // mkdtemp 已经建好目录；NSIS 允许装进空目录。
  console.log("[install] 安装包 " + installer);
  console.log("[install] 目标目录 " + dir);

  const sc = shortcuts();
  let installedExe = path.join(dir, pkg.build.productName + ".exe");

  // ---------- 1. 首次静默安装 ----------
  const t0 = Date.now();
  const inst = await runInstaller(installer, dir, INSTALL_TIMEOUT_MS);
  console.log("[install] 首次安装用时 " + secs(Date.now() - t0));
  check("静默安装退出码为 0", inst.code === 0, JSON.stringify(inst));
  const exeOk = await waitFor(() => fs.existsSync(installedExe), 60000);
  check("安装目录里有主程序", exeOk, installedExe);

  let firstFiles = 0;
  if (exeOk) {
    const asar = path.join(dir, "resources", "app.asar");
    check("resources/app.asar 存在", fs.existsSync(asar), "");

    firstFiles = countFiles(dir);
    // 文件数上下限一起守：下限防漏带资源，上限防又把测试夹具打进去。
    // 2026-11-14 起 site-packages 里的 test/tests 已被 extraResources.filter
    // 排除：旧包 12810 个文件，去掉 5647 个测试夹具后落在 7163 上下。
    check("安装文件数 ≥ 6500", firstFiles >= 6500, String(firstFiles));
    check("安装文件数 ≤ 8000（不带测试夹具）", firstFiles <= 8000, String(firstFiles));

    const logs = fs.readdirSync(dir).filter((f) => /\.log$/i.test(f));
    check("安装目录没有调试日志", logs.length === 0, logs.join(", "));

    check("桌面快捷方式已创建", fs.existsSync(sc.desktop), sc.desktop);
    check("开始菜单快捷方式已创建", fs.existsSync(sc.start), sc.start);

    // 真正启动一次安装版：干净 userData，确认首屏能起来、控制台没有错误。
    console.log("[install] 冒烟启动安装版…");
    const smoke = await run(process.execPath, [
      path.join(ROOT, "scripts", "smoke-electron.js"),
      "--exe", installedExe,
      "--user-data", path.join(ROOT, "_tmp", "install-user"),
      "--wait", "6000",
    ], 120000);
    // smoke 退出码 0 = 无错误；1 = 跑完但有错误；2 = 起不来
    check("安装版能启动且无 console 错误", smoke.code === 0, "smoke exit=" + smoke.code + tail(smoke.out));
  }

  // ---------- 2. 覆盖安装（用户升级时双击同一个安装包） ----------
  const uninstPath = path.join(dir, "Uninstall " + pkg.build.productName + ".exe");
  if (exeOk) {
    console.log("[install] 覆盖安装（对同一目录再跑一次 /S）…");
    const t1 = Date.now();
    const again = await runInstaller(installer, dir, INSTALL_TIMEOUT_MS);
    const ms = Date.now() - t1;
    console.log("[install] 覆盖安装用时 " + secs(ms));
    check("覆盖安装退出码为 0", again.code === 0, JSON.stringify(again));
    check("覆盖安装没有超时", !again.timeout, again.timeout ? "超时 " + secs(ms) : secs(ms));

    const stillThere = await waitFor(() => fs.existsSync(installedExe), 60000);
    check("覆盖安装后主程序仍在", stillThere, installedExe);
    check("覆盖安装后卸载器仍在", fs.existsSync(uninstPath), uninstPath);
    check("覆盖安装后桌面快捷方式仍在", fs.existsSync(sc.desktop), sc.desktop);
    check("覆盖安装后开始菜单快捷方式仍在", fs.existsSync(sc.start), sc.start);

    const secondFiles = countFiles(dir);
    check("覆盖安装后文件数不变（没有堆积残留）",
      secondFiles > 0 && Math.abs(secondFiles - firstFiles) <= 20,
      firstFiles + " → " + secondFiles);

    const smoke2 = await run(process.execPath, [
      path.join(ROOT, "scripts", "smoke-electron.js"),
      "--exe", installedExe,
      "--user-data", path.join(ROOT, "_tmp", "install-user2"),
      "--wait", "6000",
    ], 120000);
    check("覆盖安装后仍能启动且无 console 错误", smoke2.code === 0, "smoke exit=" + smoke2.code + tail(smoke2.out));
  }

  // ---------- 3. 卸载 ----------
  // NSIS 的卸载器会把自身复制到临时目录再继续，所以调用会立刻返回 0，
  // 真正的删除是异步的，而且删除顺序不保证：主程序先没、快捷方式后没。
  // 以前拿「主程序消失」当唯一完成信号，紧接着断言快捷方式 —— 磁盘忙的时候
  // 会得到两条假失败（实测 20 通过 2 失败，隔几秒再看两个 .lnk 早删干净了）。
  // 现在每个「要消失的东西」各自等，等不到才算失败。
  if (fs.existsSync(uninstPath)) {
    const t2 = Date.now();
    const u = await run(uninstPath, ["/S"], UNINSTALL_TIMEOUT_MS);
    check("静默卸载退出码为 0", u.code === 0, JSON.stringify(u));
    const gone = await waitFor(() => !fs.existsSync(installedExe), 120000);
    console.log("[install] 卸载完成用时 " + secs(Date.now() - t2));
    check("主程序已删除", gone, installedExe);
    const scGone = await waitFor(
      () => !fs.existsSync(sc.desktop) && !fs.existsSync(sc.start),
      30000
    );
    check("桌面快捷方式已删除", !fs.existsSync(sc.desktop), sc.desktop + (scGone ? "" : "（30 秒后仍在）"));
    check("开始菜单快捷方式已删除", !fs.existsSync(sc.start), sc.start + (scGone ? "" : "（30 秒后仍在）"));
  } else {
    check("找到卸载程序", false, uninstPath);
  }

  await sleep(800);
  const cl1 = await rmdirHard(dir);
  check("清理安装测试目录", cl1.gone || cl1.left === 0,
    cl1.gone ? "" : (dir + "（目录项还在，但里面已经空了）"));

  // ---------- 4. 中文路径（真实用户就是会把软件装进中文目录） ----------
  // 2026-11-15 实测过一个真问题：装到「中文 + 空格」的路径（例如
  // E:\Temp\大肥鱼 安装测试（中文 路径）\Program Files\大肥鱼 客户端）时，
  // NSIS 的 /D= 会在**第一个空格**处截断，安装器仍然返回 0，程序被静默装到
  // E:\Temp\大肥鱼 这种地方，而目标目录一直空着。换成纯 ASCII 含空格的路径
  // （E:\Temp\dfy space test\app dir）同样截断到 E:\Temp\dfy —— 所以是「空格」
  // 一个变量，不是中文。
  // 纯中文、不含空格则完全正常：7164 个文件、冒烟 exit=0、卸载干净。
  // 这一段守的就是后者；顺带盯住「父目录里有没有多出来的东西」，
  // 因为「装歪」的后果是往用户的别的目录里塞 1.9 GB。
  if (process.env.SKIP_CJK !== "1") {
    const cjkRoot = path.join(os.tmpdir(), "大肥鱼安装回归-" + Date.now().toString(36));
    const cjkDir = path.join(cjkRoot, "程序目录");
    fs.mkdirSync(cjkDir, { recursive: true });
    console.log("[install] 中文路径安装 " + cjkDir);
    const t3 = Date.now();
    const r3 = await runInstaller(installer, cjkDir, INSTALL_TIMEOUT_MS);
    console.log("[install] 中文路径安装用时 " + secs(Date.now() - t3));
    const cjkExe = path.join(cjkDir, pkg.build.productName + ".exe");
    const cjkOk = await waitFor(() => fs.existsSync(cjkExe), 60000);
    check("装进中文目录后主程序在目标路径", cjkOk, cjkExe);
    check("中文路径安装退出码为 0", r3.code === 0, JSON.stringify(r3));

    for (const nm of fs.readdirSync(cjkRoot)) {
      check("中文路径安装没有往父目录里塞东西", nm === "程序目录", nm);
    }

    if (cjkOk) {
      const n3 = countFiles(cjkDir);
      check("中文路径下的文件数与常规安装一致", Math.abs(n3 - firstFiles) <= 20,
        firstFiles + " → " + n3);
      const smoke3 = await run(process.execPath, [
        path.join(ROOT, "scripts", "smoke-electron.js"),
        "--exe", cjkExe,
        "--user-data", path.join(ROOT, "_tmp", "cjk-install-user"),
        "--wait", "6000",
      ], 180000);
      check("中文路径下安装版能启动且无 console 错误", smoke3.code === 0, "smoke exit=" + smoke3.code + tail(smoke3.out));

      const cjkUn = path.join(cjkDir, "Uninstall " + pkg.build.productName + ".exe");
      const u3 = await run(cjkUn, ["/S"], UNINSTALL_TIMEOUT_MS);
      const gone3 = await waitFor(() => !fs.existsSync(cjkExe), 120000);
      check("中文路径静默卸载退出码为 0", u3.code === 0, JSON.stringify(u3));
      check("中文路径卸载后主程序已删除", gone3, cjkExe);
      const rest3 = countFiles(cjkDir);
      check("中文路径卸载后没有留下文件", rest3 === 0, String(rest3));
    }

    await sleep(600);
    const cl2 = await rmdirHard(cjkRoot);
    check("清理中文路径测试目录", cl2.gone || cl2.left === 0,
      cl2.gone ? "" : (cjkRoot + "（目录项还在，但里面已经空了；剩 " + cl2.left + " 个文件）"));
  }

  console.log("\n结果：" + pass + " 通过，" + fail + " 失败");
  if (fail) {
    // 失败要留证据：这台机器上出现过一次 24/2，当时控制台只剩最后几行，
    // 查不出是哪两条，只能等下次。现在失败即落报告。
    const rep = path.join(ROOT, "_tmp", "install-report.json");
    try {
      fs.mkdirSync(path.dirname(rep), { recursive: true });
      fs.writeFileSync(rep, JSON.stringify({
        at: new Date().toISOString(),
      retriedRun: FAILS.some((f) => /异常退出/.test(String(f.detail || ""))) || HAD_CRASH,
        installer: installer,
        pass, fail, fails: FAILS, all: NOTE,
      }, null, 2), "utf8");
      console.log("失败报告已写到 " + rep);
    } catch (e) {
      console.log("（失败报告没写出去：" + String(e && e.message || e) + "）");
    }
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e && e.stack || e);
  process.exit(2);
});
