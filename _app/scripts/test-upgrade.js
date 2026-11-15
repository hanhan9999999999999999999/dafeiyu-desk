// 升级不丢用户数据回归（2026-11-15）
//
// 为什么单独一个脚本：用户装新版本时最怕的两件事，一样都没人验过 ——
//   1. 升级之后设置被重置（音量、分辨率、首次引导标记全回到默认）；
//   2. 卸载/安装顺手把 %APPDATA%\dafeiyu-desk 里的东西动了。
// test-install.js 只数文件个数与快捷方式，答不了这两句。
//
// 做法：装到临时目录 → 用隔离的 userData 起一次，让程序自己写出 settings.json →
// 手动改几项当「用户调过的设置」，再塞模型文件、聊天记录、面板位置 →
// 覆盖安装 → 再起一次 → 逐项核对还在不在 → 卸载 → 核对真实
// %APPDATA%\dafeiyu-desk 一个字节没被动过 → 注册表与快捷方式没有残留。
//
// 不碰真实用户数据：所有写入都在 userData 隔离目录里，真实 AppData 只做前后快照比对。
// 用法：node scripts/test-upgrade.js [安装包路径] [--keep]
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const pkg = require(path.join(ROOT, "package.json"));
const PRODUCT = pkg.build.productName;
const KEEP = process.argv.includes("--keep");

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log("✅ " + name + (detail ? "  " + detail : "")); }
  else { fail++; console.log("❌ " + name + (detail ? "  → " + detail : "")); }
};

const INSTALL_TIMEOUT_MS = 600000;
const UNINSTALL_TIMEOUT_MS = 300000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secs = (ms) => (ms / 1000).toFixed(1) + " 秒";

function findInstaller(arg) {
  if (arg && !arg.startsWith("--")) return path.resolve(arg);
  const dist = path.join(ROOT, "dist");
  const cands = fs.readdirSync(dist)
    .filter((f) => /^大肥鱼-.*-安装包\.exe$/.test(f))
    .map((f) => path.join(dist, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return cands[0];
}

function run(exe, args, timeoutMs, extra) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(exe, args, Object.assign({ windowsHide: true, stdio: "ignore" }, extra || {}));
    const timer = setTimeout(() => { try { p.kill(); } catch (e) { } resolve({ code: -1, timeout: true, ms: Date.now() - t0 }); }, timeoutMs);
    p.on("exit", (code) => { clearTimeout(timer); resolve({ code, ms: Date.now() - t0 }); });
    p.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, error: String(e.message || e), ms: Date.now() - t0 }); });
  });
}

const runInstaller = (installer, dir, timeoutMs) =>
  run(installer, ["/S", "/D=" + dir], timeoutMs, { windowsVerbatimArguments: true });

async function waitFor(fn, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(400);
  }
  return false;
}

// 目录快照：相对路径 → 字节数。内容变了（或文件被删/被加）都会让快照不同。
function snapshot(dir) {
  const out = {};
  const walk = (d, rel) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      const r = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) { out[r + "/"] = -1; walk(p, r); }
      else { try { out[r] = fs.statSync(p).size; } catch (err) { out[r] = -2; } }
    }
  };
  walk(dir, "");
  return out;
}

function diffSnap(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out = [];
  for (const k of keys) {
    if (a[k] !== b[k]) out.push(k + "（" + (a[k] === undefined ? "新增" : a[k]) + " → " + (b[k] === undefined ? "删除" : b[k]) + "）");
  }
  return out;
}

