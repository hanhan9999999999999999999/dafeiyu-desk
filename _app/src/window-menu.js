/* 主窗口右键菜单的模板。
 *
 * 原生菜单一弹出来，自动化就点不到里面的项了；把模板抽成纯函数，
 * 才能在离线测试里逐项断言「标签对、点下去真的调到对应动作」。
 * main.js 只负责把真实动作和当前状态（更新版本、食物表）传进来。
 */
"use strict";

function buildWindowMenu(ctx) {
  const c = ctx || {};
  const foods = Array.isArray(c.foods) ? c.foods : [];
  return [
    { label: "设置…", click: c.openSettings },
    { label: "模型适配器…", click: c.openAdapter },
    { type: "separator" },
    { label: "对话记录…", click: c.openChatLog },
    { label: "相处档案…", click: c.openProfile },
    { label: "看屏幕…", click: c.openSeeWatch },
    { label: "看看她…", click: c.openPetPanel },
    {
      label: "喂她一口",
      submenu: foods.map((name, i) => ({
        label: name,
        click: () => c.quickPet("feed", { idx: i }),
      })),
    },
    { label: "摸摸头", click: () => c.quickPet("pet") },
    { type: "separator" },
    { label: "重置位置", click: c.resetPosition },
    {
      label: c.updateAvailable ? "检查更新（v" + c.updateAvailable + " 可用）" : "检查更新…",
      click: c.checkUpdate,
    },
    { type: "separator" },
    { label: "退出", click: c.quit },
  ];
}

module.exports = { buildWindowMenu };
