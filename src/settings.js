// 配置层：扢…有可变状态集中在这里，落盘到 userData/settings.json
// 设计原则…?
//   1) 只认白名单字段，外部传什么都不污染内部结…?
//   2) 每个字段都有类型与范围校验，坏了就回默认值，不让它把窗口搞没
//   3) 写盘用…临时文…?+ rename」，断电也不会留半个…?JSON

const fs = require("fs");
const path = require("path");

const DEFAULTS = {
  // 窗口尺寸不存这里：基准尺寸是 main.js…?BASE_W / BASE_H 常量…?
  // 用户能改的只…?scale。早先留…?width/height 两项，从来没被读过，已删…?
  // 位置存…离扢…在屏幕右下角多远」，不存绝对坐标…?
  // 这样缩放窗口、换屏幕、改分辨率，右下角都天然钉住…?
  anchorMode: "corner", // "corner" = 跟随右下角；"free" = 记住绝对坐标
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
  // 底部输入条：鼠标不靠近时自动隐藏（关掉则丢…直显示）
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
  // 说话的声音…空…?= 用引擎自己的默认（晓萱）…?
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
  // 默认本机 phone-bridge。换设备时在这里填对方那台的地址…?
  // 8898 是自带迷你桥接（_app/bridge/mini-bridge.mjs）的端口…?
  // 8899 是另丢…个独立程…?phone-bridge 的，写在这儿会连错人 …?
  //…?voice.js 自己还有…?BASE 默认值，两处必须丢…致，改一处等于没改…?
  bridgeUrl: "http://127.0.0.1:8898",
  // 回复走哪个模型："dsh" = 走桥接（能看到工具…能改文件）…?
  // "api" = 走自己填…?OpenAI 兼容接口（不依赖 DSH，换电脑也能用）…?
  replyMode: "dsh",
  apiBase: "",
  apiKey: "",
  apiModel: "",
  // 语音输出走哪条：「tts…? 内置 Edge TTS（快）；
  // 「rvc…? TTS 之后再跑丢…?RVC 换成别的音色（慢，…且要自己装 Python 环境）；
  // 「xtts…? 直接从参考音频克隆音色（RTX 4060 上约 1…?句，首次启用要等…?60 秒加载模型）…?
  // 「飞鱼」是默认：中文不卷舌、每句 1～2 秒，参考音频决定音色。
  // 其余三档：「tts」最快最稳（Edge 晓萱）；「rvc」先 TTS 再换嗓子（慢，要装 Python）；
  // 「xtts」直接从参考音频克隆（RTX 4060 上约 1 秒一句，首次启用要等 60 秒加载模型）。
  voiceOut: "feiyu",
  rvcPython: "",
  rvcModel: "models/warma/Warma-03.onnx",
  rvcDevice: "dml",
  rvcBackend: "onnx",
  rvcPitch: 0,
  rvcAutoStop: true,
  // XTTS：参考音频留空就用内置那段晓萱（assets/voice/ref-晓萱.mp3…?
  xttsRef: "",
  xttsSpeed: 1,
  // 飞鱼（CosyVoice3）：两个预训声线，speed 0 = 用模型自带的默认语…?
  feiyuStyle: "cute",
  feiyuSpeed: 0,
  // 参…音频：留空 = 按每句话的情绪自动挑（推荐）；填文件名或标签就固定用…?
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
  // 版本（将来迁移用…?
  version: 1,
};

const RANGES = {
  scale: [0.5, 2],
  opacity: [0.3, 1],
  resolution: [1, 3],
  offsetRight: [-2000, 4000],
  offsetBottom: [-2000, 4000],
  // RVC 变调：正数升调，负数降调。…?2 丢…个八度，超出就没法听了…?
  rvcPitch: [-12, 12],
  seeInterval: [0.8, 6],
  seeGap: [3, 60],
};

const BOOLS = [
    "rvcAutoStop", "alwaysOnTop", "clickThrough", "followCursor", "autoIdle", "blinkEnabled", "sharpen", "launchAtLogin", "dockAutoHide", "seeSpeak"];

function clamp(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(hi, Math.max(lo, n));
}

// 把任意对象洗成合法配…?
function sanitize(raw) {
  const out = { ...DEFAULTS };
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
    if (!(key in raw)) continue;
    const val = raw[key];

    if (key === "x" || key === "y") {
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
  // 模型包 id 只允许小写字母数字下划线中划线：它会拼进文件路径和 URL，
  // 放开就等于允许 ../ 这种穿越。
  out.activePack = typeof out.activePack === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(out.activePack)
    ? out.activePack : "";
  if (out.voiceOut !== "tts" && out.voiceOut !== "rvc" && out.voiceOut !== "xtts" && out.voiceOut !== "feiyu") out.voiceOut = DEFAULTS.voiceOut;
  // XTTS 语…别让用户把声音拉成花栗鼠：0.6…?.5 之外没有实用价…?
  out.xttsSpeed = clamp(out.xttsSpeed, 0.6, 1.5) ?? 1;
  if (out.feiyuStyle !== "cute" && out.feiyuStyle !== "gentle") out.feiyuStyle = "cute";
  // 0 表示「不干预，用模型自己的语速…；丢…旦写了正数就限制…?0.5…?.5…?
  // 不然 0.2 这种也能存进去，出来是慢到听不清的…物（提示文案也是这么写的）
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
  // 看屏幕的模型配置：只做长度和协议校验，留空表示「沿用回复模型」。
  const str = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  out.seeBase = str(raw.seeBase, 400);
  if (out.seeBase && !/^https?:\/\//i.test(out.seeBase)) out.seeBase = "";
  out.seeKey = str(raw.seeKey, 400);
  out.seeModel = str(raw.seeModel, 120);
  out.seeInterval = clamp(out.seeInterval, 0.8, 6) ?? DEFAULTS.seeInterval;
  out.seeGap = clamp(out.seeGap, 3, 60) ?? DEFAULTS.seeGap;
  if (out.feiyuHome && !/[\\/]/.test(out.feiyuHome)) out.feiyuHome = "";
  if (out.rvcBackend !== "onnx" && out.rvcBackend !== "pth") out.rvcBackend = DEFAULTS.rvcBackend;
  // 引擎和设备要配套：…配置文件里 device 可能还是 cuda:0，…?onnx…?DirectML…?
  // onnxruntime…?dml / cpu，不认识 cuda:0（除非装…?GPU 版），留睢…会启动失败…?
  if (out.rvcBackend === "onnx" && /^cuda/i.test(String(out.rvcDevice || ""))) out.rvcDevice = "dml";
  if (out.rvcBackend === "pth" && /^dml$/i.test(String(out.rvcDevice || ""))) out.rvcDevice = "cuda:0";
  out.rvcPitch = Math.round(clamp(out.rvcPitch, -12, 12) ?? 0);

  return out;
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
    try {
      const raw = fs.readFileSync(this.file, "utf8");
      this.data = sanitize(JSON.parse(raw));
      this.lastLoadError = null;
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

  // 只接受白名单字段，返回真正生效后的完整配…?
  patch(partial) {
    if (!partial || typeof partial !== "object") return this.get();
    // 写之前先重读丢…次盘上的。不这么做的话，内存里那份旧值会…?
    // 别处（另丢…个窗口…手工改文件、另丢…个实例）写进去的改动整份盖掉…?
    //…?merge「自己这次真正改的那几个字段」，其余以盘为准…?
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

module.exports = { Settings, DEFAULTS };
