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
  resSeg: document.getElementById("resSeg"),
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
  hotkeyResult: document.getElementById("hotkeyResult"),
  quit: document.getElementById("quit"),
  ver: document.getElementById("ver"),
  cacheDir: document.getElementById("cacheDir"),
  cacheDirPick: document.getElementById("cacheDirPick"),
  cacheDirOpen: document.getElementById("cacheDirOpen"),
  cacheDirClear: document.getElementById("cacheDirClear"),
  cacheDirInfo: document.getElementById("cacheDirInfo"),
  asrInfo: document.getElementById("asrInfo"),
  asrAction: document.getElementById("asrAction"),
  aboutEnv: document.getElementById("aboutEnv"),
  aboutVer: document.getElementById("aboutVer"),
  aboutLicense: document.getElementById("aboutLicense"),
  privacyBtn: document.getElementById("privacyBtn"),
  aboutData: document.getElementById("aboutData"),
  logOpen: document.getElementById("logOpen"),
  diagExport: document.getElementById("diagExport"),
  diagOpenBtn: document.getElementById("diagOpenBtn"),
  diagResult: document.getElementById("diagResult"),
  micDevice: document.getElementById("micDevice"),
  voiceId: document.getElementById("voiceId"),
  voiceTry: document.getElementById("voiceTry"),
  bridgeUrl: document.getElementById("bridgeUrl"),
  bridgeTest: document.getElementById("bridgeTest"),
  bridgeResult: document.getElementById("bridgeResult"),
  bridgeAddrs: document.getElementById("bridgeAddrs"),
  miniToggle: document.getElementById("miniToggle"),
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
  feiyuInstall: document.getElementById("feiyuInstall"),
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

