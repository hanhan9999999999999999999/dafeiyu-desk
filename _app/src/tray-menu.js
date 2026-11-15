/* 托盘菜单的模板。
 *
 * 和 window-menu.js 同一个理由：原生菜单一弹出来，自动化就点不到里面的项。
 * 把模板抽成纯函数，才能在离线测试里逐项断言「标签对、点下去真的调到对应动作」。
 *
 * 这里曾经是 main.js 里一段内联数组，结果有两件事被漏掉：
 *   ① 一条测试都没有 —— 用户在托盘上点的每一项都没验过；
 *   ② 「显示 / 隐藏」和「二次启动」各写了一遍唤醒逻辑，托盘那份少了
 *      「屏幕外夹回」「窗口不在就重建」「留一条日志」，托盘就成了哑的。
 * 现在两处都走同一个 toggleWindow，模板只负责摆位置。
 */
"use strict";

function buildTrayMenu(ctx) {
  const c = ctx || {};
  const foods = Array.isArray(c.foods) ? c.foods : [];
  const s = c.settings || {};

  // 游戏模式是「她不在这台屏幕上了」的状态：菜单只剩一个主项（把她叫回来）和
  // 几个不经过设置窗的救命入口。这时候还摆一屏「喂她一口 / 摸摸头」纯属添乱。
  if (c.gameMode) {
    return [
      { label: "退出游戏模式（把她叫回来）", click: () => c.setGameMode(false) },
      { type: "separator" },
      { label: "设置…", click: c.openSettings },
      { label: "导出诊断包…", click: c.exportDiag },
      { label: "打开运行日志", click: c.openLogFile },
      { type: "separator" },
      { label: "退出", click: c.quit },
    ];
  }

  return [
    { label: "显示 / 隐藏", click: () => c.toggleWindow() },
    {
      label: "喂她一口",
      submenu: foods.map((name, i) => ({
        label: name,
        click: () => c.quickPet("feed", { idx: i }),
      })),
    },
    { label: "摸摸头", click: () => c.quickPet("pet") },
    {
      label: "静音",
      type: "checkbox",
      checked: !!s.mute,
      click: (item) => c.setMuted(!!(item && item.checked)),
    },
    {
      label: "暂停动效（省电）",
      type: "checkbox",
      checked: !!c.paused,
      click: (item) => c.setPaused(!!(item && item.checked)),
    },
    { label: "游戏模式（极致省性能）", click: () => c.setGameMode(true) },
    { label: "看屏幕…", click: c.openSeeWatch },
    { label: "相处档案…", click: c.openProfile },
    { label: "对话记录…", click: c.openChatLog },
    { label: "模型适配器…", click: () => c.openAdapter("") },
    { label: "设置…", click: c.openSettings },
    {
      label: c.updateAvailable ? "检查更新（v" + c.updateAvailable + " 可用）" : "检查更新…",
      click: c.checkUpdate,
    },
    { label: "重置位置", click: c.resetPosition },
    { type: "separator" },
    // 设置窗一旦打不开，用户就没有任何出口了。这两个入口不经过设置窗：
    // 诊断包直接弹选目录框（没有可聚焦窗口时用自由对话框），日志直接在资源管理器里选中。
    { label: "导出诊断包…", click: c.exportDiag },
    { label: "打开运行日志", click: c.openLogFile },
    { label: "再看一次新手引导", click: c.openWelcome },
    { type: "separator" },
    { label: "退出", click: c.quit },
  ];
}

module.exports = { buildTrayMenu };
