// 设置界面逻辑：所有改动立刻生效并落盘，没有「确定」按钮
// 大小/不透明度用数字输入 + 应用按钮，一次提交一个值。
// 连续拖滑杆会让窗口在一秒内变几十次尺寸，Windows 的 setSize 跟不上，
// 就会出现「某个部位被放大」——数字输入天然没有这个问题。
const api = window.deskfish;

const els = {
  scaleNum: document.getElementById("scaleNum"),
  scaleApply: document.getElementById("scaleApply"),
  opacityNum: document.getElementById("opacityNum"),
  opacityApply: document.getElementById("opacityApply"),
  volumeNum: document.getElementById("volumeNum"),
  volumeApply: document.getElementById("volumeApply"),
  resSeg: document.getElementById("resSeg"),
  texSeg: document.getElementById("texSeg"),
  patchSeg: document.getElementById("patchSeg"),
  fpsSeg: document.getElementById("fpsSeg"),
  sharpen: document.getElementById("sharpen"),
  viewState: document.getElementById("viewState"),
  openAdapter: document.getElementById("openAdapter"),
  packState: document.getElementById("packState"),
  alwaysOnTop: document.getElementById("alwaysOnTop"),
  clickThrough: document.getElementById("clickThrough"),
  followCursor: document.getElementById("followCursor"),
  autoIdle: document.getElementById("autoIdle"),
  blinkEnabled: document.getElementById("blinkEnabled"),
  dockAutoHide: document.getElementById("dockAutoHide"),
  launchAtLogin: document.getElementById("launchAtLogin"),
  autostartWarn: document.getElementById("autostartWarn"),
  resetPos: document.getElementById("resetPos"),
  expCfg: document.getElementById("expCfg"),
  impCfg: document.getElementById("impCfg"),
  cfgToast: document.getElementById("cfgToast"),
  reset: document.getElementById("reset"),
  hotkeyMic: document.getElementById("hotkeyMic"),
  hotkeySummon: document.getElementById("hotkeySummon"),
  hotkeyMute: document.getElementById("hotkeyMute"),
  hotkeyResult: document.getElementById("hotkeyResult"),
  quit: document.getElementById("quit"),
  ver: document.getElementById("ver"),
  cacheDir: document.getElementById("cacheDir"),
  cacheDirPick: document.getElementById("cacheDirPick"),
  cacheDirOpen: document.getElementById("cacheDirOpen"),
  cacheDirClear: document.getElementById("cacheDirClear"),
  dataWipe: document.getElementById("dataWipe"),
  cacheDirInfo: document.getElementById("cacheDirInfo"),
  asrInfo: document.getElementById("asrInfo"),
  asrAction: document.getElementById("asrAction"),
  aboutEnv: document.getElementById("aboutEnv"),
  aboutVer: document.getElementById("aboutVer"),
  aboutLicense: document.getElementById("aboutLicense"),
  updCheck: document.getElementById("updCheck"),
  updBox: document.getElementById("updBox"),
  updResult: document.getElementById("updResult"),
  updOpen: document.getElementById("updOpen"),
  updNotes: document.getElementById("updNotes"),
  privacyBtn: document.getElementById("privacyBtn"),
  aboutData: document.getElementById("aboutData"),
  logOpen: document.getElementById("logOpen"),
  diagExport: document.getElementById("diagExport"),
  diagOpenBtn: document.getElementById("diagOpenBtn"),
  diagResult: document.getElementById("diagResult"),
  diagRunBtn: document.getElementById("diagRunBtn"),
  diagOpenReport: document.getElementById("diagOpenReport"),
  diagHead: document.getElementById("diagHead"),
  diagList: document.getElementById("diagList"),
  gameMode: document.getElementById("gameMode"),
  gameModeHint: document.getElementById("gameModeHint"),
  micDevice: document.getElementById("micDevice"),
  voiceId: document.getElementById("voiceId"),
  voiceTry: document.getElementById("voiceTry"),
  bridgeUrl: document.getElementById("bridgeUrl"),
  bridgeTest: document.getElementById("bridgeTest"),
  bridgeResult: document.getElementById("bridgeResult"),
  bridgeAddrs: document.getElementById("bridgeAddrs"),
  miniToggle: document.getElementById("miniToggle"),
  bridgeFix: document.getElementById("bridgeFix"),
  bridgeFixHint: document.getElementById("bridgeFixHint"),
  // RVC：八个一次加齐。els 是硬编码表，漏一个会让 paint() 抛出去、
  // 整个面板的按钮全部失效——这个坑踩过一次，不再踩。
  voiceOutSeg: document.getElementById("voiceOutSeg"),
  timbreSeg: document.getElementById("timbreSeg"),
  timbreNote: document.getElementById("timbreNote"),
  timbreTtsNote: document.getElementById("timbreTtsNote"),
  xttsBox: document.getElementById("xttsBox"),
  xttsRef: document.getElementById("xttsRef"),
  xttsSpeed: document.getElementById("xttsSpeed"),
  xttsState: document.getElementById("xttsState"),
  xttsPick: document.getElementById("xttsPick"),
  xttsTry: document.getElementById("xttsTry"),
  xttsEnvState: document.getElementById("xttsEnvState"),
  xttsInstall: document.getElementById("xttsInstall"),
  feiyuBox: document.getElementById("feiyuBox"),
  feiyuRefDir: document.getElementById("feiyuRefDir"),
  feiyuRefPick: document.getElementById("feiyuRefPick"),
  feiyuHome: document.getElementById("feiyuHome"),
  feiyuHomePick: document.getElementById("feiyuHomePick"),
  feiyuHomeInfo: document.getElementById("feiyuHomeInfo"),
  feiyuSpeed: document.getElementById("feiyuSpeed"),
  feiyuTry: document.getElementById("feiyuTry"),
  feiyuRefSel: document.getElementById("feiyuRefSel"),
  feiyuRefReload: document.getElementById("feiyuRefReload"),
  feiyuRefInfo: document.getElementById("feiyuRefInfo"),
  feiyuState: document.getElementById("feiyuState"),
  feiyuEnvState: document.getElementById("feiyuEnvState"),
  voiceOutFeiyuHint: document.getElementById("voiceOutFeiyuHint"),
  feiyuEngineState: document.getElementById("feiyuEngineState"),
  feiyuEngineCheck: document.getElementById("feiyuEngineCheck"),
  feiyuEngineCheck: document.getElementById("feiyuEngineCheck"),
  feiyuInstall: document.getElementById("feiyuInstall"),
  // 引擎状态卡（①）：状态点 / 标题 / 徽章 / 四个事实 / 启停 / 待机 / 目录校验
  engDot: document.getElementById("engDot"),
  engName: document.getElementById("engName"),
  engTag: document.getElementById("engTag"),
  engFactEngine: document.getElementById("engFactEngine"),
  engFactFirst: document.getElementById("engFactFirst"),
  engFactRtf: document.getElementById("engFactRtf"),
  engFactDevice: document.getElementById("engFactDevice"),
  engFactIdle: document.getElementById("engFactIdle"),
  engFactHome: document.getElementById("engFactHome"),
  engFallbackNote: document.getElementById("engFallbackNote"),
  engFeiyuRows: document.getElementById("engFeiyuRows"),
  feiyuEngineStart: document.getElementById("feiyuEngineStart"),
  feiyuEngineStop: document.getElementById("feiyuEngineStop"),
  feiyuHomeCheck: document.getElementById("feiyuHomeCheck"),
  feiyuIdleAuto: document.getElementById("feiyuIdleAuto"),
  feiyuIdleMin: document.getElementById("feiyuIdleMin"),
  feiyuIdleHint: document.getElementById("feiyuIdleHint"),
  rvcBox: document.getElementById("rvcBox"),
  rvcPython: document.getElementById("rvcPython"),
  rvcModel: document.getElementById("rvcModel"),
  rvcDevice: document.getElementById("rvcDevice"),
  rvcToggle: document.getElementById("rvcToggle"),
  rvcAutoStop: document.getElementById("rvcAutoStop"),
  rvcTest: document.getElementById("rvcTest"),
  rvcPickModel: document.getElementById("rvcPickModel"),
  rvcModelSel: document.getElementById("rvcModelSel"),
  rvcResult: document.getElementById("rvcResult"),
  rvcConvert: document.getElementById("rvcConvert"),
  rvcDropHint: document.getElementById("rvcDropHint"),
  rvcBackendSeg: document.getElementById("rvcBackendSeg"),
  rvcInstall: document.getElementById("rvcInstall"),
  rvcSetupLog: document.getElementById("rvcSetupLog"),
  miniResult: document.getElementById("miniResult"),
  replyModeSeg: document.getElementById("replyModeSeg"),
  apiBox: document.getElementById("apiBox"),
  apiBase: document.getElementById("apiBase"),
  apiKey: document.getElementById("apiKey"),
  apiModel: document.getElementById("apiModel"),
  apiTest: document.getElementById("apiTest"),
  apiResult: document.getElementById("apiResult"),
  seeBase: document.getElementById("seeBase"),
  seeModeSeg: document.getElementById("seeModeSeg"),
  seeModeHint: document.getElementById("seeModeHint"),
  seeApiBox: document.getElementById("seeApiBox"),
  seeKey: document.getElementById("seeKey"),
  seeModel: document.getElementById("seeModel"),
  seeInterval: document.getElementById("seeInterval"),
  seeGap: document.getElementById("seeGap"),
  seeSpeak: document.getElementById("seeSpeak"),
  voiceWarm: document.getElementById("voiceWarm"),
  mute: document.getElementById("mute"),
  // 闲置词：两个开关 + 预合成缓存的那一套控件
  idleSpeak: document.getElementById("idleSpeak"),
  idleBubble: document.getElementById("idleBubble"),
  idleLineCount: document.getElementById("idleLineCount"),
  idleCacheInfo: document.getElementById("idleCacheInfo"),
  idleCacheBuild: document.getElementById("idleCacheBuild"),
  idleCacheCancel: document.getElementById("idleCacheCancel"),
  idleCacheClear: document.getElementById("idleCacheClear"),
  idleCacheOpen: document.getElementById("idleCacheOpen"),
  idleCacheBar: document.getElementById("idleCacheBar"),
  idleCacheHint: document.getElementById("idleCacheHint"),
  idleCacheAuto: document.getElementById("idleCacheAuto"),
  seeTest: document.getElementById("seeTest"),
  seeResult: document.getElementById("seeResult"),
};

let cur = null;

// 塞进 innerHTML 的任何外部字符串（地址、cwd）都要先转义。
function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let micDeviceSel = null;

// 麦克风下拉旁边的提示行。以前权限失败被空 catch 吞掉，下拉里只剩「系统默认」，
// 用户以为是程序没找到设备 —— 其实多半是 Windows 那个「允许桌面应用访问麦克风」没开。
function showMicHint(text, warn) {
  try {
    const el = document.getElementById("micHint");
    if (!el) return;
    if (!text) { el.hidden = true; el.textContent = ""; return; }
    el.hidden = false;
    el.textContent = text;
    el.classList.toggle("warn", warn !== false);
  } catch (e) { }
}

function micErrDetail(e) {
  const lib = window.__fishMicErr;
  if (lib && typeof lib.micErrText === "function") return lib.micErrText(e).detail;
  return "没能打开麦克风：" + String((e && e.message) || e || "未知原因");
}

async function fillMicDevices(cur) {
  if (!micDeviceSel) micDeviceSel = els.micDevice;
  if (!micDeviceSel) return;
  try {
    // 没授过麦克风权限时 enumerateDevices 拿不到设备名（label 为空），
    // 先要一次权限（拿到就立刻关掉，不占用设备）。
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      showMicHint("");
    } catch (e) {
      // 拿不到权限不该只是个空下拉：把「下一步动哪里」直接写在下面。
      showMicHint(micErrDetail(e), true);
    }
    const list = await navigator.mediaDevices.enumerateDevices();
    const ins = list.filter((d) => d.kind === "audioinput");
    micDeviceSel.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "系统默认";
    micDeviceSel.appendChild(opt0);
    ins.forEach((d, i) => {
      const o = document.createElement("option");
      o.value = d.deviceId;
      o.textContent = d.label || ("麦克风 " + (i + 1));
      micDeviceSel.appendChild(o);
    });
    micDeviceSel.value = cur.micDevice || "";
    // 一个输入设备都没有：这是「插一个」的场景，不是「权限没给」。
    if (!ins.length) showMicHint("没检测到任何麦克风。插一个，或者到「设置 → 系统 → 声音 → 输入」看看设备有没有被禁用。", true);
  } catch (e) {
    showMicHint("读不到麦克风列表：" + String((e && e.message) || e), true);
  }
}

let voiceSel = null;
let voicesLoaded = false;

