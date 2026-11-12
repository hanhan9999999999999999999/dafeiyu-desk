// 大肥鱼 · 状态面板（独立小窗）
// 数据全在 localStorage 里，主窗和这里读写同一份；「做了事让她有反应」走 BroadcastChannel。
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const P = window.FishPet;

  const el = {
    panel: $("panel"), mood: $("mood"), days: $("days"), close: $("close"),
    ring: $("ring"), heroEmo: $("heroEmo"), heroName: $("heroName"),
    heroDesc: $("heroDesc"), heroLeft: $("heroLeft"), stop: $("stop"),
    hungerTxt: $("hungerTxt"), hungerBar: $("hungerBar"), hungerBarWrap: $("hungerBarWrap"),
    favorTxt: $("favorTxt"), favorBar: $("favorBar"),
    energyTxt: $("energyTxt"), energyBar: $("energyBar"),
    cleanTxt: $("cleanTxt"), cleanBar: $("cleanBar"),
    acts: $("acts"), foods: $("foods"), touch: $("touch"), play: $("play"), foodHint: $("foodHint"),
    say: $("say"), recent: $("recent"),
    fFed: $("fFed"), fPlay: $("fPlay"), fPet: $("fPet"), fLast: $("fLast"),
  };

  if (!P) {
    document.body.innerHTML = "<div style='color:#FF8E8E;font:12px sans-serif;padding:20px'>pet.js 没加载上</div>";
    return;
  }

  const ch = new BroadcastChannel("dafeiyu-pet");
  const notify = (kind, extra) => ch.postMessage(Object.assign({ kind, at: Date.now() }, extra || {}));

  const MOOD_TEXT = { calm: "平静", happy: "开心", hungry: "饿了", sleepy: "困了", pout: "生气", shy: "害羞" };
  const MOOD_HERO = { calm: "在发呆", happy: "心情不错", hungry: "肚子空空的", sleepy: "有点困", pout: "不太高兴", shy: "有点不好意思" };
  const FOOD_EMOJI = ["🐟", "🍮", "☕", "🌙"];
  // 活动主色：进度环、卡片高亮都用它，让「睡觉」是紫的、「泡澡」是蓝的
  const ACT_COLOR = {
    eat: "255,159,10", rest: "176,168,255", sleep: "176,168,255", bath: "143,184,255",
    groom: "255,143,187", play: "110,231,168", stretch: "110,231,168", sun: "255,192,98",
    read: "143,184,255", sing: "255,143,187", movie: "176,168,255", walk: "110,231,168",
    daze: "143,184,255",
  };

  let actList = [];
  const byId = {};
  let prevVal = {};
  let prevActId = null;
  let sayTimer = 0;

  function say(text) {
    if (!text) return;
    el.say.textContent = text;
    el.say.classList.add("on");
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => el.say.classList.remove("on"), 3200);
  }

  function flash(node, dir) {
    if (!node) return;
    node.classList.remove("up", "down");
    void node.offsetWidth;
    node.classList.add(dir);
    setTimeout(() => node.classList.remove(dir), 900);
  }

  function mmss(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(s / 60);
    return m > 0 ? m + ":" + String(s % 60).padStart(2, "0") : s + "s";
  }

  // ── 活动卡片 ─────────────────────────────────────────
  function buildActs() {
    actList = P.acts() || [];
    actList.forEach((a) => { byId[a.id] = a; });
    el.acts.innerHTML = "";
    actList.forEach((a) => {
      const b = document.createElement("div");
      b.className = "act";
      b.dataset.id = a.id;
      b.title = a.desc + " · " + a.dur + " 秒";
      b.innerHTML = '<span class="dot"></span><span class="e"></span><span class="n"></span><span class="d"></span>';
      b.querySelector(".e").textContent = a.emoji;
      b.querySelector(".n").textContent = a.name;
      b.querySelector(".d").textContent = a.dur + "s";
      b.addEventListener("click", () => start(a.id));
      el.acts.appendChild(b);
    });

    // 第 14 格：骰子。13 个活动排成 4×4 会空一格，不如给个「随便来一个」——
    // 挑一个当前能做的，省得纠结。
    const rnd = document.createElement("div");
    rnd.className = "act rnd";
    rnd.dataset.id = "__random";
    rnd.title = "随机挑一个现在能做的活动";
    rnd.innerHTML = '<span class="e">🎲</span><span class="n">随便来</span><span class="d">点我</span>';
    rnd.addEventListener("click", () => {
      const now = P.actInfo();
      const pool = actList.filter((x) => !x.cdLeft && !x.blocked && (!now || x.id !== now.id));
      if (!pool.length) {
        say("现在没什么能做的，先歇会儿吧");
        notify("act.fail", { line: "现在没什么能做的" });
        return;
      }
      start(pool[Math.floor(Math.random() * pool.length)].id);
    });
    el.acts.appendChild(rnd);
  }

  function start(id) {
    // 点自己那张卡＝停：比让人去找终止按钮顺手。
    const activeNow = P.actInfo();
    if (activeNow && activeNow.id === id) { stop(); return; }
    const r = P.startAct(id);
    if (!r || !r.ok) {
      const why = (r && r.why) || "现在做不了";
      say(why);
      notify("act.fail", { id, line: why });
      paint();
      return;
    }
    const cur = byId[id] || {};
    say(r.start || "开始了");
    notify("act.start", {
      id,
      name: (r.def && r.def.name) || cur.name,
      emoji: (r.def && r.def.emoji) || cur.emoji,
      scene: cur.scene,
      line: r.start,
    });
    prevActId = id;
    paint();
  }

  function stop() {
    const r = P.stopAct();
    if (!r || !r.ok) {
      say((r && r.why) || "现在没在忙");
      return;
    }
    say(r.line);
    notify("act.stop", { id: r.act && r.act.id, line: r.line });
    prevActId = null;
    paint();
  }

  // ── 食盆 / 互动 ─────────────────────────────────────
  function buildFoods() {
    el.foods.innerHTML = "";
    (P.foods || []).forEach((f, i) => {
      const b = document.createElement("div");
      b.className = "food";
      b.dataset.i = String(i);
      b.title = "饱腹 +" + f.gain + " · 好感 +" + f.favor;
      b.innerHTML = '<span class="e"></span><span class="n"></span><span class="v"></span>';
      b.querySelector(".e").textContent = FOOD_EMOJI[i] || "🍽";
      b.querySelector(".n").textContent = f.name;
      b.querySelector(".v").textContent = "+" + f.gain + "/+" + f.favor;
      b.addEventListener("click", () => {
        const r = P.feed(i);
        if (!r || !r.ok) {
          say((r && r.why) || "现在吃不了");
          notify("feed.fail", { line: r && r.why });
        } else {
          say("吃了" + r.food + " · 饱腹 +" + r.gain + " · 好感 +" + r.favor);
          notify("feed", { food: r.food });
        }
        paint();
      });
      el.foods.appendChild(b);
    });
  }

  el.touch.addEventListener("click", () => {
    const r = P.pet();
    if (!r || !r.ok) {
      say((r && r.why) || "现在摸不了");
      notify("touch.fail", { line: r && r.why });
    } else {
      const line = r.sleeping ? "唔……（翻了个身，没醒）" : "她蹭了蹭你的手 · 好感 +" + r.favor;
      say(line);
      notify("touch", { line, sleeping: !!r.sleeping });
    }
    paint();
  });

  el.play.addEventListener("click", () => {
    const r = P.play();
    if (!r || !r.ok) {
      say((r && r.why) || "现在玩不了");
      notify("play.fail", { line: r && r.why });
    } else {
      const line = "陪她玩了一会儿 · 好感 +" + r.favor;
      say(line);
      notify("play", { line });
    }
    paint();
  });

  el.stop.addEventListener("click", stop);
  el.close.addEventListener("click", () => {
    if (window.deskfish && window.deskfish.closePetPanel) window.deskfish.closePetPanel();
    else window.close();
  });

  // 最近活动列表：只在内容变了的时候重建 DOM，paint 是每 500ms 跑的。
  let recentSig = "";
  function renderRecent(s) {
    const log = (s.log || []).slice(0, 2);
    const sig = log.map((x) => x.id + ":" + x.sec + ":" + x.at + ":" + (x.stopped ? 1 : 0)).join("|") +
      "|" + (s.totalAct || 0);
    if (sig === recentSig) return;
    recentSig = sig;
    if (!log.length) {
      el.recent.innerHTML = '<div class="none">还没有活动记录，点上面随便一个试试。</div>';
      return;
    }
    el.recent.innerHTML = log.map((x) => {
      const a = byId[x.id] || {};
      const t = new Date(x.at || Date.now());
      const hh = String(t.getHours()).padStart(2, "0") + ":" + String(t.getMinutes()).padStart(2, "0");
      return '<div class="it"><span>' + (a.emoji || "🐟") + "</span><b>" + (a.name || x.id) + "</b>" +
        (x.stopped ? '<span class="tag">提前停</span>' : "") +
        "<em>" + x.sec + "s · " + hh + "</em></div>";
    }).join("");
  }

  // ── 每帧绘制 ────────────────────────────────────────
  function paint() {
    const s = P.snapshot();
    const act = s.act;
    const info = act; // snapshot().act 就是 actInfo() 的结果

    // 数值 + 进度条
    const vals = [["hunger", s.hunger], ["favor", s.favor], ["energy", s.energy], ["clean", s.clean]];
    vals.forEach(([k, v]) => {
      const txt = el[k + "Txt"];
      if (txt.textContent !== String(v)) {
        if (prevVal[k] !== undefined) flash(txt, v > prevVal[k] ? "up" : "down");
        txt.textContent = String(v);
      }
      prevVal[k] = v;
      el[k + "Bar"].style.width = Math.max(0, Math.min(100, v)) + "%";
    });
    el.hungerBarWrap.classList.toggle("low", s.hunger < 30);
    el.energyBar.parentElement.classList.toggle("low", s.energy < 25);
    el.cleanBar.parentElement.classList.toggle("low", s.clean < 25);

    // 心情 / 天数
    const mk = s.mood || "calm";
    el.mood.className = "mood " + mk;
    el.mood.textContent = MOOD_TEXT[mk] || "平静";
    el.days.textContent = "第 " + s.days + " 天";

    // 主展示区
    if (info) {
      const col = ACT_COLOR[info.id] || "255,143,187";
      el.ring.style.setProperty("--p", Math.round(info.progress * 100));
      el.ring.style.setProperty("--c", "rgb(" + col + ")");
      el.heroEmo.textContent = info.emoji || "🐟";
      el.heroName.textContent = info.name;
      el.heroDesc.textContent = info.desc || "";
      el.heroLeft.textContent = "还剩 " + mmss(info.left);
      el.heroLeft.classList.remove("idle");
      el.stop.classList.add("on");
    } else {
      // 闲着的时候不要空一圈灰：留一圈很淡的粉，慢慢呼吸，
      // 让人一眼看出「她还在，只是没在做事」。
      el.ring.style.setProperty("--p", 100);
      el.ring.style.setProperty("--c", "rgba(255,143,187,.20)");
      el.heroEmo.textContent = "🐟";
      el.heroName.textContent = MOOD_HERO[mk] || "在发呆";
      el.heroDesc.textContent = "戳一下下面的活动，我就动起来。";
      el.heroLeft.textContent = "闲着";
      el.heroLeft.classList.add("idle");
      el.stop.classList.remove("on");
    }
    el.ring.classList.toggle("idle", !info);

    // 卡片状态
    const busy = !!info;
    Array.prototype.forEach.call(el.acts.children, (node) => {
      const id = node.dataset.id;
      if (id === "__random") {
        node.classList.toggle("busy", busy);
        return;
      }
      const a = byId[id];
      if (!a) return;
      const isActive = busy && info.id === id;
      node.classList.toggle("active", isActive);
      node.classList.toggle("busy", !isActive && busy);
      node.classList.toggle("locked", !isActive && !busy && !!a.blocked);
      const d = node.querySelector(".d");
      if (isActive) d.textContent = mmss(info.left);
      else if (a.cdLeft > 0) d.textContent = Math.ceil(a.cdLeft / 1000) + "s";
      else if (a.blocked) d.textContent = "歇会儿";
      else d.textContent = a.dur + "s";
    });

    // 食物 / 互动冷却
    const cd = P.cooldown();
    if (el.foodHint) el.foodHint.textContent = cd.feed > 0 ? "冷却中 " + Math.ceil(cd.feed / 1000) + "s" : "想吃就点";
    Array.prototype.forEach.call(el.foods.children, (node) => {
      const on = cd.feed > 0;
      node.classList.toggle("cool", on);
      node.style.setProperty("--cool", on ? Math.round(100 * (1 - cd.feed / cd.feedTotal)) : 0);
    });
    const mkCool = (node, left, total) => {
      const on = left > 0;
      node.classList.toggle("cool", on);
      node.style.setProperty("--cool", on ? Math.round(100 * (1 - left / total)) : 0);
    };
    mkCool(el.play, cd.play, cd.playTotal);
    mkCool(el.touch, cd.pet, cd.petTotal);

    // 计数 + 最近记录（页脚右边只留总次数，明细放到上面的最近列表）
    el.fFed.textContent = "喂了 " + s.totalFed;
    el.fPlay.textContent = "玩了 " + s.totalPlay;
    el.fPet.textContent = "摸了 " + s.totalPet;
    el.fLast.textContent = "共做过 " + (s.totalAct || 0) + " 次";
    renderRecent(s);

    // 自动结束：活动没了但上一帧还在 → 取结算结果，通知主窗
    if (prevActId && !info) {
      const st = P.takeSettle && P.takeSettle();
      if (st && !st.stopped) {
        say(st.line || "做完了。");
        notify("act.done", { id: st.id, line: st.line });
      } else if (st && st.stopped) {
        notify("act.stop", { id: st.id, line: st.line });
      }
      prevActId = null;
    }
    if (info) prevActId = info.id;
  }

  // 面板是在活动进行到一半时打开的：把状态补发给主窗，不然她不演了
  function syncRunning() {
    const s = P.snapshot();
    if (s.act) {
      prevActId = s.act.id;
      const a = byId[s.act.id] || {};
      notify("act.start", { id: s.act.id, name: s.act.name, emoji: s.act.emoji, scene: a.scene, line: "" });
    }
  }

  // 主窗那边改了什么（喂食、摸摸头）也让数字动起来
  ch.addEventListener("message", (ev) => {
    const k = (ev.data && ev.data.kind) || "";
    if (k.indexOf("panel.") === 0) return;
    paint();
  });

  buildActs();
  buildFoods();
  paint();
  syncRunning();
  setInterval(paint, 500);

  requestAnimationFrame(() => el.panel.classList.add("show"));
})();
