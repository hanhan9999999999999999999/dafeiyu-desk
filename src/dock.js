// 底部对话面板 —— 打字输入 + 语音转写回显
//
// 设计要点：
// 1. 面板默认只露一条「把手」，点一下或鼠标移上去展开；打字时不会自己收起。
// 2. 「你说 / 发出 / 她回」三种行只在语音开启时才显示——主人明确要求
//    「显示框只需要语音输入打开的时候才显示」。
// 3. 打字走 FishVoice.say()，和语音共用同一段「发送 → 等回复 → TTS → 气泡」。
//    区别只是没有录音和识别两步。
(function () {
  "use strict";

  const dock = document.getElementById("dock");
  const logEl = document.getElementById("dockLog");
  const input = document.getElementById("dockInput");
  const sendBtn = document.getElementById("dockSend");
  if (!dock || !input) return;

  let open = false;
  let voiceOn = false;      // 语音开启时才显示记录区
  let sending = false;
  let sendHold = 0;
  let hideTimer = 0;
  // 设置里「输入框自动隐藏」开关。关掉 = 一直显示，鼠标怎么挪都不收。
  // 这个值原来只存在 settings.json 里，dock 根本没读，开关是死的。
  let autoHide = true;
  // 养成面板开着的时候，输入条不能被自动收起——面板挂在它上面，条一收面板就跟着消失了。
  let held = false;

  const MAX_ROWS = 40;

  function setOpen(v) {
    open = !!v;
    // 语音开着的时候，输入条和记录区常驻——不然鼠标一挪开，
    // 语音对话的记录就跟着淡出，等于白做。
    dock.classList.toggle("show", open || voiceOn);
    syncLogVisible();
  }

  function syncLogVisible() {
    // 记录区只看语音开没开，不看鼠标在不在附近：
    // 它的用处就是「语音对话时能看见我说了什么、发出去的是什么」。
    logEl.classList.toggle("show", voiceOn);
  }

  function addRow(kind, tag, text, dim) {
    if (!text) return;
    const row = document.createElement("div");
    row.className = "row " + kind + (dim ? " dim" : "");
    const t = document.createElement("span");
    t.className = "tag";
    t.textContent = tag;
    const x = document.createElement("span");
    x.className = "txt";
    x.textContent = text;
    row.appendChild(t);
    row.appendChild(x);
    logEl.appendChild(row);
    while (logEl.childElementCount > MAX_ROWS) logEl.removeChild(logEl.firstElementChild);
    logEl.scrollTop = logEl.scrollHeight;
    return row;
  }

  // 把「发出去的东西」显示出来。语音识别有后处理（同音纠正、繁体收敛），
  // 所以「你说」和「发出」可能不一样——两个都显示才看得出中间动了什么手脚。
  function onUserSaid(text) { setOpen(true); addRow("me", "你说", text); }
  function onSent(text) { setOpen(true); addRow("sent", "发出", text); }
  function onHerReply(text) {
    addRow("her", "她回", String(text).replace(/\[\[\d+\]\]/g, "").trim());
    syncLogVisible();
  }

  function setVoice(on) {
    voiceOn = !!on;
    syncLogVisible();
    // 语音开起来时把面板固定住；关掉后回到「鼠标靠近才出现」。
    setOpen(voiceOn ? true : open);
  }

  // 输入历史：↑ 取上一条、↓ 收回草稿，和终端手感一致。
  // 只记「这次运行里发过的」，不落盘——聊过什么不该变成磁盘上的文件。
  const HIST_MAX = 40;
  const hist = [];
  let hi = -1;
  let draft = "";
  function pushHistory(text) {
    const t = String(text || "").trim();
    if (!t) return;
    if (hist[hist.length - 1] !== t) hist.push(t);
    while (hist.length > HIST_MAX) hist.shift();
    hi = -1;
    draft = "";
  }

  function send() {
    const text = String(input.value || "").trim();
    if (!text) return;
    setOpen(true);
    pushHistory(text);
    // 刚发完别让鼠标一动就把条收起来（1.5 秒的缓冲），也别再拿它挡发送。
    sending = true;
    clearTimeout(sendHold);
    sendHold = setTimeout(() => { sending = false; }, 1500);
    addRow("me", "我说", text);
    input.value = "";
    // 不 await：say() 会一直等到她说完（最长 90 秒）。等它的话输入框就锁死几十秒，
    // 想打断她或者接着说下一句都做不到。发出去就解锁，再发一条自然就是打断。
    if (window.FishVoice && typeof window.FishVoice.say === "function") {
      Promise.resolve(window.FishVoice.say(text)).catch((e) => {
        addRow("her", "错误", String((e && e.message) || e), true);
      });
    } else {
      addRow("her", "错误", "语音模块还没加载好", true);
    }
  }

  // ── 事件 ──────────────────────────────────────────────
  // 鼠标进到底部 90px 内浮现，移开 380ms 后收起。
  // 语音对话期间面板常驻：那时它的用处是显示对话记录，不该跟着鼠标跑。
  document.addEventListener("pointermove", (e) => {
    if (voiceOn) return;
    if (held) return;         // 养成面板开着：条得留着，不然面板跟着消失
    if (!autoHide) return;    // 关掉自动隐藏：常驻，不吃鼠标位置
    if (e.clientY > window.innerHeight - 90) {
      clearTimeout(hideTimer);
      if (!open) setOpen(true);
    } else if (open && document.activeElement !== input && !sending) {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (document.activeElement !== input && !sending && !voiceOn && !held) setOpen(false);
      }, 380);
    }
  });

  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    // 中文/日文输入法正在组装候选词时，Enter 是「确认候选」而不是「发送」。
    // 不拦这一下会把半截拼音直接发出去。
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    } else if (e.key === "Escape") {
      input.blur();
      setOpen(false);
    } else if (e.key === "ArrowUp" && !e.shiftKey) {
      if (!hist.length) return;
      e.preventDefault();
      if (hi < 0) { draft = input.value; hi = hist.length - 1; }
      else hi = Math.max(0, hi - 1);
      input.value = hist[hi];
      try { input.setSelectionRange(input.value.length, input.value.length); } catch (err) { }
    } else if (e.key === "ArrowDown" && !e.shiftKey) {
      if (hi < 0) return;
      e.preventDefault();
      hi += 1;
      if (hi >= hist.length) { hi = -1; input.value = draft; draft = ""; }
      else input.value = hist[hi];
      try { input.setSelectionRange(input.value.length, input.value.length); } catch (err) { }
    }
  });
  input.addEventListener("pointerdown", (e) => e.stopPropagation());

  // 窗口平时 focusable:false（点她不会抢别的窗口焦点），输入框要打字就得能拿焦点。
  // 注意顺序：不能把「开焦点」挂在 input 的 focus 事件上——窗口不可聚焦时 input
  // 根本收不到 focus，那就永远轮不到它开（死锁）。必须 pointerdown 先开，再手动 focus。
  const desk = window.deskfish;
  input.addEventListener("pointerdown", () => {
    try { if (desk && desk.setFocusable) desk.setFocusable(true); } catch (e) { }
    // setFocusable 走 IPC 是异步的，等它落地再要焦点
    setTimeout(() => { try { input.focus(); } catch (e) { } }, 60);
  });
  // 失焦后不要立刻把窗口变回不可聚焦。
  // 因为「点模型想拖窗口」这个动作的顺序是：输入框失焦 → blur → 关焦点 → 窗口失去焦点，
  // 而窗口一失去焦点，正在进行的按住拖动就会被系统打断，后面 pointermove 全落空，
  // 表现就是「打字框打开时拖不动模型」。延迟一小会儿，并且确认焦点真的不在输入框里了才关。
  let unfocusTimer = 0;
  input.addEventListener("blur", () => {
    clearTimeout(unfocusTimer);
    unfocusTimer = setTimeout(() => {
      if (document.activeElement === input) return;
      try { if (desk && desk.setFocusable) desk.setFocusable(false); } catch (e) { }
    }, 260);
  });
  // 只在 pointerdown 挡冒泡（不让它变成拖窗口），**不能 preventDefault**：
  // pointerdown 上 preventDefault 会把后续的 mousedown/mouseup/click 一并吃掉，
  // 结果就是这个按钮永远点不动——而 Enter 发送又是好的，最容易漏掉。
  // 直接在 pointerdown 里发：这个窗口是透明 + 不可聚焦的，
  // click/pointerup 需要一整套按下-抬起合成，偶尔会被系统吞；
  // pointerdown 是唯一一定能到的那个事件。
  sendBtn.addEventListener("pointerdown", (e) => { e.stopPropagation(); send(); });

  // 面板区域整体不参与「拖动窗口」的手势
  dock.addEventListener("pointerdown", (e) => e.stopPropagation());

  // 诊断用：把每次按下落在哪个元素上打出来。透明窗口里最怕的就是
  // 事件被别的层吃掉了——看得见按钮、点了没反应，只能靠这个定位。
  document.addEventListener("pointerdown", (e) => {
    const t = e.target;
    const r = sendBtn.getBoundingClientRect();
    console.log("[dock] down at " + e.clientX + "," + e.clientY +
      " target=" + (t && (t.id || t.className || t.tagName)) +
      " sendRect=" + Math.round(r.left) + "," + Math.round(r.top) + " " +
      Math.round(r.width) + "x" + Math.round(r.height) +
      " dockPE=" + getComputedStyle(dock).pointerEvents);
  }, true);

  // 自动隐藏开关。关掉时面板常驻，同时把定时器掐掉，
  // 否则可能在开关刚关掉的一瞬间被一个挂着的 timer 收起。
  function setAutoHide(v) {
    autoHide = v !== false;
    if (!autoHide) {
      clearTimeout(hideTimer);
      setOpen(true);
    }
  }

  // 养成面板用它把输入条按住：面板挂在 dock 上面，条一收面板就没了
  function holdOpen(v) {
    held = !!v;
    if (held) {
      clearTimeout(hideTimer);
      setOpen(true);
    }
  }

  window.FishDock = {
    onUserSaid,
    onSent,
    onHerReply,
    setVoice,
    setAutoHide,
    holdOpen,
    open: () => setOpen(true),
    close: () => setOpen(false),
    addRow,
  };

  // 全局热键叫出来的面板：展开 + 把光标放进输入框，直接就能打字。
  // 转两帧再 focus，因为面板刚从 opacity:0 / pointer-events:none 切过来，
  // 同一帧里 focus 有时不生效（元素还算「不可见」）。
  try {
    if (desk && typeof desk.onSummon === "function") {
      desk.onSummon(() => {
        setOpen(true);
        // 叫出输入条 = 马上要说话：这时预热语音引擎不用等到第一句才付装载时间。
        try { if (window.FishVoice && window.FishVoice.warm) window.FishVoice.warm(); } catch (e) { }
        requestAnimationFrame(() => requestAnimationFrame(() => {
          try { input.focus(); } catch (e) { }
        }));
      });
    }
  } catch (e) { }

  // 初始状态：先按默认收起，再去主进程读真实设置（异步，读到就应用）。
  setOpen(false);
  try {
    if (desk && desk.settingsGet) {
      desk.settingsGet().then((s) => {
        if (s && typeof s.dockAutoHide === "boolean") setAutoHide(s.dockAutoHide);
      }).catch(() => { });
    }
  } catch (e) { }
  if (desk && desk.onSettingsChanged) {
    desk.onSettingsChanged((s) => {
      if (s && typeof s.dockAutoHide === "boolean") setAutoHide(s.dockAutoHide);
    });
  }
})();