// 音色列表由主进程从引擎里读出来（浏览器拿不到那个数组）。
// 只在第一次打开设置时拉一次，之后缓存。
async function fillVoices(cur) {
  if (!voiceSel) voiceSel = els.voiceId;
  if (!voiceSel) return;
  if (!voicesLoaded) {
    try {
      const r = await fetch("/engine/voices", { signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      const list = (j && j.voices) || [];
      voiceSel.innerHTML = "";
      // 留一个「跟随引擎默认」，这样以后换默认值不用改设置。
      const o0 = document.createElement("option");
      o0.value = "";
      o0.textContent = "跟随默认（晓萱）";
      voiceSel.appendChild(o0);
      list.forEach((v) => {
        const o = document.createElement("option");
        o.value = v.id;
        o.textContent = v.label || v.id;
        voiceSel.appendChild(o);
      });
      voicesLoaded = true;
    } catch (e) {
      // 拿不到列表就只留一项，至少不影响别的设置
      voiceSel.innerHTML = '<option value="">跟随默认</option>';
    }
  }
  voiceSel.value = cur.voiceId || "";
}

async function tryVoice() {
  const btn = els.voiceTry;
  const cur = await window.deskfish.settingsGet();
  const v = (els.voiceId && els.voiceId.value) || "";
  if (btn) { btn.disabled = true; btn.textContent = "合成中…"; }
  try {
    const r = await fetch("/engine/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "我是大肥鱼，这个声音你听着还喜欢吗？", voice: v }),
      signal: AbortSignal.timeout(60000),
    });
    const j = await r.json();
    if (!j || !j.ok || !j.url) throw new Error((j && j.error) || "没合成出来");
    const a = new Audio(location.origin + j.url);
    await a.play();
  } catch (e) {
    // 这里原来写的是 els.bridgeResult —— 那是「连接与模型」页的桥接结果区。
    // 用户在「声音与行为」页点试听，报错却跑到另一个页签里，等于看不见。
    cfgToast("试听失败：" + String((e && e.message) || e).slice(0, 60), true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "试听"; }
  }
}

// ---- 快捷键：录制式输入 ----
function accelLabel(a) {
  if (!a) return "";
  return String(a)
    .replace(/CommandOrControl|CmdOrCtrl/gi, "Ctrl")
    .replace(/Super/gi, "Win")
    .replace(/Control/gi, "Ctrl")
    .split("+").join(" + ");
}

function keyFromEvent(e) {
  const code = e.code || "";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  if (code === "Space") return "Space";
  if (code === "Enter") return "Enter";
  if (code === "Tab") return "Tab";
  if (code === "Home" || code === "End" || code === "PageUp" || code === "PageDown" || code === "Insert") return code;
  if (/^Arrow(Up|Down|Left|Right)$/.test(code)) return code.slice(5);
  return "";
}

let recording = null;
function stopRecording() {
  if (!recording) return;
  const { el, key } = recording;
  window.removeEventListener("keydown", onRecordKey, true);
  el.classList.remove("recording");
  recording = null;
  el.textContent = accelLabel(cur && cur[key]) || "未设置";
  el.classList.toggle("empty", !(cur && cur[key]));
}

function onRecordKey(e) {
  if (!recording) return;
  e.preventDefault();
  e.stopPropagation();
  const key = recording.key;

  if (e.key === "Escape") { stopRecording(); return; }

  if ((e.code === "Backspace" || e.code === "Delete") && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
    stopRecording();
    saveHotkey(key, "");
    return;
  }

  const k = keyFromEvent(e);
  if (!k) {
    const mods = [];
    if (e.ctrlKey) mods.push("Ctrl");
    if (e.altKey) mods.push("Alt");
    if (e.shiftKey) mods.push("Shift");
    if (e.metaKey) mods.push("Win");
    recording.el.textContent = mods.length ? mods.join(" + ") + " + …" : "按下组合键…";
    return;
  }
  const mods = [];
  const accelMods = [];
  if (e.ctrlKey) { mods.push("Ctrl"); accelMods.push("CommandOrControl"); }
  if (e.altKey) { mods.push("Alt"); accelMods.push("Alt"); }
  if (e.shiftKey) { mods.push("Shift"); accelMods.push("Shift"); }
  if (e.metaKey) { mods.push("Win"); accelMods.push("Super"); }
  if (!accelMods.length && !/^F/.test(k)) {
    recording.el.textContent = "要带 Ctrl / Alt / Shift";
    setTimeout(() => { if (recording && recording.key === key) recording.el.textContent = "按下组合键…"; }, 1200);
    return;
  }
  const accel = accelMods.concat(k).join("+");
  stopRecording();
  saveHotkey(key, accel);
}

async function saveHotkey(key, accel) {
  // 伸懒腰是固定的 Ctrl+Alt+S，不参与自定义；但用户仍可能录到它。
  const norm = (v) => String(v || "").toLowerCase().replace(/commandorcontrol/g, "ctrl").replace(/\s+/g, "");
  if (accel && norm(accel) === norm("CommandOrControl+Alt+S")) {
    if (els.hotkeyResult) {
      els.hotkeyResult.className = "result bad";
      els.hotkeyResult.textContent = "✗ 这个组合被「伸懒腰」占用了，换一个";
    }
    paintHotkeys(cur);
    return;
  }
  // 三个功能共用一个加速键池：任何一个都不能和另外两个撞。
  const clash = ["hotkeyMic", "hotkeySummon", "hotkeyMute"].find((k) => {
    if (k === key) return false;
    const v = (cur && cur[k]) || "";
    return !!(accel && v && norm(accel) === norm(v));
  });
  if (clash) {
    if (els.hotkeyResult) {
      els.hotkeyResult.className = "result bad";
      els.hotkeyResult.textContent = "✗ 这个组合已经给另一个功能了，换一个";
    }
    paintHotkeys(cur);
    return;
  }
  await push({ [key]: accel });
  refreshHotkeyStatus();
}

async function refreshHotkeyStatus() {
  if (!els.hotkeyResult) return;
  try {
    const st = await api.hotkeyStatus();
    // 两种「没生效」要分开说：
    //  - 被别的软件占用 —— 用户得去关掉那个软件，或者换一个键；
    //  - 和自己的另一个功能用同一个键 —— 主进程只保留一个，用户改自己的设置就行。
    // 混成一句「被别的软件占用」，用户会去卸载/换软件，白折腾。
    const dupMap = new Map(((st && st.skipped) || []).map((x) => [x.key, x]));
    const miss = [];
    const dup = [];
    const put = (key, label, accel) => {
      if (!accel) return;
      // 先看是不是自己撞的：撞车的那个键其实「在 bound 里」（另一个功能注册成功了），
      // 只看 bound 会把两个功能都说成「已生效」，而实际只有一个能用。
      if (dupMap.has(key)) { dup.push(label + " " + accelLabel(accel)); return; }
      if (st.bound.includes(accel)) return;
      miss.push(label + " " + accelLabel(accel));
    };
    put("hotkeyMic", "开麦", st.mic);
    put("hotkeySummon", "唤出", st.summon);
    put("hotkeyMute", "静音", st.mute);
    if (miss.length || dup.length) {
      const parts = [];
      if (miss.length) parts.push("被别的软件占用，没注册上：" + miss.join("、"));
      if (dup.length) parts.push("和另一个功能用了同一个键，只生效了一个：" + dup.join("、"));
      els.hotkeyResult.className = "result bad";
      els.hotkeyResult.textContent = "⚠ " + parts.join("\n⚠ ") + "（换一个键试试）";
    } else if (st.mic || st.summon || st.mute) {
      els.hotkeyResult.className = "result ok";
      els.hotkeyResult.textContent = "● 快捷键已生效" +
        (st.mic ? " · 开麦 " + accelLabel(st.mic) : " · 开麦未设置") +
        (st.summon ? " · 唤出 " + accelLabel(st.summon) : "") +
        (st.mute ? " · 静音 " + accelLabel(st.mute) : "");
    } else {
      els.hotkeyResult.className = "result";
      els.hotkeyResult.textContent = "快捷键都空着：功能还在，只是没有键盘入口";
    }
  } catch (e) { }
}

// 开关说「开」，注册表里未必有 —— 安全软件、组策略、注册表权限都可能拦掉。
// 这里不看设置值，看主进程回读的注册表事实，把矛盾直接摆出来。
async function refreshAutostart() {
  if (!els.autostartWarn) return;
  try {
    const st = await api.autostartStatus?.();
    if (!st) return;
    if (st.want && !st.present) {
      els.autostartWarn.style.display = "";
      els.autostartWarn.textContent = "⚠ 开关是开的，但注册表里没有这一项 —— 开机不会自动启动。可能被安全软件或组策略拦了。";
    } else if (!st.want && st.present) {
      els.autostartWarn.style.display = "";
      els.autostartWarn.textContent = "⚠ 开关是关的，但注册表里还留着旧的启动项。注销重登可能还会自己起来。";
    } else {
      els.autostartWarn.style.display = "none";
      els.autostartWarn.textContent = "";
    }
  } catch (e) { }
}

function paintHotkeys(s) {
  for (const [key, el] of [["hotkeyMic", els.hotkeyMic], ["hotkeySummon", els.hotkeySummon], ["hotkeyMute", els.hotkeyMute]]) {
    if (!el || (recording && recording.key === key)) continue;
    const v = (s && s[key]) || "";
    el.textContent = v ? accelLabel(v) : "未设置";
    el.classList.toggle("empty", !v);
  }
}

function bindHotkey(el, key) {
  if (!el) return;
  el.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (recording) stopRecording();
    recording = { el, key };
    el.classList.add("recording");
    el.textContent = "按下组合键…";
    window.addEventListener("keydown", onRecordKey, true);
  });
}

bindHotkey(els.hotkeyMic, "hotkeyMic");
bindHotkey(els.hotkeySummon, "hotkeySummon");
bindHotkey(els.hotkeyMute, "hotkeyMute");

function paint(s) {
  cur = s;  els.scaleNum.value = Math.round(s.scale * 100);
  els.opacityNum.value = Math.round(s.opacity * 100);
  els.volumeNum.value = Math.round((s.volume === undefined ? 0.85 : s.volume) * 100);
  if (els.bridgeUrl) els.bridgeUrl.value = s.bridgeUrl || "";
  if (els.apiBase) els.apiBase.value = s.apiBase || "";
  if (els.apiKey) els.apiKey.value = s.apiKey || "";
  if (els.apiModel) els.apiModel.value = s.apiModel || "";
  if (els.seeBase) els.seeBase.value = s.seeBase || "";
  if (els.seeKey) els.seeKey.value = s.seeKey || "";
  if (els.seeModel) els.seeModel.value = s.seeModel || "";
  if (els.seeInterval) els.seeInterval.value = String(s.seeInterval == null ? 1.6 : s.seeInterval);
  if (els.seeGap) els.seeGap.value = String(s.seeGap == null ? 7 : s.seeGap);
  if (els.seeSpeak) {
    const on = s.seeSpeak !== false;
    els.seeSpeak.classList.toggle("on", on);
    els.seeSpeak.setAttribute("aria-checked", on ? "true" : "false");
  }
  if (els.voiceWarm) {
    const on = s.voiceWarm === true;
    els.voiceWarm.classList.toggle("on", on);
    els.voiceWarm.setAttribute("aria-checked", on ? "true" : "false");
  }
  if (els.mute) {
    els.mute.classList.toggle("on", s.mute === true);
    els.mute.setAttribute("aria-checked", s.mute === true ? "true" : "false");
  }
  // 闲置词的两个开关：默认都是开（说 + 冒），只有显式 false 才算关。
  for (const [key, el] of [["idleSpeak", els.idleSpeak], ["idleBubble", els.idleBubble], ["idleCacheAuto", els.idleCacheAuto]]) {
    if (!el) continue;
    const on = s[key] !== false;
    el.classList.toggle("on", on);
    el.setAttribute("aria-checked", on ? "true" : "false");
  }
  // 看屏幕：默认程序自带（不填接口），只有填了地址才算「外部接口」
  if (els.seeModeSeg) {
    // 手点了「外部接口」但还没填地址时，不能被一次普通重绘把输入框收回去
    // （否则提示已经说「走外部接口」，地址/模型框却消失，没法继续填）。
    const pinnedApi = !!(els.seeApiBox && els.seeApiBox.dataset.pinned === "1");
    const useApi = !!String(s.seeBase || "").trim() || pinnedApi;
    for (const b of els.seeModeSeg.children) {
      b.classList.toggle("on", b.dataset.v === (useApi ? "api" : "own"));
    }
    if (els.seeApiBox) els.seeApiBox.classList.toggle("hidden", !useApi);
    if (els.seeModeHint) {
      if (useApi) {
        els.seeModeHint.textContent = "现在走外部视觉接口。截图仍然只在本机抓，只有这一帧图和一句提示会发到你填的地址。";
      } else {
        els.seeModeHint.textContent = "默认用程序自带的看图逻辑：要有本机 DSH 的桥接在跑，发行版不带它。报「没在运行」就切到外部接口。";
        // 自带通道依赖本机那只桥接。开着这一页就把结论摆出来，
        // 别让人点了「试一眼」才吃到一句报错。
        window.deskfish
          .miniStatus()
          .then((st) => {
            if (!st || st.running) return;
            const on = els.seeModeSeg && els.seeModeSeg.querySelector(".on");
            if (!on || on.dataset.v !== "own") return; // 人已经切走了就别管
            if (els.seeModeHint) {
              els.seeModeHint.textContent =
                "程序自带的看图逻辑要本机桥接，现在没在跑——点「试一眼」只会报错。去「连接与模型」填地址，或者切到外部接口。";
            }
          })
          .catch(() => {});
      }
    }
  }
  if (els.replyModeSeg) {
    for (const b of els.replyModeSeg.children) {
      b.classList.toggle("on", b.dataset.v === (s.replyMode || "dsh"));
    }
  }
  // 选 DSH 时把 API 那块收起来，免得一排输入框看着像必须填
  if (els.apiBox) els.apiBox.classList.toggle("hidden", (s.replyMode || "dsh") !== "api");

  // 语音输出：TTS / RVC / XTTS。选谁就展开谁那一块。
  if (els.voiceOutSeg) {
    for (const b of els.voiceOutSeg.children) {
      b.classList.toggle("on", b.dataset.v === (s.voiceOut || "tts"));
    }
  }
  if (els.rvcBox) els.rvcBox.classList.toggle("hidden", (s.voiceOut || "tts") !== "rvc");
  if (els.xttsBox) els.xttsBox.classList.toggle("hidden", (s.voiceOut || "tts") !== "xtts");
  if (els.feiyuBox) els.feiyuBox.classList.toggle("hidden", (s.voiceOut || "tts") !== "feiyu");
  // 状态卡里飞鱼专有的那几行（目录/安装/待机/预热）只在选飞鱼时露出来；
  // 选 TTS 时它们没有意义，露着只会让人以为必须配。
  if (els.engFeiyuRows) els.engFeiyuRows.classList.toggle("hidden", (s.voiceOut || "tts") !== "feiyu");
  if (els.feiyuIdleAuto) {
    const idleOn = s.feiyuIdleAuto !== false;
    els.feiyuIdleAuto.classList.toggle("on", idleOn);
    els.feiyuIdleAuto.setAttribute("aria-checked", idleOn ? "true" : "false");
  }
  if (els.feiyuIdleMin && document.activeElement !== els.feiyuIdleMin) {
    const m = Number(s.feiyuIdleMin);
    els.feiyuIdleMin.value = s.feiyuIdleAuto === false ? "" : String(Number.isFinite(m) && m > 0 ? m : 10);
  }
  // 面板一打开就把引擎状态拉一次（startFeiyuPoll 是幂等的，重复调只起一个定时器）。
  try { startFeiyuPoll(); } catch (e) { }
  // 选飞鱼但人在「听与说」页时，告诉他声线在隔壁页 —— 主人问过「飞鱼的模型选择怎么丢了」。
  if (els.voiceOutFeiyuHint) {
    els.voiceOutFeiyuHint.style.display = (s.voiceOut || "tts") === "feiyu" ? "" : "none";
  }
  if (els.timbreSeg) {
    for (const b of els.timbreSeg.children) {
      b.classList.toggle("on", b.dataset.v === (s.voiceOut || "tts"));
    }
  }
  if (els.timbreTtsNote) {
    els.timbreTtsNote.classList.toggle("hidden", (s.voiceOut || "tts") !== "tts");
  }
  if (els.timbreNote) {
    const v = s.voiceOut || "tts";
    els.timbreNote.textContent = v === "tts"
      ? "TTS 用的是上面选的音色（内置引擎），不需要装任何东西，开箱就能说话。想要更有个性的嗓子，再选 RVC / XTTS / 飞鱼。"
      : v === "rvc" ? "RVC 在 TTS 后面换一遍嗓子：需要 Python 环境和 .onnx/.pth 模型，第一次用点下面的「启动」。"
      : v === "xtts" ? "XTTS 从参考音频克隆音色：需要 Python 环境，第一次加载约 70 秒。"
      : "飞鱼是中文原生声线：整套约 14 GB，点下面的「一键安装」自动下。";
  }
  if (els.feiyuRefDir) els.feiyuRefDir.value = s.feiyuRefDir || "";
  if (els.feiyuHome) els.feiyuHome.value = s.feiyuHome || "";
  if (els.feiyuHomeInfo) {
    els.feiyuHomeInfo.className = "hint";
    els.feiyuHomeInfo.textContent = s.feiyuHome
      ? "已设为 " + s.feiyuHome + "（下面要有 venv / models / cosyvoice）"
      : "留空 = 自动找：包内 feiyu/ → D:\\feiyu";
  }
  // 0 在服务端表示「用模型默认语速」；把 0 显示成数字会让人以为能听出 0 倍速，留空更诚实
  if (els.feiyuSpeed) els.feiyuSpeed.value = !s.feiyuSpeed ? "" : String(s.feiyuSpeed);
  // 下拉的 value 就是设置里的 feiyuRef，直接对上即可（push 之后会重新 paint，不会打架）
  if (els.feiyuRefSel) els.feiyuRefSel.value = s.feiyuRef || "";
  // 状态行别老是「未启用」——选了她就是启用状态，只有真跑过一轮才有引擎耗时。
  // 试听写过结果（带「引擎」前缀）就别覆盖，那是更具体的信息。
  // 状态那一行（#feiyuState）现在归状态卡管：它要按「没装齐 / 未启动 / 装载中 / 就绪」
  // 四种情况说不同的话，还要带「回落 TTS」的实情，所以 paint() 不再覆盖它，
  // 只在还没被状态卡写过时给一句初始文案。
  if (els.feiyuState && !String(els.feiyuState.textContent || "").trim()) {
    els.feiyuState.className = "notice";
    els.feiyuState.textContent = "正在读取引擎状态…";
  }
  if (els.xttsRef) els.xttsRef.value = s.xttsRef || "";
  if (els.xttsSpeed) els.xttsSpeed.value = String(s.xttsSpeed == null ? 1 : s.xttsSpeed);
  if (els.rvcPython) els.rvcPython.value = s.rvcPython || "";
  if (els.rvcModel) els.rvcModel.value = s.rvcModel || "";
  if (els.rvcDevice) els.rvcDevice.value = s.rvcDevice || "dml";
  if (els.rvcBackendSeg) {
    for (const b of els.rvcBackendSeg.children) {
      b.classList.toggle("on", (b.dataset.v || "") === (s.rvcBackend || "onnx"));
    }
  }

  for (const b of els.resSeg.children) {
    b.classList.toggle("on", Number(b.dataset.v) === s.resolution);
  }
  // 贴图精度：0=自动。老设置里没这一项时按 0 显示，跟实际行为一致。
  if (els.texSeg) {
    const want = Number(s.texMax) >= 0 ? Number(s.texMax) : 0;
    for (const b of els.texSeg.children) {
      b.classList.toggle("on", Number(b.dataset.v) === want);
    }
  }
  // 表情开关贴片：1=开（默认），0=关
  if (els.patchSeg) {
    const on = s.exprPatch === false ? 0 : 1;
    for (const b of els.patchSeg.children) {
      b.classList.toggle("on", Number(b.dataset.v) === on);
    }
  }
  for (const key of ["sharpen", "alwaysOnTop", "clickThrough", "followCursor", "autoIdle", "blinkEnabled", "launchAtLogin", "dockAutoHide"]) {    // 判空：少一个元素只跳过它，不能让 paint() 抛出去——    // 这里一抛，后面所有按钮的 addEventListener 都不会执行，整个面板就「点了没反应」。
    const el = els[key];
    if (el) {
      const on = s[key] === true;
      el.classList.toggle("on", on);
      el.setAttribute("aria-checked", on ? "true" : "false");
    }
  }

  if (els.fpsSeg) {
    for (const b of els.fpsSeg.children) {
      b.classList.toggle("on", Number(b.dataset.v) === Number(s.fpsCap || 30));
    }
  }

  paintView();
  paintHotkeys(s);
}

