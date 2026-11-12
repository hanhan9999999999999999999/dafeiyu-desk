// preload：渲染进程与主进程之间唯一的桥
// 只暴露具体动作，不暴露 ipcRenderer 本体。
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("deskfish", {
  // 窗口拖动：全程主进程算位移，跨屏不会算飞
  moveBy: (dx, dy) => ipcRenderer.send("win:moveBy", dx, dy),
  dragStart: () => ipcRenderer.send("win:dragStart"),
  dragMove: () => ipcRenderer.send("win:dragMove"),
  dragEnd: () => ipcRenderer.send("win:dragEnd"),

  // 输入框要打字时临时开焦点（平时窗口 focusable:false，不抢别的窗口）
  testBridge: (url) => ipcRenderer.invoke("bridge:test", url),
  // 自带的迷你桥接：没有 phone-bridge 的机器靠它一键连上 DSH
  miniStatus: () => ipcRenderer.invoke("mini:status"),
  miniStart: () => ipcRenderer.invoke("mini:start"),
  miniStop: () => ipcRenderer.invoke("mini:stop"),
  rvcStatus: () => ipcRenderer.invoke("rvc:status"),
  rvcStart: () => ipcRenderer.invoke("rvc:start"),
  rvcStop: () => ipcRenderer.invoke("rvc:stop"),
  rvcSetupStatus: () => ipcRenderer.invoke("rvc:setupStatus"),
  rvcSetup: () => ipcRenderer.invoke("rvc:setup"),
  rvcSetupStop: () => ipcRenderer.invoke("rvc:setupStop"),
  rvcListModels: () => ipcRenderer.invoke("rvc:listModels"),
  xttsSetupStatus: () => ipcRenderer.invoke("xtts:setupStatus"),
  xttsSetup: () => ipcRenderer.invoke("xtts:setup"),
  xttsSetupStop: () => ipcRenderer.invoke("xtts:setupStop"),
  feiyuRefs: () => ipcRenderer.invoke("feiyu:refs"),
  feiyuSetupStatus: () => ipcRenderer.invoke("feiyu:setupStatus"),
  feiyuSetup: () => ipcRenderer.invoke("feiyu:setup"),
  feiyuSetupStop: () => ipcRenderer.invoke("feiyu:setupStop"),
  onRvcSetup: (fn) => ipcRenderer.on("rvc-setup", (_e, line) => fn(line)),
  onXtssSetup: (fn) => ipcRenderer.on("xtts-setup", (_e, line) => fn(line)),
  onFeiyuSetup: (fn) => ipcRenderer.on("feiyu-setup", (_e, line) => fn(line)),
  testApi: (cfg) => ipcRenderer.invoke("api:test", cfg),
  chatApi: (req) => ipcRenderer.invoke("api:chat", req),
  setFocusable: (v) => ipcRenderer.send("win:focusable", !!v),

  // 全局鼠标坐标（主进程采集）
  onCursor: (fn) => {
    ipcRenderer.on("cursor", (_e, p) => fn(p));
  },

  // DSH 到底在不在干活（主进程扫 session 文件的写入时间）
  onDshActivity: (fn) => {
    ipcRenderer.on("dsh-activity", (_e, p) => fn(p));
  },

  onDshState: (fn) => {
    ipcRenderer.on("dsh-state", (_e, p) => fn(p));
  },

  // 设置变更（模型窗口要跟着改锐化/分辨率/跟随/眨眼）
  onSettingsChanged: (fn) => {
    ipcRenderer.on("settings-changed", (_e, s) => fn(s));
  },

  // 窗口尺寸变了，让渲染侧重算取景
  onRelayout: (fn) => {
    ipcRenderer.on("relayout", () => fn());
  },

  // 全局热键唤出输入条
  onSummon: (fn) => {
    ipcRenderer.on("summon", () => fn());
  },

  // 全局热键 Ctrl+Alt+S：手动播一次伸懒腰（调动作时用）
  onStretch: (fn) => {
    ipcRenderer.on("act:stretch", () => fn());
  },

  // 全局热键：一键开麦。主进程只发信号，开关由 FishVoice.toggle() 决定。
  onMicToggle: (fn) => {
    ipcRenderer.on("mic:toggle", () => fn());
  },

  // 快捷键注册结果（设置界面显示「已生效 / 被占用」用）
  hotkeyStatus: () => ipcRenderer.invoke("hotkey:status"),
  // 开机自启的真实状态：设置里想要 vs 注册表里到底有没有
  autostartStatus: () => ipcRenderer.invoke("autostart:status"),

  // 语音引擎在冷启动 / 重新加载模型，要 20 多秒。前端收到就先说一句，
  // 否则这段等待完全没有反馈，用起来像卡死了。
  onTtsWaiting: (fn) => {
    ipcRenderer.on("tts-waiting", (_e, text) => fn(text));
  },

  // 对话记录（独立窗口，落盘，重启也在）
  openChatLog: () => ipcRenderer.invoke("chat:open"),
  closeChatLog: () => ipcRenderer.invoke("chat:close"),
  isChatLogOpen: () => ipcRenderer.invoke("chat:isOpen"),
  chatList: () => ipcRenderer.invoke("chat:list"),
  chatAppend: (item) => ipcRenderer.invoke("chat:append", item),
  chatMerge: (items) => ipcRenderer.invoke("chat:merge", items),
  chatClear: () => ipcRenderer.invoke("chat:clear"),
  onChatUpdate: (fn) => {
    ipcRenderer.on("chat:update", (_e, item) => fn(item));
  },
  onChatCleared: (fn) => {
    ipcRenderer.on("chat:cleared", () => fn());
  },

  // 看屏幕：监视窗 + 抓帧 + 她的点评
  openSeeWatch: () => ipcRenderer.invoke("see:open"),
  closeSeeWatch: () => ipcRenderer.invoke("see:close"),
  seeStart: () => ipcRenderer.invoke("see:start"),
  seeStop: () => ipcRenderer.invoke("see:stop"),
  seeStatus: () => ipcRenderer.invoke("see:status"),
  seeSnapshot: () => ipcRenderer.invoke("see:snapshot"),
  onSeeFrame: (fn) => {
    ipcRenderer.on("see:frame", (_e, f) => fn(f));
  },
  onSeeComment: (fn) => {
    ipcRenderer.on("see:comment", (_e, c) => fn(c));
  },
  onSeeStatus: (fn) => {
    ipcRenderer.on("see:status", (_e, s) => fn(s));
  },
  onSeeError: (fn) => {
    ipcRenderer.on("see:error", (_e, e) => fn(e));
  },
  onSeeSay: (fn) => {
    ipcRenderer.on("see:say", (_e, c) => fn(c));
  },

  // 状态面板（独立窗口，能拖到屏幕任何地方）
  openPetPanel: () => ipcRenderer.invoke("pet:open"),
  closePetPanel: () => ipcRenderer.invoke("pet:close"),
  isPetPanelOpen: () => ipcRenderer.invoke("pet:isOpen"),

  // 设置界面
  openSettings: () => ipcRenderer.send("settings:open"),
  closeSettings: () => ipcRenderer.send("settings:close"),
  settingsGet: () => ipcRenderer.invoke("settings:get"),
  settingsPatch: (patch) => ipcRenderer.invoke("settings:patch", patch),
  settingsReset: () => ipcRenderer.invoke("settings:reset"),
  settingsExport: () => ipcRenderer.invoke("settings:export"),
  settingsImport: () => ipcRenderer.invoke("settings:import"),
  pickAudio: () => ipcRenderer.invoke("settings:pickAudio"),
  pickFolder: () => ipcRenderer.invoke("settings:pickFolder"),
  openViewFrame: () => ipcRenderer.invoke("viewframe:open"),
  closeViewFrame: () => ipcRenderer.invoke("viewframe:close"),
  resetPosition: () => ipcRenderer.send("settings:reset-position"),

  // 存储：语音缓存和识别模型放哪
  storageInfo: () => ipcRenderer.invoke("storage:info"),
  storageOpen: () => ipcRenderer.invoke("storage:open"),
  storageClear: () => ipcRenderer.invoke("storage:clear"),

  // 关于 / 诊断：版本环境、许可文本、打诊断包
  aboutInfo: () => ipcRenderer.invoke("about:info"),
  aboutLicense: () => ipcRenderer.invoke("about:license"),
  privacyRead: () => ipcRenderer.invoke("privacy:read"),
  diagExport: () => ipcRenderer.invoke("diag:export"),
  diagOpen: (p) => ipcRenderer.invoke("diag:open", p),
  logOpen: () => ipcRenderer.invoke("log:open"),
  asrTurbo: () => ipcRenderer.invoke("asr:turbo"),
  asrTurboAction: (a) => ipcRenderer.invoke("asr:turbo-action", a),

  // 首次运行引导
  openWelcome: () => ipcRenderer.invoke("welcome:open"),
  closeWelcome: () => ipcRenderer.invoke("welcome:close"),

  // 模型适配器（独立窗口：模型库 / 预览 / 分步绑定）
  openAdapter: (id, step) => ipcRenderer.invoke("adapter:open", id || "", step || ""),
  closeAdapter: () => ipcRenderer.send("adapter:close"),
  adapterPickDir: () => ipcRenderer.invoke("adapter:pickDir"),
  adapterPickArchive: () => ipcRenderer.invoke("adapter:pickArchive"),
  // 主窗口空状态用：选包 → 导入 → 切换，一步到位
  modelImport: (kind) => ipcRenderer.invoke("model:import", kind || "zip"),
  adapterActivate: (id) => ipcRenderer.invoke("adapter:activate", id),
  adapterReload: () => ipcRenderer.invoke("adapter:reload"),
  // 适配器窗口被要求切到某个模型时（已在窗口里点另一个包的情况）
  onAdapterSelect: (fn) => {
    ipcRenderer.on("adapter:select", (_e, id) => fn(id));
  },
  // 从设置页再点一次「调整取景」：窗口已开着时只滚到取景那一步，不重建窗口
  onAdapterFocusStep: (fn) => {
    ipcRenderer.on("adapter:focus-step", (_e, step) => fn(step));
  },
  // 模型换了：主窗口要重新加载整个 Live2D
  onPackChanged: (fn) => {
    ipcRenderer.on("pack-changed", (_e, id) => fn(id));
  },

  welcomeFit: () => ipcRenderer.invoke("welcome:fit"),
  quit: () => ipcRenderer.send("quit"),

  // 仅供自动化测试：模拟"连续拖滑块"（生产环境里只有主进程有 FISH_TEST 时才响应）
  testScale: (v) => ipcRenderer.invoke("test:scale", v),
  testGeom: () => ipcRenderer.invoke("test:geom"),

  // 仅供自动化测试：主进程发一句"假装听到的话"，走完整语音后半段
  onTestVoice: (fn) => {
    ipcRenderer.on("fish-test-voice", (_e, text) => fn(text));
  },
});
