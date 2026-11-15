/* 右键菜单模板的离线断言。
 *
 * 原生菜单弹出后自动化点不到，所以退而求其次：模板逐项必须存在、
 * 每个 click 必须真的调到对应动作、食物子菜单的下标要和 pet.js 的 FOODS 对齐。
 * 这样「右键菜单少一项 / 点下去没反应」在提交前就能被抓住。
 */
"use strict";

const { buildWindowMenu } = require("../src/window-menu");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("✅ " + name); }
  else { fail++; console.log("❌ " + name + (extra ? "  → " + extra : "")); }
}

const calls = [];
const hit = (name) => (...args) => calls.push({ name, args });
const foods = ["小鱼干", "布丁", "热可可", "月亮糕"];

const menu = buildWindowMenu({
  foods,
  openSettings: hit("settings"),
  openAdapter: hit("adapter"),
  openChatLog: hit("chatlog"),
  openProfile: hit("profile"),
  openSeeWatch: hit("see"),
  openPetPanel: hit("panel"),
  quickPet: hit("quickPet"),
  resetPosition: hit("reset"),
  checkUpdate: hit("update"),
  quit: hit("quit"),
});
const items = menu.filter((m) => m.type !== "separator");

ok("顶层 11 个可点入口", items.length === 11, "实际 " + items.length);
ok("分隔线 3 条", menu.length - items.length === 3, "实际 " + (menu.length - items.length));

const labels = items.map((m) => m.label);
const want = ["设置…", "模型适配器…", "对话记录…", "相处档案…", "看屏幕…", "看看她…",
  "喂她一口", "摸摸头", "重置位置", "检查更新…", "退出"];
ok("标签与顺序稳定", JSON.stringify(labels) === JSON.stringify(want), JSON.stringify(labels));

for (const it of items) {
  if (it.submenu) continue;
  it.click();
}
ok("每个入口都接到了动作", calls.length === 10, "实际 " + calls.length);
ok("设置打开设置窗", calls[0] && calls[0].name === "settings", JSON.stringify(calls[0]));
ok("退出调 app.quit", calls[calls.length - 1] && calls[calls.length - 1].name === "quit");

const feed = items.find((m) => m.label === "喂她一口");
ok("喂她一口有 4 个子项", !!feed && Array.isArray(feed.submenu) && feed.submenu.length === 4,
  feed && feed.submenu && JSON.stringify(feed.submenu.map((s) => s.label)));
ok("子项顺序与 TRAY_FOODS 一致",
  !!feed && JSON.stringify(feed.submenu.map((s) => s.label)) === JSON.stringify(foods));
calls.length = 0;
feed.submenu[2].click();
ok("点第 3 个食物传的是 idx=2",
  calls[0] && calls[0].name === "quickPet" && calls[0].args[0] === "feed" &&
  calls[0].args[1] && calls[0].args[1].idx === 2, JSON.stringify(calls[0]));

const pet = items.find((m) => m.label === "摸摸头");
calls.length = 0;
pet.click();
ok("摸摸头调 quickPet('pet')",
  calls[0] && calls[0].name === "quickPet" && calls[0].args[0] === "pet", JSON.stringify(calls[0]));

const upd = buildWindowMenu({ foods, updateAvailable: "1.3.1" }).find((m) => /检查更新/.test(m.label));
ok("有更新时标签带版本号", !!(upd && upd.label === "检查更新（v1.3.1 可用）"), upd && upd.label);

console.log("\n结果：" + pass + " 通过，" + fail + " 失败");
process.exit(fail ? 1 : 0);
