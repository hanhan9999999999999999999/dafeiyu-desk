// 大肥鱼 · 状态与活动
// 这个文件被两个窗口同时加载：主窗（index.html）和状态面板（petpanel.html）。
// 数据存在 localStorage 里，两个窗口按 origin 共享同一份，不需要跨进程同步。
// 只有「做了事要让她有反应」需要通知主窗 —— 那部分走 BroadcastChannel。
(function () {
  "use strict";

  const KEY = "dafeiyu.pet";
  const HOUR = 60 * 60 * 1000;
  // 好感不再封顶 100：长期相处应该有下一级可走。
  // 0-100 仍然是最常用的区间，往上每 100 左右一个称号。
  const MAX_FAVOR = 999;

  // 关系等级。阈值是累计好感，只增不减；每一级给一句她自己的说法。
  const LEVELS = [
    { at: 0, name: "初见", desc: "还在互相打量，说话都客气。" },
    { at: 20, name: "熟悉", desc: "听见你回来，会抬头看一眼。" },
    { at: 60, name: "亲近", desc: "愿意把后背交给你，困了也不躲。" },
    { at: 120, name: "依赖", desc: "你出门久了，她会趴在窗边等。" },
    { at: 200, name: "默契", desc: "不用说完，她也知道你想说什么。" },
    { at: 320, name: "形影不离", desc: "你走到哪，她的视线就跟到哪。" },
    { at: 500, name: "本命", desc: "这只鲸鱼，只认你一个主人。" },
    { at: 750, name: "永远", desc: "再久也不会腻，这是她说好的。" },
  ];

  // 成就：全部从现有计数推导，不额外存「已解锁」状态，旧存档直接就有进度。
  // 唯一需要新存的是 foodMask（四种零食各吃过没有）。
  const ACHIEVEMENTS = [
    { id: "first-feed", emoji: "🐟", name: "第一口", desc: "喂她吃第一口", test: (s) => s.totalFed >= 1 },
    { id: "feed-10", emoji: "🍱", name: "投喂员", desc: "累计投喂 10 次", test: (s) => s.totalFed >= 10 },
    { id: "pet-30", emoji: "🫳", name: "摸头杀", desc: "累计摸头 30 次", test: (s) => s.totalPet >= 30 },
    { id: "play-10", emoji: "🎾", name: "玩伴", desc: "陪她玩 10 次", test: (s) => s.totalPlay >= 10 },
    { id: "act-20", emoji: "🗓️", name: "一起过日子", desc: "完成 20 次活动", test: (s) => s.totalAct >= 20 },
    { id: "food-4", emoji: "🍽️", name: "不挑食", desc: "四种零食都吃过", test: (s) => (s.foodMask & 15) === 15 },
    { id: "all-act", emoji: "🌈", name: "都陪你做", desc: "13 种活动各做过一次", test: (s) => Object.keys(s.actDone || {}).filter((id) => byId[id]).length >= ACTS.length },
    { id: "favor-120", emoji: "💙", name: "依赖", desc: "好感达到 120", test: (s) => s.favor >= 120 },
    { id: "favor-320", emoji: "✨", name: "形影不离", desc: "好感达到 320", test: (s) => s.favor >= 320 },
    { id: "days-7", emoji: "📅", name: "第七天", desc: "陪她满 7 天", test: (s) => Math.floor((Date.now() - num(s.bornAt, Date.now())) / (24 * HOUR)) + 1 >= 7 },
  ];

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
    // 当天计数与最近两周的档案（相处报告用）
    today: {},
    history: [],
    // 四种零食各吃过没有的位掩码
    foodMask: 0,
    // 已经提醒过的徽章：新解锁时只在气泡里说一次，不重复刷屏。
    achSeen: [],
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
      fx: { hunger: 30, energy: 6, favor: 2, clean: -3 },
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
  const pad2 = (n) => (n < 10 ? "0" + n : String(n));

  // 本地日期键（不是 UTC）：相处报告按用户看到的「今天」算。
  function dayKey(ts) {
    const d = new Date(ts === undefined ? Date.now() : ts);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  // 跨天时把昨天那份收进 history，再开一份新的。
  // 不能只在 snapshot 里做：窗口关着的时候没人调 snapshot。
  function ensureDay() {
    const key = dayKey();
    if (!state.today || typeof state.today !== "object") state.today = {};
    if (state.today.key === key) return;
    const old = state.today;
    if (old && old.key) {
      const touched = (old.fed || 0) + (old.play || 0) + (old.pet || 0) + (old.act || 0) + (old.sec || 0);
      if (touched) {
        state.history = (Array.isArray(state.history) ? state.history : [])
          .filter((x) => x && x.key && x.key !== old.key);
        state.history.unshift({ ...old });
        state.history = state.history.slice(0, 14);
      }
    }
    state.today = { key, fed: 0, play: 0, pet: 0, act: 0, sec: 0 };
    save();
  }

  function dayBump(field, n) {
    ensureDay();
    const cur = num(state.today[field], 0);
    state.today[field] = cur + (n === undefined ? 1 : n);
  }

  function levelUpFrom(beforeName) {
    const lv = levelInfo(state.favor);
    return lv.name !== beforeName ? lv : null;
  }

  function levelInfo(favor) {
    const f = clamp(num(favor, 0), 0, MAX_FAVOR);
    let i = 0;
    for (let k = 0; k < LEVELS.length; k += 1) if (f >= LEVELS[k].at) i = k;
    const cur = LEVELS[i];
    const next = LEVELS[i + 1] || null;
    const span = next ? next.at - cur.at : 1;
    return {
      i,
      name: cur.name,
      desc: cur.desc,
      at: cur.at,
      favor: Math.round(f * 10) / 10,
      max: MAX_FAVOR,
      next: next ? next.name : "",
      nextAt: next ? next.at : null,
      need: next ? Math.max(0, Math.round((next.at - f) * 10) / 10) : 0,
      progress: next ? clamp((f - cur.at) / span, 0, 1) : 1,
    };
  }

  function achievements() {
    const out = ACHIEVEMENTS.map((a) => {
      let got = false;
      try { got = !!a.test(state); } catch (e) { got = false; }
      return { id: a.id, emoji: a.emoji, name: a.name, desc: a.desc, got };
    });
    return { list: out, got: out.filter((a) => a.got).length, total: out.length };
  }

  // 动作 → 面板/主窗只提示「这次新拿到的」，已经提醒过的不再刷。
  // 不在这里 save：调用它的动作自己会 save，合并成一次写盘。
  function checkAch() {
    const seen = new Set(Array.isArray(state.achSeen) ? state.achSeen : []);
    const fresh = [];
    ACHIEVEMENTS.forEach((a) => {
      let got = false;
      try { got = !!a.test(state); } catch (e) { got = false; }
      if (got && !seen.has(a.id)) {
        seen.add(a.id);
        fresh.push({ id: a.id, emoji: a.emoji, name: a.name, desc: a.desc });
      }
    });
    state.achSeen = [...seen];
    return fresh;
  }

  // 最近 7 天（含今天）的活动柱：没记录的日期补 0，图表才不会跳。
  function weekData() {
    ensureDay();
    const map = new Map();
    (Array.isArray(state.history) ? state.history : []).forEach((x) => {
      if (x && x.key) map.set(x.key, x);
    });
    map.set(state.today.key, state.today);
    const wd = ["日", "一", "二", "三", "四", "五", "六"];
    const out = [];
    const base = new Date();
    base.setHours(12, 0, 0, 0);
    for (let i = 6; i >= 0; i -= 1) {
      const t = base.getTime() - i * 24 * HOUR;
      const key = dayKey(t);
      const e = map.get(key) || {};
      const total = num(e.fed, 0) + num(e.play, 0) + num(e.pet, 0) + num(e.act, 0);
      out.push({
        key,
        label: wd[new Date(t).getDay()],
        fed: num(e.fed, 0),
        play: num(e.play, 0),
        pet: num(e.pet, 0),
        act: num(e.act, 0),
        sec: num(e.sec, 0),
        total,
        today: i === 0,
      });
    }
    return out;
  }


  function load() {
    let raw = null;
    let rawText = "";
    let bad = false;
    try {
      rawText = localStorage.getItem(KEY) || "null";
      raw = JSON.parse(rawText);
    } catch (e) {
      raw = null;
      bad = true;
    }
    // 存档坏了不要静默清空：留一份原始文本在旁边的键里，
    // 用户至少还能找人把好感/天数捞回来。只留最近一份，避免每次 load 都膨胀。
    if (bad && rawText && rawText !== "null") {
      try {
        localStorage.setItem(KEY + ".bad", JSON.stringify({ at: Date.now(), raw: rawText.slice(0, 200000) }));
      } catch (e) { }
    }
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
    state.favor = clamp(state.favor, 0, MAX_FAVOR);
    state.energy = clamp(state.energy, 0, 100);
    state.clean = clamp(state.clean, 0, 100);
    // 老存档没有 achSeen：把「按当前进度已经拿到的」静默记为已提醒，
    // 不然升级后第一次喂食会一口气弹出 9 个徽章。新存档这里是空的，正常解锁。
    const seen = new Set(Array.isArray(state.achSeen) ? state.achSeen.filter((x) => typeof x === "string") : []);
    if (!raw || !Array.isArray(raw.achSeen)) {
      ACHIEVEMENTS.forEach((a) => { try { if (a.test(state)) seen.add(a.id); } catch (e) { } });
    }
    state.achSeen = [...seen];
    if (!state.act || !byId[state.act.id] || !Number.isFinite(Number(state.act.end))) state.act = null;
    // 活动记录里可能有旧版本留下的东西，过滤掉不认识的 id
    state.actLog = state.actLog.filter((x) => x && byId[x.id]).slice(0, 24);
    ensureDay();
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
    state[k] = clamp(cur + v, 0, k === "favor" ? MAX_FAVOR : 100);
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
    dayBump("act");
    refreshMood();
    save();
    return { ok: true, act: actInfo(), def: { id: def.id, name: def.name, emoji: def.emoji }, start: def.start };
  }

  function settle(ratio) {
    const a = state.act;
    if (!a) return null;
    // 主窗和状态面板各自有 1 秒 tick；到点时谁先结算不该靠运气。
    // 让主进程做一次原子认领：同一个活动只有一个窗口能真正结算。
    try {
      if (typeof window !== "undefined" && window.deskfish && window.deskfish.claimSettle) {
        const key = String(a.id) + "@" + String(a.start);
        if (!window.deskfish.claimSettle(key)) {
          state.act = null;
          save();
          return null;
        }
      }
    } catch (e) { }
    const def = byId[a.id];
    const r = clamp(ratio, 0, 1);
    const lvBefore = levelInfo(state.favor).name;
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
    const spent = Math.round((Date.now() - num(a.start, Date.now())) / 1000);
    if (spent > 0) dayBump("sec", spent);
    state.actLog.unshift({
      id: a.id, sec: spent,
      stopped: r < 0.999, at: Date.now(),
    });
    state.actLog = state.actLog.slice(0, 24);
    const unlocked = checkAch();
    const levelUp = levelUpFrom(lvBefore);
    lastSettle = {
      id: a.id,
      name: def ? def.name : "",
      emoji: def ? def.emoji : "",
      ratio: r,
      stopped: r < 0.999,
      unlocked,
      levelUp,
      line: def ? (r < 0.999 ? "好，那就先停一下。" : def.done) : "做完了。",
      at: Date.now(),
    };
    state.act = null;
    refreshMood();
    save();
    return { def: def ? { id: def.id, name: def.name, emoji: def.emoji } : null, applied, ratio: r, unlocked, levelUp };
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
      unlocked: r.unlocked || [],
      levelUp: r.levelUp || null,
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
      unlocked: r.unlocked || [], levelUp: r.levelUp || null,
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
    const lvBefore = levelInfo(state.favor).name;
    state.lastFed = Date.now();
    state.totalFed += 1;
    state.foodMask = (num(state.foodMask, 0) | (1 << idx));
    dayBump("fed");
    bump("hunger", food.gain);
    bump("favor", food.favor);
    bump("energy", food.energy || 0);
    bump("clean", -1);
    refreshMood();
    const unlocked = checkAch();
    const levelUp = levelUpFrom(lvBefore);
    save();
    return { ok: true, food: food.name, gain: food.gain, favor: food.favor, idx, key: food.key, unlocked, levelUp };
  }

  function play() {
    if (state.act) {
      const cur = byId[state.act.id];
      return { ok: false, why: "我正" + (cur ? cur.name : "忙") + "呢" };
    }
    const cd = PLAY_CD - (Date.now() - num(state.lastPlay, 0));
    if (cd > 0) return { ok: false, why: "刚玩过，让我歇会儿", cd };
    if (state.energy < 12) return { ok: false, why: "没力气玩了……想躺着" };
    const lvBefore = levelInfo(state.favor).name;
    state.lastPlay = Date.now();
    state.totalPlay += 1;
    dayBump("play");
    bump("favor", 6);
    bump("hunger", -4);
    bump("energy", -6);
    bump("clean", -2);
    refreshMood();
    const unlocked = checkAch();
    const levelUp = levelUpFrom(lvBefore);
    save();
    return { ok: true, favor: 6, unlocked, levelUp };
  }

  function pet() {
    const cd = PET_CD - (Date.now() - num(state.lastPet, 0));
    if (cd > 0) return { ok: false, why: "摸得太勤了", cd };
    const lvBefore = levelInfo(state.favor).name;
    state.lastPet = Date.now();
    state.totalPet += 1;
    dayBump("pet");
    const sleeping = state.act && (state.act.id === "sleep" || state.act.id === "rest");
    bump("favor", sleeping ? 1 : 2);
    refreshMood();
    const unlocked = checkAch();
    const levelUp = levelUpFrom(lvBefore);
    save();
    return { ok: true, favor: sleeping ? 1 : 2, sleeping: !!sleeping, unlocked, levelUp };
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
    ensureDay();
    const days = Math.max(1, Math.floor((Date.now() - num(state.bornAt, Date.now())) / (24 * HOUR)) + 1);
    return {
      hunger: Math.round(state.hunger),
      favor: Math.round(state.favor * 10) / 10,
      favorMax: MAX_FAVOR,
      energy: Math.round(state.energy),
      clean: Math.round(state.clean),
      mood: state.mood,
      days,
      level: levelInfo(state.favor),
      today: { ...state.today },
      week: weekData(),
      ach: achievements(),
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
        desc: a.desc, scene: a.scene, fx: a.fx, done: a.done,
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
  // 主窗、状态面板、相处档案各自持有一份内存状态；别的窗口写盘后要跟着刷新，
  // 否则下一次 decay/save 会把对方刚做的喂食、摸头覆盖回去。
  // storage 事件只在「其他窗口」触发，不会形成本窗口自激循环。
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("storage", (e) => {
      if (!e || e.key !== KEY || !e.newValue) return;
      try { load(); } catch (err) { }
    });
  }
  setInterval(decay, 60000);
  // 到点结算也要有人推：面板不一定一直开着，主窗这边兜底。
  setInterval(() => { const r = tickAct(); if (r) save(); }, 1000);

  window.FishPet = {
    snapshot, feed, play, pet, grow, maybeComplain,
    foods: FOODS.map((f, i) => ({ i, name: f.name, gain: f.gain, favor: f.favor, key: f.key })),
    cooldown,
    acts, startAct, stopAct, tickAct, actInfo,
    level: () => levelInfo(state.favor),
    achievements, week: weekData,
    takeSettle() { const v = lastSettle; lastSettle = null; return v; },
  };
})();
