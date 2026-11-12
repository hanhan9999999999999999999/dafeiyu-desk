// 设置窗口的「外壳」：侧栏页签、页内分组、概览摘要。
//
// 和 settings-renderer.js 分工：
//   · 这个文件只管「哪一页显示出来」「概览上的几个数字从哪来」；
//   · 具体的控件读写仍然归 settings-renderer.js，两边都只按 id 找元素，
//     所以页面怎么排版都不会影响业务逻辑。
//
// 之所以单独一个文件：那边已经 1700 多行，把导航塞进去会让「设置项怎么写」
// 和「窗口怎么摆」缠在一起，以后改版又得动业务代码。
(() => {
  const api = window.deskfish;
  const $ = (id) => document.getElementById(id);

  // ── 页签 ────────────────────────────────────────────────
  const nav = $("nav");
  const pages = $("pages");
  const KEY = "fish.settings.page";

  function showPage(name, opts) {
    const tab = nav && nav.querySelector('.tab[data-page="' + name + '"]');
    const page = pages && pages.querySelector('.page[data-page="' + name + '"]');
    if (!tab || !page) return;
    for (const t of nav.querySelectorAll(".tab")) t.classList.toggle("on", t === tab);
    for (const p of pages.querySelectorAll(".page")) p.classList.toggle("on", p === page);
    if (!opts || opts.remember !== false) {
      try { localStorage.setItem(KEY, name); } catch (e) { }
    }
    // 换页回到顶部：从「关于」切到「声音」时还停在半截，会让人以为页面没加载完
    pages.scrollTop = 0;
  }

  if (nav) {
    nav.addEventListener("click", (e) => {
      const b = e.target.closest(".tab");
      if (!b) return;
      showPage(b.dataset.page);
    });
  }

  try {
    const last = localStorage.getItem(KEY);
    if (last && nav && nav.querySelector('.tab[data-page="' + last + '"]')) showPage(last, { remember: false });
  } catch (e) { }

  // ── 页内分组（声音与行为） ───────────────────────────────
  const subs = document.querySelector('.subtabs[data-for="behavior"]');
  if (subs) {
    subs.addEventListener("click", (e) => {
      const b = e.target.closest(".subtab");
      if (!b) return;
      const name = b.dataset.sub;
      for (const t of subs.querySelectorAll(".subtab")) t.classList.toggle("on", t === b);
      for (const p of document.querySelectorAll('.subpage[data-sub]')) {
        p.classList.toggle("on", p.dataset.sub === name);
      }
    });
  }

  // ── 概览 ────────────────────────────────────────────────
  const VOICE_LABEL = { tts: "系统 TTS", rvc: "RVC 变声", xtts: "XTTS 克隆", feiyu: "飞鱼声线" };
  const REPLY_LABEL = { dsh: "DSH", api: "自定义 API" };

  function setText(id, text) {
    const n = $(id);
    if (n) n.textContent = text;
  }

  // 取景只有一个来源：模型自己的 layout（viewY 是「顶边」，可以为负）
  function viewLabel(L) {
    if (!L || typeof L !== "object") return "还没选模型";
    const y = Number(L.viewY), h = Number(L.viewH);
    if (!Number.isFinite(y) || !Number.isFinite(h)) return "还没调整过";
    const top = Math.max(0, Math.round(y * 100));
    const height = Math.max(1, Math.round(h * 100));
    return "从顶部 " + top + "% 起 · 高 " + height + "%";
  }

  async function fillOverview() {
    let s = {};
    try { s = (await api.settingsGet()) || {}; } catch (e) { }
    let about = {};
    try { about = (await api.aboutInfo()) || {}; } catch (e) { }

    setText("ovVer", about.version ? "v" + about.version : "—");
    // 「连接与模型」页也显示当前模型，页名才对得上
    try {
      const rr = await fetch("/api/packs/active", { cache: "no-store" });
      const jj = await rr.json();
      const m2 = jj && jj.ok ? (jj.manifest || jj) : null;
      setText("connectModelState", m2 ? (m2.displayName || m2.id) : "还没安装模型 —— 打开适配器导入一个");
    } catch (e) { }
    if (about.version) setText("ver", "v" + about.version);
    setText("ovEnv", about.packaged ? "安装版 · Electron " + (about.electron || "?") : "开发模式 · Electron " + (about.electron || "?"));

    const voice = VOICE_LABEL[s.voiceOut] || s.voiceOut || "TTS";
    setText("ovVoice", voice);
    setText("ovVoiceMeta", s.voiceOut === "feiyu" ? "中文原生 · 最像真人" : s.voiceOut === "xtts" ? "参考音频克隆" : s.voiceOut === "rvc" ? "TTS 之后换嗓子" : "最快最稳");
    setText("ovReply", REPLY_LABEL[s.replyMode] || "DSH");
    setText("ovReplyMeta", s.replyMode === "api" ? (s.apiModel || "还没填模型名") : "本机 DSH · 能看文件能干活");
    setText("ovHotkey", s.hotkeySummon || "未设置");
    setText("tipHotkey", s.hotkeySummon || "Ctrl+Alt+F");

    // 侧栏状态灯：能拿到设置就说明主进程是通的
    const dot = $("sideDot");
    if (dot) dot.classList.add("on");
    setText("sideState", "已连接 · 设置即时生效");

    // 当前模型：用运行时清单（渲染端真正吃的那份），而不是设置里的名字
    try {
      const r = await fetch("/api/packs/active", { cache: "no-store" });
      const j = await r.json();
      const m = j && j.ok ? (j.manifest || j) : null;
      if (m && (m.displayName || m.id)) {
        setText("ovModelName", m.displayName || m.id);
        const st = m.stats || {};
        const bits = [];
        if (st.params) bits.push("参数 " + st.params);
        if (st.motions) bits.push("动作 " + st.motions);
        if (st.expressions) bits.push("表情 " + st.expressions);
        setText("ovModelMeta", bits.length ? bits.join(" · ") : (m.id || "—"));
        setText("ovView", viewLabel(m.layout));
      }
    } catch (e) {
      setText("ovModelName", "还没安装模型");
      setText("ovModelMeta", "点「模型适配器」导入一个");
      setText("ovView", "导入模型后再调取景");
    }
  }

  // 概览上的入口：和各自的页签按钮走同一条 IPC，不复制逻辑
  const wire = (id, fn) => {
    const n = $(id);
    if (n) n.addEventListener("click", fn);
  };
  wire("ovOpenAdapter", () => api.openAdapter(""));
  wire("ovOpenView", () => api.openAdapter("", "layout").then(() => {
    // 适配器要一点时间才开出来，给一句即时反馈，别让人以为点空了
    const n = $("ovView");
    if (n) n.textContent = "已切到适配器的取景步骤";
  }));
  wire("connectOpenAdapter", () => api.openAdapter("", ""));
  wire("ovOpenData", () => api.storageOpen());
  wire("ovOpenLog", () => api.logOpen());
  wire("ovOpenDiag", () => {
    const n = $("ovOpenDiag");
    if (n) n.disabled = true;
    api.diagExport().then((r) => {
      if (n) n.disabled = false;
      if (r && r.ok) {
        const t = $("cfgToast");
        if (t) { t.textContent = "诊断包已导出"; t.className = "cfgtoast show"; setTimeout(() => { t.className = "cfgtoast"; }, 2400); }
      }
    }).catch(() => { if (n) n.disabled = false; });
  });

  // 换模型之后概览里的名字要跟着变，不然会显示上一个
  if (api.onPackChanged) {
    api.onPackChanged(() => { fillOverview(); });
  }

  fillOverview();
})();
