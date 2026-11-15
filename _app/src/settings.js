// 配置层：所有可变状态集中在这里，落盘到 userData/settings.json
// 设计原则：
//   1) 只认白名单字段，外部传什么都不污染内部结构
//   2) 每个字段都有类型与范围校验，坏了就回默认值，不让它把窗口搞没
//   3) 写盘用「临时文件 + rename」，断电也不会留半个坏 JSON

const fs = require("fs");
const path = require("path");

const DEFAULTS = {
  // 窗口尺寸不存这里：基准尺寸是 main.js 的 BASE_W / BASE_H 常量。
  // 用户能改的只有 scale。早先留了 width/height 两项，从来没被读过，已删掉。
  // 位置存「离屏幕右下角多远」，不存绝对坐标。
  // 这样缩放窗口、换屏幕、改分辨率，右下角都天然钉住。
  // 注意：这个键目前只写不读 —— stashAnchor() 每次都写 "corner"，但没有一行代码读它
  // 来决定行为，"free"（记住绝对坐标）模式从未实现。它没有界面控件，所以伤不到人；
  // 真要实现 free，得先让 ensureStartPos / scheduleResize 认它。
  // scripts/audit-settings.js 会盯着这件事：只写不读的键必须登记并写明原因。
  anchorMode: "corner", // "corner" = 跟随右下角；"free" = 记住绝对坐标（未实现）
  offsetRight: 30,
  offsetBottom: 6,
  x: null,
  y: null,
  scale: 1, // 0.5 ~ 2
  opacity: 1, // 0.3 ~ 1
  alwaysOnTop: true,
  // 行为
  clickThrough: false, // 鼠标穿透
  micDevice: "",
  followCursor: true, // 头部跟随鼠标
  autoIdle: true, // 空闲时随机小动作
  blinkEnabled: true,
  // 底部输入条：鼠标不靠近时自动隐藏（关掉则一直显示）
  dockAutoHide: true,
  // 观感
  sharpen: true,
  // 取景：存「模型上的一个矩形」，不是缩放+偏移两个数。
  // 主窗口照着这个矩形摆，换任何模型都不用重推公式。
  // y/h 都是相对模型包围盒的 0~1。.205 / 0.36 是「头到胸」那版调出来的构图。
  // pack = 这份取景是为哪个模型调的，换模型后作废（见 src/renderer.js 的 bootSafe）。
  viewBox: { y: -0.02, h: 0.40 },
  // 当前用哪个模型包（src/packs 的包 id）。空 = 用第一个内置包。
  activePack: "",
  resolution: 2, // 1 | 2 | 3 超采样倍数
  // 贴图精度：0=自动（按显卡能力，通常给到长边 4096），其余值就是贴图长边的像素上限。
  // 这一项决定衣服上的蕾丝、褶边清不清楚：贴图从 8192 缩到 2048 时，衣服细节会糊成一片。
  // 调大更清楚、更吃显存；调小省显存、会变糊。改完立刻生效，不用重启。
  texMax: 0, // 0 | 1024 | 2048 | 3072 | 4096
  // 表情开关贴片：脸红、爱心眼、>< 笑眼、黑脸、张嘴、屑屑眼这些「整张贴图切换」。
  // 关掉之后她只靠眼睑/眉/嘴角的连续参数演，不会突然换一张脸。
  exprPatch: true,
  fpsCap: 30, // 60 | 30 | 15 —— 她动起来的帧率上限；空闲时还会再降到 15
  // 说话的声音。空 = 用引擎自己的默认（晓萱）。
  voiceId: "",
  // 语音缓存 / 识别模型放哪。空 = 系统用户目录（userData）。
  // 改完要重启软件：语音引擎是启动时按这个路径起的子进程，半路换目录它不认。
  cacheDir: "",
  // 首次运行引导：弹一次「右键设置 / 两个快捷键」，点「知道了」之后置 false。
  firstRun: true,
  // 上次提示过的那份崩溃记录文件名：同一份不再重复问。
  lastCrashSeen: "",
  // 问过「要不要下语音识别模型（1.6G）」没有。问过一次就不再弹，
  // 想下随时去设置 → 语音识别模型点「下载」。
  turboAsked: false,
  // DSH 桥接（语音对话要发给谁）
  // 默认本机 phone-bridge。换设备时在这里填对方那台的地址。
  // 8898 是自带迷你桥接（_app/bridge/mini-bridge.mjs）的端口；
  // 8899 是另一个独立程序 phone-bridge 的，写在这儿会连错人。
  // voice.js 自己还有一份 BASE 默认值，两处必须一致，改一处等于没改。
  bridgeUrl: "http://127.0.0.1:8899",
  // 回复走哪个模型："dsh" = 走桥接（能看到工具、能改文件）；
  // "api" = 走自己填的 OpenAI 兼容接口（不依赖 DSH，换电脑也能用）。
  replyMode: "dsh",
  apiBase: "",
  apiKey: "",
  apiModel: "",
  // 语音输出走哪条：「tts」 内置 Edge TTS（快）；
  // 「rvc」 TTS 之后再跑一遍 RVC 换成别的音色（慢，而且要自己装 Python 环境）；
  // 「xtts」 直接从参考音频克隆音色（RTX 4060 上约 1 秒/句，首次启用要等约 60 秒加载模型）。
  // 「飞鱼」是默认：中文不卷舌、每句 1～2 秒，参考音频决定音色。
  // 其余三档：「tts」最快最稳（Edge 晓萱）；「rvc」先 TTS 再换嗓子（慢，要装 Python）；
  // 「xtts」直接从参考音频克隆（RTX 4060 上约 1 秒一句，首次启用要等 60 秒加载模型）。
  voiceOut: "feiyu",
  // 启动即预热飞鱼：默认关。模型约 8GB 显存/内存，开机就装进去对只偶尔说话的人不划算；
  // 打开后第一句更快，关掉时首次说话要等引擎装载。
  voiceWarm: false,
  // 静音：只停她的声音，消息气泡、动作、看屏幕都不受影响。
  // 开会/听歌时按 Ctrl+Shift+Q 或点托盘里的「静音」即可，退出重进仍保持。
  mute: false,
  // 她的音量（0–1，默认 85%）：只影响语音和语气词，不影响系统音量。
  volume: 0.85,
  rvcPython: "",
  rvcModel: "models/warma/Warma-03.onnx",
  rvcDevice: "dml",
  rvcBackend: "onnx",
  rvcPitch: 0,
  rvcAutoStop: true,
  // XTTS：参考音频留空就用内置那段晓萱（assets/voice/ref-晓萱.mp3）。
  xttsRef: "",
  xttsSpeed: 1,
  // 飞鱼（CosyVoice3）：两个预训声线，speed 0 = 用模型自带的默认语速。
  feiyuStyle: "cute",
  feiyuSpeed: 0,
  // 参考音频：留空 = 按每句话的情绪自动挑（推荐）；填文件名或标签就固定用它。
  feiyuRef: "",
  feiyuRefDir: "",
  // 飞鱼环境的根目录（下面应该有 venv/ models/ cosyvoice/ 三个子目录）。
  // 留空 = 自动找：包内 feiyu/ → D:\feiyu。别人把飞鱼装到别处时在这里填一下。
  feiyuHome: "",
  // 全局快捷键
  // 一键开麦：按下就在主窗口里切换语音输入（等同点那个圆形按钮）。
  // 留空 = 不注册。Accelerator 写法，如 CommandOrControl+Alt+M。
  hotkeyMic: "CommandOrControl+Shift+M",
  // 唤出输入条（原来写死 Ctrl+Alt+F，现在可改）
  hotkeySummon: "CommandOrControl+Alt+F",
  // 静音开关：按一下静音，再按一下恢复。留空 = 不注册。
  hotkeyMute: "CommandOrControl+Shift+Q",
  // 看屏幕：她实时看主人桌面并随口点评。
  // interval = 抓屏间隔（秒），gap = 两次点评之间至少隔多久（秒）。
  seeInterval: 1.6,
  seeGap: 7,
  seeSpeak: true,
  // 视觉模型：留空 = 沿用「回复模型」里的 apiBase / apiKey / apiModel。
  // 但文本模型看不了图，所以想让她真的看见，最好单独填一个支持图片的模型。
  seeBase: "",
  seeKey: "",
  seeModel: "",
  // 启动
  launchAtLogin: false,
  // 版本（将来迁移用）
  version: 2,
  // 上次提醒过的版本号（同版本只提醒一次）、上次检查更新的时间戳（ms）。
  // 都是本地节流用，不参与任何业务逻辑。
  lastUpdateNotice: "",
  lastUpdateCheckAt: 0,
};