async function push(patch) {
  // 写盘失败时主进程会带 ok:false 回来。不判它的话，面板照常刷新、看着像成功了，
  // 用户重启才发现改的全没了 —— 而且没有任何提示。
  try {
    const s = await api.settingsPatch(patch);
    paint(s);
    if (s && s.ok === false) cfgToast("设置没存上：" + (s.error || "磁盘写入失败"), true);
    // 开机自启是写注册表，开关照样能拨、但可能根本没写进去。
    if (s && s.autostart && s.autostart.ok === false) {
      cfgToast("开机自启没设置成功：" + (s.autostart.error || "注册表写入失败"), true);
    }
    if (patch && Object.prototype.hasOwnProperty.call(patch, "launchAtLogin")) refreshAutostart();
  } catch (e) {
    cfgToast("设置没存上：" + ((e && e.message) || e), true);
    // 开关是乐观更新的：点下去界面已经翻了。写盘失败必须把它纠正回来，
    // 否则界面在说谎 —— 用户以为开了，重启一看是关的。
    try { paint(await api.settingsGet()); } catch (e2) { }
  }
}

// ---- 大小 / 不透明度：数字输入，回车或点「应用」才提交 ----
function commitScale() {
  let v = Number(els.scaleNum.value);
  if (!Number.isFinite(v)) { paint(cur); return; }
  v = Math.max(50, Math.min(200, Math.round(v)));
  els.scaleNum.value = v;
  if (Math.abs(v / 100 - cur.scale) < 1e-6) return;
  push({ scale: v / 100 });
}
function commitOpacity() {
  let v = Number(els.opacityNum.value);
  if (!Number.isFinite(v)) { paint(cur); return; }
  v = Math.max(30, Math.min(100, Math.round(v)));
  els.opacityNum.value = v;
  if (Math.abs(v / 100 - cur.opacity) < 1e-6) return;
  push({ opacity: v / 100 });
}
function commitVolume() {
  let v = Number(els.volumeNum.value);
  if (!Number.isFinite(v)) { paint(cur); return; }
  v = Math.max(0, Math.min(100, Math.round(v)));
  els.volumeNum.value = v;
  if (Math.abs(v / 100 - Number(cur.volume || 0)) < 1e-6) return;
  push({ volume: v / 100 });
}

els.scaleApply.addEventListener("click", commitScale);
els.scaleNum.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); commitScale(); els.scaleNum.blur(); }
  // stopPropagation 是必须的：不拦住的话事件会冒到 window，
  // 被下面那个「Esc 关闭设置窗」接走——用户想撤销输入，结果窗口没了。
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); paint(cur); els.scaleNum.blur(); }
});
els.scaleNum.addEventListener("blur", commitScale);

els.opacityApply.addEventListener("click", commitOpacity);
els.opacityNum.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); commitOpacity(); els.opacityNum.blur(); }
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); paint(cur); els.opacityNum.blur(); }
});
els.opacityNum.addEventListener("blur", commitOpacity);

els.volumeApply.addEventListener("click", commitVolume);
els.volumeNum.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); commitVolume(); els.volumeNum.blur(); }
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); paint(cur); els.volumeNum.blur(); }
});
els.volumeNum.addEventListener("blur", commitVolume);

// ---- 麦克风 ----
els.micDevice.addEventListener("change", () => {
  console.log("[mic] change -> " + els.micDevice.value + " (" + els.micDevice.selectedIndex + ")");
  push({ micDevice: els.micDevice.value || "" });
});
console.log("[mic] 绑定完成，选项数=" + els.micDevice.options.length);

// ---- 说话的声音 ----
// 选了就存，不用点保存；试听只是拿当前选择合成一句。
els.voiceId.addEventListener("change", () => {
  push({ voiceId: els.voiceId.value || "" });
});
els.voiceTry.addEventListener("click", () => {
  tryVoice();
});

// ---- 回复模型：DSH 还是自定义 API ----
if (els.replyModeSeg) {
  els.replyModeSeg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    push({ replyMode: b.dataset.v });
  });
}

// 三个输入框：失焦和回车都存一次，别让人以为没生效
for (const [el, key] of [
  [els.apiBase, "apiBase"],
  [els.apiKey, "apiKey"],
  [els.apiModel, "apiModel"],
]) {
  if (!el) continue;
  el.addEventListener("change", () => push({ [key]: el.value || "" }));
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); push({ [key]: el.value || "" }); }
  });
}

// ---- 看屏幕：视觉接口与节奏 ----
for (const [el, key] of [
  [els.seeBase, "seeBase"],
  [els.seeKey, "seeKey"],
  [els.seeModel, "seeModel"],
]) {
  if (!el) continue;
  el.addEventListener("change", () => push({ [key]: el.value || "" }));
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); push({ [key]: el.value || "" }); }
  });
}

for (const [el, key, lo, hi, dflt] of [
  [els.seeInterval, "seeInterval", 0.8, 6, 1.6],
  [els.seeGap, "seeGap", 3, 60, 7],
]) {
  if (!el) continue;
  const commit = () => {
    const v = Number(el.value);
    if (!Number.isFinite(v)) { el.value = String(dflt); paint(cur); return; }
    const n = Math.max(lo, Math.min(hi, v));
    el.value = String(n);
    if (Math.abs(n - Number(cur[key])) < 1e-6) return;
    push({ [key]: n });
  };
  el.addEventListener("change", commit);
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
  });
}

if (els.seeSpeak) {
  els.seeSpeak.addEventListener("click", () => push({ seeSpeak: !(cur && cur.seeSpeak !== false) }));
}

if (els.voiceWarm) {
  els.voiceWarm.addEventListener("click", () => push({ voiceWarm: !(cur && cur.voiceWarm === true) }));
}

if (els.seeTest) {
  els.seeTest.addEventListener("click", async () => {
    if (!cur) return;
    els.seeTest.disabled = true;
    els.seeTest.textContent = "看着…";
    if (els.seeResult) { els.seeResult.className = "result"; els.seeResult.textContent = ""; }
    try {
      // 先把输入框里的配置存下来，再抓一帧——否则刚填的模型地址没生效。
      await push({
        seeBase: (els.seeBase && els.seeBase.value.trim()) || "",
        seeKey: (els.seeKey && els.seeKey.value) || "",
        seeModel: (els.seeModel && els.seeModel.value.trim()) || "",
      });
      const r = await api.seeSnapshot();
      if (r && r.ok && r.text) {
        if (els.seeResult) {
          els.seeResult.className = "result ok";
          els.seeResult.textContent = "● 她说：" + r.text;
        }
      } else if (r && r.ok && r.skipped) {
        if (els.seeResult) {
          els.seeResult.className = "result";
          els.seeResult.textContent = "这一帧和上一帧差不多，她没开口。动一下窗口再试。";
        }
      } else {
        if (els.seeResult) {
          els.seeResult.className = "result bad";
          els.seeResult.textContent = "✗ " + ((r && r.error) || (r && r.busy ? "她还在看上一帧" : "没看成"));
        }
      }
    } catch (e) {
      if (els.seeResult) {
        els.seeResult.className = "result bad";
        els.seeResult.textContent = "✗ " + String((e && e.message) || e).slice(0, 160);
      }
    } finally {
      els.seeTest.disabled = false;
      els.seeTest.textContent = "试一眼";
    }
  });
}

// ---- 语音输出：TTS 还是 RVC ----
if (els.voiceOutSeg) {
  els.voiceOutSeg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    push({ voiceOut: b.dataset.v });
  });
}

if (els.timbreSeg) {
  els.timbreSeg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    push({ voiceOut: b.dataset.v });
  });
}

if (els.seeModeSeg) {
  els.seeModeSeg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.v === "own") {
      // 切回自带：清掉外部地址和模型，别让旧配置偷偷生效
      if (els.seeApiBox) delete els.seeApiBox.dataset.pinned;
      push({ seeBase: "", seeModel: "", seeKey: "" });
    } else {
      if (els.seeApiBox) {
        els.seeApiBox.dataset.pinned = "1";
        els.seeApiBox.classList.remove("hidden");
      }
      if (els.seeBase) els.seeBase.focus();
    }
  });
}

if (els.rvcBackendSeg) {
  els.rvcBackendSeg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    // 换引擎要重启服务才生效——下面的 device 提示也跟着变，
    // onnx 用 dml，pth 只能 cuda:0 / cpu。
    const v = b.dataset.v;
    push({ rvcBackend: v, rvcDevice: v === "onnx" ? "dml" : "cuda:0" });
    if (els.rvcResult) {
      els.rvcResult.className = "result";
      els.rvcResult.textContent = "引擎改成了 " + v + "，点一下「启动」让它生效";
    }
  });
}

if (els.rvcInstall) {
  els.rvcInstall.addEventListener("click", async () => {
    els.rvcInstall.disabled = true;
    if (els.rvcSetupLog) els.rvcSetupLog.textContent = "开始安装…（约 1.7GB，要几分钟）";
    try {
      const st = await api.rvcSetup();
      if (!st || !st.running) {
        if (els.rvcSetupLog) els.rvcSetupLog.textContent = "没启动起来：" + ((st && st.error) || "未知原因");
      }
    } catch (e) {
      if (els.rvcSetupLog) els.rvcSetupLog.textContent = "启动失败：" + String(e && e.message || e);
    } finally {
      els.rvcInstall.disabled = false;
    }
  });
}

// 安装脚本的每一行进度都显示出来——装 1.7GB 要几分钟，不给反馈人会以为卡死了。
if (api.onRvcSetup) {
  api.onRvcSetup((line) => {
    if (!els.rvcSetupLog) return;
    const s = String(line || "");
    els.rvcSetupLog.textContent = (els.rvcSetupLog.textContent ? els.rvcSetupLog.textContent + "\n" : "") + s;
    els.rvcSetupLog.scrollTop = els.rvcSetupLog.scrollHeight;
    if (s.indexOf("[done]") === 0 && els.rvcResult) {
      els.rvcResult.className = "result ok";
      els.rvcResult.textContent = "● 环境装好了，点「启动」";
    }
    if (s.indexOf("[error]") === 0 && els.rvcResult) {
      els.rvcResult.className = "result bad";
      els.rvcResult.textContent = "✗ 安装没完成，看下面的日志";
    }
  });
}

// ---- XTTS 环境：检查 / 一键装 -------------------------------------------
// 装的是约 6GB（torch CUDA 2.3G + 依赖 + 模型 1.8G），所以进度只显示当前那一步，
// 不把整个日志堆上来——那会让这块面板一下变成一屏字。
async function refreshXtssEnv() {
  if (!els.xttsEnvState || !api.xttsSetupStatus) return;
  try {
    const st = await api.xttsSetupStatus();
    if (st && st.installed) {
      els.xttsEnvState.className = "hint ok";
      els.xttsEnvState.textContent = "环境已就绪";
      if (els.xttsInstall) els.xttsInstall.classList.add("hidden");
    } else if (st && st.running) {
      els.xttsEnvState.className = "hint";
      els.xttsEnvState.textContent = "正在安装…";
      if (els.xttsInstall) els.xttsInstall.classList.add("hidden");
    } else {
      els.xttsEnvState.className = "hint";
      els.xttsEnvState.textContent = "还没装运行环境（约 6GB）";
      if (els.xttsInstall) els.xttsInstall.classList.remove("hidden");
    }
  } catch (e) {
    els.xttsEnvState.className = "hint bad";
    els.xttsEnvState.textContent = "查不到环境状态";
  }
}
refreshXtssEnv();
refreshFeiyuEnv();

if (els.xttsInstall) {
  els.xttsInstall.addEventListener("click", async () => {
    els.xttsInstall.disabled = true;
    if (els.xttsEnvState) {
      els.xttsEnvState.className = "hint";
      els.xttsEnvState.textContent = "开始安装…（约 6GB，十几分钟，装着的时候可以去干别的）";
    }
    try {
      const st = await api.xttsSetup();
      if (st && st.installed) {
        if (els.xttsEnvState) { els.xttsEnvState.className = "hint ok"; els.xttsEnvState.textContent = "环境已就绪"; }
        if (els.xttsInstall) els.xttsInstall.classList.add("hidden");
      }
    } catch (e) {
      if (els.xttsEnvState) {
        els.xttsEnvState.className = "hint bad";
        els.xttsEnvState.textContent = "启动安装失败：" + String(e && e.message || e);
      }
    } finally {
      els.xttsInstall.disabled = false;
    }
  });
}

if (api.onXtssSetup) {
  api.onXtssSetup((line) => {
    const s = String(line || "");
    if (!els.xttsEnvState) return;
    // 只抓关键几类行：步骤、下载进度、完成、错误
    if (s.indexOf("[step]") === 0) {
      els.xttsEnvState.className = "hint";
      els.xttsEnvState.textContent = s.replace(/^\[step\]\s*/, "");
    } else if (s.indexOf("[dl]") === 0) {
      els.xttsEnvState.className = "hint";
      els.xttsEnvState.textContent = "下载中 · " + s.replace(/^\[dl\]\s*/, "");
    } else if (s.indexOf("[done]") === 0) {
      els.xttsEnvState.className = "hint ok";
      els.xttsEnvState.textContent = "装好了，切到 XTTS 就能用";
      if (els.xttsInstall) els.xttsInstall.classList.add("hidden");
    } else if (s.indexOf("[error]") === 0) {
      els.xttsEnvState.className = "hint bad";
      els.xttsEnvState.textContent = s.replace(/^\[error\]\s*/, "").slice(0, 200);
    } else if (s.indexOf("[!]") === 0) {
      try { console.warn("[xtts-setup] " + s); } catch (e) { }
    }
  });
}

// ---- 飞鱼声线：环境状态 + 一键安装 --------------------------------------
// 比 XTTS 大一倍多（约 14GB），所以文案里明说大小和「可以关窗口，下次接着装」。
async function refreshFeiyuEnv() {
  if (!els.feiyuEnvState || !api.feiyuSetupStatus) return;
  try {
    const st = await api.feiyuSetupStatus();
    if (st && st.installed) {
      els.feiyuEnvState.className = "hint ok";
      els.feiyuEnvState.textContent = "已装好 · " + (st.home || "");
      if (els.feiyuInstall) els.feiyuInstall.classList.add("hidden");
    } else if (st && st.running) {
      els.feiyuEnvState.className = "hint";
      els.feiyuEnvState.textContent = "正在安装…";
      if (els.feiyuInstall) els.feiyuInstall.classList.add("hidden");
    } else if (st && st.hasEnv && !st.hasVoice) {
      els.feiyuEnvState.className = "hint";
      els.feiyuEnvState.textContent = "运行环境有了，声库没下完（约 7.1GB）";
      if (els.feiyuInstall) els.feiyuInstall.classList.remove("hidden");
    } else {
      els.feiyuEnvState.className = "hint";
      els.feiyuEnvState.textContent = "还没装（约 14GB）· " + (st && st.home || "");
      if (els.feiyuInstall) els.feiyuInstall.classList.remove("hidden");
    }
  } catch (e) {
    els.feiyuEnvState.className = "hint bad";
    els.feiyuEnvState.textContent = "查不到环境状态";
  }
}

if (els.feiyuInstall) {
  els.feiyuInstall.addEventListener("click", async () => {
    els.feiyuInstall.disabled = true;
    if (els.feiyuEnvState) {
      els.feiyuEnvState.className = "hint";
      els.feiyuEnvState.textContent = "开始安装…（约 14GB，可能要半小时以上；可以关掉这个窗口，装完再回来看）";
    }
    try {
      const st = await api.feiyuSetup();
      if (st && st.installed) {
        if (els.feiyuEnvState) { els.feiyuEnvState.className = "hint ok"; els.feiyuEnvState.textContent = "已装好"; }
        if (els.feiyuInstall) els.feiyuInstall.classList.add("hidden");
      }
    } catch (e) {
      if (els.feiyuEnvState) {
        els.feiyuEnvState.className = "hint bad";
        els.feiyuEnvState.textContent = "启动安装失败：" + String(e && e.message || e);
      }
    } finally {
      els.feiyuInstall.disabled = false;
    }
  });
}

if (api.onFeiyuSetup) {
  api.onFeiyuSetup((line) => {
    const s = String(line || "");
    if (!els.feiyuEnvState) return;
    if (s.indexOf("[step]") === 0) {
      els.feiyuEnvState.className = "hint";
      els.feiyuEnvState.textContent = s.replace(/^\[step\]\s*/, "");
    } else if (s.indexOf("[dl]") === 0) {
      els.feiyuEnvState.className = "hint";
      els.feiyuEnvState.textContent = "下载中 · " + s.replace(/^\[dl\]\s*/, "");
    } else if (s.indexOf("[done]") === 0) {
      els.feiyuEnvState.className = "hint ok";
      els.feiyuEnvState.textContent = "装好了，切到飞鱼就能用";
      if (els.feiyuInstall) els.feiyuInstall.classList.add("hidden");
    } else if (s.indexOf("[error]") === 0) {
      els.feiyuEnvState.className = "hint bad";
      els.feiyuEnvState.textContent = s.replace(/^\[error\]\s*/, "").slice(0, 200);
    } else if (s.indexOf("[!]") === 0) {
      try { console.warn("[feiyu-setup] " + s); } catch (e) { }
    }
  });
}

