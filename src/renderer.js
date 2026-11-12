// 大肥鱼 · 独立桌面挂件 · 渲染与驱动
// 从 dsh-pet 那个版本搬过来，去掉了所有 dsh 依赖。

(() => {
  const vendor = window.__dshPetLive2d;
  const stageEl = document.getElementById("stage");
  const bubbleEl = document.getElementById("bubble");
  const errEl = document.getElementById("err");

  // 气泡：停留时间按字数算，短句不拖、长句够看；说话时轻微跳动，像在讲话。
  // 太长的句子先收一收，气泡撑满整块屏幕反而什么都读不到。
  // 气泡说一句，第二个参数可选：'happy' | 'shy' | 'annoyed' | 'sad'。
  // 只换边框和光晕的颜色，不换底色——那是她说这话时的温度，不是换了一套 UI 主题。
  const MOODS = ["happy", "shy", "annoyed", "sad"];
  const say = (t, mood, holdMs) => {
    if (!t) return;
    let text = String(t).trim();
    if (!text) return;
    // 不砍字数了：砍到 56 字时 TTS 还在念全文，看得见的和听得见的对不上。
    // 改成按行数限高（CSS 的 max-height），短句照常显示。
    // 长句最多占六行，再长就在视觉上收口（可以自己滚）。
    MOODS.forEach((m) => bubbleEl.classList.remove(m));
    if (mood && MOODS.indexOf(mood) >= 0) bubbleEl.classList.add(mood);
    bubbleEl.textContent = text;
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
    bubbleEl.textContent = String(t).trim();
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
  //…?voice.js 用：它说出来的话走同丢…个气…?
  window.FishSay = say;
  window.FishHint = hint;

  // ┢…┢…状…面板的反应 ┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…
  //  面板是独立窗口（petpanel.html），它做完动作会广播过来
  // 这里只负责…让她有反应」：表情 + 台词…?
  // 数据是面板那边自己写 localStorage 的，这边不用管…?
  // 面板正在进行的活动（吃/睡/洗澡…）。声明放在广播监听前面，是因为那个闭包
  // 要引用它；声明在更后面虽然也能跑，但脚本还在求值时收到消息会撞 TDZ 直接抛错。
  let activity = null;
  let __actPollAt = 0;
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
        say(PICK("food.fish", "好吃…谢谢你"), 2400);
      } else if (kind === "play") {
        setExpr("curious", 2400);
        try { if (window.FishModel) window.FishModel.actionFor("more"); } catch (e) { }
        say(PICK("play.ok", "跟你玩挺开心的"), 2400);
      } else if (kind === "touch") {
        setExpr("shy", 2400);
        try { if (window.FishModel) window.FishModel.actionFor("petHead"); } catch (e) { }
        say(PICK("pet.head", "唔……"), 2000);
      } else if (kind === "feed.fail") {
        setExpr("pout", 1400);
        say(PICK("food.full", "刚吃过啦"), 1600);
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
        if (d.line) say(String(d.line), 3000);
      } else if (kind === "act.done" || kind === "act.stop") {
        const d = ev.data || {};
        activity = null;
        try { setExpr(kind === "act.done" ? "happy" : "default-body", kind === "act.done" ? 2600 : 0); } catch (e) { }
        try { if (window.FishModel) window.FishModel.actionFor(kind === "act.done" ? "actDone" : "actStop"); } catch (e) { }
        if (d.line) say(String(d.line), 2800);
      } else if (kind === "act.fail") {
        const d = ev.data || {};
        try { setExpr("pout", 1500); } catch (e) { }
        if (d.line) say(String(d.line), 1800);
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

  const clampNum = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

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

  const PIDX = {
    ParamAngleX: 28, ParamAngleY: 29, ParamAngleZ: 30,
    ParamBodyAngleX: 36, ParamBodyAngleZ: 41,
    ParamEyeBallX: 76, ParamEyeBallY: 77,
    ParamEyeLOpen: 97, ParamEyeROpen: 85,
    ParamMouthOpenY: 107, ParamMouthForm: 106,
    ParamBreath: 508,
  };
  // 完整的参数名→索引表，模型加载完建一次…?
  // 为什么必须建：cm.getParameterIndex(name) 返回的索引带偏移（实…?Movement2 应该 16 却给 510），
  // 拿它…?setParameterValueByIndex 会写到别的参数上…嘴上在打哈欠，实际动的是别的变形器…?
  // 而且完全不报错…上丢…版就是这里让手写动作"看起来没生效"…?
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

  // 状…?
  let tx = 0, ty = 0;                       // 鼠标归一化目标（-1..1）
  let lastMoveAt = Date.now();
  let phase = "idle";
  let petZone = "face", petAt = 0, petDir = 1, petCombo = 1, petComboAt = 0, petCount = 0;
  let tapAt = 0;
  // 按住不放：单击是"…?，一直按睢…就变…?捏着不放"，她该抗议了
  let pressAt = 0, pressComplained = false;
  // 松手之后余…还在，让她再多荡两下…不然松手瞬间就僵住，像断了…?
  let fling = 0;
  // tick 里每帧重建的 target 是局部的，这里留丢…份引用，排障时才能看…?她本来想摆成仢…么样"
  let lastTarget = null;

  // 缓动状…?
  const mv = { yaw: 0, pitch: 0, roll: 0, body: 0, gazeX: 0, gazeY: 0, blink: 0, squint: 0 };
  let pending = null;

  // 眨眼
  let blinkStart = -1, nextBlink = performance.now() + 1800 + Math.random() * 2600;
  let blinkVal = 0, blinkActive = false;
  let mouth = 0;

  // 眼球微跳
  let lastSaccade = performance.now(), nextSaccade = 900 + Math.random() * 1600;
  let sacX = 0, sacY = 0;

  // 小动…?
  let gesture = null, nextGestureAt = 0;

  // 运行期开关（设置面板能改，改了立刻生效）
  let sharpenOn = true;
  let baseResolution = 2;
  // 帧率上限：60 最顺、30 省一半 CPU、15 最省电。空闲时再自动降到 15。
  let fpsCap = 30;
  let followCursor = true;
  let autoIdle = true;
  let blinkEnabled = true;

  let lastError = null;

  // DSH 状…?
  let dshPhase = "idle", dshBubble = "";

  // 兜底界面：模型起不来时别只丢丢…行字，给个能点的按钮
  const showRetry = () => {
    if (document.getElementById("fish-retry")) return;
    const btn = document.createElement("button");
    btn.id = "fish-retry";
    btn.textContent = "重试";
    btn.style.cssText =
      "position:fixed;left:50%;top:58%;transform:translateX(-50%);z-index:99;" +
      "padding:7px 22px;border-radius:8px;border:1px solid #4a5580;" +
      "background:#232840;color:#e8eaf2;font:13px/1.4 'Microsoft YaHei UI',sans-serif;cursor:pointer;";
    btn.addEventListener("click", () => {
      btn.remove();
      errEl.style.display = "none";
      lastError = null;
      bootSafe();
    });
    document.body.appendChild(btn);
  };

  // 点击回弹用的曲线：以前是线性插值，几个折点之间会出现「机械臂」一样的硬拐。
  // 改成和动作播放器一致的 Catmull-Rom（端点镜像虚拟邻居），拐点自然、仍保留回弹感。
  const curve = (t, pts) => {
    const n = pts.length;
    if (n === 0) return 0;
    if (n === 1 || t <= pts[0][0]) return pts[0][1];
    const last = pts[n - 1];
    if (t >= last[0]) return last[1];
    let i = 0;
    for (let j = 0; j < n - 1; j += 1) {
      if (t >= pts[j][0] && t <= pts[j + 1][0]) { i = j; break; }
    }
    const p1 = pts[i], p2 = pts[i + 1];
    const p0 = i > 0 ? pts[i - 1] : [2 * p1[0] - p2[0], p1[1]];
    const p3 = i + 2 < n ? pts[i + 2] : [2 * p2[0] - p1[0], p2[1]];
    const u = (t - p1[0]) / Math.max(1e-6, p2[0] - p1[0]);
    const u2 = u * u, u3 = u2 * u;
    return 0.5 * (
      (2 * p1[1]) +
      (-p0[1] + p2[1]) * u +
      (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * u2 +
      (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * u3
    );
  };

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
    if (why) {
      if (reason === "missing") {
        why.hidden = false;
        why.textContent = "现在选中的模型包缺文件：只剩配置，没有 .moc3 / 贴图。1.1.0 起安装包不再带模型，升级后旧的内置模型会变成这样 —— 重新导入一个完整模型包就行。";
      } else {
        why.hidden = true;
      }
    }
    const tip = document.getElementById("nmTip");
    const run = async (kind, btn) => {
      if (!window.deskfish || !window.deskfish.modelImport) return;
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = "正在导入…";
      try {
        const r = await window.deskfish.modelImport(kind);
        if (r && r.ok) {
          if (tip) tip.textContent = "装好了，正在换上新模型…";
          location.reload();
          return;
        }
        if (r && r.canceled) { btn.disabled = false; btn.textContent = label; return; }
        if (tip) tip.textContent = "导入失败：" + ((r && r.error) || "未知原因");
      } catch (e) {
        if (tip) tip.textContent = "导入失败：" + ((e && e.message) || e);
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
    // 叠一层锐化…画布是 2 倍超采样再缩回窗口，缩小时高频会被削掉，这里补回来…?
    if (sharpenOn) app.canvas.style.filter = "url(#fish-sharpen)";

    model = await vendor.Live2DModel.from(MODEL_URL, {
      autoUpdate: false,
      autoHitTest: false,
      autoFocus: false,
      textureOptions: { lod: "single-auto" },
    });

    if (disposed) return;

    // 参数名→索引表，越早建越好：后面 put() / playMotion 全靠它…?
    // 不能偷懒…?cm.getParameterIndex()…那个返回的索引带偏移（实测 Movement2…?510…?
    // 而遍…?getParameterId 得到的是 16），写进去不报错，但值全落到别的变形器上…?
    try { buildIndex(model.internalModel.coreModel); } catch (e) { }

    // 贴图：引擎的 Worker 解码会压到 1024，自己取原图换上
    const jobs = [];
    for (let i = 0; i < TEXTURE_COUNT; i += 1) {
      const t = PACK && PACK.textures && PACK.textures[i];
      const u = (t && t.url) ? t.url : texUrl(i);
      //…?<img> 而不…?createImageBitmap：ImageBitmap 会一直持有解码后的像素，
      // 五张 4096~8192 的图叠起来就…?1.8GB…?img> 在上…?GPU 后浏览器可以回收 CPU 侧数据…?
      jobs.push((async () => {
        const img = new Image();
        img.decoding = "async";
        await new Promise((res, rej) => {
          img.onload = () => res();
          img.onerror = () => rej(new Error("img load fail " + u));
          img.src = u;
        });
        const tex = model.textures[i];
        const src = tex && (tex.source || (tex.baseTexture && tex.baseTexture.source));
        if (!src) return;
        // 大图缩到「够用的大小」再上 GPU：桌宠窗口通常 400~600 高，
        // 8192×8192 的贴图纯属浪费显存（五张就是 1GB+）。2048 已经够 4 倍超采样。
        // 先画进 canvas 再挂上去，比例不变、UV 不变，Cubism 只看归一化坐标。
        const MAX = 2048;
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
        // 丢掉引擎早先加载的那张缩水图，别让它一直挂着
        const old = src.resource;
        if (old && old !== use && typeof old.close === "function") {
          try { old.close(); } catch (e) { }
        }
        if (typeof src.resize === "function") src.resize(tw, th);
        src.resource = use;
        // 2048 缩到 460 显示还有 4 倍，开 mipmap 才不会闪烁/发糊
        src.autoGenerateMipmaps = true;
        if (typeof src.updateMipmaps === "function") { try { src.updateMipmaps(); } catch (e) { } }
        src.update();
        if (src.style) {
          src.style.minFilter = "linear";
          src.style.magFilter = "linear";
          src.style.mipmapFilter = "linear";
          src.style.anisotropicLevel = 1;
        }
      })().catch(() => { }));
    }
    await Promise.all(jobs);
    console.log("[fish] tex=" + model.textures.map((t) => {
      const src = t && (t.source || (t.baseTexture && t.baseTexture.source));
      return src ? src.width + "x" + src.height : "?";
    }).join(","));

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

    // 参数要写…?动作、物理…姿势都算完、网格还没生…?这个点…?
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
  // 只暴露只读数字，不给外部改状态的能力。
  window.__fishDebug = () => ({
    fps: app && app.ticker ? Math.round(app.ticker.FPS) : -1,
    maxFps: app && app.ticker ? app.ticker.maxFPS : -1,
    res: app && app.renderer ? app.renderer.resolution : -1,
    idleMs: Date.now() - lastMoveAt,
    phase,
    model: !!(model && model.visible),
  });
    window.addEventListener("resize", layout);
  };

  // ---------- 表情：用参数组合，不…?key 弢…?----------
  // 模型…?23…?exp3 表情文件，每个只是把 key1~key13 里的丢…个设…?1…?
  // 我一弢…始就是照睢…这个直接…?key 参数…确实写进去了（key4 稳定…?1），
  // 但画面上仢…么都不变。查…?147 个部件的不…明度全…?1，说明这个模型的
  // 表情不靠部件可见性切换；美术…?Cubism 里建了参数…没把它们接…?ArtMesh 上…?
  // 这条路是死的，别再试第二次…?
  //
  // 扢…以表情改成…用能动的参数拼情绪」…嘴型…眼睑…歪头…视线都是活的参数，
  // 组合起来丢…样能读出情绪，…且不需要任何美术配合…?
  //
  // 数…是偏移量，会叠加在基础值上（比如歪头是…?roll 之上再歪丢…点）…?
  //   mouth …?ParamMouthForm（嘴角，…?笑，…?撇嘴…?
  //   eye   …?负数表示眼睛更闭（好笑成弯月、累成半睁）
  //   roll  …?歪头角度（度…?
  //   yaw   …?头转…?
  //   gazeX / gazeY…?眼珠偏移
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
  // 手写动作「伸懒腰」的曲线 …?…?model/mot/stretch.motion3.json 是同丢…份数据，
  // 只是这里由我自己按时间推（引擎的 motionManager 在这套接入里播不出来）…?
  // 数…依据：Movement2 手臂抬起 0…?、Param56 待机 0.44 / 举手 1.0…?
  // Param57 待机 0.26、ParamAngleY 抬头 ±30、ParamEyeLOpen 1=睁眼…?
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
    // 手动设了表情就把自动切换推后，否则下丢…?maybeChangeExpr 会当场覆盖它
    //（原来只…?14 秒的随机间隔，测试时表情总是"自己变回…?）…?
    nextExprAt = Date.now() + Math.max(holdMs || 0, 14000);
    if (holdMs > 0) {
      exprTimer = setTimeout(() => {
        if (disposed) return;
        setExpr(EXPR_DEFAULT, 0);
      }, holdMs);
    }
  }

  // 让她自己按心情换表情：饿睢…开心…无聊各不一样…?
  // 这是"养女…?那套数…第丢…次真的影响到她的样子…?
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

    // 偶尔伸个懒腰 …?手写…?motion3 动作，见 model/mot/stretch.motion3.json…?
    // 动作期间 applyParams 会把用到的参数让出来（__motionOwn），扢…以它自己的表情曲线不会被盖…?
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

    const pick = pool[Math.floor(Math.random() * pool.length)];
    setExpr(pick, hold);
  }

  // 统一起动作：交叉淡化的时长按前后两个动作的时长自适应。
  // 以前写死 0.24 秒：0.8 秒的小动作会被吞掉一半，2 秒的慢动作又像被硬拽走。
  // 短动作给 0.18–0.2 秒，长动作最多 0.62 秒，让动作「交接」而不是「切换」。
  const launchMotion = (name, curves, dur) => {
    const prev = __act;
    // 过渡倍率只影响淡入淡出与交叉淡化，不改动作本身的节奏。
    const fs2 = TUNE.fadeScale;
    const cross = prev ? Math.min(0.9, Math.max(0.12, Math.min(prev.dur, dur) * 0.26 + 0.06) * fs2) : 0.24 * fs2;
    if (prev) { __actPrev = prev; __actPrevT0 = performance.now(); }
    __act = { t0: performance.now(), dur, curves, name: name || "custom", cross, speed: TUNE.motionSpeed };
    return cross;
  };


  // ---------- 模型自带动作（motion3） ----------
  // 动作文件里的曲线会写 ParamAngleX、ParamBodyAngleX、眼睑…这些参数，
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
  // 排障/测试用：能直接指定表情，也能看她现在是什么表…?
  window.FishModel = {
    // 手感参数快照：适配器/自动化测试要能确认「我存的那组数」真的进了渲染端
    tuning: () => Object.assign({}, TUNE),
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
    // 从场景表里随机挑丢…个播。同丢…个场景连睢…触发时尽量不重样…?
    // 注意这里必须真的播出去…之前只挑名字不播，测的时…看到返回了 name
    // 就以为…了，结果画面上仢…么都没发生…?
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
      const tbl = (window.FishMotionScenes || {});
      const list = tbl[useScene];
      if (!Array.isArray(list) || !list.length) return { ok: false, why: "no scene: " + useScene };
      let pick = list[0];
      if (list.length > 1) {
        const last = actionLast[scene];
        const pool = list.filter((x) => x !== last);
        pick = pool[Math.floor(Math.random() * pool.length)] || list[0];
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
      if (!__act) return null;
      const t = ((performance.now() - __act.t0) / 1000) * (__act.speed || 1);
      const want = {};
      for (const [id, pts] of __act.curves) want[id] = Math.round(lerpAt(pts, t) * 1000) / 1000;
      return {
        name: __act.name,
        t: Math.round(t * 1000) / 1000,
        dur: __act.dur,
        curves: __act.curves.length,
        want,
      };
    },
    // 之前「动作没生效」查了半天就是因为这张表可能是空的，而外面看不见…?
    _idx: (name) => {
      if (name === undefined) return { built: !!IDX2, n: IDX2 ? Object.keys(IDX2).length : 0 };
      return { name, i: findIdx(name), inIDX2: IDX2 ? IDX2[name] : undefined, inPIDX: PIDX[name] };
    },
    // 直接摸到 model，排查表情为仢…么没生效时用
    _model: () => model,
    // 当前这一帧的"意图"（target）…参数本身在帧外读到的是 loadParameters 恢复后的值，
    // 永远是默认…扢…以要验惯…?歪头这类效果，只能看这里…?
    _target: () => (lastTarget ? JSON.parse(JSON.stringify(lastTarget)) : null),
    // 甩出去之后的余…松手那一瞬间记下来的
    _fling: () => ({ vx: Math.round(dragVX * 10) / 10, vy: Math.round(dragVY * 10) / 10, fling: Math.round(fling * 10) / 10 }),
    // 性能观测：帧率…上限…画布尺寸…堆占用。优化前后要拿它对比，不能凭感觉…?
    perf: () => ({
      fps: app && app.ticker ? Math.round(app.ticker.FPS) : -1,
      maxFps: app && app.ticker ? app.ticker.maxFPS : -1,
      canvas: app && app.canvas ? [app.canvas.width, app.canvas.height] : null,
      res: app && app.renderer ? app.renderer.resolution : -1,
      heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1,
      tickN: tick._n || 0,
      ranN: tick._ran || 0,
      calm: !!tick._calm,
      // calm 是…么判出来的 …?只看丢…?false 猜不出是被谁卡的
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
    // 读一个参数的实际值…表情到底有没有写进模型，看这个朢…准…?
    // 注意必须…?findIdx，不能用 cm.getParameterIndex…?
    // 后…返回的索引带偏移（Movement2 会给 510，真值是 16），读出来是别的变形器…?
    param: (name) => {
      try {
        const cm = model.internalModel.coreModel;
        const i = findIdx(name);
        return i < 0 ? null : cm.getParameterValueByIndex(i);
      } catch (e) { return "ERR " + e.message; }
    },
    // 丢…次看她脸上的几个"弢…?（表情用的就是这些自定义 key…?
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
  // 取景矩形：模型上的哪丢…块装进窗口…存…?{ y, h }（相对包围盒 0~1），
  // 由…调整取景…那个窗口拖出来。换模型也不用重推公式…?
  let viewBox = { y: -0.02, h: 0.40 };
  let baseW = 0, baseH = 0;   // 模型原始画布尺寸，只认第一次量到的
  let resizeObs = null;

  // 尺寸稳定化：窗口动画/缩放过程…?ResizeObserver 会连睢…触发好几次，
  // 中间那几帧的容器尺寸和取景参数对不上，会让模型偏丢…下…?
  // 用法：想重算取景时调 relayoutSoon()，它会等到尺寸连续两次一致才真算…?
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
        // 再来丢…帧确认（有些机器…?clientWidth 会晚丢…帧才准）
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

    //…?先让画布铺满容器（容器本身由 CSS 决定大小…?
    app.canvas.style.width = "100%";
    app.canvas.style.height = "100%";

    //…?量真实容…?
    const cw = Math.max(1, Math.round(host.clientWidth || 0));
    const ch = Math.max(1, Math.round(host.clientHeight || 0));

    //…?按物理像素改渲染目标（resolution 已由 pixi 记住…?
    try { app.renderer.resize(cw, ch); } catch (e) { }

    //…?夺回 CSS 尺寸：resize 会把 style 写成 "cw px"，不夺回来就会被拉伸
    app.canvas.style.width = "100%";
    app.canvas.style.height = "100%";

    W = cw;
    H = ch;

    //  【必须用原始尺寸，不能用 model.width】
    //  pixi v8 的 model.width = Math.abs(scale.x) * 原始宽，会跟着 model.scale 变。
    //  若这里读 model.width 再把它算出的 fit 设回 model.scale，就成了反馈回路：
    // 每重算一次就把上一次的缩放再叠一次，窗口越大偏得越离谱。
    // 扢…以第丢…次读到就把原始尺寸记下来，之后一直用它…?
    if (baseW <= 0 || baseH <= 0) {
      // 必须用…内容包围盒」，不能…?originalWidth/Height…?
      // original* 是画布，比实际画的内容大丢…圈（这个模型 7697 vs 6793）…?
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
    // 取景：只要…头到胸」这丢…段…?
    // 这个模型的包围盒…?*全身**（主人原话…盒子还是很长…），…且上缘还有 20.5%…?
    // 透明边距…图是画在盒子靠下的位置的…所以两个数都得用：
    //   TOP_MARGIN  盒子顶上那块空白（实…?0.205…?
    //   CONTENT     真正想看的内容占「有画的部分」的比例
    // 只用盒子比例会先空一大块、然后把身子也带进来（两版都踩过）…?
    // 取景：把 viewBox 那个矩形（模型上…?y/h）装进窗口…?
    // 这个模型的包围盒是全身，扢…以…看哪一段…只能由矩形说了算，
    // 不能拿盒子比例硬切…之前试过三版，不是空一大块就是把身子全带进来…?
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
  // 取景日志：只在尺寸变化时打一行，量很小，留着方便以后查这类问…?
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

  // ---------- 每帧写参…?----------
  // key 系列（表情开关）不在 PIDX 那张写死的表里，第一次用要现查索引，
  // 查到就缓存…每帧都…?getParameterIndex 是白费时间…?
  const keyIdx = {};
  // 播手写动作（motion3）时，被动作占用的参数要让位，否…?applyParams 每帧写死会把它盖掉…?
  // null = 正常状…；Set = 这些参数由动作说了算，applyParams 不碰…?
  let __motionOwn = null;
  let __motionOwnTimer = 0;
  let __playingMotion = false;
  // ┢…┢…手写动作播放…?┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…┢…
  // 引擎…?motionManager 在这套接入里播不出自定义动作（startMotion 恒返…?false…?
  // currentMotion 丢…直是 null，试…?FORCE 优先…?/ stopAllMotions /…?motionFinish 死锁…?
  // 都没用）。所以不跟它耗，自己按时间推曲线：数据结构和 motion3 丢…样，只是由我算…?
  // 好处是每帧的值都在手里，坏处是不…?FadeIn/物理联动…这些自己补…?
  // __act 已在文件上方（CTX_MENU 附近）声明：那边要先于 BroadcastChannel 的闭包可见。
  const actionLast = {};
  // 两点之间怎么补：不能只用 smoothstep…?
  // smoothstep 在每个控制点处导数都…?0，多点的动作会变成…走走停停…?
  // 每到丢…个点就刹丢…下车，看睢…像卡带…用 Catmull-Rom 样条：曲线穿过每个点…?
  // 而且相邻段在连接处的丢…阶导数连续，速度是顺过去的…?
  // 端点用…镜像虚拟点」，避免首尾出现假的加…度…?
  const lerpAt = (pts, t) => {
    const n = pts.length;
    if (n === 0) return 0;
    if (n === 1) return pts[0][1];
    if (t <= pts[0][0]) return pts[0][1];
    const last = pts[n - 1];
    if (t >= last[0]) return last[1];
    let i = 0;
    for (let j = 0; j < n - 1; j++) {
      if (t >= pts[j][0] && t <= pts[j + 1][0]) { i = j; break; }
    }
    const p1 = pts[i], p2 = pts[i + 1];
    // 虚拟邻居：端点用「对自己做镜像…这样首尾的切线是合理…?
    const p0 = i > 0 ? pts[i - 1] : [2 * p1[0] - p2[0], p1[1]];
    const p3 = i + 2 < n ? pts[i + 2] : [2 * p2[0] - p1[0], p2[1]];
    const span = p2[0] - p1[0] || 1;
    const u = (t - p1[0]) / span;
    const u2 = u * u, u3 = u2 * u;
    // Catmull-Rom 基函数（张力 0.5 的标准形式）
    return 0.5 * (
      (2 * p1[1]) +
      (-p0[1] + p2[1]) * u +
      (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * u2 +
      (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * u3
    );
  };
  const applyParams = () => {
    if (disposed || !model || pending === null) return;
    const st = pending;
    const cm = model.internalModel.coreModel;
    const put = (name, v) => {
      let i = findIdx(name);
      if (i >= 0) cm.setParameterValueByIndex(i, v, 1);
    };
    // 三个道具/手臂弢…关常驻压…?
    // 但如果正在播丢…个…手写动作…（motion3），这些参数要让位给它，否则动作等于没播…?
    // 让位范围…?__motionOwn 决定：播动作前把该动作用到的参数名塞进去，播完清空…?
    const own = __motionOwn;
    const put2 = (name, v) => { if (!own || !own.has(name)) put(name, v); };
    put2("Movement1", 0);
    put2("Movement2", 0);
    put2("Movement3", 0);

    // 情绪偏移每帧朝目标靠丢…点（0.1…?0.15 秒），换表情不硬切…?
    // 必须在写参数之前算好，下面几个参数都要叠加它…?
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
    // 说话时嘴要跟睢…真实声音动…mouthLevel…?voice.js…?WebAudio 分析播放中的音频得到…?
    // 没有它的话她只是…?念…6…0"，嘴永远是同丢…个开合度，一眼假…?
    const speakMouth = (window.FishVoice && window.FishVoice.mouth) ? window.FishVoice.mouth() : 0;
    const mouthY = Math.max(st.mouth, speakMouth);
    put2("ParamMouthOpenY", mouthY);
    put2("ParamMouthForm", (mouthY > 0.02 ? 0.35 : 0) + (ex.mouth || 0));
    const breathAmp = (PACK && PACK.interaction && Number(PACK.interaction.breathAmp)) || 1;
    put2("ParamBreath", 0.5 + 0.5 * breathAmp * Math.sin(st.elapsed * 1.6));
    // eye 是负数表…?更闭"（笑成弯月…累成半睁），所以这里减…?
    const closed = Math.max(st.blink, st.blinkVal, st.squint || 0) + Math.max(0, -(ex.eye || 0));
    put2("ParamEyeLOpen", Math.min(1, Math.max(0, 1 - closed)));
    put2("ParamEyeROpen", Math.min(1, Math.max(0, 1 - closed)));

    // 手写动作叠在朢…上面 …?放在朢…后写，才能盖住上面那些常规参…?
    if (__act) {
      const t = (performance.now() - __act.t0) / 1000;
      if (t >= __act.dur) {
        __act = null;   // 曲线自己会回到基础值，淡出权重也收到 0 了，这里直接收
        __actPrev = null;
      } else {
        // 进和出都要淡。硬切会让「起身」和「坐下」都像被抽掉。
        // 淡入淡出按时长比例给：写死 0.42+0.52=0.94 秒时，surprise 全长 1.05 秒
        // 只剩 0.11 秒满强度，动作永远软绵绵像没做。上限保住长动作的淡出时间。
        const FI = Math.min(0.42 * TUNE.fadeScale, __act.dur * 0.24);
        const FO = Math.min(0.52 * TUNE.fadeScale, __act.dur * 0.28);
        let w = 1;
        if (t < FI) w = t / FI;
        else if (t > __act.dur - FO) w = (__act.dur - t) / FO;
        w = w < 0 ? 0 : (w > 1 ? 1 : w);
        const k = w * w * (3 - 2 * w);   // 两端都缓，线性看着像机械臂

        // 交叉淡化：换动作的前 cross 秒，把上一个动作的值混进来。
        // cross 由 launchMotion 按前后动作时长算好（0.18–0.62 秒），短动作不再被吞，
        // 长动作也不会被 0.24 秒硬切走。
        // 权重按「新动作逐渐接管」算：old*(1-w) + new*w，w = cross*k，
        // 两边权重和恒为 1；旧写法 new 额外乘 k 会在交接中段产生一个掉回基础值的塌陷。
        let cross = 1;
        const prevWants = new Map();
        if (__actPrev) {
          const CD = Math.max(0.14, __act.cross || 0.24);
          const pt = ((performance.now() - __actPrevT0) / 1000) * (__actPrev.speed || 1);
          if (pt > CD) {
            __actPrev = null;
          } else {
            cross = pt / CD;
            cross = cross * cross * (3 - 2 * cross);
            const ptc = Math.min(pt, __actPrev.dur);
            for (const [id, pts] of __actPrev.curves) prevWants.set(id, lerpAt(pts, ptc));
          }
        }

        const touch = (id) => {
          const i = findIdx(id);
          if (i < 0) return;
          const base = cm.getParameterValueByIndex(i);
          const pw = prevWants.has(id) ? prevWants.get(id) : base;
          let nw = base;
          for (const [nid, pts] of __act.curves) { if (nid === id) { nw = lerpAt(pts, t); break; } }
          const nwW = cross * k;
          const v = base + (pw - base) * (1 - nwW) + (nw - base) * nwW;
          cm.setParameterValueByIndex(i, v, 1);
        };

        for (const [id] of __act.curves) touch(id);
        for (const id of prevWants.keys()) {
          let inNew = false;
          for (const [nid] of __act.curves) { if (nid === id) { inNew = true; break; } }
          if (!inNew) touch(id);
        }
      }
    }

    // 表情叠加放在最后：动作曲线写完再盖，exp3 的「加一点嘴角」才落在姿态之上，
    // 而不是被曲线冲掉。先叠默认表情（有些模型的中性脸本身就是一个 exp），再叠当前情绪。
    if (EXPR_BASE) applyExprSet(cm, EXPR_BASE);
    if (exExtra) applyExprSet(cm, exExtra);
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

    // 帧率自…应：没人理她的时…降…?30fps…?
    // pixi…?maxFPS 是有效的（实…?83…?33）；手动跳帧只让我的代码少跑…?
    // pixi 自己那层渲染还在原地空转，所以这里用 maxFPS，不用跳帧…?
    //
    // 关于 thinking：早先这里还写了 `!thinking`，意思是「DSH 在忙就别降载」…?
    //…?thinking 的判据是「最…?20 秒有 session 写入」，而这个程序自己就挂在
    // 丢…个一直在干活的会话上 …?结果 thinking 永远…?true，降载永远不触发…?
    // 实测空转 134% 单核。thinking 只该影响表情和姿态，不该决定渲染精度…?
    // 她在「想事情」的时…又不需…?60fps 的高清画靃6…9…?
    const idleFor = Date.now() - lastMoveAt;
    const calm = !dragging && !working && idleFor > 8000;
    tick._n = (tick._n || 0) + 1;
    tick._calm = calm;
    const wantFps = calm ? Math.min(15, fpsCap) : fpsCap;
    if (app.ticker.maxFPS !== wantFps) app.ticker.maxFPS = wantFps;
    tick._ran = (tick._ran || 0) + 1;
    const _t0 = performance.now();

    // 空闲降分辨率…?x…?1x。像素少四…渲染弢…锢…跟着掉…?
    // 有人碰她（calm…?false）立刻升回设置里的档位，扢…以看得出来的时…永远是清晰的…?
    if (tick._resPending === undefined) tick._resPending = 0;
    const wantRes = calm ? 1 : baseResolution;
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

    // 设置里关掉…跟随鼠标…时，把鼠标输入归零，只留呼吸与自漂…?
    const gxUse = followCursor ? gx : 0;
    const gyUse = followCursor ? gy : 0;

    const target = {
      yaw: thinking ? 2.2 + drift2 * 1.2 : working ? 1.5 + drift * 2.4 : (away ? -6 : gxUse * 4.2) + drift * 2.0,
      pitch: thinking ? -4 + drift * 0.8 : working ? -8 + drift2 * 3.6 : (away ? 4 : -gyUse * 5.0) + drift2 * 2.2,
      roll: thinking ? -1.6 + drift2 * 1.1 : working ? -2.5 + drift * 1.7 : drift * 1.8,
      body: (away ? 0.4 : gxUse * 1.2) + drift * 0.9,
      gazeX: gxUse * (0.9 - Math.abs(gxUse) * headShare) + sacX,
      // 眼球和头用同丢…?gyUse，方向必须一致地取反…?
      // clientY 向下为正，…?ParamEyeBallY / ParamAngleY 都是「正 = 向上」…?
      // 之前头部写了 -gyUse、眼球漏了负号，于是鼠标徢…上她眼球反…往下翻…?
      gazeY: -gyUse * (0.9 - Math.abs(gyUse) * headShare) + sacY,
      blink: 0,
      squint: 0,
    };
    lastTarget = target;

    if (away) { target.gazeX = -0.55 + sacX; target.gazeY = 0.35 + sacY; }

    // 按住不放超过 1.2 秒…又没在拖：她该抗议了…只抗议丢…次，别一直念…?
    if (dragging && pressAt && !pressComplained && dragMoved < 3 &&
        Date.now() - pressAt > 1200) {
      pressComplained = true;
      say(FishLines.pick("press.long"));
      setExpr("sad", 1200);
    }

    // 被拎起来的时候：身体徢…甩的反方向荡，头跟不上，重心徢…下沉…?
    // 没有这段她就像一张贴纸，跟着窗口平移而已…?
    // 松手之后余…还在（fling），让她多荡两下再停…不然手指一松就僵住，像断了线…?
    if (dragging || fling > 0.4) {
      const vx = Math.max(-30, Math.min(30, dragVX));
      const vy = Math.max(-30, Math.min(30, dragVY));
      target.roll += -vx * 0.5;
      target.body += -vx * 0.34;
      target.yaw += vx * 0.22;
      target.pitch += vy * 0.28 + (dragging ? 2.2 : 0);
      // 甩得快的时…会有点…?
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
        // 摸头朢…弢…心：第一下脸红，连摸几下会笑出来
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
      let info = null;
      try { info = window.FishPet && FishPet.actInfo && FishPet.actInfo(); } catch (e) { }
      if (info && !activity) {
        activity = { id: info.id, name: info.name, scene: info.scene, since: Date.now() };
        try { setExpr(ACT_EXPR[info.id] || "default-body", 0); } catch (e) { }
        try { FishModel.actionFor(info.scene); } catch (e) { }
      } else if (!info && activity) {
        // 活动做完了但面板没开着（没有广播可收）：自己收尾。
        activity = null;
        try { setExpr("default-body", 0); FishModel.actionFor("actDone"); } catch (e) { }
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
      // 呼吸的同时偶尔来丢…个真的小动作（走动作库，幅度更明确）
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
        // 只剩「呼吸…这丢…种了，别的都搬到 motions.js（见上面那段注释…?
        target.body += 1.1 * env;
        target.pitch -= 0.8 * env;
      }
    }

    // 缓动
    // 不同通道给不同时间常数，这是"像活…?…?像机器人"的分界线…?
    //   眼睛朢…快（0.09s）：真人看到东西是一瞬间扫过去的，眼睛先…?
    //   头颈次之…?.22s）：头是"跟着…?的，永远慢眼睛半…?
    //   身体朢…慢（0.55s）：重心转移，几乎察觉不…?
    // 眨眼单独 0.035s，因为眼睑动作本来就快到看不清过程…?
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

    // 眨眼（设置里关掉就保持睁眼，不给随机触发…?
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

    // 口型：以前跟睢…thinking 相位走，但独立程序里"DSH 在写文件"几乎
    // 每时每刻都为真，结果她嘴巴一直在弢…合，像在自言自语…?
    // 改成只在"刚被摸过"…?打哈…?的短窗口里动，其余时间闭嘴…?
    const talk = petAge < 0.9; // 没摸过时 petAt=0，petAge 是个极大的数，自然为 false
    if (talk) mouth += 0.55; else mouth = 0;
    const talkOpen = talk ? 0.42 * (0.5 + 0.5 * Math.sin(mouth)) * Math.max(0, 1 - petAge / 0.9) : 0;
    // 说话时的嘴型：只有刚被摸过的…?0.9 秒会弢…合一下…?
    // 打哈欠的嘴张合现在由 motions.js…?yawn 曲线直接…?ParamMouthOpenY…?
    // 不再霢…要这里叠加一…?env（那个变量已经删了）…?
    const open = Math.min(1, talkOpen);

    pending = {
      yaw: mv.yaw, pitch: mv.pitch, roll: mv.roll, body: mv.body,
      gazeX: mv.gazeX, gazeY: mv.gazeY,
      blink: mv.blink, blinkVal, squint: mv.squint || 0,
      mouth: open, elapsed,
    };

    maybeIdleTalk();
  };

  // ---------- 鼠标（来自主进程的全屢…坐标…?----------
  let lastCx = -99999, lastCy = -99999;
  window.deskfish.onCursor((p) => {
    const cx = p.wx + p.w / 2;
    const cy = p.wy + p.h / 2;
    const range = Math.max(300, Math.min(p.w, p.h) * 0.45);
    tx = Math.max(-1, Math.min(1, (p.x - cx) / range));
    ty = Math.max(-1, Math.min(1, (p.y - cy) / range));
    // 主进程是 30fps 持续推坐标的，鼠标不动也丢…直在推…?
    // 只有坐标真的变了才算「主人动了一下…否则 idle 永远算不出来…?
    if (p.x !== lastCx || p.y !== lastCy) {
      lastCx = p.x; lastCy = p.y;
      lastMoveAt = Date.now();
    }
  });

  // ---------- 点击 / 拖动 ----------
  // 同一个左键手势：位移超过 4px 算拖窗口，否则松手时…?摸她"…?
  // 位移全程交给主进程算（渲染进程的 screenX 跨屏会跳变）…?
  let dragging = false, dragMoved = 0;
  // 拖动惯…：被拎睢…走的时…身体该有点滞后感，不然像个贴纸…?
  let dragVX = 0, dragVY = 0, dragHeldAt = 0;

  // ---------- 右键…?设置 ----------
  window.addEventListener("contextmenu", (ev) => {
    ev.preventDefault();
    window.deskfish.openSettings();
  });

  // UI 控件（语音按钮…气泡…重试按钮）上的按下不启动拖动，
  // 否则手一抖窗口就被拖走，按钮跟着跑…click 落空…?
  const isUiTarget = (el) => {
    let n = el;
    while (n && n !== document.body) {
      if (n.id === "fish-voice" || n.id === "bubble" || n.id === "fish-retry" || n.id === "err") return true;
      // 底部对话面板：整块都不算「拖窗口」的区域，否则点输入框会变成拖窗…?
      if (n.id === "dock") return true;
      n = n.parentElement;
    }
    return false;
  };

  window.addEventListener("pointerdown", (ev) => {
    if (ev.button === 2) { ev.preventDefault(); window.deskfish.openSettings(); return; }
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
    // 记一下这丢…下甩得多快，tick 里拿它做惯…被拎起来应该会…?
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
    // 甩出去：把最后一刻的速度记下来，tick 里让它自己衰减几…?
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

    // 落点按…模型在画布上的真实范围」算，不是按画布比例…?
    // 踩过：用 fy < 0.34 / 0.66 切画布，可模型顶部只到画…?23.8%（上面一段…明），
    // 于是点脸的位置（y…?00）越…?0.66×560=370 被判成…点身体」…?
    // 主人反馈「点头反而像点胸」就是这个…窗口一缩放比例还会变，扢…以必须动态算…?
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

    // 双击…?…?，跟单击…?…?不是丢…回事：反应更大…表情更夸张，不进连击计…?
    if (ev.detail >= 2) {
      const now2 = Date.now();
      tapAt = now2;
      petAt = now2;
      petDir = Math.random() < 0.5 ? 1 : -1;
      tx = Math.max(-1, Math.min(1, (ev.clientX - (rect.left + rect.width / 2)) / Math.max(120, rect.width * 0.55)));
      ty = Math.max(-1, Math.min(1, (ev.clientY - (rect.top + rect.height / 2)) / Math.max(120, rect.height * 0.55)));
      lastMoveAt = now2;
      setExpr("happy", 1800);
      say(FishLines.pick("pet.double"));
      // 双击…?被戳到了"，给丢…个幅度最大的反应
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

    // 手写动作跟着点击走…放…?say() 前面：say() 万一因为气泡元素出问题抛异常…?
    // 动作不该跟着丢…起断。combo 越高动作…?濢…?…?
    try {
      FishModel.actionFor(petCombo >= 3 ? "more" : ("pet" + petZone.charAt(0).toUpperCase() + petZone.slice(1)));
    } catch (e) { console.warn("[fish] action 失败: " + e.message); }

    // 台词…?lines.js 的语訢…池里取，不在这里写死
    const key = petCombo >= 3 ? "pet.more" : "pet." + petZone;
    say(FishLines.pick(key));
    // 点击不插语气词了（2026-11-06 主人：「太奇怪了」）——
    //  FishVoice.chirp 那套还留着，想恢复只要在这加一行 window.FishVoice.chirp(...)
  });

  // ----------…?DSH 读状…?----------
  // 主进程扫 session 文件的写入时间，判断 DSH 到底在不在干…?
  let wasBusy = false;

  // 测试通道：主进程发一…?假装听到的话"，走完整语音后半…?
  if (window.deskfish.onTestVoice) {
    window.deskfish.onTestVoice((text) => {
      if (window.FishVoice && window.FishVoice.__testSay) window.FishVoice.__testSay(text);
    });
  }
  // Ctrl+Alt+S：手动播丢…次伸懒腰。调动作时用，平时它自己随机出现…?
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
  // 飞鱼冷启动要 20 多秒加载模型。这期间先说丢…句，别让她看睢…像死了…?
  if (window.deskfish.onTtsWaiting) {
    window.deskfish.onTtsWaiting((text) => {
      try { say(text || "等一下……我在准备声音。", null, 26000); } catch (e) { }
    });
  }
  window.deskfish.onDshActivity((p) => {
    const busy = !!(p && p.state === "busy");
    dshPhase = busy ? "thinking" : "idle";
    if (busy) phase = "thinking";
    else if (phase === "thinking") phase = "idle";

    // 只在状…?跳变"时说丢…句，别每 2 秒都念一…?
    if (busy && !wasBusy) {
      if (Math.random() < 0.5) say(FishLines.pick("dsh.thinking"));
      // 弢…始干活了：想事情的表情配想事情的动作
      try { FishModel.action("think"); } catch (e) { }
    } else if (!busy && wasBusy) {
      say(FishLines.pick("dsh.done"));
      // 干完了：点头，像在说"弄好…?
      try { FishModel.action("nod"); } catch (e) { }
    }
    wasBusy = busy;
  });

  // 丢…个人待着的时候偶尔自訢…自语，但别太吵…?
  // 用函数声明…不…?const：tick 在上面就调它了，…?hoisting 才安全…?
  let nextIdleTalk = Date.now() + 45000 + Math.random() * 60000;
  function maybeIdleTalk() {
    if (Date.now() < nextIdleTalk) return;
    if (dshPhase === "thinking" || phase === "thinking") return;
    if (dragging) return;
    let key;
    if (Date.now() - lastMoveAt > 120000) {
      // 安静两分钟以上，她就弢…始惦记了
      key = "longIdle";
    } else {
      // 平时按状态挑：饿了说饿…好感低说孤单…周末有周末的话
      const pet = (window.FishPet && window.FishPet.snapshot) ? window.FishPet.snapshot() : null;
      key = FishLines.stateKey(pet);
      // 偶尔换成「主动搭话…那丢…组，不然老是同一种语…?
      if (Math.random() < 0.22) key = "ping";
    }
    say(FishLines.pick(key));
    // 丢…个人待着时的动作：只给幅度小的那几个（想事情、叹气…歪头）…?
    // 这几下不要每次都播，三次里挑丢…次就够…她安静坐着的时候不该…在动…?
    if (Math.random() < 0.34) {
      try { FishModel.actionFor("idle"); } catch (e) { }
    }
    nextIdleTalk = Date.now() + 70000 + Math.random() * 120000;
  }

  // 手机端那边忙不忙…?899…?CORS，直接读…?
  const pollDsh = () => {
    fetch("http://127.0.0.1:8899/api/health", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (j && (j.busy === true || Number(j.queued) > 0)) phase = "thinking";
      })
      .catch(() => {});
  };
  setInterval(pollDsh, 8000);

  // 设置变了：只改渲染，不在这里反向覆盖设置本身
  window.deskfish.onSettingsChanged((s) => {
    // 取景不再从设置里来：改取景请走适配器（保存后会触发 pack-changed 重载）。
    // 这里只保留「保存过适配器配置」的轻量重排，避免别的设置一改就把布局抖一下。

    try { if (s && window.FishVoice && window.FishVoice.setDevice) window.FishVoice.setDevice(s.micDevice || ""); } catch (e) { }
    try { if (s && window.FishVoice) { if (window.FishVoice.setWarm) window.FishVoice.setWarm(s.voiceWarm === true); if (window.FishVoice.setVoiceId) window.FishVoice.setVoiceId(s.voiceId || ""); if (window.FishVoice.setVoiceOut) window.FishVoice.setVoiceOut(s.voiceOut || "tts", s.rvcPitch || 0); } } catch (e) { }
    // 回复模型：DSH 还是自定…?API。两边配置分弢…传，切换…?voice.js 自己会清历史…?
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

  // ---------- 启动（带兜底…?---------
  // 丢…次失败不等于坏掉：先重试丢…次，还不行就降级（关锐化/降采样）再试…?
  // 全都不行才把错误显示出来，并给一…?重试"按钮…?
  // resolution / sharpen 丢…律以设置为唯丢…来源，避…?启动…?2、设置里…?1"互相覆盖…?
  const bootSafe = async () => {
    // 模型包配置要在读设置之前拿到：取景矩形要不要用设置里存的那份，得看
    // 那份是不是给这台模型调的（见下面 viewBox 的 pack 标记）。
    PACK = await loadPack();
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
    fail("模型没能启动" + (lastError && lastError.message ? "\n" + lastError.message : ""));
    showRetry();
  };

  // 模型包在别处被换了/删了（适配器窗口、删包接口）：整页重载最干净 ——
  // 换模型等于换一整套贴图、参数索引和动作路由，增量改比重载更容易漏。
  if (window.deskfish && window.deskfish.onPackChanged) {
    window.deskfish.onPackChanged(() => { location.reload(); });
  }

  bootSafe();
})();
