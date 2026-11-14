/* 主窗口这一侧只做两件事：
 *   1. 输入行最左边那个 ♥ —— 点它打开独立的状态面板窗口
 *   2. 饿了的时候给按钮染个色，提醒该喂了
 *
 * 面板本身在 petpanel.html 里，是另一个窗口，能拖到屏幕任何地方。
 * 原来的内嵌面板（#petPanel）已经删掉 —— 它在主窗口里，最远只能挪到窗口边缘。
 */
(() => {
  "use strict";

  const btn = document.getElementById("petBtn");
  const chatBtn = document.getElementById("chatBtn");
  const seeBtn = document.getElementById("seeBtn");

  // 看屏幕：独立监视窗。她实时看主人桌面，变化够大就点评一句。
  if (seeBtn) {
    seeBtn.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      try {
        const p = window.deskfish && window.deskfish.openSeeWatch
          ? window.deskfish.openSeeWatch()
          : null;
        if (p && p.catch) p.catch((e) => console.error("[see] 打开失败", e));
      } catch (e) {
        console.error("[see] 打开失败", e);
      }
    });
  }

  // 对话记录：独立窗口，记录落盘。透明窗里 pointerdown 比 click 可靠。
  if (chatBtn) {
    chatBtn.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      try {
        const p = window.deskfish && window.deskfish.openChatLog
          ? window.deskfish.openChatLog()
          : null;
        if (p && p.catch) p.catch((e) => console.error("[chat] 打开失败", e));
      } catch (e) {
        console.error("[chat] 打开失败", e);
      }
    });
  }

  if (!btn) return;

  let busy = false;

  function open() {
    if (busy) return;
    busy = true;
    try {
      // 独立窗口由主进程开。用 invoke 是为了拿到「开没开成」，
      // 万一窗口被系统拦了，至少日志里能看到。
      const p = window.deskfish && window.deskfish.openPetPanel
        ? window.deskfish.openPetPanel()
        : null;
      if (p && p.catch) p.catch((e) => console.error("[pet] 打开面板失败", e));
    } catch (e) {
      console.error("[pet] 打开面板失败", e);
    }
    setTimeout(() => { busy = false; }, 400);
  }

  // 这窗口透明 + 不可聚焦，pointerdown 比 click 可靠（click 需要 focus）。
  btn.addEventListener("pointerdown", (ev) => {
    ev.stopPropagation();
    ev.preventDefault();
    open();
  });

  // 饿了把按钮染成橙色
  function tickBtn() {
    const P = window.FishPet;
    if (!P) return;
    try {
      const s = P.snapshot();
      btn.classList.toggle("warn", s.hunger < 25);
      btn.title = "看看她 · 饱腹 " + s.hunger + " · 好感 " + s.favor;
    } catch (e) { }
  }

  tickBtn();
  setInterval(tickBtn, 30000);

  // 面板窗口里做完动作会广播过来，这边立刻刷一次按钮（别等 30 秒）
  if (typeof BroadcastChannel !== "undefined") {
    const ch = new BroadcastChannel("dafeiyu-pet");
    ch.addEventListener("message", () => { tickBtn(); });
  }
})();
