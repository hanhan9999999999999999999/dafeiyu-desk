/* 对话记录窗口
 *
 * 数据来源有三层：
 *   1. 主进程落盘的 chatlog.json（最权威，重启也在）
 *   2. 迷你桥接 /api/state 的当前会话（第一次打开时补一段历史，之后靠 1 去重）
 *   3. 语音/打字链路发来的实时更新（chat:update，流式回复也走这条）
 *
 * 渲染只做「全量重排 + 单条增量更新」两种：条数上限 3000，
 * 全量重建只在切筛选/搜索时发生，流式更新走 patchItem，不整页闪。
 */
(() => {
  "use strict";

  const api = window.deskfish || {};
  const listEl = document.getElementById("list");
  const subEl = document.getElementById("sub");
  const footEl = document.getElementById("foot");
  const qEl = document.getElementById("q");
  const chipsEl = document.getElementById("chips");
  const jumpEl = document.getElementById("jump");
  const clearBtn = document.getElementById("clearBtn");
  const closeBtn = document.getElementById("closeBtn");

  let items = [];
  let filter = "all";
  let query = "";
  let stick = true;          // 是否贴着底部（用户往上翻之后不再强制滚）
  let seeded = localStorage.getItem("dafeiyu.chatSeedDone") === "1";

  const MS_DAY = 86400000;

  function pad(n) { return n < 10 ? "0" + n : String(n); }

  function dayStart(t) {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function dayKey(t) { return new Date(t).toDateString(); }

  function dayLabel(t) {
    const today = dayStart(Date.now());
    const d0 = dayStart(t);
    if (d0 === today) return "今天";
    if (d0 === today - MS_DAY) return "昨天";
    const d = new Date(t);
    const week = "日一二三四五六"[d.getDay()];
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return (sameYear ? "" : d.getFullYear() + "年") + (d.getMonth() + 1) + "月" + d.getDate() + "日 · 周" + week;
  }

  function clock(t) {
    const d = new Date(t);
    return pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function sameDay(a, b) { return dayKey(a) === dayKey(b); }

  function filtered() {
    const q = query.trim().toLowerCase();
    return items.filter((m) => {
      if (filter !== "all" && m.role !== filter) return false;
      if (q && !String(m.text || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function avatar(role) {
    const a = el("div", "ava", role === "assistant" ? "鱼" : "我");
    return a;
  }

  function messageNode(m) {
    const row = el("div", "msg " + (m.role === "assistant" ? "her" : "me"));
    row.dataset.id = m.id || "";
    row.appendChild(avatar(m.role));

    const body = el("div", "body");
    const meta = el("div", "meta");
    meta.appendChild(el("span", "who", m.role === "assistant" ? "大肥鱼" : "主人"));
    meta.appendChild(el("span", "t", clock(m.at)));
    body.appendChild(meta);

    const bubble = el("div", "bubble");
    bubble.textContent = String(m.text || "");
    if (m.streaming) {
      const caret = document.createElement("span");
      caret.className = "caret";
      bubble.appendChild(caret);
    }
    body.appendChild(bubble);
    row.appendChild(body);
    return row;
  }

  function typingNode() {
    const row = el("div", "msg her");
    row.dataset.typing = "1";
    row.appendChild(avatar("assistant"));
    const body = el("div", "body");
    const meta = el("div", "meta");
    meta.appendChild(el("span", "who", "大肥鱼"));
    meta.appendChild(el("span", "t", "正在想…"));
    body.appendChild(meta);
    const bubble = el("div", "bubble");
    const dots = el("span", "typing");
    dots.appendChild(document.createElement("i"));
    dots.appendChild(document.createElement("i"));
    dots.appendChild(document.createElement("i"));
    bubble.appendChild(dots);
    body.appendChild(bubble);
    row.appendChild(body);
    return row;
  }

  function shouldShowTyping(view) {
    if (filter !== "all" || query.trim()) return false;
    if (!view.length) return false;
    const last = view[view.length - 1];
    if (last.role !== "user") return false;
    // 发出去 100 秒还没回就不再假装她还在想——大概率是没连上。
    return Date.now() - last.at < 100000;
  }

  function render() {
    const view = filtered();
    const nearBottom = stick || (listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 90);
    listEl.textContent = "";

    if (!view.length) {
      const empty = el("div", "empty");
      empty.appendChild(el("div", "big", "🐟"));
      if (items.length && (query || filter !== "all")) {
        empty.appendChild(el("b", null, "没找到"));
        empty.appendChild(el("span", null, "换个词试试，或者把筛选切回「全部」。"));
      } else {
        empty.appendChild(el("b", null, "还没有聊过天"));
        empty.appendChild(el("span", null, "在底部输入条跟她说句话吧。以后每一句都会记在这里，关掉再打开也还在。"));
      }
      listEl.appendChild(empty);
    } else {
      let lastDay = "";
      const frag = document.createDocumentFragment();
      for (const m of view) {
        if (!sameDay(m.at, lastDay ? new Date(lastDay).getTime() : 0)) {
          // 用 dayKey 直接比，别拿 lastDay 的字符串去 new Date（时区会漂）
          const key = dayKey(m.at);
          if (key !== lastDay) {
            const d = el("div", "day");
            d.appendChild(el("span", null, dayLabel(m.at)));
            frag.appendChild(d);
            lastDay = key;
          }
        }
        frag.appendChild(messageNode(m));
      }
      if (shouldShowTyping(view)) frag.appendChild(typingNode());
      listEl.appendChild(frag);
    }

    updateMeta();
    if (nearBottom) {
      requestAnimationFrame(() => {
        listEl.scrollTop = listEl.scrollHeight;
        jumpEl.classList.remove("show");
      });
    } else {
      jumpEl.classList.add("show");
    }
    /* 滚动事件在程序化滚动后也会触发；stick 用「用户主动往上翻」来清零，
       所以这里不要根据 scrollTop 反推 stick。 */
  }

  function updateMeta() {
    const today = items.filter((m) => dayStart(m.at) === dayStart(Date.now())).length;
    const view = filtered();
    if (query.trim() || filter !== "all") {
      subEl.textContent = "筛出 " + view.length + " 条 · 共 " + items.length + " 条";
    } else {
      subEl.textContent = "共 " + items.length + " 条 · 今天 " + today + " 条";
    }
    footEl.textContent = items.length ? "已自动保存 · 最多保留 3000 条" : "自动保存";
  }

  function patchItem(m) {
    const idx = items.findIndex((x) => x.id === m.id);
    if (idx >= 0) items[idx] = Object.assign({}, items[idx], m);
    else items.push(m);
    items.sort((a, b) => a.at - b.at);

    const row = listEl.querySelector('[data-id="' + CSS.escape(String(m.id || "")) + '"]');
    if (row) {
      const bubble = row.querySelector(".bubble");
      if (bubble) {
        bubble.textContent = String(m.text || "");
        if (m.streaming) {
          const caret = document.createElement("span");
          caret.className = "caret";
          bubble.appendChild(caret);
        }
      }
      const t = row.querySelector(".meta .t");
      if (t) t.textContent = clock(m.at);
      const typing = listEl.querySelector('[data-typing="1"]');
      if (typing && m.role === "assistant") typing.remove();
    } else if (!query.trim() && filter === "all") {
      // 新消息：只有正在看全部时才插到末尾，避免把筛选结果搅乱
      render();
      return;
    }
    updateMeta();
    if (stick) {
      requestAnimationFrame(() => { listEl.scrollTop = listEl.scrollHeight; });
    } else {
      jumpEl.classList.add("show");
    }
  }

  async function seedFromBridge() {
    if (seeded) return;
    seeded = true;
    try {
      const s = await api.settingsGet();
      const base = String((s && s.bridgeUrl) || "").replace(/\/+$/, "");
      if (!base) return;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 5000);
      const r = await fetch(base + "/api/state", { cache: "no-store", signal: ctl.signal });
      clearTimeout(timer);
      if (!r.ok) return;
      const j = await r.json();
      // 第一次打开补一次历史就够了。清空之后再把桥接里的旧消息倒回来，
      // 主人会以为「清空按钮根本没用」。
      try { localStorage.setItem("dafeiyu.chatSeedDone", "1"); } catch (e) { }
      const arr = Array.isArray(j && j.messages) ? j.messages : [];
      if (!arr.length) return;
      const mapped = arr.map((m) => ({
        id: String(m.id || ""),
        role: m.role === "assistant" ? "assistant" : "user",
        text: String(m.text || ""),
        at: Number(m.at) || Date.now(),
        streaming: false,
      })).filter((m) => m.text.trim());
      const res = await api.chatMerge(mapped);
      if (res && res.added) {
        items = (res.items || []).slice();
        render();
        if (stick) requestAnimationFrame(() => { listEl.scrollTop = listEl.scrollHeight; });
      }
    } catch (e) { }
  }

  async function init() {
    try {
      const r = await api.chatList();
      items = ((r && r.items) || []).slice().sort((a, b) => a.at - b.at);
    } catch (e) {
      items = [];
    }
    render();
    requestAnimationFrame(() => {
      listEl.scrollTop = listEl.scrollHeight;
      stick = true;
    });
    seedFromBridge();
  }

  /* ---------- 滚动 ---------- */
  listEl.addEventListener("scroll", () => {
    const gap = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight;
    if (gap > 90) {
      stick = false;
      jumpEl.classList.add("show");
    } else {
      stick = true;
      jumpEl.classList.remove("show");
    }
  }, { passive: true });

  jumpEl.addEventListener("click", () => {
    stick = true;
    listEl.scrollTo({ top: listEl.scrollHeight, behavior: "smooth" });
    jumpEl.classList.remove("show");
  });

  /* ---------- 搜索 / 筛选 ---------- */
  qEl.addEventListener("input", () => {
    query = qEl.value || "";
    render();
  });
  qEl.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") { qEl.value = ""; query = ""; qEl.blur(); render(); }
  });

  chipsEl.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-f]");
    if (!b) return;
    filter = b.dataset.f;
    for (const x of chipsEl.children) x.classList.toggle("on", x === b);
    render();
  });

  /* ---------- 清空（二次确认） ---------- */
  let clearTimer = 0;
  clearBtn.addEventListener("click", async () => {
    if (!clearBtn.classList.contains("danger")) {
      clearBtn.classList.add("danger");
      clearBtn.textContent = "确定清空？";
      clearTimer = setTimeout(() => {
        clearBtn.classList.remove("danger");
        clearBtn.textContent = "";
        clearBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>';
      }, 3200);
      return;
    }
    clearTimeout(clearTimer);
    clearBtn.classList.remove("danger");
    clearBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>';
    try { await api.chatClear(); } catch (e) { }
    try { localStorage.setItem("dafeiyu.chatSeedDone", "1"); } catch (e) { }
    seeded = true;
    items = [];
    render();
  });

  closeBtn.addEventListener("click", () => { try { api.closeChatLog(); } catch (e) { } });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.activeElement !== qEl) {
      try { api.closeChatLog(); } catch (err) { }
    }
  });

  /* ---------- 实时更新 ---------- */
  if (api.onChatUpdate) api.onChatUpdate((m) => {
    if (!m || !m.id) return;
    patchItem(m);
  });
  if (api.onChatCleared) api.onChatCleared(() => {
    items = [];
    render();
  });

  // 每隔一会儿清掉「正在想…」：等待超过 100 秒说明对面没回。
  setInterval(() => {
    const typing = listEl.querySelector('[data-typing="1"]');
    if (typing && !shouldShowTyping(filtered())) {
      typing.remove();
      if (stick) listEl.scrollTop = listEl.scrollHeight;
    }
  }, 4000);

  init();
})();