const sha = (p) => {
  try { return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").slice(0, 16); }
  catch (e) { return ""; }
};

function regQuery(key, extra) {
  try {
    // 键不存在时 reg.exe 会往 stderr 吐一句中文错误，PowerShell 会把它当
    // NativeCommandError 打出来、还带一屏位置信息。这里把 stderr 丢掉，
    // 只靠退出码判断「有没有」——查不到本来就是预期结果之一。
    const out = execFileSync("reg", ["query", key].concat(extra || []),
      { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    return { found: true, out };
  } catch (e) {
    return { found: false, out: String(e.stdout || "") };
  }
}

(async () => {
  const installer = findInstaller(process.argv[2]);
  if (!installer || !fs.existsSync(installer)) {
    console.error("找不到安装包：" + (installer || "dist/大肥鱼-*-安装包.exe"));
    process.exit(2);
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dafeiyu-upgrade-"));
  const U = path.join(ROOT, "_tmp", "upgrade-user");
  const installedExe = path.join(dir, PRODUCT + ".exe");
  const realUd = path.join(process.env.APPDATA || "", "dafeiyu-desk");

  console.log("[upgrade] 安装包 " + installer);
  console.log("[upgrade] 安装目录 " + dir);
  console.log("[upgrade] 隔离配置 " + U);

  // ---------- 0. 真实用户目录先拍快照 ----------
  const realBefore = fs.existsSync(realUd) ? snapshot(realUd) : null;
  const realSettingsSha = sha(path.join(realUd, "settings.json"));
  check("真实 %APPDATA%\\dafeiyu-desk 拍到了快照（" + (realBefore ? Object.keys(realBefore).length + " 项" : "目录不存在，跳过比对") + "）", true);

  // 隔离目录先清空：上一轮残留会让「设置还在」变成假绿。
  try { fs.rmSync(U, { recursive: true, force: true }); } catch (e) { }

  // ---------- 1. 安装 ----------
  const t0 = Date.now();
  const inst = await runInstaller(installer, dir, INSTALL_TIMEOUT_MS);
  console.log("[upgrade] 安装用时 " + secs(Date.now() - t0));
  check("静默安装退出码为 0", inst.code === 0, JSON.stringify(inst));
  const exeOk = await waitFor(() => fs.existsSync(installedExe), 60000);
  check("安装目录里有主程序", exeOk, installedExe);
  if (!exeOk) {
    console.log("[upgrade] 装不上，后面没法继续");
    process.exit(1);
  }

  // ---------- 2. 第一次启动，让程序自己写出 settings.json ----------
  console.log("[upgrade] 第一次启动（隔离配置）…");
  const s1 = await run(process.execPath, [
    path.join(ROOT, "scripts", "smoke-electron.js"),
    "--exe", installedExe, "--user-data", U, "--wait", "6000",
  ], 120000);
  check("升级前那次启动无 console 错误", s1.code === 0, "smoke exit=" + s1.code);

  const settingsPath = path.join(U, "settings.json");
  check("程序在隔离目录里写出了 settings.json", fs.existsSync(settingsPath), settingsPath);

  // ---------- 3. 造用户数据：改设置 + 放模型 + 聊天记录 + 面板位置 ----------
  let base = {};
  try { base = JSON.parse(fs.readFileSync(settingsPath, "utf8")); } catch (e) { }
  const mine = Object.assign({}, base, {
    version: 2,
    firstRun: false,
    volume: 0.42,
    resolution: 1,
    muted: true,
    petPanelOpen: true,
    activePack: "",           // 不指模型，避免启动时走「缺模型」分支改变行为
    cacheDir: "",
  });
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(mine, null, 2), "utf8");

  const packDir = path.join(U, "models", "mypack");
  fs.mkdirSync(packDir, { recursive: true });
  fs.writeFileSync(path.join(packDir, "pet.json"), JSON.stringify({ id: "mypack", name: "升级前导入的包" }), "utf8");
  // 故意不放 .model3.json：放了这个目录就会被模型库当成一个包，启动时去加载一个
  // 字段不全的 model3，三重降级之后仍然失败、console 三行 error —— 那验的就不是
  // 「设置有没有被保留」，而是「畸形包怎么报错」。这里只要验证文件本体还在。
  fs.writeFileSync(path.join(packDir, "tex00.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const chatPath = path.join(U, "chatlog.json");
  const chatBody = { items: [{ id: "up-1", at: 1763000000000, who: "user", text: "升级前说的话" }] };
  fs.writeFileSync(chatPath, JSON.stringify(chatBody), "utf8");

  const panelPath = path.join(U, "petpanel-pos.json");
  fs.writeFileSync(panelPath, JSON.stringify({ x: 111, y: 222 }), "utf8");

  const uBefore = snapshot(U);
  check("造好了用户数据（设置 / 模型 / 聊天记录 / 面板位置）", true,
    "volume=0.42 resolution=1 muted=true，model=" + fs.existsSync(path.join(packDir, "pet.json")));

  // ---------- 4. 覆盖安装（这就是用户升级时做的事） ----------
  console.log("[upgrade] 覆盖安装…");
  const t1 = Date.now();
  const again = await runInstaller(installer, dir, INSTALL_TIMEOUT_MS);
  console.log("[upgrade] 覆盖安装用时 " + secs(Date.now() - t1));
  check("覆盖安装退出码为 0（没有卡死）", again.code === 0 && !again.timeout, JSON.stringify(again));
  check("覆盖安装后主程序还在", fs.existsSync(installedExe), installedExe);
  check("覆盖安装后卸载器还在", fs.existsSync(path.join(dir, "Uninstall " + PRODUCT + ".exe")), "");

  // ---------- 5. 第二次启动：设置该原样还在 ----------
  console.log("[upgrade] 升级后启动…");
  const s2 = await run(process.execPath, [
    path.join(ROOT, "scripts", "smoke-electron.js"),
    "--exe", installedExe, "--user-data", U, "--wait", "6000",
  ], 120000);
  check("升级后能启动且无 console 错误", s2.code === 0, "smoke exit=" + s2.code);

  let after = {};
  let afterOk = false;
  let afterErr = "";
  try { after = JSON.parse(fs.readFileSync(settingsPath, "utf8")); afterOk = true; } catch (e) { afterErr = String(e && e.message || e); }
  check("升级后 settings.json 仍是合法 JSON", afterOk, afterOk ? "" : afterErr);
  check("升级后音量还是用户设的 0.42", after.volume === 0.42, String(after.volume));
  check("升级后分辨率还是用户设的 1", after.resolution === 1, String(after.resolution));
  check("升级后静音状态还在（muted=true）", after.muted === true, String(after.muted));
  check("升级后「首次引导已完成」没被重置", after.firstRun === false, String(after.firstRun));

  check("升级前导入的模型包还在", fs.existsSync(path.join(packDir, "pet.json")), packDir);
  let chat = "";
  try { chat = fs.readFileSync(chatPath, "utf8"); } catch (e) { }
  check("升级前的聊天记录还在", chat.includes("升级前说的话"), chat ? chat.slice(0, 60) : "文件不见了");
  let panel = {};
  try { panel = JSON.parse(fs.readFileSync(panelPath, "utf8")); } catch (e) { }
  check("升级后面板位置还在（x=111 y=222）", panel.x === 111 && panel.y === 222, JSON.stringify(panel));

  // 程序启动会往 userData 里写缓存与日志，所以只比对「我们造的那几样」，不比整个目录。
  const uAfter = snapshot(U);
  const lost = ["settings.json", "chatlog.json", "petpanel-pos.json", "models/mypack/pet.json"]
    .filter((k) => uBefore[k] !== undefined && uAfter[k] === undefined);
  check("升级过程中没有文件被删掉", lost.length === 0, lost.join(", "));

  // ---------- 6. 卸载 ----------
  const uninst = path.join(dir, "Uninstall " + PRODUCT + ".exe");
  console.log("[upgrade] 静默卸载…");
  const un = await run(uninst, ["/S"], UNINSTALL_TIMEOUT_MS);
  check("静默卸载退出码为 0", un.code === 0, JSON.stringify(un));
  const gone = await waitFor(() => !fs.existsSync(installedExe), 120000);
  check("卸载后主程序已删除", gone, installedExe);

  // ---------- 7. 卸载不碰用户数据 ----------
  check("卸载后隔离配置目录还在（卸载不删用户数据）", fs.existsSync(settingsPath), settingsPath);
  let stillThere = false;
  try {
    const s = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    stillThere = s.volume === 0.42;
  } catch (e) { }
  check("卸载后设置值仍在（volume 还是 0.42）", stillThere, "");

  if (realBefore) {
    const realAfter = snapshot(realUd);
    const d = diffSnap(realBefore, realAfter);
    check("真实 %APPDATA%\\dafeiyu-desk 前后一致（安装与卸载都没碰它）", d.length === 0,
      d.length ? d.slice(0, 4).join("；") : Object.keys(realBefore).length + " 项一致");
    check("真实 settings.json 内容没被改写", sha(path.join(realUd, "settings.json")) === realSettingsSha, "");
  } else {
    check("真实用户目录原本不存在，跳过一致性比对", true, "");
  }

  // ---------- 8. 注册表与快捷方式 ----------
  // NSIS 的卸载是异步的：`Uninstall.exe /S` 立刻返回 0，真正的删除在后台继续。
  // 实测主程序 3–5 秒消失、快捷方式再晚几百毫秒、Uninstall 注册表项又更晚一点，
  // 这里统一轮询，别拿「命令返回」当「删完了」。
  const uninstGone = await waitFor(
    () => !regQuery("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall", ["/s", "/f", PRODUCT]).found,
    30000);
  check("注册表里没有残留的卸载项", uninstGone, uninstGone ? "" : "等 30 秒后仍有 " + PRODUCT + " 相关项");
  const runGone = await waitFor(
    () => !regQuery("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", ["/v", PRODUCT]).found,
    10000);
  check("注册表启动项里没有残留的大肥鱼", runGone, runGone ? "" : "Run 里还有 " + PRODUCT);

  const home = process.env.USERPROFILE || "";
  const scDesktop = path.join(home, "Desktop", PRODUCT + ".lnk");
  const scStart = path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", PRODUCT + ".lnk");
  const scGone = await waitFor(() => !fs.existsSync(scDesktop) && !fs.existsSync(scStart), 30000);
  check("卸载后两个快捷方式都没了", scGone,
    [fs.existsSync(scDesktop) ? "桌面还在" : "", fs.existsSync(scStart) ? "开始菜单还在" : ""].filter(Boolean).join("，"));

  // ---------- 9. 清理 ----------
  if (!KEEP) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
    try { fs.rmSync(U, { recursive: true, force: true }); } catch (e) { }
    check("清理安装目录与隔离配置", !fs.existsSync(dir) && !fs.existsSync(U), "");
  } else {
    console.log("[upgrade] --keep：保留 " + dir + " 与 " + U);
  }

  console.log("");
  console.log("结果：" + pass + " 通过，" + fail + " 失败");
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("[upgrade] 异常：" + (e && e.stack || e));
  process.exit(2);
});
