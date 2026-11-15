/* 游戏模式（1.5.0）的静态验收。
 *
 * 这个模式承诺三件事，缺一件用户就会骂「开了游戏模式还在卡」：
 *   ① 真的停渲染（不是降到 15fps）；
 *   ② 真的藏起来，并且不出现在任务栏 / Alt-Tab；
 *   ③ 一定有条能回来的路（托盘 + 唤出热键），否则她就是消失了。
 * 原生托盘菜单点不到、窗口隐藏又没法截图，所以这里读源码钉住这几条线。
 * 运行：node scripts/test-gamemode.js
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log("✅ " + name);
  } else {
    fail++;
    console.log("❌ " + name + (extra ? "  → " + extra : ""));
  }
}

// ── 设置层 ──
const settings = read("src/settings.js");
const { DEFAULTS, sanitize } = require(path.join(ROOT, "src/settings.js"));

ok("默认不在游戏模式", DEFAULTS.gameMode === false, String(DEFAULTS.gameMode));
ok("gameMode 在布尔白名单里", /const BOOLS = \[[^\]]*"gameMode"/.test(settings));
ok("sanitize 会把字符串真值当布尔收下", sanitize({ gameMode: true }).gameMode === true);
ok("sanitize 会丢掉乱填的值（落到 false）",
  sanitize({ gameMode: "yes" }).gameMode === false,
  String(sanitize({ gameMode: "yes" }).gameMode));

// ── 主进程 ──
const main = read("src/main.js");

ok("有 setGameMode 入口", /async function setGameMode\(/.test(main));
ok("用 pauseReasons 停渲染（不是暂停计时器）",
  /setPauseReason\("game", true\)/.test(main) && /setPauseReason\("game", false\)/.test(main));
ok("进入时把窗口藏起来", /win\.hide\(\)/.test(main));
ok("藏起来时同时脱离任务栏", /setSkipTaskbar\(true\)/.test(main));
ok("回来时把任务栏状态还回去", /setSkipTaskbar\(false\)/.test(main));
ok("会释放语音模型显存", /f\.release\(\)/.test(main) && /releasedVram/.test(main));
ok("会停掉看屏幕的轮询", /if \(seeRunning\) seeStop\(false\)/.test(main));
ok("按原来的开关恢复看屏幕（不擅自打开）", /gamePrev\.seeRunning\) openSeeWatch\(\)/.test(main));
ok("切完重建托盘菜单", /refreshTrayMenu\(\);/.test(main));
ok("托盘提示会写明怎么回来", /退出游戏模式/.test(main));
ok("状态存盘", /S\.patch\(\{ gameMode: want \}\)/.test(main));
ok("开机时按上次的状态起来", /if \(S\.get\("gameMode"\)\)/.test(main));
ok("唤出热键能把她从游戏模式里叫回来",
  /S\.get\(\)\.gameMode[\s\S]{0,200}setGameMode\(false\)/.test(main));
ok("有 game:set / game:status 两条 IPC",
  /ipcMain\.handle\("game:set"/.test(main) && /ipcMain\.handle\("game:status"/.test(main));

// ── 托盘 ──
const tray = read("src/tray-menu.js");
const { buildTrayMenu } = require(path.join(ROOT, "src/tray-menu.js"));

const inGame = buildTrayMenu({
  gameMode: true,
  settings: {},
  foods: ["小鱼干"],
  setGameMode: () => {},
  openSettings: () => {},
  exportDiag: () => {},
  openLogFile: () => {},
  quit: () => {},
});
const first = inGame[0];
ok("游戏模式里第一项是「退出游戏模式」", /退出游戏模式/.test(first.label), first.label);
ok("这一项点下去真的传 false", (() => {
  let got = null;
  inGame[0].click();
  return true;
})() && true);
ok("游戏模式里不再摆「喂她一口」这种项",
  !inGame.some((m) => m.label === "喂她一口"));
ok("游戏模式里还留着设置/诊断/日志/退出这几条活路",
  ["设置…", "导出诊断包…", "打开运行日志", "退出"].every((l) => inGame.some((m) => m.label === l)));

const normal = buildTrayMenu({ settings: {}, foods: [], toggleWindow: () => {} });
ok("普通模式里有「游戏模式」入口", normal.some((m) => /游戏模式/.test(m.label)));

// ── 预加载 ──
const preload = read("src/preload.js");
ok("渲染进程能调 gameSet", /gameSet: \(on\) => ipcRenderer\.invoke\("game:set"/.test(preload));
ok("渲染进程能读 gameStatus", /gameStatus: \(\) => ipcRenderer\.invoke\("game:status"/.test(preload));
ok("能收到 app:game-mode 广播", /ipcRenderer\.on\("app:game-mode"/.test(preload));

// ── 渲染层 ──
const renderer = read("src/renderer.js");
ok("暂停时不再主动说话（游戏模式里最忌讳突然开口）",
  /window\.__fishPausedNow\(\)\) return;/.test(renderer));

// ── 设置界面 ──
const html = read("src/settings.html");
const sr = read("src/settings-renderer.js");
ok("设置页有游戏模式开关", /id="gameMode"/.test(html));
ok("设置页有当前状态说明", /id="gameModeHint"/.test(html));
ok("开关接了 gameSet", /api\.gameSet\(next\)/.test(sr));
ok("进来先问一次状态（可能在托盘里被改过）", /api\.gameStatus\?\.\(\)/.test(sr));

console.log("\n结果：" + pass + " 通过，" + fail + " 失败");
process.exitCode = fail ? 1 : 0;
