"use strict";
// 诊断包真机验收：起一个隔离实例（窗口透明不上屏），走 IPC 让它把诊断包直接写进临时目录，
// 然后逐项检查文件是否齐全、内容是否有用。
//
// 为什么必须真机跑：诊断包要读 userData 里的 boot-timing.txt / last-boot.txt / crash/，
// 还要读真实的显示器信息，静态检查一概验不出来。
//
// 用法：node scripts/test-diag.js [--keep] [--port 9281]
// 退出码：0 全过 / 1 有不符合项 / 2 起不来
const fs = require("node:fs");
const { makeTmp } = require("./lib/tmp");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { listTargets, sampleFrom } = require("./lib/cdp");

const APP = path.resolve(__dirname, "..");
const ROOT = path.resolve(APP, "..");
const EXE = path.join(APP, "runtime", "electron.exe");
const PORT = Number((process.argv.includes("--port") && process.argv[process.argv.indexOf("--port") + 1]) || 9281);
const KEEP = process.argv.includes("--keep");
const WAIT_MS = 25000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
function add(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail });
  console.log((ok ? "  ✅ " : "  ❌ ") + name + (detail ? "  " + detail : ""));
}

async function waitTarget(ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const list = await listTargets(PORT).catch(() => []);
    const hit = list.find((t) => t.type === "page" && /index\.html/i.test(t.url || ""));
    if (hit) return hit;
    await sleep(300);
  }
  return null;
}

(async () => {
  const ud = makeTmp("dfy-diag-");
  const out = path.join(ud, "包");
  const env = Object.assign({}, process.env, { FISH_MULTI: "1", FISH_TEST_HIDDEN: "1" });
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CHROME_CRASHPAD_PIPE_NAME;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;

  console.log("[diag] 启动隔离实例（窗口透明，不上屏）");
  const child = spawn(EXE, ["--remote-debugging-port=" + PORT, "--user-data-dir=" + ud, "."], {
    cwd: APP, env, stdio: "ignore", windowsHide: true,
  });

  const kill = () => {
    try { require("node:child_process").execSync("taskkill /PID " + child.pid + " /T /F", { stdio: "ignore" }); } catch (e) { }
  };

  try {
    const t = await waitTarget(WAIT_MS);
    if (!t) { console.log("[diag] 连不上调试端口 " + PORT); process.exit(2); }
    // 等模型/首帧稳一下：诊断包会读 boot-timing.txt，那是 did-finish-load 之后才写的
    await sleep(4000);

    const probe = "JSON.stringify((function(){return {has:typeof (window.deskfish||{}).diagExportTo}})())";
    // 注意：lib/cdp 的 evalOn 已经把 JSON 解过一次了，这里拿到的是对象，别再 JSON.parse
    const r1 = await sampleFrom(PORT, (x) => x && x.type === "page" && x.webSocketDebuggerUrl, probe, 8000);
    const hasTo = r1 && r1.has;
    add("隔离实例里存在不弹框的导出通道", hasTo === "function", "typeof = " + hasTo);

    const r2 = await sampleFrom(PORT, (x) => x && x.type === "page" && x.webSocketDebuggerUrl,
      "window.deskfish.diagExportTo(" + JSON.stringify(out) + ").then(function(r){return JSON.stringify(r)}).catch(function(e){return JSON.stringify({err:String(e)})})", 25000);
    const res = r2 && typeof r2 === "object" ? r2 : null;
    add("导出接口返回 ok", !!(res && res.ok), JSON.stringify(res && { ok: res.ok, files: (res.files || []).length, error: res.error }));

    const files = res && res.files ? res.files : [];
    const has = (n) => files.includes(n) && fs.existsSync(path.join(out, n));
    add("有系统信息.txt", has("系统信息.txt"), files.join(" / "));
    add("有运行日志.log（哪怕只有几行）", has("运行日志.log"));
    add("有设置.json", has("设置.json"));
    add("有显示器.txt（换屏/跑到屏幕外全靠它）", has("显示器.txt"));
    add("有 boot-timing.txt（启动慢靠它分段）", has("boot-timing.txt"));
    add("有 last-boot.txt（上次怎么起来的）", has("last-boot.txt"));

    const rd = (n) => { try { return fs.readFileSync(path.join(out, n), "utf8"); } catch (e) { return ""; } };
    const sys = rd("系统信息.txt");
    add("系统信息里写了版本与运行形态", /版本: \d+\.\d+\.\d+/.test(sys) && /运行形态: /.test(sys));
    add("系统信息里写了 Electron / Chromium 版本", /Electron: /.test(sys) && /Chromium: /.test(sys));

    const dsp = rd("显示器.txt");
    add("显示器.txt 写了屏数与缩放比例", /共 \d+ 块屏/.test(dsp) && /缩放 \d+%/.test(dsp), dsp.split("\n")[1] || "");
    add("显示器.txt 写了窗口现在在哪块屏", /她现在在哪: 屏\d/.test(dsp), (dsp.match(/她现在在哪: .*/) || [""])[0]);

    const boot = rd("boot-timing.txt");
    add("boot-timing.txt 三段齐（ready / server / window）",
      /ready=\d+ms/.test(boot) && /server=\d+ms/.test(boot) && /window=\d+ms/.test(boot), boot.trim().slice(0, 90));

    const cfg = rd("设置.json");
    let parsed = null;
    try { parsed = JSON.parse(cfg); } catch (e) { }
    add("设置.json 是合法 JSON", !!parsed);
    add("设置.json 里没有密钥类字段泄漏",
      !/sk-[A-Za-z0-9]{16,}|apiKey"\s*:\s*"[^"]{20,}|token"\s*:\s*"[^"]{20,}/i.test(cfg));

    const failed = checks.filter((c) => !c.ok);
    console.log("\n结果：" + (checks.length - failed.length) + " 通过，" + failed.length + " 失败");
    process.exitCode = failed.length ? 1 : 0;
  } catch (e) {
    console.log("[diag] 出错：" + ((e && e.message) || e));
    process.exitCode = 2;
  } finally {
    kill();
    await sleep(600);
    if (!KEEP) { try { fs.rmSync(ud, { recursive: true, force: true }); } catch (e) { } }
    else { console.log("[diag] 保留目录 " + ud); }
  }
})();