for (const [el, key] of [
  [els.rvcPython, "rvcPython"],
  [els.rvcModel, "rvcModel"],
  [els.rvcDevice, "rvcDevice"],
  [els.xttsRef, "xttsRef"],
]) {
  if (!el) continue;
  el.addEventListener("change", () => push({ [key]: (el.value || "").trim() }));
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); push({ [key]: (el.value || "").trim() }); }
  });
}

// XTTS 语速是数字，存的时候要转成 number，否则字符串进 JSON 会在 clamp 里变成 NaN
if (els.xttsSpeed) {
  const commit = () => {
    const v = Number((els.xttsSpeed.value || "").trim());
    push({ xttsSpeed: Number.isFinite(v) ? v : 1 });
  };
  els.xttsSpeed.addEventListener("change", commit);
  els.xttsSpeed.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } });
}

// 飞鱼的语速：0 表示「不干预，用模型自己的语速」，所以默认值是 0 不是 1
if (els.feiyuSpeed) {
  const commit = () => {
    const v = Number((els.feiyuSpeed.value || "").trim());
    push({ feiyuSpeed: Number.isFinite(v) ? v : 0 });
  };
  els.feiyuSpeed.addEventListener("change", commit);
  els.feiyuSpeed.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } });
}

if (els.xttsPick) {
  els.xttsPick.addEventListener("click", async () => {
    const f = await window.deskfish.pickAudio?.();
    if (!f) return;
    if (els.xttsRef) els.xttsRef.value = f;
    push({ xttsRef: f });
  });
}

// 飞鱼的参考音频库：扫 assets/refvoice/ 填下拉。
// 每条 = 一个音频 + 同名 .txt；文件名就是标签，所以 option 上把标签也显示出来。
async function loadFeiyuRefs() {
  if (!els.feiyuRefSel) return;
  const sel = els.feiyuRefSel;
  const keep = sel.value;
  try {
    const r = await window.deskfish.feiyuRefs?.();
    const refs = (r && r.refs) || [];
    // 第一项永远是「自动」
    while (sel.options.length > 1) sel.remove(1);
    for (const it of refs) {
      const o = document.createElement("option");
      o.value = it.id;
      const tag = it.tags && it.tags.length ? it.tags.join("·") : it.name;
      o.textContent = `${tag}（${(it.text || "").slice(0, 12)}…）`;
      o.title = it.text || "";
      sel.appendChild(o);
    }
    sel.value = keep && [...sel.options].some((o) => o.value === keep) ? keep : "";
    if (els.feiyuRefInfo) {
      els.feiyuRefInfo.textContent = refs.length
        ? `参考音频文件夹 ${refs.length} 条 · ${(r && r.dir) || ""}`
        : `文件夹里还没有可用的参考音频（${(r && r.dir) || "assets/refvoice"}）——放一个 wav + 同名 .txt 就行`;
    }
  } catch (e) {
    if (els.feiyuRefInfo) els.feiyuRefInfo.textContent = "读参考音频目录失败：" + (e && e.message ? e.message : e);
  }
}

if (els.feiyuRefSel) {
  loadFeiyuRefs();
  els.feiyuRefSel.addEventListener("change", () => push({ feiyuRef: els.feiyuRefSel.value || "" }));
}
if (els.feiyuRefReload) {
  els.feiyuRefReload.addEventListener("click", () => loadFeiyuRefs());
}
// 参考音频目录也可以手打：以前只有「选文件夹」这条写入口，用键盘改了框里的字
// 什么都不会发生——按回车也不会，切走也不会，看着像能编辑，其实是个摆设。
if (els.feiyuRefDir) {
  const commitRefDir = async () => {
    const v = String(els.feiyuRefDir.value || "").trim();
    await push({ feiyuRefDir: v, feiyuRef: "" });
    loadFeiyuRefs();
  };
  els.feiyuRefDir.addEventListener("change", commitRefDir);
  els.feiyuRefDir.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commitRefDir(); }
  });
}

// 换文件夹：存下路径，并把服务停掉——它启动时就把目录读进去了，不重启还是旧的
if (els.feiyuRefPick) {
  els.feiyuRefPick.addEventListener("click", async () => {
    const p = await window.deskfish.pickFolder?.();
    if (!p) return;
    if (els.feiyuRefDir) els.feiyuRefDir.value = p;
    await push({ feiyuRefDir: p, feiyuRef: "" });
    loadFeiyuRefs();
  });
}

// 飞鱼装在哪：存下根目录，主进程会丢掉 feiyu.mjs 的模块缓存，下次用时按新路径重载
if (els.feiyuHome) {
  const commitHome = async () => {
    const v = String(els.feiyuHome.value || "").trim();
    await push({ feiyuHome: v });
    if (els.feiyuHomeInfo) {
      els.feiyuHomeInfo.className = "hint";
      els.feiyuHomeInfo.textContent = v
        ? "已设为 " + v + "（下面要有 venv / models / cosyvoice）"
        : "留空 = 自动找：包内 feiyu/ → D:\\feiyu";
    }
  };
  els.feiyuHome.addEventListener("change", commitHome);
  els.feiyuHome.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); commitHome(); } });
  if (els.feiyuHomePick) {
    els.feiyuHomePick.addEventListener("click", async () => {
      const p = await window.deskfish.pickFolder?.();
      if (!p) return;
      els.feiyuHome.value = p;
      await commitHome();
    });
  }
}

if (els.xttsTry) {
  els.xttsTry.addEventListener("click", async () => {
    if (els.xttsState) { els.xttsState.className = "hint"; els.xttsState.textContent = "合成中…（第一次要加载模型，约 70 秒）"; }
    try {
      const r = await fetch("/engine/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "主人，我在的。" }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "合成失败");
      if (els.xttsState) {
        els.xttsState.className = "hint";
        els.xttsState.textContent = "引擎 " + (j.engine || "?") + " · " + (j.dur || "?") + "s";
      }
      const a = new Audio(j.url);
      a.play().catch(() => {});
    } catch (e) {
      if (els.xttsState) {
        els.xttsState.className = "hint bad";
        els.xttsState.textContent = "✗ " + (e && e.message || e);
      }
    }
  });
}

// ── 飞鱼 ──────────────────────────────────────────────
// 原来这里有一对「可爱/温柔」按钮。2026-11-08 主人说这两个选项没必要——
// 参考音频本身就是音色，用户塞哪个就用哪个，所以按钮组删了，改成上面那个下拉 + 文件夹。

// ── 引擎状态卡（①）──────────────────────────────────────
// 主人问过两次「怎么选了飞鱼还是 TTS 的声音」——根子是「环境装好 ≠ 引擎在跑」。
// 这张卡把四个层次分开说，并且给出启停按钮、目录校验、待机时长：
//   available=false        → 环境缺东西，先一键安装（此时说话会回落 TTS，得说出来）
//   available && !running  → 装好了但进程没起
//   running && !ready      → 进程起了，模型还在进显存（约 25 秒）
//   ready                  → 随时能开口
function engDotCls(kind) {
  if (els.engDot) els.engDot.className = "eng-dot" + (kind ? " " + kind : "");
}
function engTitle(name, tag, tagCls) {
  if (els.engName) els.engName.textContent = name || "—";
  if (els.engTag) {
    els.engTag.className = "tag" + (tagCls ? " " + tagCls : "");
    els.engTag.textContent = tag || "—";
  }
}
function engSub(text, cls) {
  const el = els.feiyuEngineState;
  if (!el) return;
  el.className = "eng-sub" + (cls ? " " + cls : "");
  el.textContent = text;
}
function engFact(el, text, title) {
  if (!el) return;
  const t = text == null || text === "" ? "—" : String(text);
  el.textContent = t;
  el.title = title || t;
}
function engNotice(text, cls) {
  const el = els.feiyuState;
  if (!el) return;
  el.className = "notice" + (cls ? " " + cls : "");
  el.textContent = text;
}
// 待机：把服务端的毫秒换成「还有几分钟释放」，比一串数字好读
function fmtIdle(idle) {
  if (!idle) return "—";
  const min = Number(idle.ms) > 0 ? Math.round(Number(idle.ms) / 60000) : 0;
  if (!min) return "常驻，不释放";
  if (idle.nextAt) {
    const left = Math.round((Number(idle.nextAt) - Date.now()) / 60000);
    return left > 0 ? "约 " + left + " 分钟后释放" : "即将释放";
  }
  return "闲置 " + min + " 分钟后释放";
}
// 把服务端的待机设置同步回输入框。正在打字时不覆盖，免得抢用户的手。
function syncIdleInputs(idle) {
  if (!idle) return;
  const min = Number(idle.ms) > 0 ? Math.round(Number(idle.ms) / 60000) : 0;
  const auto = !!idle.auto;
  if (els.feiyuIdleAuto) {
    els.feiyuIdleAuto.classList.toggle("on", auto);
    els.feiyuIdleAuto.setAttribute("aria-checked", auto ? "true" : "false");
  }
  if (els.feiyuIdleMin) {
    els.feiyuIdleMin.disabled = !auto;
    els.feiyuIdleMin.style.opacity = auto ? "" : ".45";
    if (document.activeElement !== els.feiyuIdleMin) {
      els.feiyuIdleMin.value = auto ? String(min || 10) : "";
      els.feiyuIdleMin.placeholder = auto ? String(min || 10) : "已关";
    }
  }
  if (els.feiyuIdleHint) {
    els.feiyuIdleHint.className = "hint";
    els.feiyuIdleHint.textContent = auto
      ? "现在：闲置 " + (min || 10) + " 分钟没说话就释放显存；下次开口会自动重新装载（约 25 秒）。"
      : "现在：常驻 —— 不自动释放，一直占着 8GB 左右显存。";
  }
}

// 实测性能：引擎每次合成完都会上报 firstMs（第一块音频离开引擎的时刻）和 rtf
// （合成用时 / 音频时长）。这两个数字是"快不快"的唯一可信证据，所以直接摆出来，
// 并按商业标准分档上色：首声 ≤2s 绿、≤3s 黄、更慢红；RTF ≤1 表示合成比播放快。
function engPerf(perf) {
  const first = Number(perf && (perf.firstMs || perf.first)) || 0;
  const rtf = Number(perf && perf.rtf) || 0;
  const cached = Number(perf && perf.cachedSentences) || 0;
  const sents = Number(perf && perf.sentences) || 0;

  if (els.engFactFirst) {
    els.engFactFirst.className = !first ? "" : first <= 2000 ? "good" : first <= 3000 ? "warn" : "bad";
    els.engFactFirst.textContent = first ? (first / 1000).toFixed(2) + " 秒" : "还没说话";
    els.engFactFirst.title = first
      ? "上一次开口，第一块音频离开引擎用了 " + (first / 1000).toFixed(2) + " 秒；后面的句子由播放队列无缝接上，不会等整段合成完。"
      : "说一句就会在这里留下实测首声。";
  }
  if (els.engFactRtf) {
    if (!rtf) {
      els.engFactRtf.className = "";
      els.engFactRtf.textContent = "—";
      els.engFactRtf.title = "合成用时 ÷ 音频时长；≤1 表示合成比播放快，队列不会饿。";
    } else if (cached && sents && cached >= sents) {
      els.engFactRtf.className = "good";
      els.engFactRtf.textContent = "缓存秒回";
      els.engFactRtf.title = "整段都命中句子缓存（同一句话说过一次就不用再算）。";
    } else {
      els.engFactRtf.className = rtf <= 1 ? "good" : rtf <= 1.3 ? "warn" : "bad";
      els.engFactRtf.textContent = rtf.toFixed(2) + "× 实时";
      els.engFactRtf.title = "合成用时 ÷ 音频时长。≤1 表示算得比播得快。" +
        (sents ? "（本次 " + sents + " 句，其中 " + cached + " 句命中缓存）" : "");
    }
  }
}

async function checkFeiyuEngine() {
  const v = (cur && cur.voiceOut) || "tts";

  // 不是飞鱼：这张卡换成「现在是谁在出声」，飞鱼那几行收起来。
  if (v !== "feiyu") {
    const label = v === "rvc" ? "RVC 换音色" : v === "xtts" ? "XTTS 克隆" : "内置 TTS";
    engDotCls("ok");
    engTitle(label, "在用", "ok");
    engSub(v === "tts"
      ? "内置引擎直接出声：不用启动、不占显存、也不会回落。"
      : label + " 的启动和状态在下面「引擎参数」里。");
    engFact(els.engFactEngine, label);
    engFact(els.engFactDevice, v === "tts" ? "本机 CPU" : "见下方参数");
    engFact(els.engFactIdle, v === "tts" ? "不占显存" : "见下方参数");
    engFact(els.engFactHome, v === "tts" ? "随程序内置" : "见下方参数");
    // 首声 / RTF 是飞鱼的实测指标，别的引擎没有同口径数据，留空而不是编一个
    if (els.engFactFirst) { els.engFactFirst.className = ""; els.engFactFirst.textContent = "—"; els.engFactFirst.title = "首声实测只在飞鱼引擎下采集。"; }
    if (els.engFactRtf) { els.engFactRtf.className = ""; els.engFactRtf.textContent = "—"; els.engFactRtf.title = "合成速度实测只在飞鱼引擎下采集。"; }
    engNotice(v === "tts"
      ? "TTS 是保底那一级：任何引擎出问题，最后都由它出声，所以不会没声音。"
      : "这两个引擎自己也有启动/安装按钮，在下面「引擎参数」里。", "ok");
    if (els.engFallbackNote) {
      els.engFallbackNote.className = "hint";
      els.engFallbackNote.textContent = "引擎没起来时不会让你听不到声音：会自动回落内置 TTS，并且当场说明是哪个环节出的问题。";
    }
    return;
  }

  try {
    const r = await fetch("/engine/feiyu_status", { cache: "no-store" });
    const j = await r.json();
    const miss = Array.isArray(j && j.missing) ? j.missing : [];
    const idle = (j && j.idle) || {};
    const home = (j && j.home) || "";
    const st = () => (els.feiyuEngineState ? els.feiyuEngineState.textContent : "");

    engFact(els.engFactEngine, "飞鱼（CosyVoice3）");
    engPerf(j && j.perf);
    engFact(els.engFactDevice, j && j.device ? j.device : (j && j.ready ? "已加载" : "未加载"));
    engFact(els.engFactIdle, fmtIdle(idle));
    engFact(els.engFactHome, home || "自动", home);
    syncIdleInputs(idle);

    if (!j || j.ok === false || j.available === false) {
      engDotCls("bad");
      engTitle("飞鱼", "没装齐", "bad");
      engSub("环境不全"
        + (miss.length ? "：缺 " + miss.map((m) => m.label).join("、") : (j && j.error ? "（" + String(j.error).slice(0, 70) + "）" : ""))
        + "。点下面的「一键安装」，或者换个引擎目录再校验。");
      engNotice("现在说不了飞鱼的声音 —— 每句话都会回落内置 TTS，不会静音。装好了再把开关打到飞鱼。", "bad");
      if (els.engFallbackNote) {
        els.engFallbackNote.className = "hint warn";
        els.engFallbackNote.textContent = "回落链：飞鱼（本机没装齐）→ 内置 TTS。她开口时会明确告诉你「这次是 TTS 在说」。";
      }
      return;
    }

    if (!j.running) {
      engDotCls("");
      engTitle("飞鱼", "未启动", "");
      engSub("装好了，但引擎没在跑。点「一键启动」提前装进显存（约 25 秒）；直接说一句也会自动拉起。");
      engNotice("引擎没开：第一句话要等装载。装载失败会自动回落 TTS，并把原因写在下面。", "warn");
      if (els.engFallbackNote) {
        els.engFallbackNote.className = "hint";
        els.engFallbackNote.textContent = "现在没热着 —— 声音还是飞鱼的，只是第一句要多等二十几秒。";
      }
      return;
    }

    if (!j.ready) {
      engDotCls("busy");
      engTitle("飞鱼", "装载中", "busy");
      engSub("引擎进程起来了，模型正在进显存" + (j.device ? "（" + j.device + "）" : "") + "，约 25 秒。就绪之前的请求会自动等它，不会说话说一半。"
        + (j.external ? "这个进程不是本程序启动的，关掉本程序它也会留着。" : ""));
      engNotice("装载中：这会儿说话会慢，但不会静音，也不会换声音。", "warn");
      return;
    }

    engDotCls("ok");
    engTitle("飞鱼", "就绪", "ok");
    engSub("引擎在跑" + (j.device ? " · " + j.device : "") + (j.style ? " · " + j.style : "")
      + "，随时能开口。闲置不动会按下面的时长释放显存。"
      + (j.external ? "（这个进程不是本程序启动的）" : ""));
    engNotice("引擎就绪：这几句就是飞鱼本人的声音。", "ok");
    if (els.engFallbackNote) {
      els.engFallbackNote.className = "hint";
      els.engFallbackNote.textContent = "回落链：飞鱼 → 内置 TTS。哪一级出问题都会在这里和她的气泡里说清楚，不会悄悄换声音。";
    }
    if (j.lastError && !st().includes(String(j.lastError).slice(0, 12))) {
      // 上一次失败过就补一句，别让「现在就绪」把刚才的错盖掉
      engSub(st() + " 上次出错：" + String(j.lastError).slice(0, 80));
    }
  } catch (e) {
    engDotCls("bad");
    engTitle("飞鱼", "查不到", "bad");
    engSub("连本地引擎服务都没问到（HTTP 服务没起来？）—— 说话会自动回落 TTS。");
    engNotice("查不到引擎状态：" + (e && e.message || e), "bad");
  }
}

// 请求本地引擎的几个动作。都回 JSON，出错也回 200，所以看 ok 字段不看 HTTP 码。
async function postEngine(path, body) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
    cache: "no-store",
  });
  let j = null;
  try { j = await r.json(); } catch (e) { j = { ok: false, error: "HTTP " + r.status + " 没有 JSON" }; }
  return j || { ok: false, error: "空响应" };
}

