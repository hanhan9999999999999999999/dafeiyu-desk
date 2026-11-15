// 大肥鱼 · 独立桌面挂件 · 渲染与驱动
// 从 dsh-pet 那个版本搬过来，去掉了所有 dsh 依赖。

(() => {
  const vendor = window.__dshPetLive2d;

  // 纯数学（Catmull-Rom 插值、夹取）在 lib/curve.js 里，那边有单元测试（scripts/test-curve.js）。
  // 这里只引用，不再留第二份实现：点击回弹和动作播放本来就是同一条曲线，
  // 各写一份的结果是零跨度兜底一个 Math.max(1e-6, span)、一个 span || 1，改一处漏一处。
  const curveLib = window.__fishCurve || null;
  if (!curveLib) console.error("[fish] lib/curve.js 没加载，动作曲线会退化成直线");
  const curve = curveLib ? curveLib.curve : (t2, pts2) => (pts2 && pts2.length ? pts2[0][1] : 0);
  const clampNum = curveLib ? curveLib.clampNum : (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  // 「下一拍做什么」的策略（情绪 → 表情/动作/交接时长）在 motion-pick.js 里，
  // 那边是纯函数、有单测。没加载时下面各处都会退回旧行为，不会白屏。
  const pickLib = window.FishMotionPick || null;
  if (!pickLib) console.warn("[fish] motion-pick.js 没加载，表情与动作的衔接会退回旧逻辑");

  const stageEl = document.getElementById("stage");
  const bubbleEl = document.getElementById("bubble");
  const errEl = document.getElementById("err");

  // 未捕获错误送到主进程 run.log：打包版从开始菜单启动，没有控制台也没有 DevTools，
  // 不送过去就只剩「她突然不动了」这一句可用信息。同类消息由主进程限次。
  const reportErr = (info) => {
    try {
      if (window.deskfish && window.deskfish.reportError) window.deskfish.reportError(info);
    } catch (e) { /* 上报本身绝不能变成第二个错误 */ }
  };
  window.addEventListener("error", (ev) => {
    reportErr({
      msg: ev.message || "脚本错误",
      file: ev.filename || "",
      line: ev.lineno || 0,
      col: ev.colno || 0,
      stack: (ev.error && ev.error.stack) || "",
    });
  });
  window.addEventListener("unhandledrejection", (ev) => {
    const r = ev.reason;
    reportErr({ msg: (r && r.message) || String(r), stack: (r && r.stack) || "" });
  });

  // 气泡：停留时间按字数算，短句不拖、长句够看；说话时轻微跳动，像在讲话。
  // 太长的句子先收一收，气泡撑满整块屏幕反而什么都读不到。
  // 气泡说一句，第二个参数可选：'happy' | 'shy' | 'annoyed' | 'sad'。
  // 只换边框和光晕的颜色，不换底色——那是她说这话时的温度，不是换了一套 UI 主题。
  const MOODS = ["happy", "shy", "annoyed", "sad"];
  // 气泡里的富文本：模型的回复常带 markdown，原来整段走 textContent 一坨平铺，
  // 多行折成一片、代码和重点全糊在一起。这里只认最小子集，全部用
  // createElement + textContent 建节点，不拼 HTML 字符串——这些字来自外部模型。
  const inlineInto = (parent, s) => {
    const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(~~[^~\n]+~~)|(\*[^*\n]+\*)/g;
    let last = 0;
    let m;
    while ((m = re.exec(s))) {
      if (m.index > last) parent.appendChild(document.createTextNode(s.slice(last, m.index)));
      const tok = m[0];
      let el;
      if (tok.charAt(0) === "`") {
        el = document.createElement("code");
        el.textContent = tok.slice(1, -1);
      } else if (tok.slice(0, 2) === "**") {
        el = document.createElement("strong");
        el.textContent = tok.slice(2, -2);
      } else if (tok.slice(0, 2) === "~~") {
        el = document.createElement("del");
        el.textContent = tok.slice(2, -2);
      } else {
        el = document.createElement("em");
        el.textContent = tok.slice(1, -1);
      }
      parent.appendChild(el);
      last = m.index + tok.length;
    }
    if (last < s.length) parent.appendChild(document.createTextNode(s.slice(last)));
  };
  const renderRich = (el, raw) => {
    el.textContent = "";
    const lines = String(raw == null ? "" : raw).split(/\r?\n/);
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      // 围栏代码块：整块塞进一个 <pre>，缩进原样保留。
      if (/^\s*```/.test(line)) {
        i += 1;
        const buf = [];
        while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i += 1; }
        i += 1;
        const pre = document.createElement("pre");
        pre.className = "code";
        const code = document.createElement("code");
        code.textContent = buf.join("\n");
        pre.appendChild(code);
        el.appendChild(pre);
        continue;
      }
      if (!line.trim()) { i += 1; continue; }
      const hd = /^\s*#{1,6}\s+(.*)$/.exec(line);
      if (hd) {
        const d = document.createElement("div");
        d.className = "hd";
        inlineInto(d, hd[1]);
        el.appendChild(d);
        i += 1;
        continue;
      }
      const li = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
      if (li) {
        const d = document.createElement("div");
        d.className = "li";
        const b = document.createElement("span");
        b.className = "bul";
        b.textContent = "·";
        d.appendChild(b);
        const t = document.createElement("span");
        inlineInto(t, li[1]);
        d.appendChild(t);
        el.appendChild(d);
        i += 1;
        continue;
      }
      const d = document.createElement("div");
      d.className = "ln";
      inlineInto(d, line);
      el.appendChild(d);
      i += 1;
    }
  };
  const fillBubble = (s) => {
    try { renderRich(bubbleEl, s); } catch (e) { bubbleEl.textContent = s; }
    // 气泡平时 pointer-events:none，好让鼠标穿透它去拖窗口。
    // 但内容超过六行时它是能滚的——那时候必须收回鼠标事件，否则滚不动。
    // 只在真溢出时才加这个类，短回复照样穿透。
    requestAnimationFrame(() => {
      try {
        bubbleEl.classList.toggle("scroll", bubbleEl.scrollHeight > bubbleEl.clientHeight + 1);
      } catch (e) { /* 布局还没算好就算了，下次再说 */ }
    });
  };
  // LumenAct 表演钩子：由下面的表演库在初始化时赋值。
  // 放在 say 之前声明是因为 say 是所有台词的唯一出口（气泡、语音、看屏幕点评、
  // 喂食摸头都走它），要在这里拦一句「她说这句话时脸该是什么样」。
  let exprReact = null;
  const say = (t, mood, holdMs, ctx) => {
    if (!t) return;
    let text = String(t).trim();
    if (!text) return;
    // 先让表演库看一眼这句话：命中够强就换成动捕段演，够弱就保持原来的 mood 表情。
    // 放在气泡之前，表情和文字同时到位，不会先出字再慢慢变脸。
    // mood 一起传过去当先验：同一句话用「嘴硬」还是「撒娇」的语气说，脸该不一样。
    // ctx.zone：这句话是在哪个场景说的。摸她、戳她时传 "pet"，
    // 表演库据此挡掉自怜/痛苦那一类表情——被摸头却哭，主人说过「太奇怪了」。
    try { if (exprReact) exprReact(text, Object.assign({ mood }, ctx || {})); } catch (e) { }
    // 不砍字数了：砍到 56 字时 TTS 还在念全文，看得见的和听得见的对不上。
    // 改成按行数限高（CSS 的 max-height），短句照常显示。
    // 长句最多占六行，再长就在视觉上收口（可以自己滚）。
    MOODS.forEach((m) => bubbleEl.classList.remove(m));
    if (mood && MOODS.indexOf(mood) >= 0) bubbleEl.classList.add(mood);
    fillBubble(text);
    bubbleEl.scrollTop = 0;
    bubbleEl.classList.add("on", "talk");
    clearTimeout(say._t);
    // holdMs：少数场景（比如语音引擎冷启动要等二十多秒）需要气泡一直挂着。
    // 不能按字数算——十几个字三秒就没了，等待却还没结束。
    const ms = holdMs > 0 ? holdMs : Math.max(2200, Math.min(9000, 1800 + text.length * 95));
    say._t = setTimeout(() => bubbleEl.classList.remove("on", "talk"), ms);
  };
  // 「她说的话」和「系统提示」分开：系统提示不带动画，也不抢情绪色，
  // 免得每次连接失败都在那儿蹦。
  const hint = (t) => {
    if (!t) return;
    MOODS.forEach((m) => bubbleEl.classList.remove(m));
    fillBubble(String(t).trim());
    bubbleEl.scrollTop = 0;
    bubbleEl.classList.remove("talk");
    bubbleEl.classList.add("on");
    clearTimeout(say._t);
    say._t = setTimeout(() => bubbleEl.classList.remove("on"), 2600);
  };
  const fail = (m) => {
    errEl.style.display = "block";
    errEl.textContent = String(m);
  };
  // voice.js 用：她嘴里说出来的话和气泡里的是同一句。
  window.FishSay = say;
  window.FishHint = hint;

  // ---------- 面板的反应 ----------
  //  面板是独立窗口（petpanel.html），它做完动作会广播过来
  // 这里只负责「让她有反应」：表情 + 台词。
  // 数据是面板那边自己写 localStorage 的，这边不用管。
  // 面板正在进行的活动（吃/睡/洗澡…）。声明放在广播监听前面，是因为那个闭包
  // 要引用它；声明在更后面虽然也能跑，但脚本还在求值时收到消息会撞 TDZ 直接抛错。
  let activity = null;
  let __actPollAt = 0;
  let petPanelOpen = false;
  let __panelPollAt = 0;
  // 排障用：主窗到底认为自己在做什么活动。
  window.__fishAct = () => (activity ? activity.id : null);
  // 活动 → 表情。没有对应项就用默认表情，不要瞎猜一个。
  const ACT_EXPR = {
    eat: "happy", play: "happy", sing: "happy", sun: "happy",
    movie: "sad", read: "default-body", walk: "curious",
    rest: "tired", sleep: "tired", bath: "shy", groom: "shy",
    stretch: "default-body", daze: "default-body",
  };

  if (typeof BroadcastChannel !== "undefined") {
    const PICK = (k, fb) => {
      try {
        if (window.FishLines && window.FishLines.pick) return window.FishLines.pick(k) || fb;
      } catch (e) { }
      return fb;
    };
    const petCh = new BroadcastChannel("dafeiyu-pet");
    petCh.addEventListener("message", (ev) => {
      const kind = (ev.data && ev.data.kind) || "";
      if (typeof setExpr !== "function") return;
      if (kind === "feed") {
        setExpr("happy", 2600);
        try { if (window.FishModel) window.FishModel.actionFor("feed"); } catch (e) { }
        say(PICK("food.fish", "好吃…谢谢你"), "happy", 2400);
      } else if (kind === "play") {
        setExpr("curious", 2400);
        try { if (window.FishModel) window.FishModel.actionFor("more"); } catch (e) { }
        say(PICK("play.ok", "跟你玩挺开心的"), "happy", 2400);
      } else if (kind === "touch") {
        setExpr("shy", 2400);
        try { if (window.FishModel) window.FishModel.actionFor("petHead"); } catch (e) { }
        say(PICK("pet.head", "唔……"), "shy", 2000);
      } else if (kind === "feed.fail") {
        setExpr("pout", 1400);
        say(PICK("food.full", "刚吃过啦"), "annoyed", 1600);
      } else if (kind === "play.fail" || kind === "touch.fail") {
        setExpr("pout", 1400);
      } else if (kind === "act.start") {
        // 面板开始了活动：主窗这边负责「看起来真的在做」。
        // 场景名由面板传过来（actEat / actSleep…），动作库里有对应的一组。
        const d = ev.data || {};
        activity = {
          id: String(d.id || ""),
          name: String(d.name || ""),
          scene: String(d.scene || ("act" + String(d.id || "").replace(/^./, (c) => c.toUpperCase()))),
          since: Date.now(),
        };
        try { setExpr(ACT_EXPR[activity.id] || "default-body", 0); } catch (e) { }
        try { if (window.FishModel) window.FishModel.actionFor(activity.scene); } catch (e) { }
        if (d.line) say(String(d.line), null, 3000);
      } else if (kind === "act.done" || kind === "act.stop") {
        const d = ev.data || {};
        activity = null;
        try { setExpr(kind === "act.done" ? "happy" : "default-body", kind === "act.done" ? 2600 : 0); } catch (e) { }
        try { if (window.FishModel) window.FishModel.actionFor(kind === "act.done" ? "actDone" : "actStop"); } catch (e) { }
        if (d.line) say(String(d.line), null, 2800);
      } else if (kind === "act.fail") {
        const d = ev.data || {};
        try { setExpr("pout", 1500); } catch (e) { }
        if (d.line) say(String(d.line), null, 1800);
      }
    });
  }

  if (!vendor) { fail("vendor 没加载上"); return; }
  if (!window.Live2DCubismCore) { fail("Cubism Core 没加载上"); return; }

  // ---------- 配置 ----------
  // 模型不再写死。启动时向本地服务要一份「当前模型包」的运行时配置
  // （src/packs 的规则系统已经把它算成查表即用的形状：模型地址、贴图、参数映射、
  //  动作路由、布局、表情、点击分区）。
  // 拉不到就退回旧的硬编码路径 —— 适配器出问题也不该让桌宠起不来。
  let PACK = null;
  const FALLBACK_MODEL = "/model/dafeiyu.model3.json";
  let MODEL_URL = FALLBACK_MODEL;
  let TEXTURE_COUNT = 5;
  const texUrl = (i) => `/model/tex/tex${String(i).padStart(2, "0")}.png?rgba`;

  // ---------- 动作手感（模型包里可调） ----------
  // 每个模型比例不同，幅度不能写死。这里给出与 0.2.0 完全一致的默认值，
  // 升级后画面手感不变；想调的人在适配器「动作手感」里逐项改。
  //   26 / 4.2 = 6.19（旧 6.5）；30 / 5.0 = 6.0（旧 6.0）；14 / 4.0 = 3.5（旧 3.6）
  const TUNE_DEF = {
    angleMaxX: 26, angleMaxY: 30, angleMaxZ: 14, deadzone: 0.07,
    bodyGainX: 1, bodyGainY: 1, bodyGainZ: 1, bodyLag: 0.35,
    eyeGain: 1, eyeMax: 1,
    physicsDt: 33, maskResolution: 1024, fadeScale: 1,
    paramLock: true, idleLock: false, motionSpeed: 1,
    // 表情贴片：把 key1~key13 这些整张贴图开关拿来给情绪补重音
    // （害羞开脸红、爱心眼开爱心眼、生气闪一下黑脸…）。模型没有这些参数时自动不生效。
    exprPatch: true,
    // 贴图精度：0=自动（按显卡能力给到 4096），其余值就是贴图长边的像素上限。
    // 调小省显存，调大更清晰；衣服上的蕾丝、刺绣最容易看出差别。
    texMax: 0,
  };
  let TUNE = Object.assign({}, TUNE_DEF);

  const syncTune = (pack) => {
    const t = (pack && pack.tuning) || {};
    const next = Object.assign({}, TUNE_DEF);
    for (const k of Object.keys(TUNE_DEF)) {
      const v = t[k];
      if (v === undefined || v === null) continue;
      if (k === "paramLock" || k === "idleLock") next[k] = !!v;
      else {
        const n = Number(v);
        if (Number.isFinite(n)) next[k] = n;
      }
    }
    // 数值兜底：坏数据别把模型推到 NaN，setParameterValue 收 NaN 会整只消失
    const safe = (k, lo, hi) => { next[k] = Math.min(hi, Math.max(lo, next[k])); };
    safe("angleMaxX", 3, 60); safe("angleMaxY", 3, 60); safe("angleMaxZ", 1, 45);
    safe("deadzone", 0, 0.35); safe("bodyGainX", 0, 2); safe("bodyGainY", 0, 2);
    safe("bodyGainZ", 0, 2); safe("bodyLag", 0, 1); safe("eyeGain", 0, 2);
    safe("eyeMax", 0.1, 2); safe("fadeScale", 0.2, 4); safe("motionSpeed", 0.25, 3);
    // 这两项来自「设置」而不是模型包的 tuning，不能被 Object.assign(TUNE_DEF) 冲回默认值。
    // 以前就吃过这个亏：bootSafe 先按设置设好，模型一加载 syncTune 又整份换掉。
    next.exprPatch = TUNE.exprPatch;
    next.texMax = TUNE.texMax;
    TUNE = next;
    return TUNE;
  };
  const tune = () => TUNE;
  // 只在模型加载时生效的两项：物理步长、裁剪蒙版精度。
  // 物理演算按固定步长设计，掉帧时把 200ms 一口气塞进去会让头发「弹飞」；
  // 蒙版精度必须赶在首帧渲染前设置，运行中改会重建缓冲、闪一帧。
  const applyTuningToModel = (m) => {
    const im = m && m.internalModel;
    if (!im) return;
    const pdt = Number(TUNE.physicsDt) || 0;
    const ph = im.physics;
    if (ph && typeof ph.evaluate === "function" && !ph.__fishTuned) {
      const orig = ph.evaluate;
      if ((PACK && PACK.physics === false) || pdt === 0) {
        ph.evaluate = function () { };
        console.log("[fish] 物理已关闭");
      } else {
        const cap = Math.min(0.2, Math.max(0.008, pdt / 1000));
        ph.evaluate = function (core, dt) { return orig.call(ph, core, Math.min(dt, cap)); };
        console.log("[fish] 物理步长上限 " + Math.round(cap * 1000) + "ms");
      }
      ph.__fishTuned = true;
    }
    try {
      const r = im.renderer;
      const size = Math.round(TUNE.maskResolution) || 1024;
      if (r && typeof r.setClippingMaskBufferSize === "function") {
        const cur = typeof r.getClippingMaskBufferSize === "function" ? r.getClippingMaskBufferSize() : -1;
        if (cur !== size) { r.setClippingMaskBufferSize(size); console.log("[fish] 蒙版精度 " + size); }
      }
    } catch (e) { console.warn("[fish] 蒙版精度设置失败 " + (e && e.message)); }
  };


  const loadPack = async () => {
    try {
      const r = await fetch("/api/packs/active", { cache: "no-store" });
      const j = await r.json();
      if (j && j.ok && j.url) return j;
      console.warn("[fish] 模型包接口没给出模型地址，用兜底路径", j && j.error);
    } catch (e) {
      console.warn("[fish] 模型包接口不可用，用兜底路径", e && e.message);
    }
    return null;
  };
  const CTX_MENU = [];
  // 手写动作的播放状态（在下面 FishModel 的 API 里读写）。
  //   __act      当前动作
  //   __actPrev  上一个动作：换动作时保留 0.24 秒做交叉淡化，避免「咔」一下
  //   activity 在文件上方声明（广播监听要先见到它）
  let __act = null;
  let __actPrev = null;
  let __actPrevT0 = 0;

// 贴图的原始 <img>。贴图精度是可调的（设置里选 1024~4096 或「自动」），
// 改档位时不能在已经缩过的小图上再缩一次，所以原图得留着。
// 只在内存里存解码结果，浏览器上传 GPU 后可以回收，五张 4096~8192 不会一直占 1.8GB。
const texOrig = [];
let __applyTexQuality = null;
  // 表情轨：和动作轨分开各播各的。以前表情段和摸头动作抢同一个 __act，
  // 谁后播谁赢 —— 摸头时表情就断，演表情时手就不动。分成两条之后
  // 按参数域各写各的（EXPR_DOMAIN / BODY_DOMAIN），共享的角度视线叠增量。
  let __exprTrack = null;
  let __exprPrev = null;
  let __exprPrevT0 = 0;

  const PIDX = {
    ParamAngleX: 28, ParamAngleY: 29, ParamAngleZ: 30,
    ParamBodyAngleX: 36, ParamBodyAngleZ: 41,
    ParamEyeBallX: 76, ParamEyeBallY: 77,
    ParamEyeLOpen: 97, ParamEyeROpen: 85,
    ParamMouthOpenY: 107, ParamMouthForm: 106,
    ParamBreath: 508,
  };
  // 完整的参数名→索引表，模型加载完建一次。
  // 为什么必须建：cm.getParameterIndex(name) 返回的索引带偏移（实测 Movement2 应该 16 却给 510），
  // 拿它去 setParameterValueByIndex 会写到别的参数上：嘴上在打哈欠，实际动的是别的变形器。
  // 而且完全不报错，上一版就是这里让手写动作「看起来没生效」。
  let IDX2 = null;
  const buildIndex = (cm) => {
    const map = {};
    const n = cm.getParameterCount();
    for (let i = 0; i < n; i++) {
      const o = cm.getParameterId(i);
      const id = o && o._id ? o._id.s : String(o);
      if (id) map[id] = i;
    }
    IDX2 = map;
    return map;
  };
  // 曲线里写的是「标准参数名」（ParamAngleX 这种）。换模型后这台模型可能叫别的，
  // 或者压根没有。PACK.paramMap 是服务端算好的「曲线里写的名字 → 这台模型里的名字」
  // 对照表：先换名再查索引，查不到返回 -1，调用方跳过这条曲线。
  const findIdx = (name) => {
    if (!name) return -1;
    const real = (PACK && PACK.paramMap && PACK.paramMap[name]) || name;
    if (IDX2 && IDX2[real] !== undefined) return IDX2[real];
    if (IDX2 && IDX2[name] !== undefined) return IDX2[name];
    if (PIDX[real] !== undefined) return PIDX[real];
    if (PIDX[name] !== undefined) return PIDX[name];
    return -1;
  };

  let app = null, model = null, disposed = false;
  let W = 460, H = 560;

  // 状态
  let tx = 0, ty = 0;                       // 鼠标归一化目标（-1..1）
  let lastMoveAt = Date.now();
  let phase = "idle";
  let petZone = "face", petAt = 0, petDir = 1, petCombo = 1, petComboAt = 0, petCount = 0;
  let tapAt = 0;
  // 按住不放：单击是「戳一下」，一直按着就变成「捏着不放」，她该抗议了
  let pressAt = 0, pressComplained = false;
  // 松手之后余速还在，让她再多荡两下；不然松手瞬间就僵住，像断了线。
  let fling = 0;
  // tick 里每帧重建的 target 是局部的，这里留一份引用，排障时才能看「她本来想摆成什么样」
  let lastTarget = null;

  // 缓动状态
  const mv = { yaw: 0, pitch: 0, roll: 0, body: 0, gazeX: 0, gazeY: 0, blink: 0, squint: 0 };
  let pending = null;

  // 眨眼
  let blinkStart = -1, nextBlink = performance.now() + 1800 + Math.random() * 2600;
  let blinkVal = 0, blinkActive = false;
  let mouth = 0;

  // 眼球微跳
  let lastSaccade = performance.now(), nextSaccade = 900 + Math.random() * 1600;
  let sacX = 0, sacY = 0;

  // 小动作
  let gesture = null, nextGestureAt = 0;

  // 运行期开关（设置面板能改，改了立刻生效）
  let sharpenOn = true;
  // 画布超采样倍数。这个模型的原始画布是 3819x6792，缩到 460 宽显示，
  // 采样率不够时睫毛、发梢这些一像素宽的细节会被 average 掉，看起来像糊了一层。
  // 跟系统 DPI 走并放大 2.25 倍（1.33 的屏幕 → 3、1.0 的屏幕 → 2.25），
  // 下限 2、上限 3：再高只是白烧显存，桌宠窗口就这么大。
  let baseResolution = Math.max(2, Math.min(3, (window.devicePixelRatio || 1) * 2.25));
  // 帧率上限：60 最顺、30 省一半 CPU、15 最省电。空闲时再自动降到 15。
  let fpsCap = 30;
  let followCursor = true;
  let autoIdle = true;
  let blinkEnabled = true;

  let lastError = null;

  // DSH 状态
  let dshPhase = "idle", dshBubble = "";
  // 「她在忙」有两个来源：DSH 会话文件在写（主进程 watcher，2 秒一次），
  // 和手机桥 /api/health 说 busy（8 秒一次）。以前两边各写一次 phase，
  // 谁最后写谁赢 —— 结果 watcher 每 2 秒把桥的「忙」抹掉，她还是一脸闲。
  // 现在各记一个，取并集。
  let busyByWatcher = false;
  let busyByBridge = false;
  function syncBusy() {
    if (busyByWatcher || busyByBridge) phase = "thinking";
    else if (phase === "thinking") phase = "idle";
  }

  // 兜底界面：模型起不来时别只甩一行字，给能点的按钮。
  // 只给「重试」是不够用的：贴图缺了、moc3 版本比内置 Cubism Core 新，点一百次也不会好，
  // 用户最后只能去卸载重装。所以并排放一个「换一个模型」，直接进适配器挑别的包。
  const showRetry = () => {
    if (document.getElementById("fish-retry")) return;
    const box = document.createElement("div");
    box.id = "fish-retry";
    box.style.cssText = "position:fixed;left:50%;top:58%;transform:translateX(-50%);z-index:99;display:flex;gap:8px;";
    const mk = (text, primary, onClick) => {
      const b = document.createElement("button");
      b.textContent = text;
      b.style.cssText =
        "padding:7px 16px;border-radius:8px;cursor:pointer;font:13px/1.4 'Microsoft YaHei UI',sans-serif;" +
        (primary
          ? "border:1px solid #4a5580;background:#232840;color:#e8eaf2;"
          : "border:1px solid rgba(120,150,210,.3);background:rgba(255,255,255,.05);color:#c9d6ee;");
      b.addEventListener("click", onClick);
      return b;
    };
    box.appendChild(mk("重试", true, () => {
      box.remove();
      errEl.style.display = "none";
      lastError = null;
      bootSafe();
    }));
    box.appendChild(mk("换一个模型", false, () => {
      try {
        if (window.deskfish && window.deskfish.openAdapter) {
          window.deskfish.openAdapter(PACK && PACK.id, "");
        }
      } catch (e) { console.warn("[fish] 打开模型适配器失败 " + e.message); }
    }));
    document.body.appendChild(box);
  };

  // 点击回弹曲线 = lib/curve.js 的 curve（原来这里有一份实现，已收走）。

  // ---------- 空状态：安装包里不带模型 ----------
  // 没有模型不是错误，是「还没装」。所以不给红色报错和重试按钮，
  // 只给两条导入路径——用户第一次打开看到的就是这个。
  const showNoModel = (reason) => {
    const box = document.getElementById("noModel");
    if (!box) return;
    box.classList.add("on");
    const dock = document.getElementById("dock");
    if (dock) dock.style.display = "none";
    const why = document.getElementById("nmWhy");
    // 说明块在出问题时收起：窗口只有 356×512，黄条/错误文案一长，
    // 展开的说明会把最后一行顶出窗口 —— 那等于没有写。
    const help = document.getElementById("nmHelp");
    if (help) help.open = false;
    if (why) {
      if (reason === "missing") {
        why.hidden = false;
        why.textContent = "现在选中的模型包缺文件：只剩配置，没有 .moc3 / 贴图。1.1.0 起安装包不再带模型，升级后旧的内置模型会变成这样 —— 重新导入一个完整模型包就行。";
      } else {
        why.hidden = true;
      }
    }
    const tip = document.getElementById("nmTip");
    // 导入失败时只贴后端那半句，用户不知道下一步该动什么。
    // 实测最常见的三种：选到了外层目录、拿的是 Cubism 2 的模型（只有 model.json）、
    // 压缩包没下完整（解压到一半失败）。三条都写出来，别让人反复试。
    const SELF_CHECK =
      "\n\n卡住了对一下这三条：\n" +
      "· 选到有 .model3.json 的那一层，不是它外面那层\n" +
      "· 只有 model.json 的是 Cubism 2，不支持，要用 Cubism 3 / 4 重新导出\n" +
      "· 压缩包可能没下完整 —— 手动解压后选文件夹试试";
    // 几百兆的整合包要几十秒，只写「正在导入…」用户分不清在动还是卡死。
    // 主进程每 16 个文件或 200ms 推一次 { files, bytes, done }。
    const fmtSize = (b) => {
      const mb = b / 1048576;
      return (mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)) + " MB";
    };
    const run = async (kind, btn) => {
      if (!window.deskfish || !window.deskfish.modelImport) return;
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = "正在导入…";
      let unsub = null;
      if (typeof window.deskfish.onModelImportProgress === "function") {
        try {
          unsub = window.deskfish.onModelImportProgress((p) => {
            if (!p || typeof p.files !== "number") return;
            const size = p.bytes ? "（" + fmtSize(p.bytes) + "）" : "";
            if (p.done) {
              btn.textContent = "正在检查…";
              if (tip) tip.textContent = "复制完了，正在看看这个模型能不能用…";
              return;
            }
            btn.textContent = "正在导入…";
            if (tip) tip.textContent = "正在复制：" + p.files + " 个文件" + size + "\n导入期间别关窗口，关了就中断了";
          });
        } catch (e) { }
      }
      try {
        const r = await window.deskfish.modelImport(kind);
        if (r && r.ok) {
          // 有文件因为目录太深 / 文件数到顶没复制进来：包装上了，但很可能缺贴图。
          // 这时候直接 reload 会把提示也刷掉，用户只会看到「模型发黑」这一个结果，
          // 所以停下来把原因讲清楚，刷新交给他自己按（Ctrl+R 或再点一次导入）。
          if (r.truncated) {
            btn.disabled = false;
            btn.textContent = label;
            if (tip) {
              tip.textContent = "装上了，但有文件没复制进来（" + (r.skippedReason || "超出导入上限") +
                "）。模型可能缺贴图 —— 把预览图、源文件（.psd / .cmo3）删掉再导一次会更稳，\n" +
                "想先看看效果就按 Ctrl+R 刷新。";
            }
            return;
          }
          if (tip) tip.textContent = "装好了，正在换上新模型…";
          location.reload();
          return;
        }
        if (r && r.canceled) { btn.disabled = false; btn.textContent = label; return; }
        if (tip) tip.textContent = "导入失败：" + ((r && r.error) || "未知原因") + SELF_CHECK;
      } catch (e) {
        // IPC 失败时 message 会带一长串 "Error invoking remote method 'model:import': "，
        // 那半句对用户毫无意义，剥掉只留真正的原因。
        const raw = String((e && e.message) || e);
        const clean = raw.replace(/^Error invoking remote method '[^']+':\s*/i, "")
          .replace(/^Error:\s*/i, "").trim();
        if (tip) tip.textContent = "导入失败：" + (clean || "没拿到原因，看看运行日志") + SELF_CHECK;
      } finally {
        // 一定退订：这个函数有三条 return，漏一条监听器就留在窗口里，
        // 下次导入会同时收到两份进度（旧的还在往已经废弃的按钮上写字）。
        if (unsub) { try { unsub(); } catch (e) { } unsub = null; }
      }
      btn.disabled = false;
      btn.textContent = label;
    };
    const z = document.getElementById("nmZip");
    const d = document.getElementById("nmDir");
    if (z && !z.dataset.wired) { z.dataset.wired = "1"; z.addEventListener("click", () => run("zip", z)); }
    if (d && !d.dataset.wired) { d.dataset.wired = "1"; d.addEventListener("click", () => run("folder", d)); }
  };

  // ---------- 启动 ----------
  const boot = async () => {
    // 先要模型包配置：后面的加载、贴图、布局、动作全看它。
    // bootSafe 已经拉过一次了，这里只兜「boot 被单独调用」的情况。
    if (!PACK) PACK = await loadPack();
    exprSlotReset();
    syncTune(PACK);
    if (!PACK || !PACK.url) throw new Error("还没有可用的模型包");
    if (PACK) {
      MODEL_URL = PACK.url;
      TEXTURE_COUNT = (PACK.textures || []).length;
      console.log("[fish] 模型包 " + PACK.id + " · " + (PACK.displayName || "") + " · 贴图 " + TEXTURE_COUNT + " 张");
    }
    vendor.extensions.add(vendor.Live2DPlugin);
    // Cubism Core 的 WASM 堆：这套模型 509 个参数、5 张贴图，128MB 足够；
    // 256MB 会白白多占一百多兆（这块算在渲染进程的工作集里，用户看到的就是「桌宠怎么这么大」）。
    vendor.configureCubismSDK({ memorySizeMB: 128 });

    app = new vendor.Application();
    await app.init({
      width: W, height: H,
      backgroundAlpha: 0,
      antialias: false,
      autoDensity: true,
      resolution: baseResolution,
      preference: "webgl",
      preserveDrawingBuffer: true,
    });
    stageEl.appendChild(app.canvas);
    app.canvas.style.width = "100%";
    app.canvas.style.height = "100%";
    // 叠一层锐化：画布是 2 倍超采样再缩回窗口，缩小时高频会被削掉，这里补回来。
    if (sharpenOn) app.canvas.style.filter = "url(#fish-sharpen)";

    model = await vendor.Live2DModel.from(MODEL_URL, {
      autoUpdate: false,
      autoHitTest: false,
      autoFocus: false,
      textureOptions: { lod: "single-auto" },
    });

    if (disposed) return;

    // 参数名→索引表，越早建越好：后面 put() / playMotion 全靠它。
    // 不能偷懒用 cm.getParameterIndex()：那个返回的索引带偏移（实测 Movement2 是 510，
    // 而遍历 getParameterId 得到的是 16），写进去不报错，但值全落到别的变形器上。
    try { buildIndex(model.internalModel.coreModel); } catch (e) { }

    // 贴图：引擎的 Worker 解码会压到 1024，自己取原图换上。
    // 这里只把原图读进来；缩到多大由下面的 applyTexQuality() 按设置决定，
    // 这样改档位时重新调一次就行，不用重启。
    const jobs = [];
    for (let i = 0; i < TEXTURE_COUNT; i += 1) {
      const t = PACK && PACK.textures && PACK.textures[i];
      const u = (t && t.url) ? t.url : texUrl(i);
      // 用 <img> 而不用 createImageBitmap：ImageBitmap 会一直持有解码后的像素，
      // 五张 4096~8192 的图叠起来就是 1.8GB。<img> 在上传 GPU 后浏览器可以回收 CPU 侧数据。
      jobs.push((async () => {
        const img = new Image();
        img.decoding = "async";
        await new Promise((res, rej) => {
          img.onload = () => res();
          img.onerror = () => rej(new Error("img load fail " + u));
          img.src = u;
        });
        texOrig[i] = img;
      })().catch(() => { }));
    }
    await Promise.all(jobs);

    // 贴图档位：TUNE.texMax = 0 表示自动（按显卡能力），其余值就是长边像素上限。
    // 以前这里钉死 2048，8192×8192 的图被一次砍到 1/4，衣服上的蕾丝褶边全糊成一片。
    __applyTexQuality = async (want) => {
      const w = typeof want === "number" ? want : Number(TUNE.texMax) || 0;
      let cap = 0;
      try {
        const gl = app && app.renderer && app.renderer.gl;
        cap = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 0;
      } catch (e) { cap = 0; }
      let MAX = w > 0 ? w : (cap >= 4096 || !cap ? 4096 : cap >= 2048 ? 2048 : 1024);
      if (cap && MAX > cap) MAX = cap;   // 显卡报的上限更高才允许更大
      const sub = [];
      for (let i = 0; i < TEXTURE_COUNT; i += 1) {
        const img = texOrig[i];
        if (!img) continue;
        sub.push((async () => {
          const tex = model.textures[i];
          const src = tex && (tex.source || (tex.baseTexture && tex.baseTexture.source));
          if (!src) return;
          const nw = img.naturalWidth || 1;
          const nh = img.naturalHeight || 1;
          let use = img;
          let tw = nw;
          let th = nh;
          if (Math.max(nw, nh) > MAX) {
            const k = MAX / Math.max(nw, nh);
            tw = Math.max(1, Math.round(nw * k));
            th = Math.max(1, Math.round(nh * k));
            try {
              const cv = document.createElement("canvas");
              cv.width = tw;
              cv.height = th;
              const cx = cv.getContext("2d");
              cx.imageSmoothingEnabled = true;
              cx.imageSmoothingQuality = "high";
              cx.drawImage(img, 0, 0, tw, th);
              use = cv;
            } catch (e) { use = img; tw = nw; th = nh; }
          }
          // 丢掉换上来的那张旧图，别让它一直挂着占显存
          const old = src.resource;
          if (old && old !== use && typeof old.close === "function") {
            try { old.close(); } catch (e) { }
          }
          if (typeof src.resize === "function") src.resize(tw, th);
          src.resource = use;
          src.autoGenerateMipmaps = true;
          if (typeof src.updateMipmaps === "function") { try { src.updateMipmaps(); } catch (e) { } }
          src.update();
          if (src.style) {
            src.style.minFilter = "linear";
            src.style.magFilter = "linear";
            src.style.mipmapFilter = "linear";
            // 各向异性：裙摆、披肩这类大面积斜向纹理，只做各向同性采样必然糊。
            src.style.anisotropicLevel = 4;
          }
        })().catch(() => { }));
      }
      await Promise.all(sub);
      console.log("[fish] texMax=" + MAX + (w > 0 ? "(固定)" : "(自动)") + " tex=" + model.textures.map((t) => {
        const src = t && (t.source || (t.baseTexture && t.baseTexture.source));
        return src ? src.width + "x" + src.height : "?";
      }).join(","));
    };
    await __applyTexQuality();

    layout();
    app.stage.addChild(model);
    model.automator.autoUpdate = true;

    // 模型自带的待机动作：换模型后组名/索引都可能变，所以从包里取。
    // 它和手写动作不冲突 —— 手写动作在 beforeModelUpdate 里最后写参数，
    // 模型动作只负责让身体有点自己的小摆动（呼吸、轻微转头）。
    const startModelIdle = () => {
      const a = PACK && PACK.actions && PACK.actions.idle;
      const group = a && a.engine === "model" && a.motion ? a.motion : "idle";
      const idx = a && a.engine === "model" ? (a.index || 0) : 0;
      try { model.motion(group, idx, 3); } catch (e) { }
    };

    // 参数要写在「动作、物理、姿势都算完、网格还没生成」的那个点上。
    // 引擎源码里的顺序是：
    //   motionManager 动作 → physics.evaluate → pose.updateParameters
    //   → emit("beforeModelUpdate") → coreModel.update() → loadParameters()
    // 所以 beforeModelUpdate 是唯一既不会被动作覆盖、又赶得上 update() 的时机。
    //
    // 试错记录：①写在 pixiApp.ticker（优先级 50）——太早，动作会整份盖掉；
    //  ②包一层 app.render——pixi v8 内部持有自己的 render 引用，赋值不会被调用。
    model.internalModel.on("beforeModelUpdate", applyParams);
    applyTuningToModel(model);

    // 表情文件异步读：读得到就叠 exp3，读不到就一直是参数偏移兜底。
    // 不 await —— 模型已经能显示了，不该为了几个表情卡住首帧。
    loadExprFiles();

    // 动作：只保留 idle，禁掉所有手部动作
    model.on("motionFinish", () => {
      __motionOwn = null;   // 动作播完，把参数还给 applyParams
      // 正在播自定义动作时不要抢着起 idle，否则 stopAllMotions() 触发这个事件
      // 立刻重播 idle，新动作又被优先级挡住，看起来就像怎么都播不出来。
      if (__playingMotion) { __playingMotion = false; return; }
      startModelIdle();
    });
    startModelIdle();

    app.ticker.add(tick);

  // 自检出口：出问题时让用户/支持直接读一眼帧率、分辨率、空闲时长，不用开 DevTools。
  // 只暴露只读数字；唯一能改状态的是 __fishPause（给自检用，正常走 IPC）。
  // 锁屏 / 休眠 / 最小化：主进程会喊一声，这里把 ticker 停掉。
  // 人不在的时候 Cubism 每帧的开销一分不少，只有真的不画才省得下来。
  let renderPaused = false;
  const setPaused = (on) => {
    if (!app || !app.ticker) return false;
    if (!!on === renderPaused) return renderPaused;
    renderPaused = !!on;
    try {
      if (renderPaused) app.ticker.stop();
      else {
        lastMoveAt = Date.now();   // 回来别立刻判定成「很久没动」而降帧
        app.ticker.start();
        // 恢复的那一下立刻补一拍桥接状态，否则「思考脸」要等最多 8 秒才回正。
        try { if (typeof pollDsh === "function") pollDsh(); } catch (e2) { }
      }
    } catch (e) { /* ticker 还没建好，忽略 */ }
    return renderPaused;
  };
  if (window.deskfish && window.deskfish.onPauseRender) window.deskfish.onPauseRender(setPaused);
  if (window.deskfish && window.deskfish.onPetPanelState) {
    window.deskfish.onPetPanelState((open) => { petPanelOpen = !!open; });
  }
  if (window.deskfish && window.deskfish.petPanelOpen) {
    try { window.deskfish.petPanelOpen().then((v) => { petPanelOpen = !!v; }).catch(() => { }); } catch (e) { }
  }
  // 给自检和冒烟脚本用：没有真的锁屏也能验证「暂停是不是真的停了」。
  window.__fishPause = setPaused;
  // renderPaused 只活在这个作用域里，IIFE 顶层的东西（pollDsh、空闲说话）读不到它。
  // 留一个读口，别让它们各自再存一份状态 —— 那样迟早两份状态不一致。
  window.__fishPausedNow = () => renderPaused;

  window.__fishDebug = () => ({
    // 真实 tick 数/秒。Pixi 的 ticker.FPS 是 1000/原始 rAF 间隔，
    // maxFPS 跳帧时它不会跟着变，会读出 160 这种超过上限的数——排障时误导性极强。
    fps: app && app.ticker && Number.isFinite(app.ticker.__tps) && app.ticker.__tps >= 0 ? app.ticker.__tps : 0,
    rawFps: app && app.ticker ? Math.round(app.ticker.FPS) : -1,
    maxFps: app && app.ticker ? app.ticker.maxFPS : -1,
    res: app && app.renderer ? app.renderer.resolution : -1,
    idleMs: Date.now() - lastMoveAt,
    phase,
    link: dshLink,
    dshFail: dshFail,
    bridgeBase: bridgeBase,
    model: !!(model && model.visible),
    paused: renderPaused,
    ticking: !!(app && app.ticker && app.ticker.started),
    muted: !!(window.FishVoice && window.FishVoice.isMuted && window.FishVoice.isMuted()),
    volume: (window.FishVoice && window.FishVoice.getVolume) ? window.FishVoice.getVolume() : null,
    // 这几个开关只活在本闭包里，外面看不见；回归测试要验「设置里拨了，渲染侧真的跟着变」，
    // 没有这个口就只能靠截图猜。
    follow: followCursor,
    viewY: viewBox.y,
    viewH: viewBox.h,
    packId: PACK && PACK.id,
    autoIdle: autoIdle,
    blink: blinkEnabled,
    sharpen: sharpenOn,
    fpsCap: fpsCap,
  });
    window.addEventListener("resize", layout);
  };

  // ---------- 表情：用参数组合，不用 key 触发 ----------
  // 模型带 23 个 exp3 表情文件，每个只是把 key1~key13 里的一个设成 1。
  // 我一开始就是照着这个直接写 key 参数，确实写进去了（key4 稳定为 1），
  // 但画面上什么都不变。查了 147 个部件的不透明度全是 1，说明这个模型的
  // 表情不靠部件可见性切换；美术在 Cubism 里建了参数，没把它们接到 ArtMesh 上。
  // 这条路是死的，别再试第二次。
  //
  // 所以表情改成「用能动的参数拼情绪」：嘴型、眼睑、歪头、视线都是活的参数，
  // 组合起来一样能读出情绪，而且不需要任何美术配合。
  //
  // 数值是偏移量，会叠加在基础值上（比如歪头是在 roll 之上再歪一点）。
  //   mouth → ParamMouthForm（嘴角，正数笑，负数撇嘴）
  //   eye   → 负数表示眼睛更闭（好笑成弯月、累成半睁）
  //   roll  → 歪头角度（度）
  //   yaw   → 头转
  //   gazeX / gazeY → 眼珠偏移
  const EXPR_DEF = {
    happy: { mouth: 0.6, eye: -0.2, roll: -5 },
    shy: { mouth: 0.28, eye: -0.08, roll: -22, yaw: 0.22 },
    tired: { mouth: -0.3, eye: -0.45, roll: 10 },
    curious: { mouth: 0.2, roll: 24, gazeX: 0.4 },
    sad: { mouth: -0.65, eye: -0.25, gazeY: -0.35, roll: 6 },
  };
  const EXPR_OK = Object.keys(EXPR_DEF);
  const EXPR_DEFAULT = "default-body";
  const EXPR_KEYS = ["mouth", "eye", "roll", "yaw", "gazeX", "gazeY"];
  let curExpr = EXPR_DEFAULT;
  let exprTimer = 0;
  let nextExprAt = 0;
  // 最近用过的表情（末尾最新），策略层据此避开连抽同一个
  const exprRecent = [];
  // 手写动作「伸懒腰」的曲线 —— model/mot/stretch.motion3.json 是同一份数据，
  // 只是这里由我自己按时间推（引擎的 motionManager 在这套接入里播不出来）。
  // 数值依据：Movement2 手臂抬起峰值 0.55、Param56 待机 0.44 → 举手 0.86。
  // Param57 待机 0.26 → 收 0.12、ParamAngleY 抬头 +8.5 度、ParamEyeLOpen 1=睁眼。
  const STRETCH_CURVES = [
    ["Movement2", [[0, 0], [0.35, 0.12], [1.05, 0.55], [1.45, 0.52], [1.95, 0.04]]],
    ["Param56", [[0, 0.44], [0.35, 0.5], [1.05, 0.86], [1.45, 0.84], [1.95, 0.46]]],
    ["Param57", [[0, 0.26], [1.05, 0.12], [1.95, 0.25]]],
    ["ParamAngleY", [[0, 0], [0.5, 3], [1.1, 8.5], [1.5, 8], [1.95, 0]]],
    ["ParamAngleZ", [[0, 0], [1.1, -4.5], [1.5, -4], [1.95, 0]]],
    ["ParamEyeLOpen", [[0, 1], [0.55, 0.9], [1.1, 0.22], [1.45, 0.25], [1.9, 1]]],
    ["ParamEyeROpen", [[0, 1], [0.55, 0.9], [1.1, 0.22], [1.45, 0.25], [1.9, 1]]],
    ["ParamMouthOpenY", [[0, 0], [0.7, 0.15], [1.12, 0.62], [1.45, 0.58], [1.9, 0.02]]],
    ["ParamBreath", [[0, 0], [0.6, 0.35], [1.1, 0.78], [1.5, 0.7], [1.95, 0.05]]],
  ];
  const exWant = {};   // 目标偏移
  const exNow = {};    // 当前偏移，每帧逼近

  // 表情的两种引擎：
  //   params —— 内置的「参数偏移」表（EXPR_DEF），任何模型都能用，代价是不够贴脸
  //   model  —— 读模型自带的 .exp3，把里面的参数值按 Blend 叠进来
  // auto 逐个语义判断：这个模型有对应的 exp3 就用它，没有就退回参数偏移。
  //
  // 为什么不直接调引擎的 expressionManager：它和每帧 applyParams 抢同一批参数，
  // 谁最后写谁赢 —— 表情会闪一下就被呼吸/眨眼覆盖。自己按下发的值叠加，
  // 顺序可控，动作系统也插不进来。
  const EXPR_SRC = {};    // 语义名 → [{id,value,blend}]
  let EXPR_BASE = null;   // 默认表情常驻（有些模型的「中性脸」本身就是一个 exp）
  let exExtra = null;     // 当前表情要叠加的参数（null = 只用参数偏移）

  const loadExprFiles = async () => {
    const E = PACK && PACK.expressions;
    if (!E || !E.files) return;
    const names = Object.keys(E.map || {}).filter((k) => E.map[k] && E.files[E.map[k]]);
    const def = E.default && E.files[E.default] ? [E.default] : [];
    await Promise.all(names.concat(def).map(async (name) => {
      const file = name === E.default ? E.files[E.default] : E.files[E.map[name]];
      try {
        const r = await fetch((PACK.base || "") + file, { cache: "no-store" });
        const j = await r.json();
        const list = (j && j.Parameters) || [];
        const parsed = list.map((p) => ({
          id: String(p.Id || ""),
          value: Number(p.Value) || 0,
          blend: String(p.Blend || "Add"),
        })).filter((p) => p.id);
        if (name === E.default) EXPR_BASE = parsed;
        else EXPR_SRC[name] = parsed;
      } catch (e) {
        console.warn("[fish] 表情文件读不到 " + name + ": " + (e && e.message));
      }
    }));
    console.log("[fish] 表情文件 base=" + (EXPR_BASE ? EXPR_BASE.length : 0) +
      " 语义=" + Object.keys(EXPR_SRC).join(","));
  };

  // 把一组 exp3 参数按 Blend 语义写进 coreModel。
  // Add 是相对当前值加，Multiply 是乘，Overwrite 是直接赋 —— 和 Cubism 的定义一致。
  const applyExprSet = (cm, set) => {
    if (!set) return;
    for (let k = 0; k < set.length; k += 1) {
      const p = set[k];
      const i = findIdx(p.id);
      if (i < 0) continue;
      let v = p.value;
      if (p.blend === "Multiply") v = cm.getParameterValueByIndex(i) * p.value;
      else if (p.blend === "Add") v = cm.getParameterValueByIndex(i) + p.value;
      cm.setParameterValueByIndex(i, v);
    }
  };

  function setExpr(name, holdMs) {
    if (disposed || !model) return;
    const E = PACK && PACK.expressions;
    const key = name || "default";
    // 只有「这个语义确实读到了 exp3」且引擎允许时才用模型表情；
    // 否则一律退回内置参数偏移，保证任何模型都有表情可用。
    const useModel = !!(E && EXPR_SRC[key] && (E.engine === "model" || E.engine === "auto"));
    if (useModel) {
      exExtra = EXPR_SRC[key];
      for (const k of EXPR_KEYS) exWant[k] = 0;
      curExpr = key;
    } else {
      exExtra = null;
      const def = EXPR_DEF[name];
      for (const k of EXPR_KEYS) exWant[k] = def ? (def[k] || 0) : 0;
      curExpr = name && def ? name : EXPR_DEFAULT;
    }

    if (exprTimer) clearTimeout(exprTimer);
    exprTimer = 0;
    // 手动设了表情就把自动切换推后，否则下一次 maybeChangeExpr 会当场覆盖它
    // （原来只有 14 秒的随机间隔，测试时表情总是「自己变回去」）。
    nextExprAt = Date.now() + Math.max(holdMs || 0, 14000);
    if (holdMs > 0) {
      exprTimer = setTimeout(() => {
        if (disposed) return;
        setExpr(EXPR_DEFAULT, 0);
      }, holdMs);
    }
  }

  // 让她自己按心情换表情：饿、开心、无聊各不一样。
  // 这是「养成」那套数值第一次真的影响到她的样子。
  function maybeChangeExpr() {
    if (disposed) return;
    const now = Date.now();
    if (activity) {
      // 活动期间表情跟着活动走，不让随机的「换表情」把它顶掉
      setExpr(ACT_EXPR[activity.id] || "default-body", 0);
      nextExprAt = now + 20000;
      return;
    }
    if (now < nextExprAt) return;
    nextExprAt = now + 14000 + Math.random() * 20000;

    // 偶尔伸个懒腰 —— 手写 motion3 动作，见 model/mot/stretch.motion3.json。
    // 动作期间 applyParams 会把用到的参数让出来（__motionOwn），所以它自己的表情曲线不会被盖。
    if (model && Math.random() < 0.22) {
      try {
        if (window.FishModel && window.FishModel.playMotion) {
          window.FishModel.playMotion("stretch", STRETCH_CURVES);
          say(FishLines.pick("stretch.yawn") || "……唔，好像有点困了");
          nextExprAt = now + 26000 + Math.random() * 18000;
          return;
        }
      } catch (e) { }
    }

    let pool = EXPR_OK.slice();
    let hold = 2600 + Math.random() * 3200;

    const pet = window.FishPet && window.FishPet.snapshot ? window.FishPet.snapshot() : null;
    if (pet) {
      if (pet.hunger < 25) {
        pool = ["tired", "sad"];
        hold = 3000 + Math.random() * 2200;
      } else if (pet.favor >= 70) {
        pool = ["happy", "shy"];
      } else if (pet.favor <= 15) {
        pool = ["shy", "curious"];
      }
    }
    const hour = new Date().getHours();
    if (hour >= 23 || hour <= 5) {
      pool = pool.filter((x) => x !== "happy");
      if (!pool.length) pool = ["tired"];
    }

    // 有策略层就交给它：情绪一次算清、表情和动作共用同一个判断，
    // 并且会避开最近用过的两个（以前只在场景表里防重复，表情是纯随机，
    // 偶尔会连着三次同一个表情，看着像表情卡住了）。
    if (pickLib) {
      const mood = pickLib.moodOf({
        favor: pet ? pet.favor : 50,
        hunger: pet ? pet.hunger : 100,
        hour,
        phase: phase,
      });
      const nx = pickLib.nextExpr(mood, { hour, recent: exprRecent });
      exprRecent.push(nx.key);
      if (exprRecent.length > 4) exprRecent.shift();
      setExpr(nx.key, nx.hold);
      return;
    }

    const pick = pool[Math.floor(Math.random() * pool.length)];
    setExpr(pick, hold);
  }

  // 统一起动作：交叉淡化的时长按前后两个动作的时长自适应。
  // 以前写死 0.24 秒：0.8 秒的小动作会被吞掉一半，2 秒的慢动作又像被硬拽走。
  // 短动作给 0.18–0.2 秒，长动作最多 0.62 秒，让动作「交接」而不是「切换」。
  // track="expr" 走表情轨，与动作轨分开 —— 摸头的同时还能挂着一个害羞的表情。
  // 两轨按参数域分工（见 EXPR_DOMAIN / BODY_DOMAIN），共享的角度和视线叠增量。
  const launchMotion = (name, curves, dur, track) => {
    const isExpr = track === "expr";
    const prev = isExpr ? __exprTrack : __act;
    // 过渡倍率只影响淡入淡出与交叉淡化，不改动作本身的节奏。
    const fs2 = TUNE.fadeScale;
    // 交接时长按「上一个动作已经演到哪儿」算：快播完的让它收尾（短交接），
    // 刚起就被打断的要长一点（不然像抽搐）。策略在 motion-pick.handoff 里，有单测。
    let cross;
    if (pickLib && prev) {
      const elapsed = (performance.now() - prev.t0) / 1000;
      cross = pickLib.handoff(prev.dur, elapsed, dur) * fs2;
    } else {
      cross = prev ? Math.min(0.9, Math.max(0.12, Math.min(prev.dur, dur) * 0.26 + 0.06) * fs2) : 0.24 * fs2;
    }
    const next = { t0: performance.now(), dur, curves, name: name || "custom", cross, speed: TUNE.motionSpeed, track: isExpr ? "expr" : "body" };
    if (isExpr) {
      if (prev) { __exprPrev = prev; __exprPrevT0 = performance.now(); }
      __exprTrack = next;
    } else {
      if (prev) { __actPrev = prev; __actPrevT0 = performance.now(); }
      __act = next;
    }
    return cross;
  };


  // ---------- 模型自带动作（motion3） ----------
  // 动作文件里的曲线会写 ParamAngleX、ParamBodyAngleX、眼睑这些参数，
  // 而 applyParams 每帧也在写同一批 —— 不接管的话动作会被跟随整份盖掉，
  // 表现就是「点了动作，人却还在看鼠标」。
  const motionCache = new Map();   // file -> {duration, curves}
  const loadMotionFile = async (file) => {
    const key = String(file || "");
    if (!key) return null;
    if (motionCache.has(key)) return motionCache.get(key);
    const base = ((PACK && PACK.base) || "/").replace(/\/+$/, "");
    const url = base + "/" + key.replace(/^\/+/, "");
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    if (!window.FishMotion3) throw new Error("motion3.js 没加载");
    const parsed = window.FishMotion3.parse(j);
    motionCache.set(key, parsed);
    return parsed;
  };

  const lockFor = (parsed, ms) => {
    if (!parsed || !parsed.curves || !parsed.curves.length) return;
    const set = new Set();
    for (const c of parsed.curves) set.add(c[0]);
    __motionOwn = set;
    if (__motionOwnTimer) clearTimeout(__motionOwnTimer);
    // TTL 只是保险：正常路径是 motionFinish 清锁，这里防「动作没触发结束事件」把跟随永久冻住。
    __motionOwnTimer = setTimeout(() => { __motionOwn = null; __motionOwnTimer = 0; }, Math.max(800, ms));
  };

  const lockModelMotion = (group, index) => {
    if (!TUNE.paramLock) return;
    // 待机动作通常只是轻微呼吸，和鼠标跟随共存更自然；只有用户明确要求时才接管。
    if (String(group) === "Idle" && !TUNE.idleLock) return;
    const list = (PACK && PACK.motions) || [];
    const m = list.find((x) => String(x.group) === String(group) && Number(x.index) === Number(index || 0));
    if (!m || !m.file) return;
    loadMotionFile(m.file).then((parsed) => {
      if (!parsed) return;
      const ms = (parsed.duration * 1000) / (TUNE.motionSpeed || 1) + 800;
      lockFor(parsed, ms);
    }).catch((e) => { console.warn("[fish] 动作参数锁读文件失败 " + (e && e.message)); });
  };
  // ---------- LumenAct 表演库 ----------
  // src/expr-curves.js 把 LumenAct 的 97 段表演曲线（原本 166 条 VRM blendshape 轨道、30fps、
  // 来自动捕）映射成本模型真能动的 23 个参数，并做了 neutral 差分与 RDP 抽稀。
  // 这里只负责「一句话 → 哪一段」的路由和播放。
  //
  // 为什么不接 LumenAct 的 selector.onnx：那个语义模型 153MB，输入一句话输出一个情绪标签。
  // 而 DSH 那边的对话模型本来就知道自己此刻是什么情绪、在说什么语气 —— 把意图文本直接递进来
  // 选段，比再用一个小模型猜一遍更准，也不用往 Electron 里塞 onnxruntime。
  let __exprLockUntil = 0;   // 表演独占期：这段时间内不接受自动待机动作
  let __exprCur = null;      // {id, label, at, dur}
  const exprData = () => {
    const d = window.FishExprCurves;
    return (d && d.styles && d.byLabel) ? d : null;
  };

  // 情绪词 → LumenAct 的 28 个标签。每个标签带一组同义词，命中按「词长 × 次数 × 靠前程度」打分，
  // 长词优先，所以「不好意思」压得过「好」。顺序只在同分时起作用。
  // 注意：右边第一项必须与 expr-curves.js 里 byLabel 的真实键一致。
  // 构建时的标签名和 catalog 的 labels 数组并不完全同名（开心欣慰→开心欢快、
  // 大眼睛微笑→大眼微笑、睁不开眼疲惫困倦→睡眼朦胧敷衍），写错就静默查不到、
  // 那句话永远路由不到这个情绪。resolveLabel 是这层错配的兜底。
  const EXPR_WORDS = [
    ["害羞", ["害羞", "不好意思", "脸红", "腼腆", "羞", "被夸", "局促", "别扭", "娇", "别这样夸", "好羞"]],
    ["生气愤怒", ["生气", "愤怒", "火大", "炸毛", "恼", "气死", "不爽", "凶", "怒", "鼓脸", "闹别扭", "凭什么", "过分"]],
    ["难过流泪", ["难过", "伤心", "哭", "委屈", "眼泪", "悲伤", "失落", "想哭", "低落", "呜呜", "心酸", "难受死"]],
    ["惊讶震惊", ["惊讶", "震惊", "吃惊", "吓", "意外", "愣住", "惊", "瞪", "真的假的", "不会吧", "居然", "竟然", "天啊", "骗人", "咦", "诶", "突然"]],
    ["开心欢快", ["开心", "高兴", "快乐", "欢快", "欣慰", "满足", "幸福", "舒服", "喜悦", "愉快", "兴奋", "太好了", "美滋滋", "爽", "棒"]],
    ["微笑", ["微笑", "笑", "嘴角", "愉悦", "温柔", "亲和", "哈哈", "有意思", "好玩", "乐"]],
    ["思考专注", ["思考", "琢磨", "专注", "认真", "解题", "考虑", "沉思", "回忆", "想办法", "想想", "让我想"]],
    ["担忧担心", ["担心", "担忧", "忧虑", "不安", "焦虑", "发愁", "紧张", "挂心", "糟了", "完了", "完蛋", "坏了", "怎么办"]],
    ["尴尬", ["尴尬", "无语", "被戳穿", "窘", "干笑", "汗颜", "社死"]],
    ["骄傲自豪", ["骄傲", "自豪", "得意", "炫耀", "了不起", "胜利", "臭美", "厉害吧", "服不服"]],
    ["挑眉逗趣", ["挑眉", "逗", "坏笑", "捉弄", "俏皮", "挑衅", "看戏", "嘿嘿", "逗你"]],
    ["感觉无聊无趣", ["无聊", "无趣", "没意思", "发呆", "乏味", "厌倦", "好闲"]],
    ["睡眼朦胧敷衍", ["困", "累", "疲惫", "想睡", "打哈欠", "没精神", "熬夜", "敷衍", "好困", "睡着"]],
    ["痛苦疼痛", ["痛", "疼", "难受", "不舒服", "折磨", "好疼"]],
    ["厌烦厌恶", ["厌烦", "厌恶", "嫌弃", "恶心", "烦死", "走开", "别烦", "不想理", "讨厌"]],
    ["道歉抱歉", ["抱歉", "道歉", "对不起", "赔罪", "认错", "我错了", "是我不好"]],
    ["卖萌和蔼安详", ["卖萌", "可爱", "和蔼", "安详", "撒娇", "软乎乎", "好可爱"]],
    ["大眼微笑", ["眼冒", "亮眼", "眼前一亮", "惊喜", "期待", "哇哦", "哇塞"]],
    ["星星眼", ["星星眼", "崇拜", "羡慕", "心动", "好厉害", "太厉害", "佩服", "好强"]],
    ["爱心眼", ["爱心", "喜欢", "爱", "迷恋", "花痴", "心动不已", "爱你"]],
    ["意志坚定", ["坚定", "决心", "发誓", "认真起来", "燃起来", "必胜", "一定"]],
    ["小眼震惊", ["目瞪口呆", "傻眼", "无语凝噎", "裂开", "当场石化", "搞什么"]],
    ["震惊疑惑质问", ["疑惑", "质问", "怀疑", "不解", "什么情况", "问号", "搞不懂", "看不懂", "为什么"]],
    ["头晕目眩", ["晕", "头昏", "天旋地转", "眩", "好晕"]],
    ["进入陌生环境担忧左顾右盼", ["陌生", "左顾右盼", "张望", "警惕", "四顾", "不认识"]],
    ["微笑_闭眼", ["闭眼笑", "眯眯眼", "笑眯", "眯眼笑"]],
    ["自然放松", ["放松", "平静", "安静", "休息", "待机", "中性", "淡定", "没事"]],
    ["欣慰宽慰", ["谢谢", "感谢", "辛苦了", "放心", "还好", "安心"]],
  ];

  // 情绪坐标：把 28 个标签放到四个轴上，才能算「这两个情绪有多近」。
  // 光靠字符串没法判断「微笑」和「开心欢快」是同一类、「害羞」和「生气」是两类。
  //   v 效价：-1 难受 … +1 舒服
  //   a 唤醒：0 平静 / 犯困 … 1 惊动
  //   s 社交：-1 疏远、防备 … +1 亲近、撒娇
  //   d 支配：-1 顺从、心虚 … +1 强势、笃定
  // 数值是照 97 段里各段实际长什么样标的（不是按词义猜的）：
  // 比如「骄傲自豪(嘴硬式得意)」唤醒不高但支配很高，「害羞」支配最低且社交最高。
  const EXPR_AXES = {
    "微笑": [0.6, 0.35, 0.5, 0.2],
    "微笑_闭眼": [0.65, 0.15, 0.6, 0.1],
    "大眼微笑": [0.8, 0.6, 0.6, 0.1],
    "开心欢快": [0.85, 0.8, 0.7, 0.3],
    "挑眉逗趣": [0.55, 0.6, 0.4, 0.55],
    "星星眼": [0.85, 0.7, 0.6, -0.2],
    "爱心眼": [0.9, 0.6, 0.9, -0.3],
    "卖萌和蔼安详": [0.6, 0.2, 0.8, -0.2],
    "欣慰宽慰": [0.55, 0.2, 0.5, 0.3],
    "害羞": [0.4, 0.55, 0.9, -0.6],
    "惊讶震惊": [0.1, 0.9, 0, 0],
    "震惊疑惑质问": [-0.1, 0.8, -0.2, 0.2],
    "小眼震惊": [-0.2, 0.75, -0.2, -0.3],
    "思考专注": [0.05, 0.35, 0, 0.3],
    "自然放松": [0.2, 0.1, 0.3, 0],
    "睡眼朦胧敷衍": [-0.15, 0.05, 0, -0.2],
    "感觉无聊无趣": [-0.3, 0.1, -0.5, 0.1],
    "厌烦厌恶": [-0.6, 0.4, -0.7, 0.3],
    "生气愤怒": [-0.7, 0.75, -0.3, 0.6],
    "意志坚定": [0.2, 0.5, 0.1, 0.9],
    "骄傲自豪": [0.55, 0.55, 0.2, 0.85],
    "尴尬": [-0.25, 0.5, 0.3, -0.5],
    "道歉抱歉": [-0.3, 0.25, 0.4, -0.8],
    "担忧担心": [-0.45, 0.45, 0.3, -0.4],
    "进入陌生环境担忧左顾右盼": [-0.35, 0.6, -0.4, -0.5],
    "难过流泪": [-0.85, 0.3, 0.3, -0.7],
    "痛苦疼痛": [-0.9, 0.7, -0.2, -0.6],
    "头晕目眩": [-0.6, 0.6, -0.3, -0.5],
  };

  // 语气（say 的 mood 参数）也换算成同一套坐标，用来当先验。
  // 这些值调自 MOODS 那六种气泡色：happy/shy/annoyed/pout/calm。
  const MOOD_AXES = {
    happy: [0.75, 0.6, 0.6, 0.15],
    shy: [0.4, 0.5, 0.9, -0.6],
    annoyed: [-0.55, 0.5, -0.4, 0.4],
    pout: [-0.5, 0.55, 0.2, 0.3],
    calm: [0.15, 0.1, 0.2, 0],
  };

  const axesOf = (label) => EXPR_AXES[label] || null;
  const axisDist = (a, b) => {
    if (!a || !b) return 9;
    const dv = a[0] - b[0];
    const da = a[1] - b[1];
    const ds = a[2] - b[2];
    const dd = a[3] - b[3];
    // 效价和社交权重高一点：情绪「好不好、亲不亲」比「激不激动」更像是另一种情绪
    return Math.sqrt(dv * dv * 1.3 + da * da * 0.7 + ds * ds * 1.15 + dd * dd * 0.9);
  };
  const mixAxes = (a, b, wa) => {
    if (!a) return b ? b.slice() : null;
    if (!b) return a.slice();
    const wb = 1 - wa;
    return [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb,
      a[2] * wa + b[2] * wb, a[3] * wa + b[3] * wb];
  };
  const nearestLabel = (axs) => {
    if (!axs) return null;
    let best = null;
    let bestD = 9;
    for (const k of Object.keys(EXPR_AXES)) {
      const dd = axisDist(axs, EXPR_AXES[k]);
      if (dd < bestD) { bestD = dd; best = k; }
    }
    return best;
  };

  // 标签名容错：先精确查，查不到就按「共同字符数」找最近的键。

  // 只认共同 ≥2 个字，避免把完全无关的情绪凑一起。
  const resolveLabel = (d, label) => {
    if (d.byLabel[label]) return label;
    let best = null;
    let bestHit = 0;
    for (const k of Object.keys(d.byLabel)) {
      const seen = new Set(k);
      let hit = 0;
      for (const ch of label) if (seen.has(ch)) hit++;
      if (hit > bestHit) { bestHit = hit; best = k; }
    }
    return bestHit >= 2 ? best : null;
  };

  // 一句话里挑一段。返回 style id，挑不到返回 null。
  // 「不讨厌」「没生气」「别难过」—— 词还在，意思反了。前一个字是否定词就跳过这一处。
  const NEG_PREFIX = new Set(["不", "没", "别", "甭", "无", "非", "未"]);

  const pickStyleByText = (text) => {
    const d = exprData();
    if (!d) return null;
    const t = String(text == null ? "" : text);
    if (!t.trim()) return null;
    const len = Math.max(1, t.length);
    let best = null;
    let bestScore = 0;
    for (const [label, words] of EXPR_WORDS) {
      const key = resolveLabel(d, label);
      const pool = key ? d.byLabel[key] : null;
      if (!Array.isArray(pool) || !pool.length) continue;
      let score = 0;
      for (const w of words) {
        let from = 0;
        let hits = 0;
        let firstAt = -1;
        for (;;) {
          const i = t.indexOf(w, from);
          if (i < 0) break;
          // 前一个字是否定词时这一处不算：「（小声）不讨厌」不该判成厌烦厌恶。
          // 否定词后面的词照样继续往后找，别因为一个「不」把整句都丢了。
          const prev = i > 0 ? t[i - 1] : "";
          if (!NEG_PREFIX.has(prev)) {
            if (firstAt < 0) firstAt = i;
            hits++;
          }
          from = i + w.length;
        }
        if (!hits) continue;
        // 词越长越具体；出现次数最多算 3 次；越靠句首越像在说主语的情绪。
        // 单字词（「笑」「累」「晕」）单独一个不够定性 ——「别笑了」和「笑死」差得远，
        // 所以单字按 0.8 折算，靠它自己到不了门槛，得配语气或更长的词。
        const ww = w.length >= 2 ? w.length : 0.8;
        score += ww * Math.min(hits, 3) * (1 + Math.max(0, 1 - firstAt / len));
      }
      if (score > bestScore) { bestScore = score; best = key; }
    }
    if (!best) return null;
    const pool = d.byLabel[best];
    // 同一个标签常有好几段（微笑 7 段、惊讶 9 段、生气 4 段）。
    // 以前是纯随机 ——「被夸后嘴硬害羞」和「害羞」各有一半机会，说「被夸」的时候
    // 有一半概率演成普通害羞。现在先按 subcategory / environment 跟这句话
    // 重了几个字排队，重合够多就用它，都不重合才随机。
    const cand = pool.slice(0, Math.min(pool.length, 8));
    let pickId = cand[Math.floor(Math.random() * cand.length)];
    let bestAff = 1;
    for (const sid of cand) {
      const st = d.styles[sid];
      if (!st) continue;
      let aff = 0;
      for (const field of [st.subcategory, st.environment]) {
        if (!field) continue;
        for (const ch of new Set(String(field))) {
          if (t.indexOf(ch) >= 0) aff += 1;
        }
      }
      if (aff > bestAff) { bestAff = aff; pickId = sid; }
    }
    return { id: pickId, label: best, score: bestScore };
  };

  // 把超长段裁到 maxT 秒（neutral 那段有 52 秒，整段播完像卡住）。
  // 硬裁不会让脸停在半空：__act 的淡出兜底会把它平滑送回 base。
  const trimCurves = (curves, maxT) => {
    const out = [];
    for (const [id, pts] of curves) {
      const keep = pts.filter((p) => p[0] <= maxT);
      if (keep.length >= 2) out.push([id, keep]);
    }
    return out.length ? out : curves;
  };

  // ---------- 槽位解析：把「语义槽位」翻成这台模型的真实参数名 ----------
  // expr-curves.js v2 里的曲线键是槽位 id（angleX / eyeSmile / cheekPuff…），不是参数名。
  // 这里负责在「当前这个模型」里找到对应参数，顺序：
  //   ① 适配器里手动绑定的（用户改过就听用户的，最高优先）
  //   ② 槽位的 canon（标准 Cubism 名，findIdx 内部还会再过一次 PACK.paramMap）
  //   ③ 槽位的 alts（第三方模型的变体名，如 ParamEyeSmile / ParamCheek）
  //   ④ 键本身（兼容 v1 数据：老库里键就是参数名，info 为 null 时走这条）
  // 全找不到返回 null —— 调用方按降级表处理，绝不让整段表演静默失效。
  // 找一次就缓存：换模型必须调 exprSlotReset()，否则会拿旧模型的索引去写新模型。
  let exprSlotCache = Object.create(null);
  const exprSlotReset = () => { exprSlotCache = Object.create(null); };
  const resolveExprSlot = (slotId) => {
    if (slotId in exprSlotCache) return exprSlotCache[slotId];
    const d = exprData();
    const info = (d && d.slots && d.slots[slotId]) || null;
    const tried = [];
    const push = (n) => {
      const s = String(n == null ? "" : n).trim();
      if (s && tried.indexOf(s) < 0) tried.push(s);
    };
    if (PACK && PACK.params) push(PACK.params[slotId]);
    if (info) { push(info.canon); for (const a of (info.alts || [])) push(a); }
    push(slotId);
    let name = null;
    for (const c of tried) { if (findIdx(c) >= 0) { name = c; break; } }
    const rec = name ? {
      slot: slotId,
      name,
      gain: (info && typeof info.gain === "number") ? info.gain : 1,
      range: info ? info.range : null,
    } : null;
    exprSlotCache[slotId] = rec;
    return rec;
  };

  // 模型缺某个表情参数时的替代。只给「替代值当」的做映射 ——
  // 眉毛动不了就是动不了（拿嘴巴去凑只会更怪），宁可少一层也不乱补。
  // eyeSmile 是最值钱的一个：没有弯月笑眼时把眼睑压到 0.55 再配上扬的嘴角，
  // 观感能补回七八成「眯眼笑」，比完全没有强得多。
  const EXPR_DEGRADE = {
    eyeSmile: (pts) => ["eyeLOpen", pts.map(([t, v]) => [t, 1 - v * 0.45])],
  };

  // 把一段「槽位曲线」翻成「这台模型能写的参数曲线」。
  // 返回的 missing / mapped 不只是排障用：设置界面可以直接拿它告诉用户
  //「你这个模型能演 23 个槽里的 19 个，缺的是眉毛和鼓脸」——
  // 外接模型的用户最需要的就是这句话，而不是一句「表情好像有点弱」。
  const buildExprCurves = (curves) => {
    const out = [];
    const byName = Object.create(null);
    const missing = [];
    const mapped = [];
    const put = (name, pts) => {
      const i = byName[name];
      if (i === undefined) { byName[name] = out.length; out.push([name, pts]); }
      else out[i] = [name, pts];   // 同一参数多条：后面的槽更具体，覆盖前者
    };
    for (const [slotId, pts] of curves) {
      const r = resolveExprSlot(slotId);
      if (r) {
        const rg = r.range;
        const g = r.gain;
        let arr = pts;
        if (g !== 1 || rg) {
          arr = pts.map(([t, v]) => {
            let x = v * g;
            if (rg) x = Math.min(rg[1], Math.max(rg[0], x));
            return [t, x];
          });
        }
        put(r.name, arr);
        continue;
      }
      missing.push(slotId);
      const deg = EXPR_DEGRADE[slotId];
      if (!deg) continue;
      const [targetSlot, arr] = deg(pts);
      const rr = resolveExprSlot(targetSlot);
      // 替代目标自己也得真的存在，不然等于绕了一圈还是没写进去
      if (rr && rr.name) { put(rr.name, arr); mapped.push(slotId + "→" + targetSlot); }
    }
    return { curves: out, missing, mapped };
  };

  // ---------- 表情贴片（key 开关）----------
  // 这只模型 509 个参数里有一大半美术没接到 ArtMesh 上（探针实测 EyeSmile /
  // ParamBrowRY / Mouthpucker / ShockL / Angry 全都不动画面），但 key1~key13
  // 这 13 个「整张贴图切换」是活的，而且效果比参数强得多：
  //   key1 黑脸 / key2 眼角落泪 / key3 蚊香眼 / key4 粉红爱心眼 / key5 >< 笑眼
  //   key6 屑屑眼 / key7 脸颊红 / key9 张嘴 / key13 冷汗（几乎看不出）
  // 所以拿它们给情绪补一层「贴图级」的表达 —— LumenAct 段负责骨架和节奏，
  // 贴片负责那几个参数表达不了的重音。这是这个模型特有的加分项，别的模型没有
  // 这些参数时会自动跳过（findIdx 拿不到索引就不加）。
  const EXPR_KEY_PATCH = {
    "害羞": [["key7", 0.95, 2.4]],
    "爱心眼": [["key4", 1, 2.4]],
    // 落泪（key2）不挂了：主人摸她一下就看到眼泪，观感很怪。
    // 「难过流泪」「痛苦疼痛」两张脸本来就靠眼睑下垂 + 嘴角向下 + 眉毛垮下来表达，
    // 情绪够清楚了，不需要再加一滴眼泪。真要看落泪她自己会哭（motion 里有）。
    // 蚊香眼（key3）也不挂了：眼睛整片变白、看不见瞳仁，主人说像在哭，
    // 「头晕目眩」「小眼震惊」本来就该是眼睑无力 + 眼神散，不需要把眼珠挖掉。
    "微笑_闭眼": [["key5", 0.9, 1.8]],
    "开心欢快": [["key5", 0.55, 1.6]],
    "厌烦厌恶": [["key6", 0.9, 2.0]],
    "感觉无聊无趣": [["key6", 0.55, 1.8]],
    // 黑脸会把整张脸盖成剪影，表情全看不见 —— 只让她气到顶点时闪一下
    "生气愤怒": [["key1", 0.7, 1.1]],
    "惊讶震惊": [["key9", 0.65, 1.4]],
    "震惊疑惑质问": [["key9", 0.45, 1.4]],
  };

  let __exprPatch = null;
  const stopExprPatch = (cm) => {
    const p = __exprPatch;
    if (!p) return;
    __exprPatch = null;
    if (!cm) return;
    for (const it of p.items) {
      if (it.i >= 0) { try { cm.setParameterValueByIndex(it.i, 0, 1); } catch (e) { } }
    }
  };
  // 互动场景只放行这几张「加气氛」的贴片：脸红、爱心眼、>< 笑眼。
  // 黑脸、落泪、蚊香眼、张嘴是「她出事了」，被摸的时候不该出现。
  const EXPR_PATCH_SOFT = new Set(["key7", "key4", "key5"]);

  const startExprPatch = (label, dur, zone, level) => {
    if (TUNE.exprPatch === false) return;
    const spec = EXPR_KEY_PATCH[label];
    if (!spec || !spec.length) return;
    // 互动场景里，戳够 5 下才算真惹到她，之前只给加气氛的软贴片
    const lv = typeof level === "number" ? level : 1;
    const softOnly = zone === "pet" && lv < 5;
    const items = [];
    let longest = 0;
    for (const [name, peak, secs] of spec) {
      if (softOnly && !EXPR_PATCH_SOFT.has(name)) continue;
      const i = findIdx(name);
      if (i < 0) continue;
      // 段太短时贴片跟着收，不然表情都演完了脸上还挂着黑脸
      const d2 = Math.min(secs, Math.max(0.8, dur * 0.7));
      items.push({ i, name, peak, dur: d2 });
      longest = Math.max(longest, d2);
    }
    if (!items.length) return;
    __exprPatch = { t0: performance.now(), dur: longest, items, label };
  };
  const applyExprPatch = (cm) => {
    const p = __exprPatch;
    if (!p) return;
    const t = (performance.now() - p.t0) / 1000;
    if (t > p.dur) {
      __exprPatch = null;
      for (const it of p.items) {
        if (it.i >= 0) { try { cm.setParameterValueByIndex(it.i, 0, 1); } catch (e) { } }
      }
      return;
    }
    // 包络：0.3 秒淡入、尾部线性淡出。不对称是因为贴片最有用的是
    // 「刚开口那一下」，拖太久会盖住表情曲线本身。
    const fi = 0.3;
    const fo = Math.min(0.55, p.dur * 0.4);
    let w = 1;
    if (t < fi) w = t / fi;
    else if (t > p.dur - fo) w = Math.max(0, (p.dur - t) / fo);
    w = w * w * (3 - 2 * w);
    for (const it of p.items) {
      if (it.i < 0) continue;
      const k = t > it.dur ? 0 : Math.min(1, w);
      try { cm.setParameterValueByIndex(it.i, it.peak * k, 1); } catch (e) { }
    }
  };

  // 每段都带一个 pace 字段写自己的节奏（「反应快，之后赌气地停一会儿」
  // 「慢慢垂下眼睛，最后停一下」…）。以前一律按 9 秒裁：快节奏的回击被拖成慢动作，
  // 慢节奏的段落又被砍在半路。现在让它自己说多久：说「快/突然/一下」的给 5 秒，
  // 说「慢/从容/停一会」的给 12 秒，其余照旧 9 秒。
  const paceCap = (s) => {
    const p = String((s && s.pace) || "");
    const sub = String((s && s.subcategory) || "");
    // 「友善倾听」「从容等待」「安静休息」这类是挂着不动的陪伴表情，
    // 本来就要撑很久 —— 按 9 秒裁等于她听着听着突然变脸。
    if (/倾听|等待|休息|陪伴|安静/.test(sub)) return 20;
    // 只看节奏描述的开头，别被句子中段的「短促」「停一下」带偏：
    //「先观察，再短促加深坏笑」整体是 15 秒的段，不是 5 秒的回击。
    if (/^(快|轻快|立刻|迅速|突然|马上)/.test(p)) return 5;
    if (/^(慢|从容|缓缓|舒缓|自然|不急)/.test(p)) return 12;
    return 9;
  };

  const playExprStyle = (id, opts) => {
    const d = exprData();
    if (!d) return { ok: false, why: "表演库没加载（src/expr-curves.js）" };
    const s = d.styles[String(id)];
    if (!s) return { ok: false, why: "没有这一段: " + id };
    const o = opts || {};
    const maxT = typeof o.maxSec === "number" ? o.maxSec : paceCap(s);
    const base = (s.dur > maxT) ? trimCurves(s.curves, maxT) : s.curves;
    // 头部三个角度按 mixedParams 缩一下（0.55）：LumenAct 头动是按它自己那个参考
    // 角色的松紧标定的，整份搬会「头甩得比身体快」。留一半给本项目的呼吸和待机摆动。
    // 缩放放在播放端而不是烘进数据，是为了以后调这个系数不用重新生成 388KB。
    const mixMap = {};
    for (const [k, v] of (d.mixedParams || [])) mixMap[k] = v;
    const hasMix = Object.keys(mixMap).length > 0;
    const mixed = hasMix
      ? base.map(([k, pts]) => (mixMap[k] != null ? [k, pts.map(([t, v]) => [t, v * mixMap[k]])] : [k, pts]))
      : base;
    // v2 的关键一步：曲线键是槽位 id，这里翻成本模型真实参数名。
    // 模型没有的槽按 EXPR_DEGRADE 打折（笑眼→眯眼），其余直接丢 ——
    // 丢掉的会进 missing，设置界面可以据此告诉用户「你缺了哪几个表情通道」。
    const built = buildExprCurves(mixed);
    const curves = built.curves;
    if (!curves.length) {
      return {
        ok: false,
        why: "这个模型没有任何可用的表情参数（" + (built.missing || []).join(",") + "）",
        missing: built.missing,
      };
    }
    let dur = 0;
    for (const [, pts] of curves) dur = Math.max(dur, pts[pts.length - 1][0]);
    launchMotion("lumen-" + s.id, curves, dur, "expr");
    startExprPatch(s.label, dur, opts && opts.zone, opts && opts.level);
    const holdMs = typeof o.holdMs === "number" ? o.holdMs : dur * 1000 + 700;
    __exprLockUntil = performance.now() + holdMs;
    __exprCur = { id: s.id, label: s.label, at: performance.now(), dur };
    // 自动换表情也一起推后：否则 14 秒后 maybeChangeExpr 会把她换回随机脸
    nextExprAt = Math.max(nextExprAt, Date.now() + Math.max(holdMs, 14000));
    return {
      ok: true, id: s.id, label: s.label, sub: s.subcategory,
      dur: Math.round(dur * 1000) / 1000,
      curves: curves.length,
      // 这次用的槽位 → 真实参数名（排障/适配器展示用）
      used: curves.map(([n]) => n),
      missing: built.missing,
      mapped: built.mapped,
    };
  };

  // 台词 → 表情的反应器。say() 每冒一句话都会喊它一次。
  // 门槛 score ≥ 4：两字词命中一次大约 4~6 分，只蹭到一个单字（「好」「行」）到不了，
  // 这样闲聊里的口水话不会让脸一直抖。
  // 同一段 5 秒内不重播：连续两句都带「不好意思」时，不该把同一次害羞从头演一遍。
  const exprLast = { label: null, at: 0 };

  // ---------- 情绪编排 ----------
  // say() 一次给一整句话，里面常有好几个转折：「咦？你怎么来了……算了，谢谢你吧。」
  // 以前只取分最高的那一个，一句话只演一张脸，后面半句的转折全丢。现在切成小句
  // 各自打分，相邻同情绪合并，排成一张播放表依次演 —— 一句话有几个转折就演几个。
  const EXPR_SEQ_MAX = 4;      // 一句最多演 4 段，再多就碎成抽搐
  let __exprQueue = [];
  const splitClauses = (text) => String(text || "")
    .split(/[，,。.！!？?；;…~～、\n\r]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const buildExprSeq = (text, ctx) => {
    const seq = [];
    for (const part of splitClauses(text)) {
      // 单字也放进来：「咦」「哇」「诶」本身就是转折的起手式，
      // 靠 decideExpr 的 minScore 门槛把关，不在这里按长度砍。
      if (!part.length) continue;
      const pick = decideExpr(part, ctx, { minScore: 1.2 });
      if (!pick) continue;
      const last = seq[seq.length - 1];
      // 相邻两段落在同一片情绪区就当一段，别为了一个词把脸抖两次
      if (last && axisDist(axesOf(last.label), axesOf(pick.label)) < 0.25) continue;
      seq.push(pick);
      if (seq.length >= EXPR_SEQ_MAX) break;
    }
    return seq;
  };

  // 队列里的下一段。表情轨播完时由 applyParams 调起来。
  // 返回 false 表示没有下一段了，调用方据此清掉「当前字幕/情绪」。
  const exprSeqNext = () => {
    const next = __exprQueue.shift();
    if (!next) { __exprCur = null; return false; }
    const r = playExprStyle(next.id, { seq: true, zone: next.zone, level: next.level });
    return !!(r && r.ok);
  };

  // 决定这句话该演哪一段 —— 只算，不播。
  // 抽出来是因为要能被 exprReact（真播）和 FishModel.exprPreview（调试/测试）共用，
  // 免得两边各写一套判断，改了一边忘了另一边。
  // 互动场景（摸头、戳脸、点身体）里不许出现的表情段。
  // 只在 ctx.zone === "pet" 时生效，聊天、看屏幕点评照常演。
  const EXPR_PET_BAN = new Set(["难过流泪", "痛苦疼痛", "道歉抱歉"]);

  const decideExpr = (text, ctx, opt) => {
    const mood = (ctx && ctx.mood) || null;
    const role = (ctx && ctx.role) || "self";
    const hasMood = !!(mood && MOOD_AXES[mood]);
    const hit = pickStyleByText(text);
    // 文本只蹭到一个单字（score < 4）时本身不够换脸；但这一句带了明确语气，
    // 就让语气去挑一段 ——「嗯嗯，好」配 happy 也可以笑一下。
    // 序列模式下门槛降低：「咦」「哇」这种单字起头的小句是转折的开始，
    // 单字权重只有 0.8，按 2.0 算永远进不来。整句只演一段时仍然用 2.0。
    const EXPR_MIN_SCORE = (opt && typeof opt.minScore === "number") ? opt.minScore : 2.0;
    // 文本只蹭到一个单字时本身不够换脸；但这一句带了明确语气，
    // 就让语气去挑一段 ——「嗯嗯，好」配 happy 也可以笑一下。
    if (!hit && !hasMood) return null;
    if (hit && hit.score < EXPR_MIN_SCORE && !hasMood) return null;

    let label = hit ? hit.label : null;
    let via = hit ? "text" : "mood";
    if (!label) {
      // 语气只有五个值，比文本粗得多，只能当粗分类用
      label = nearestLabel(MOOD_AXES[mood]);
    } else if (hasMood) {
      // 文本 7 : 语气 3。文本说的是「内容」（谁生气了、对谁说的），
      // 语气只说「她怎么说的」—— 内容更可信，但语气决定她要不要嘴硬。
      const near = nearestLabel(mixAxes(axesOf(label), MOOD_AXES[mood], 0.7));
      // 只有明显不同才改判。差一点点就改的话，
      // 「开心」配上 calm 语气会被拽到「微笑」，等于白改。
      if (near && near !== label && axisDist(axesOf(near), axesOf(label)) > 0.45) {
        label = near;
        via = "blend";
      }
    }
    if (!label) return null;

    // 转述别人的话时情绪要反过来：主人在生气，她不该跟着生气，该是担忧/小心翼翼。
    // 这条留接口给以后有转述场景的调用点，默认 role=self 不会触发。
    if (role === "relay") {
      const ax = axesOf(label);
      if (ax) label = nearestLabel([-ax[0] * 0.6, ax[1] * 0.85, ax[2], -ax[3]]) || label;
    }

    // 被摸、被戳的时候不演「她难受」那一类。她正在被人揉头，脸上却是难过流泪，
    // 主人当场就说「这也太奇怪了」。段本身没错，错的是用在互动场景里。
    // 「头晕目眩」（蚊香眼）「厌烦厌恶」（傲娇）「震惊疑惑质问」都留着 ——
    // 被甩、被戳时那几张脸是对的。
    //
    // 但也不能永远没脾气：ctx.level 是这一轮连点的次数（petCombo）。
    // 戳一两下是撒娇，戳到第 5 下才是真被烦炸了 —— 那时候哭、黑脸都算她的权利。
    if (ctx && ctx.zone === "pet") {
      const lv = typeof ctx.level === "number" ? ctx.level : 1;
      if (lv < 5 && EXPR_PET_BAN.has(label)) return null;
    }

    const d = exprData();
    const key = d ? resolveLabel(d, label) : null;
    const ids = key && d ? d.byLabel[key] : null;
    let id = null;
    if (Array.isArray(ids) && ids.length) {
      // 同一标签下通常有好几段，随机一个；一直用首段会看腻
      id = ids[Math.floor(Math.random() * Math.min(ids.length, 6))];
    }
    if (id == null && hit) id = hit.id;
    if (id == null) return null;
    return { label, id, via, mood, score: hit ? hit.score : 0, axes: axesOf(label) };
  };

  exprReact = (text, ctx) => {
    const pick = decideExpr(text, ctx);
    if (!pick) return null;
    const label = pick.label;

    // 动作轨和表情轨现在分开了：摸头在动作轨上，表情在表情轨上，两者互不顶掉。
    // 但如果正在播的动作里**本身带脸**（老 motions 里有 ParamMouthForm、眼睑这种），
    // 再叠一层表情就会两张脸打架 —— 这种情况还是让动作先演完。
    if (__act && __act.name && String(__act.name).indexOf("lumen-") !== 0) {
      const at = (performance.now() - __act.t0) / 1000;
      let hasFace = false;
      for (const [pid] of __act.curves) { if (EXPR_DOMAIN[pid]) { hasFace = true; break; } }
      if (hasFace && at < (__act.dur || 0) * 0.8) return null;
    }
    const now = performance.now();
    // 同类情绪不重演：12 秒内换到「同一片情绪区」就保持当前这一段演完。
    // 之前只按标签名判重，微笑→大眼微笑→开心欢快 会来回切，看着像脸在抖。
    if (exprLast.label && now - exprLast.at < 12000) {
      if (axisDist(axesOf(label), axesOf(exprLast.label)) < 0.25) return null;
    }

    // 这句话里有转折就编排成序列（「咦？…算了，谢谢你吧」演惊讶 + 欣慰），
    // 只有一种情绪就走原来那一条路。
    const seq = buildExprSeq(text, ctx);
    if (seq.length >= 2) {
      // 队列里的后续段要继承这一句的上下文，否则第二段起就回到「默认」场景，
      // 互动时照样会给她摆一张苦脸
      __exprQueue = seq.slice(1).map((s) => Object.assign({ zone: ctx && ctx.zone, level: ctx && ctx.level }, s));
      const r = playExprStyle(seq[0].id, { seq: true, zone: ctx && ctx.zone, level: ctx && ctx.level });
      if (r && r.ok) {
        exprLast.label = label;
        exprLast.at = now;
        r.pick = { label, via: pick.via, mood: pick.mood };
        r.seq = seq.map((s) => ({ label: s.label, id: s.id }));
      }
      return r;
    }
    __exprQueue = [];

    const r = playExprStyle(pick.id, { maxSec: 8, zone: ctx && ctx.zone, level: ctx && ctx.level });
    if (r && r.ok) {
      exprLast.label = label;
      exprLast.at = now;
      r.pick = { label, via: pick.via, mood: pick.mood };
    }
    return r;
  };

  // 排障/测试用：能直接指定表情，也能看她现在是什么表情。
  window.FishModel = {
    // 手感参数快照：适配器/自动化测试要能确认「我存的那组数」真的进了渲染端
    tuning: () => Object.assign({}, TUNE),

    // 贴图精度：0=自动，1024/2048/3072/4096=长边像素上限。
    // 立刻生效（重画贴图，不用重启）；设置页改完会调这个。
    setTexMax: async (v) => {
      const n = Number(v);
      TUNE.texMax = Number.isFinite(n) && n >= 0 ? n : 0;
      if (typeof __applyTexQuality !== "function") return { ok: false, why: "模型还没加载完" };
      try {
        await __applyTexQuality(TUNE.texMax);
        return { ok: true, texMax: TUNE.texMax, tex: (model && model.textures || []).map((t) => {
          const s = t && (t.source || (t.baseTexture && t.baseTexture.source));
          return s ? s.width + "x" + s.height : "?";
        }) };
      } catch (e) {
        return { ok: false, why: String((e && e.message) || e) };
      }
    },
    texQuality: () => {
      let cap = 0;
      try {
        const gl = app && app.renderer && app.renderer.gl;
        cap = gl ? gl.getParameter(gl.MAX_TEXTURE_SIZE) : 0;
      } catch (e) { cap = 0; }
      return {
        texMax: Number(TUNE.texMax) || 0,
        auto: !(Number(TUNE.texMax) > 0),
        gpuMax: cap,
        tex: (model && model.textures || []).map((t) => {
          const s = t && (t.source || (t.baseTexture && t.baseTexture.source));
          return s ? s.width + "x" + s.height : "?";
        }),
      };
    },
    setExpr,
    changeExpr: () => { nextExprAt = 0; maybeChangeExpr(); return curExpr; },
    cur: () => curExpr,
    ready: () => !disposed,
    list: () => EXPR_OK.slice(),
    // 换动作的统一入口：旧动作不立刻丢，留着做 0.24 秒交叉淡化。
    // 之前是直接覆盖 __act，画面上表现为「上一个动作被抽走」——短动作尤其明显。
    playMotion: (name, curves) => {
      if (!Array.isArray(curves) || !curves.length) return { ok: false, why: "no curves" };
      let dur = 0;
      for (const [, pts] of curves) dur = Math.max(dur, pts[pts.length - 1][0]);
      launchMotion(name, curves, dur);
      return { ok: true, dur, curves: curves.length };
    },
    // ---------- LumenAct 表演（97 段动捕表情） ----------
    // expr(id)      按段号播，例如 expr("54") 是害羞
    // exprText(句子) 从一句话里挑情绪，比如 exprText("被夸得有点不好意思")
    // 两者都返回 {ok, id, label, dur}，调用方拿 label 就知道她演的是哪一段。
    expr: (id, opts) => playExprStyle(id, opts),
    // 只算不播：给一句话（和可选语气），看她会挑哪一段。
    // 设置界面和测试都用它 —— 不用等 9 秒动画播完才知道判得对不对。
    exprPreview: (text, mood) => {
      const p = decideExpr(text, { mood });
      if (!p) {
        // 没命中时把「差在哪」一并吐出来：分不够还是压根没词，
        // 调词表和调门槛时看这一条就知道该动哪个。
        const raw = pickStyleByText(text);
        return { ok: false, mood: mood || null,
          why: raw ? "命中「" + raw.label + "」但分数 " + Math.round(raw.score * 10) / 10 + " 不够 " + EXPR_MIN_SCORE
            : "这句话里没听出情绪（也没有语气可用）",
          raw: raw ? { label: raw.label, id: raw.id, score: Math.round(raw.score * 10) / 10 } : null };
      }
      return { ok: true, id: p.id, label: p.label, via: p.via, mood: p.mood, score: p.score,
        axes: p.axes.map((v) => Math.round(v * 100) / 100) };
    },
    // 情绪坐标查询：调权重/调坐标时看这些数就知道两段有多近
    exprAxes: (label) => { const a = axesOf(label); return a ? a.slice() : null; },
    exprAxisDist: (a, b) => Math.round(axisDist(axesOf(a), axesOf(b)) * 1000) / 1000,
    exprText: (text, opts) => {
      // 走 exprReact 而不是直接 playExprStyle：这样一句话里有转折时
      // 会走编排（演完第一段自动接下一段），和 say() 的行为一致。
      // opts.seq === false 时可以强制只演一段，调试单段时用。
      if (opts && opts.seq === false) {
        const hit = pickStyleByText(text);
        if (!hit) return { ok: false, why: "这句话里没听出情绪: " + String(text == null ? "" : text) };
        const r = playExprStyle(hit.id, opts);
        if (r && r.ok) { r.score = Math.round(hit.score * 10) / 10; r.hit = hit.label; }
        return r;
      }
      const r2 = exprReact(text, opts || {});
      if (r2 && r2.ok) {
        const raw = r2.pick && r2.pick.raw;
        r2.hit = (raw && raw.label) || r2.label;
        r2.score = (raw && raw.score) || 0;
      }
      return r2 || { ok: false, why: "这句话里没听出情绪: " + String(text == null ? "" : text) };
    },
    // 全部 97 段的清单，供设置界面/调试挑选
    exprList: () => {
      const d = exprData();
      if (!d) return [];
      return Object.keys(d.styles).map((k) => {
        const s = d.styles[k];
        return { id: s.id, label: s.label, sub: s.subcategory, emotion: s.emotion, env: s.environment, pace: s.pace, dur: s.dur };
      });
    },
    exprCur: () => (__exprCur
      ? Object.assign({}, __exprCur, { queue: __exprQueue.map((s) => s.label) })
      : (__exprQueue.length ? { id: null, label: null, queue: __exprQueue.map((s) => s.label) } : null)),
    // 编排预览：一句话会被切成几段、每段演哪个标签。只算不播，
    // 拿去对台词、写文档、检查「这句话到底会被演成几张脸」都用它。
    exprSeq: (text, ctx) => {
      const seq = buildExprSeq(text, ctx || {});
      return {
        ok: seq.length > 0,
        n: seq.length,
        parts: seq.map((s) => ({ label: s.label, id: s.id, via: s.via, score: s.score })),
        queue: __exprQueue.map((s) => s.label),
      };
    },
    // 这个模型能演多少 —— 外接模型的用户第一眼要看的就是这句。
    // 23 个语义槽里能直接写进去几个（direct）、靠降级近似几个（degraded）、
    // 完全没有几个（missing）。score 是加权百分比，缺的那些值多少分一次说清。
    // 适配器/设置界面拿 rows 就能列一张「缺眉高、缺鼓脸」的表，让用户自己决定补不补。
    exprSlots: () => {
      const d = exprData();
      if (!d || !d.slots) return { ok: false, why: "表演库没加载（src/expr-curves.js）" };
      const rows = [];
      let direct = 0;
      let degraded = 0;
      // 加权评分：按「这个槽对表情辨识度的贡献」算，不按参数个数。
      // 理由：只有眼睑+嘴型的模型照样能演害羞/生气/难过，缺眉毛只是少一层细节；
      // 按个数平均会把它算成 40%，用户会以为自己模型废了。
      let wTotal = 0;
      let wGot = 0;
      for (const slotId of Object.keys(d.slots)) {
        const info = d.slots[slotId];
        const w = typeof info.weight === "number" ? info.weight : 1;
        wTotal += w;
        const r = resolveExprSlot(slotId);
        let state = "missing";
        let via = "";
        if (r) { state = "ok"; direct++; wGot += w; }
        else {
          const deg = EXPR_DEGRADE[slotId];
          if (deg) {
            const target = deg([[0, 0]])[0];
            const rr = resolveExprSlot(target);
            if (rr && rr.name) { state = "degraded"; via = rr.name; degraded++; wGot += w * 0.6; }
          }
        }
        rows.push({
          slot: slotId, label: info.label, canon: info.canon,
          param: r ? r.name : null, state, via,
          range: info.range, gain: info.gain, weight: w,
        });
      }
      return {
        ok: true, total: rows.length, direct, degraded,
        missing: rows.length - direct - degraded,
        score: wTotal > 0 ? Math.round((wGot / wTotal) * 100) : 0,
        rows,
      };
    },
    exprLocked: () => performance.now() < __exprLockUntil,
    // 立刻收表演、回到中性，并解开独占期
    exprStop: () => {
      __exprLockUntil = 0;
      __exprCur = null;
      // 只收表情轨。以前这里把 __act 也清了，结果「停止表情」会顺手掐掉
      // 正在播的摸头/喂食 —— 现在两条轨分开，各停各的。
      __exprTrack = null;
      __exprPrev = null;
      __exprQueue = [];
      // 贴片是贴图级开关，停下必须显式归零，否则脸上会一直挂着黑脸/蚊香眼
      try {
        const m = model;
        stopExprPatch(m && m.internalModel && m.internalModel.coreModel);
      } catch (e) { }
      return true;
    },
    // 单独把贴片收掉（设置里把「表情开关贴片」关掉时用），不动正在播的动作和表情段
    exprClearPatch: () => {
      try {
        const m = model;
        stopExprPatch(m && m.internalModel && m.internalModel.coreModel);
      } catch (e) { }
      return true;
    },
    // 播素材库里的动作文件（含未登记进 model3 的那些）。
    playFile: (file, o) => loadMotionFile(file).then((parsed) => {
      if (!parsed || !parsed.curves.length) return { ok: false, why: "动作里没有可播的曲线" };
      launchMotion((o && o.name) || file, parsed.curves, parsed.duration);
      return { ok: true, dur: parsed.duration, curves: parsed.curves.length, loop: parsed.loop };
    }).catch((e) => ({ ok: false, why: String(e && e.message) })),
    motions: () => ((PACK && PACK.motions) || []),
    stopMotion: () => { __act = null; __actPrev = null; return true; },
    // 按名字播 motion.js 里的动作。场景代码只认名字，不关心曲线长什么样
    action: (name) => {
      const lib = (window.FishMotions || {});
      const curves = lib[name];
      if (!Array.isArray(curves) || !curves.length) return { ok: false, why: "no motion: " + name };
      let dur = 0;
      for (const [, pts] of curves) dur = Math.max(dur, pts[pts.length - 1][0]);
      launchMotion(name, curves, dur);
      return { ok: true, dur };
    },
    // 从场景表里随机挑一个播。同一个场景连着触发时尽量不重样。
    // 注意这里必须真的播出去：之前只挑名字不播，测试时看到返回了 name
    // 就以为成功了，结果画面上什么都没发生。
    actionFor: (scene) => {
      // 先问模型包：这个场景在这台模型上要怎么演？
      //   builtin → 用内置曲线（默认；任何模型都能跑，只要参数映射得上）
      //   model   → 播模型自带的 motion（组名由适配器挑）
      //   none    → 明确不做（适配器里把某个槽设成「不动」）
      const route = PACK && PACK.sceneRoutes && PACK.sceneRoutes[scene];
      if (route && route.engine === "none") return { ok: false, why: "muted: " + scene };
      if (route && route.engine === "file" && route.file) {
        // 素材库里没有登记进 model3 的 motion3：现读现播。
        window.FishModel.playFile(route.file, { name: route.name || route.file });
        return { ok: true, engine: "file", file: route.file };
      }
      if (route && route.engine === "model" && route.motion && model) {
        try {
          // 模型动作走 motionManager；motionFinish 会把 idle 接回来。
          __motionOwn = null;
          lockModelMotion(route.motion, route.index || 0);
          model.motion(route.motion, route.index || 0, 3);
          return { ok: true, engine: "model", name: route.motion };
        } catch (e) {
          return { ok: false, why: "model motion failed: " + route.motion };
        }
      }
      const useScene = (route && route.scene) || scene;
      // LumenAct 表演的独占期：idle / idleSoft 是定时轮换用的场景，插进来会把演到
      // 一半的段落顶掉（看着像「她演两秒就走神」）。用户交互触发的场景不拦。
      if ((useScene === "idle" || useScene === "idleSoft") && performance.now() < __exprLockUntil) {
        return { ok: false, why: "expr-lock" };
      }
      const tbl = (window.FishMotionScenes || {});
      const list = tbl[useScene];
      if (!Array.isArray(list) || !list.length) return { ok: false, why: "no scene: " + useScene };
      let pick;
      if (pickLib) {
        // 情绪偏置 + 最近三段防重复：以前只排掉「上一段」，
        // 三段的小表里会来回横跳 A→B→A→B，看着像卡住。
        const petNow = window.FishPet && window.FishPet.snapshot ? window.FishPet.snapshot() : null;
        const mood = pickLib.moodOf({
          favor: petNow ? petNow.favor : 50,
          hunger: petNow ? petNow.hunger : 100,
          hour: new Date().getHours(),
          phase,
        });
        const recent = actionRecent[useScene] || (actionRecent[useScene] = []);
        // 场景名有时带后缀（idleSoft 之类），偏置按前缀查，所以两套键都试
        pick = pickLib.pickScene(list, { mood, recent });
        recent.push(pick);
        if (recent.length > 3) recent.shift();
      } else {
        pick = list[0];
        if (list.length > 1) {
          const last = actionLast[scene];
          const pool = list.filter((x) => x !== last);
          pick = pool[Math.floor(Math.random() * pool.length)] || list[0];
        }
      }
      actionLast[scene] = pick;
      const lib = (window.FishMotions || {});
      const curves = lib[pick];
      if (!Array.isArray(curves) || !curves.length) return { ok: false, why: "no motion: " + pick };
      let dur = 0;
      for (const [, pts] of curves) dur = Math.max(dur, pts[pts.length - 1][0]);
      launchMotion(pick, curves, dur);
      return { ok: true, name: pick, dur };
    },
    motionOwn: () => (__motionOwn ? Array.from(__motionOwn) : null),
    // 诊断用：当前手写动作的播放状态 + 这一帧各曲线应该写到多少。
    //  注意别用 FishModel.param() 去验动作——那是帧外读，拿到的是 loadParameters()
    // 恢复后的值，永远是默认值；想看动作有没有在推，只能看这里，或者直接看画面。
    _act: () => {
      // 两条轨各报一份：body 是动作，expr 是表情。要验「摸头同时挂害羞」
      // 就同时看这两条，它们现在可以都有。
      const one = (a) => {
        if (!a) return null;
        const t = ((performance.now() - a.t0) / 1000) * (a.speed || 1);
        const want = {};
        // 参数顺序是 (t, pts)：lib/curve.js 的签名就是 curve(t, pts)。
        // 写成 lerpAt(pts, t) 会让 curve 的第一个形参拿到数组、第二个拿到数字，
        // 于是 typeof pts.length !== "number" 直接 return 0 —— 动作曲线恒为 0。
        for (const [id, pts] of a.curves) want[id] = Math.round(lerpAt(t, pts) * 1000) / 1000;
        return {
          name: a.name,
          t: Math.round(t * 1000) / 1000,
          dur: a.dur,
          curves: a.curves.length,
          track: a.track || "body",
          want,
        };
      };
      const body = one(__act);
      const expr = one(__exprTrack);
      if (!body && !expr) return null;
      // 兼容旧调用：顶层字段仍然报动作轨，另外多一个 expr。
      if (body) return Object.assign({}, body, { expr });
      return Object.assign({}, expr, { name: null, expr });
    },
    // 之前「动作没生效」查了半天就是因为这张表可能是空的，而外面看不见。
    _idx: (name) => {
      if (name === undefined) return { built: !!IDX2, n: IDX2 ? Object.keys(IDX2).length : 0 };
      return { name, i: findIdx(name), inIDX2: IDX2 ? IDX2[name] : undefined, inPIDX: PIDX[name] };
    },
    // 直接摸到 model，排查表情为什么没生效时用
    _model: () => model,
    // 当前这一帧的「意图」（target）：参数本身在帧外读到的是 loadParameters 恢复后的值，
    // 永远是默认。所以要验惯量、歪头这类效果，只能看这里。
    _target: () => (lastTarget ? JSON.parse(JSON.stringify(lastTarget)) : null),
    // 甩出去之后的余速：松手那一瞬间记下来的
    _fling: () => ({ vx: Math.round(dragVX * 10) / 10, vy: Math.round(dragVY * 10) / 10, fling: Math.round(fling * 10) / 10 }),
    // 性能观测：帧率、上限、画布尺寸、堆占用。优化前后要拿它对比，不能凭感觉。
    perf: () => ({
      fps: app && app.ticker ? Math.round(app.ticker.FPS) : -1,
      maxFps: app && app.ticker ? app.ticker.maxFPS : -1,
      canvas: app && app.canvas ? [app.canvas.width, app.canvas.height] : null,
      res: app && app.renderer ? app.renderer.resolution : -1,
      heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1,
      tickN: tick._n || 0,
      ranN: tick._ran || 0,
      calm: !!tick._calm,
      // calm 是怎么判出来的 —— 只看一个 false 猜不出是被谁卡的
      why: {
        dragging: !!dragging,
        working: !!(phase === "tool" || phase === "review"),
        idleS: Math.round((Date.now() - lastMoveAt) / 1000),
        phase: phase,
      },
    }),
    _app: () => app,
    _ex: () => ({ want: { ...exWant }, now: { ...exNow }, defs: Object.keys(EXPR_DEF) }),
    _exprInfo: () => {
      try {
        const em = model.internalModel.motionManager.expressionManager;
        return {
          hasManager: !!em,
          definitions: em && em.definitions ? em.definitions.map((d) => d.name || d.Name) : null,
          current: curExpr,
        };
      } catch (e) { return { err: String(e) }; }
    },
    // 读一个参数的实际值。表情到底有没有写进模型，看这个最准。
    // 注意必须走 findIdx，不能用 cm.getParameterIndex，
    // 后者返回的索引带偏移（Movement2 会给 510，真值是 16），读出来是别的变形器。
    param: (name) => {
      try {
        const cm = model.internalModel.coreModel;
        const i = findIdx(name);
        return i < 0 ? null : cm.getParameterValueByIndex(i);
      } catch (e) { return "ERR " + e.message; }
    },
    // 一次看她脸上的几个「开关」（表情用的就是这些自定义 key）
    keys: () => {
      const out = {};
      try {
        const cm = model.internalModel.coreModel;
        ["key1", "key2", "key3", "key4", "key5", "key6", "key7", "key8", "key9",
          "key10", "key11", "key12", "key13"].forEach((k) => {
            const i = findIdx(k);
            out[k] = i < 0 ? "n/a" : Math.round(cm.getParameterValueByIndex(i) * 1000) / 1000;
          });
      } catch (e) { out.err = String(e); }
      return out;
    },
  };

  // 取景。三条铁律，违反任何一条都会"某个部位撑满整个容器"：
  // pixi 的 screen 是逻辑尺寸、renderer.width 是物理尺寸，
  // resolution=2 时两者差两倍，混用就会出问题。
  // 1) 尺寸只认 canvas 的父容器，不是 documentElement / window —— 它们中间
  //    还隔着 html/body 的盒模型，窗口动画中间会拿到旧值。
  // 2) 先把 CSS 尺寸夺回来（pixi 的 autoDensity 会把它改写成 px），
  //    再量、再 resize(物理像素)，最后再夺一次。
  // 3) 尺寸一变就必须重算 fit，不能只 resize 不重算。
  // 上一帧的 fit（排查用，看取景有没有被中间态带偏）
  let lastFit = 0;
  // 取景矩形：模型上的哪一块装进窗口。存成 { y, h }（相对包围盒 0~1），
  // 由「调整取景」那个窗口拖出来。换模型也不用重推公式。
  let viewBox = { y: -0.02, h: 0.40 };
  let baseW = 0, baseH = 0;   // 模型原始画布尺寸，只认第一次量到的
  let resizeObs = null;

  // 尺寸稳定化：窗口动画/缩放过程中 ResizeObserver 会连着触发好几次，
  // 中间那几帧的容器尺寸和取景参数对不上，会让模型偏一下。
  // 用法：想重算取景时调 relayoutSoon()，它会等到尺寸连续两次一致才真算。
  let pendingSize = "";
  let pendingTimer = 0;
  let lastStableSize = "";

  const relayoutSoon = () => {
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      pendingTimer = 0;
      if (!model || !app || !app.canvas) return;
      const host = app.canvas.parentElement || document.body;
      const key = host.clientWidth + "x" + host.clientHeight;
      if (key !== lastStableSize) {
        lastStableSize = key;
        pendingSize = "";
        layout();
        // 再来一帧确认（有些机器上 clientWidth 会晚一帧才准）
        requestAnimationFrame(() => {
          if (!model || !app || !app.canvas) return;
          const h2 = app.canvas.parentElement || document.body;
          const k2 = h2.clientWidth + "x" + h2.clientHeight;
          if (k2 !== key) { lastStableSize = k2; layout(); }
        });
      }
    }, 120);
  };

  const layout = () => {
    if (!model || !app || !app.canvas) return;
    const host = app.canvas.parentElement || document.body;

    // 先让画布铺满容器（容器本身由 CSS 决定大小）
    app.canvas.style.width = "100%";
    app.canvas.style.height = "100%";

    // 量真实容器
    const cw = Math.max(1, Math.round(host.clientWidth || 0));
    const ch = Math.max(1, Math.round(host.clientHeight || 0));

    // 按物理像素改渲染目标（resolution 已由 pixi 记住）
    try { app.renderer.resize(cw, ch); } catch (e) { }

    // 夺回 CSS 尺寸：resize 会把 style 写成 "cw px"，不夺回来就会被拉伸
    app.canvas.style.width = "100%";
    app.canvas.style.height = "100%";

    W = cw;
    H = ch;

    //  【必须用原始尺寸，不能用 model.width】
    //  pixi v8 的 model.width = Math.abs(scale.x) * 原始宽，会跟着 model.scale 变。
    //  若这里读 model.width 再把它算出的 fit 设回 model.scale，就成了反馈回路：
    // 每重算一次就把上一次的缩放再叠一次，窗口越大偏得越离谱。
    // 所以第一次读到就把原始尺寸记下来，之后一直用它。
    if (baseW <= 0 || baseH <= 0) {
      // 必须用「内容包围盒」，不能用 originalWidth/Height。
      // original* 是画布，比实际画的内容大一圈（这个模型 7697 vs 6793）。
      // model.anchor 对的是内容中心，取景矩形也是按内容算的，
      // 两边混用就会偏一大截（框框住头，主窗口显示到胸口）。
      model.scale.set(1);
      baseW = Math.max(1, model.width);
      baseH = Math.max(1, model.height);
      if (baseW <= 1 || baseH <= 1) {
        baseW = Math.max(1, model.internalModel && model.internalModel.originalWidth || 0);
        baseH = Math.max(1, model.internalModel && model.internalModel.originalHeight || 0);
      }
      console.log("[fish] model original=" + baseW + "x" + baseH);
    }
    const sw = baseW;
    const sh = baseH;
    // 取景：只要「头到胸」这一段。
    // 这个模型的包围盒是**全身**（主人原话「盒子还是很长」），而且上缘还有 20.5%。
    // 透明边距：图是画在盒子靠下的位置的。所以两个数都得用：
    //   TOP_MARGIN  盒子顶上那块空白（实测 0.205）
    //   CONTENT     真正想看的内容占「有画的部分」的比例
    // 只用盒子比例会先空一大块、然后把身子也带进来（两版都踩过）。
    // 取景：把 viewBox 那个矩形（模型上的 y/h）装进窗口。
    // 这个模型的包围盒是全身，所以「看哪一段」只能由矩形说了算，
    // 不能拿盒子比例硬切。之前试过三版，不是空一大块就是把身子全带进来。
    model.scale.set(1);
    //  用 baseH（内容包围盒，加载时量一次就锁死），别在读的时候现量 model.height。
    const rawH = sh > 1 ? sh : Math.max(1, model.height);
    const rawW = sw > 1 ? sw : Math.max(1, model.width);
    const bh = Math.max(1, rawH * viewBox.h);         // 要装进窗口的那一段有多高
  const fit = H / bh;                                // 让这一段正好占满窗口高

    model.scale.set(fit);
    model.anchor.set(0.5);
    // 这一段的中点对齐窗口中心
    const cy = rawH * (viewBox.y + viewBox.h / 2);
    model.position.set(W / 2, H / 2 - (cy - rawH / 2) * fit);
    lastFit = fit;

    if (debugLayout) {
      console.log("[fish] layout host=" + cw + "x" + ch +
        " css=" + app.canvas.style.width + "/" + app.canvas.style.height +
        " canvas=" + app.canvas.width + "x" + app.canvas.height +
        " renderer=" + app.renderer.width + "x" + app.renderer.height +
        " res=" + app.renderer.resolution +
        " fit=" + fit.toFixed(4));
    }
  };
  // 取景日志：只在尺寸变化时打一行，量很小，留着方便以后查这类问题。
  let debugLayout = true;
  window.__fishDebugLayout = (on) => { debugLayout = on === true; };

  // 主进程改完窗口尺寸会让主窗口重排。但 setSize 之后 Windows 不一定
  // 已经完成尺寸变更，这一刻读 clientHeight 可能还是旧值——用它算取景，
  // 模型就会被摆偏，露出本该裁掉的部位。所以真正的依据是 ResizeObserver：
  // 容器尺寸**真的变了**才重算，而且拿到的一定是新值。
  if (window.ResizeObserver) {
    const host = (app && app.canvas && app.canvas.parentElement) || document.body;
    resizeObs = new ResizeObserver(() => relayoutSoon());
    resizeObs.observe(host);
  }

  window.deskfish.onRelayout(() => {
    relayoutSoon();
  });

  // ---------- 每帧写参数 ----------
  // key 系列（表情开关）不在 PIDX 那张写死的表里，第一次用要现查索引，
  // 查到就缓存：每帧都调 getParameterIndex 是白费时间。
  const keyIdx = {};
  // 播手写动作（motion3）时，被动作占用的参数要让位，否则 applyParams 每帧写死会把它盖掉。
  // null = 正常状态；Set = 这些参数由动作说了算，applyParams 不碰。
  let __motionOwn = null;
  let __motionOwnTimer = 0;
  let __playingMotion = false;
  // ---------- 手写动作播放 ----------
  // 引擎的 motionManager 在这套接入里播不出自定义动作（startMotion 恒返回 false，
  // currentMotion 一直是 null，试过 FORCE 优先级 / stopAllMotions / 等 motionFinish 死锁，
  // 都没用）。所以不跟它耗，自己按时间推曲线：数据结构和 motion3 一样，只是由我算。
  // 好处是每帧的值都在手里，坏处是 FadeIn/物理联动这些自己补。
  // __act 已在文件上方（CTX_MENU 附近）声明：那边要先于 BroadcastChannel 的闭包可见。
  const actionLast = {};
  // 每个场景最近三段（末尾最新）：策略层用它避开来回横跳
  const actionRecent = {};
  // 动作播放的补间 = 同一条 Catmull-Rom（理由见 lib/curve.js 顶部注释）。
  // 以前这里有一份自己的实现，和点击回弹那份只差零跨度兜底；现在共用一份。
  const lerpAt = curve;
  // 动作曲线与「每帧常规写入」的合成方式。曲线是一条整脸的绝对表演（原始数据来自
  // LumenAct 的 blendshape 轨道），但角色的呼吸、眨眼、说话嘴型、待机摆动是另一套
  // 每帧都在写的值。一律覆盖会让角色在表演时停止眨眼、闭上嘴说话、身体僵住。
  //   "+"   角度/视线：在 base 上叠增量，淡出自然回 base
  //   "min" 眼睑：谁更闭听谁的，眨眼照常生效
  //   "max" 嘴张开：说话优先
  //   其余（表情骨架：EyeSmile、MouthForm、眉、Shock、CheeckPuff…）整份接管
  const ACT_MERGE = {
    ParamAngleX: "+", ParamAngleY: "+", ParamAngleZ: "+",
    ParamBodyAngleX: "+", ParamBodyAngleY: "+", ParamBodyAngleZ: "+",
    ParamEyeBallX: "+", ParamEyeBallY: "+", PupilX: "+", PupilY: "+",
    ParamEyeLOpen: "min", ParamEyeROpen: "min",
    ParamMouthOpenY: "max", JawOpen: "max",
  };

  // 两轨的参数域分工。不在这里的（ParamAngle*、ParamEyeBall*、手部 Param36…）
  // 算共享参数，两条轨都能写，靠 ACT_MERGE 叠增量而不是互相覆盖。
  //   EXPR_DOMAIN 只给表情轨：脸（眼睑/眉/嘴型/泪/鼓脸）
  //   BODY_DOMAIN 只给动作轨：身体与手，表情段一律不碰
  // 这样摸头时手照动、害羞表情照挂，两边不再互相顶掉。
  const EXPR_DOMAIN = {
    ParamEyeLOpen: 1, ParamEyeROpen: 1, EyeSmile: 1,
    ParamBrowLY: 1, ParamBrowRY: 1, ParamBrowLAngle: 1, ParamBrowRAngle: 1,
    ParamBrowLY2: 1, ParamBrowRY2: 1, ParamBrowLY3: 1, ParamBrowRY3: 1, BrowInnerUp: 1,
    ParamMouthForm: 1, ParamMouthOpenY: 1, JawOpen: 1, ParamMouthFormY: 1,
    Mouthpucker: 1, MouthpuckerWiden: 1, MouthFunnel: 1, Press: 1,
    MouthSmile_L: 1, MouthSmile_R: 1, CheeckPuff: 1, CheeckPuff2: 1,
    ShockL: 1, ShockR: 1, LCry: 1, RCry: 1, Angry: 1, Angry2: 1, Angry3: 1,
    LEyeSquint: 1, REyeSquint: 1, ParamSilence: 1,
  };
  const BODY_DOMAIN = {
    ParamBodyAngleX: 1, ParamBodyAngleY: 1, ParamBodyAngleZ: 1,
    Movement1: 1, Movement2: 1, Movement3: 1,
    Param36: 1, Param39: 1, Param41: 1, Param42: 1, Param43: 1,
    Param59: 1, Param60: 1, Param61: 1, Param62: 1,
  };
  // 这条轨能不能写这个参数：表情轨不许碰身体，动作轨不许碰脸（除非它真的是
  // 一个老的动作包里带了表情 —— 那种参数两条轨都放行，谁后写谁赢）。
  const trackAllows = (track, id) => {
    if (track === "expr") return !BODY_DOMAIN[id];
    if (track === "body") return !EXPR_DOMAIN[id];
    return true;
  };
  const applyParams = () => {
    if (disposed || !model || pending === null) return;
    const st = pending;
    const cm = model.internalModel.coreModel;
    const put = (name, v) => {
      let i = findIdx(name);
      if (i >= 0) cm.setParameterValueByIndex(i, v, 1);
    };
    // 三个道具/手臂开关常驻压着，
    // 但如果正在播一个手写动作（motion3），这些参数要让位给它，否则动作等于没播。
    // 让位范围由 __motionOwn 决定：播动作前把该动作用到的参数名塞进去，播完清空。
    const own = __motionOwn;
    const put2 = (name, v) => { if (!own || !own.has(name)) put(name, v); };
    put2("Movement1", 0);
    put2("Movement2", 0);
    put2("Movement3", 0);

    // 情绪偏移每帧朝目标靠一点（0.1~0.15 秒），换表情不硬切。
    // 必须在写参数之前算好，下面几个参数都要叠加它。
    for (const k of EXPR_KEYS) {
      const want = exWant[k] || 0;
      const now2 = exNow[k] || 0;
      const next = now2 + (want - now2) * 0.1;
      exNow[k] = Math.abs(want - next) < 0.0015 ? want : next;
    }
    const ex = exNow;

    // 幅度全部走 tuning：换一只比例不同的模型，头/身体/眼珠的劲儿要能各自调。
    // 默认值按 0.2.0 的写死倍率反算，升级后手感不变。
    const kX = TUNE.angleMaxX / 4.2;
    const kY = TUNE.angleMaxY / 5.0;
    const kZ = TUNE.angleMaxZ / 4.0;
    put2("ParamAngleX", st.yaw * kX + (ex.yaw || 0) * 6.5);
    put2("ParamAngleY", st.pitch * kY);
    put2("ParamAngleZ", st.roll * kZ + (ex.roll || 0));
    put2("ParamEyeBallX", clampNum(st.gazeX * TUNE.eyeGain + (ex.gazeX || 0), -TUNE.eyeMax, TUNE.eyeMax));
    put2("ParamEyeBallY", clampNum(st.gazeY * TUNE.eyeGain + (ex.gazeY || 0), -TUNE.eyeMax, TUNE.eyeMax));
    // 全身：0.2.0 只写 BodyAngleX，等于只有胯在晃。Y 是前后倾、Z 是侧倾，
    // 三个一起给才有「重心在动」的感觉。模型没这几个参数时 findIdx 返回 -1，自动跳过。
    put2("ParamBodyAngleX", st.body * 5.0 * TUNE.bodyGainX);
    put2("ParamBodyAngleY", -st.pitch * 0.9 * TUNE.bodyGainY);
    put2("ParamBodyAngleZ", st.roll * 1.1 * TUNE.bodyGainZ);
    // 说话时嘴要跟着真实声音动：mouthLevel 从 voice.js 的 WebAudio 分析播放中的音频得到。
    // 没有它的话她只是「念 6 0」，嘴永远是同一个开合度，一眼假。
    const speakMouth = (window.FishVoice && window.FishVoice.mouth) ? window.FishVoice.mouth() : 0;
    const mouthY = Math.max(st.mouth, speakMouth);
    put2("ParamMouthOpenY", mouthY);
    put2("ParamMouthForm", (mouthY > 0.02 ? 0.35 : 0) + (ex.mouth || 0));
    const breathAmp = (PACK && PACK.interaction && Number(PACK.interaction.breathAmp)) || 1;
    put2("ParamBreath", 0.5 + 0.5 * breathAmp * Math.sin(st.elapsed * 1.6));
    // eye 是负数表示「更闭」（笑成弯月、累成半睁），所以这里减。
    const closed = Math.max(st.blink, st.blinkVal, st.squint || 0) + Math.max(0, -(ex.eye || 0));
    put2("ParamEyeLOpen", Math.min(1, Math.max(0, 1 - closed)));
    put2("ParamEyeROpen", Math.min(1, Math.max(0, 1 - closed)));

    // 手写动作叠在最上面，放在最后写，才能盖住上面那些常规参数。
    // 动作轨和表情轨结构完全一样，差别只有参数域（trackAllows），所以同一段
    // 逻辑跑两遍：先身体、再表情，共享的角度与视线靠 ACT_MERGE 叠增量。
    const runTrack = (cur, prev, prevT0, onEnd, onDropPrev) => {
      const track = cur.track || "body";
      const t = (performance.now() - cur.t0) / 1000;
      if (t >= cur.dur) {
        onEnd();        // 曲线自己会回到基础值，淡出权重也收到 0 了，这里直接收
        onDropPrev();
        return;
      }
      // 进和出都要淡。硬切会让「起身」和「坐下」都像被抽掉。
      // 淡入淡出按时长比例给：写死 0.42+0.52=0.94 秒时，surprise 全长 1.05 秒
      // 只剩 0.11 秒满强度，动作永远软绵绵像没做。上限保住长动作的淡出时间。
      const FI = Math.min(0.42 * TUNE.fadeScale, cur.dur * 0.24);
      const FO = Math.min(0.52 * TUNE.fadeScale, cur.dur * 0.28);
      let w = 1;
      if (t < FI) w = t / FI;
      else if (t > cur.dur - FO) w = (cur.dur - t) / FO;
      w = w < 0 ? 0 : (w > 1 ? 1 : w);
      const k = w * w * (3 - 2 * w);   // 两端都缓，线性看着像机械臂

      // 交叉淡化：换动作的前 cross 秒，把上一个动作的值混进来。
      // cross 由 launchMotion 按前后动作时长算好（0.18–0.62 秒），短动作不再被吞，
      // 长动作也不会被 0.24 秒硬切走。
      // 权重按「新动作逐渐接管」算：old*(1-w) + new*w，w = cross*k，
      // 两边权重和恒为 1；旧写法 new 额外乘 k 会在交接中段产生一个掉回基础值的塌陷。
      let cross = 1;
      const prevWants = new Map();
      if (prev) {
        const CD = Math.max(0.14, cur.cross || 0.24);
        const pt = ((performance.now() - prevT0) / 1000) * (prev.speed || 1);
        if (pt > CD) {
          onDropPrev();
        } else {
          cross = pt / CD;
          cross = cross * cross * (3 - 2 * cross);
          const ptc = Math.min(pt, prev.dur);
          for (const [id, pts] of prev.curves) {
            if (!trackAllows(track, id)) continue;
            prevWants.set(id, lerpAt(ptc, pts));
          }
        }
      }

      const touch = (id) => {
        if (!trackAllows(track, id)) return;
        const i = findIdx(id);
        if (i < 0) return;
        const base = cm.getParameterValueByIndex(i);
        const pw = prevWants.has(id) ? prevWants.get(id) : base;
        let nw = base;
        for (const [nid, pts] of cur.curves) { if (nid === id) { nw = lerpAt(t, pts); break; } }
        const nwW = cross * k;
        let v;
        const mode = ACT_MERGE[id];
        if (mode === "+") {
          // 角度/视线是「在自然姿头上再加一层」：base 是呼吸、待机摆动、说话点头算出来的值，
          // 覆盖掉会让角色表演时身体僵住不动，所以只叠增量，淡出时自然回到 base。
          v = base + nw * nwW;
        } else if (mode === "min") {
          // 眼睑取更闭的那个：base 已经含眨眼（1 - blink），表情要闭得更狠时听表情的，
          // 否则眨眼照常生效，不会出现「表演期间不眨眼」。
          v = base + (Math.min(base, nw) - base) * nwW;
        } else if (mode === "max") {
          // 嘴张开取更大的：说话时 FishVoice 给的张嘴量要压过表情的嘴型，不然说话闭着嘴。
          v = base + (Math.max(base, nw) - base) * nwW;
        } else {
          v = base + (pw - base) * (1 - nwW) + (nw - base) * nwW;
        }
        cm.setParameterValueByIndex(i, v, 1);
      };

      for (const [id] of cur.curves) touch(id);
      for (const id of prevWants.keys()) {
        let inNew = false;
        for (const [nid] of cur.curves) { if (nid === id) { inNew = true; break; } }
        if (!inNew) touch(id);
      }
    };

    if (__act) {
      runTrack(__act, __actPrev, __actPrevT0,
        () => { __act = null; },
        () => { __actPrev = null; });
    }
    // 表情轨后写：共享的角度与视线在身体姿态之上再叠一层，
    // 所以动作在演的时候表情的歪头、视线也还在。
    if (__exprTrack) {
      runTrack(__exprTrack, __exprPrev, __exprPrevT0,
        () => {
          __exprTrack = null;
          // 编排模式下这一段演完就接下一段；队列空了才真的收。
          if (__exprQueue.length) exprSeqNext();
        },
        () => { __exprPrev = null; });
    }

    // 表情叠加放在最后：动作曲线写完再盖，exp3 的「加一点嘴角」才落在姿态之上，
    // 而不是被曲线冲掉。先叠默认表情（有些模型的中性脸本身就是一个 exp），再叠当前情绪。
    if (EXPR_BASE) applyExprSet(cm, EXPR_BASE);
    if (exExtra) applyExprSet(cm, exExtra);
    // 表情贴片放在最后写：它要盖过上面所有东西（key 是整张贴图切换，
    // 谁后写谁生效），所以必须是这一帧最后一个动手的。
    applyExprPatch(cm);
  };

  // ---------- 每帧 ----------
  const tick = () => {
    if (disposed || !model) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - (tick._last || now)) / 1000);
    tick._last = now;
    const elapsed = now / 1000;

    const away = Date.now() - lastMoveAt > 90000;
    const thinking = phase === "thinking";
    const working = phase === "tool" || phase === "review";

    // 帧率自适应：没人理她的时候降到 30fps。
    // pixi 的 maxFPS 是有效的（实测 83 → 33）；手动跳帧只让我的代码少跑，
    // pixi 自己那层渲染还在原地空转，所以这里用 maxFPS，不用跳帧。
    //
    // 关于 thinking：早先这里还写了 !thinking，意思是「DSH 在忙就别降载」。
    // 但 thinking 的判据是「最近 20 秒有 session 写入」，而这个程序自己就挂在
    // 一个一直在干活的会话上，结果 thinking 永远是 true，降载永远不触发。
    // 实测空转 134% 单核。thinking 只该影响表情和姿态，不该决定渲染精度。
    // 她在「想事情」的时候又不需要 60fps 的高清画质。
    const idleFor = Date.now() - lastMoveAt;
    const calm = !dragging && !working && idleFor > 8000;
    tick._n = (tick._n || 0) + 1;
    tick._calm = calm;
    // 真帧率：按「每秒实际进了多少次 tick」算。ticker.maxFPS 会跳帧，
    // 跳掉的那些帧根本不调 tick，所以这个数才是用户看到的流畅度。
    const tw = tick.__tpsWin || (tick.__tpsWin = { t: now, n: 0 });
    tw.n += 1;
    if (now - tw.t >= 1000) {
      const real = Math.round((tw.n * 1000) / (now - tw.t));
      if (app && app.ticker) app.ticker.__tps = real;
      tw.t = now;
      tw.n = 0;
    }
    const wantFps = calm ? Math.min(15, fpsCap) : fpsCap;
    if (app.ticker.maxFPS !== wantFps) app.ticker.maxFPS = wantFps;
    tick._ran = (tick._ran || 0) + 1;
    const _t0 = performance.now();

    // 空闲只降帧率，不动分辨率：2x → 1x 省下来的电，不值得让她的脸变糊。
    // （原来这里 idle 超过 8 秒就把 resolution 打到 1，桌面挂件大多时间都在
    //  「没人碰」的状态，等于常态糊成一团。）
    if (tick._resPending === undefined) tick._resPending = 0;
    const wantRes = baseResolution;
    if (app.renderer.resolution !== wantRes && Date.now() > tick._resPending) {
      try {
        app.renderer.resolution = wantRes;
        const host2 = app.canvas.parentElement || document.body;
        app.renderer.resize(Math.max(1, host2.clientWidth), Math.max(1, host2.clientHeight));
        app.canvas.style.width = "100%";
        app.canvas.style.height = "100%";
  tick._resPending = Date.now() + 700;   // 切换后 0.7 秒内不再折腾，避免抖动
      } catch (e) { tick._resPending = Date.now() + 2000; }
    }

    maybeChangeExpr();

    // 多频漂移
    const w1 = Math.sin(elapsed * 0.75);
    const w2 = Math.sin(elapsed * 1.73 + 1.1);
    const w3 = Math.sin(elapsed * 0.31 + 2.4);
    const drift = w1 * 0.55 + w2 * 0.27 + w3 * 0.18;
    const drift2 = Math.sin(elapsed * 0.53 + 0.7) * 0.62 + Math.sin(elapsed * 1.21 + 2.9) * 0.38;

    // 鼠标目标
    const dz = TUNE.deadzone;
    const gx = Math.abs(tx) < dz ? 0 : (tx - Math.sign(tx) * dz) / (1 - dz);
    const gy = Math.abs(ty) < dz ? 0 : (ty - Math.sign(ty) * dz) / (1 - dz);
    const headShare = 0.34;

    // 眼球微跳
    if (now - lastSaccade > nextSaccade) {
      lastSaccade = now;
      nextSaccade = 800 + Math.random() * 1900;
      sacX = (Math.random() - 0.5) * 0.055;
      sacY = (Math.random() - 0.5) * 0.038;
    }

    // 设置里关掉「跟随鼠标」时，把鼠标输入归零，只留呼吸与自漂移。
    const gxUse = followCursor ? gx : 0;
    const gyUse = followCursor ? gy : 0;

    const target = {
      yaw: thinking ? 2.2 + drift2 * 1.2 : working ? 1.5 + drift * 2.4 : (away ? -6 : gxUse * 4.2) + drift * 2.0,
      pitch: thinking ? -4 + drift * 0.8 : working ? -8 + drift2 * 3.6 : (away ? 4 : -gyUse * 5.0) + drift2 * 2.2,
      roll: thinking ? -1.6 + drift2 * 1.1 : working ? -2.5 + drift * 1.7 : drift * 1.8,
      body: (away ? 0.4 : gxUse * 1.2) + drift * 0.9,
      gazeX: gxUse * (0.9 - Math.abs(gxUse) * headShare) + sacX,
      // 眼球和头用同一个 gyUse，方向必须一致地取反。
      // clientY 向下为正，而 ParamEyeBallY / ParamAngleY 都是「正 = 向上」。
      // 之前头部写了 -gyUse、眼球漏了负号，于是鼠标往上她眼球反而往下翻。
      gazeY: -gyUse * (0.9 - Math.abs(gyUse) * headShare) + sacY,
      blink: 0,
      squint: 0,
    };
    lastTarget = target;

    if (away) { target.gazeX = -0.55 + sacX; target.gazeY = 0.35 + sacY; }

    // 按住不放超过 1.2 秒、又没在拖：她该抗议了。只抗议一次，别一直念。
    if (dragging && pressAt && !pressComplained && dragMoved < 3 &&
        Date.now() - pressAt > 1200) {
      pressComplained = true;
      say(FishLines.pick("press.long"), null, 0, { zone: "pet", level: petCombo });
      setExpr("sad", 1200);
    }

    // 被拎起来的时候：身体往甩的反方向荡，头跟不上，重心往下沉。
    // 没有这段她就像一张贴纸，跟着窗口平移而已。
    // 松手之后余速还在（fling），让她多荡两下再停；不然手指一松就僵住，像断了线。
    if (dragging || fling > 0.4) {
      const vx = Math.max(-30, Math.min(30, dragVX));
      const vy = Math.max(-30, Math.min(30, dragVY));
      target.roll += -vx * 0.5;
      target.body += -vx * 0.34;
      target.yaw += vx * 0.22;
      target.pitch += vy * 0.28 + (dragging ? 2.2 : 0);
      // 甩得快的时候会有点晕。
      if (Math.abs(vx) > 14) target.squint = Math.min(0.55, Math.abs(vx) / 40);
  dragVX *= dragging ? 0.86 : 0.72;   // 松手后衰减快一点，两三帧就该停
      dragVY *= dragging ? 0.86 : 0.72;
      fling *= dragging ? 1 : 0.72;
    } else if (fling !== 0) {
      fling = 0;
      dragVX = 0;
      dragVY = 0;
    }

    // 点击反应
    const petAge = (Date.now() - petAt) / 1000;
    if (petAge < 1.3) {
      const env = Math.sin(Math.PI * Math.min(1, petAge / 1.3));
      const pk = 1 + (Math.min(4, petCombo || 1) - 1) * 0.32;
      const pd = petDir || 1;
      if (petZone === "head") {
        target.pitch += 2.2 * env * pk;
        target.roll += 2.6 * env * pk * pd;
        target.squint = 0.55 * env;
        // 摸头最开心：第一下脸红，连摸几下会笑出来
        if (petAge < 0.9 && petCombo <= 1) setExpr("shy", 1600);
        else if (petAge < 0.9 && petCombo >= 3) setExpr("happy", 1500);
      } else if (petZone === "body") {
        target.body += 3.2 * env * pk;
        target.pitch += 1.6 * env * pk;
        target.yaw += 2.0 * env * pk * pd;
        if (petAge < 0.9) setExpr("curious", 1400);
      } else {
        target.roll += 3.4 * env * pk * pd;
        target.yaw += 2.2 * env * pk * pd;
        target.pitch -= 1.2 * env * pk;
        if (petAge < 0.9) setExpr("sad", 1200);
      }
    }

    // 点头
    const tapAge = (Date.now() - tapAt) / 1000;
    const tap = tapAge <= 0.78 ? curve(tapAge, [[0, 0], [0.1, -1], [0.26, 0.16], [0.52, 0], [0.78, 0]]) : 0;
    target.pitch += tap * 9;

    // 小动作：这里只留「持续型」的那种（呼吸、极轻的重心浮动）——它是逐帧连续叠加的，
    // 用 sin 包络做出来比曲线表更细腻。
    //  离散的动作（tilt / glance / yawn / smile…）全部交给 motions.js + FishModel.actionFor。
    // 两边都留会生成同一个动作叠两次，看起来像抖。
    if (nextGestureAt === 0) nextGestureAt = Date.now() + 7000 + Math.random() * 9000;
    // 主窗刷新过之后不认识「正开着的活动」：面板不会重发 act.start。
    // 每 2 秒对一次 localStorage 里的状态，接上就继续演。
    if (autoIdle && (!__actPollAt || Date.now() >= __actPollAt)) {
      __actPollAt = Date.now() + 2000;
      // 面板开着时由面板负责说完成台词；这里只在面板没开时补一句，
      // 避免两个窗口同时冒同一句话。
      if (!__panelPollAt || Date.now() >= __panelPollAt) {
        __panelPollAt = Date.now() + 3000;
        try {
          if (window.deskfish && deskfish.petPanelOpen) {
            deskfish.petPanelOpen().then((v) => { petPanelOpen = !!v; }).catch(() => { });
          }
        } catch (e) { }
      }
      let info = null;
      try { info = window.FishPet && FishPet.actInfo && FishPet.actInfo(); } catch (e) { }
      if (info && !activity) {
        activity = { id: info.id, name: info.name, scene: info.scene, since: Date.now() };
        try { setExpr(ACT_EXPR[info.id] || "default-body", 0); } catch (e) { }
        try { FishModel.actionFor(info.scene); } catch (e) { }
      } else if (!info && activity) {
        // 活动做完了但面板没开着（没有广播可收）：自己收尾，并补一句完成台词。
        activity = null;
        try { setExpr("default-body", 0); FishModel.actionFor("actDone"); } catch (e) { }
        if (!petPanelOpen) {
          let line = "";
          try {
            const st = FishPet.takeSettle && FishPet.takeSettle();
            if (st && st.line) line = st.line;
          } catch (e) { }
          if (!line) {
            try {
              const snap = FishPet.snapshot ? FishPet.snapshot() : null;
              const rec = snap && Array.isArray(snap.log) ? snap.log[0] : null;
              if (rec && rec.at && Date.now() - rec.at < 15000) {
                const def = (FishPet.acts() || []).find((a) => a.id === rec.id);
                line = rec.stopped ? "好，那就先停一下。" : ((def && def.done) || "做完了。");
              }
            } catch (e) { }
          }
          if (line) { try { say(line, null, 2800); } catch (e) { } }
        }
      }
    }
    if (activity && !away && autoIdle) {
      // 正在做活动：从活动自己的场景里挑动作，间隔短一点（3.5-7 秒），
      // 这样吃饭有咀嚼、睡觉有翻身、散步有晃，而不是一个动作定在那儿几分钟。
      // 顺手把表情按住：不然 maybeChangeExpr 十几秒后会把「睡」换成别的。
      if (Date.now() >= nextGestureAt && !gesture) {
        try { FishModel.actionFor(activity.scene); } catch (e) { }
        try { setExpr(ACT_EXPR[activity.id] || "default-body", 0); } catch (e) { }
        nextGestureAt = Date.now() + 3500 + Math.random() * 3500;
      }
    } else if (!gesture && Date.now() >= nextGestureAt && !away && autoIdle) {
      gesture = { name: "breathe", at: Date.now(), dur: 2.8 };
      nextGestureAt = Date.now() + 11000 + Math.random() * 14000;
      // 呼吸的同时偶尔来一个真的小动作（走动作库，幅度更明确）
      const hour = new Date().getHours();
      const sleepy = hour >= 23 || hour <= 5 || Date.now() - lastMoveAt > 240000;
      if (sleepy && Math.random() < 0.4) {
        try { FishModel.actionFor("sleep"); } catch (e) { }
      } else if (Math.random() < 0.5) {
        try { FishModel.actionFor("idle"); } catch (e) { }
      }
    }
    if (gesture) {
      const gt = (Date.now() - gesture.at) / 1000 / gesture.dur;
      if (gt >= 1) { gesture = null; }
      else {
        const env = Math.sin(Math.PI * gt);
        // 只剩「呼吸」这一种了，别的都搬到 motions.js（见上面那段注释）
        target.body += 1.1 * env;
        target.pitch -= 0.8 * env;
      }
    }

    // 缓动
    // 不同通道给不同时间常数，这是「像活的」和「像机器人」的分界线。
    //   眼睛最快（0.09s）：真人看到东西是一瞬间扫过去的，眼睛先到。
    //   头颈次之（0.22s）：头是「跟着过去」的，永远慢眼睛半拍。
    //   身体最慢（0.55s）：重心转移，几乎察觉不到。
    // 眨眼单独 0.035s，因为眼睑动作本来就快到看不清过程。
    for (const k of Object.keys(target)) {
      let tau;
      if (k === "blink") tau = 0.035;
      else if (k === "gazeX" || k === "gazeY") tau = 0.09;
      else if (k === "body") tau = 0.2 + TUNE.bodyLag;
      else if (k === "yaw" || k === "pitch" || k === "roll") tau = tapAge <= 0.78 ? 0.07 : 0.22;
      else tau = 0.22;
      const a = 1 - Math.exp(-dt / tau);
      mv[k] += (target[k] - mv[k]) * a;
    }

    // 眨眼（设置里关掉就保持睁眼，不给随机触发）
    if (blinkEnabled) {
      if (now > nextBlink && blinkStart < 0) {
        blinkStart = now;
        nextBlink = now + 2100 + Math.random() * 3600;
      }
    } else {
      blinkStart = -1;
      blinkVal = 0;
    }
    if (blinkStart >= 0) {
      const bt = (now - blinkStart) / 1000;
      const dur = 0.13;
      if (bt >= dur) { blinkStart = -1; blinkVal = 0; }
      else blinkVal = Math.sin((bt / dur) * Math.PI);
    }

    // 口型：以前跟着 thinking 相位走，但独立程序里「DSH 在写文件」几乎
    // 每时每刻都为真，结果她嘴巴一直在开合，像在自言自语。
    // 改成只在「刚被摸过」或「打哈欠」的短窗口里动，其余时间闭嘴。
    const talk = petAge < 0.9; // 没摸过时 petAt=0，petAge 是个极大的数，自然为 false
    if (talk) mouth += 0.55; else mouth = 0;
    const talkOpen = talk ? 0.42 * (0.5 + 0.5 * Math.sin(mouth)) * Math.max(0, 1 - petAge / 0.9) : 0;
    // 说话时的嘴型：只有刚被摸过的 0.9 秒会开合一下。
    // 打哈欠的嘴张合现在由 motions.js 的 yawn 曲线直接写 ParamMouthOpenY，
    // 不再需要这里叠加一个 env（那个变量已经删了）。
    const open = Math.min(1, talkOpen);

    pending = {
      yaw: mv.yaw, pitch: mv.pitch, roll: mv.roll, body: mv.body,
      gazeX: mv.gazeX, gazeY: mv.gazeY,
      blink: mv.blink, blinkVal, squint: mv.squint || 0,
      mouth: open, elapsed,
    };

    maybeIdleTalk();
  };

  // ---------- 鼠标（来自主进程的全局坐标） ----------
  let lastCx = -99999, lastCy = -99999;
  window.deskfish.onCursor((p) => {
    const cx = p.wx + p.w / 2;
    const cy = p.wy + p.h / 2;
    const range = Math.max(300, Math.min(p.w, p.h) * 0.45);
    tx = Math.max(-1, Math.min(1, (p.x - cx) / range));
    ty = Math.max(-1, Math.min(1, (p.y - cy) / range));
    // 主进程是 30fps 持续推坐标的，鼠标不动也一直在推。
    // 只有坐标真的变了才算「主人动了一下」，否则 idle 永远算不出来。
    if (p.x !== lastCx || p.y !== lastCy) {
      lastCx = p.x; lastCy = p.y;
      lastMoveAt = Date.now();
    }
  });

  // ---------- 点击 / 拖动 ----------
  // 同一个左键手势：位移超过 4px 算拖窗口，否则松手时算「摸她」。
  // 位移全程交给主进程算（渲染进程的 screenX 跨屏会跳变）。
  let dragging = false, dragMoved = 0;
  // 拖动惯性：被拎着走的时候身体该有点滞后感，不然像个贴纸。
  let dragVX = 0, dragVY = 0, dragHeldAt = 0;

  // ---------- 右键菜单 ----------
  // 走主进程的原生菜单：设置 / 模型适配器 / 对话记录 / 相处档案 / 看屏幕 /
  // 看看她 / 喂她一口 / 摸摸头 / 重置位置 / 检查更新 / 退出。模板在
  // src/window-menu.js，scripts/test-menu.js 会逐项断言标签与动作。
  window.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    if (window.deskfish && window.deskfish.windowMenu) window.deskfish.windowMenu();
    else window.deskfish.openSettings();
  });

  // UI 控件（语音按钮、气泡、重试按钮）上的按下不启动拖动，
  // 否则手一抖窗口就被拖走，按钮跟着跑，click 落空。
  const isUiTarget = (el) => {
    let n = el;
    while (n && n !== document.body) {
      if (n.id === "fish-voice" || n.id === "bubble" || n.id === "fish-retry" || n.id === "err") return true;
      // 底部对话面板：整块都不算「拖窗口」的区域，否则点输入框会变成拖窗口。
      if (n.id === "dock") return true;
      n = n.parentElement;
    }
    return false;
  };

  window.addEventListener("pointerdown", (ev) => {
    if (ev.button === 2) {
      ev.preventDefault();
      if (window.deskfish && window.deskfish.windowMenu) window.deskfish.windowMenu();
      else window.deskfish.openSettings();
      return;
    }
    if (ev.button !== 0) return;
    if (isUiTarget(ev.target)) return;      // 交给控件自己处理
    dragging = true;
    dragMoved = 0;
    pressAt = Date.now();
    pressComplained = false;
    window.deskfish.dragStart();
  });

  window.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    dragMoved += Math.abs(ev.movementX) + Math.abs(ev.movementY);
    // 记一下这一下甩得多快，tick 里拿它做惯性（被拎起来应该会荡）。
    dragVX = dragVX * 0.6 + (ev.movementX || 0) * 0.4;
    dragVY = dragVY * 0.6 + (ev.movementY || 0) * 0.4;
    dragHeldAt = performance.now();
    if (dragMoved > 3) window.deskfish.dragMove();
  });

  window.addEventListener("pointerup", (ev) => {
    if (isUiTarget(ev.target)) { dragging = false; dragMoved = 0; return; }
    const wasDragging = dragMoved > 3;
    const heldFor = pressAt ? Date.now() - pressAt : 0;
    dragging = false;
    dragMoved = 0;
    pressAt = 0;
    // 甩出去：把最后一刻的速度记下来，tick 里让它自己衰减。
    fling = Math.max(Math.abs(dragVX), Math.abs(dragVY));
    window.deskfish.dragEnd();
    console.log("[fish] up drag=" + wasDragging + " moved=" + dragMoved +
      " model=" + (model ? 1 : 0) + " at=" + Math.round(ev.clientX) + "," + Math.round(ev.clientY));
    if (wasDragging) return;   // 拖过就不算摸
    if (!model) return;

    const rect = app.canvas.getBoundingClientRect();
    console.log("[fish] rect=" + Math.round(rect.left) + "," + Math.round(rect.top) +
      " " + Math.round(rect.width) + "x" + Math.round(rect.height));
    if (ev.clientX < rect.left || ev.clientX > rect.right) return;
    if (ev.clientY < rect.top || ev.clientY > rect.bottom) return;

    // 落点按「模型在画布上的真实范围」算，不是按画布比例。
    // 踩过：用 fy < 0.34 / 0.66 切画布，可模型顶部只到画布的 23.8%（上面一段说明），
    // 于是点脸的位置（y≈0.00）越过了 0.66×560=370，被判成「点身体」。
    // 主人反馈「点头反而像点胸」就是这个。窗口一缩放比例还会变，所以必须动态算。
    const mTop = model.y - model.height * (model.anchor ? model.anchor.y : 0.5);
    const mBot = mTop + model.height;
    // 可见部分：模型可能上下都超出画布
    const visTop = Math.max(rect.top, rect.top + mTop);
    const visBot = Math.min(rect.bottom, rect.top + mBot);
  const rel = (ev.clientY - visTop) / Math.max(1, visBot - visTop);   // 0=模型可见顶部
    // 分区线跟着模型走：半身模型和全身模型能摸到的地方完全不一样，
    // 适配器里可以按模型高度调这两条线（默认 0.42 / 0.72 是照半身模型量的）。
    const ITX = (PACK && PACK.interaction) || { headLine: 0.42, faceLine: 0.72 };
    const hLine = Math.min(0.95, Math.max(0.05, Number(ITX.headLine) || 0.42));
    const fLine = Math.min(0.99, Math.max(hLine + 0.02, Number(ITX.faceLine) || 0.72));
    petZone = rel < hLine ? "head" : rel < fLine ? "face" : "body";

    // 双击「被戳到了」跟单击「戳一下」不是一回事：反应更大，表情更夸张，不进连击计数。
    if (ev.detail >= 2) {
      const now2 = Date.now();
      tapAt = now2;
      petAt = now2;
      petDir = Math.random() < 0.5 ? 1 : -1;
      tx = Math.max(-1, Math.min(1, (ev.clientX - (rect.left + rect.width / 2)) / Math.max(120, rect.width * 0.55)));
      ty = Math.max(-1, Math.min(1, (ev.clientY - (rect.top + rect.height / 2)) / Math.max(120, rect.height * 0.55)));
      lastMoveAt = now2;
      setExpr("happy", 1800);
      say(FishLines.pick("pet.double"), null, 0, { zone: "pet", level: petCombo });
      // 双击「被戳到了」，给一个幅度最大的反应
      try { FishModel.action("surprise"); } catch (e) { }
      return;
    }

    const now = Date.now();
    petCombo = now - petComboAt < 2500 ? Math.min(4, petCombo + 1) : 1;
    petComboAt = now;
    tapAt = now;
    petAt = now;
    petDir = Math.random() < 0.5 ? 1 : -1;
    petCount += 1;

    // 摸哪儿看哪儿
    tx = Math.max(-1, Math.min(1, (ev.clientX - (rect.left + rect.width / 2)) / Math.max(120, rect.width * 0.55)));
    ty = Math.max(-1, Math.min(1, (ev.clientY - (rect.top + rect.height / 2)) / Math.max(120, rect.height * 0.55)));
    lastMoveAt = now;

    // 手写动作跟着点击走，放在 say() 前面：say() 万一因为气泡元素出问题抛异常，
    // 动作不该跟着一起断。combo 越高动作越夸张。
    try {
      FishModel.actionFor(petCombo >= 3 ? "more" : ("pet" + petZone.charAt(0).toUpperCase() + petZone.slice(1)));
    } catch (e) { console.warn("[fish] action 失败: " + e.message); }

    // 台词从 lines.js 的语句池里取，不在这里写死
    const key = petCombo >= 3 ? "pet.more" : "pet." + petZone;
    say(FishLines.pick(key), null, 0, { zone: "pet", level: petCombo });
    // 点击不插语气词了（2026-11-06 主人：「太奇怪了」）——
    //  FishVoice.chirp 那套还留着，想恢复只要在这加一行 window.FishVoice.chirp(...)
  });

  // ---------- DSH 读状态 ----------
  // 主进程扫 session 文件的写入时间，判断 DSH 到底在不在干活。
  let wasBusy = false;

  // 测试通道：主进程发一句「假装听到的话」，走完整语音后半段
  if (window.deskfish.onTestVoice) {
    window.deskfish.onTestVoice((text) => {
      if (window.FishVoice && window.FishVoice.__testSay) window.FishVoice.__testSay(text);
    });
  }
  // Ctrl+Alt+S：手动播一次伸懒腰。调动作时用，平时它自己随机出现。
  if (window.deskfish.onStretch) {
    window.deskfish.onStretch(() => {
      try {
        if (window.FishModel && window.FishModel.playMotion) {
          window.FishModel.playMotion("stretch", STRETCH_CURVES);
        }
      } catch (e) { }
    });
  }
  // 全局快捷键一键开麦：走和圆形语音按钮完全相同的 toggle()，
  // 这样「播放中打断 / 录音中取消 / 连点关闭」这些既有规则全都自动继承。
  if (window.deskfish.onMicToggle) {
    window.deskfish.onMicToggle(() => {
      try {
        // 按说话就是「马上要用语音」的信号：此时预热比开机预热更划算（不用语音的人不必付内存）。
        if (window.FishVoice && window.FishVoice.warm) window.FishVoice.warm();
        if (window.FishVoice && window.FishVoice.toggle) window.FishVoice.toggle();
      } catch (e) { }
    });
  }
  // 底部两个入口（对话记录 / 看屏幕）在 petpanel.js 里接线，这里不重复绑。
  // 托盘 / 右键菜单的快捷互动：不用打开面板，直接喂一口或摸摸头。
  // 真正的数据在 pet.js 里，这里只负责执行 + 给一句反应。
  if (window.deskfish.onPetQuick) {
    window.deskfish.onPetQuick((p) => {
      const P = window.FishPet;
      if (!P || !p) return;
      try {
        const ach = (list) => (Array.isArray(list) && list.length
          ? "（解锁「" + list.map((a) => a.name).join("」「") + "」）"
          : "");
        const lv = (up) => (up && up.name ? "（关系升到「" + up.name + "」）" : "");
        if (p.kind === "feed") {
          const r = P.feed(p.idx);
          if (r && r.ok) say("是" + (r.food || "这个") + "，谢谢主人" + ach(r.unlocked) + lv(r.levelUp), "happy", 5200);
          else say((r && r.why) || "现在吃不了", "pout", 4200);
        } else if (p.kind === "pet") {
          const r = P.pet();
          if (r && r.ok) say((r.sleeping ? "唔……睡着呢，也蹭一下" : "嘿嘿……再摸一下") + ach(r.unlocked) + lv(r.levelUp), "shy", 4600);
          else say((r && r.why) || "等一下嘛", "pout", 3600);
        }
      } catch (e) { }
    });
  }
  // 她看屏幕时的点评：气泡先到；语音只在完全空闲时补一句，绝不打断正常对话。
  if (window.deskfish.onSeeSay) {
    window.deskfish.onSeeSay((p) => {
      const text = typeof p === "string" ? p : p && p.text;
      if (!text) return;
      try { say(text, "happy", 6500); } catch (e) { }
      try {
        const d = window.FishVoice && window.FishVoice.debug ? window.FishVoice.debug() : null;
        if (d && !d.busy && !d.speaking && window.FishVoice.speak) window.FishVoice.speak(text);
      } catch (e) { }
    });
  }
  // 飞鱼冷启动要 20 多秒加载模型。这期间先说一句，别让她看起来像死了。
  if (window.deskfish.onTtsWaiting) {
    window.deskfish.onTtsWaiting((text) => {
      try { say(text || "等一下……我在准备声音。", null, 26000); } catch (e) { }
    });
  }
  window.deskfish.onDshActivity((p) => {
    const busy = !!(p && p.state === "busy");
    dshPhase = busy ? "thinking" : "idle";
    busyByWatcher = busy;
    syncBusy();

    // 只在状态「跳变」时说一句，别每 2 秒都念一遍。
    if (busy && !wasBusy) {
      if (Math.random() < 0.5) say(FishLines.pick("dsh.thinking"));
      // 开始干活了：想事情的表情配想事情的动作
      try { FishModel.action("think"); } catch (e) { }
    } else if (!busy && wasBusy) {
      say(FishLines.pick("dsh.done"));
      // 干完了：点头，像在说「弄好了」
      try { FishModel.action("nod"); } catch (e) { }
    }
    wasBusy = busy;
  });

  // 一个人待着的时候偶尔自言自语，但别太吵。
  // 用函数声明，不用 const：tick 在上面就调它了，靠 hoisting 才安全。
  let nextIdleTalk = Date.now() + 45000 + Math.random() * 60000;
  // 闲置词的两个开关：冒不冒气泡、出不出声。
  // 分开是刚需——开会时只想看字不想出声，深夜只想听声音不想有东西挡屏幕。
  // 由设置页写进设置，这里在 onSettingsChanged 里跟着更新。
  const idleCfg = { speak: true, bubble: true };

  // 说一句闲置词。三条路，按「最快」的顺序试：
  //   ① 预合成缓存命中 → 直接播文件，延迟 0，不占合成队列；
  //   ② 没命中但有语音 → 走正常合成（和回复同一套回落逻辑）；
  //   ③ 不想出声 → 只冒气泡。
  // 气泡和声音是两件事，所以这里不调 say() 一把梭：say() 只管气泡，声音单独走。
  function sayIdle(text) {
    const t = String(text || "").trim();
    if (!t) return;
    const muted = !!(window.FishVoice && window.FishVoice.isMuted && window.FishVoice.isMuted());
    const wantVoice = idleCfg.speak && !muted && !!(window.FishVoice && (window.FishVoice.playUrl || window.FishVoice.speak));
    if (idleCfg.bubble) say(t);
    if (!wantVoice) return;
    const wantCache = !!(window.deskfish && window.deskfish.idleLookup);
    if (!wantCache) {
      try { window.FishVoice.speak(t); } catch (e) { }
      return;
    }
    window.deskfish.idleLookup(t)
      .then((hit) => {
        if (hit && hit.ok && hit.url) {
          // 命中缓存：playUrl 走的是正常播放路径（口型/音量/静音/打断都一致）。
          return window.FishVoice.playUrl(hit.url).catch(() => window.FishVoice.speak(t));
        }
        try { window.FishVoice.speak(t); } catch (e) { }
        return null;
      })
      .catch(() => { try { window.FishVoice.speak(t); } catch (e) { } });
  }
  function maybeIdleTalk() {
    if (Date.now() < nextIdleTalk) return;
    // 暂停中（最小化 / 锁屏 / 游戏模式）不该主动说话：她看不见、用户也听不见，
    // 白白唤醒一次语音合成，游戏模式里更是直接毁掉「极静」这件事。
    if (window.__fishPausedNow && window.__fishPausedNow()) return;
    if (dshPhase === "thinking" || phase === "thinking") return;
    if (dragging) return;
    let key;
    if (Date.now() - lastMoveAt > 120000) {
      // 安静两分钟以上，她就开始惦记了
      key = "longIdle";
    } else {
      // 平时按状态挑：饿了说饿，好感低说孤单，周末有周末的话
      const pet = (window.FishPet && window.FishPet.snapshot) ? window.FishPet.snapshot() : null;
      key = FishLines.stateKey(pet);
      // 偶尔换成「主动搭话」那一组，不然老是同一种语气
      if (Math.random() < 0.22) key = "ping";
    }
    sayIdle(FishLines.pick(key));
    // 一个人待着时的动作：只给幅度小的那几个（想事情、叹气、歪头）。
    // 这几下不要每次都播，三次里挑一次就够，她安静坐着的时候不该一直在动。
    if (Math.random() < 0.34) {
      try { FishModel.actionFor("idle"); } catch (e) { }
    }
    nextIdleTalk = Date.now() + 70000 + Math.random() * 120000;
  }

  // 手机端那边忙不忙：读桥的 /api/health，地址跟着设置里的 bridgeUrl 走。
  let bridgeBase = "http://127.0.0.1:8899";
  // 桥接断了之后她不能一直挂着「思考」：那是「别人在忙」，不是「我在忙」。
  // 以前 pollDsh 的 catch 是空的，桥一关 phase 就永远停在 thinking ——
  // 表情僵在思考相，而且 maybeIdleTalk 见到 thinking 就 return，她再也不主动说话。
  let dshLink = "unknown";
  let dshFail = 0;
  const setLink = (ok) => {
    if (ok) {
      const was = dshLink;
      dshLink = "ok";
      dshFail = 0;
      if (was === "down") {
        try { say("连上了，我在。", "happy", 3600); } catch (e) { }
      }
      return;
    }
    dshFail += 1;
    // 连续两次（约 16 秒）才算真断：一次网络抖动不该让她当场变脸。
    if (dshFail < 2 || dshLink === "down") return;
    dshLink = "down";
    busyByBridge = false;
    syncBusy();
    if (dshPhase === "thinking") dshPhase = "idle";
    try {
      say("我这边连不上 DSH 了……先去忙别的，好了我接着等。", "calm", 5200);
    } catch (e) { }
  };
  const syncBridgeBase = (s) => {
    const u = s && String(s.bridgeUrl || "").trim();
    if (u) bridgeBase = u.replace(/\/+$/, "");
  };
  const pollDsh = () => {
    // 人不在就别打桥：每 8 秒一次 fetch，锁屏一整夜是几千次没人看的请求。
    // 窗口恢复时会立刻补一拍（setPaused 那边调），所以不会「回来还挂着旧状态」。
    // 注意：这里不能直接写 renderPaused —— 那个变量在 startModel 的作用域里，
    // 外面读不到（曾经写成裸引用，结果是每 8 秒一条 ReferenceError）。
    if (window.__fishPausedNow && window.__fishPausedNow()) return;
    try { window.__dshPolls = (window.__dshPolls || 0) + 1; } catch (e) { }
    let ac = null;
    try { ac = new AbortController(); } catch (e) { }
    const timer = ac ? setTimeout(() => { try { ac.abort(); } catch (e) { } }, 3000) : 0;
    fetch(bridgeBase + "/api/health", { cache: "no-store", signal: ac ? ac.signal : undefined })
      .then((r) => r.json())
      .then((j) => {
        // 只认自家桥的应答：8899 上可能是别的服务，光看 busy 会一直挂着思考脸。
        const ours = !!(j && j.app === "dsh-phone-bridge");
        // 端口上答话的不是自家桥（别人的服务、或者 DSH 换了入口）也算断。
        setLink(ours);
        busyByBridge = ours && (j.busy === true || Number(j.queued) > 0);
        syncBusy();
      })
      .catch(() => { setLink(false); })
      .finally(() => { if (timer) clearTimeout(timer); });
  };
  setInterval(pollDsh, 8000);
  window.deskfish.settingsGet().then(syncBridgeBase).then((s) => {
    // 开场第一件事：把「闲置词出不出声、冒不冒气泡」读进来。
    try {
      if (s) {
        if (typeof s.idleSpeak === "boolean") idleCfg.speak = s.idleSpeak;
        if (typeof s.idleBubble === "boolean") idleCfg.bubble = s.idleBubble;
      }
    } catch (e) { }
  }).catch(() => { });

  // 设置变了：只改渲染，不在这里反向覆盖设置本身
  window.deskfish.onSettingsChanged((s) => {
    syncBridgeBase(s);
    // 闲置词：出声 / 气泡，两个开关随时生效，不用重启。
    try {
      if (s) {
        if (typeof s.idleSpeak === "boolean") idleCfg.speak = s.idleSpeak;
        if (typeof s.idleBubble === "boolean") idleCfg.bubble = s.idleBubble;
      }
    } catch (e) { }
    // 贴图精度：只有真的变了才重画。重画一次要重新缩 5 张大图，很贵，
    // 不能因为改了别的设置就顺带做一遍。
    try {
      const wantTex = s && s.texMax !== undefined ? Number(s.texMax) : 0;
      const wt = Number.isFinite(wantTex) && wantTex >= 0 ? wantTex : 0;
      if (wt !== (Number(TUNE.texMax) || 0) && window.FishModel && window.FishModel.setTexMax) {
        window.FishModel.setTexMax(wt);
      }
    } catch (e) { }
    // 表情开关贴片：立刻生效。关掉的同时把正在挂的贴片收掉，
    // 不然她脸上会留着半张黑脸/白眼一直到这段演完。
    try {
      const wantPatch = s ? s.exprPatch !== false : true;
      if (wantPatch !== (TUNE.exprPatch !== false)) {
        TUNE.exprPatch = wantPatch;
        if (!wantPatch && window.FishModel && window.FishModel.exprClearPatch) {
          window.FishModel.exprClearPatch();
        }
      }
    } catch (e) { }
    // 静音：设置页/托盘/快捷键改的是同一份设置，这里只负责让播放层跟上。
    // 只在真的变化时说一句，避免每次保存设置都冒泡。
    try {
      const wantMuted = !!(s && s.mute === true);
      const isMuted = !!(window.FishVoice && window.FishVoice.isMuted && window.FishVoice.isMuted());
      if (window.FishVoice && window.FishVoice.setMuted && wantMuted !== isMuted) {
        window.FishVoice.setMuted(wantMuted);
        if (window.FishSay) window.FishSay(wantMuted ? "好，我安静听着，气泡照常" : "又能出声啦", wantMuted ? "calm" : "happy", 2200);
      }
    } catch (e) { }
    try {
      const vol = Number(s && s.volume);
      if (s && window.FishVoice && window.FishVoice.setVolume && Number.isFinite(vol)) window.FishVoice.setVolume(vol);
    } catch (e) { }
    // 取景不再从设置里来：改取景请走适配器（保存后会触发 pack-changed 重载）。
    // 这里只保留「保存过适配器配置」的轻量重排，避免别的设置一改就把布局抖一下。

    try { if (s && window.FishVoice && window.FishVoice.setDevice) window.FishVoice.setDevice(s.micDevice || ""); } catch (e) { }
    try { if (s && window.FishVoice) { if (window.FishVoice.setWarm) window.FishVoice.setWarm(s.voiceWarm === true); if (window.FishVoice.setVoiceId) window.FishVoice.setVoiceId(s.voiceId || ""); if (window.FishVoice.setVoiceOut) window.FishVoice.setVoiceOut(s.voiceOut || "tts", s.rvcPitch || 0); } } catch (e) { }
    // 回复模型：DSH 还是自定义 API。两边配置分开传，切换时 voice.js 自己会清历史。
    try {
      if (s && window.FishVoice && window.FishVoice.setApiConfig) {
        window.FishVoice.setApiConfig({
          apiBase: s.apiBase || "",
          apiKey: s.apiKey || "",
          apiModel: s.apiModel || "",
        });
      }
      if (s && window.FishVoice && window.FishVoice.setReplyMode) {
        window.FishVoice.setReplyMode(s.replyMode || "dsh");
      }
    } catch (e) { }
    if (!s) return;
    sharpenOn = s.sharpen !== false;
    followCursor = s.followCursor !== false;
    autoIdle = s.autoIdle !== false;
    blinkEnabled = s.blinkEnabled !== false;

    if (app && app.canvas) {
      app.canvas.style.filter = sharpenOn ? "url(#fish-sharpen)" : "none";
    }

    fpsCap = Math.max(15, Math.min(60, Number(s.fpsCap) || 30));

    const wantRes = Number(s.resolution) || 1;
    if (app && app.renderer.resolution !== wantRes) {
      try {
        app.renderer.resolution = wantRes;
        baseResolution = wantRes;
  layout();       // 分辨率一变，物理像素就变，必须立刻重算取景
      } catch (e) { }
    }
  });

  // ---------- 启动（带兜底网） ----------
  // 一次失败不等于坏掉：先重试一次，还不行就降级（关锐化/降采样）再试。
  // 全都不行才把错误显示出来，并给一个「重试」按钮。
  // resolution / sharpen 一律以设置为唯一来源，避免启动的 2、设置里的 1 互相覆盖。
  const bootSafe = async () => {
    // 模型包配置要在读设置之前拿到：取景矩形要不要用设置里存的那份，得看
    // 那份是不是给这台模型调的（见下面 viewBox 的 pack 标记）。
    PACK = await loadPack();
    exprSlotReset();
    syncTune(PACK);
    if (!PACK || !PACK.url) {
      console.warn("[fish] 没有可用模型，显示导入引导" + (PACK && PACK.missingModel ? "（缺模型文件）" : ""));
      showNoModel(PACK && PACK.missingModel ? "missing" : "");
      return;
    }
    let st = null;
    try { st = await window.deskfish.settingsGet(); } catch (e) { }
    console.log("[fish] boot settings mic=" + JSON.stringify(st && st.micDevice) + " voice=" + (window.FishVoice ? 1 : 0));
    try { if (st && window.FishVoice && window.FishVoice.setDevice) window.FishVoice.setDevice(st.micDevice || ""); } catch (e) { console.log("[fish] setDevice 失败 " + e.message); }
    // 上次是静音着退出的，这次开局就别先响一声。
    try { if (st && window.FishVoice && window.FishVoice.setMuted) window.FishVoice.setMuted(st.mute === true); } catch (e) { }
    try { const vol = Number(st && st.volume); if (st && window.FishVoice && window.FishVoice.setVolume && Number.isFinite(vol)) window.FishVoice.setVolume(vol); } catch (e) { }
    try { if (st && window.FishVoice) { if (window.FishVoice.setWarm) window.FishVoice.setWarm(st.voiceWarm === true); if (window.FishVoice.setVoiceId) window.FishVoice.setVoiceId(st.voiceId || ""); if (window.FishVoice.setVoiceOut) window.FishVoice.setVoiceOut(st.voiceOut || "tts", st.rvcPitch || 0); } } catch (e) { }
    try {
      if (st && window.FishVoice && window.FishVoice.setApiConfig) {
        window.FishVoice.setApiConfig({ apiBase: st.apiBase || "", apiKey: st.apiKey || "", apiModel: st.apiModel || "" });
      }
      if (st && window.FishVoice && window.FishVoice.setReplyMode) {
        window.FishVoice.setReplyMode(st.replyMode || "dsh");
      }
    } catch (e) { }
    const wantRes = st && st.resolution ? Number(st.resolution) : 2;
    const wantSharp = st ? st.sharpen !== false : true;
    // 贴图精度：0 缺省=自动（按显卡能力给 4096）。
    // 这一项在 boot() 读模型之前就要定下来，否则第一次加载会先用自动档画一遍。
    try {
      const wt = st && st.texMax !== undefined ? Number(st.texMax) : 0;
      TUNE.texMax = Number.isFinite(wt) && wt >= 0 ? wt : 0;
    } catch (e) { }
    // 表情开关贴片：主人嫌某些「整张贴图」的脸太跳（白眼球、黑脸），
    // 可以在这里一次性全关，关了只留眼睑/眉/嘴角的连续表情。
    try {
      TUNE.exprPatch = st ? st.exprPatch !== false : true;
    } catch (e) { }
    // 取景只有一个来源：模型自己的 layout。
    // 以前还读 settings.viewBox，两套值会互相覆盖 —— 换了模型就把上个模型的框套上来。
    try {
      if (PACK && PACK.layout) {
        viewBox = {
          y: Math.min(1, Math.max(-0.3, Number(PACK.layout.viewY) || 0)),
          h: Math.min(1, Math.max(0.04, Number(PACK.layout.viewH) || 0.5)),
        };
      }
    } catch (e) { }
    console.log("[fish] 取景 y=" + viewBox.y + " h=" + viewBox.h);

    const attempts = [
      { label: "正常启动", sharpen: wantSharp, resolution: wantRes },
      { label: "重试", sharpen: wantSharp, resolution: wantRes },
      { label: "降级启动（关锐化、标准清晰度）", sharpen: false, resolution: 1 },
    ];
    for (let i = 0; i < attempts.length; i += 1) {
      try {
        if (i > 0) {
          // 清掉上一次残留的画布
          if (app && app.canvas && app.canvas.parentNode) app.canvas.parentNode.removeChild(app.canvas);
          app = null;
          model = null;
          await new Promise((r) => setTimeout(r, 400));
        }
        sharpenOn = attempts[i].sharpen;
        baseResolution = attempts[i].resolution;
        await boot();
        if (i > 0) console.log("[fish] 用「" + attempts[i].label + "」起来了");
        return;
      } catch (e) {
        console.error("[fish] 启动失败：" + attempts[i].label, e);
        lastError = e;
      }
    }
    // 只说「模型没能启动」等于没说：用户看到的是一句技术错误 + 一个点不出结果的按钮。
    // 先把「文件在、但加载不起来」这层判断讲明白，再说多半是什么原因，最后才贴原始错误。
    fail("模型文件找到了，但没能加载起来。\n"
      + "多半是贴图缺了、或者 moc3 的版本比程序内置的 Cubism Core 新。\n"
      + "换一个模型最快 —— 下面第二个按钮直接进适配器。\n\n"
      + (lastError && lastError.message ? lastError.message : ""));
    showRetry();
  };

  // 只换了规则（取景 / 表情 / 动作路由）：重新读一遍包配置、重算取景就够了，不重载模型。
  // 改一次取景就重解 16 MB 的 moc3，用户看到的是她闪掉好几秒。
  async function applyPackRules() {
    try {
      const p = await loadPack();
      if (!p) return false;
      PACK = p;
      // 换包了：槽位→参数名的缓存必须清，否则会拿上一个模型的索引去写这个模型
      exprSlotReset();
      syncTune(p);
      if (p.layout) {
        viewBox = {
          y: Math.min(1, Math.max(-0.3, Number(p.layout.viewY) || 0)),
          h: Math.min(1, Math.max(0.04, Number(p.layout.viewH) || 0.5)),
        };
      }
      layout();
      return true;
    } catch (e) {
      console.warn("[fish] 重新读模型规则失败：" + (e && e.message));
      return false;
    }
  }
  // 自测入口：探针要能直接触发一次「只换规则」
  window.__applyPackRules = applyPackRules;

  // 模型包在别处被换了/删了（适配器窗口、删包接口）：整页重载最干净 ——
  // 换模型等于换一整套贴图、参数索引和动作路由，增量改比重载更容易漏。
  if (window.deskfish && window.deskfish.onPackChanged) {
    window.deskfish.onPackChanged(() => { location.reload(); });
  }
  if (window.deskfish && window.deskfish.onPackRules) {
    window.deskfish.onPackRules(() => { applyPackRules(); });
  }

  bootSafe();
})();
