/* 看屏幕监视窗：只负责显示主进程抓来的帧和她的点评。
 * 抓屏、差分、调视觉模型都在主进程，这里拿不到屏幕以外的权限，也不碰 API Key。 */
(() => {
  "use strict";

  const api = window.deskfish || {};
  const $ = (id) => document.getElementById(id);
  const shot = $("shot");
  const empty = $("empty");
  const scan = $("scan");
  const clock = $("clock");
  const meter = $("meter");
  const diffEl = $("diff");
  const toggle = $("toggle");
  const look = $("look");
  const speak = $("speak");
  const interval = $("interval");
  const comments = $("comments");
  const countEl = $("count");
  const pill = $("pill");
  const pillText = $("pillText");
  const sub = $("sub");
  const modelEl = $("model");

  let running = false;
  let busy = false;
  let lastError = "";
  let commentCount = 0;
  let lastCommentAt = 0;

  const fmt = (t) => {
    const d = new Date(t || Date.now());
    const p = (n) => String(n).padStart(2, "0");
    return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  };

  function setPill(state, text) {
    pill.className = "pill" + (state ? " " + state : "");
    pillText.textContent = text;
  }

  function renderStatus(s) {
    if (!s) return;
    running = !!s.running;
    busy = !!s.busy;
    lastError = s.lastError || "";
    if (s.model) modelEl.textContent = "视觉模型：" + s.model;
    else modelEl.textContent = s.hasVision ? "视觉模型：DSH 本地" : "视觉模型：未配置";

    if (lastError) {
      setPill("bad", "没连上");
      sub.textContent = lastError.length > 42 ? lastError.slice(0, 42) + "…" : lastError;
    } else if (running && busy) {
      setPill("busy", "正在看…");
      sub.textContent = "正在理解这一幕";
    } else if (running) {
      setPill("live", "正在看");
      sub.textContent = "每 " + (s.interval || 1.6) + " 秒看一眼";
    } else {
      setPill("", "暂停");
      sub.textContent = s.hasVision ? "点「开始看」继续" : "还没配置视觉模型";
    }

    toggle.textContent = running ? "暂停" : "开始看";
    toggle.classList.toggle("primary", !running);
    if (!running) scan.style.opacity = "0";
    else scan.style.opacity = "";
  }

  function addComment(text, kind) {
    const blank = comments.querySelector(".blank");
    if (blank) blank.remove();
    const el = document.createElement("div");
    el.className = "cmt" + (kind ? " " + kind : "");
    const body = document.createElement("div");
    body.textContent = text;
    const t = document.createElement("span");
    t.className = "t";
    t.textContent = fmt();
    el.appendChild(body);
    el.appendChild(t);
    comments.appendChild(el);
    while (comments.children.length > 30) comments.removeChild(comments.firstChild);
    commentCount += 1;
    countEl.textContent = commentCount + " 句";
    lastCommentAt = Date.now();
    const sc = $("scroll");
    sc.scrollTop = sc.scrollHeight;
  }

  // IPC / fetch 层的英文技术错误翻成人话，剩下的原样留着（后端给的多半已经是中文）。
  function softerr(raw) {
    const m = String(raw || "");
    if (/Error invoking remote method '[^']+':\s*/i.test(m)) {
      return m.replace(/Error invoking remote method '[^']+':\s*/i, "").replace(/^Error:\s*/i, "").trim();
    }
    if (/Failed to fetch|NetworkError|ERR_CONNECTION/i.test(m)) return "连不上看屏幕的服务";
    if (/AbortError|timeout|timed out/i.test(m)) return "等太久没回应";
    return m;
  }

  function showError(message) {
    if (!message) return;
    const text = softerr(message);
    if (text === lastError && comments.querySelector(".cmt.err")) return;
    // 记下来：这个字段原来只在 renderStatus 里更新，于是同一条错误
    // 每来一次都当成新的再插一遍。
    lastError = text;
    addComment(text, "err");
  }

  function onFrame(f) {
    if (!f || !f.dataUrl) return;
    shot.src = f.dataUrl;
    shot.classList.add("on");
    empty.style.display = "none";
    clock.textContent = fmt(f.at);
    const d = Math.max(0, Math.min(1, Number(f.diff) || 0));
    diffEl.textContent = d.toFixed(3);
    meter.style.width = Math.min(100, Math.round(d * 260)) + "%";
    if (running) scan.style.opacity = "";
  }

  async function refresh() {
    try {
      const s = await api.seeStatus();
      renderStatus(s);
      if (s && s.lastComment && Date.now() - (s.lastCommentAt || 0) < 15000) {
        // 窗口刚开，补上她上一句，不留空白。
        if (!comments.querySelector(".cmt")) addComment(s.lastComment);
      }
    } catch (e) {
      addComment("拿不到看屏幕状态：" + softerr(e && e.message ? e.message : e), "err");
    }
  }

  async function boot() {
    try {
      const s = await api.settingsGet();
      if (s) {
        speak.checked = s.seeSpeak !== false;
        const iv = Number(s.seeInterval) || 1.6;
        const opt = Array.from(interval.options).find((o) => Math.abs(Number(o.value) - iv) < 0.01);
        if (opt) interval.value = opt.value;
        else {
          const o = document.createElement("option");
          o.value = String(iv);
          o.textContent = iv + " 秒";
          interval.appendChild(o);
          interval.value = o.value;
        }
      }
    } catch (e) { }
    await refresh();
    // 主进程在窗口 ready 后已经自动开始；这里只同步按钮状态。
    setTimeout(() => { api.seeStatus().then(renderStatus).catch(() => { }); }, 500);
  }

  toggle.addEventListener("click", async () => {
    toggle.disabled = true;
    try {
      if (running) {
        const s = await api.seeStop();
        renderStatus(s);
      } else {
        const s = await api.seeStart();
        renderStatus(s);
      }
    } catch (e) {
      showError("切换失败：" + softerr(e && e.message ? e.message : e));
    } finally {
      toggle.disabled = false;
    }
  });

  look.addEventListener("click", async () => {
    look.disabled = true;
    const old = look.textContent;
    look.textContent = "看着…";
    try {
      const r = await api.seeSnapshot();
      if (!r || !r.ok) showError((r && r.error) || "这一眼没看成");
    } catch (e) {
      showError("这一眼没看成：" + softerr(e && e.message ? e.message : e));
    } finally {
      look.disabled = false;
      look.textContent = old;
    }
  });

  speak.addEventListener("change", async () => {
    try { await api.settingsPatch({ seeSpeak: !!speak.checked }); } catch (e) { }
  });

  interval.addEventListener("change", async () => {
    const v = Number(interval.value) || 1.6;
    try {
      await api.settingsPatch({ seeInterval: v });
      if (running) {
        // 间隔是 setInterval 时定下的，改了要重开计时器。
        const s = await api.seeStart();
        renderStatus(s);
      }
    } catch (e) { }
  });

  $("close").addEventListener("click", () => { api.closeSeeWatch(); });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") api.closeSeeWatch();
  });

  if (api.onSeeFrame) api.onSeeFrame(onFrame);
  if (api.onSeeComment) {
    api.onSeeComment((c) => {
      if (c && c.text) {
        addComment(c.text);
        if (c.model) modelEl.textContent = "视觉模型：" + c.model;
      }
    });
  }
  if (api.onSeeStatus) api.onSeeStatus(renderStatus);
  if (api.onSeeError) {
    api.onSeeError((e) => {
      if (e && e.error) {
        lastError = e.error;
        showError(e.error);
        renderStatus({ running, busy, interval: Number(interval.value) || 1.6, lastError });
      }
    });
  }

  boot();
})();