// 一键启动：把模型提前装进显存
if (els.feiyuEngineStart) {
  els.feiyuEngineStart.addEventListener("click", async () => {
    const btn = els.feiyuEngineStart;
    if (btn.disabled) return;
    btn.disabled = true;
    engSub("正在把模型装进显存…（第一次约 25 秒，别关窗口）", "busy");
    engDotCls("busy");
    engTitle("飞鱼", "装载中", "busy");
    try {
      const j = await postEngine("/engine/feiyu_start", { refDir: (cur && cur.feiyuRefDir) || "" });
      if (!j || j.ok === false) throw new Error((j && (j.error || j.hint)) || "启动失败");
      await checkFeiyuEngine();
    } catch (e) {
      engDotCls("bad");
      engTitle("飞鱼", "启动失败", "bad");
      engSub("没起来：" + (e && e.message || e));
      engNotice("启动失败 —— 说话会自动回落 TTS，不会静音。" + (e && e.message ? "（" + e.message + "）" : ""), "bad");
    } finally {
      btn.disabled = false;
    }
  });
}

// 关闭引擎：立刻把显存放掉（下次开口自动重新装载）
if (els.feiyuEngineStop) {
  els.feiyuEngineStop.addEventListener("click", async () => {
    const btn = els.feiyuEngineStop;
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      const j = await postEngine("/engine/feiyu_stop", {});
      if (!j || j.ok === false) throw new Error((j && j.error) || "关闭失败");
      await checkFeiyuEngine();
    } catch (e) {
      engNotice("关闭失败：" + (e && e.message || e), "bad");
    } finally {
      btn.disabled = false;
    }
  });
}

// 目录校验：逐项看 venv / 服务脚本 / 声库 / cosyvoice 在不在
if (els.feiyuHomeCheck) {
  els.feiyuHomeCheck.addEventListener("click", async () => {
    const dir = els.feiyuHome ? els.feiyuHome.value.trim() : "";
    if (els.feiyuHomeInfo) {
      els.feiyuHomeInfo.className = "hint";
      els.feiyuHomeInfo.textContent = "正在检查" + (dir ? " " + dir : "自动找到的目录") + "…";
    }
    try {
      const j = await postEngine("/engine/feiyu_home_check", { dir });
      const miss = Array.isArray(j && j.missing) ? j.missing : [];
      if (!els.feiyuHomeInfo) return;
      if (j && j.ok && miss.length === 0) {
        els.feiyuHomeInfo.className = "hint ok";
        els.feiyuHomeInfo.textContent = "✓ 这个目录可以用：" + (j.resolved || dir);
      } else {
        els.feiyuHomeInfo.className = "hint bad";
        els.feiyuHomeInfo.textContent = "✗ " + (j && (j.note || j.error) || "检查失败")
          + (miss.length ? "：缺 " + miss.map((m) => m.label).join("、") : "")
          + "（目录：" + ((j && j.resolved) || dir || "自动") + "）";
      }
    } catch (e) {
      if (els.feiyuHomeInfo) {
        els.feiyuHomeInfo.className = "hint bad";
        els.feiyuHomeInfo.textContent = "✗ 检查失败：" + (e && e.message || e);
      }
    }
  });
}

// 待机自动关闭：开关 + 分钟数。改完立刻推给引擎，不用等重启。
if (els.feiyuIdleAuto) {
  const flipIdle = async () => {
    const on = !els.feiyuIdleAuto.classList.contains("on");
    els.feiyuIdleAuto.classList.toggle("on", on);
    els.feiyuIdleAuto.setAttribute("aria-checked", on ? "true" : "false");
    const minutes = Math.min(720, Math.max(1, Math.round(Number(els.feiyuIdleMin && els.feiyuIdleMin.value) || 10)));
    try { push({ feiyuIdleAuto: on, feiyuIdleMin: minutes }); } catch (e) { }
    try { await postEngine("/engine/feiyu_idle", { auto: on, minutes }); } catch (e) { }
    syncIdleInputs({ ms: on ? minutes * 60000 : 0, auto: on });
    checkFeiyuEngine();
  };
  els.feiyuIdleAuto.addEventListener("click", flipIdle);
  els.feiyuIdleAuto.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); flipIdle(); }
  });
}
if (els.feiyuIdleMin) {
  const commitIdle = async () => {
    const n = Math.min(720, Math.max(1, Math.round(Number(els.feiyuIdleMin.value) || 10)));
    els.feiyuIdleMin.value = String(n);
    try { push({ feiyuIdleMin: n }); } catch (e) { }
    try { await postEngine("/engine/feiyu_idle", { minutes: n, auto: !els.feiyuIdleAuto || els.feiyuIdleAuto.classList.contains("on") }); } catch (e) { }
    checkFeiyuEngine();
  };
  els.feiyuIdleMin.addEventListener("change", commitIdle);
  els.feiyuIdleMin.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); els.feiyuIdleMin.blur(); commitIdle(); }
  });
}

if (els.feiyuEngineCheck) {
  els.feiyuEngineCheck.addEventListener("click", () => checkFeiyuEngine());
}
// 只在「变声引擎」这页看得见时才轮询，别让一个后台面板每 3 秒发一次请求。
let feiyuPollTimer = 0;
function startFeiyuPoll() {
  if (feiyuPollTimer) return;
  checkFeiyuEngine();
  feiyuPollTimer = setInterval(() => {
    if (document.hidden) return;
    // 子页切换在 settings-shell.js:177-186：它给 .subpage[data-sub] 挂 .on，
    // 从来没有写过 body.dataset.sub，所以判据要看那个 class。
    const page = document.querySelector('.subpage[data-sub="timbre"]');
    if (!page || !page.classList.contains("on")) return;
    checkFeiyuEngine();
  }, 3000);
}


if (els.feiyuTry) {
  els.feiyuTry.addEventListener("click", async () => {
    if (els.feiyuState) {
      els.feiyuState.className = "notice";
      els.feiyuState.textContent = "合成中…（第一次要加载模型，约 20～25 秒）";
    }
    try {
      const r = await fetch("/engine/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "主人，我在的。" }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "合成失败");
      // 试听最怕「听起来不对，但不知道是不是我自己的问题」：
      // 服务端把回落原因一起回传（fellBack），这里原样说出来。
      if (els.feiyuState) {
        if (j.fellBack) {
          els.feiyuState.className = "notice warn";
          els.feiyuState.textContent = "这次不是飞鱼：上面选的引擎没起来（" + (j.fellBack.reason || "原因未知")
            + "），这一段其实是 " + (j.engine || "TTS") + " 念的。修好之后再试。";
        } else {
          els.feiyuState.className = "notice ok";
          els.feiyuState.textContent = "引擎 " + (j.engine || "?") + " · " + (j.dur || "?") + "s"
            + (j.cached ? " · 走缓存" : "") + " —— 这就是你现在听到的声音。";
        }
      }
      const a = new Audio(j.url);
      a.play().catch(() => {});
      checkFeiyuEngine();
    } catch (e) {
      if (els.feiyuState) {
        els.feiyuState.className = "notice bad";
        els.feiyuState.textContent = "✗ 合成失败：" + (e && e.message || e) + "（真说话时会自动回落 TTS）";
      }
    }
  });
}

function paintRvc(st) {
  if (!els.rvcResult) return;
  if (!st) { els.rvcResult.className = "result"; els.rvcResult.textContent = ""; return; }
  if (st.running) {
    els.rvcResult.className = "result ok";
    els.rvcResult.textContent = "● 服务运行中 · " + st.url;
  } else {
    els.rvcResult.className = "result bad";
    els.rvcResult.textContent = "○ 没在跑" + (st.error ? " · " + st.error : "");
  }
  if (els.rvcToggle) els.rvcToggle.textContent = st.running ? "停止" : "启动";
  if (els.rvcAutoStop) {
    const on = !!(cur && cur.rvcAutoStop);
    els.rvcAutoStop.classList.toggle("on", on);
    els.rvcAutoStop.setAttribute("aria-checked", on ? "true" : "false");
  }
}

// 自动转换进度。服务端 /health 里带 convert 字段：
// {running, total, done, current, error}
// 用户把 .pth 丢进 models/ 之后，下次启动会在这儿显示「正在转 xxx」，
// 转完自动换成新模型，不需要任何手动操作。
function paintConvert(cv) {
  const el = els.rvcConvert;
  if (!el) return;
  if (!cv || (!cv.running && !cv.total && !cv.error)) {
    el.className = "result";
    el.textContent = "";
    return;
  }
  if (cv.error) {
    el.className = "result bad";
    el.textContent = "✗ " + cv.error;
    return;
  }
  if (cv.running) {
    el.className = "result";
    el.textContent = "正在转换 " + (cv.current || "") + "（" + (cv.done || 0) + "/" + (cv.total || 1) + "）… 第一次要几秒，转完就不用再等了";
    return;
  }
  el.className = "result ok";
  el.textContent = "✓ 已经自动转了 " + cv.done + " 个模型，重启一次就能用";
}

async function refreshRvc() {
  try {
    const st = await api.rvcStatus();
    paintRvc(st);
    if (st && st.health && st.health.convert) paintConvert(st.health.convert);
    return st;
  } catch (e) {
    paintRvc({ running: false, error: String(e && e.message || e) });
    return null;
  }
}

// 「选模型」：点一下扫 models/ 目录，列成下拉，选完自动填进输入框。
// 不这么做的话，换模型要手打 "models/xxx/xxx.onnx"，漏一级就报「找不到模型」。
if (els.rvcPickModel && els.rvcModelSel) {
  let filled = false;
  els.rvcPickModel.addEventListener("click", async () => {
    if (!els.rvcModelSel.classList.contains("hidden")) {
      els.rvcModelSel.classList.add("hidden");
      return;
    }
    if (!filled) {
      const r = await api.rvcListModels();
      const list = (r && r.list) || [];
      if (!list.length) {
        els.rvcModelSel.classList.add("hidden");
        if (els.rvcResult) {
          els.rvcResult.className = "result bad";
          els.rvcResult.textContent = "没找到音色模型。安装包不带音色文件（一个就一百多 MB），点「选模型」直接挑你的 .onnx，或者把模型放进 rvc/models/<名字>/ 里";
        }
        return;
      }
      els.rvcModelSel.innerHTML = list
        .map((m) => '<option value="' + m.rel + '">' + m.name + "　" + m.mb + "MB</option>")
        .join("");
      filled = true;
    }
    els.rvcModelSel.classList.remove("hidden");
    // 打开时把当前值对上，别让人以为自己选错了
    const cur = (els.rvcModel.value || "").trim();
    if (cur) els.rvcModelSel.value = cur;
  });
  els.rvcModelSel.addEventListener("change", () => {
    els.rvcModel.value = els.rvcModelSel.value;
    els.rvcModelSel.classList.add("hidden");
    if (els.rvcResult) {
      els.rvcResult.className = "result ok";
      els.rvcResult.textContent = "已选 " + els.rvcModelSel.value + "，记得点保存";
    }
  });
}

if (els.rvcToggle) {
  els.rvcToggle.addEventListener("click", async () => {
    els.rvcToggle.disabled = true;
    try {
      const wasRunning = els.rvcToggle.textContent === "停止";
      const st = wasRunning ? await api.rvcStop() : await api.rvcStart();
      paintRvc(st);
      // 起来之后还要等 Python 把模型加载完（0.4s 模型 + 2s hubert 初始化），
      // 所以这里再探两轮，别让人看着「运行中」其实还没准备好。
      if (!wasRunning && st && st.running) {
        if (els.rvcResult) { els.rvcResult.className = "result"; els.rvcResult.textContent = "正在加载模型…"; }
        for (let i = 0; i < 30; i += 1) {
          await new Promise((r) => setTimeout(r, 1000));
          try {
            // 直接问 RVC 自己的 /health（那个 Python 服务），不是桌宠服务的同名路由 ——
            // 这里拼的是 st.port（8897），写 /engine/rvc/health 会 404，然后被 catch 吞掉，
            // 白等 30 轮。
            const h = await fetch("http://127.0.0.1:" + (st.port || 8897) + "/health").then((r) => r.json());
            if (h && h.ok) {
              els.rvcResult.className = "result ok";
              els.rvcResult.textContent = "● 就绪 · 模型 " + (h.model || "?") + " · " + (h.device || "?");
              break;
            }
          } catch (e) { /* 还没起来，继续等 */ }
        }
      }
    } catch (e) {
      paintRvc({ running: false, error: String(e && e.message || e) });
    } finally {
      els.rvcToggle.disabled = false;
    }
  });
}

if (els.rvcTest) {
  els.rvcTest.addEventListener("click", async () => {
    els.rvcTest.disabled = true;
    if (els.rvcResult) { els.rvcResult.className = "result"; els.rvcResult.textContent = "正在合成…"; }
    try {
      const r = await fetch("/engine/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "主人，这个声音你听着还喜欢吗？" }),
      });
      const j = await r.json();
      if (!j || !j.ok) throw new Error((j && j.error) || "合成失败");
      const src = await fetch(location.origin + j.url).then((x) => x.arrayBuffer());
      if (els.rvcResult) els.rvcResult.textContent = "正在换音色…";
      const t0 = Date.now();
      const rr = await fetch("/engine/rvc?pitch=0", {
        method: "POST",
        headers: { "content-type": "audio/mpeg" },
        body: src,
      });
      if (!rr.ok) throw new Error("RVC HTTP " + rr.status + " " + (await rr.text()).slice(0, 140));
      const out = await rr.blob();
      const url = URL.createObjectURL(out);
      const a = new Audio(url);
      a.onended = () => { try { URL.revokeObjectURL(url); } catch (e) { } };
      await a.play();
      if (els.rvcResult) {
        els.rvcResult.className = "result ok";
        els.rvcResult.textContent = "● 好了 · 转换 " + ((Date.now() - t0) / 1000).toFixed(1) + "s · " + Math.round(out.size / 1024) + "KB";
      }
    } catch (e) {
      if (els.rvcResult) {
        els.rvcResult.className = "result bad";
        els.rvcResult.textContent = "✗ " + String(e && e.message || e).slice(0, 160);
      }
    } finally {
      els.rvcTest.disabled = false;
    }
  });
}

refreshRvc();

if (els.apiTest) {
  els.apiTest.addEventListener("click", async () => {
    if (!cur) return;
    els.apiTest.disabled = true;
    els.apiTest.textContent = "测试中…";
    els.apiResult.className = "result";
    els.apiResult.textContent = "";
    try {
      const r = await api.testApi({
        apiBase: els.apiBase.value.trim(),
        apiKey: els.apiKey.value,
        apiModel: els.apiModel.value.trim(),
      });
      if (r && r.ok) {
        els.apiResult.className = "result ok";
        els.apiResult.textContent = "● 通了 · " + r.ms + "ms · 模型 " + (r.model || "?") + " · 她说：" + (r.reply || "").slice(0, 40);
      } else {
        els.apiResult.className = "result bad";
        els.apiResult.textContent = "✗ " + ((r && r.error) || "没连上");
      }
    } catch (e) {
      els.apiResult.className = "result bad";
      els.apiResult.textContent = "✗ " + netErr((e && e.message) || e);
    } finally {
      els.apiTest.disabled = false;
      els.apiTest.textContent = "测试 API";
    }
  });
}

// ---- 清晰度分段 ----
els.resSeg.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  push({ resolution: Number(b.dataset.v) });
});

// ---- 贴图精度分段 ----
// 0=自动（按显卡能力取 4096）。桌宠那边收到设置后立刻重画贴图，不用重启。
if (els.texSeg) {
  els.texSeg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    push({ texMax: Number(b.dataset.v) });
  });
}

