// 首次运行引导页：只有一个动作——关掉它并把 firstRun 置 false。
// 主进程负责落盘，这里不碰设置。

const ok = document.getElementById("ok");
const close = () => window.deskfish.closeWelcome();

ok.addEventListener("click", close);

// 热键跟着设置走：用户在设置里改过，这张卡也不能再说旧键位。
const prettyKey = (acc) => String(acc || "").replace(/CommandOrControl|CmdOrCtrl|Command|Cmd/gi, "Ctrl").replace(/\+/g, "+");
(async () => {
  try {
    const s = await window.deskfish.settingsGet();
    const a = document.getElementById("kSummon");
    const b = document.getElementById("kMic");
    if (a && s && s.hotkeySummon) a.textContent = prettyKey(s.hotkeySummon);
    if (b && s && s.hotkeyMic) b.textContent = prettyKey(s.hotkeyMic);
  } catch (e) { }
})();

// 没有模型时补一句「还差一个模型」：安装包不再带模型，第一眼就得说清楚
(async () => {
  try {
    const r = await fetch("/api/packs/active", { cache: "no-store" });
    const j = await r.json();
    const has = !!(j && j.ok && j.url);
    const el = document.getElementById("nomo");
    if (el && !has) {
      el.hidden = false;
      // 卡片变高了：让主进程按新内容重量一次（写死窗口高度会把「知道了」切掉）
      setTimeout(() => { try { window.deskfish.welcomeFit && window.deskfish.welcomeFit(); } catch (e) { } }, 30);
    }
  } catch (e) { }
})();

// 回车 / Esc 也能关：第一次见面的窗口，别逼用户去找那个小按钮。
window.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === "Escape") close();
});
