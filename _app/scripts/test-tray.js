/* 托盘菜单模板的离线断言。
 *
 * 托盘是「主窗被关掉 / 被最小化」之后用户唯一的入口。这里逐项验：
 * 标签与顺序稳定、每个 click 真的调到对应动作、勾选项的 checked 来自真实状态、
 * 食物子菜单的下标和 pet.js 的 FOODS 一一对应、更新项标题随版本变化。
 *
 * 测不到的部分（原生菜单没法自动点）由 verify-src 的第 21 段静态钉住：
 * 「显示 / 隐藏」必须走主进程的 toggleWindow，不许再自己写一份 show/hide。
 */
"use strict";

const { buildTrayMenu } = require("../src/tray-menu");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("✅ " + name); }
  else { fail++; console.log("❌ " + name + (extra ? "  → " + extra : "")); }
}

const calls = [];
const hit = (name) => (...args) => calls.push({ name, args });
const foods = ["小鱼干", "布丁", "热可可", "月亮糕"];

function make(ctxExtra) {
  calls.length = 0;
  return buildTrayMenu(Object.assign({
    foods,
    settings: { mute: false },
    paused: false,
    updateAvailable: "",
    toggleWindow: hit("toggle"),
    quickPet: hit("quickPet"),
    setMuted: hit("muted"),
    setPaused: hit("paused"),
    setGameMode: hit("game"),
    openSeeWatch: hit("see"),
    openProfile: hit("profile"),
    openChatLog: hit("chatlog"),
    openAdapter: hit("adapter"),
    openSettings: hit("settings"),
    checkUpdate: hit("update"),
    resetPosition: hit("reset"),
    exportDiag: hit("diag"),
    openLogFile: hit("logfile"),
    openWelcome: hit("welcome"),
    quit: hit("quit"),
  }, ctxExtra || {}));
}

const menu = make();
const items = menu.filter((m) => m.type !== "separator");
const seps = menu.filter((m) => m.type === "separator");

ok("顶层 17 个可点入口", items.length === 17, "实际 " + items.length);
ok("分隔线 2 条", seps.length === 2, "实际 " + seps.length);

const labels = items.map((m) => m.label);
const want = ["显示 / 隐藏", "喂她一口", "摸摸头", "静音", "暂停动效（省电）",
  "游戏模式（极致省性能）", "看屏幕…", "相处档案…", "对话记录…", "模型适配器…", "设置…",
  "检查更新…", "重置位置", "导出诊断包…", "打开运行日志", "再看一次新手引导", "退出"];
ok("标签与顺序稳定", JSON.stringify(labels) === JSON.stringify(want),
  JSON.stringify(labels));

// 每一项都真的接上了动作（漏写 click 的项在界面上就是「点了没反应」）
for (const it of items) {
  if (it.submenu) {
    ok("子菜单「" + it.label + "」有 " + foods.length + " 项",
      it.submenu.length === foods.length, "实际 " + it.submenu.length);
    continue;
  }
  ok("「" + it.label + "」接了动作", typeof it.click === "function");
}

// 逐项点一遍，确认落到对的动作上
const clickLabel = (label) => {
  calls.length = 0;
  const it = items.find((m) => m.label === label);
  if (!it || typeof it.click !== "function") return null;
  it.click({ checked: false });
  return calls.length ? calls[0] : null;
};

ok("显示 / 隐藏 走 toggleWindow（不是自己 hide/show）",
  (clickLabel("显示 / 隐藏") || {}).name === "toggle");
ok("摸摸头 走 quickPet('pet')",
  JSON.stringify((clickLabel("摸摸头") || {}).args) === JSON.stringify(["pet"]));
ok("静音 把 item.checked 交给 setMuted",
  JSON.stringify((clickLabel("静音") || {}).args) === JSON.stringify([false]));
ok("暂停动效 把 item.checked 交给 setPaused",
  JSON.stringify((clickLabel("暂停动效（省电）") || {}).args) === JSON.stringify([false]));
ok("模型适配器 传空 id（让适配器自己挑当前模型）",
  JSON.stringify((clickLabel("模型适配器…") || {}).args) === JSON.stringify([""]));
for (const [label, name] of [
  ["看屏幕…", "see"], ["相处档案…", "profile"], ["对话记录…", "chatlog"],
  ["设置…", "settings"], ["检查更新…", "update"], ["重置位置", "reset"],
  ["导出诊断包…", "diag"], ["打开运行日志", "logfile"],
  ["再看一次新手引导", "welcome"], ["退出", "quit"],
]) {
  ok("「" + label + "」→ " + name, (clickLabel(label) || {}).name === name);
}

// 食物子菜单的下标必须和 pet.js 的 FOODS 对齐，否则「喂小鱼干」会喂成月亮糕
calls.length = 0;
const feed = items.find((m) => m.label === "喂她一口");
feed.submenu[0].click();
feed.submenu[3].click();
ok("食物子菜单下标对齐（0=小鱼干、3=月亮糕）",
  calls.length === 2 &&
  JSON.stringify(calls[0].args) === JSON.stringify(["feed", { idx: 0 }]) &&
  JSON.stringify(calls[1].args) === JSON.stringify(["feed", { idx: 3 }]),
  JSON.stringify(calls));

// 勾选状态来自真实设置，不是写死的
const m2 = make({ settings: { mute: true }, paused: true });
const mutedItem = m2.filter((x) => x.label === "静音")[0];
const pausedItem = m2.filter((x) => x.label === "暂停动效（省电）")[0];
ok("静音勾选跟随设置（mute=true → 勾上）", mutedItem.checked === true);
ok("静音项是 checkbox", mutedItem.type === "checkbox");
ok("暂停勾选跟随状态（paused=true → 勾上）", pausedItem.checked === true);
const m3 = make({ settings: { mute: false }, paused: false });
ok("mute=false → 不勾", m3.filter((x) => x.label === "静音")[0].checked === false);
ok("paused=false → 不勾",
  m3.filter((x) => x.label === "暂停动效（省电）")[0].checked === false);

// 更新标记
const m4 = make({ updateAvailable: "1.3.1" });
ok("有新版本时标题带版本号",
  m4.some((x) => x.label === "检查更新（v1.3.1 可用）"),
  JSON.stringify(m4.map((x) => x.label)));
ok("没有新版本时是「检查更新…」",
  menu.some((x) => x.label === "检查更新…"));

// 防退化：ctx 给了空数组也不能崩（食物表可能被外部配置清空）
const m5 = buildTrayMenu({ foods: [], toggleWindow: () => { }, quickPet: () => { } });
ok("食物表为空时不崩、子菜单为空数组",
  m5.filter((x) => x.label === "喂她一口")[0].submenu.length === 0);
const m6 = buildTrayMenu({});
ok("完全不传 ctx 也不崩", Array.isArray(m6) && m6.length > 0);

console.log("");
console.log("结果：" + pass + " 通过，" + fail + " 失败");
process.exit(fail ? 1 : 0);
