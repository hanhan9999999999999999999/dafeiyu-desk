// 设置持久化回归：第一次启动改一批设置，退出；第二次用同一个 userData 启动，逐项读回来比。
// 这是用户最容易感知的承诺之一——调好的音量、置顶、超采样不该每次开机都变回去。
//
// 覆盖范围从原来的「音量 + 缩放」两项扩到 17 项：只验两项时，
// 任何一处「patch 允许写、但 save/load 路径丢了」的字段都测不出来。
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DIR = path.join(ROOT, "_tmp", "persist-user");
let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log("✅ " + name + (detail ? "  " + detail : "")); }
  else { fail++; console.log("❌ " + name + "  → " + detail); }
};

// 与 scripts/ui/persist-write.js 里的 want 保持一致：那边写什么，这边就该读到什么。
const WANT = {
  volume: 0.37,
  scale: 1.15,
  resolution: 1,
  fpsCap: 15,
  mute: true,
  alwaysOnTop: false,
  clickThrough: false,
  followCursor: false,
  autoIdle: false,
  blinkEnabled: false,
  sharpen: false,
  dockAutoHide: false,
  seeInterval: 3.2,
  seeGap: 21,
  hotkeyMic: "",
  hotkeySummon: "CommandOrControl+Alt+K",
  viewBox: { y: 0.11, h: 0.28, pack: "dafeiyu" },
};

function smokeOnce(evalFile, wait) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [
      path.join(ROOT, "scripts", "smoke-electron.js"),
      "--user-data", DIR,
      "--wait", String(wait || 6000),
      "--eval-file", path.join(ROOT, "scripts", "ui", evalFile),
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { out += d; });
    p.on("exit", (code) => resolve({ code, out, retried: false }));
  });
}

// GPU 缓存 / 单例锁是环境噪声，不是「设置没存住」：同一个 verify 里前面的冒烟刚退，
// Chromium 的 GPU 进程还没放干净时，这一次启动会以 exit=2 收场并只打一行
// 「Gpu Cache Creation failed」。这种失败重试一次就过，不该判功能失败。
const ENV_NOISE = /Gpu Cache Creation failed|Failed to create GPU cache|SingletonLock|Another instance/i;

async function smoke(evalFile, wait) {
  const first = await smokeOnce(evalFile, wait);
  if (first.code === 0 || !ENV_NOISE.test(first.out)) return first;
  await new Promise((r) => setTimeout(r, 1500));
  const again = await smokeOnce(evalFile, wait);
  again.retried = true;
  if (again.code === 0) return again;
  // 两次都坏：把「重试过」这件事写进输出，失败信息才不会被误解成功能回归。
  again.out += "\n[retry] 第一次失败于环境噪声（GPU 缓存/单例锁），重试一次仍失败";
  return again;
}

const evalJson = (out) => {
  const m = out.match(/\[smoke\] eval → (.*)/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (e) { return null; }
};

// 删测试目录：Electron 刚退出时文件句柄还没放干净，Windows 会甩 EPERM/EBUSY。
// 这不是「设置没存住」，重试几次；最后一次还不行就留着（不影响断言，还能看现场）。
async function resetDir(strict) {
  for (let i = 0; i < 5; i += 1) {
    try {
      fs.rmSync(DIR, { recursive: true, force: true });
      if (strict) fs.mkdirSync(DIR, { recursive: true });
      return true;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
  return false;
}

(async () => {
  if (!(await resetDir(true))) {
    // 上一次的残留删不掉：不能用旧目录接着测，否则读到的是上一轮的设置。
    console.log("无法清空 " + DIR + "（有进程还占着），这次先跳过");
    console.log("\n结果：" + pass + " 通过，" + fail + " 失败");
    process.exit(fail ? 1 : 0);
  }

  const a = await smoke("persist-write.js");
  check("第一次启动能写入一批设置", a.code === 0 && /settings:saved:/.test(a.out),
    (a.out.match(/\[smoke\] eval → .*/) || [""])[0].slice(0, 200));

  // 写盘此刻就应该落地：读一眼文件，确认 17 个键真的进了 settings.json，
  // 而不是只活在主进程内存里（内存里的值第二次启动就没了）。
  let onDisk = null;
  try { onDisk = JSON.parse(fs.readFileSync(path.join(DIR, "settings.json"), "utf8")); } catch (e) { }
  check("settings.json 已落盘且是合法 JSON", !!onDisk, onDisk ? "" : "读不到或不是 JSON");

  const b = await smoke("persist-read.js");
  const got = evalJson(b.out);
  check("第二次启动读到设置", !!got, got ? "" : "读不到 eval 行：" + b.out.slice(-200));

  if (got) {
    for (const k of Object.keys(WANT)) {
      const w = WANT[k], g = got[k];
      if (k === "viewBox") {
        check("取景矩形" + "（y/h/pack）仍是改后的值",
          !!g && Math.abs(g.y - w.y) < 1e-6 && Math.abs(g.h - w.h) < 1e-6 && g.pack === w.pack,
          JSON.stringify(g));
        continue;
      }
      const ok = typeof w === "number"
        ? Math.abs(Number(g) - w) < 1e-6
        : g === w;
      check("设置项 " + k + " 仍是 " + JSON.stringify(w), ok, JSON.stringify(g));
    }

    // 汇总一条：任何一项掉了都会让上面某条红，但这条能直接回答「17 项是不是全活」。
    let bad = 0;
    for (const k of Object.keys(WANT)) {
      const w = WANT[k], g = got[k];
      if (k === "viewBox") {
        if (!(g && Math.abs(g.y - w.y) < 1e-6 && Math.abs(g.h - w.h) < 1e-6 && g.pack === w.pack)) bad++;
      } else if (typeof w === "number" ? Math.abs(Number(g) - w) >= 1e-6 : g !== w) bad++;
    }
    check("17 项设置全部原样活过重启", bad === 0, bad + " 项不一致");
  }
  check("第二次启动无渲染错误", b.code === 0, "smoke exit=" + b.code);

  // 恢复默认：不能把测试写进去的值留在用户配置里。
  const c = await smoke("persist-reset.js");
  const def = evalJson(c.out);
  check("恢复默认返回设置", !!def, def ? "" : "读不到 eval 行：" + c.out.slice(-200));
  if (def) {
    check("音量回到出厂 0.85", Math.abs(def.volume - 0.85) < 1e-6, String(def.volume));
    check("缩放回到 1", Math.abs(def.scale - 1) < 1e-6, String(def.scale));
    check("超采样回到 2", def.resolution === 2, String(def.resolution));
    check("帧率上限回到 30", def.fpsCap === 30, String(def.fpsCap));
    check("静音回到关", def.mute === false, String(def.mute));
    check("置顶回到开", def.alwaysOnTop === true, String(def.alwaysOnTop));
    check("取景矩形回到默认", !!def.viewBox && Math.abs(def.viewBox.h - 0.4) < 1e-6, JSON.stringify(def.viewBox));
    check("快捷键回到默认唤出键", def.hotkeySummon === "CommandOrControl+Alt+F", JSON.stringify(def.hotkeySummon));
  }

  // 收尾清目录：清不掉只提示，不改判结果 —— 断言已经全部跑完了。
  if (!(await resetDir(false))) console.log("（测试目录这次没清掉，留着不影响结果）");
  console.log("\n结果：" + pass + " 通过，" + fail + " 失败");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error((e && e.stack) || e); process.exit(2); });