// ---- 表情开关贴片（脸红 / 爱心眼 / >< 笑眼 / 黑脸 / 张嘴 / 屑屑眼）----
// 关掉之后她只靠眼睑、眉、嘴角这些连续参数演，不再切整张贴图。
if (els.patchSeg) {
  els.patchSeg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    push({ exprPatch: Number(b.dataset.v) === 1 });
  });
}

// ---- 帧率上限 ----
els.fpsSeg.addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  push({ fpsCap: Number(b.dataset.v) });
});

// ---- 开关 ----
// 点下去先本地翻一次、立刻重画，再发请求。push 是异步的（拿到主进程返回才 paint），
// 等它回来才更新 cur 的话，手快连点第二下会用旧值算出同一个目标 —— 表现是「这个开关关不掉」，
// 偏偏点了有反馈（请求真的发出去了），最难查。写盘失败时 push 会重新拉一次设置把界面纠正回来。
for (const key of ["sharpen", "alwaysOnTop", "clickThrough", "followCursor", "autoIdle", "blinkEnabled", "launchAtLogin", "dockAutoHide", "mute", "idleSpeak", "idleBubble", "idleCacheAuto"]) {
  const el = els[key];
  if (!el) continue;
  el.addEventListener("click", () => {
    const next = !cur[key];
    cur[key] = next;
    el.classList.toggle("on", next);
    el.setAttribute("aria-checked", next ? "true" : "false");
    push({ [key]: next });
  });
}
// ---- 游戏模式 ----
// 它不是一条普通设置：主进程要藏窗口、停渲染、把语音模型的显存还回去。所以走专用 IPC，
// 界面按主进程回来的真实状态落地（这个开关可能被托盘或唤出热键在别处改掉）。
function gameHint(on) {
  if (!els.gameModeHint) return;
  els.gameModeHint.className = "notice" + (on ? " warn" : "");
  els.gameModeHint.textContent = on
    ? "已经在游戏模式里：她不画、不轮询屏幕，语音模型的显存也放掉了。托盘里点「退出游戏模式」，或者按一次唤出热键，她就回来。"
    : "现在不在游戏模式。";
}

if (els.gameMode) {
  els.gameMode.addEventListener("click", async () => {
    const next = els.gameMode.getAttribute("aria-checked") !== "true";
    els.gameMode.classList.toggle("on", next);
    els.gameMode.setAttribute("aria-checked", next ? "true" : "false");
    gameHint(next);
    let real = next;
    try {
      const r = await api.gameSet(next);
      if (!r || !r.ok) real = !next;
      else real = !!r.on;
    } catch (e) {
      real = !next;
    }
    cur.gameMode = real;
    els.gameMode.classList.toggle("on", real);
    els.gameMode.setAttribute("aria-checked", real ? "true" : "false");
    gameHint(real);
  });
  // 进来时按当前状态先摆一次（主进程里可能已经是游戏模式）
  api.gameStatus?.().then((r) => {
    if (r && r.ok) {
      cur.gameMode = !!r.on;
      els.gameMode.classList.toggle("on", !!r.on);
      els.gameMode.setAttribute("aria-checked", r.on ? "true" : "false");
      gameHint(!!r.on);
    }
  }).catch(() => { });
}

// 开关视觉上是滑块，语义上是 switch：Tab 能停、Enter/空格能拨。
for (const el of document.querySelectorAll(".sw")) {
  if (!el.getAttribute("aria-label")) {
    const row = el.closest(".row");
    const lab = row && row.querySelector(".label");
    if (lab) {
      const own = Array.from(lab.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent)
        .join("")
        .trim();
      if (own) el.setAttribute("aria-label", own);
    }
  }
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); }
  });
}

// ---- 取景 ----
// 取景住在模型自己身上（PACK.layout），不再有第二个 viewBox ——
// 两套值迟早对不上，切模型时更容易把上个模型的框套到新模型脸上。
let viewInfo = null;
function paintView() {
  if (!els.viewState) return;
  const L = (viewInfo && viewInfo.layout) || {};
  if (!viewInfo) {
    els.viewState.className = "hint";
    els.viewState.textContent = "还没有选模型 —— 先去适配器导入一个";
    return;
  }
  const h = typeof L.viewH === "number" ? L.viewH : 0.5;
  const y = typeof L.viewY === "number" ? L.viewY : 0.1;
  // 说人话：看多少、从哪儿起，比报两个小数有用
  const what = h > 0.75 ? "连全身" : h > 0.6 ? "连身子" : h > 0.45 ? "到腰" : h > 0.3 ? "头到胸" : h > 0.2 ? "头肩" : "只看脸";
  els.viewState.className = "hint";
  els.viewState.textContent = "取景 · " + what + "（看 " + Math.round(h * 100) + "% 高度，从顶部 " +
    Math.max(0, Math.round(y * 100)) + "% 处开始）";
}
async function loadViewInfo() {
  try {
    const r = await fetch("/api/packs/active", { cache: "no-store" });
    const j = await r.json();
    viewInfo = j && j.ok ? j : null;
  } catch (e) { viewInfo = null; }
  paintView();
}
loadViewInfo();
if (window.deskfish && window.deskfish.onPackChanged) {
  // 换模型之后取景跟着换，这里得重新读一次当前包
  window.deskfish.onPackChanged(loadViewInfo);
}
// ---- 模型适配器 ----
if (els.openAdapter) {
  els.openAdapter.addEventListener("click", async () => {
    try { await window.deskfish.openAdapter(""); } catch (e) { }
  });
}
// 当前用哪个模型：这里只显示，不做切换 —— 切换要在适配器里看预览，盲切没有意义。
(async () => {
  if (!els.packState) return;
  try {
    const r = await fetch("/api/packs/active", { cache: "no-store" });
    const j = await r.json();
    if (j && j.ok) {
      // 内置包不可写安装目录，但改配置会存一份覆盖层到用户目录 —— 说清楚，别让人以为改了会丢。
      const extra = j.writable ? "" : "（内置模型 · 改动只存本机）";
      els.packState.textContent = "当前模型 · " + (j.displayName || j.id) + extra;
    } else {
      els.packState.textContent = "当前模型 · 未识别";
    }
  } catch (e) {
    els.packState.textContent = "当前模型 · 读取失败";
  }
})();

// ---- 按钮 ----
// ══ DSH 桥接 ══════════════════════════════════════════
// 地址在失焦/回车时提交，不是每敲一个字符都写盘。
if (els.bridgeUrl) {
  els.bridgeUrl.addEventListener("change", () => {
    api.settingsPatch({ bridgeUrl: String(els.bridgeUrl.value || "").trim() });
  });
  els.bridgeUrl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); els.bridgeUrl.blur(); }
    if (e.key === "Escape") e.stopPropagation();
  });
}

// 主进程会自己改 bridgeUrl（外部桥不通就指到自带桥）。以前只通知主窗口，
// 这个页面留着旧端口，下一次保存又把它写回磁盘，于是两边来回拉锯、
// 语音一直 Failed to fetch。现在跟着变，但用户正在这个框里打字时不抢。
if (api.onSettingsChanged) {
  api.onSettingsChanged((s) => {
    if (!s) return;
    cur = s;
    if (els.bridgeUrl && document.activeElement !== els.bridgeUrl) {
      const want = String(s.bridgeUrl || "");
      if (want && els.bridgeUrl.value !== want) els.bridgeUrl.value = want;
    }
    if (window.FishVoice && window.FishVoice.setBridgeUrl && s.bridgeUrl) {
      window.FishVoice.setBridgeUrl(s.bridgeUrl);
    }
  });
}

if (els.bridgeTest) {
  els.bridgeTest.addEventListener("click", async () => {
    const url = String((els.bridgeUrl && els.bridgeUrl.value) || "").trim();
    els.bridgeTest.disabled = true;
    els.bridgeTest.textContent = "测试中…";
    if (els.bridgeResult) els.bridgeResult.innerHTML = '<span class="meta">正在连接 ' + esc(url) + "</span>";
    if (els.bridgeAddrs) els.bridgeAddrs.innerHTML = "";
    try {
      const r = await window.deskfish.testBridge(url);
      if (!r) throw new Error("没有返回");
      if (r.ok) {
        if (els.bridgeResult) {
          els.bridgeResult.innerHTML =
            '<span class="ok">● 已连上</span>' +
            '<span class="meta"> · ' + r.ms + "ms · 模型 " + esc(r.model || "?") +
            (r.busy ? " · 她正忙" : " · 空闲") + "</span>" +
            (r.cwd ? '<div class="meta">工作目录 ' + esc(r.cwd) + "</div>" : "");
        }
        // 对方自报的可用地址，点一下直接切过去
        if (els.bridgeAddrs && Array.isArray(r.addresses) && r.addresses.length) {
          els.bridgeAddrs.innerHTML = "";
          r.addresses.forEach((a) => {
            const d = document.createElement("div");
            d.className = "a";
            // 这一行也是「看着是信息、其实能点」，键盘得能走上来
            d.setAttribute("role", "button");
            d.tabIndex = 0;
            d.title = "点一下切到这个地址：" + a.url;
            d.innerHTML = '<span class="u">' + esc(a.url) + "</span>" +
                          '<span class="n">' + esc(a.label || a.nic || "") + "</span>";
            const pick = () => {
              if (els.bridgeUrl) els.bridgeUrl.value = a.url;
              api.settingsPatch({ bridgeUrl: a.url });
            };
            d.addEventListener("click", pick);
            d.addEventListener("keydown", (ev) => {
              if (ev.key === "Enter" || ev.key === " " || ev.key === "Spacebar") {
                ev.preventDefault();
                pick();
              }
            });
            els.bridgeAddrs.appendChild(d);
          });
        }
      } else {
        if (els.bridgeResult) {
          els.bridgeResult.innerHTML =
            '<span class="bad">● 连不上</span>' +
            '<span class="meta"> · ' + r.ms + "ms · " + esc(netErr(r.error)) + "</span>";
        }
      }
    } catch (e) {
      if (els.bridgeResult) {
        els.bridgeResult.innerHTML = '<span class="bad">● 出错</span><span class="meta"> · ' +
          esc(netErr((e && e.message) || e)) + "</span>";
      }
    } finally {
      els.bridgeTest.disabled = false;
      els.bridgeTest.textContent = "测试连接";
    }
  });
}

/* ── 本机自带桥接 ──────────────────────────────────────
 * 没有 phone-bridge 的机器，靠它一键起一个小桥接连本机 DSH。
 * 起来之后顺手把地址填进去——用户不用记端口。
 */
function paintMini(s) {
  if (!els.miniResult) return;
  if (!s) {
    els.miniResult.innerHTML = '<span class="meta">读不到桥接状态</span>';
    return;
  }
  if (s.running) {
    els.miniResult.innerHTML =
      '<span class="ok">● 自带桥接运行中</span>' +
      '<span class="meta"> · ' + esc(s.url) + '</span>';
    if (els.miniToggle) els.miniToggle.textContent = "停止";
    // 桥接已经跑着、地址栏却还写着别的端口时替用户改过来。
    // 踩过：上次会话里起的桥接这次还在跑，这里只显示「运行中」不回填，
    // 地址栏留着 8899（外部 phone-bridge 的端口），语音就一直报拿不到凭证。
    // 只在当前值是空的、或者就是本机 8899 默认值时才改 —— 用户手填的局域网地址不动。
    const want = String(s.url || "").trim();
    const cur = els.bridgeUrl ? String(els.bridgeUrl.value || "").trim() : "";
    const isLocalDefault = !cur || /^https?:\/\/(127\.0\.0\.1|localhost):8899\/?$/.test(cur);
    if (want && isLocalDefault && cur !== want) {
      els.bridgeUrl.value = want;
      push({ bridgeUrl: want });
      if (window.FishVoice && window.FishVoice.setBridgeUrl) window.FishVoice.setBridgeUrl(want);
    }
  } else {
    els.miniResult.innerHTML = s.error
      ? '<span class="bad">● 未运行</span><span class="meta"> · ' + esc(s.error) + '</span>'
      : '<span class="meta">未运行。点「启动」后会自动连上本机 DSH。</span>';
    if (els.miniToggle) els.miniToggle.textContent = "启动";
  }
}

async function refreshMini() {
  try { paintMini(await api.miniStatus()); } catch (e) { paintMini(null); }
}

/* ── 一键自检并修复 ────────────────────────────────────
 * bridgeEnsure 在主进程里做三件事：先探用户填的地址 → 不通就起随身桥接 →
 * 把地址指过去（只在当前是本机地址时才改，远端不动）。
 * 这里只负责把它的结论翻成人话，别让用户猜「到底通了没有」。
 */
function paintBridgeFix(r) {
  if (!els.bridgeFixHint) return;
  if (!r) {
    els.bridgeFixHint.className = "notice bad";
    els.bridgeFixHint.textContent = "自检没跑起来（主进程没回应）。";
    return;
  }
  const where = r.base ? ' · <b>' + esc(r.base) + "</b>" : "";
  if (r.ok && r.external) {
    els.bridgeFixHint.className = "notice ok";
    els.bridgeFixHint.innerHTML = "✓ 你填的桥接是通的" + where + (r.note ? '<br><span class="meta">' + esc(r.note) + "</span>" : "");
  } else if (r.ok && r.mini) {
    els.bridgeFixHint.className = "notice ok";
    els.bridgeFixHint.innerHTML =
      "✓ 随身桥接已经在跑" + where +
      "<br><span class=\"meta\">" + (r.switched ? "地址栏已经指过来了。" : "") +
      "这台机器没装 phone-bridge 也能用 —— 它直接连本机 DSH。</span>";
  } else {
    els.bridgeFixHint.className = "notice warn";
    els.bridgeFixHint.innerHTML =
      "没连上" + where + "<br><span class=\"meta\">" +
      esc(r.note || r.error || "本机 DSH 可能没在运行。DSH 起来之后它会每 90 秒自己再试一次，不用你管。") +
      "</span>";
  }
  // 主进程可能已经把地址改了，这里同步一下输入框与语音层
  if (r.base) {
    const cur = els.bridgeUrl ? String(els.bridgeUrl.value || "").trim() : "";
    if (r.switched && els.bridgeUrl) els.bridgeUrl.value = r.base;
    else if (!cur && els.bridgeUrl) els.bridgeUrl.value = r.base;
    if (window.FishVoice && window.FishVoice.setBridgeUrl) window.FishVoice.setBridgeUrl(r.base);
  }
}

async function runBridgeFix(auto) {
  if (!api.bridgeEnsure) { paintBridgeFix(null); return; }
  if (els.bridgeFix) {
    els.bridgeFix.disabled = true;
    if (!auto) els.bridgeFix.textContent = "检查中…";
  }
  let r = null;
  try { r = await api.bridgeEnsure({}); } catch (e) { r = { ok: false, error: e && e.message ? e.message : String(e) }; }
  if (els.bridgeFix) {
    els.bridgeFix.disabled = false;
    els.bridgeFix.textContent = "自检并修复";
  }
  paintBridgeFix(r);
  // 修完顺手刷一下「自带桥接」那块的运行状态，两处别打架
  refreshMini();
}

if (els.bridgeFix) {
  els.bridgeFix.addEventListener("click", () => { runBridgeFix(false); });
}
// 打开设置就静默自检一次：多数人不需要点这个按钮，他们只需要「能说话」。
setTimeout(() => { runBridgeFix(true); }, 900);

if (els.miniToggle) {
  els.miniToggle.addEventListener("click", async () => {
    els.miniToggle.disabled = true;
    const wasRunning = els.miniToggle.textContent === "停止";
    try {
      const s = wasRunning ? await api.miniStop() : await api.miniStart();
      paintMini(s);
      if (!wasRunning && s && s.running) {
        // 起来之后把地址替用户填好，这样「测试连接」一点就通
        if (els.bridgeUrl) els.bridgeUrl.value = s.url;
        push({ bridgeUrl: s.url });
        if (window.FishVoice && window.FishVoice.setBridgeUrl) {
          window.FishVoice.setBridgeUrl(s.url);
        }
      }
    } catch (e) {
      if (els.miniResult) {
        els.miniResult.innerHTML = '<span class="bad">● 出错</span><span class="meta"> · ' +
          esc(String(e && e.message || e).slice(0, 60)) + "</span>";
      }
    } finally {
      els.miniToggle.disabled = false;
    }
  });
  refreshMini();
}

els.resetPos.addEventListener("click", () => api.resetPosition());

// ── 导出 / 导入配置 ───────────────────────────────────
// 换设备时导一次、导进去就能用，这就是「一键部署」那一环。
let cfgTimer = null;
function cfgToast(msg, bad) {
  if (!els.cfgToast) return;
  els.cfgToast.textContent = msg;
  els.cfgToast.classList.toggle("bad", !!bad);
  els.cfgToast.classList.add("show");
  clearTimeout(cfgTimer);
  cfgTimer = setTimeout(() => els.cfgToast.classList.remove("show"), 2600);
}

