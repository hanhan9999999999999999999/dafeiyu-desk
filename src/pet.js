// 大肥鱼 · 状态与活动
// 这个文件被两个窗口同时加载：主窗（index.html）和状态面板（petpanel.html）。
// 数据存在 localStorage 里，两个窗口按 origin 共享同一份，不需要跨进程同步。
// 只有「做了事要让她有反应」需要通知主窗 —— 那部分走 BroadcastChannel。
(function () {
  "use strict";

  const KEY = "dafeiyu.pet";
  const HOUR = 60 * 60 * 1000;

  // 饱腹 / 好感 / 精力 / 清洁，四条都是 0-100。
  // 以前只有饱腹和好感，活动系统加进来之后需要后两条来支撑「累」「脏」这两类状态。
  const DEFAULTS = {
    hunger: 72,
    favor: 12,
    energy: 78,
    clean: 82,
    mood: "calm",
    lastFed: 0,
    lastPlay: 0,
    lastPet: 0,
    bornAt: 0,
    totalFed: 0,
    totalPlay: 0,
    totalPet: 0,
    totalAct: 0,
    act: null,
    actDone: {},
    actLog: [],
    lastTick: 0,
  };

  // 活动表。字段含义：
  //   dur   秒，活动总时长
  //   cd    秒，做完之后的冷却（防止刷同一种）
  //   need  开始前的门槛（不够就提示）
  //   fx    结算时的属性效果；中途终止按时间比例打折
  //   scene 主窗要播的动作场景（FishMotionScenes 里的键）
  //   start/done 面板和主窗的台词
  const ACTS = [
    {
      id: "eat", name: "好好吃一顿", emoji: "🍱", dur: 20, cd: 45,
      need: { hunger: 8 }, fx: { hunger: 30, energy: 6, favor: 2, clean: -3 },
      scene: "actEat", desc: "慢慢吃完，不看手机",
      start: "那我开动啦，你别盯着我看，我会不好意思。",
      done: "吃饱了……肚子暖暖的，心情也好了。",
    },
    {
      id: "rest", name: "打个盹", emoji: "😴", dur: 60, cd: 90,
      fx: { energy: 20, hunger: -4, clean: -1 }, scene: "actRest",
      desc: "靠着椅子眯一会儿",
      start: "就眯十分钟……你小声一点。",
      done: "唔……睡了一小会儿，眼睛没那么涩了。",
    },
    {
      id: "sleep", name: "睡一觉", emoji: "🌙", dur: 180, cd: 300,
      fx: { energy: 36, hunger: -8, favor: 1 }, scene: "actSleep",
      desc: "真的躺下睡，别叫醒我",
      start: "我躺一会儿……晚安，主人。",
      done: "睡饱了，脑子清清爽爽的。",
    },
    {
      id: "bath", name: "泡个澡", emoji: "🫧", dur: 50, cd: 240,
      fx: { clean: 34, energy: -4, favor: 2 }, scene: "actBath",
      desc: "热水泡到肩膀，慢一点",
      start: "水温刚好……你、你别偷看啊。",
      done: "身上香香的，整个人都软下来了。",
    },
    {
      id: "groom", name: "梳梳毛", emoji: "🧴", dur: 35, cd: 120,
      fx: { clean: 16, favor: 5 }, scene: "actGroom",
      desc: "把翘起来的呆毛压下去",
      start: "这里……对，就是这里，轻一点。",
      done: "头发顺了，看着是不是乖一点？",
    },
    {
      id: "play", name: "出去玩", emoji: "🎾", dur: 45, cd: 90,
      need: { energy: 15 }, fx: { favor: 8, energy: -12, hunger: -7, clean: -7 },
      scene: "actPlay", desc: "跑一跑，把力气用掉",
      start: "走啦走啦！这次我一定跑得比你快。",
      done: "累死了……但是很好玩，下次还去。",
    },
    {
      id: "stretch", name: "伸个懒腰", emoji: "🙆", dur: 12, cd: 40,
      fx: { energy: 5, favor: 1 }, scene: "actStretch",
      desc: "活动一下僵掉的肩颈",
      start: "唔——伸一下，骨头都响了。",
      done: "舒服多了，感觉又活过来了。",
    },
    {
      id: "sun", name: "晒太阳", emoji: "☀️", dur: 90, cd: 180,
      fx: { energy: 10, favor: 3, clean: 2, hunger: -2 }, scene: "actSun",
      desc: "找个有光的窗边坐着",
      start: "这边的太阳好暖……你也过来晒晒嘛。",
      done: "晒得暖烘烘的，身上还有太阳的味道。",
    },
    {
      id: "read", name: "看会儿书", emoji: "📖", dur: 80, cd: 150,
      fx: { favor: 3, energy: -4 }, scene: "actRead",
      desc: "安静地翻几页，不被打扰",
      start: "这一页我看了三遍了……别吵。",
      done: "看完了。刚才那段，我想讲给你听。",
    },
    {
      id: "sing", name: "唱首歌", emoji: "🎤", dur: 25, cd: 120,
      fx: { favor: 6, energy: -6 }, scene: "actSing",
      desc: "就唱一小段，跑调不许笑",
      start: "就一段啊……跑调了不准笑我。",
      done: "唱完了。你刚才是不是在偷偷录音？",
    },
    {
      id: "movie", name: "看电影", emoji: "🎬", dur: 140, cd: 300,
      fx: { favor: 7, energy: -2, hunger: -5 }, scene: "actMovie",
      desc: "窝着看一部，别剧透",
      start: "开始了开始了，别说话。",
      done: "结尾我猜到了……但还是有点想哭。",
    },
    {
      id: "walk", name: "散个步", emoji: "🚶", dur: 70, cd: 120,
      need: { energy: 12 }, fx: { favor: 5, energy: -8, hunger: -6, clean: -4 },
      scene: "actWalk", desc: "沿着楼下那条路慢慢走",
      start: "不用走快，就随便逛逛。",
      done: "走了一圈，风把脑子吹清楚了。",
    },
    {
      id: "daze", name: "发会儿呆", emoji: "💭", dur: 40, cd: 60,
      fx: { energy: 4, clean: 0 }, scene: "actDaze",
      desc: "什么都不做，就看着窗外",
      start: "我在想一件很小的事……不告诉你。",
      done: "想明白了。其实也没什么大不了的。",
    },
  ];

  const byId = {};
  ACTS.forEach((a) => { byId[a.id] = a; });

  const FOODS = [
    { name: "小鱼干", gain: 18, favor: 2, energy: 2, key: "food.fish" },
    { name: "布丁", gain: 14, favor: 4, energy: 4, key: "food.pudding" },
    { name: "热可可", gain: 10, favor: 3, energy: 6, key: "food.cocoa" },
    { name: "月亮糕", gain: 22, favor: 5, energy: 3, key: "food.moon" },
  ];

  const FEED_CD = 20000;
  const PLAY_CD = 30000;
  const PET_CD = 8000;

  let state = null;
  let saveTimer = 0;
  // 最近一次结算的结果。面板不一定能把 tickAct 的返回值抢到手（pet.js 自己也
  // 在每秒兜底结算），所以这里留一份，面板发现活动没了就来取。
  let lastSettle = null;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const num = (v, fb) => (Number.isFinite(Number(v)) ? Number(v) : fb);

  function load() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { raw = null; }
    const s = {};
    Object.keys(DEFAULTS).forEach((k) => {
      const def = DEFAULTS[k];
      if (Array.isArray(def)) s[k] = [];
      else if (def && typeof def === "object") s[k] = {};
      else s[k] = def;
    });
    if (raw && typeof raw === "object") {
      Object.keys(DEFAULTS).forEach((k) => {
        if (raw[k] === undefined || raw[k] === null) return;
        const def = DEFAULTS[k];
        if (Array.isArray(def)) {
          if (Array.isArray(raw[k])) s[k] = raw[k].slice(0, 24);
          return;
        }
        if (def && typeof def === "object") {
          if (typeof raw[k] === "object" && !Array.isArray(raw[k])) Object.assign(s[k], raw[k]);
          return;
        }
        if (typeof def === "number") {
          const n = Number(raw[k]);
          if (Number.isFinite(n)) s[k] = n;
          return;
        }
        s[k] = raw[k];
      });
    }
    state = s;
    if (!state.bornAt) state.bornAt = Date.now();
    if (!state.lastTick) state.lastTick = Date.now();
    state.hunger = clamp(state.hunger, 0, 100);
    state.favor = clamp(state.favor, 0, 100);
    state.energy = clamp(state.energy, 0, 100);
    state.clean = clamp(state.clean, 0, 100);
    if (!state.act || !byId[state.act.id] || !Number.isFinite(Number(state.act.end))) state.act = null;
    // 活动记录里可能有旧版本留下的东西，过滤掉不认识的 id
    state.actLog = state.actLog.filter((x) => x && byId[x.id]).slice(0, 24);
    decay(true);
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { }
    }, 400);
  }

  function bump(k, v) {
    if (!Object.prototype.hasOwnProperty.call(state, k)) return;
    const cur = num(state[k], 0);
    state[k] = clamp(cur + v, 0, 100);
  }

  function refreshMood() {
    const a = state.act && byId[state.act.id];
    if (a) {
      if (a.id === "sleep" || a.id === "rest") state.mood = "sleepy";
      else if (a.id === "eat" || a.id === "play") state.mood = "happy";
      else if (a.id === "bath" || a.id === "groom") state.mood = "shy";
      else state.mood = "calm";
      return;
    }
    const h = new Date().getHours();
    if (state.hunger < 18) state.mood = "hungry";
    else if (state.energy < 22) state.mood = "sleepy";
    else if (state.clean < 20) state.mood = "pout";
    else if (h >= 23 || h <= 5) state.mood = "sleepy";
    else if (state.favor > 70) state.mood = "happy";
    else state.mood = "calm";
  }

  // 按小时衰减。silent=true 时只更新数值，不写盘（给 snapshot 这种高频调用用）。
  function decay(silent) {
    const now = Date.now();
    const last = num(state.lastTick, now);
    let hours = (now - last) / HOUR;
    if (!(hours > 0)) {
      state.lastTick = now;
      if (!silent) save();
      return;
    }
    const h = Math.min(hours, 12);
    bump("hunger", -5 * h);
    bump("energy", -2.2 * h);
    bump("clean", -1.4 * h);
    if (state.hunger < 20 && hours > 6) bump("favor", -Math.min(3, hours * 0.2));
    if (state.clean < 15 && hours > 8) bump("favor", -Math.min(1.5, hours * 0.2));
    state.lastTick = now;
    refreshMood();
    if (!silent) save();
  }

  // ── 活动 ──────────────────────────────────────────────
  function actLeft() {
    if (!state.act) return 0;
    return Math.max(0, num(state.act.end, 0) - Date.now());
  }

  function actInfo() {
    const a = state.act;
    if (!a) return null;
    const def = byId[a.id];
    if (!def) return null;
    const total = num(a.end, 0) - num(a.start, 0);
    const left = actLeft();
    return {
      id: a.id, name: def.name, emoji: def.emoji, desc: def.desc,
      total, left, progress: total > 0 ? clamp(1 - left / total, 0, 1) : 1,
      scene: def.scene,
    };
  }

  function readyAt(id) {
    const def = byId[id];
    if (!def) return 0;
    const last = num(state.actDone[id], 0);
    return Math.max(0, last + (def.cd || 0) * 1000 - Date.now());
  }

  function needText(def) {
    if (!def.need) return "";
    const miss = [];
    if (def.need.energy && state.energy < def.need.energy) miss.push("体力不够（要 " + def.need.energy + "）");
    if (def.need.hunger && state.hunger < def.need.hunger) miss.push("肚子太空");
    if (def.need.clean && state.clean < def.need.clean) miss.push("该先洗个澡");
    return miss.join("，");
  }

  function startAct(id) {
    const def = byId[id];
    if (!def) return { ok: false, why: "没有这个活动" };
    if (state.act) {
      const cur = byId[state.act.id];
      return { ok: false, why: "我正在" + (cur ? cur.name : "忙") + "呢", busy: true };
    }
    decay(true);
    const need = needText(def);
    if (need) return { ok: false, why: need };
    const cd = readyAt(id);
    if (cd > 0) return { ok: false, why: "刚弄完，歇 " + Math.ceil(cd / 1000) + " 秒再来" };
    const now = Date.now();
    state.act = { id, start: now, end: now + def.dur * 1000 };
    state.totalAct += 1;
    refreshMood();
    save();
    return { ok: true, act: actInfo(), def: { id: def.id, name: def.name, emoji: def.emoji }, start: def.start };
  }

  function settle(ratio) {
    const a = state.act;
    if (!a) return null;
    const def = byId[a.id];
    const r = clamp(ratio, 0, 1);
    const applied = {};
    if (def) {
      Object.keys(def.fx).forEach((k) => {
        const v = def.fx[k] * r;
        if (!v) return;
        bump(k, v);
        applied[k] = Math.round(v * 10) / 10;
      });
    }
    state.actDone[a.id] = Date.now();
    state.actLog.unshift({
      id: a.id, sec: Math.round((Date.now() - num(a.start, Date.now())) / 1000),
      stopped: r < 0.999, at: Date.now(),
    });
    state.actLog = state.actLog.slice(0, 24);
    lastSettle = {
      id: a.id,
      name: def ? def.name : "",
      emoji: def ? def.emoji : "",
      ratio: r,
      stopped: r < 0.999,
      line: def ? (r < 0.999 ? "好，那就先停一下。" : def.done) : "做完了。",
      at: Date.now(),
    };
    state.act = null;
    refreshMood();
    save();
    return { def: def ? { id: def.id, name: def.name, emoji: def.emoji } : null, applied, ratio: r };
  }

  function stopAct() {
    if (!state.act) return { ok: false, why: "现在没在忙" };
    const a = state.act;
    const total = Math.max(1, num(a.end, 0) - num(a.start, 0));
    const ratio = clamp((Date.now() - num(a.start, 0)) / total, 0, 1);
    const r = settle(ratio);
    const def = byId[a.id];
    return {
      ok: true,
      act: r.def,
      applied: r.applied,
      ratio,
      line: ratio < 0.35 ? "唔……才刚开始呢，算了。" : "好，那就先停一下。",
      done: def ? def.done : "",
    };
  }

  // 到点自动结算；面板每 0.5 秒调一次，pet.js 自己也每秒兜底。
  function tickAct() {
    if (!state.act) return null;
    if (Date.now() < num(state.act.end, 0)) return null;
    const def = byId[state.act.id];
    const r = settle(1);
    return {
      ok: true, finished: true, act: r.def, applied: r.applied,
      line: def ? def.done : "做完了。",
    };
  }

  // ── 喂食 / 互动 ─────────────────────────────────────
  function feed(which) {
    const idx = Number(which) | 0;
    const food = FOODS[idx];
    if (!food) return { ok: false, why: "没有这个吃的" };
    if (state.act) {
      const cur = byId[state.act.id];
      if (cur && (cur.id === "sleep" || cur.id === "eat" || cur.id === "bath")) {
        return { ok: false, why: "我正" + cur.name + "呢，等下再吃", food: food.name, idx };
      }
    }
    const cd = FEED_CD - (Date.now() - num(state.lastFed, 0));
    if (cd > 0) return { ok: false, why: "刚吃过啦", food: food.name, idx, key: food.key, cd };
    state.lastFed = Date.now();
    state.totalFed += 1;
    bump("hunger", food.gain);
    bump("favor", food.favor);
    bump("energy", food.energy || 0);
    bump("clean", -1);
    refreshMood();
    save();
    return { ok: true, food: food.name, gain: food.gain, favor: food.favor, idx, key: food.key };
  }

  function play() {
    if (state.act) {
      const cur = byId[state.act.id];
      return { ok: false, why: "我正" + (cur ? cur.name : "忙") + "呢" };
    }
    const cd = PLAY_CD - (Date.now() - num(state.lastPlay, 0));
    if (cd > 0) return { ok: false, why: "刚玩过，让我歇会儿", cd };
    if (state.energy < 12) return { ok: false, why: "没力气玩了……想躺着" };
    state.lastPlay = Date.now();
    state.totalPlay += 1;
    bump("favor", 6);
    bump("hunger", -4);
    bump("energy", -6);
    bump("clean", -2);
    refreshMood();
    save();
    return { ok: true, favor: 6 };
  }

  function pet() {
    const cd = PET_CD - (Date.now() - num(state.lastPet, 0));
    if (cd > 0) return { ok: false, why: "摸得太勤了", cd };
    state.lastPet = Date.now();
    state.totalPet += 1;
    const sleeping = state.act && (state.act.id === "sleep" || state.act.id === "rest");
    bump("favor", sleeping ? 1 : 2);
    refreshMood();
    save();
    return { ok: true, favor: sleeping ? 1 : 2, sleeping: !!sleeping };
  }

  function grow(extraFavor) {
    const add = Number(extraFavor);
    if (!Number.isFinite(add) || add === 0) return snapshot();
    bump("favor", add);
    refreshMood();
    save();
    return snapshot();
  }

  function maybeComplain() {
    decay(true);
    if (state.act) return "";
    if (state.energy < 15) return "眼皮好沉……我可能真的需要睡一会儿";
    if (state.clean < 16) return "身上有点黏……我想去泡个澡";
    if (state.hunger < 15 && Date.now() - num(state.lastFed, 0) > HOUR) return "饿了……主人，我饿好久了";
    if (state.hunger < 30) return "肚子有点空";
    return "";
  }

  function snapshot() {
    decay(true);
    const days = Math.max(1, Math.floor((Date.now() - num(state.bornAt, Date.now())) / (24 * HOUR)) + 1);
    return {
      hunger: Math.round(state.hunger),
      favor: Math.round(state.favor * 10) / 10,
      energy: Math.round(state.energy),
      clean: Math.round(state.clean),
      mood: state.mood,
      days,
      totalFed: state.totalFed,
      totalPlay: state.totalPlay,
      totalPet: state.totalPet,
      totalAct: state.totalAct,
      act: actInfo(),
      log: state.actLog.slice(0, 6),
    };
  }

  function acts() {
    return ACTS.map((a) => {
      const cd = readyAt(a.id);
      const need = needText(a);
      return {
        id: a.id, name: a.name, emoji: a.emoji, dur: a.dur, cd: a.cd,
        desc: a.desc, scene: a.scene, fx: a.fx,
        cdLeft: cd, blocked: need || "", ready: !cd && !need && !state.act,
      };
    });
  }

  function cooldown() {
    return {
      feed: Math.max(0, FEED_CD - (Date.now() - num(state.lastFed, 0))),
      play: Math.max(0, PLAY_CD - (Date.now() - num(state.lastPlay, 0))),
      pet: Math.max(0, PET_CD - (Date.now() - num(state.lastPet, 0))),
      feedTotal: FEED_CD, playTotal: PLAY_CD, petTotal: PET_CD,
    };
  }

  load();
  setInterval(decay, 60000);
  // 到点结算也要有人推：面板不一定一直开着，主窗这边兜底。
  setInterval(() => { const r = tickAct(); if (r) save(); }, 1000);

  window.FishPet = {
    snapshot, feed, play, pet, grow, maybeComplain,
    foods: FOODS.map((f, i) => ({ i, name: f.name, gain: f.gain, favor: f.favor, key: f.key })),
    cooldown,
    acts, startAct, stopAct, tickAct, actInfo,
    takeSettle() { const v = lastSettle; lastSettle = null; return v; },
  };
})();