async function fillMicDevices(cur) {
  if (!micDeviceSel) micDeviceSel = els.micDevice;
  if (!micDeviceSel) return;
  try {
    // 没授过麦克风权限时 enumerateDevices 拿不到设备名（label 为空），
    // 先要一次权限（拿到就立刻关掉，不占用设备）。
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch (e) { }
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
  } catch (e) { }
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
    if (els.bridgeResult) els.bridgeResult.textContent = "试听失败：" + String(e.message || e).slice(0, 40);
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
  const other = key === "hotkeyMic" ? "hotkeySummon" : "hotkeyMic";
  const otherVal = (cur && cur[other]) || "";
  if (accel && otherVal && accel.toLowerCase() === otherVal.toLowerCase()) {
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
    const miss = [];
    if (st.mic && !st.bound.includes(st.mic)) miss.push("开麦 " + accelLabel(st.mic));
    if (st.summon && !st.bound.includes(st.summon)) miss.push("唤出 " + accelLabel(st.summon));
    if (miss.length) {
      els.hotkeyResult.className = "result bad";
      els.hotkeyResult.textContent = "⚠ 被别的软件占用，没注册上：" + miss.join("、") + "（换一个键试试）";
    } else if (st.mic || st.summon) {
      els.hotkeyResult.className = "result ok";
      els.hotkeyResult.textContent = "● 快捷键已生效" + (st.mic ? " · 开麦 " + accelLabel(st.mic) : " · 开麦未设置");
    } else {
      els.hotkeyResult.className = "result";
      els.hotkeyResult.textContent = "两个快捷键都空着：功能还在，只是没有键盘入口";
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
  for (const [key, el] of [["hotkeyMic", els.hotkeyMic], ["hotkeySummon", els.hotkeySummon]]) {
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

function paint(s) {
  cur = s;
  els.scaleNum.value = Math.round(s.scale * 100);
  els.opacityNum.value = Math.round(s.opacity * 100);
  if (els.bridgeUrl) els.bridgeUrl.value = s.bridgeUrl || "";
  if (els.apiBase) els.apiBase.value = s.apiBase || "";
  if (els.apiKey) els.apiKey.value = s.apiKey || "";
  if (els.apiModel) els.apiModel.value = s.apiModel || "";
  if (els.seeBase) els.seeBase.value = s.seeBase || "";
  if (els.seeKey) els.seeKey.value = s.seeKey || "";
  if (els.seeModel) els.seeModel.value = s.seeModel || "";
  if (els.seeInterval) els.seeInterval.value = String(s.seeInterval == null ? 1.6 : s.seeInterval);
  if (els.seeGap) els.seeGap.value = String(s.seeGap == null ? 7 : s.seeGap);
  if (els.seeSpeak) els.seeSpeak.classList.toggle("on", s.seeSpeak !== false);
  // 看屏幕：默认程序自带（不填接口），只有填了地址才算「外部接口」
  if (els.seeModeSeg) {
    const useApi = !!String(s.seeBase || "").trim();
    for (const b of els.seeModeSeg.children) {
      b.classList.toggle("on", b.dataset.v === (useApi ? "api" : "own"));
    }
    if (els.seeApiBox) els.seeApiBox.classList.toggle("hidden", !useApi);
    if (els.seeModeHint) {
      els.seeModeHint.textContent = useApi
        ? "现在走外部视觉接口。截图仍然只在本机抓，只有这一帧图和一句提示会发到你填的地址。"
        : "默认用程序自带的看图逻辑（本机 DSH，不需要 Key，也不用装别的东西）。已经买了视觉 API 的，可以切到外部接口。";
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
  if (els.feiyuState && !/^引擎|^✗|^合成中/.test(els.feiyuState.textContent || "")) {
    els.feiyuState.className = "hint";
    els.feiyuState.textContent = s.voiceOut === "feiyu"
      ? "已启用 · 参考" + (s.feiyuRef ? s.feiyuRef : "自动挑选")
      : "未启用（上面「语音输出」选「飞鱼」才会用）";
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
  for (const key of ["sharpen", "alwaysOnTop", "clickThrough", "followCursor", "autoIdle", "blinkEnabled", "launchAtLogin", "dockAutoHide"]) {
    // 判空：少一个元素只跳过它，不能让 paint() 抛出去——
    // 这里一抛，后面所有按钮的 addEventListener 都不会执行，整个面板就「点了没反应」。
    const el = els[key];
    if (el) el.classList.toggle("on", s[key] === true);
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
      push({ seeBase: "", seeModel: "", seeKey: "" });
    } else {
      if (els.seeApiBox) els.seeApiBox.classList.remove("hidden");
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

if (els.feiyuTry) {
  els.feiyuTry.addEventListener("click", async () => {
    if (els.feiyuState) {
      els.feiyuState.className = "hint";
      els.feiyuState.textContent = "合成中…（第一次要加载模型，约 20 秒）";
    }
    try {
      const r = await fetch("/engine/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "主人，我在的。" }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || "合成失败");
      if (els.feiyuState) {
        els.feiyuState.className = "hint";
        els.feiyuState.textContent = "引擎 " + (j.engine || "?") + " · " + (j.dur || "?") + "s"
          + (j.cached ? " · 缓存" : "");
      }
      const a = new Audio(j.url);
      a.play().catch(() => {});
    } catch (e) {
      if (els.feiyuState) {
        els.feiyuState.className = "hint bad";
        els.feiyuState.textContent = "✗ " + (e && e.message || e);
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
  if (els.rvcAutoStop) els.rvcAutoStop.classList.toggle("on", !!(cur && cur.rvcAutoStop));
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
      els.apiResult.textContent = "✗ " + ((e && e.message) || e);
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

// ---- 开关 ----
for (const key of ["sharpen", "alwaysOnTop", "clickThrough", "followCursor", "autoIdle", "blinkEnabled", "launchAtLogin", "dockAutoHide"]) {
  const el = els[key];
  if (el) el.addEventListener("click", () => push({ [key]: !cur[key] }));
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
            d.innerHTML = '<span class="u">' + esc(a.url) + "</span>" +
                          '<span class="n">' + esc(a.label || a.nic || "") + "</span>";
            d.addEventListener("click", () => {
              if (els.bridgeUrl) els.bridgeUrl.value = a.url;
              api.settingsPatch({ bridgeUrl: a.url });
            });
            els.bridgeAddrs.appendChild(d);
          });
        }
      } else {
        if (els.bridgeResult) {
          els.bridgeResult.innerHTML =
            '<span class="bad">● 连不上</span>' +
            '<span class="meta"> · ' + r.ms + "ms · " + esc(r.error || "未知原因") + "</span>";
        }
      }
    } catch (e) {
      if (els.bridgeResult) {
        els.bridgeResult.innerHTML = '<span class="bad">● 出错</span><span class="meta"> · ' +
          esc(String((e && e.message) || e)) + "</span>";
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
els.quit.addEventListener("click", () => api.quit());
document.getElementById("close").addEventListener("click", () => api.closeSettings());
// 设置窗自己也支持 Esc 关掉
window.addEventListener("keydown", (e) => {
  // 许可弹层开着时 Esc 只关弹层，别顺手把整个设置窗也关了
  if (e.key === "Escape" && !document.querySelector(".modal")) api.closeSettings();
});

// ---- 初始化 ----
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
