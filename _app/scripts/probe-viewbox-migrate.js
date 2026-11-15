"use strict";
// round 29 真机探针：旧版取景（settings.viewBox 带 pack 标记）在启动后会不会搬进模型
// 三种情况：
//   A 有 pack 标记、包可写       → 搬进 PACK.layout 并清掉 settings.viewBox
//   B 有 pack 标记、包不存在     → 原样留着（不猜）
//   C 没有 pack 标记             → 原样留着（不猜）
const { spawn } = require("child_process");
const fs = require("fs");
const { makeTmp } = require("./lib/tmp");
const os = require("os");
const path = require("path");
const { sampleFrom } = require("./lib/cdp");

const APP = path.resolve(__dirname, "..");
const EXE = path.join(APP, "runtime", "electron.exe");
const PORT = 9321;
const PASS = [];
const FAIL = [];

function ok(n, extra) { PASS.push(n); console.log("✅ " + n + (extra ? "  " + extra : "")); }
function bad(n, extra) { FAIL.push(n); console.log("❌ " + n + (extra ? "  " + extra : "")); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cleanEnv(extra) {
  const env = Object.assign({}, process.env, extra || {});
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CHROME_CRASHPAD_PIPE_NAME;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  return env;
}

function start(ud, port) {
  const args = ["--user-data-dir=" + ud];
  if (port) args.push("--remote-debugging-port=" + port);
  args.push(".");
  const cp = spawn(EXE, args, {
    cwd: APP,
    env: cleanEnv({ FISH_MULTI: "1", FISH_TEST_HIDDEN: "1" }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  cp.stdout.on("data", () => { });
  cp.stderr.on("data", () => { });
  return cp;
}

function kill(cp) {
  try { cp.kill(); } catch (e) { }
  try { require("child_process").execFileSync("taskkill", ["/PID", String(cp.pid), "/T", "/F"], { stdio: "ignore" }); } catch (e) { }
}

async function waitPage(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await sampleFrom(PORT, (x) => x && x.type === "page" && /\/src\/index\.html/.test(x.url), "1", 4000);
      if (r !== undefined) return true;
    } catch (e) { }
    await sleep(300);
  }
  return false;
}

// 造一个「可写的用户包」：pet.json + 最小 model3（不加载，只要能 open）
function makePack(userDir, id) {
  const d = path.join(userDir, "models", id);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, id + ".model3.json"), JSON.stringify({ Version: 3, FileReferences: { Moc: id + ".moc3", Textures: [] } }), "utf8");
  fs.writeFileSync(path.join(d, id + ".moc3"), Buffer.alloc(64));
  fs.writeFileSync(path.join(d, "pet.json"), JSON.stringify({ id, displayName: id, live2d: { model: id + ".model3.json" } }, null, 2), "utf8");
  return d;
}

