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
  // 一键把「能说话」这条链弄通（外部桥 → 自带桥 → 指向它 → 再探一次）
  bridgeEnsure: (opt) => ipcRenderer.invoke("bridge:ensure", opt || {}),
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
  // 桥接令牌：老版 phone-bridge 的 /api/health 不回令牌，主进程从 state.json 里读
  bridgeToken: () => ipcRenderer.invoke("bridge:token"),
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

  // 锁屏 / 休眠 / 最小化时主进程会喊一声，渲染进程把 ticker 停掉。
  onPauseRender: (fn) => {
    ipcRenderer.on("app:pause-render", (_e, on) => fn(!!on));
  },

  // 托盘 / 右键菜单里的快捷互动（喂一口、摸摸头），主窗负责执行
  onPetQuick: (fn) => {
    ipcRenderer.on("pet:quick", (_e, p) => fn(p));
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
  chatExport: (text) => ipcRenderer.invoke("chat:export", text),
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
  resetPosition: () => ipcRenderer.send("settings:reset-position"),

  // 存储：语音缓存和识别模型放哪
  storageInfo: () => ipcRenderer.invoke("storage:info"),
  storageOpen: () => ipcRenderer.invoke("storage:open"),
  storageClear: () => ipcRenderer.invoke("storage:clear"),
  dataWipe: () => ipcRenderer.invoke("data:wipe"),

  // 关于 / 诊断：版本环境、许可文本、打诊断包
  aboutInfo: () => ipcRenderer.invoke("about:info"),
  aboutLicense: () => ipcRenderer.invoke("about:license"),
  // 检查更新：只查询 + 打开下载页，不自动下载安装
  updateCheck: () => ipcRenderer.invoke("update:check"),
  updateOpen: (url) => ipcRenderer.invoke("update:open", url),
  privacyRead: () => ipcRenderer.invoke("privacy:read"),
  diagExport: () => ipcRenderer.invoke("diag:export"),
  // 一键体检：把「能说话」这条链从头到尾走一遍，返回逐项结论 + 报告路径
  diagRun: () => ipcRenderer.invoke("diag:run"),
  diagLast: () => ipcRenderer.invoke("diag:last"),
  diagOpenLatest: () => ipcRenderer.invoke("diag:openLatest"),
  // 闲置词：状态 / 预合成 / 停下 / 清空 / 命中查询 / 打开缓存目录。
  // 触发时先 lookup，命中了直接播本地文件（0 延迟），没命中才走正常合成。
  idleStatus: () => ipcRenderer.invoke("idle:status"),
  idleBuild: () => ipcRenderer.invoke("idle:build"),
  idleCancel: () => ipcRenderer.invoke("idle:cancel"),
  idleClear: (opt) => ipcRenderer.invoke("idle:clear", opt || {}),
  idleLookup: (text) => ipcRenderer.invoke("idle:lookup", { text: String(text || "") }),
  idleOpen: () => ipcRenderer.invoke("idle:open"),
  onIdleProgress: (fn) => {
    if (typeof fn !== "function") return () => { };
    const h = (_e, payload) => { try { fn(payload); } catch (e) { } };
    ipcRenderer.on("idle:progress", h);
    return () => { try { ipcRenderer.removeListener("idle:progress", h); } catch (e) { } };
  },
  // 游戏模式：进去就藏起来、停渲染、把显存还掉；托盘或热键把状态翻回来
  gameSet: (on) => ipcRenderer.invoke("game:set", !!on),
  gameStatus: () => ipcRenderer.invoke("game:status"),
  onGameMode: (fn) => {
    const h = (_e, on) => { try { fn(!!on); } catch (e) { } };
    ipcRenderer.on("app:game-mode", h);
    return () => ipcRenderer.removeListener("app:game-mode", h);
  },

  // 渲染进程把「刚才失败了」报给主进程：那几个状态只活在内存里，重启就没了，
  // 而用户报障基本都是「刚才不行，现在已经重启了」。
  reportFault: (rec) => ipcRenderer.send("fault:report", rec),
  faultList: () => ipcRenderer.invoke("fault:list"),
  // 只在隔离实例里存在（FISH_MULTI=1，主进程那边同样条件注册）：给自动化测试一个
  // 不弹对话框的出口。正常启动没有这个变量，页面里也就没有这个方法。
  diagExportTo: process.env.FISH_MULTI === "1"
    ? (dir) => ipcRenderer.invoke("diag:exportTo", dir)
    : undefined,
  // 同上：只在自测实例里存在，读主窗口的真实状态（总在最前 / 点击穿透 / 尺寸）。
  // 「总在最前」「点击穿透」改的是 BrowserWindow，渲染进程看不见，只能问主进程。
  testWinState: process.env.FISH_MULTI === "1"
    ? () => ipcRenderer.invoke("__test:winState")
    : undefined,
  // 自测专用：跑一次「唤出」。全局快捷键要 OS 层真按键，探针按不出来。
  testSummon: process.env.FISH_MULTI === "1"
    ? () => ipcRenderer.invoke("__test:summon")
    : undefined,
  // 自测专用：模拟「人不在」（锁屏 / 最小化 / 休眠都是这条通路），
  // 以及读主进程真的发出去了多少帧坐标。锁屏时还在推就是白耗电。
  testPauseRender: process.env.FISH_MULTI === "1"
    ? (on) => ipcRenderer.send("__test:pauseRender", !!on)
    : undefined,
  testCursorFeed: process.env.FISH_MULTI === "1"
    ? () => ipcRenderer.invoke("__test:cursorFeed")
    : undefined,
  // 自测专用：读主进程「DSH 活跃度」那个 2 秒扫描跑了多少次。
  // 人不在时它应该一动不动 —— 那是两层 readdir + 每个会话一次 statSync。
  testIdleStats: process.env.FISH_MULTI === "1"
    ? () => ipcRenderer.invoke("__test:idleStats")
    : undefined,
  // 自测专用：主进程所有出站请求的记录（只有 FISH_MULTI=1 时才有这条通道）。
  testNetLog: process.env.FISH_MULTI === "1"
    ? () => ipcRenderer.invoke("__test:netLog")
    : undefined,
  diagOpen: (p) => ipcRenderer.invoke("diag:open", p),
  logOpen: () => ipcRenderer.invoke("log:open"),
  // 渲染进程的未捕获错误 → 主进程 run.log。打包版没有 DevTools，
  // 不送过来，用户只能描述「她突然不动了」。
  reportError: (info) => ipcRenderer.send("renderer:error", info),
  asrTurbo: () => ipcRenderer.invoke("asr:turbo"),
  asrTurboAction: (a) => ipcRenderer.invoke("asr:turbo-action", a),
  testNudge:
    process.env.FISH_MULTI === "1" ? () => ipcRenderer.send("__test:nudge") : undefined,
  testMetrics:
    process.env.FISH_MULTI === "1" ? () => ipcRenderer.invoke("__test:metrics") : undefined,
  testListeners: process.env.FISH_MULTI === "1"
    ? () => ipcRenderer.invoke("__test:listeners")
    : undefined,

  // 相处档案（独立窗口：等级 / 今天 / 七天 / 徽章）
  openProfile: () => ipcRenderer.invoke("profile:open"),
  petPanelOpen: () => ipcRenderer.invoke("pet:panel-open"),
  claimSettle: (key) => ipcRenderer.sendSync("pet:claim-settle", key),
  onPetPanelState: (fn) => ipcRenderer.on("pet:panel-state", (_e, open) => fn(!!open)),
  closeProfile: () => ipcRenderer.invoke("profile:close"),
  profileExport: (text) => ipcRenderer.invoke("profile:export", text),
  copyText: (text) => ipcRenderer.invoke("clipboard:write", text),

  // 首次运行引导
  openWelcome: () => ipcRenderer.invoke("welcome:open"),
  closeWelcome: () => ipcRenderer.invoke("welcome:close"),

  // 主窗口右键菜单（原生菜单，入口都在主进程那边拼）
  windowMenu: () => ipcRenderer.invoke("window:menu"),

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
  // 只换了规则（取景 / 表情 / 动作路由），模型不用重载 —— 别和 pack-changed 混成一个事件，
  // 那个在渲染端等于整页 reload。
  onPackRules: (fn) => {
    ipcRenderer.on("pack-rules", (_e, id) => fn(id));
  },
  // 导入模型的复制进度：{ files, bytes, done? }。返回一个退订函数 ——
  // 导入窗口会重载，不退订的话旧监听器会越叠越多（每次导入都多收一份回调）。
  onModelImportProgress: (fn) => {
    const h = (_e, p) => fn(p || {});
    ipcRenderer.on("model:import-progress", h);
    return () => ipcRenderer.removeListener("model:import-progress", h);
  },

  welcomeFit: () => ipcRenderer.invoke("welcome:fit"),
  welcomePrecheck: () => ipcRenderer.invoke("welcome:precheck"),
  quit: () => ipcRenderer.send("quit"),

  // 仅供自动化测试：模拟"连续拖滑块"（生产环境里只有主进程有 FISH_TEST 时才响应）
  testScale: (v) => ipcRenderer.invoke("test:scale", v),
  testGeom: () => ipcRenderer.invoke("test:geom"),

  // 仅供自动化测试：主进程发一句"假装听到的话"，走完整语音后半段
  onTestVoice: (fn) => {
    ipcRenderer.on("fish-test-voice", (_e, text) => fn(text));
  },
});
