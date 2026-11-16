// 大肥鱼 · 语音链路
//
// 一条完整的往返：
//   麦克风 → 自动检测说话（VAD）→ 录音 → /api/asr-legacy 转文字
//   → /api/send 发进 DSH 当前会话 → 轮询 /api/state 等回复
//   → 气泡显示 → /api/tts 合成 → 播放
//
// 全部走 phone-bridge（127.0.0.1:8899），不碰 DSH 本体的 cookie。
// 两个坑写在前面，省得后面再踩：
//   1. /api/asr 已经下线（410），只有 /api/asr-legacy 能用；
//   2. bridge 没做 OPTIONS 预检，所以发 JSON 必须用 text/plain，
//      否则浏览器直接拦掉，服务端根本收不到。

(function () {
  // 桥接地址：默认本机 phone-bridge，可在设置里改成别的机器的地址。
  // 用 let 而不是 const —— 设置改了要能换过去，不必重启。
  // 默认就是 phone-bridge 的 8899：程序不再自带迷你桥接，只认外部这一个。
  // settingsGet() 是异步的，语音可能在它回来之前就开始录音，
  // 所以这里的默认值必须和设置里的默认端口是同一个数，不能各写各的。
  let BASE = "http://127.0.0.1:8899";

  // ── 回复走哪个模型 ───────────────────────────────────────────
  // "dsh"  = 走桥接（大肥鱼接的是 DSH 的会话，能看到工具、能改文件）
  // "api"  = 走用户自己填的 OpenAI 兼容接口（换电脑也能用，不依赖 DSH）
  let replyMode = "dsh";
  let apiBase = "";
  let apiKey = "";
  let apiModel = "";
  // API 模式的对话历史。DSH 那边自己会存，API 这边得我们记着，
  // 否则她每次都是第一次见主人。只留最近 20 条，别把上下文撑爆。
  let apiHistory = [];
  const API_HISTORY_MAX = 20;
  const API_SYSTEM = "你是大肥鱼，一只住在主人电脑上的蓝色小龙女仆。"
    + "说话语气亲近、有点傲娇、偶尔带点小脾气的口语，不要客套不要长篇大论，"
    + "一般一两句话就够，不要用 markdown，不要罗列条目。";

  function setReplyMode(v) {
    const m = (v === "api") ? "api" : "dsh";
    if (m === replyMode) return;
    replyMode = m;
    // 两种模式的对话是两本账，切换时清空历史，免得串味
    apiHistory = [];
    log("回复模式切到 " + replyMode);
  }

  function setApiConfig(o) {
    if (!o) return;
    if (typeof o.apiBase === "string") apiBase = o.apiBase.trim().replace(/\/+$/, "");
    if (typeof o.apiKey === "string") apiKey = o.apiKey;
    if (typeof o.apiModel === "string") apiModel = o.apiModel.trim();
  }
  function setBridgeUrl(u) {
    const v = String(u || "").trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(v)) return;
    if (v === BASE) return;
    BASE = v;
    token = null;           // token 是每台桥接自己的，换地址必须重取
    log("桥接地址切到 " + BASE);
  }
  // 启动时读一次；之后跟着设置变
  try {
    if (window.deskfish && window.deskfish.settingsGet) {
      window.deskfish.settingsGet().then((st) => {
        if (st && st.bridgeUrl) setBridgeUrl(st.bridgeUrl);
      }).catch(() => { });
    }
    if (window.deskfish && window.deskfish.onSettingsChanged) {
      window.deskfish.onSettingsChanged((st) => {
        if (st && st.bridgeUrl) setBridgeUrl(st.bridgeUrl);
      });
    }
  } catch (e) { }
  const SILENCE_MS = 1100;   // 静音多久算说完
  const MIN_MS = 550;        // 短于这个不算一句话（咳嗽、键盘声）
  const MAX_MS = 30000;      // 再长就掐掉，别一直录
  const VAD_MIN = 0.012;     // 动态阈值下限（0–1）
  const VAD_MAX = 0.12;      // 动态阈值上限：校准期有人在说话时兜底
  const VAD_RATIO = 2.2;     // 阈值 = 底噪 * 这个倍数
  const CALIB_MS = 1200;     // 开麦后先测这么久的底噪

  let token = null;
  let enabled = false;
  // 静音：只拦「出声」这一步。语音识别、对话、气泡都照常，
  // 所以开会时静音不等于把她关掉。
  let muted = false;
  // 语音音量 0–1；静音是独立开关，取消静音后恢复到这里的值。
  let volume = 0.85;
  // 上次按语音键的时刻。1.6 秒内再按 = 强制关（跳过打断/取消这些拦截）
  let lastToggleAt = 0;
  // 正在开麦的过程中，用于挡住连点
  let enabling = false;
  // 上一次拿麦克风失败的原因（null = 没失败过）。设置页与诊断包都读它。
  // 为什么单独存一份：DOMException 一过手就只剩 message，用户看不懂，
  // 而「权限没给 / 没设备 / 被占用」对应的处置完全不同，必须留住 code。
  let lastMicError = null;
  function micErrText(e) {
    const lib = window.__fishMicErr;
    if (lib && typeof lib.micErrText === "function") return lib.micErrText(e);
    return {
      code: "other",
      short: "麦克风打不开…",
      detail: "没能打开麦克风。换一个输入设备试试；还不行就重启程序。",
      name: (e && e.name) || "",
      message: String((e && e.message) || (typeof e === "string" ? e : "") || ""),
    };
  }
  // 上一次「说话」整条链都没出声的原因（null = 没失败过）。
  // speak() 有五级降级：飞鱼 → 分段流式 → RVC → 内置引擎 → DSH。
  // 每一级失败都往下试，全挂了才 return false —— 那时用户什么也听不到，
  // 所以必须把「第一条链为什么不行」留住，让调用方说一句人话。
  let lastSpeakError = null;
  // 把失败报给主进程存一份：界面上的提示会随气泡消失，内存里的 lastSpeakError
  // 会随重启消失，而排障要的是「几小时前那次为什么不行」。
  function reportFault(kind, err) {
    try {
      if (!err || !window.deskfish || typeof window.deskfish.reportFault !== "function") return;
      window.deskfish.reportFault({
        kind,
        code: err.code || "",
        short: err.short || "",
        detail: err.detail || "",
        raw: err.raw || "",
        at: Date.now(),
      });
    } catch (e) { }
  }
  // 这一轮「等她回复」有没有出问题：null = 正常，{code:"partial"|"stalled"} 见 waitReply。
  // 半截和最坏一眼的区别：半截是「她说到一半」，最坏是「一个字也没等到」。
  let lastReplyIssue = null;

  // ── 「你选的引擎没出声」必须说出来 ────────────────────────
  // 以前：飞鱼没装好、显存不够、进程崩了，服务端只往日志写一行就悄悄换成
  // Edge TTS。用户听到的是另一个声线，却以为自己选的就是这个声音 ——
  // 这不是「降级优雅」，是骗人。现在 /engine/tts 把原因一起回传（fellBack），
  // 这里负责三件事：记日志、进故障表（诊断页/诊断包里能看到）、用她的口吻说明。
  // 同一条原因 5 分钟内只打扰一次：聊十句弹十次气泡，比不说还烦。
  const FALLBACK_QUIET_MS = 5 * 60 * 1000;
  const fallbackSaidAt = Object.create(null);
  let lastFallback = null;   // 给诊断面板读的「最近一次是谁在替我说话」

  function fallbackHuman(fb) {
    const from = (fb && fb.from) || "";
    const who = from === "xtts" ? "XTTS" : from === "feiyu" ? "飞鱼" : "你选的那个声音";
    const raw = String((fb && fb.reason) || "");
    let why = "这会儿没起来";
    if (/环境不全/.test(raw)) why = "本机还没装齐";
    else if (/CUDA|out of memory|显存|OOM/i.test(raw)) why = "显卡挤不出显存";
    else if (/not found|ENOENT|no such file|找不到/i.test(raw)) why = "它的文件找不到";
    else if (/timeout|timed out|超时|ETIMEDOUT/i.test(raw)) why = "它回得太慢，我没等住";
    else if (/ECONNREFUSED|没连上|fetch failed|ECONNRESET/i.test(raw)) why = "它的服务没连上";
    return { who, why, raw };
  }

  function noteFallback(j, where) {
    const fb = j && j.fellBack;
    if (!fb) return;
    const h = fallbackHuman(fb);
    const engineNow = String((j && j.engine) || "tts");
    const key = String(fb.from || "?") + "|" + h.why;
    const now = Date.now();
    lastFallback = { from: fb.from || "", reason: h.raw, who: h.who, why: h.why, engine: engineNow, at: now };
    log("回落：" + h.who + " → " + engineNow + "（" + h.raw + "）" + (where ? " @" + where : ""));

    // 故障表：只记「真的换了人」这一档，而且按原因去重，
    // 免得一次聊天把整张表刷满同一条。
    if (!fallbackSaidAt[key]) {
      reportFault("voice-fallback", {
        code: "fallback-" + (fb.from || "engine"),
        short: h.who + "没出声，换成 " + engineNow,
        detail: h.who + " 这次" + h.why + "，这句话是用 " + engineNow + " 念的。"
          + "检查：设置 → 声音与行为 → 变声引擎，看引擎状态和「一键启动」；"
          + "还不行就点诊断，里面有这个引擎的完整记录。",
        raw: h.raw,
      });
    }
    if (fallbackSaidAt[key] && now - fallbackSaidAt[key] < FALLBACK_QUIET_MS) return;
    fallbackSaidAt[key] = now;
    try {
      if (window.FishSay) {
        window.FishSay(h.who + "还没起来——" + h.why + "，这句先借内置的声音替我说。", "sad", 5200);
      }
    } catch (e) { }
  }

  // 上一次读 /api/state 有没有成功拿到基线。读不到时 since 会是 0，
  // 拿它当基准 = 把历史里任何一条 assistant 消息都当成「新回复」念出来。
  let snapOk = false;
  function voiceErrText(e) {
    const lib = window.__fishVoiceErr;
    if (lib && typeof lib.voiceErrText === "function") return lib.voiceErrText(e);
    return {
      code: "other",
      short: "说话出了点问题",
      detail: "打开「设置 → 导出诊断包」发给开发者，里面有完整日志。",
      raw: String((e && e.message) || e || ""),
    };
  }
  let btn = null;
  let stream = null;
  let ctx = null;
  let analyser = null;
  let recorder = null;
  let chunks = [];
  let speaking = false;
  let lastVoiceAt = 0;
  let recStart = 0;
  let rafId = 0;
  let busy = false;
  let vadThreshold = VAD_MIN;   // 由底噪算出来
  let preferredDeviceId = "";   // 用户在设置里选的麦克风（空 = 系统默认）
  let calibrating = false;
  let calibSamples = [];
  let levelPeak = 0;
  let levelLogAt = 0;

  const log = (m) => console.log("[voice] " + m);

  // 把技术错误翻译成人话。用户看到的应该是「连不上」，
  // 不是「Failed to fetch」——后者除了让人一头雾水没有任何用。
  function humanErr(e) {
    const m = String((e && e.message) || e || "");
    if (/Failed to fetch|NetworkError|ERR_CONNECTION|ERR_NAME/i.test(m)) {
      // 带上当前地址：主人照着这一句就能看出是端口写错了还是桥没起。
      const port = (BASE.match(/:(\d+)/) || [])[1] || "";
      return port ? "连不上 DSH（" + port + " 没应答），设置里点「自检并修复」" : "连不上 DSH，检查一下桥接地址";
    }
    if (/AbortError|timeout|timed out/i.test(m)) return "那边太久没应，可能卡住了";
    if (/拿不到 token|拿不到 bridge 地址/.test(m)) return "桥接没给出凭证，地址可能填错了";
    if (/send 没成功/.test(m)) return "话没送出去，看看 DSH 那边还连着没";
    return m.slice(0, 40) || "出了点问题";
  }

  // 通知底部面板（dock.js）。dock 可能还没加载，所以每次都现查，不缓存引用。
  function noti(name, arg, extra) {
    try {
      const d = window.FishDock;
      if (d && typeof d[name] === "function") d[name](arg);
    } catch (e) { }
    // 对话记录：底部面板只留 40 行、关掉语音就看不见，所以另外落一份盘。
    // 「你说」不记，只记真正发出去的那一句——语音识别的原文和后处理结果
    // 经常不一样，两条都记会让她看起来像在自言自语。
    // extra 用来带 {id}：流式回复用同一个 id 反复更新同一条记录，
    // 最后再落一次定稿，记录窗口里看到的就是「越长越长的同一句话」。
    try {
      const desk = window.deskfish;
      if (!desk || !desk.chatAppend) return;
      if (name === "onSent" && arg) desk.chatAppend({ role: "user", text: String(arg) });
      else if (name === "onHerReply" && arg) {
        desk.chatAppend(Object.assign({ role: "assistant", text: String(arg) }, extra || {}));
      }
    } catch (e) { }
  }

  // ---------- 工具 ----------
  async function getToken() {
    if (token) return token;
    const r = await fetch(BASE + "/api/health", { cache: "no-store", signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    const u = j && j.addresses && j.addresses[0] && j.addresses[0].urlFull;
    if (u) token = new URL(u).searchParams.get("t");
    if (!token && j && j.token) token = String(j.token);
    // 老版 phone-bridge 的 health 故意不回令牌（怕把钥匙挂在门外），
    // 令牌存在本机的 state.json 里，让主进程读出来给这里用。
    if (!token && window.deskfish && window.deskfish.bridgeToken) {
      try { token = await window.deskfish.bridgeToken(); } catch (e) { }
    }
    if (!token) throw new Error("拿不到 token");
    return token;
  }

  // 桥接的 HTTP 服务一起来就能收消息：/api/send 会先把消息排进队列，
  // 等里面的 DSH 会话建好再跑，不会像旧版那样安静丢掉。
  // 所以这里只等「桥接进程在」，不再等 sessionId——那是以前的 75 秒冤枉路。
  async function waitBridgeReady(maxMs) {
    const limit = maxMs || 12000;
    const t0 = Date.now();
    let told = false;
    while (Date.now() - t0 < limit) {
      try {
        const r = await fetch(BASE + "/api/health", { cache: "no-store", signal: AbortSignal.timeout(5000) });
        const j = await r.json();
        if (j && j.ok) return true;
        if (!told) {
          told = true;
          log("桥接还没起来，等一等");
          try { if (window.FishSay) window.FishSay("等我一下，我刚醒……", null, 4000); } catch (e) { }
        }
      } catch (e) { /* 桥接本身还没起来，继续等 */ }
      await new Promise((r) => setTimeout(r, 600));
    }
    log("等桥接超时 " + limit + "ms，仍然放行");
    // 兜一层：主进程知道自带桥在哪。地址被写错（比如还留着外部 phone-bridge 的 8899）时，
    // 这里主动要一次可用地址再试 3 秒 —— 别把「地址写错了」变成「一句话都没发出去」。
    try {
      if (window.deskfish && window.deskfish.bridgeEnsure) {
        const r = await window.deskfish.bridgeEnsure({});
        const base = String((r && r.base) || "").trim();
        if (base) setBridgeUrl(base);
        if (r && r.ok) {
          const t1 = Date.now();
          while (Date.now() - t1 < 3000) {
            try {
              const rr = await fetch(BASE + "/api/health", { cache: "no-store", signal: AbortSignal.timeout(2500) });
              const jj = await rr.json();
              if (jj && jj.ok) {
                log("换到可用桥接 " + BASE + "（" + (r.note || "") + "）");
                return true;
              }
            } catch (e) { }
            await new Promise((r2) => setTimeout(r2, 400));
          }
        }
      }
    } catch (e) { }
    return false;
  }

  // 地址不通时向主进程要一次可用地址：它会探原地址、必要时把随身桥接拉起来。
  // 换成了就返回新地址，换不了返回空串（调用方据此决定要不要报错）。
  async function healBridgeBase(why) {
    try {
      const api = window.deskfish || {};
      if (!api.bridgeEnsure) return "";
      const r = await api.bridgeEnsure({});
      const base = String((r && r.base) || "").trim().replace(/\/+$/, "");
      if (!r || !r.ok || !base) return "";
      const from = BASE;
      if (base === from) return base;
      setBridgeUrl(base);
      log("换个地址再试：" + from + " → " + base + "（" + (r.note || why || "") + "）");
      try {
        if (window.FishSay) window.FishSay("原来那个地址没应答，我改走随身桥接了", null, 3800);
      } catch (e) { }
      return base;
    } catch (e) {
      return "";
    }
  }

  // 用 text/plain 发 JSON：不触发 CORS 预检（bridge 没处理 OPTIONS）
  async function postJson(path, body, _retried, _healed) {
    const t = await getToken();
    let r;
    try {
      r = await fetch(BASE + path + "?t=" + encodeURIComponent(t), {
        method: "POST",
        headers: { "content-type": "text/plain;charset=UTF-8" },
        body: JSON.stringify(body),
        // 没有超时的 fetch 会把 busy 永远卡在 true：桥接那边一卡，
        // 之后按什么按钮都没反应，看着就像程序死了。
        signal: AbortSignal.timeout(20000),
      });
    } catch (e) {
      // 地址写得不对、或者桥换了端口：自愈一次再送一遍，别让一句话就此丢掉。
      if (!_healed && !/AbortError|timeout/i.test(String((e && e.message) || e))) {
        const b = await healBridgeBase("发消息时连不上");
        if (b) return postJson(path, body, _retried, true);
      }
      throw e;
    }
    // 桥接重启会换一把 token：401 说明手上这个是旧的。清掉重取一次，
    // 否则用户得自己去设置里动一下地址才能恢复，看着就像程序坏了。
    if (r.status === 401 && !_retried) {
      token = null;
      return postJson(path, body, true, _healed);
    }
    return r.json();
  }

  async function postAudio(blob) {
    const t = await getToken();
    // 用 ArrayBuffer 而不是 Blob：Electron 里跨 origin 发送 Blob 有时会
    // 在 fetch 层直接失败，报一个没有任何细节的 "Failed to fetch"。
    let body;
    try {
      body = await blob.arrayBuffer();
    } catch (e) {
      log("读录音失败: " + (e && e.message ? e.message : e));
      throw e;
    }
    // ① 先试程序自带的引擎（同源，没有 CORS 预检问题）
    try {
      const r0 = await fetch("/engine/asr?ext=webm&t=" + encodeURIComponent(t), {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body,
        // 识别要跑 whisper，比普通接口慢得多，给足 120 秒；
        // 但仍然要有上限，否则 whisper 卡住时 busy 会一直不释放。
        signal: AbortSignal.timeout(120000),
      });
      if (r0.ok) {
        const j0 = await r0.json();
        if (j0 && j0.ok && typeof j0.text === "string") {
          log("内置识别 " + (j0.ms || "?") + "ms（" + body.byteLength + " 字节）");
          return j0;
        }
        log("内置识别返回异常: " + JSON.stringify(j0).slice(0, 120));
      } else {
        // 400 = 这条录音本身不合格（太短 / 没声音 / 上一条还在认）。
        // 这不是引擎故障，回落也救不回来，还会把真原因盖掉——直接把话说给调用方。
        let j0 = null;
        try { j0 = await r0.json(); } catch (e) { }
        const why = (j0 && j0.error) || ("HTTP " + r0.status);
        if (r0.status === 400) {
          log("内置识别拒绝这条录音: " + why);
          return { ok: false, error: why, badInput: true };
        }
        log("内置识别 HTTP " + r0.status + "（" + why + "），回落 phone-bridge");
      }
    } catch (e) {
      log("内置识别不可用（" + (e && e.message ? e.message : e) + "），回落 phone-bridge");
    }

    // ② 回落：phone-bridge
    const url = BASE + "/api/asr-legacy?t=" + encodeURIComponent(t);
    let r;
    try {
      r = await fetch(url, {
        method: "POST",
        headers: {
          // 必须是 text/plain：application/octet-stream 会触发 CORS 预检，
          // 而 phone-bridge 没处理 OPTIONS，预检直接失败。
          "content-type": "text/plain",
          "x-audio-ext": "webm",
        },
        body,
        signal: AbortSignal.timeout(120000),
      });
    } catch (e) {
      log("ASR 请求失败: " + (e && e.message ? e.message : e) +
          " | url=" + url.slice(0, 60) + " | bytes=" + body.byteLength);
      throw e;
    }
    if (r.status === 401) {
      // 同一个理由：桥接换了凭据。重取一次再发，别把录音白扔了。
      token = null;
      const t2 = await getToken();
      r = await fetch(BASE + "/api/asr-legacy?t=" + encodeURIComponent(t2), {
        method: "POST",
        headers: { "content-type": "text/plain", "x-audio-ext": "webm" },
        body,
        signal: AbortSignal.timeout(120000),
      });
    }
    log("ASR 响应 " + r.status + " (" + body.byteLength + " 字节已发)");
    const j = await r.json().catch(() => null);
    if (!r.ok) {
      // 这条通道（phone-bridge 的 /api/asr-legacy）已经不存在了，404 是常态。
      // 说清楚，别让它看起来像「识别没出结果」这种模糊现象。
      const why = (j && j.error) || ("HTTP " + r.status);
      log("回落通道不可用: " + why + " —— 录音 " + body.byteLength + " 字节没能转成文字");
      return { ok: false, error: why };
    }
    return j || { ok: false, error: "空响应" };
  }

  // ---------- VAD + 录音 ----------
  // 复用同一块缓冲：原来每帧 new 一个 Uint8Array，60fps 下等于一直往堆里扔垃圾，
  // 长时间开着语音（比如挂一整天）会看到 GC 周期越来越密。
  let levelBuf = null;
  function level() {
    if (!analyser) return 0;
    if (!levelBuf || levelBuf.length !== analyser.fftSize) {
      levelBuf = new Uint8Array(analyser.fftSize);
    }
    const buf = levelBuf;
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i += 1) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    return rms;
  }

  function startRecorder() {
    if (recorder) return;
    chunks = [];
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    recorder = new MediaRecorder(stream, { mimeType: mime });
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      recorder = null;
      handleAudio(blob);
    };
    recStart = Date.now();
    recorder.start();
    log("开始录音");
  }

  function stopRecorder() {
    if (!recorder) return;
    const ms = Date.now() - recStart;
    try { recorder.stop(); } catch (e) { }
    log("停止录音 " + ms + "ms");
  }

  // 开麦后先收 1.2 秒，取 90 分位当底噪。人不可能一直说话，所以底噪里
  // 混进一两声也影响不大；乘 2.2 倍留出余量。
  function startCalibration() {
    calibrating = true;
    calibSamples = [];
    setTimeout(() => {
      calibrating = false;
      if (!calibSamples.length) return;
      const sorted = calibSamples.slice().sort((a, b) => a - b);
      const noise = sorted[Math.floor(sorted.length * 0.9)] || 0;
      // 阈值要有上限：校准那 1.2 秒里如果正好有人在说话（或者按钮刚点开就开口），
      // 量出来的「底噪」其实是说话声，算出来的阈值会高到永远过不了线——
      // 表现就是「按钮开了但说什么都没反应」。封顶 0.12 能兜住这种情况。
      vadThreshold = Math.min(VAD_MAX, Math.max(VAD_MIN, noise * VAD_RATIO));
      log("底噪 " + noise.toFixed(4) + " 阈值 " + vadThreshold.toFixed(4));
    }, CALIB_MS);
  }

  function tick() {
    if (!enabled) return;
    // rAF 必须先排队再干活：函数里任何一处提前 return 都会把循环掐死。
    // （之前校准分支 return 掉，整个 tick 只跑了一帧，电平永远是第一帧的 0。）
    rafId = requestAnimationFrame(tick);
    const lv = level();
    const now = Date.now();

    if (calibrating) { calibSamples.push(lv); return; }

    // 播放期间不收音：否则她一边说话一边把自己的声音录进去，
    // 录进来又被送去识别，形成自我对话。echoCancellation 挡不住扬声器外放。
    if (currentAudio !== null) {
      if (speaking) { speaking = false; }
      return;
    }

    // 正在等回复 / 正在识别时也不该录音。原来只有发送那一步挡了 busy，
    // 录音本身没挡，于是环境一吵就反复起录停录，白烧 CPU 还刷满日志。
    if (busy) {
      if (speaking) { speaking = false; }
      return;
    }

    // 每 2 秒打一次电平峰值，方便排查"说了没反应"
    if (now - levelLogAt > 2000) {
      levelLogAt = now;
      log("电平 peak=" + levelPeak.toFixed(4) + " 阈值=" + vadThreshold.toFixed(4) +
        (levelPeak > vadThreshold ? " [过线]" : ""));
      levelPeak = 0;
    }
    if (lv > levelPeak) levelPeak = lv;

    if (lv > vadThreshold) {
      lastVoiceAt = now;
      if (!speaking) {
        speaking = true;
        startRecorder();
      }
    } else if (speaking && now - lastVoiceAt > SILENCE_MS) {
      speaking = false;
      const ms = now - recStart;
      if (ms >= MIN_MS) stopRecorder();
      else { try { recorder && recorder.stop(); } catch (e) { } recorder = null; }
    }

    // 超长掐断
    if (recorder && now - recStart > MAX_MS) {
      speaking = false;
      stopRecorder();
    }

  }

  // ---------- 主流程 ----------
  async function handleAudio(blob) {
    if (busy) return;
    if (!blob || blob.size < 2000) return;
    busy = true;
    setBtn("thinking");
    try {
      const r = await postAudio(blob);
      if (!r || r.ok !== true || !r.text) {
        log("ASR 没结果: " + JSON.stringify(r));
        // 识别失败必须让用户知道，否则就是"我说了但她没反应"
        if (window.FishSay) window.FishSay("没听清……再说一次？", null, 2200);
        setBtn("on");
        busy = false;
        return;
      }
      const text = String(r.text).trim();
      // r.raw 是纠错前的识别原文。用它填「你说」，这样和「发出」并排时，
      // 能直接看出「大肥鱼」这三个字刚才被听成了什么。
      const raw = String(r.raw || r.text || "").trim() || text;
      log("听到: " + text + (raw !== text ? "（原文 " + raw + "）" : ""));
      noti("onUserSaid", raw);
      if (window.FishSay) window.FishSay("「" + text + "」", null, 2600);

      // API 模式：跟 DSH 完全无关，直接问接口要一句，然后念出来。
      if (replyMode === "api") {
        noti("onSent", text);
        const reply = await askViaApi(text);
        log("API 回复: " + reply.slice(0, 60));
        await finishReply(reply);
        return;
      }

      // 发进 DSH —— 基准必须在 send 之前取，否则可能把回复算进 before。
      // 桥接一起来就能收：消息会在队列里等 DSH 会话，不用先干等 sessionId。
      await waitBridgeReady();
      const __t1 = await getToken();
      const __before1 = await snapshotCount(__t1);
      const sent = await postJson("/api/send", {
        text,
        clientId: "fish-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      });
      log("已发送: " + JSON.stringify(sent));
      noti("onSent", text);
      if (sent && sent.ok !== true) {
        if (window.FishSay) window.FishSay("话没送出去，检查一下手机端连着没", "annoyed", 3000);
        return;
      }

      await waitReply(text, __before1);
    } catch (e) {
      log("失败: " + (e && e.message ? e.message : e));
      if (window.FishSay) window.FishSay(humanErr(e), null, 3200);
    } finally {
      busy = false;
      setBtn("on");
    }
  }

  // 走用户自己填的 OpenAI 兼容接口要一句回复。
  // 返回回复文本；失败抛错，由调用方统一转成人话。
  async function askViaApi(text) {
    if (!apiBase) throw new Error("没有填 API 地址");
    if (!apiModel) throw new Error("没有填模型名");
    const messages = [
      { role: "system", content: API_SYSTEM },
      ...apiHistory,
      { role: "user", content: text },
    ];

    // 必须走主进程转一道：页面在 127.0.0.1:7801，直接 fetch 外部接口时
    // 请求能发出去、响应却被浏览器的同源策略拦掉（报 Failed to fetch）。
    // 主进程没有这个限制。
    if (!window.deskfish || !window.deskfish.chatApi) {
      throw new Error("这个版本没有 API 通道，重装一下程序");
    }
    const r = await window.deskfish.chatApi({
      apiBase, apiKey, apiModel, messages,
      temperature: 0.85,
      maxTokens: 600,
    });
    if (!r || r.ok !== true) {
      throw new Error((r && r.error) || "API 没回话");
    }
    const reply = String(r.reply || "").trim();
    if (!reply) throw new Error("API 没给出内容");

    // 记进历史（只留最近 20 条 = 10 轮）
    apiHistory.push({ role: "user", content: text });
    apiHistory.push({ role: "assistant", content: reply });
    if (apiHistory.length > API_HISTORY_MAX) {
      apiHistory = apiHistory.slice(-API_HISTORY_MAX);
    }
    return reply;
  }

  // 整条链都没出声时，告诉用户一句人话。
  // 为什么必须有：speak() 失败是 return false，不是抛错 —— 以前调用方
  // 只 catch 不查返回值，于是「她一声不吭」这件事永远走不到界面上，
  // 用户只能看到文字气泡，以为麦克风坏了或者程序卡了。
  function notifySpeakFailed() {
    if (muted) return;
    const err = lastSpeakError || voiceErrText(null);
    reportFault("speak", err);
    log("整条链路都没出声：" + err.code);
    if (window.FishSay) {
      try { window.FishSay(err.short, "sad", 5200); } catch (e) { }
    }
  }

  // 不管走哪条路，最后都是「把回复念出来 + 弹气泡 + 通知面板」
  async function finishReply(reply) {
    const clean = String(reply || "").trim();
    if (!clean) return;
    noti("onHerReply", clean);
    if (window.FishSay) window.FishSay(clean);
    try {
      const ok = await speak(clean);
      if (ok === false) notifySpeakFailed();
    } catch (e) {
      log("朗读失败: " + (e && e.message ? e.message : e));
      lastSpeakError = lastSpeakError || voiceErrText(e);
      notifySpeakFailed();
    }
  }

  // 首句愿意在逗号处先切一小口：她开口之前不必等第一个句号落下来。
  // 返回要切到的下标（不含），不够长就 -1 —— 太短的一口（「嗯，」）念出来像卡了一下。
  // 只看第一个逗号：它都还不够长，后面的也只会更长，没必要继续找。
  function firstCutAt(rest) {
    const s = String(rest || "");
    for (let i = 0; i < s.length; i += 1) {
      const ch = s[i];
      if (ch !== "，" && ch !== "," && ch !== "、") continue;
      const head = s.slice(0, i + 1);
      const spoken = head.replace(/[\s\p{P}]/gu, "").length;
      return spoken >= 9 ? i + 1 : -1;
    }
    return -1;
  }

  // 把累计文本里「已经能念」的句子切出来，剩下的留在 rest 里等下一段。
  // 和 splitSentences 的区别：这个是流式的，不能等整段；也不能切太碎。
  function takeSentences(buf, flush, firstCut) {
    const s = String(buf || "");
    const out = [];
    let start = 0;
    const strong = "。！？!?；;…\n";
    const closers = "”’」』】）)";
    for (let i = 0; i < s.length; i += 1) {
      if (strong.indexOf(s[i]) < 0) continue;
      let end = i + 1;
      while (end < s.length && closers.indexOf(s[end]) >= 0) end += 1;
      const seg = s.slice(start, end).trim();
      // 「嗯。」这种 1-2 字的碎片先攒着，跟下一句一起念才像人话
      if (seg.replace(/[\s\p{P}]/gu, "").length >= 2 && seg.length >= 6) {
        out.push(seg);
        start = end;
        i = end - 1;
      }
    }
    // 还没等到句号、但这半句已经够念了：只有在「一句话都还没开口」时才提前切，
    // 后面几句照旧等句号，免得整段变成一顿一顿的碎句子。
    if (!flush && firstCut && out.length === 0) {
      const rest = s.slice(start);
      const cut = firstCutAt(rest);
      if (cut > 0) {
        out.push(rest.slice(0, cut).trim());
        start += cut;
      }
    }
    if (!flush && s.length - start >= 30) {
      const rest = s.slice(start);
      const cut = Math.max(rest.lastIndexOf("，"), rest.lastIndexOf(","), rest.lastIndexOf("、"));
      if (cut >= 10) {
        out.push(rest.slice(0, cut + 1).trim());
        start += cut + 1;
      }
    }
    if (flush && s.slice(start).trim()) out.push(s.slice(start).trim());
    return { list: out.filter(Boolean), rest: s.slice(start) };
  }

  // 边等文字、边合成、边播：producer 合成下一句时，consumer 正在播这一句。
  // 每句都 await speak() 的话，第二句要等第一句播完才开始合成，
  // 句与句之间会空 1-2 秒；这条流水线把那段空白吃掉。
  function createSpeechPipeline(mark, onFirstPlay) {
    const pending = [];
    const urls = [];
    let closed = false;
    let producing = true;
    const producer = (async function () {
      try {
        for (;;) {
          if (mark !== speechAbort) break;
          if (!pending.length) {
            if (closed) break;
            await sleep(30);
            continue;
          }
          const sent = pending.shift();
          try {
            const url = await synthChunk(sent);
            if (mark !== speechAbort) break;
            urls.push(url);
          } catch (e) {
            log("分句合成失败：" + (e && e.message ? e.message : e));
          }
        }
      } finally {
        producing = false;
      }
    })();

    return {
      push(sent) { if (mark === speechAbort) pending.push(sent); },
      close() { closed = true; },
      async drain() {
        let played = 0;
        // ① 首句走的是「时间轴播放器」这条独立的路。它没播完之前不能抢话筒 ——
        //    否则下一句会盖在第一句上面，听起来就是第一句卡在半截。
        if (pcmPlayer && !pcmPlayer.closed) {
          try { await pcmPlayer.wait(); } catch (e) { }
        }
        // ② 剩下的句子也排进同一根时间轴：句与句采样级首尾相接。
        //    以前每句 new Audio(url)，起播要靠 media 元素自己加载，
        //    句间那几十到几百毫秒的空档就是这么来的。
        const player = createPcmPlayer();
        if (player) {
          if (pcmPlayer) { try { pcmPlayer.stop(); } catch (e) { } }
          pcmPlayer = player;
          if (!mouthRaf) mouthRaf = requestAnimationFrame(mouthLoop);
        }
        let aborted = false;
        // 一个 URL 要么交给时间轴（解码后排队），要么回落到 <audio>。
        const consume = async (url) => {
          if (!player) { await playAudio(url); return; }
          const r = await fetch(url);
          if (!r.ok) throw new Error("取不到音频 HTTP " + r.status);
          const buf = await r.arrayBuffer();
          await player.push(new Uint8Array(buf));
        };
        if (mark === speechAbort) {
          const t0 = Date.now();
          while (!urls.length && producing && Date.now() - t0 < 60000) {
            if (mark !== speechAbort) break;
            await sleep(30);
          }
        }
        for (;;) {
          if (mark !== speechAbort) { aborted = true; break; }
          const url = urls.shift();
          if (url) {
            try {
              if (!played && onFirstPlay) onFirstPlay();
              await consume(url);
              played += 1;
            } catch (e) { log("播放失败 " + (e && e.message ? e.message : e)); }
            if (url.startsWith("blob:")) {
              setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) { } }, 2000);
            }
            continue;
          }
          if (!producing) break;
          await sleep(30);
        }
        if (player) {
          if (aborted) {
            // 被打断：立刻收声，别让剩下的句子继续往外冒。
            try { player.stop(); } catch (e) { }
          } else {
            try { await player.end(); } catch (e) { }
          }
          if (pcmPlayer === player) pcmPlayer = null;
        }
        try { await producer; } catch (e) { }
        return played;
      },
    };
  }

  // 轮询 /api/state，等到一条 assistant 的回复。
  // beforeCount 必须由调用方在「发送之前」取好再传进来。
  // 桥接现在会边生成边把 assistant 消息写进 state，所以这里按「已有多少字」
  // 取增量：完整句子一出现就立刻送进合成流水线，不再等整段说完。
  async function waitReply(myText, beforeCount) {
    lastReplyIssue = null;
    const t = await getToken();
    const sinceRaw = (typeof beforeCount === "number")
      ? beforeCount
      : await snapshotCount(t);
    // 桥接刚起来、或者 /api/state 一时读不到时，sinceRaw 是 0。
    // 那样只要 state 里存在任何一条 assistant 消息，都会被当成「她刚回的那句」——
    // 用户会听见她念一段和这次说话无关的旧话，还以为她答非所问。
    // 拿不到基线就只认最近一分钟的消息，宁可判「没等到」也不假装收到。
    const since = snapOk ? sinceRaw : Math.max(0, Date.now() - 60000);
    if (!snapOk) log("读不到 /api/state 的基线，只认最近一分钟的回复");
    // 等多久。自测可以把它调短（window.__fishReplyTimeoutMs），免得每跑一次都要干等 90 秒。
    // 只有自测会去动它；正常运行时不设这个变量，走默认的 90 秒。
    const waitMs = Math.max(1000, Number(window.__fishReplyTimeoutMs) || 90000);
    const waitedSec = Math.round(waitMs / 1000);
    const deadline = Date.now() + waitMs;
    const started = Date.now();
    const mark = ++speechAbort;
    let firstStream = null;
    let firstAudioAt = 0;
    const noteFirstAudio = () => {
      if (firstAudioAt) return;
      firstAudioAt = Date.now();
      log("首句出声 " + ((firstAudioAt - started) / 1000).toFixed(2) + "s（首字之后 " + ((firstAudioAt - (firstTextAt || firstAudioAt)) / 1000).toFixed(2) + "s）");
    };
    const pipe = createSpeechPipeline(mark, noteFirstAudio);
    const speakSentence = (sent) => {
      // 飞鱼：第一句直接用 /tts_stream 边算边播，不再等整句合成完。
      // 后面的句子继续走流水线，在首句播放时就把下一句算好。
      if (voiceOut === "feiyu" && !firstStream) {
        firstStream = speakFeiyuStream(sent, noteFirstAudio).catch((e) => {
          log("首句流式失败（" + (e && e.message ? e.message : e) + "），改走整句合成");
          pipe.push(sent);
          return false;
        });
        return;
      }
      pipe.push(sent);
    };
    let full = "";
    let buf = "";
    let streamId = "";
    let firstTextAt = 0;
    let lastPaint = 0;
    let finishedOk = false;

    const paint = (force) => {
      if (!full) return;
      if (!force && Date.now() - lastPaint < 420) return;
      lastPaint = Date.now();
      if (window.FishSay) window.FishSay(full);
      try {
        if (streamId && window.deskfish && window.deskfish.chatAppend) {
          window.deskfish.chatAppend({ id: streamId, role: "assistant", text: full, streaming: true });
        }
      } catch (e) { }
    };

    while (Date.now() < deadline && mark === speechAbort) {
      const waited = Date.now() - started;
      // 前 3 秒是「她刚开口」的窗口，催得最勤：这一段每一次多等 200ms，
      // 首声就直接晚 200ms。3-18 秒按时出字，之后多半在跑工具，放慢。
      await sleep(waited < 3000 ? 150 : waited < 18000 ? 350 : 800);
      let j;
      try {
        const u = BASE + "/api/state?t=" + encodeURIComponent(t) + "&since=" + since;
        const r = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(10000) });
        j = await r.json();
      } catch (e) { continue; }
      const msgs = Array.isArray(j && j.messages) ? j.messages : [];

      let cur = null;
      for (let i = msgs.length - 1; i >= 0; i -= 1) {
        const m = msgs[i];
        if (!m || m.role !== "assistant") continue;
        if ((Number(m.at) || 0) <= since) break;
        const txt = String(m.text || "").trim();
        if (!txt || txt === myText) continue;
        cur = m;
        break;
      }
      if (!cur) continue;

      const txt = String(cur.text || "").trim();
      streamId = String(cur.id || streamId || "");
      if (!firstTextAt) {
        firstTextAt = Date.now();
        log("首字 " + ((firstTextAt - started) / 1000).toFixed(2) + "s");
      }
      if (txt.length > full.length) buf += txt.slice(full.length);
      full = txt;
      paint(false);

      const take = takeSentences(buf, false, !firstStream);
      buf = take.rest;
      for (const sent of take.list) speakSentence(sent);

      const done = cur.completed === true && cur.streaming !== true;
      if (done) {
        if (buf.trim()) { speakSentence(buf.trim()); buf = ""; }
        paint(true);
        pipe.close();
        const firstOk = firstStream ? await firstStream : false;
        const played = await pipe.drain();
        if (firstOk || played) noteFirstAudio();
        finishedOk = true;
        break;
      }
    }

    if (finishedOk && mark === speechAbort) {
      noti("onHerReply", full, { id: streamId || undefined });
      return;
    }
    // 打断：把还没合成的丢掉，别再补一句
    if (mark !== speechAbort) {
      try { pipe.close(); } catch (e) { }
      return;
    }
    // 超时但已经收到半段：把已经拿到的念完，总比整段沉默好。
    // 但「念完」不等于「说完了」—— 以前这里什么都没说，用户看到气泡停在一半，
    // 会以为她本来就是这么说完的。现在补一句，说明是被时间掐断的。
    if (full.trim()) {
      if (buf.trim()) speakSentence(buf.trim());
      pipe.close();
      if (firstStream) await firstStream;
      await pipe.drain();
      lastReplyIssue = { code: "partial", waited: waitedSec, chars: full.length };
      reportFault("reply", { code: "partial", short: "……好像没说完（等了 " + waitedSec + " 秒）",
        detail: "回复只来了一半。可能是桥接断了，也可能是那边算到一半停了。",
        raw: "waited=" + waitedSec + "s chars=" + full.length });
      noti("onHerReply", full, { id: streamId || undefined });
      log("等回复超时，只拿到半截（" + full.length + " 字）");
      if (window.FishSay) {
        try { window.FishSay("……好像没说完（等了 " + waitedSec + " 秒）", "calm", 4200); } catch (e) { }
      }
      return;
    }
    // 以前这里还要求 window.FishLines 存在才肯说话 —— 台词库没加载时等于完全不吭声，
    // 用户只会觉得「我说了，她没反应」。现在不管有没有台词库都要给一句，并且说明等了多久。
    log("等回复超时（" + waitedSec + " 秒一条回复都没拿到）");
    lastReplyIssue = { code: "stalled", waited: waitedSec };
    reportFault("reply", { code: "stalled", short: "她还没回我……（等了 " + waitedSec + " 秒）",
      detail: "一个字都没回来。看看 DSH 那边是不是没在跑，或者桥接地址变了。",
      raw: "waited=" + waitedSec + "s no-reply" });
    if (window.FishSay) {
      try { window.FishSay("她还没回我……（等了 " + waitedSec + " 秒）要不再说一次？", "annoyed", 6000); } catch (e) { }
    }
  }

  async function snapshotCount(t) {
    try {
      const r = await fetch(BASE + "/api/state?t=" + encodeURIComponent(t), { cache: "no-store", signal: AbortSignal.timeout(10000) });
      const j = await r.json();
      const ms = Array.isArray(j && j.messages) ? j.messages : [];
      // 不能拿「条数」当基准：state 只返回最近 120 条（滑动窗口），
      // 聊满之后条数永远是 120，发送后还是 120 —— msgs.length <= before
      // 就永远成立，于是每次都在等一个永远不会来的第 121 条，90 秒后超时。
      // 改用最后一条消息的时间戳（毫秒），窗口怎么滑都不影响。
      snapOk = true;
      const last = ms[ms.length - 1];
      return last ? Number(last.at) || 0 : 0;
    } catch (e) {
      snapOk = false;
      return 0;
    }
  }

  async function speakAndShow(text) {
    const clean = String(text).replace(/```[\s\S]*?```/g, "（代码略）").trim();
    log("回复: " + clean.slice(0, 60));
    noti("onHerReply", clean);
    if (window.FishSay) window.FishSay(clean);

    const ok = await speak(clean);
    if (ok === false) notifySpeakFailed();
  }

  // 当前音色。空串 = 引擎默认（晓萱）。由设置页写入。
  let voiceId = "";
  // 语音输出走哪条："tts" = 直接播 Edge TTS；"rvc" = 再过一遍 RVC 换音色。
  let voiceOut = "tts";
  let rvcPitch = 0;
  // 选飞鱼时先在后台把模型装进显存：否则第一句要等 17-22 秒。
  // 10 分钟内只催一次，设置变更会重复调到 setVoiceOut。
  let warmAt = 0, warming = false, warmTries = 0;
  // 「启动就预热」是可选开关：飞鱼模型装进显存大约 8GB，默认不预热更省内存，
  // 代价是闲置 10 分钟后的第一句话要等引擎重新装模型。想追求第一句速度的用户可以在设置里打开。
  let warmEnabled = false;
  function setWarm(on) {
    const next = !!on;
    if (next === warmEnabled) { if (next && voiceOut === "feiyu") warmFeiyu(); return; }
    warmEnabled = next;
    if (warmEnabled) {
      if (voiceOut === "feiyu") warmFeiyu();
    } else if (warmAt) {
      // 关掉预热：马上把已经装进显存的模型还回去，不然用户以为开关没生效。
      fetch("/engine/unload", { method: "POST" }).catch(() => { });
      warmAt = 0;
    }
  }
  function warmFeiyu() {
    if (warming || Date.now() - warmAt < 600000) return;
    warming = true;
    warmAt = Date.now();
    fetch("/engine/warm", { method: "POST" })
      .then((r) => r.json())
      .then((j) => {
        if (j && j.ok) { warmTries = 0; log("飞鱼预热 " + (Math.round((j.ms || 0) / 100) / 10) + "s"); }
        else throw new Error((j && j.error) || "预热失败");
      })
      .catch(() => {
        // 服务可能还在起：隔 12 秒再试，最多三次，别在后台无限重连。
        if (warmTries < 3) {
          warmTries += 1;
          warmAt = 0;
          setTimeout(() => { if (voiceOut === "feiyu") warmFeiyu(); }, 12000 * warmTries);
        }
      })
      .finally(() => { warming = false; });
  }
  function setVoiceOut(v, pitch) {
    // 保留完整的四档，别把 feiyu/xtts 折成 tts —— speak() 要靠它决定
    // 走哪条链路（飞鱼有专门的流式接口，绕开会白等整段合成）。
    voiceOut = (v === "rvc" || v === "feiyu" || v === "xtts") ? v : "tts";
    if (voiceOut === "feiyu" && warmEnabled) warmFeiyu();
    const p = Number(pitch);
    rvcPitch = Number.isFinite(p) ? Math.max(-12, Math.min(12, Math.round(p))) : 0;
  }
  function setVoiceId(v) { voiceId = String(v || ""); }

  // ── 说话 ────────────────────────────────────────────────
  // 优先用程序自己带的引擎（engine/tts.mjs，Edge 神经音色），
  // 这样别人拿到安装包、只要桥接 DSH 拿回复，语音本地就能出，不依赖 phone-bridge。
  // 内置引擎不可用时，回落到 DSH 的 /api/tts（老的 parts[] 多段结构）。
  async function speakLocal(text) {
    const r = await fetch("/engine/tts", {
      signal: AbortSignal.timeout(60000),
      method: "POST",
      headers: { "content-type": "application/json" },
      // 带上当前选的音色；空串时引擎会用它自己的默认值。
    body: JSON.stringify({ text, voice: voiceId }),
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    if (!j || !j.ok || !j.url) throw new Error((j && j.error) || "没有音频");
    // 引擎没出声、被换掉了 —— 这次要让她说出来，而不是让用户以为「就这音色」。
    noteFallback(j, "speakLocal");
    log("内置引擎合成 " + (j.dur || "?") + "s (" + (j.engine || "?") +
      ") 音色=" + (j.voice || voiceId || "默认"));
    // /engine/tts 返回的是同源相对路径，直接播
    await playAudio(location.origin + j.url);
    return true;
  }

  async function speakViaDsh(text) {
    const r = await postJson("/api/tts", { text });
    // DSH 返回 parts[]（长回复会被切成多段），每段之间还有 gapAfter 毫秒停顿，得自己补。
    const parts = Array.isArray(r && r.parts) ? r.parts : [];
    if (!parts.length) { log("DSH TTS 没给音频: " + JSON.stringify(r).slice(0, 120)); return false; }
    for (let i = 0; i < parts.length; i += 1) {
      const p = parts[i] || {};
      if (!p.url) continue;
      const url = BASE + "/" + String(p.url).replace(/^\/+/, "");
      await playAudio(url);
      const gap = Number(p.gapAfter) || 0;
      if (gap > 0) await sleep(gap);
    }
    return true;
  }

  // 「TTS 合成 → RVC 换音色 → 播放」。
  // 为什么不复用 speakLocal：那个是「合成 + 播放」一体的，而 RVC 要在
  // 合成完、播放前插进来，所以这里自己走一遍。
  async function speakRvc(text) {
    // 1) 先合成，拿到音频地址（不播）
    const r = await fetch("/engine/tts", {
      signal: AbortSignal.timeout(60000),
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, voice: voiceId }),
    });
    if (!r.ok) throw new Error("合成 HTTP " + r.status);
    const j = await r.json();
    if (!j || !j.ok || !j.url) throw new Error((j && j.error) || "没有音频");
    // 音色写进日志：换音色之后要能从日志里确认真的换了（RVC 只是再改一遍音色，
    // 前段 TTS 用哪个声音仍然是由 voiceId 决定的）。
    log("RVC 前段合成 " + (j.dur || "?") + "s 音色=" + (j.voice || j.asked || "?"));
    noteFallback(j, "speakRvc");

    // 2) 取回音频原始字节（mp3 或 wav 都行，Python 端 soundfile 1.2.2 能直接读）
    const src = await fetch(location.origin + j.url, { signal: AbortSignal.timeout(30000) });
    if (!src.ok) throw new Error("取音频 HTTP " + src.status);
    const buf = await src.arrayBuffer();

    // 3) 丢给 RVC 换音色。这一步在 GPU 上大约「音频时长 x 0.17」，慢但在降。
    const t0 = Date.now();
    const rr = await fetch("/engine/rvc?pitch=" + encodeURIComponent(rvcPitch), {
      signal: AbortSignal.timeout(120000),
      method: "POST",
      headers: { "content-type": "audio/mpeg" },
      body: buf,
    });
    if (!rr.ok) {
      const t = await rr.text().catch(() => "");
      throw new Error("RVC HTTP " + rr.status + " " + t.slice(0, 160));
    }
    const out = await rr.blob();
    const ms = Date.now() - t0;
    log("RVC 换音色完成 " + (ms / 1000).toFixed(1) + "s  " + Math.round(out.size / 1024) + "KB");

    // 4) 播。blob URL 用完要 revoke，不然每句都留一份在内存里。
    const url = URL.createObjectURL(out);
    try {
      await playAudio(url);
    } finally {
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) { } }, 3000);
    }
    return true;
  }

  // ── 分段流式说话 ────────────────────────────────────────
  // 一整段念完才出声，遇到长回复要干等十几秒；按句切开、边合成边播，
  // 第一句通常 1 秒左右就出来了，剩下的在她念的时候慢慢补。
  //
  // 切句不能只按「。」，不然一句话里带逗号的会拖得特别长；
  // 也不能切太碎，太碎的句子拼起来语气会断。
  function splitSentences(text) {
    const s = String(text || "").replace(/\s+/g, " ").trim();
    if (!s) return [];
    // 先按强标点切
    const rough = s.split(/(?<=[。！？!?；;…])|(?<=\.\s)/).map(function (x) { return x.trim(); }).filter(Boolean)
      // 纯标点的片段（「……」「——」）不送合成：词库里确实有一条就是「……」，
      // 发过去只会白等一次失败，她的沉默不需要配音。
      .filter(function (x) { return /[\p{L}\p{N}]/u.test(x); });
    if (!rough.length) return [];
    const out = [];
    let buf = "";
    rough.forEach(function (p) {
      // 太短的并到下一句去（「嗯。」「好。」这种单独念会很有机械感）
      if (buf.length + p.length < 12) {
        buf += p;
        return;
      }
      out.push(buf + p);
      buf = "";
    });
    if (buf) {
      if (out.length) out[out.length - 1] += buf;
      else out.push(buf);
    }
    // 单句还是很长（比如一口气 80 字没标点），就在逗号处硬切
    const fin = [];
    out.forEach(function (p) {
      if (p.length <= 90) { fin.push(p); return; }
      const parts = p.split(/(?<=[，,、])/);
      let cur = "";
      parts.forEach(function (q) {
        if (cur.length + q.length > 70 && cur) { fin.push(cur); cur = q; }
        else cur += q;
      });
      if (cur) fin.push(cur);
    });
    return fin;
  }

  // 合成一句，返回能直接播的 URL。调用方负责 revoke。
  async function synthChunk(text) {
    if (voiceOut === "rvc") {
      const r = await fetch("/engine/tts", {
        signal: AbortSignal.timeout(60000),
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, voice: voiceId }),
      });
      if (!r.ok) throw new Error("合成 HTTP " + r.status);
      const j = await r.json();
      if (!j || !j.ok || !j.url) throw new Error((j && j.error) || "没有音频");
      const src = await fetch(location.origin + j.url, { signal: AbortSignal.timeout(30000) });
      if (!src.ok) throw new Error("取音频 HTTP " + src.status);
      const buf = await src.arrayBuffer();
      const rr = await fetch("/engine/rvc?pitch=" + encodeURIComponent(rvcPitch), {
        signal: AbortSignal.timeout(120000),
        method: "POST",
        headers: { "content-type": "audio/mpeg" },
        body: buf,
      });
      if (!rr.ok) {
        const t = await rr.text().catch(() => "");
        throw new Error("RVC HTTP " + rr.status + " " + t.slice(0, 120));
      }
      return URL.createObjectURL(await rr.blob());
    }
    const r = await fetch("/engine/tts", {
      signal: AbortSignal.timeout(60000),
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, voice: voiceId }),
    });
    if (!r.ok) throw new Error("合成 HTTP " + r.status);
    const j = await r.json();
    if (!j || !j.ok || !j.url) throw new Error((j && j.error) || "没有音频");
    // 分段流式是「每句一次 /engine/tts」，回落提示自己有 5 分钟静默，
    // 不会一句一弹。
    noteFallback(j, "synthChunk");
    // /engine/tts 的产物由主进程缓存和清理，这里直接引用，不用 revoke
    return location.origin + j.url;
  }

  // ── 飞鱼流式：一次请求、服务端切句，第一块到了就开口 ──────────
  // 跟 speakStreaming 的分工：那个是「前端切句 + 每句一次 /engine/tts」，
  // 每句都要重走 HTTP 和模型前端；飞鱼服务端的 /tts_stream 把切句、
  // 参考音色缓存、逐块 WAV 都做在进程内，省掉往返，也少几次前端开销。
  function b64ToBytes(b64) {
    const bin = atob(String(b64 || ""));
    const n = bin.length;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }

  // 首块门槛：够长就立刻开口（时间轴播放器会把后续块接上），短得离谱才多等一块。
  // 拎成纯函数是为了能被 scripts/test-voice-perf.js 直接跑，而不是靠读源码猜。
  function feiyuFirstBlockReady(got, firstDur, hasPlayer) {
    if (got >= 2) return true;
    if (got < 1) return false;
    // 没有时间轴播放器时只有 <audio> 顺序播放，凑不出一根时间线，一块就够
    if (!hasPlayer) return true;
    return firstDur >= 0.8;
  }

  async function speakFeiyuStream(text, onFirst) {
    const my = ++speechGen;
    const queue = [];          // 回落路径（没有 WebAudio 时）才用
    const owned = [];
    const player = createPcmPlayer();
    if (player) {
      if (pcmPlayer) { try { pcmPlayer.stop(); } catch (e) { } }
      pcmPlayer = player;
    }
    let finished = false;
    let failed = null;
    let got = 0;
    let firstDur = 0;
    const t0 = Date.now();
    log("飞鱼流式 " + String(text).length + " 字" + (player ? "（时间轴播放）" : "（逐段播放）"));

    const readerTask = (async function () {
      const r = await fetch("/engine/tts_stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) {
        const t = await r.text().catch(function () { return ""; });
        throw new Error("流式 HTTP " + r.status + " " + t.slice(0, 120));
      }
      if (!r.body) throw new Error("流式没有 body");
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const step = await reader.read();
        if (step.done) break;
        buf += dec.decode(step.value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev = null;
          try { ev = JSON.parse(line); } catch (e) { continue; }
          if (my !== speechGen) { try { reader.cancel(); } catch (e) { } return; }
          if (ev.t === "meta") {
            if (ev.ready === false) log("声音还没装好，先等它加载（冷启动约 20 秒）");
          } else if (ev.t === "first") {
            log("飞鱼首包 " + (Number(ev.ms) / 1000).toFixed(2) + "s");
          } else if (ev.t === "err") {
            throw new Error(ev.error || "流式合成出错");
          } else if (ev.t === "chunk" && ev.b64) {
            const bytes = b64ToBytes(ev.b64);
            if (player) {
              player.push(bytes);
            } else {
              const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
              owned.push(url);
              queue.push(url);
            }
            got += 1;
            wakeUp();
            if (got === 1) { firstDur = Number(ev.dur) || 0; log("飞鱼首段 " + ((Date.now() - t0) / 1000).toFixed(2) + "s / " + (ev.dur || 0) + "s"); }
          }
        }
      }
    })().catch(function (e) { failed = e; wakeUp(); }).finally(function () { finished = true; wakeUp(); });

    // 第一块够长就立刻开口。时间轴播放器会把后面的块接在同一根时间线上，
    // 所以「再等一块」已经换不来更连贯的效果，只会白白晚几十到几百毫秒。
    // 只有首块短得离谱（<0.8s，多半是语气词）时才多等一块，免得刚响就断。
    const tw = Date.now();
    while (!finished && !failed) {
      if (my !== speechGen) break;
      if (feiyuFirstBlockReady(got, firstDur, !!player)) break;
      if (Date.now() - tw > 120000) { failed = new Error("首段超时"); break; }
      await waitTick(30);
    }
    if (failed || !got) {
      try { await readerTask; } catch (e) { }
      try { if (player) player.stop(); } catch (e) { }
      if (pcmPlayer === player) pcmPlayer = null;
      owned.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) { } });
      throw failed || new Error("没有拿到音频");
    }
    if (my !== speechGen) {
      try { if (player) player.stop(); } catch (e) { }
      if (pcmPlayer === player) pcmPlayer = null;
      return false;
    }

    // 口型：时间轴这条路也要让 analyser 跑起来，否则嘴一动不动。
    if (!mouthRaf) mouthRaf = requestAnimationFrame(mouthLoop);

    if (player) {
      // 首声按「真正开始出声」的那一刻报，而不是按排进时间轴的那一刻报。
      const lag = player.firstStartIn();
      if (onFirst) setTimeout(onFirst, Math.max(0, Math.round(lag * 1000)));
      try { await readerTask; } catch (e) { }
      await player.end();
      if (pcmPlayer === player) pcmPlayer = null;
      stopMouth();
      log("飞鱼播完 " + got + " 段（时间轴）");
      return got > 0;
    }

    // ── 回落：没有 WebAudio 时还是逐段 <audio>，行为与以前一致 ──
    let played = 0;
    while (true) {
      if (my !== speechGen) break;
      const url = queue.shift();
      if (url) {
        try {
          if (!played && onFirst) onFirst();
          await playAudio(url);
          played += 1;
        } catch (e) { log("播放失败 " + (e && e.message ? e.message : e)); }
        continue;
      }
      if (finished) break;
      await waitTick(30);
    }
    try { await readerTask; } catch (e) { }
    owned.forEach(function (u) { setTimeout(function () { try { URL.revokeObjectURL(u); } catch (e) { } }, 3000); });
    log("飞鱼播完 " + played + " 段");
    return played > 0;
  }

  // 每次开口递增。旧的合成线程发现代际变了就自己停下，
  // 不然打断之后它还在后台一路合成到句尾，白烧 CPU。
  let speechGen = 0;
  // 一轮回复的取消标记：用户打断/新回复开始时加一，旧的句子流水线自己收手。
  let speechAbort = 0;

  // ── 唤醒通知（取代 30/50ms 轮询）────────────────────────────────
  // 以前播放线程一直用 sleep(30/50) 反复问「下一块好了没」：每段最多白等 50ms，
  // 一句五段的回复就凭空多出小半秒的停顿，CPU 还一直在空转。
  // 现在改成「谁往队列里放了东西就把等的人叫醒」，正常路径上没有轮询；
  // ms 仍然保留，是兜底超时（合成线程死了不会把播放线程挂死）。
  let wakeFns = [];
  function wakeUp() {
    const w = wakeFns;
    wakeFns = [];
    for (let i = 0; i < w.length; i += 1) { try { w[i](); } catch (e) { } }
  }
  function waitTick(ms) {
    return new Promise(function (res) {
      let settled = false;
      const t = ms > 0 ? setTimeout(fin, ms) : null;
      function fin() {
        if (settled) return;
        settled = true;
        if (t) clearTimeout(t);
        const i = wakeFns.indexOf(fin);
        if (i >= 0) wakeFns.splice(i, 1);
        res();
      }
      wakeFns.push(fin);
    });
  }

  async function speakStreaming(text) {
    const chunks = splitSentences(text);
    if (chunks.length <= 1) return speak(text);   // 只有一句，走原路

    const my = ++speechGen;
    const queue = [];          // 已合成、等着播的 URL
    const owned = [];          // 需要 revoke 的 blob URL
    let finished = false;
    let failed = null;
    let usedFallback = false;

    log("分段合成 " + chunks.length + " 段");

    const producer = (async function () {
      for (let i = 0; i < chunks.length; i += 1) {
        if (my !== speechGen) return;
        let url = null;
        try {
          url = await synthChunk(chunks[i]);
        } catch (e) {
          // 某一段合不出来就跳过，别整段哑掉
          log("第 " + (i + 1) + " 段合成失败：" + (e && e.message ? e.message : e));
          if (i === 0) { failed = e; wakeUp(); return; }   // 第一句就挂了，交给外面的回落
          continue;
        }
        if (my !== speechGen) { try { if (url.startsWith("blob:")) URL.revokeObjectURL(url); } catch (e) { } return; }
        if (url.startsWith("blob:")) owned.push(url);
        queue.push(url);
        wakeUp();
      }
      finished = true;
      wakeUp();
    })();

    // 等第一块，等不到就说明第一句就失败了
    const t0 = Date.now();
    while (!queue.length && !finished && !failed) {
      if (my !== speechGen) break;
      if (Date.now() - t0 > 90000) { failed = new Error("首段超时"); break; }
      await waitTick(50);
    }
    if (failed) {
      log("分段合成首段失败（" + (failed.message || failed) + "），回落整段");
      try { await producer; } catch (e) { }
      return speak(text);
    }

    log("首段就绪 " + ((Date.now() - t0) / 1000).toFixed(1) + "s，开始播");
    let played = 0;
    while (true) {
      if (my !== speechGen) break;              // 被打断了
      const url = queue.shift();
      if (url) {
        try { await playAudio(url); played += 1; } catch (e) { log("播放失败 " + (e && e.message ? e.message : e)); }
        continue;
      }
      if (finished) break;
      await waitTick(50);
    }
    try { await producer; } catch (e) { }
    // blob URL 别一直攒着
    owned.forEach(function (u) { setTimeout(function () { try { URL.revokeObjectURL(u); } catch (e) { } }, 3000); });
    log("分段播完 " + played + "/" + chunks.length + " 段");
    return played > 0 || !usedFallback;
  }

  async function speak(text) {
    const t = String(text || "").trim();
    if (!t) return false;
    if (muted) return false;
    lastSpeakError = null;
    // 记第一处失败：那是「用户选的那一档」为什么不行的原因。
    // 后面回落链上的失败不覆盖它 —— 用户关心的是飞鱼/RVC 为什么不出声，
    // 不是最后那根稻草（DSH 桥接）为什么也不行。
    const note = (e) => { if (!lastSpeakError) lastSpeakError = voiceErrText(e); };
    // 飞鱼：走服务端的流式接口，第一块 2-3 秒就出声，不用等整段算完。
    // 它自己会处理切句，所以不再叠前端的 speakStreaming（那样会多绕几圈 HTTP）。
    //
    // 以前这里有个 t.length >= 6 的门槛：短句（「试听」这种）根本不会走飞鱼，
    // 而是静默落到下面的 TTS —— 主人选了飞鱼却在听 Edge 的声音，还以为切成功了。
    // 选哪一档就走哪一档，一句两个字也得是他选的那个声音。
    if (voiceOut === "feiyu") {
      try {
        return await speakFeiyuStream(t);
      } catch (e) {
        note(e);
        log("飞鱼流式失败（" + (e && e.message ? e.message : e) + "），回落整段合成");
        // 回落可以，但必须说出来。静默换成别的声音，等于让他以为飞鱼通了。
        try {
          if (window.FishSay) window.FishSay("飞鱼的接口没连上，这句先用默认声音念的", "calm", 4600);
        } catch (_) { }
      }
    }
    // 长回复走分段流式；短句没必要折腾
    if (t.length > 60 && voiceOut !== "feiyu") {
      try {
        return await speakStreaming(t);
      } catch (e) {
        note(e);
        log("流式失败（" + (e && e.message ? e.message : e) + "），回落整段");
      }
    }
    // RVC 开着就走 RVC，但它依赖「先合成一段 TTS」，所以失败时直接回落到纯 TTS。
    if (voiceOut === "rvc") {
      try {
        return await speakRvc(t);
      } catch (e) {
        note(e);
        log("RVC 不可用（" + (e && e.message ? e.message : e) + "），回落纯 TTS");
      }
    }
    try {
      return await speakLocal(t);
    } catch (e) {
      note(e);
      log("内置引擎不可用（" + (e && e.message ? e.message : e) + "），回落 DSH");
    }
    try {
      return await speakViaDsh(t);
    } catch (e) {
      note(e);
      log("TTS 失败: " + (e && e.message ? e.message : e));
      return false;
    }
  }

  // 当前正在播的音频 + 它的 resolve，用来打断。
  // 不存引用的话，playAudio 里的 Promise 永远悬着，后续流程会卡死。
  let currentAudio = null;
  let currentResolve = null;

  // 语气词：独立于 currentAudio 那一套（不参与打断、不挡流程），
  // 只留一个引用方便 debug 和连点时先停掉上一条。
  let chirpAudio = null;
  // 每组有哪些文件，跟 _app/assets/voice/ 里的实际文件名一一对应。
  const CHIRPS = {
    soft: ["soft-1", "soft-2", "soft-3", "soft-4"],
    head: ["head-1", "head-2", "head-3"],
    face: ["face-1", "face-2", "face-3"],
    body: ["body-1", "body-2", "body-3"],
    double: ["double-1", "double-2", "double-3"],
    more: ["more-1", "more-2", "more-3", "more-4"],
    breath: ["breath-1", "breath-2", "breath-3"],
  };

  /**
   * 收尾一个播完（或被打断）的音频。
   *
   * 为什么必须做：`hookMouth()` 每次都会给新的 <audio> 建一个 MediaElementSource，
   * 接到同一个 analyser 上。以前播完只把 currentAudio 置空，节点还挂在那儿——
   * 播一百次就有 100 个 source 同时往 analyser 里灌，口型信号会互相叠加，
   * 内存也一路涨。disconnect 之后这个元素不能再用，但每次都是新建的，无所谓。
   */
  function releaseAudio(a) {
    if (!a) return;
    try { if (a.__src) { a.__src.disconnect(); a.__src = null; } } catch (e) { }
    try { a.oncanplay = a.onplaying = a.onended = a.onerror = null; } catch (e) { }
    try { a.pause(); } catch (e) { }
    try { a.removeAttribute("src"); a.src = ""; a.load(); } catch (e) { }  // load() 才会真正释放解码器
  }

  // 飞鱼流式专用的「一条时间轴」播放器。
  //
  // 为什么另起一套：以前每一块 WAV 都新建一个 <audio>，走
  // createElement → 设 src → 解码 → play() 这一串，每段光启动就要几十毫秒，
  // 段与段之间必然能听见一下空气；块越多、断得越多。
  // 现在改成解码后直接排进 WebAudio 的时间轴：
  //   后一块的起点 = max(现在 + 40ms, 前一块的终点)
  // 段间因此是零空隙（采样级对齐），启动延迟也只剩一次 decode。
  // 口型还是读同一个 analyser —— 声音从这条路出来，嘴照样跟着动。
  let pcmPlayer = null;

  function createPcmPlayer() {
    if (!ensureMouthGraph()) return null;
    const c = mouthCtx;
    if (!c) return null;
    if (c.state === "suspended") { try { c.resume(); } catch (e) { } }

    const gain = c.createGain();
    gain.gain.value = muted ? 0 : volume;
    gain.connect(mouthAnalyser || c.destination);

    const sources = [];
    let at = 0;              // 下一条的起始时刻（AudioContext 时间轴）
    let chain = Promise.resolve();
    let dead = false;
    let ended = false;
    let timer = 0;
    let settle = null;
    let startedAt = 0;
    let firstAt = 0;         // 第一块真正开口的那一刻（ctx 时间）
    const allDone = new Promise((r) => { settle = r; });

    function finish() {
      if (ended) return;
      ended = true;
      if (timer) { clearTimeout(timer); timer = 0; }
      try { gain.disconnect(); } catch (e) { }
      if (settle) settle();
    }

    // 排片的尾巴到了就收工：不用等每条 onended，只要时间轴走完即可。
    function arm() {
      if (timer) { clearTimeout(timer); timer = 0; }
      if (ended || dead) return;
      const left = Math.max(0, at - c.currentTime) * 1000 + 60;
      timer = setTimeout(finish, left);
    }

    function schedule(bytes) {
      // 每块都是完整 WAV，decodeAudioData 会吃掉 44 字节头并重采样到设备采样率。
      const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return c.decodeAudioData(copy).then((buf) => {
        if (dead || !buf || !buf.duration) return;
        const src = c.createBufferSource();
        src.buffer = buf;
        src.connect(gain);
        // 40ms 余量：解码是异步的，排得太紧会落在「过去」，WebAudio 会当成
        // 立刻播 —— 两块就叠在一起了（听起来像吞字）。
        const startAt = Math.max(c.currentTime + 0.04, at || 0);
        src.start(startAt);
        if (!firstAt) firstAt = startAt;
        at = startAt + buf.duration;
        sources.push(src);
        src.onended = () => {
          try { src.disconnect(); } catch (e) { }
          const i = sources.indexOf(src);
          if (i >= 0) sources.splice(i, 1);
        };
        arm();
      }).catch((e) => {
        log("音频块解码失败: " + (e && e.message ? e.message : e));
      });
    }

    return {
      get closed() { return ended || dead; },
      get duration() { return at - (startedAt || 0); },
      // 串行解码：块必须按到达顺序排进去，否则先解完的后排、顺序就乱了。
      push(bytes) {
        if (dead) return chain;
        startedAt = startedAt || c.currentTime;
        chain = chain.then(() => schedule(bytes));
        return chain;
      },
      firstStartIn() { return firstAt ? Math.max(0, firstAt - c.currentTime) : 0; },
      setVolume(v) { try { gain.gain.value = muted ? 0 : Math.max(0, Math.min(1, v)); } catch (e) { } },
      // 收尾：先把还没解完的块等完，再看时间轴。
      // 踩过的坑：解码是异步的，`end()` 在 readerTask 结束后就被调用，
      // 那时 sources 可能还是空的（还有块在 decodeAudioData 里）—— 于是它
      // 立刻认为「播完了」，调用方马上去播下一句，第一句就卡在半截。
      // 表现：只有第一句会被打断，后面的句子都是排进同一根时间轴，反而连得挺好。
      async end() {
        try { await chain; } catch (e) { }
        if (!at) { finish(); return allDone; }
        arm();
        return allDone;
      },
      stop() {
        dead = true;
        try { sources.forEach((s) => { try { s.stop(); } catch (e) { } try { s.disconnect(); } catch (e) { } }); } catch (e) { }
        sources.length = 0;
        finish();
      },
      wait() { return allDone; },
    };
  }

  function stopPlayback() {
    // 分段流式时，光停当前这段不够 —— 后台还在合成后面的句子。
    // 代际加一，那边发现对不上就自己收手。
    speechGen += 1;
    speechAbort += 1;
    if (pcmPlayer) {
      try { pcmPlayer.stop(); } catch (e) { }
      pcmPlayer = null;
      stopMouth();
      log("播放已打断（时间轴）");
      return true;
    }
    if (currentAudio === null) return false;
    // 先打标记再清 src：清 src 会让 onerror 立刻炸出来，
    // 不标记的话日志里每次打断后面都跟一条「播放失败 code=4」，看着像 bug。
    try { currentAudio.__stopped = true; } catch (e) { }
    releaseAudio(currentAudio);
    currentAudio = null;
    stopMouth();                    // 打断之后嘴不能还张着
    const r = currentResolve;
    currentResolve = null;
    if (r) r();
    log("播放已打断");
    return true;
  }

  // ---------- 口型同步 ----------
  // 播放时把音频接进 WebAudio，读真实的振幅来驱动嘴型。
  // 注意：createMediaElementSource 一旦调用，声音就改走 WebAudio 图了，
  //      必须 connect 到 destination，否则什么都听不见——这是最容易踩的一脚。
  let mouthCtx = null, mouthAnalyser = null, mouthBuf = null, mouthRaf = 0;
  let mouthLevel = 0;
  // 排障用：一轮播放里读到的最大 rms。是 0 就说明 analyser 根本没接到声音流。
  let mouthPeak = 0;

  function ensureMouthGraph() {
    if (mouthCtx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      mouthCtx = new AC();
      mouthAnalyser = mouthCtx.createAnalyser();
      mouthAnalyser.fftSize = 512;
      mouthAnalyser.smoothingTimeConstant = 0.45;
      mouthAnalyser.connect(mouthCtx.destination);
      return true;
    } catch (e) {
      mouthCtx = null;
      return false;
    }
  }

  function hookMouth(a) {
    if (!ensureMouthGraph()) { log("[mouth] 建不出 AudioContext"); return; }
    if (mouthCtx.state === "suspended") { try { mouthCtx.resume(); } catch (e) {} }
    try {
      if (!a.__src) {
        a.__src = mouthCtx.createMediaElementSource(a);
        a.__src.connect(mouthAnalyser);      // 经 analyser 再到 destination，声音不断
        log("[mouth] 已接线 state=" + mouthCtx.state);
      }
    } catch (e) {
      // 同一个元素重复接线会抛，忽略即可
      log("[mouth] 接线失败: " + e.message);
    }
  }

  function mouthLoop() {
    mouthRaf = 0;
    if (!mouthAnalyser) { mouthLevel = 0; return; }
    if (!mouthBuf || mouthBuf.length !== mouthAnalyser.fftSize) {
      mouthBuf = new Uint8Array(mouthAnalyser.fftSize);
    }
    mouthAnalyser.getByteTimeDomainData(mouthBuf);
    let sum = 0;
    for (let i = 0; i < mouthBuf.length; i++) {
      const v = (mouthBuf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / mouthBuf.length);
    mouthPeak = Math.max(mouthPeak, rms);
    // 说话时 rms 大概 0.03~0.25；开方是为了让小音量也张得开嘴，不然嘴一直半闭着
    const want = Math.min(1, Math.pow(rms * 4.2, 0.62));
    // 张得快、合得慢：闭合太利索像假牙在打架
    mouthLevel = want > mouthLevel ? want : mouthLevel + (want - mouthLevel) * 0.28;
    if (currentAudio !== null || pcmPlayer) mouthRaf = requestAnimationFrame(mouthLoop);
    else mouthLevel = 0;
  }

  function stopMouth() {
    if (mouthRaf) { cancelAnimationFrame(mouthRaf); mouthRaf = 0; }
    mouthLevel = 0;
  }

  function playAudio(url) {
    return new Promise((resolve) => {
      // 静音可能在合成途中被打开：这一段直接当播完，别把流程卡住。
      if (muted) { resolve(); return; }
      const a = new Audio(url);
      a.volume = muted ? 0 : volume;
      a.oncanplay = () => log("音频就绪 dur=" + (a.duration || 0).toFixed(1) + "s");
      a.onplaying = () => log("开始播放");
      // 主动打断（stopPlayback 把 src 清空）也会走到 onerror，
      // 那是预期行为，不该报成「播放失败」——否则日志里看着像每次都播挂了。
      a.__stopped = false;
      currentAudio = a;
      currentResolve = resolve;
      // 接上口型：从这里开始，音频走 WebAudio 图，嘴跟着真实声音动
      hookMouth(a);
      if (!mouthRaf) mouthRaf = requestAnimationFrame(mouthLoop);
      const done = (why) => {
        if (a.__stopped) return;      // 已经由 stopPlayback 收过尾了
        if (currentAudio === a) { currentAudio = null; currentResolve = null; }
        stopMouth();
        releaseAudio(a);
        log(why);
        resolve();
      };
      a.onended = () => done("播放结束");
      a.onerror = () => done("播放失败 code=" + (a.error && a.error.code));
      a.play().then(() => log("play() 已受理")).catch((e) => {
        if (a.__stopped) return;
        done("播放被拒: " + e.message);
      });
    });
  }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // ---------- 开关 ----------
  // 图标用内联 SVG：原本是 ◎ / ◉ / ◌ 三个字符，12px 下又小又灰，
  // 开没开、在不在转，用户根本分不出来。思考态改用 CSS 的脉冲动画（#fish-voice.think）。
  const MIC_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.6a3 3 0 0 1 3 3v5.2a3 3 0 0 1-6 0V6.6a3 3 0 0 1 3-3z" /><path d="M5.6 11.4a6.4 6.4 0 0 0 12.8 0" /><path d="M12 17.8v2.6" /></svg>';
  function setBtn(state) {
    if (!btn) return;
    const on = state === "on";
    const think = state === "thinking";
    btn.classList.toggle("on", on || think);
    btn.classList.toggle("think", think);
    btn.title = think ? "在处理…" : on ? "语音已开（点我关掉）" : "点我开语音";
    // 只在没图标时补一次：classList 切换不会动子节点，
    // 但如果哪天有人用 textContent 清空了，这里能自愈。
    if (!btn.firstElementChild) btn.innerHTML = MIC_SVG;
  }

  async function enable() {
    // 防重入：getUserMedia 是异步的，用户连点两下会开两条麦克风流，
    // 而且第二条永远没人关。用启动中的标志挡住第二次。
    if (enabling) return false;
    enabling = true;
    try {
      // 三个处理全关：实测某些 USB 麦克风被 noiseSuppression 判成噪声，
      // 整条流滤成静音（RMS 一直 0.0000）。宁可有点底噪，也不能没声音。
      // 约束越少越稳：实测加了 echoCancellation/noiseSuppression/autoGainControl
      // 或 deviceId exact 之后，analyser 读出来全是 128（静音），
      // 而同一个页面用裸 {audio:true} 就能正常读到电平。
      const audioC = true;
      log("准备开麦 deviceId=" + (preferredDeviceId || "(空=系统默认)"));
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioC });
      } catch (e1) {
        // 选中的设备被拔了就退回系统默认，别整个语音功能瘫掉
        if (preferredDeviceId) {
          log("指定设备打不开，退回默认: " + e1.message);
          preferredDeviceId = "";
          stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        } else { throw e1; }
      }
    } catch (e) {
      // 以前这里只有一行 log 然后 return false：界面上按钮不变、她也不说话，
      // 用户唯一能感知到的就是「点了没反应」。现在把原因分成「她说什么」和
      // 「设置页/日志里那句人话」两份，前者走气泡，后者留给诊断包。
      lastMicError = micErrText(e);
      reportFault("mic", lastMicError);
      log("拿不到麦克风: " + (e && e.message ? e.message : e) + "（" + lastMicError.code + "）");
      enabling = false;
      setBtn("off");
      try { if (window.FishSay) window.FishSay(lastMicError.short, "sad", 5200); } catch (e2) { }
      return false;
    }
    // 采样率必须跟设备一致：设备是 48000，AudioContext 默认 44100 时
    // createMediaStreamSource 会静默失败——MediaRecorder 能录到声音，
    // 但 analyser 读出来全是 128（静音）。
    let devRate = 48000;
    try {
      const st0 = stream.getAudioTracks()[0].getSettings ? stream.getAudioTracks()[0].getSettings() : {};
      if (st0 && st0.sampleRate) devRate = st0.sampleRate;
    } catch (e) { }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: devRate });
    } catch (e) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Electron 里 AudioContext 常被 autoplay 策略挂起，state 是 suspended，
    // 挂起状态下 analyser 读到的永远是 0 —— 表现就是“底噪 0.0000”。
    try {
      if (ctx.state === 'suspended') { await ctx.resume(); }
    } catch (e) { log('resume 失败: ' + e.message); }
    try {
      const tr = stream.getAudioTracks()[0];
      log('AudioContext=' + ctx.state + ' 轨道=' + (tr ? tr.label : '无'));
      if (tr) {
        const st = tr.getSettings ? tr.getSettings() : {};
        log('track enabled=' + tr.enabled + ' muted=' + tr.muted + ' readyState=' + tr.readyState +
          ' ch=' + (st.channelCount || '?') + ' sr=' + (st.sampleRate || '?') +
          ' dev=' + String(st.deviceId || '').slice(0, 8));
      }
    } catch (e) { }
    const src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    src.connect(analyser);
    // analyser 悬空时某些实现不会拉取数据（电平恒 0）。
    // 接到 destination 上让它进入音频图，但增益设 0，避免麦克风直通喇叭。
    try {
      const mute = ctx.createGain();
      mute.gain.value = 0;
      analyser.connect(mute);
      mute.connect(ctx.destination);
    } catch (e) { }
    enabled = true;
    enabling = false;
    lastMicError = null;
    speaking = false;
    lastVoiceAt = 0;
    rafId = requestAnimationFrame(tick);
    startCalibration();
    watchMicTrack();
    log("麦克风已开");
    return true;
  }

  // 设备在说话中途被拔掉 / 蓝牙断开 / 被系统禁用时，流还在，只是永远读不到电平。
  // 用户看到的是「她突然不理人了」，而且麦克风按钮还是亮的 —— 比一开始就打不开更迷惑。
  // 这里挂一次监听：真断了就自己关掉并说一句，别装作还在听。
  let watchedTrack = null;
  function watchMicTrack() {
    try {
      const tr = stream && stream.getAudioTracks ? stream.getAudioTracks()[0] : null;
      if (!tr || tr === watchedTrack) return;
      watchedTrack = tr;
      const lost = () => {
        if (!enabled) return;
        lastMicError = micErrText({ name: "Lost", message: "device ended" });
      reportFault("mic", lastMicError);
        log("麦克风断开（" + (tr.label || "未知设备") + "）");
        try { disable(); } catch (e) { }
        setBtn("off");
        noti("setVoice", false);
        try { if (window.FishSay) window.FishSay(lastMicError.short, "sad", 5200); } catch (e) { }
      };
      tr.addEventListener("ended", lost);
      tr.addEventListener("mute", lost);
    } catch (e) { }
  }

  function disable() {
    enabled = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    try { recorder && recorder.stop(); } catch (e) { }
    recorder = null;
    try { stream && stream.getTracks().forEach((t) => t.stop()); } catch (e) { }
    stream = null;
    watchedTrack = null;
    try { ctx && ctx.close(); } catch (e) { }
    ctx = null;
    analyser = null;
    calibrating = false;
    calibSamples = [];
    vadThreshold = VAD_MIN;
    log("麦克风已关");
  }

  async function toggle() {
    // 连点两下 = 一定要关掉。
    // 原因：下面几道拦截（打断播放、取消这段录音）单独看都对，但它们叠在一起时，
    // 主人「想关语音」得连点三四下才关得掉，看着像按钮坏了。
    // 所以 1.6 秒内第二次按，跳过所有拦截，直接关。
    // 阈值 2.6 秒：人在「想关掉」的意图下，两下之间的间隔通常就是 1-2 秒。
    // 定得太紧（试过 1.6 秒）会导致第二下仍然落到「打断播放」分支上，按三次都关不掉。
    const nowT = Date.now();
    const rapid = nowT - lastToggleAt < 2600;
    lastToggleAt = nowT;
    if (rapid && enabled) {
      stopPlayback();
      speaking = false;
      disable();
      setBtn("off");
      noti("setVoice", false);
      if (window.FishSay) window.FishSay(window.FishLines.pick("voice.off"));
      return;
    }
    // 她正在说话时按按钮 = 让她闭嘴，而不是关掉语音。
    // 放在 busy 检查之前：处理中也要能打断，否则按钮看着像坏了。
    if (stopPlayback()) {
      if (window.FishSay) window.FishSay("小声点儿，我听见了", "shy", 1600);
      return;
    }
    // 正在录这段时按按钮 = 这段不说了。麦克风还开着，再按一下才关。
    // （不然想"算了不说了"的人会被迫把整个语音关掉再打开。）
    if (speaking) {
      speaking = false;
      try { recorder && recorder.stop(); } catch (e) { }
      recorder = null;
      recStart = 0;
      if (window.FishSay) window.FishSay("这次先算了，还听着呢", "annoyed", 1800);
      return;
    }
    // 正在想/正在识别时按按钮：如果语音本来就开着，那就是想关掉——必须让它关。
    // 不能在「她很忙」的时候把关闭也挡住，否则主人会觉得这键根本不理人。
    if (busy) {
      if (enabled) {
        disable();
        setBtn("off");
        noti("setVoice", false);
        if (window.FishSay) window.FishSay(window.FishLines.pick("voice.off"));
        return;
      }
      // 想开就别拦：开语音只是「打开耳朵」，不占任何正在跑的东西。
      // 真正会撞车的是「识别完把话发出去」，那一步在 tick 里自己看 busy。
      // 之前这里无脑弹「正忙呢」，导致她说话时连开都开不起来，很反直觉。
      // 落到下面 enable() 去。
    }
    if (enabled) {
      disable();
      setBtn("off");
      // 关掉语音就把记录区一起收起来——它只在语音对话时才有意义。
      noti("setVoice", false);
      if (window.FishSay) window.FishSay(window.FishLines.pick("voice.off"));
      return;
    }
    const ok = await enable();
    if (!ok) return;
    setBtn("on");
    // 这里才是「语音真的开起来了」，记录区从这一刻开始显示。
    noti("setVoice", true);
    if (window.FishSay) window.FishSay(window.FishLines.pick("voice.on"));
  }

  // ---------- 按钮 ----------
  function init() {
    log("init 开始");
    btn = document.createElement("button");
    btn.id = "fish-voice";
    btn.type = "button";
    btn.innerHTML = MIC_SVG;
    btn.title = "点我开语音";
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      toggle();
    });
    try {
      // 插进底部输入行，和输入框、发送键并排。
      // 原来 appendChild 到 body 是绝对定位在右下角——输入条一出现就把它盖住了。
      const line = document.querySelector("#dock .inputline");
      if (line) {
        line.insertBefore(btn, line.firstChild);
        log("init 完成，按钮已插入输入行");
      } else {
        document.body.appendChild(btn);
        log("init 完成，按钮已插入 body（没找到输入行）");
      }
    } catch (e) {
      log("init 插入失败: " + e.message);
    }
    setBtn("off");
  }

  window.FishVoice = {
    setReplyMode,
    setApiConfig,
    // 段切分单独暴露：测试时能直接看一句话被切成什么样，
    // 不用真的合成一遍才知道切得对不对。
    splitSentences,
    init,
    toggle,
    // 上一次拿麦克风失败的原因：{code, short, detail}。null = 没失败过。
    // 设置页、诊断包、探针都读这条，不必再去猜 DOMException 的文案。
    micError: () => lastMicError,
    clearMicError: () => { lastMicError = null; return null; },
    // 上一次「说话」整条链都没出声的原因：{code, short, detail}。null = 没失败过。
    // 和 micError 是两件事：一个管听得见，一个管说得出来。
    // 排障用：这一轮等她回复是「正常 / 只有半截 / 一个字也没等到」。
    replyIssue: () => lastReplyIssue,
    // 自测专用：直接走一遍「发出去之后等她回」这段，不用真的说话。
    __waitReply: (text) => waitReply(String(text || "probe"), undefined),
    clearReplyIssue: () => { lastReplyIssue = null; return null; },
    speakError: () => lastSpeakError,
    clearSpeakError: () => { lastSpeakError = null; return null; },
    // 自测专用：模拟「麦克风被拔掉」。轨道对象不对外暴露（那会让人误以为可以
    // 拿它去改设备状态），只给一个「让它断开」的入口，触发的是真事件监听。
    __dropMic: () => {
      try {
        const tr = stream && stream.getAudioTracks ? stream.getAudioTracks()[0] : null;
        if (!tr) return false;
        tr.dispatchEvent(new Event("ended"));
        return true;
      } catch (e) { return false; }
    },
    setVoiceId,
    setVoiceOut,
    setWarm,
    // 静音：打开时立刻掐掉正在播的那句，避免「点了静音还在说」。
    setMuted: (on) => {
      muted = !!on;
      if (muted) {
        try { stopPlayback(); } catch (e) { /* 还没播过，正常 */ }
        try { window.FishVoice.chirpStop(); } catch (e) { /* 同上 */ }
      }
      return muted;
    },
    isMuted: () => muted,
    // 音量：0–1，立即作用到正在播的那句；静音时保持 0，取消静音后恢复。
    setVolume: (v) => {
      const n = Number(v);
      if (Number.isFinite(n)) volume = Math.max(0, Math.min(1, n));
      try { if (currentAudio) currentAudio.volume = muted ? 0 : volume; } catch (e) { }
      try { if (pcmPlayer) pcmPlayer.setVolume(volume); } catch (e) { }
      return volume;
    },
    getVolume: () => volume,
    // 按需预热：用户点开输入条、按下说话时提前装模型，不必等第一句话才付这 20 秒。
    warm: () => { if (voiceOut === "feiyu") warmFeiyu(); },
    // 只出声、不走对话：验证「语音输出」这条路（TTS / RVC）时用。
    // say() 会先发消息再等回复，测声音不需要这么重。
    speak: (text) => speak(text),
    // 直接播一个已经存在的音频地址（闲置词的预合成缓存走这里）。
    // 不走合成、不进 TTS 队列，但口型、音量、静音、打断规则与正常说话完全一致——
    // 否则缓存那几句会像「另一个程序在放声音」，嘴不动、静音也停不下来。
    playUrl: (url) => playAudio(url),
    // 自测专用：走真实的「收到回复」入口（会弹气泡 + 说话）。
    // 只有 speak() 的话测不到「整条链都失败时她会不会说一句」——
    // 那一步在 finishReply 里，是这一轮真正修掉的东西。
    __finishReply: (text) => finishReply(text),
    isOn: () => enabled,
    // 她此刻是不是在出声（时间轴播放器或 <audio> 任一在播）。
    // 输入条拿它把「发送」临时换成「停止」——想让她闭嘴时不用去按麦克风键。
    isSpeaking: () => currentAudio !== null || !!pcmPlayer,
    // 只要停下这一句，不动语音开关。输入条那颗「停止」走这里。
    stop: () => stopPlayback(),
    // 口型：0~1，播放时由真实音频振幅驱动；没在播就是 0。
    // renderer 每帧读它去写 ParamMouthOpenY。
    mouth: () => mouthLevel,
    // 排障：peak 是这一轮读到过的最大 rms。一直是 0 = analyser 没接到声音流。
    mouthDebug: () => ({
      level: Math.round(mouthLevel * 1000) / 1000,
      peak: Math.round(mouthPeak * 1000) / 1000,
      state: mouthCtx ? mouthCtx.state : "no-ctx",
      hasAn: !!mouthAnalyser,
      playing: currentAudio !== null || !!pcmPlayer,
    }),
    resetMouthPeak: () => { mouthPeak = 0; },
    // 排障用：按钮看着是开的、isOn 说是关的这类矛盾，一次就能看清内部到底哪一步没走完。
    debug: () => ({
      enabled, enabling, busy, speaking, muted, volume,
      hasStream: !!stream, hasCtx: !!ctx, hasAnalyser: !!analyser,
      vadThreshold: Math.round(vadThreshold * 1000) / 1000,
      btn: btn ? btn.className : "",
    }),    // 打字入口：和语音走同一条后半段（发送 → 等回复 → TTS → 气泡）。
    // 语音只是多了「录音 + 识别」这一段前置。
    say: async (text) => {
      if (busy) {
        // 静默返回 = 主人以为按钮坏了，必须出声。
        if (window.FishSay) window.FishSay("正忙呢，等我这句说完", "annoyed", 2000);
        log("正忙，跳过这次输入");
        return false;
      }
      busy = true;
      setBtn("thinking");
      try {
        // API 模式：不碰 DSH，直接问接口要一句。
        if (replyMode === "api") {
          noti("onSent", text);
          const reply2 = await askViaApi(text);
          log("API 回复: " + reply2.slice(0, 60));
          await finishReply(reply2);
          return true;
        }

        await waitBridgeReady();
        const __t2 = await getToken();
        const __before2 = await snapshotCount(__t2);   // 必须在 send 之前
        const sent = await postJson("/api/send", {
          text,
          clientId: "fish-test-" + Date.now(),
        });
        log("已发送: " + JSON.stringify(sent));
        noti("onSent", text);
        if (sent && sent.ok !== true) throw new Error("send 没成功");
        await waitReply(text, __before2);
        return true;
      } catch (e) {
        log("发送失败: " + (e && e.message ? e.message : e));
        // 失败一定要让主人看见。原来这里只写日志，界面上什么都不发生。
        noti("onHerReply", "");
        if (window.FishSay) window.FishSay(humanErr(e), null, 3600);
        return false;
      } finally {
        busy = false;
        setBtn(enabled ? "on" : "off");
      }
    },

    __testSay: async (text) => window.FishVoice.say(text),

    // ── 语气词 ───────────────────────────────────────────────
    // 点击她时立刻出声。这些是预生成的固定短音（0.2–0.5 秒），不走合成，
    // 所以能压到按下就响；走 TTS 至少 0.6 秒，点一下等半秒就不像"被碰到"了。
    // 传组名会随机挑一条同组的，避免连点四次都"嗯"。
    chirp(group, opts) {
      // 静音时不响；正经语音在播的时候也不插：两个声音叠一起会糊成一团。
      if (muted) return false;
      if (currentAudio || pcmPlayer) return false;
      const pool = CHIRPS[group];
      if (!pool || !pool.length) return false;
      const name = pool[Math.floor(Math.random() * pool.length)];
      try {
        const a = new Audio("/voice/" + name + ".wav");
        a.volume = ((opts && typeof opts.volume === "number") ? opts.volume : 1) * volume;
        // 记在 chirpAudio 上只是为了 debug 能看见，不参与 currentAudio 那套打断逻辑
        chirpAudio = a;
        a.addEventListener("ended", () => {
          if (chirpAudio === a) chirpAudio = null;
          releaseAudio(a);           // 让解码器立刻放手，不然连点几十下会堆住
        });
        a.play().catch(() => { if (chirpAudio === a) chirpAudio = null; releaseAudio(a); });
        return true;
      } catch (e) {
        return false;
      }
    },
    chirpStop() {
      if (!chirpAudio) return;
      const a = chirpAudio;
      chirpAudio = null;
      releaseAudio(a);
    },

    // 设置里选的麦克风（空 = 系统默认）
    setDevice(id) { preferredDeviceId = id || ""; },
    getDevice() { return preferredDeviceId; },
  };
})();
