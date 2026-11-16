// 设置页「用量」页：把所有 token 消耗摊开给人看。
//
// 数据只有一个来源：GET /usage/summary（服务端 → src/usage.js 的账本）。
// 这一页不做任何统计，只负责排版 —— 口径要改就去 usage.js 改，别在两边各算一套。
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // 1,234 → 「1.2k」；1,234,567 → 「1.23M」。卡片里塞不下长数字，概览页也这么干。
  function short(n) {
    const v = Math.round(Number(n) || 0);
    if (v < 1000) return String(v);
    if (v < 10000) return (v / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    if (v < 1000000) return Math.round(v / 1000) + "k";
    return (v / 1000000).toFixed(2).replace(/\.?0+$/, "") + "M";
  }

  function full(n) {
    return (Math.round(Number(n) || 0)).toLocaleString("en-US");
  }

  function clockOf(ms) {
    const d = new Date(Number(ms) || 0);
    const p = (x) => String(x).padStart(2, "0");
    return p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function subOf(b) {
    const parts = [];
    parts.push(b.turns + " 轮");
    if (b.prompt) parts.push("输入 " + short(b.prompt));
    if (b.cached) parts.push("缓存 " + short(b.cached));
    if (b.completion) parts.push("输出 " + short(b.completion));
    return parts.join(" · ");
  }

  function renderCards(s) {
    const set = (idBig, idSub, b) => {
      const big = $(idBig);
      const sub = $(idSub);
      if (!big || !sub) return;
      if (!b || !b.tokens) {
        big.textContent = "0";
        const small = document.createElement("small");
        small.textContent = "token";
        big.appendChild(small);
        sub.textContent = b && b.turns ? subOf(b) : "还没有记录";
        return;
      }
      big.textContent = short(b.tokens);
      const small = document.createElement("small");
      small.textContent = "token";
      big.appendChild(small);
      sub.textContent = subOf(b);
    };
    set("usageToday", "usageTodaySub", s.today);
    set("usageWeek", "usageWeekSub", s.week);
    set("usageTotal", "usageTotalSub", s.total);
  }

  function renderSources(s) {
    const box = $("usageSrcList");
    if (!box) return;
    const list = Array.isArray(s.bySrc) ? s.bySrc : [];
    if (!list.length) {
      box.innerHTML = '<p class="hint">还没有记录 —— 跟她说一句话，这里就有数字了。</p>';
      return;
    }
    box.innerHTML = "";
    for (const it of list) {
      const row = document.createElement("div");
      row.className = "ubar";
      row.title = it.label + "：" + full(it.tokens) + " token / " + it.turns + " 轮";

      const nm = document.createElement("div");
      nm.className = "nm";
      nm.textContent = it.label;

      const track = document.createElement("div");
      track.className = "track";
      const fill = document.createElement("div");
      fill.className = "fill" + (it.src === "api" ? " api" : it.src === "other" ? " other" : "");
      fill.style.width = Math.max(2, Math.min(100, Number(it.share) || 0)) + "%";
      track.appendChild(fill);

      const num = document.createElement("div");
      num.className = "num";
      num.textContent = short(it.tokens) + " token · " + it.turns + " 轮 · " + (Number(it.share) || 0) + "%";

      row.appendChild(nm);
      row.appendChild(track);
      row.appendChild(num);
      box.appendChild(row);
    }
  }

  function renderChart(s) {
    const box = $("usageChart");
    if (!box) return;
    const series = Array.isArray(s.series) ? s.series : [];
    box.innerHTML = "";
    if (!series.length) return;
    const max = series.reduce((m, d) => Math.max(m, Number(d.tokens) || 0), 0);
    for (const d of series) {
      const col = document.createElement("div");
      col.className = "col";
      col.title = d.label + "：" + full(d.tokens) + " token / " + d.turns + " 轮";

      const bar = document.createElement("div");
      const tokens = Number(d.tokens) || 0;
      bar.className = "bar" + (tokens ? "" : " zero");
      // 有数字的那天至少给 6% 高度，否则小数目在图上等于不存在
      const h = max ? Math.max(tokens ? 6 : 2, Math.round((tokens / max) * 82)) : 2;
      bar.style.height = h + "px";

      const cap = document.createElement("div");
      cap.className = "cap";
      cap.textContent = d.label;

      col.appendChild(bar);
      col.appendChild(cap);
      box.appendChild(col);
    }
  }

  function renderRecent(s) {
    const box = $("usageRecent");
    if (!box) return;
    const list = Array.isArray(s.recent) ? s.recent : [];
    const hint = $("usageRecentHint");
    if (hint) {
      hint.textContent = s.ctx && s.ctx.used
        ? "上一轮上下文 " + short(s.ctx.used) + (s.ctx.max ? " / " + short(s.ctx.max) : "")
        : "输入 / 输出分开看";
    }
    if (!list.length) {
      box.innerHTML = '<p class="hint">还没有记录。</p>';
      return;
    }
    const table = document.createElement("table");
    table.className = "utable";
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    for (const [txt, right] of [["时间", false], ["来源", false], ["模型", false], ["输入", true], ["输出", true], ["合计", true]]) {
      const th = document.createElement("th");
      th.textContent = txt;
      if (right) th.style.textAlign = "right";
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    table.appendChild(thead);

    const tb = document.createElement("tbody");
    for (const t of list) {
      const tr = document.createElement("tr");
      const tdTime = document.createElement("td");
      tdTime.textContent = clockOf(t.at);
      const tdSrc = document.createElement("td");
      const span = document.createElement("span");
      span.className = "src " + (t.src || "");
      span.textContent = t.label || t.src || "其他";
      tdSrc.appendChild(span);
      const tdModel = document.createElement("td");
      tdModel.textContent = t.model || "—";
      tdModel.title = t.model || "";
      tdModel.style.maxWidth = "180px";
      tdModel.style.overflow = "hidden";
      tdModel.style.textOverflow = "ellipsis";
      const tdP = document.createElement("td");
      tdP.className = "num";
      tdP.textContent = full(t.prompt);
      if (t.cached) {
        // DSH 的 total 含缓存命中的上下文；把差额单独标出来，三列才对得上。
        const em = document.createElement("small");
        em.style.color = "var(--faint)";
        em.style.marginLeft = "4px";
        em.textContent = "+" + short(t.cached) + " 缓存";
        em.title = "这一轮的上下文里有 " + full(t.cached) + " token 命中缓存";
        tdP.appendChild(em);
      }
      const tdC = document.createElement("td");
      tdC.className = "num";
      tdC.textContent = full(t.completion);
      const tdT = document.createElement("td");
      tdT.className = "num";
      tdT.textContent = full(t.total);
      tr.appendChild(tdTime);
      tr.appendChild(tdSrc);
      tr.appendChild(tdModel);
      tr.appendChild(tdP);
      tr.appendChild(tdC);
      tr.appendChild(tdT);
      tb.appendChild(tr);
    }
    table.appendChild(tb);
    box.innerHTML = "";
    box.appendChild(table);
  }

  // 上下文卡：她这一轮读进去多少、离上限还有多远、最近几轮是涨还是落。
  function renderCtx(s) {
    const big = $("usageCtxUsed");
    const sub = $("usageCtxSub");
    const fill = $("usageCtxFill");
    const bars = $("usageCtxSeries");
    if (!big || !sub) return;

    const ctx = s && s.ctx ? s.ctx : null;
    const used = ctx && ctx.used ? ctx.used : 0;
    const max = (ctx && ctx.max) || (s && s.ctxMax) || 0;

    if (!used) {
      big.textContent = "—";
      sub.textContent = "还没有记录 —— 跟她说一句话，这里就有数字了。";
      if (fill) { fill.style.width = "0%"; fill.className = "fill"; }
    } else {
      big.textContent = short(used);
      const small = document.createElement("small");
      small.textContent = max ? " / " + short(max) : " token";
      big.appendChild(small);
      const pct = max ? Math.max(1, Math.min(100, Math.round((used / max) * 100))) : 0;
      if (fill) {
        fill.style.width = (max ? pct : 100) + "%";
        fill.className = "fill" + (max && pct >= 90 ? " bad" : max && pct >= 70 ? " warn" : "");
        if (!max) fill.style.opacity = ".45";
      }
      sub.textContent = max
        ? "占上限 " + pct + "% · " + clockOf(ctx.at) + " 那一轮"
        : "上限没报上来 · " + clockOf(ctx.at) + " 那一轮";
    }

    if (!bars) return;
    const list = Array.isArray(s && s.ctxSeries) ? s.ctxSeries : [];
    bars.innerHTML = "";
    if (!list.length) return;
    const top = Math.max.apply(null, list.map((x) => x.used || 0)) || 1;
    for (const it of list) {
      const col = document.createElement("div");
      col.className = "col";
      const bar = document.createElement("div");
      bar.className = "bar";
      const h = Math.max(it.used ? 3 : 1, Math.round(((it.used || 0) / top) * 34));
      bar.style.height = h + "px";
      bar.title = clockOf(it.at) + " · 上下文 " + full(it.used) + " token";
      const cap = document.createElement("div");
      cap.className = "cap";
      cap.textContent = it.used ? short(it.used) : "—";
      col.appendChild(bar);
      col.appendChild(cap);
      bars.appendChild(col);
    }
    bars.title = "最近 " + list.length + " 轮的上下文大小（左旧右新）";
  }

  async function load() {
    const refresh = $("usageRefresh");
    if (refresh) refresh.disabled = true;
    try {
      let s = null;
      if (window.__usageSample) {
        // 离屏预览（.ui-shots 里那份副本没有服务端）时，允许外部塞一份同样形状的样本，
        // 好让排版能被人看见；正常运行时这个变量永远是空的。
        s = window.__usageSample;
      } else {
        const r = await fetch("/usage/summary", { cache: "no-store" });
        s = await r.json();
      }
      if (!s || s.ok === false) throw new Error((s && s.error) || "读不到账本");
      renderCards(s);
      renderSources(s);
      renderChart(s);
      renderCtx(s);
      renderRecent(s);
      const f = $("usageFile");
      if (f) {
        f.textContent = s.file || "—";
        f.title = s.file || "";
      }
    } catch (e) {
      const box = $("usageRecent");
      if (box) box.innerHTML = '<p class="hint">读不到用量记录：' + String((e && e.message) || e) + "</p>";
    } finally {
      if (refresh) refresh.disabled = false;
    }
  }

  async function clearAll() {
    if (!window.confirm("清空全部用量记录？聊天记录和她记住的事都不会动。")) return;
    try {
      await fetch("/usage/clear", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    } catch (e) { }
    await load();
  }

  function boot() {
    const refresh = $("usageRefresh");
    if (refresh) refresh.addEventListener("click", load);
    const clear = $("usageClear");
    if (clear) clear.addEventListener("click", clearAll);
    load();
    // 停在这一页时每 20 秒自己对一次账：她刚说完话，数字就该跟着动。
    setInterval(() => {
      const page = document.querySelector('.page[data-page="usage"]');
      if (page && page.classList.contains("on") && !document.hidden) load();
    }, 20000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