(async () => {
  const ud = makeTmp("dfy-viewbox-");
  makePack(ud, "legacypack");

  // A：settings 里放一份属于 legacypack 的旧取景
  fs.writeFileSync(path.join(ud, "settings.json"), JSON.stringify({
    version: 2, firstRun: false, activePack: "legacypack",
    viewBox: { y: 0.12, h: 0.33, pack: "legacypack" },
  }, null, 2), "utf8");

  let cp = start(ud, PORT);
  const up = await waitPage(30000);
  if (!up) { bad("A 段窗口起来了"); kill(cp); }
  else {
    ok("A 段窗口起来了");
    await sleep(4500);   // 迁移是启动后 2500ms 触发

    const st = JSON.parse(fs.readFileSync(path.join(ud, "settings.json"), "utf8"));
    const vb = st.viewBox || {};
    if (!vb.pack) ok("A 搬完之后 settings.viewBox 不再标着那个模型"); else bad("A 搬完之后 settings.viewBox 不再标着那个模型", JSON.stringify(vb));

    const pet = path.join(ud, "models", "legacypack", "pet.json");
    const mf = JSON.parse(fs.readFileSync(pet, "utf8"));
    const L = (mf.live2d && mf.live2d.layout) || {};
    if (Math.abs(Number(L.viewY) - 0.12) < 1e-6 && Math.abs(Number(L.viewH) - 0.33) < 1e-6)
      ok("A 旧取景搬进了模型自己的 layout", JSON.stringify({ viewY: L.viewY, viewH: L.viewH }));
    else bad("A 旧取景搬进了模型自己的 layout", JSON.stringify(L));

    const logTxt = (() => { try { return fs.readFileSync(path.join(ud, "run.log"), "utf8"); } catch (e) { return ""; } })();
    if (logTxt.indexOf("旧取景已搬进模型") >= 0) ok("A 迁移留了日志"); else bad("A 迁移留了日志");
    if (logTxt.indexOf("搬旧取景时出错") < 0) ok("A 迁移过程没报错"); else bad("A 迁移过程没报错");
  }
  kill(cp);
  await sleep(800);

  // 再启一次：已搬过，不该重复搬、也不该报错
  cp = start(ud, PORT);
  const up2 = await waitPage(30000);
  if (!up2) bad("A2 第二次启动");
  else {
    await sleep(4000);
    const mf2 = JSON.parse(fs.readFileSync(path.join(ud, "models", "legacypack", "pet.json"), "utf8"));
    const L2 = (mf2.live2d && mf2.live2d.layout) || {};
    if (Math.abs(Number(L2.viewY) - 0.12) < 1e-6) ok("A2 再启动一次不会被改回默认"); else bad("A2 再启动一次不会被改回默认", JSON.stringify(L2));
  }
  kill(cp);
  await sleep(800);

  // B：标着一个已经不存在的模型 → 原样留着
  fs.writeFileSync(path.join(ud, "settings.json"), JSON.stringify({
    version: 2, firstRun: false, activePack: "legacypack",
    viewBox: { y: 0.2, h: 0.28, pack: "ghostpack" },
  }, null, 2), "utf8");
  cp = start(ud, PORT);
  const up3 = await waitPage(30000);
  if (!up3) bad("B 段窗口起来了");
  else {
    await sleep(4000);
    const st3 = JSON.parse(fs.readFileSync(path.join(ud, "settings.json"), "utf8"));
    const vb3 = st3.viewBox || {};
    if (vb3.pack === "ghostpack" && Math.abs(Number(vb3.h) - 0.28) < 1e-6) ok("B 包不在时旧取景原样留着（不猜）", JSON.stringify(vb3));
    else bad("B 包不在时旧取景原样留着（不猜）", JSON.stringify(vb3));
    const lg = (() => { try { return fs.readFileSync(path.join(ud, "run.log"), "utf8"); } catch (e) { return ""; } })();
    if (lg.indexOf("但这个模型已经不在") >= 0) ok("B 说明了为什么没搬"); else bad("B 说明了为什么没搬");
  }
  kill(cp);
  await sleep(800);

  // C：没有 pack 标记 → 原样留着
  fs.writeFileSync(path.join(ud, "settings.json"), JSON.stringify({
    version: 2, firstRun: false, activePack: "legacypack",
    viewBox: { y: 0.3, h: 0.2 },
  }, null, 2), "utf8");
  cp = start(ud, PORT);
  const up4 = await waitPage(30000);
  if (!up4) bad("C 段窗口起来了");
  else {
    await sleep(4000);
    const st4 = JSON.parse(fs.readFileSync(path.join(ud, "settings.json"), "utf8"));
    const vb4 = st4.viewBox || {};
    if (Math.abs(Number(vb4.h) - 0.2) < 1e-6 && !vb4.pack) ok("C 没有模型标记时原样留着（不猜）", JSON.stringify(vb4));
    else bad("C 没有模型标记时原样留着（不猜）", JSON.stringify(vb4));
  }
  kill(cp);
  await sleep(600);

  try { fs.rmSync(ud, { recursive: true, force: true }); } catch (e) { }

  console.log("\n结果：" + PASS.length + " 通过，" + FAIL.length + " 失败");
  process.exit(FAIL.length ? 1 : 0);
})().catch((e) => {
  console.error("探针自身出错：" + (e && e.stack ? e.stack : e));
  process.exit(2);
});
