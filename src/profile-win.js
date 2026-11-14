// 相处档案：等级、今日、最近七天、徽章。
// 数据全部来自 pet.js（localStorage），不经过主进程；只有「导出 .md」用 IPC 弹保存框。
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const P = window.FishPet;
  const card = $("card");
  const toastEl = $("toast");
  let toastTimer = 0;
  let built = { week: "", ach: 0 };
  let lastSnapshot = null;

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1800);
  }

  function pad2(n) { return n < 10 ? "0" + n : String(n); }

  function weekdayName(d) {
    return "周" + ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
  }

  function weekSig(week) {
    // 柱高只看 total，但 tooltip 里写了喂食/玩耍/摸头/活动四项；
    // 只比 total 的话，四项互相抵消时提示会停在旧数字。
    return week.map((d) => [d.key, d.total, d.fed, d.play, d.pet, d.act, d.today ? 1 : 0].join(":")).join("|");
  }

  function buildWeek(week) {
    const box = $("chart");
    box.innerHTML = "";
    week.forEach((d) => {
      const col = document.createElement("div");
      col.className = "barCol" + (d.today ? " today" : "");
      col.title = d.key + " · 喂食 " + d.fed + " · 玩耍 " + d.play + " · 摸头 " + d.pet + " · 活动 " + d.act;
      const num = document.createElement("div");
      num.className = "num";
      num.textContent = d.total > 0 ? String(d.total) : "";
      const track = document.createElement("div");
      track.className = "track";
      const bar = document.createElement("div");
      bar.className = "bar";
      track.appendChild(bar);
      const lab = document.createElement("div");
      lab.className = "d";
      lab.textContent = d.today ? "今" : d.label;
      col.appendChild(num);
      col.appendChild(track);
      col.appendChild(lab);
      box.appendChild(col);
    });
    const note = document.createElement("div");
    note.className = "emptyNote";
    note.textContent = "这几天还没怎么在一起玩";
    box.appendChild(note);
    built.week = weekSig(week);
  }

  function paintWeek(week) {
    const sig = weekSig(week);
    if (sig !== built.week) buildWeek(week);
    const max = Math.max(1, ...week.map((d) => d.total));
    const allZero = week.every((d) => d.total <= 0);
    $("chart").classList.toggle("empty", allZero);
    Array.prototype.forEach.call($("chart").children, (col, i) => {
      const d = week[i];
      if (!d || !col.querySelector) return;
      const bar = col.querySelector(".bar");
      if (!bar) return;
      const h = d.total > 0 ? Math.max(6, Math.round(52 * (d.total / max))) : 3;
      bar.style.height = h + "px";
      bar.style.opacity = d.total > 0 ? "1" : ".28";
    });
  }

  function buildAch(list) {
    const box = $("badges");
    box.innerHTML = "";
    list.forEach((a) => {
      const node = document.createElement("div");
      node.className = "badge " + (a.got ? "got" : "lock");
      node.dataset.id = a.id;
      const e = document.createElement("div");
      e.className = "e";
      e.textContent = a.emoji;
      const n = document.createElement("div");
      n.className = "n";
      n.textContent = a.name;
      const tip = document.createElement("div");
      tip.className = "tip";
      tip.textContent = a.desc + (a.got ? " · 已获得" : " · 未获得");
      node.appendChild(e);
      node.appendChild(n);
      node.appendChild(tip);
      box.appendChild(node);
    });
    built.ach = list.length;
  }

  function paintAch(list) {
    if (list.length !== built.ach) buildAch(list);
    Array.prototype.forEach.call($("badges").children, (node, i) => {
      const a = list[i];
      if (!a) return;
      node.classList.toggle("got", !!a.got);
      node.classList.toggle("lock", !a.got);
      const tip = node.querySelector(".tip");
      if (tip) tip.textContent = a.desc + (a.got ? " · 已获得" : " · 未获得");
    });
  }

  function reportText(s) {
    const lv = s.level || {};
    const t = s.today || {};
    const mins = Math.round((t.sec || 0) / 60);
    const lines = [];
    lines.push("大肥鱼 · 相处档案");
    lines.push("第 " + s.days + " 天 · " + lv.name);
    lines.push("好感 " + s.favor + (lv.nextAt ? "（下一级「" + lv.next + "」还差 " + lv.need + "）" : "（已经是最高一级）"));
    lines.push("今天：喂食 " + (t.fed || 0) + " · 玩耍 " + (t.play || 0) + " · 摸头 " + (t.pet || 0) + " · 一起 " + mins + " 分钟");
    lines.push("");
    lines.push("最近七天：");
    const blocks = "▁▂▃▄▅▆▇█";
    const max = Math.max(1, ...(s.week || []).map((d) => d.total));
    (s.week || []).forEach((d) => {
      const idx = Math.min(blocks.length - 1, Math.round((d.total / max) * (blocks.length - 1)));
      lines.push("  " + d.key + " " + (d.today ? "今天" : "周" + d.label) + " " + blocks[idx] + " " + d.total);
    });
    const ach = s.ach || { list: [], got: 0, total: 0 };
    lines.push("");
    lines.push("徽章 " + ach.got + "/" + ach.total + "：" + ach.list.filter((a) => a.got).map((a) => a.name).join("、") + (ach.got ? "" : "（还没有）"));
    lines.push("累计：喂食 " + s.totalFed + " · 玩耍 " + s.totalPlay + " · 摸头 " + s.totalPet + " · 活动 " + s.totalAct);
    return lines.join("\n");
  }

  function paint() {
    const s = P.snapshot();
    lastSnapshot = s;
    const lv = s.level || {};
    $("days").textContent = "第 " + s.days + " 天";
    $("lvName").textContent = lv.name || "初见";
    $("lvFavor").textContent = "好感 " + s.favor + (lv.max ? " / " + lv.max : "");
    $("lvDesc").textContent = lv.desc || "";
    $("medal").textContent = ["🐟", "🐠", "🐡", "🫧", "💙", "✨", "🌊", "🐋"][Math.min(7, lv.i || 0)] || "🐟";
    $("lvBar").style.width = Math.round((lv.progress || 0) * 100) + "%";
    if (lv.nextAt) {
      $("lvNextLeft").innerHTML = "下一级 <b>" + lv.next + "</b>";
      $("lvNextNeed").textContent = "还差 " + lv.need;
    } else {
      $("lvNextLeft").textContent = "已经到最高一级";
      $("lvNextNeed").textContent = "她赖着不走了";
    }

    const now = new Date();
    $("todayDate").textContent = (now.getMonth() + 1) + "月" + now.getDate() + "日 · " + weekdayName(now);
    const t = s.today || {};
    $("tFed").textContent = String(t.fed || 0);
    $("tPlay").textContent = String(t.play || 0);
    $("tPet").textContent = String(t.pet || 0);
    $("tMin").textContent = String(Math.round((t.sec || 0) / 60));

    paintWeek(s.week || []);
    const ach = s.ach || { list: [], got: 0, total: 0 };
    $("achCount").textContent = ach.got + " / " + ach.total;
    paintAch(ach.list || []);

    $("total").textContent = "第 " + s.days + " 天 · 累计喂食 " + s.totalFed +
      " · 玩耍 " + s.totalPlay + " · 摸头 " + s.totalPet + " · 活动 " + s.totalAct;
  }

  async function copyReport() {
    const text = reportText(lastSnapshot || P.snapshot());
    // 优先走主进程的系统剪贴板：透明/无焦点窗口里 navigator.clipboard 常被拒，
    // 旧兜底还会在没真正写入时提示“已复制”，看起来像按钮坏了。
    if (window.deskfish && window.deskfish.copyText) {
      try {
        const r = await window.deskfish.copyText(text);
        if (r && r.ok) { toast("相处报告已复制"); return; }
      } catch (e) { /* 继续尝试浏览器剪贴板 */ }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast("相处报告已复制");
    } catch (e) {
      // 浏览器预览时的兜底；electron 下上面的主进程通道才是正路。
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        toast(ok ? "相处报告已复制" : "复制失败，可以先选中文字手动复制");
      } catch (e2) {
        toast("复制失败，可以先选中文字手动复制");
      }
    }
  }

  async function saveReport() {
    const text = reportText(lastSnapshot || P.snapshot());
    if (window.deskfish && window.deskfish.profileExport) {
      const r = await window.deskfish.profileExport(text);
      if (r && r.canceled) return;
      if (r && r.ok) toast("已导出到 " + (r.path || "文件"));
      else toast("导出失败：" + ((r && r.error) || "未知原因"));
      return;
    }
    // 浏览器里预览时退化成下载，方便调样式。
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "大肥鱼-相处报告.md";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast("已下载报告");
  }

  $("close").addEventListener("click", () => window.close());
  $("copy").addEventListener("click", copyReport);
  $("save").addEventListener("click", saveReport);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") window.close();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c" && !window.getSelection().toString()) {
      // 只在没有选中文字时接管，正常复制仍然可用。
      e.preventDefault();
      copyReport();
    }
  });

  // 另一个窗口做了事，档案页要跟着动；不用重开窗口。
  try {
    const ch = new BroadcastChannel("dafeiyu-pet");
    ch.onmessage = () => paint();
  } catch (e) { }
  setInterval(paint, 2000);

  paint();
  requestAnimationFrame(() => card.classList.add("show"));
})();
