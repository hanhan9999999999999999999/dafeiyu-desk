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

// 开场体检：把「她还缺什么」摆在最上面。
// 为什么不再只判模型：新装的人最常见的一句话是「跟她说话没反应」，
// 而那大概率是没填对话接口 —— 只提示「缺模型」等于答非所问。
async function renderTodo() {
  const box = document.getElementById("todo");
  if (!box) return;
  let items = [];
  try {
    const r = await window.deskfish.welcomePrecheck();
    items = (r && r.items) || [];
  } catch (e) {
    items = [];
  }
  // 麦克风是可选项：只有系统里明确关掉了才提；还没问过的（prompt）不打扰。
  try {
    const p = await navigator.permissions.query({ name: "microphone" });
    if (p && p.state === "denied") {
      items.push({
        key: "mic",
        ok: false,
        need: "麦克风被系统关掉了",
        hint: "现在只能用打字。要用麦克风：Windows 设置 → 隐私和安全性 → 麦克风 → 允许桌面应用访问麦克风。",
        act: "",
      });
    }
  } catch (e) { }

  const bad = items.filter((x) => x && x.ok !== true);
  if (!bad.length) {
    box.hidden = true;
    // 收起时把上一次的内容也清掉：只切 hidden 会留一段看不见但还在的旧文案，
    // 之后窗口被重新量高、或者有人用读屏软件，就会读到「她还缺一个对话接口」。
    box.innerHTML = "";
    return;
  }
  box.innerHTML = "";
  for (const it of bad) {
    const row = document.createElement("div");
    row.className = "it";
    const n = document.createElement("b");
    n.textContent = it.need || "还差一项";
    const h = document.createElement("span");
    h.textContent = it.hint || "";
    row.appendChild(n);
    row.appendChild(h);
    if (it.act === "settings" || it.act === "adapter") {
      const go = document.createElement("button");
      go.type = "button";
      go.className = "go";
      go.textContent = it.act === "settings" ? "去设置" : "去导入";
      go.addEventListener("click", () => {
        close();
        try {
          if (it.act === "settings") window.deskfish.openSettings();
          else window.deskfish.openAdapter("", "");
        } catch (e) { }
      });
      row.appendChild(go);
    }
    box.appendChild(row);
  }
  box.hidden = false;
  // 卡片变高了：让主进程按新内容重量一次（写死窗口高度会把「知道了」切掉）
  setTimeout(() => { try { window.deskfish.welcomeFit && window.deskfish.welcomeFit(); } catch (e) { } }, 30);
}
renderTodo();

// 回车 / Esc 也能关：第一次见面的窗口，别逼用户去找那个小按钮。
window.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === "Escape") close();
});