const RANGES = {
  scale: [0.5, 2],
  opacity: [0.3, 1],
  resolution: [1, 3],
  fpsCap: [15, 60],
  volume: [0, 1],
  offsetRight: [-2000, 4000],
  offsetBottom: [-2000, 4000],
  // RVC 变调：正数升调，负数降调。±12 是一个八度，超出就没法听了。
  rvcPitch: [-12, 12],
  seeInterval: [0.8, 6],
  seeGap: [3, 60],
};

const BOOLS = [
  "rvcAutoStop", "alwaysOnTop", "clickThrough", "followCursor", "autoIdle", "blinkEnabled", "sharpen", "launchAtLogin", "dockAutoHide", "seeSpeak", "mute", "exprPatch"];

function clamp(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(hi, Math.max(lo, n));
}

// 把任意对象洗成合法配置。
function sanitize(raw) {
  // viewBox 要单独深拷一份：DEFAULTS 是模块级常量，浅拷贝会让返回值与它共用
  // 同一个 viewBox 对象——调用方改一下自己的配置，就把全局默认值也改了，
  // 之后每次 sanitize 都带着那个脏值（实测：一次 h=0.9 会污染整个进程）。
  const out = { ...DEFAULTS, viewBox: { ...DEFAULTS.viewBox } };
  if (!raw || typeof raw !== "object") return out;

  // viewBox 是对象，走下面的通用循环会被当成非法值丢掉，单独收一下。
  // pack 记的是「这份取景是为哪个模型调的」：换模型后标记对不上就作废，
  // 否则新模型会被上一个模型框住（半身框套全身模型，人缩成一小点）。
  try {
    const vb = raw.viewBox;
    if (vb && typeof vb === "object") {
      const h = clamp(vb.h, 0.04, 1);
      if (h !== null) {
        out.viewBox = {
          h: Math.round(h * 10000) / 10000,
          y: Math.round((clamp(vb.y, -0.3, 1) ?? 0) * 10000) / 10000,
        };
        if (typeof vb.pack === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(vb.pack)) {
          out.viewBox.pack = vb.pack;
        }
      }
    }
  } catch (e) { }

  for (const key of Object.keys(DEFAULTS)) {
    // viewBox 在上面已经单独校验过了。这里必须跳过：否则通用分支会把
    // raw.viewBox 原样写回去，夹取与四舍五入全白费——手改配置写个 h:9
    // 就能让取景框缩成一个点，人直接看不见（实测过）。
    if (key === "viewBox") continue;
    if (!(key in raw)) continue;
    const val = raw[key];

    if (key === "x" || key === "y") {
      // null 是合法值，意思是「没记过绝对坐标，位置交给右下角锚点算」。
      // 早年这里直接 Number(null) → 0，于是默认值过一遍 sanitize 就变成
      // 「在屏幕左上角」，而且第二次洗出来的结果与第一次不同（不幂等）。
      if (val === null || val === undefined) { out[key] = null; continue; }
      const n = Number(val);
      out[key] = Number.isFinite(n) ? Math.round(n) : null;
      continue;
    }
    if (BOOLS.includes(key)) {
      if (typeof val === "boolean") out[key] = val;
      continue;
    }
    if (RANGES[key]) {
      const n = clamp(val, RANGES[key][0], RANGES[key][1]);
      if (n !== null) out[key] = n;
      continue;
    }
    out[key] = val;
  }
  out.resolution = Math.round(clamp(out.resolution, 1, 3) ?? DEFAULTS.resolution);
  // 贴图精度：只认 0（自动）和 1024~4096 之间的整数。别的值一律当自动，
  // 免得一个手填的 99999 把五张图按超大尺寸怼进显存。
  {
    const raw2 = Math.round(Number(out.texMax));
    if (!Number.isFinite(raw2) || raw2 <= 0) out.texMax = 0;
    else out.texMax = Math.min(4096, Math.max(1024, raw2));
  }
  // 模型包 id 只允许小写字母数字下划线中划线：它会拼进文件路径和 URL，
  // 放开就等于允许 ../ 这种穿越。
  out.activePack = typeof out.activePack === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(out.activePack)
    ? out.activePack : "";
  out.lastUpdateNotice = typeof out.lastUpdateNotice === "string" && /^[0-9A-Za-z.+-]{1,32}$/.test(out.lastUpdateNotice)
    ? out.lastUpdateNotice : "";
  out.lastUpdateCheckAt = Math.max(0, Math.round(Number(out.lastUpdateCheckAt) || 0));
  if (out.voiceOut !== "tts" && out.voiceOut !== "rvc" && out.voiceOut !== "xtts" && out.voiceOut !== "feiyu") out.voiceOut = DEFAULTS.voiceOut;
  // XTTS 语速：别让用户把声音拉成花栗鼠：0.6 ~ 1.5 之外没有实用价值。
  out.xttsSpeed = clamp(out.xttsSpeed, 0.6, 1.5) ?? 1;
  if (out.feiyuStyle !== "cute" && out.feiyuStyle !== "gentle") out.feiyuStyle = "cute";
  // 0 表示「不干预，用模型自己的语速」；一旦写了正数就限制在 0.5 ~ 1.5。
  // 不然 0.2 这种也能存进去，出来就是慢到听不清的怪声（提示文案也是这么写的）
  out.feiyuSpeed = clamp(out.feiyuSpeed, 0, 1.5) ?? 0;
  if (out.feiyuSpeed > 0 && out.feiyuSpeed < 0.5) out.feiyuSpeed = 0.5;
  out.feiyuRef = typeof out.feiyuRef === "string" ? out.feiyuRef.slice(0, 120) : "";
  // 参考音频文件夹：空 = 用包内默认；填了就得是个像路径的字符串
  out.feiyuRefDir = typeof out.feiyuRefDir === "string" ? out.feiyuRefDir.slice(0, 400).trim() : "";
  if (out.feiyuRefDir && !/[\\/]/.test(out.feiyuRefDir)) out.feiyuRefDir = "";
  // 飞鱼环境根目录：同样「空 = 自动找」，填了必须像路径（不然拼出来的全是错路径）
  out.feiyuHome = typeof out.feiyuHome === "string" ? out.feiyuHome.slice(0, 400).trim() : "";
  // 快捷键：只接受 Accelerator 允许的字符，限制长度；空串代表禁用。
  // 注意 undefined 和 "" 是两回事：老配置里没有这两个字段时要补默认键，
  // 用户主动清空才是不注册（之前一律返回 "" 会把默认唤出键悄悄吃掉）。
  const acc = (v, def) => {
    if (v === undefined || v === null) return def;
    const t = typeof v === "string" ? v.trim().slice(0, 80) : "";
    if (!t) return "";
    return /^[A-Za-z0-9+_\-\s]+$/.test(t) ? t : def;
  };
  out.hotkeyMic = acc(raw.hotkeyMic, DEFAULTS.hotkeyMic);
  out.hotkeySummon = acc(raw.hotkeySummon, DEFAULTS.hotkeySummon);
  out.hotkeyMute = acc(raw.hotkeyMute, DEFAULTS.hotkeyMute);
  // 看屏幕的模型配置：只做长度和协议校验，留空表示「沿用回复模型」。
  const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  out.seeBase = str(raw.seeBase, 400);
  if (out.seeBase && !/^https?:\/\//i.test(out.seeBase)) out.seeBase = "";
  out.seeKey = str(raw.seeKey, 400);
  out.seeModel = str(raw.seeModel, 120);
  // 桥接地址和自定义 API 地址都会直接交给 fetch：只认 http(s)，
  // 免得手改配置塞进 javascript:/file: 这类 URL 后，界面点「测试连接」行为不可预期。
  out.bridgeUrl = str(raw.bridgeUrl, 400) || DEFAULTS.bridgeUrl;
  if (!/^https?:\/\//i.test(out.bridgeUrl)) out.bridgeUrl = DEFAULTS.bridgeUrl;
  out.apiBase = str(raw.apiBase, 400);
  if (out.apiBase && !/^https?:\/\//i.test(out.apiBase)) out.apiBase = "";
  out.seeInterval = clamp(out.seeInterval, 0.8, 6) ?? DEFAULTS.seeInterval;
  out.seeGap = clamp(out.seeGap, 3, 60) ?? DEFAULTS.seeGap;
  if (out.feiyuHome && !/[\\/]/.test(out.feiyuHome)) out.feiyuHome = "";
  if (out.rvcBackend !== "onnx" && out.rvcBackend !== "pth") out.rvcBackend = DEFAULTS.rvcBackend;
  // 引擎和设备要配套：配置文件里 device 可能还是 cuda:0，而 onnx 走 DirectML。
  // onnxruntime 只有 dml / cpu，不认识 cuda:0（除非装了 GPU 版），留着它会启动失败。
  if (out.rvcBackend === "onnx" && /^cuda/i.test(String(out.rvcDevice || ""))) out.rvcDevice = "dml";
  if (out.rvcBackend === "pth" && /^dml$/i.test(String(out.rvcDevice || ""))) out.rvcDevice = "cuda:0";
  out.rvcPitch = Math.round(clamp(out.rvcPitch, -12, 12) ?? 0);

  // 自带的迷你桥接（8898）从发行版里撤掉之后，桥接地址只剩外部的 phone-bridge（8899）。
  // 老默认值还留在配置里的话，每次启动都会往一个不相干的端口打健康探测。
  if (out.bridgeUrl === "http://127.0.0.1:8898" || out.bridgeUrl === "http://127.0.0.1:8898/") {
    out.bridgeUrl = "http://127.0.0.1:8899";
  }

  // 字符串字段兜底：手改配置写成数字/对象时，path.join、字符串比较都可能直接抛。
  // 这里不猜用户想表达什么，类型不对就回默认值。
  for (const k of Object.keys(DEFAULTS)) {
    if (typeof DEFAULTS[k] === "string" && typeof out[k] !== "string") out[k] = DEFAULTS[k];
  }

  return out;
}

// 配置迁移：老版本留下的值修成现在能用的。返回 true 表示真改过，调用方负责落盘。
// v2：桥接地址默认值 8898 → 8899（自带迷你桥接已撤，只剩外部 phone-bridge）。
function migrate(d) {
  let changed = false;
  const v = Number(d && d.version) || 0;
  if (v < 2) {
    if (d.bridgeUrl === "http://127.0.0.1:8898" || d.bridgeUrl === "http://127.0.0.1:8898/") {
      d.bridgeUrl = "http://127.0.0.1:8899";
    }
    d.version = 2;
    changed = true;
  }
  return changed;
}

class Settings {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, "settings.json");
    this.data = { ...DEFAULTS };
    // 上一次 load 时发现文件坏了的话，记在这里：{ backup, error }。
    // main.js 拿它写日志、并提醒用户「设置被重置过」，不要静默吞掉。
    this.lastLoadError = null;
    // 上一次 save 失败的原因（磁盘满、权限、路径被占）。null = 最近一次写盘是成功的。
    this.lastSaveError = null;
    this.load();
  }

  load() {
    let migrated = false;
    try {
      const raw = fs.readFileSync(this.file, "utf8");
      this.data = sanitize(JSON.parse(raw));
      this.lastLoadError = null;
      migrated = migrate(this.data);
    } catch (e) {
      const missing = e && e.code === "ENOENT";
      this.data = { ...DEFAULTS };
      if (!missing) {
        // 文件在、但读不动或不是合法 JSON：先把坏文件另存一份，再用默认值启动。
        // 直接覆盖会把 API Key、音色路径、快捷键一起抹掉，事后连「原来是什么」都查不到。
        try {
          const bad = this.file + ".bad-" + Date.now();
          fs.copyFileSync(this.file, bad);
          this.lastLoadError = { backup: bad, error: String((e && e.message) || e) };
        } catch (x) {
          this.lastLoadError = { backup: "", error: String((e && e.message) || e) };
        }
      }
      this.save();
    }
    // 迁移过就立刻落盘：不然每次启动都要重算一遍，而且界面上看到的还是旧值。
    if (migrated) this.save();
    return this.data;
  }

  save() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = this.file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf8");
      fs.renameSync(tmp, this.file);
      this.lastSaveError = null;
      return { ok: true };
    } catch (e) {
      // 主进程没有控制台，console.error 等于没写。
      // 记下来让 main.js 写进 run.log，并让设置页能显示「这次改动没存上」。
      this.lastSaveError = String((e && e.message) || e);
      console.error("[settings] 写盘失败:", this.lastSaveError);
      return { ok: false, error: this.lastSaveError };
    }
  }

  get(key) {
    return key === undefined ? { ...this.data } : this.data[key];
  }

  // 只接受白名单字段，返回真正生效后的完整配置。
  patch(partial) {
    if (!partial || typeof partial !== "object") return this.get();
    // 写之前先重读一次盘上的。不这么做的话，内存里那份旧值会把
    // 别处（另一个窗口、手工改文件、另一个实例）写进去的改动整份盖掉。
    // 只 merge「自己这次真正改的那几个字段」，其余以盘为准。
    let onDisk = null;
    try {
      onDisk = sanitize(JSON.parse(fs.readFileSync(this.file, "utf8")));
    } catch (e) {
      onDisk = null;   // 文件不存在或坏了，就当没有，按内存走
    }
    this.data = sanitize({ ...(onDisk || this.data), ...partial });
    this.save();
    return this.get();
  }

  reset() {
    this.data = { ...DEFAULTS };
    this.save();
    return this.get();
  }
}

// sanitize / migrate 也导出来：它们是纯函数，settings 的每一条校验规则都靠它们兜底，
// 值得被 scripts/test-settings-schema.js 直接喂边界值验一遍，而不是造一堆坏配置文件去启动。
module.exports = { Settings, DEFAULTS, sanitize, migrate };
