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
  const q = $("q");
  const qInfo = $("qInfo");
  const KEY = "fish.settings.page";

  function showPage(name, opts) {
    const tab = nav && nav.querySelector('.tab[data-page="' + name + '"]');
    const page = pages && pages.querySelector('.page[data-page="' + name + '"]');
    if (!tab || !page) return;
    for (const t of nav.querySelectorAll(".tab")) {
      const on = t === tab;
      t.classList.toggle("on", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    }
    for (const p of pages.querySelectorAll(".page")) {
      const on = p === page;
      p.classList.toggle("on", on);
      p.setAttribute("aria-hidden", on ? "false" : "true");
    }
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
      // 搜索态下点页签 = 「我不搜了，去这一页」：先把过滤撤掉，
      // 否则新页面里全是 hidden，看起来像坏了。
      if (q && q.value.trim()) { q.value = ""; applySearch(""); }
      showPage(b.dataset.page);
    });
  }

  // ── 搜索设置项 ──────────────────────────────────────────
  // 只做一件事：把不含关键词的行藏起来，再把第一个有命中的页切过去。
  // 它不改任何控件的值，也不碰业务逻辑 —— 所以搜索中途关窗、清空、切页都不会留下脏状态。
  function rowsOf(root) {
    return Array.prototype.slice.call(root.querySelectorAll(".row"));
  }
  function anyVisible(rows) {
    for (const r of rows) if (!r.classList.contains("hidden")) return true;
    return false;
  }

  function applySearch(raw) {
    if (!pages || !nav) return;
    const kw = String(raw || "").trim().toLowerCase();
    const allRows = rowsOf(pages);
    const cards = Array.prototype.slice.call(pages.querySelectorAll(".card"));
    const subs = Array.prototype.slice.call(pages.querySelectorAll(".subpage"));

    if (!kw) {
      allRows.forEach((r) => r.classList.remove("hidden"));
      cards.forEach((c) => c.classList.remove("hidden"));
      subs.forEach((s) => s.classList.remove("hidden"));
      for (const t of nav.querySelectorAll(".tab")) t.classList.remove("hit", "miss");
      if (qInfo) { qInfo.classList.add("hidden"); qInfo.classList.remove("bad"); }
      return;
    }

    const total = {};
    for (const r of allRows) {
      const hit = r.textContent.toLowerCase().indexOf(kw) >= 0;
      r.classList.toggle("hidden", !hit);
      if (hit) {
        const page = r.closest(".page");
        const name = page ? page.dataset.page : "";
        if (name) total[name] = (total[name] || 0) + 1;
      }
    }
    // 整张卡片都没剩下就一起藏掉，不留空壳
    for (const c of cards) {
      const rows = rowsOf(c);
      c.classList.toggle("hidden", rows.length > 0 && !anyVisible(rows));
    }
    // 行为页的子页同理：全被过滤掉就藏掉，不然会留一个空的子页标题
    for (const s of subs) {
      const rows = rowsOf(s);
      s.classList.toggle("hidden", rows.length > 0 && !anyVisible(rows));
    }

    let first = "";
    for (const t of nav.querySelectorAll(".tab")) {
      const n = total[t.dataset.page] || 0;
      t.classList.toggle("hit", n > 0);
      t.classList.toggle("miss", n === 0);
      if (n > 0 && !first) first = t.dataset.page;
    }

    const sum = Object.keys(total).reduce((a, k) => a + total[k], 0);
    if (qInfo) {
      qInfo.classList.remove("hidden");
      qInfo.classList.toggle("bad", sum === 0);
      qInfo.textContent = sum ? ("找到 " + sum + " 项，回车跳到第一个") : "没有找到匹配的设置项";
    }
    // 当前页没命中就自动切到第一个有命中的页，不然输入完什么变化都看不见
    if (first) {
      const cur = nav.querySelector(".tab.on");
      if (!cur || !total[cur.dataset.page]) showPage(first, { remember: false });
    }
  }

  if (q) {
    let timer = null;
    q.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => applySearch(q.value), 120);
    });
    q.addEventListener("keydown", (e) => {
    // 输入法组装候选词时的 Enter 只用来选字，不该跳到第一个搜索结果。
    if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Escape") {
        q.value = "";
        applySearch("");
        q.blur();
        return;
      }
      if (e.key === "Enter") {
        const hit = nav && nav.querySelector(".tab.hit");
        if (hit) showPage(hit.dataset.page, { remember: false });
      }
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
  wire("ovProfile", () => api.openProfile());
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