els.expCfg.addEventListener("click", async () => {
  const r = await api.settingsExport();
  if (r.canceled) return;
  cfgToast(r.ok ? "已导出 " + r.count + " 项设置" : "导出失败：" + r.error, !r.ok);
});

els.impCfg.addEventListener("click", async () => {
  const r = await api.settingsImport();
  if (r.canceled) return;
  if (!r.ok) return cfgToast("导入失败：" + r.error, true);
  paint(r.settings);
  // 导进来的是整包设置，包含快捷键和开机自启——不许「显示成功但其实没生效」。
  if (r.settings && r.settings.ok === false) {
    cfgToast("导入的设置没存上：" + (r.settings.error || "磁盘写入失败"), true);
  } else if (r.autostart && r.autostart.ok === false) {
    cfgToast("导入成功，但开机自启没设置上：" + (r.autostart.error || ""), true);
  } else {
    cfgToast("已导入 " + r.count + " 项设置");
  }
  refreshHotkeyStatus();
  refreshAutostart();
});

els.reset.addEventListener("click", async () => {
  // 恢复默认会连模型地址、API Key、快捷键、窗口位置一起清掉，误点一次很难补回来。
  if (!confirm("恢复默认会清空所有设置，包括模型地址、API Key、快捷键和窗口位置。\n\n确定要继续吗？")) return;
  try {
    const s = await api.settingsReset();
    paint(s);
    if (s && s.ok === false) cfgToast("恢复默认没存上：" + (s.error || "磁盘写入失败"), true);
    else cfgToast("已恢复默认设置");
  } catch (e) {
    cfgToast("恢复默认失败：" + ((e && e.message) || e), true);
  }
});
els.quit.addEventListener("click", () => {
  // 误点「退出」的代价是宠物、语音、待机全消失；这里和「恢复默认」一样给一次确认。
  // 托盘里的「退出」仍然是一次到位——那是明确的退出入口，和设置页的红色按钮不同。
  if (!confirm("退出后大肥鱼就不在桌面上了，语音和待机都会停。\n\n下次可以从开始菜单再打开。确定退出吗？")) return;
  api.quit();
});
document.getElementById("close").addEventListener("click", () => api.closeSettings());
// 设置窗自己也支持 Esc 关掉
window.addEventListener("keydown", (e) => {
  // 许可弹层开着时 Esc 只关弹层，别顺手把整个设置窗也关了
  if (e.key === "Escape" && !document.querySelector(".modal")) api.closeSettings();
});

// ---- 初始化 ----
// 自测入口：重拉一次麦克风列表，并把提示行的当前状态读回来。
// 为什么要留这个口子：fillMicDevices 只在窗口初始化时跑一次，
// 探针想在「权限被拒」的情况下再拉一次，否则只能验到第一帧的偶然结果。
try {
  window.settingsMic = {
    refresh: (s) => fillMicDevices(Object.assign({ micDevice: "" }, s || {})),
    hint: () => {
      const el = document.getElementById("micHint");
      return el ? { hidden: !!el.hidden, text: String(el.textContent || ""), warn: el.classList.contains("warn") } : null;
    },
    devices: () => {
      const sel = document.getElementById("micDevice");
      return sel ? { count: sel.options.length, labels: Array.from(sel.options).map((o) => o.textContent) } : null;
    },
  };
} catch (e) { }

api.settingsGet().then((s) => {
  paint(s);
  refreshHotkeyStatus();
  refreshAutostart();
  micDeviceSel = els.micDevice;
  fillMicDevices(s);
  voiceSel = els.voiceId;
  fillVoices(s);
  document.title = "大肥鱼 · 设置";
  if (api.version) els.ver.textContent = "v" + api.version;
});

// 「自动关闭」：闲置 5 分钟没人说话就自己停掉 RVC，省内存和显卡。
// 开关状态存进设置，主进程按它决定要不要挂那个定时器。
if (els.rvcAutoStop) {
  els.rvcAutoStop.addEventListener("click", async () => {
    const next = !(cur.rvcAutoStop !== false);
    els.rvcAutoStop.classList.toggle("on", next);
    els.rvcAutoStop.setAttribute("aria-checked", next ? "true" : "false");
    try {
      const r = await api.settingsPatch({ rvcAutoStop: next });
      if (r && r.settings) Object.assign(cur, r.settings);
      els.rvcResult.textContent = next
        ? "● 闲置 5 分钟会自动关掉 RVC"
        : "○ 不会自动关，一直开着";
      els.rvcResult.className = "result" + (next ? " ok" : "");
    } catch (e) {
      els.rvcResult.textContent = "✗ " + (e && e.message ? e.message : "保存失败");
      els.rvcResult.className = "result bad";
      els.rvcAutoStop.classList.toggle("on", !next);
      els.rvcAutoStop.setAttribute("aria-checked", next ? "false" : "true");
    }
  });
}

/* ── 存储：报占用 / 换盘 / 打开 / 清缓存 ──────────────────────────────
 * 语音缓存和 whisper 模型默认都落在系统用户目录（C 盘）。用户换盘之后这里只是
 * 写进设置，真正搬家要重启软件——引擎是启动时按这个路径起的子进程。
 */
function fmtBytes(n) {
  n = Number(n) || 0;
  if (n >= 1073741824) return (n / 1073741824).toFixed(2) + " GB";
  if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
  if (n >= 1024) return Math.round(n / 1024) + " KB";
  return n + " B";
}

async function refreshStorage() {
  if (!els.cacheDirInfo) return;
  try {
    const info = await api.storageInfo?.();
    if (!info) { els.cacheDirInfo.textContent = "读取失败"; return; }
    if (els.cacheDir) els.cacheDir.value = info.custom || "";
    els.cacheDirInfo.textContent =
      "语音缓存 " + fmtBytes(info.cacheBytes) + "（" + (info.cacheFiles || 0) + " 个文件）" +
      " · 识别模型 " + fmtBytes(info.modelBytes) +
      "　当前目录：" + info.dataDir;
  } catch (e) {
    els.cacheDirInfo.textContent = "读取失败：" + (e && e.message ? e.message : e);
  }
}

async function saveCacheDir(v) {
  try {
    await api.settingsPatch({ cacheDir: v || "" });
    if (els.cacheDirInfo) els.cacheDirInfo.textContent = "已保存，重启软件后生效。";
  } catch (e) {
    if (els.cacheDirInfo) els.cacheDirInfo.textContent = "保存失败：" + (e && e.message ? e.message : e);
  }
}

if (els.cacheDirPick) {
  els.cacheDirPick.addEventListener("click", async () => {
    const p = await api.pickFolder?.();
    if (!p) return;
    if (els.cacheDir) els.cacheDir.value = p;
    saveCacheDir(p);
  });
}

if (els.cacheDir) {
  els.cacheDir.addEventListener("change", () => saveCacheDir(els.cacheDir.value.trim()));
}

if (els.cacheDirOpen) {
  els.cacheDirOpen.addEventListener("click", async () => {
    const r = await api.storageOpen?.();
    if (r && r.ok === false && els.cacheDirInfo) els.cacheDirInfo.textContent = "打不开：" + (r.error || "");
  });
}

if (els.cacheDirClear) {
  els.cacheDirClear.addEventListener("click", async () => {
    if (els.cacheDirInfo) els.cacheDirInfo.textContent = "清理中…";
    const r = await api.storageClear?.();
    if (!r || r.ok === false) {
      if (els.cacheDirInfo) els.cacheDirInfo.textContent = "清理失败：" + ((r && r.error) || "");
      return;
    }
    await refreshStorage();
    if (els.cacheDirInfo) els.cacheDirInfo.textContent = "已清理 " + r.count + " 个文件（" + fmtBytes(r.bytes) + "）";
  });

  if (els.dataWipe) {
    els.dataWipe.addEventListener("click", async () => {
      // 这一步删掉就找不回来了，先把「删什么、留什么」一条条说清再问。
      const yes = confirm(
        "这会清掉：\n" +
          "· 和她的全部对话记录\n" +
          "· 故障记录与运行日志\n" +
          "· 崩溃快照\n" +
          "· 语音缓存（合成过的话都在里面）\n\n" +
          "不会动：设置（含 API Key）和你自己导入的模型。\n\n" +
          "清完之后找不回来。要继续吗？"
      );
      if (!yes) return;
      if (els.cacheDirInfo) els.cacheDirInfo.textContent = "正在清理…";
      let r = null;
      try {
        r = await api.dataWipe();
      } catch (e) {
        if (els.cacheDirInfo) els.cacheDirInfo.textContent = "清理失败：" + ((e && e.message) || e);
        return;
      }
      if (!r || r.ok === false) {
        const why = r && r.failed && r.failed.length ? "（" + r.failed.slice(0, 2).join("；") + "）" : "";
        if (els.cacheDirInfo) els.cacheDirInfo.textContent = "有文件没删掉" + why;
        await refreshStorage();
        return;
      }
      await refreshStorage();
      if (els.cacheDirInfo) {
        els.cacheDirInfo.textContent =
          "已清除 " + (r.removed ? r.removed.length : 0) + " 项（" + fmtBytes(r.bytes || 0) + "）。设置和模型都还在。";
      }
    });
  }
}

refreshStorage();

/* ── 关于 / 诊断包 ────────────────────────────────────────────────
 * 许可全文放进弹层，不直接铺在页面上：LICENSE.txt 近 3KB，铺开会把设置页
 * 撑成一米长。弹层点背景、点 ✕、按 Esc 都能关；Esc 不会连带关掉设置窗
 * （上面的全局监听已经加了 .modal 判断）。
 */
function showTextView(title, text) {
  const old = document.querySelector(".modal");
  if (old) old.remove();

  const wrap = document.createElement("div");
  wrap.className = "modal";

  const box = document.createElement("div");
  box.className = "box";

  const head = document.createElement("div");
  head.className = "head";

  const b = document.createElement("b");
  b.textContent = title;

  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "✕";
  close.title = "关闭";

  head.appendChild(b);
  head.appendChild(close);

  const pre = document.createElement("pre");
  pre.textContent = text;

  box.appendChild(head);
  box.appendChild(pre);
  wrap.appendChild(box);
  document.body.appendChild(wrap);

  let onKey = null;
  const shut = () => {
    wrap.remove();
    if (onKey) window.removeEventListener("keydown", onKey);
  };
  onKey = (e) => {
    if (e.key === "Escape") shut();
  };

  close.addEventListener("click", shut);
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) shut();
  });
  window.addEventListener("keydown", onKey);
}

async function refreshAbout() {
  if (!els.aboutEnv) return;
  try {
    const a = await api.aboutInfo();
    if (els.aboutVer) els.aboutVer.textContent = "v" + a.version;
    els.aboutEnv.textContent =
      "Electron " + a.electron +
      " · Chromium " + String(a.chromium || "").split(".")[0] +
      " · Node " + a.node +
      (a.packaged ? " · 安装版" : " · 开发模式") +
      (a.settingsBroken ? " · ⚠ 上次设置文件损坏，已重置" : "");
    if (a.settingsBroken) {
      // 悬停能看到坏文件备份到哪儿了，方便找回原来的 API Key / 音色路径。
      els.aboutEnv.title =
        "原文件已备份到：" + (a.settingsBroken.backup || "（备份失败）") +
        "\n" + (a.settingsBroken.error || "");
      els.aboutEnv.style.color = "#ffb454";
    }
    if (a.settingsSaveError) {
      // 上次改动没落盘：可能是磁盘满、目录只读、或者 settings.json 被别的程序锁住。
      els.aboutEnv.textContent += " · ⚠ 设置保存失败";
      els.aboutEnv.title = "上次写盘失败：" + a.settingsSaveError;
      els.aboutEnv.style.color = "#ff6b6b";
    }
  } catch (e) {
    els.aboutEnv.textContent = "读取失败：" + (e && e.message ? e.message : e);
  }
}

// ── 检查更新 ───────────────────────────────────────────────
// 只查、只显示，不下载：NSIS 安装版在运行中替换文件失败会把程序弄成打不开，
// 所以把「装不装、什么时候装」留给用户，这里只负责把版本号说清楚。
let lastUpdate = null;

function updLine(text, cls) {
  const d = document.createElement("div");
  if (cls) d.className = cls;
  d.textContent = text;
  return d;
}

if (els.updCheck) {
  els.updCheck.addEventListener("click", async () => {
    els.updCheck.disabled = true;
    els.updCheck.textContent = "检查中…";
    els.updBox.classList.remove("hidden");
    els.updResult.innerHTML = "";
    els.updResult.appendChild(updLine("正在连 GitHub…", "meta"));
    els.updOpen.classList.add("hidden");
    els.updNotes.classList.add("hidden");
    try {
      const r = await api.updateCheck();
      lastUpdate = r;
      els.updResult.innerHTML = "";
      if (!r || !r.ok) {
        els.updResult.appendChild(
          updLine("检查失败：" + ((r && r.error) || "未知原因"), "bad")
        );
        // 查不到也给个出口：用户可能想自己去页面看看
        els.updOpen.classList.remove("hidden");
        els.updOpen.textContent = "打开 GitHub 页面";
        els.updOpen.dataset.url = (r && r.page) || "";
      } else if (r.empty) {
        els.updResult.appendChild(updLine("仓库里还没有发布过版本", "meta"));
      } else if (r.newer) {
        els.updResult.appendChild(
          updLine("发现新版本 v" + r.latest + "（当前 v" + r.current + "）", "ok")
        );
        if (r.prerelease) els.updResult.appendChild(updLine("这是一个预览版", "meta"));
        if (r.publishedAt) {
          els.updResult.appendChild(
            updLine("发布于 " + new Date(r.publishedAt).toLocaleString(), "meta")
          );
        }
        els.updOpen.classList.remove("hidden");
        els.updOpen.textContent = "打开下载页";
        els.updOpen.dataset.url = r.page || "";
        if (r.notes) els.updNotes.classList.remove("hidden");
      } else if (r.ahead) {
        // 手上这版比发布页还新（内测版 / 自己编的），别让人以为检查坏了
        els.updResult.appendChild(updLine("你手上这版（v" + r.current + "）比 GitHub 上发布的还新", "ok"));
        els.updResult.appendChild(updLine("GitHub 上最新是 v" + r.latest + "，这版可能还没发出去。", "meta"));
      } else {
        els.updResult.appendChild(updLine("已是最新版本（v" + r.current + "）", "ok"));
      }
    } catch (e) {
      els.updResult.innerHTML = "";
      els.updResult.appendChild(
        updLine("检查失败：" + (e && e.message ? e.message : e), "bad")
      );
    } finally {
      els.updCheck.disabled = false;
      els.updCheck.textContent = "检查";
    }
  });
}

if (els.updOpen) {
  els.updOpen.addEventListener("click", async () => {
    const r = await api.updateOpen(els.updOpen.dataset.url || "");
    if (r && r.ok === false) cfgToast("打不开下载页：" + (r.error || ""), true);
  });
}

if (els.updNotes) {
  els.updNotes.addEventListener("click", () => {
    showTextView("更新说明", (lastUpdate && lastUpdate.notes) || "这一版没有写说明");
  });
}

if (els.aboutLicense) {
  els.aboutLicense.addEventListener("click", async () => {
    try {
      const r = await api.aboutLicense();
      showTextView("许可与授权", r && r.ok ? r.text : "读取失败：" + ((r && r.error) || ""));
    } catch (e) {
      showTextView("许可与授权", "读取失败：" + (e && e.message ? e.message : e));
    }
  });
}

if (els.privacyBtn) {
  els.privacyBtn.addEventListener("click", async () => {
    try {
      const r = await api.privacyRead();
      showTextView("隐私说明", r && r.ok ? r.text : "读取失败：" + ((r && r.error) || ""));
    } catch (e) {
      showTextView("隐私说明", "读取失败：" + (e && e.message ? e.message : e));
    }
  });
}

if (els.aboutData) {
  els.aboutData.addEventListener("click", async () => {
    const r = await api.storageOpen?.();
    if (r && r.ok === false) showTextView("打不开数据目录", r.error || "");
  });
}

if (els.logOpen) {
  els.logOpen.addEventListener("click", async () => {
    const r = await api.logOpen?.();
    if (r && r.ok === false) showTextView("打不开日志", r.error || "");
  });
}

let lastDiagDir = "";

// ── 一键体检（1.5.0）───────────────────────────────────────────────
// 结果按「坏了 → 注意 → 正常 → 跳过」排序：打开就看见该看的那几行，
// 正常的那十几行沉在下面当背景，不用一条条读。
const DIAG_ORDER = { bad: 0, warn: 1, ok: 2, skip: 3 };
const DIAG_ICON = { ok: "✓", warn: "!", bad: "×", skip: "·" };

function diagPaintHead(r) {
  if (!els.diagHead) return;
  const s = r.summary || {};
  const parts = [];
  if (s.ok) parts.push("好 " + s.ok);
  if (s.warn) parts.push("注意 " + s.warn);
  if (s.bad) parts.push("坏 " + s.bad);
  if (s.skip) parts.push("跳过 " + s.skip);
  els.diagHead.className = "notice " + (r.score === "bad" ? "bad" : (r.score === "warn" ? "warn" : "ok"));
  els.diagHead.textContent = (r.head || "") + "（" + parts.join(" · ") + "）" + (r.path ? " · 报告已存好" : "");
}

function diagRow(it, extraCls) {
  const row = document.createElement("div");
  row.className = "diag-item " + (it.status || "ok") + (extraCls ? " " + extraCls : "");
  const dot = document.createElement("span");
  dot.className = "d";
  const t = document.createElement("div");
  t.className = "t";
  const b = document.createElement("b");
  b.textContent = (DIAG_ICON[it.status] || "·") + " " + (it.label || "");
  const i = document.createElement("i");
  i.textContent = it.detail || "";
  t.append(b, i);
  if (it.hint) {
    const em = document.createElement("em");
    em.textContent = it.hint;
    t.append(em);
  }
  row.append(dot, t);
  return row;
}

function diagPaintList(items) {
  if (!els.diagList) return;
  els.diagList.innerHTML = "";
  const sorted = (items || []).slice().sort(
    (a, b) => (DIAG_ORDER[a.status] ?? 9) - (DIAG_ORDER[b.status] ?? 9)
  );
  // 默认只铺「要看的」那几行（坏了 + 注意），正常的收起来 —— 体检报告最怕一次糊 14 行，
  // 用户扫两眼就关了。全绿的时候反而全铺，那是好消息，值得看见。
  const core = sorted.filter((x) => x.status === "bad" || x.status === "warn");
  const rest = sorted.filter((x) => x.status !== "bad" && x.status !== "warn");
  const first = core.length ? core : sorted;
  for (const it of first) els.diagList.append(diagRow(it));
  if (core.length && rest.length) {
    let open = false;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "diag-more";
    btn.textContent = "展开全部 " + sorted.length + " 项";
    btn.addEventListener("click", () => {
      open = !open;
      els.diagList.querySelectorAll(".diag-item.extra").forEach((n) => n.remove());
      if (open) {
        for (const it of rest) els.diagList.append(diagRow(it, "extra"));
        btn.textContent = "收起";
      } else {
        btn.textContent = "展开全部 " + sorted.length + " 项";
      }
    });
    els.diagList.append(btn);
  }
}

if (els.diagRunBtn) {
  els.diagRunBtn.addEventListener("click", async () => {
    els.diagRunBtn.disabled = true;
    if (els.diagHead) {
      els.diagHead.className = "notice";
      els.diagHead.textContent = "正在逐项检查…（会真的去连一次桥、列一次音色，不是假装）";
    }
    try {
      const r = await api.diagRun();
      if (!r || !r.ok) throw new Error((r && r.error) || "没跑起来");
      diagPaintHead(r);
      diagPaintList(r.items);
      if (els.diagOpenReport) els.diagOpenReport.disabled = !r.path;
    } catch (e) {
      if (els.diagHead) {
        els.diagHead.className = "notice bad";
        els.diagHead.textContent = "体检没跑完：" + (e && e.message ? e.message : e);
      }
    } finally {
      els.diagRunBtn.disabled = false;
    }
  });
}

if (els.diagOpenReport) {
  els.diagOpenReport.addEventListener("click", async () => {
    const r = await api.diagOpenLatest?.();
    if (r && r.ok === false && els.diagHead) {
      els.diagHead.className = "notice warn";
      els.diagHead.textContent = r.error || "打不开报告";
    }
  });
}

// 这一次运行里查过就先把结果摆出来，不用每次进设置都重新跑一遍
(async () => {
  try {
    const r = await api.diagLast?.();
    if (r && r.ok && r.items && r.items.length) {
      diagPaintHead(r);
      diagPaintList(r.items);
      if (els.diagOpenReport) els.diagOpenReport.disabled = !r.path;
    }
  } catch (e) { }
})();

if (els.diagExport) {
  els.diagExport.addEventListener("click", async () => {
    els.diagExport.disabled = true;
    els.diagResult.textContent = "正在收集…";
    try {
      const r = await api.diagExport();
      if (r && r.canceled) {
        els.diagResult.textContent = "已取消";
      } else if (r && r.ok) {
        lastDiagDir = r.dir;
        els.diagResult.textContent = "已导出 " + r.files.length + " 个文件 → " + r.dir;
        if (els.diagOpenBtn) els.diagOpenBtn.disabled = false;
      } else {
        els.diagResult.textContent = "导出失败：" + ((r && r.error) || "未知错误");
      }
    } catch (e) {
      els.diagResult.textContent = "导出失败：" + (e && e.message ? e.message : e);
    } finally {
      els.diagExport.disabled = false;
    }
  });
}

if (els.diagOpenBtn) {
  els.diagOpenBtn.addEventListener("click", () => {
    if (lastDiagDir) api.diagOpen?.(lastDiagDir);
  });
}

refreshAbout();

// ---- 语音识别模型（whisper turbo，1.6G）----
// 这 1.6G 不随包发，第一次用语音输入时在后台下。这里把主动权交回给用户：
// 看得到进度、能暂停、能重试，别学流氓软件偷偷吃盘。
let asrPolling = false;
async function refreshAsr() {
  if (!els.asrInfo || !els.asrAction) return;
  let st = null;
  try { st = await api.asrTurbo?.(); } catch (e) { st = { ok: false, error: e && e.message }; }
  if (!st || !st.ok) {
    els.asrInfo.textContent = "读取失败：" + ((st && st.error) || "未知原因");
    els.asrAction.disabled = true;
    return;
  }
  const MB = 1048576;
  const TOTAL = 1624555275;
  const fmt = (n) => ((n || 0) / MB).toFixed(0);
  els.asrAction.disabled = false;
  if (st.present) {
    els.asrInfo.textContent = "已就绪 · " + fmt(st.size) + " MB";
    els.asrAction.textContent = "已下载";
    els.asrAction.disabled = true;
    els.asrAction.dataset.act = "";
    return;
  }
  // 取消要排在 error 前面：早期版本里取消会顺带写一条 error，先判 error 会误报「下载失败」
  if (st.cancelled) {
    els.asrInfo.textContent = "已暂停 · " + fmt(st.got) + " / " + fmt(st.total || TOTAL) + " MB";
    els.asrAction.textContent = "继续";
    els.asrAction.dataset.act = "start";
    return;
  }
  if (st.error) {
    els.asrInfo.textContent = "下载失败：" + st.error;
    els.asrAction.textContent = "重试";
    els.asrAction.dataset.act = "start";
    return;
  }
  // 「刚点下载、还没收到第一个字节」这一段 got 是 0，但 attempt 已经 > 0，
  // 不能因为 got=0 就显示成「未下载」，否则用户会以为点了没反应。
  if (!st.done && !st.cancelled && !st.error && (st.attempt > 0 || st.got > 0)) {
    const pct = Math.min(99, Math.round(((st.got || 0) / (st.total || TOTAL)) * 100));
    els.asrInfo.textContent = "下载中 " + pct + "% · " + fmt(st.got) + " / " + fmt(st.total || TOTAL) + " MB";
    els.asrAction.textContent = "暂停";
    els.asrAction.dataset.act = "cancel";
    if (!asrPolling) {
      asrPolling = true;
      setTimeout(() => { asrPolling = false; refreshAsr(); }, 1500);
    }
    return;
  }
  els.asrInfo.textContent = "未下载 · 1.6G，用语音输入时会自动开始";
  els.asrAction.textContent = "下载";
  els.asrAction.dataset.act = "start";
}

if (els.asrAction) {
  els.asrAction.addEventListener("click", async () => {
    const act = els.asrAction.dataset.act;
    if (!act) return;
    els.asrAction.disabled = true;
    try { await api.asrTurboAction?.(act); } catch (e) { /* 下一次刷新会把错误显示出来 */ }
    els.asrAction.disabled = false;
    refreshAsr();
  });
}
refreshAsr();

// ── 网络错误说人话 ─────────────────────────────────────
// ECONNREFUSED / ETIMEDOUT 这些对用户没有意义，但他们能看懂
// 「这个地址上没有服务在听」。文件类错误不走这里，原文更好排错。
function netErr(v) {
  const m = String(v || "");
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH/i.test(m)) return "这个地址上没有服务在听（端口和地址对吗？对方程序起来了吗？）";
  if (/ETIMEDOUT|timeout|timed out|AbortError/i.test(m)) return "等太久没回应（网络或代理的问题）";
  if (/ENOTFOUND|EAI_AGAIN|ERR_NAME/i.test(m)) return "域名解析不了";
  if (/certificate|CERT_|SSL|TLS/i.test(m)) return "证书校验没过";
  if (/401|unauthorized/i.test(m)) return "对方要授权，token 可能不对";
  if (/403|forbidden/i.test(m)) return "对方拒绝了这个请求";
  if (/404/.test(m)) return "对方没有这个接口";
  if (/50[0-9]/.test(m)) return "对方服务出错了";
  return m || "未知原因";
}

// ── 闲置词：预合成缓存的界面部分 ───────────────────────────────
// 这一块只管「说清楚现在什么状态」，不做任何合成决策：
// 合成在 idle-cache.js，走哪个引擎由当前设置决定，这里只发起与展示。
let idleBusy = false;
let idleAutoTried = "";

function fmtBytes(n) {
  const b = Number(n) || 0;
  if (b <= 0) return "0 B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + " KB";
  if (b < 1024 * 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + " MB";
  return (b / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

function fmtWhen(ts) {
  const t = Number(ts) || 0;
  if (!t) return "";
  const d = Math.max(0, Date.now() - t);
  if (d < 60e3) return "刚刚";
  if (d < 3600e3) return Math.round(d / 60e3) + " 分钟前";
  if (d < 86400e3) return Math.round(d / 3600e3) + " 小时前";
  return Math.round(d / 86400e3) + " 天前";
}

// 进度条：total 为 0 时不画（没东西可合成时留着一条空条很奇怪）。
function idleBar(done, total, cls) {
  const el = els.idleCacheBar;
  if (!el) return;
  if (!total) { el.hidden = true; el.classList.remove("done", "bad"); el.firstElementChild.style.width = "0%"; return; }
  el.hidden = false;
  el.classList.toggle("done", cls === "done");
  el.classList.toggle("bad", cls === "bad");
  const pct = Math.max(0, Math.min(100, Math.round((done / total) * 100)));
  el.firstElementChild.style.width = pct + "%";
}

function idlePaint(st) {
  if (!st || !st.ok) return;
  const t = st.target || {};
  if (els.idleLineCount) els.idleLineCount.textContent = String(st.lines || 0);
  const s = st.status;
  const name = t.engine === "feiyu" ? "飞鱼"
    : t.engine === "xtts" ? "XTTS"
      : t.engine === "rvc" ? "RVC" : "内置 TTS";
  const voice = t.voice ? " · " + t.voice : "";
  idleBusy = !!(s && s.busy);
  if (els.idleCacheBuild) {
    els.idleCacheBuild.disabled = !t.canCache || idleBusy;
    els.idleCacheBuild.textContent = idleBusy ? "合成中…" : (s && s.missing === 0 && s.total ? "重新检查" : "预合成");
  }
  if (els.idleCacheCancel) els.idleCacheCancel.hidden = !idleBusy;
  if (els.idleCacheClear) els.idleCacheClear.disabled = idleBusy || !(s && s.files);
  if (els.idleCacheInfo) {
    if (!t.canCache) {
      els.idleCacheInfo.textContent = "当前是 RVC（实时换嗓子）——这条路没有可预合成的音色，换回飞鱼 / XTTS / 内置 TTS 就能用。";
    } else if (s) {
      const head = name + voice + "：已缓存 " + s.cached + " / " + s.total + " 句";
      const tail = s.files ? "（" + fmtBytes(s.bytes) + (s.at ? " · " + fmtWhen(s.at) : "") + "）" : "";
      els.idleCacheInfo.textContent = head + tail;
    }
  }
  if (els.idleCacheHint) {
    if (s && s.missing && !idleBusy) {
      els.idleCacheHint.className = "hint warn";
      els.idleCacheHint.textContent = "还有 " + s.missing + " 句没合成。这些句子触发时会现合成（飞鱼第一句要 20 多秒），点「预合成」把剩下的补上。";
    } else if (s && s.total && !s.missing) {
      els.idleCacheHint.className = "hint";
      els.idleCacheHint.textContent = "这套声音的 " + s.total + " 句都在本机了，触发时直接播，不占引擎。";
    } else {
      els.idleCacheHint.className = "hint";
      els.idleCacheHint.textContent = "只有飞鱼、XTTS 和内置 TTS 能预合成；RVC 是实时换嗓子，合成出来的还是原声，所以不做。";
    }
  }
  idleBar(s && s.cached, s && s.total, s && s.total && s.cached >= s.total ? "done" : "");
  // 「这批缓存是给谁的」——换了音色之后最容易误会的一处。主进程算好 stale，这里只负责说出来。
  // 自动补缓存在主进程排队（设置窗口不开也得能补），这里不再重复发起。
  if (st.meta && st.meta.stale && els.idleCacheHint) {
    els.idleCacheHint.className = "hint warn";
    els.idleCacheHint.textContent = "这些缓存是给「" + st.meta.engine + " · " + st.meta.voice + "」做的，和你现在选的不一样。"
      + "点「预合成」给现在这套补一份，旧的不会删。";
  } else if (st.auto && s && s.missing > 0 && !idleBusy && els.idleCacheHint) {
    els.idleCacheHint.className = "hint";
    els.idleCacheHint.textContent = "开了「自动补」，换完引擎或音色 8 秒后它自己会补，不用管。";
  }
}

async function refreshIdle() {
  try {
    const st = await api.idleStatus?.();
    if (st) idlePaint(st);
  } catch (e) {
    if (els.idleCacheInfo) els.idleCacheInfo.textContent = "读不到缓存状态：" + netErr(e);
  }
}

if (api.onIdleProgress) {
  api.onIdleProgress((p) => {
    if (!p) return;
    if (p.phase === "done" || p.phase === "error") { idleBusy = false; refreshIdle(); return; }
    idleBusy = true;
    if (els.idleCacheBuild) { els.idleCacheBuild.disabled = true; els.idleCacheBuild.textContent = "合成中…"; }
    if (els.idleCacheCancel) els.idleCacheCancel.hidden = false;
    const total = p.total || 0;
    const done = (p.cached || 0);
    idleBar(done, total, "");
    if (els.idleCacheInfo) {
      els.idleCacheInfo.textContent = "正在合成：" + done + " / " + total + " 句" + (p.failed ? "（失败 " + p.failed + "）" : "");
    }
  });
}

if (els.idleCacheBuild) {
  els.idleCacheBuild.addEventListener("click", async () => {
    els.idleCacheBuild.disabled = true;
    const r = await api.idleBuild?.();
    if (!r || !r.ok) {
      els.idleCacheBuild.disabled = false;
      if (els.idleCacheHint) {
        els.idleCacheHint.className = "hint warn";
        els.idleCacheHint.textContent = (r && (r.error || r.err)) || "没能开始合成";
      }
      return;
    }
    idleBusy = true;
    if (els.idleCacheCancel) els.idleCacheCancel.hidden = false;
    if (els.idleCacheHint) {
      els.idleCacheHint.className = "hint";
      els.idleCacheHint.textContent = "开始补 " + (r.total || 0) + " 句（走 " + (r.target && r.target.engine) + "）。可以随时点「停下」，已经合成好的会留着。";
    }
    refreshIdle();
  });
}

if (els.idleCacheCancel) {
  els.idleCacheCancel.addEventListener("click", async () => {
    await api.idleCancel?.();
    idleBusy = false;
    if (els.idleCacheCancel) els.idleCacheCancel.hidden = true;
    refreshIdle();
  });
}

if (els.idleCacheClear) {
  els.idleCacheClear.addEventListener("click", async () => {
    const r = await api.idleClear?.({});
    if (r && r.ok) {
      idleAutoTried = "";   // 清完允许自动补重新跑一次
      if (els.idleCacheHint) {
        els.idleCacheHint.className = "hint";
        els.idleCacheHint.textContent = "清掉了 " + (r.removed || 0) + " 个文件（" + fmtBytes(r.bytes) + "）。下次触发会现合成。";
      }
    }
    refreshIdle();
  });
}

if (els.idleCacheOpen) {
  els.idleCacheOpen.addEventListener("click", () => { api.idleOpen?.().catch(() => { }); });
}

refreshIdle();
// 引擎/音色变了以后缓存状态就得重算：切到声音页签时刷一次，便宜也够用。
for (const el of [els.voiceId, els.voiceOutSeg, els.feiyuRefSel, els.feiyuSpeed, els.xttsRef, els.xttsSpeed]) {
  if (!el) continue;
  el.addEventListener("change", () => { idleAutoTried = ""; setTimeout(refreshIdle, 400); });
}

