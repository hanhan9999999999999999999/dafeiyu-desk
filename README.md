# 大肥鱼 · 桌面宠物

一只住在屏幕右下角的 Live2D 大肥鱼。独立程序，不是插件，不依赖 DSH 也能跑。

```
dafeiyu-desk/
├── src/            主进程 / 渲染 / 设置界面
├── assets/         图标（ico 七尺寸 + 托盘 32px）
├── engine/         语音、TTS、ASR 引擎
├── bridge/         本地桥接服务
├── vendor/         Live2D 渲染引擎 + Cubism Core
├── scripts/        verify / 冒烟 / CPU 采样脚本
└── docs/           设计与踩坑记录
```

> 现役的四个验证入口是 `npm run verify`（src / packs / pack / server 四组断言），脚本在 `scripts/`。

---

## 怎么启动

开发态：`npm install`，再 `npx electron@35.7.5 .`。`npm start` 走随包 `runtime/electron.exe`，仅开发机/发行包内置该运行时。
发行版：从 [Releases](https://github.com/hanhan9999999999999999999/dafeiyu-desk/releases) 下载 **`dafeiyu-desk-setup-1.3.0.exe`**（约 900 MB；静默安装 `安装包.exe /S /D=<目标目录>`）。

> 1.1.0 起安装包**不含任何模型文件**：模型版权在原画师手上，不允许随程序分发。
> 第一次打开会看到「先给她找一个身体」，把你自己的 Live2D 模型（zip 或解压后的文件夹）导进去即可。

托盘里有「显示/隐藏」「喂她一口」「摸摸头」「静音」「暂停动效」「看屏幕」「相处档案」「对话记录」「设置」「退出」。

---

## 操作

| 动作 | 结果 |
|---|---|
| 按住拖动 | 移动窗口（跨屏也准，位移在主进程算） |
| 单击 | 摸她，按位置分三档（头 / 脸 / 身体），会说不同的话 |
| 连点 | 力度递增，最多四层，会说「够了够了」 |
| 右键 | 打开设置面板 |
| 鼠标移动 | 头和眼睛跟着你（以**她**为中心算角度，不是以屏幕中心） |
| 停手 90 秒 | 她自己走神，看向一边 |
| DSH 在干活 | 她跟着进入思考状态（扫 session 文件写入时间） |
| 手机端在忙 | 同上（读 8899 端口） |

---

## 设置中心（1.0.0 重做）

右键打开。窗口 900×660、可拉伸；左边七个页签，改完**立刻生效**，不用重启。

| 页签 | 放什么 |
|---|---|
| 概览 | 当前模型（参数 / 动作 / 表情数量）、说话声线、回复来源、版本与热键；换模型 / 调取景 / 数据目录 / 日志 / 诊断包五个入口（没有模型时显示「还没安装模型 · 点模型适配器导入」） |
| 外观 | 大小、不透明度、清晰度、锐化、取景（跳到适配器的取景步骤）、模型适配器 |
| 声音与行为 | 三组：听与说（麦克风 / 声线 / 输出引擎）、变声引擎（RVC / XTTS / 飞鱼）、窗口与交互（置顶 / 穿透 / 跟随 / 眨眼 / 自启…） |
| 快捷键 | 说话、唤出输入条；伸懒腰固定 Ctrl+Alt+S |
| 看屏幕 | 视觉接口（留空走本机 DSH）、看眼间隔、点评间隔、念出来 |
| 连接与模型 | DSH 桥接地址 / 连通性 / 本机自带桥接，回复来源（DSH 或自定义 API） |
| 关于 | 版本、许可、隐私、数据目录、运行日志、诊断包 |

原来的设置项一个没删，只是换了位置：外观四项在外观页，行为开关在「声音与行为 → 窗口与交互」，语音配置在「听与说 / 变声引擎」。旧配置文件不需要迁移。

配置存在 `%APPDATA%\dafeiyu-desk\settings.json`（原子写盘，不会写坏）。

---

## 模型导入、素材库与手感（1.0.0 / 1.1.0）

### 导入

- **没有模型时**：主窗口本身就是一张导入卡（「导入压缩包（.zip）」/「选择解压后的文件夹」）；适配器模型库为空时也有同样的入口。
- 已有模型时：适配器左下「导入文件夹」或「导入压缩包」；也可以把 zip 直接拖进适配器窗口（整窗虚线高亮）。
- 窗口尺寸会跟着状态走：没有模型时收成 356×512（不让一块透明大窗挡住桌面），导入成功自动长回缩放后的正常尺寸。
- 解包是自己实现的（`src/packs/zip.js`）：存储 / deflate、GBK 中文文件名、路径穿越与压缩炸弹防护，不依赖 7-Zip。
- 导入会整目录复制到用户目录（`%APPDATA%\dafeiyu-desk\models\<id>`），不动源文件夹；工程文件（psd / cmo3 / blend）和 previews 缓存自动跳过。

### 取景（1.1.0 起在适配器里调）

独立的取景窗已经退役——取景是模型配置的一部分，和参数、动作放在一起才不会漂。

- 适配器中间预览的左上角是一条工具条：实时读数（「看 72% 高度 · 顶 10%」）、「主窗口视图」、「推荐取景」。
- 拖框上下移动（框内拖动）、拖框边改高度、滚轮以指针为中心缩放；右边第 4 步的滑杆与框实时同步。
- 「主窗口视图」按主窗口宽高比切一个竖口、两侧压暗，看到的就是桌面上露出来的那一段。
- 「推荐取景」按模型参数自动给一版：有腿 / 膝 / 足参数 → 全身（顶 2%、高 96%），否则半身。
- 结果存进模型包的 `pet.json`（`layout.viewY / viewH`）。旧版存在全局设置里的 `viewBox`，在第一次打开该模型时会自动搬进模型配置并清空。

### 未声明的动作 / 表情

很多模型的 `model3.json` 只声明 Moc / Textures / Physics，`motions/` 与 `expressions/` 里的文件一个都没写。导入时会递归扫一遍包内目录，把没声明的一并收进素材库并标「未声明」，体检里会写明数量。

### 素材库

适配器右栏底部：列出全部动作（组 / 序号 / 时长 / 是否声明）与表情。逐条试播、设为默认表情；顶部绑定栏可以把任意一支动作绑到 27 个语义槽之一（等价于在「动作映射」里选「动作文件 · …」）。

### 手感（第 7 步，16 项）

| 组 | 项 |
|---|---|
| 头部 | 左右转头上限、上下点头上限、歪头上限、中心死区 |
| 全身 | 身体 X / Y / Z 跟随增益、身体滞后 |
| 眼睛 | 眼珠跟随增益、眼珠最大偏移 |
| 物理与渲染 | 物理步长（16 / 33 / 50 ms / 关）、裁剪遮罩精度（256–2048）、过渡时长倍率 |
| 动作 | 播放速度、参数锁、待机也锁 |

这些值存在模型包的 `pet.json` 里（`live2d.tuning`），换模型各自独立，默认值按 0.2.0 的实际手感反推（26° / 30° / 14° / 0.07）。

**参数锁**：播模型动作或动作文件时，这支动作驱动的参数会被锁住，追踪层不再每帧覆盖；锁有 TTL 兜底，待机动作默认不锁。

### 动作文件引擎

语义槽的动作来源现在是三种：内置曲线 / 模型自带动作（组 + 序号）/ 指定动作文件（`file:<包内相对路径>`）。指定文件不依赖「同组第几个」这种索引，模型作者怎么改文件名都不影响。动作文件由 `src/motion3.js` 解析（Linear / Bezier / Stepped / InverseStepped，只取 Target 为 Parameter 的曲线）。

---

## 踩过的坑（改代码前务必读）

### 1. `ELECTRON_RUN_AS_NODE` 必须清掉

这台机器上这个环境变量是开着的，导致 `require("electron")` 报 `Cannot find module 'electron'`。启动器里已经处理：

```bat
set "ELECTRON_RUN_AS_NODE="
```

### 2. 不能走 `file://`

`file://` 下 `fetch` 被同源策略挡死，模型贴图加载不了。主进程起了一个**只服务 `_app` 目录**的本地 http 服务器（随机端口、防目录穿越、`no-store`）。

### 3. CSP 必须开三道口子

```html
script-src ... 'unsafe-eval'   <!-- vendor 用 new Function -->
worker-src blob: 'self'        <!-- pixi 的 worker 从 blob 建 -->
connect-src ... data: blob:    <!-- 贴图解码 -->
```

少一条就是白屏。

### 4. 模型路径必须用绝对路径

```js
const MODEL_URL = "/model/dafeiyu.model3.json";   // ✅
// const MODEL_URL = "../model/..."                // ❌ 会以页面 URL 为基准，
                                                    //    moc3 被解析成 /src/model/...  → 404
```

### 5. 贴图必须自己换，不能信引擎

引擎的 `WorkerManager` 会把 4096 的贴图**压到 1024**（在 `dsh-app://` 之类的自定义协议下尤其明显）。做法是主线程 `fetch` → `createImageBitmap` → 直接替换 `baseTexture.source`：

```js
src.resource = bmp;
src.autoGenerateMipmaps = false;
src.mipLevelCount = 1;
src.style.minFilter = "linear";
src.style.magFilter = "linear";
src.style.mipmapFilter = "none";
```

**不要开 mipmap**：一开，缩小采样就跳到低分辨率层，整体发糊。

### 6. canvas 的 CSS 尺寸必须每次夺回来

`app.renderer.resize()` 会把 `canvas.style.width` 从 `100%` 改写成 `460px`。容器一变，画布被拉伸 → **「某个部位撑满整个容器」**。

```js
app.canvas.style.width = "100%";      // ① 先夺
const cw = host.clientWidth;          // ② 只量父容器
app.renderer.resize(cw, ch);          // ③ 改物理像素
app.canvas.style.width = "100%";      // ④ 再夺（resize 又改了）
```

**量尺寸只认 canvas 的父容器**，不要用 `document.documentElement.clientWidth`——中间隔着 html/body，窗口动画中间态会读到旧值。

### 7. `resolution` 只有一个来源

启动时读设置里的 `resolution`，运行中以 `settings-changed` 为准。**不要两处各写一个默认值**，会互相覆盖。

### 8. 连续改尺寸必须节流，而且位置要按「真实尺寸」算

拖滑块一秒钟能发几十次 `setSize`，Windows 跟不上，会丢帧。两个后果：

- **窗口顶出屏幕**：如果位置用「我以为的尺寸」算，而窗口还是旧尺寸，就会顶出去。
  必须 `win.getBounds()` 拿真实尺寸再算位置。
- **最后一步没落地**：节流里若用「标记 pending 再补发」，很容易写成
  `doResize()` 开头就把 pending 清零，补发永远不会触发。

正解是 **trailing debounce**：

```js
function scheduleResize() {
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(doResize, 90);   // 停手 90ms 后一定执行一次
}
```

### 9. `node --check` 查不出运行期错误

它只查语法。下面三类只能靠运行时埋点：

- TDZ（用了声明在后面的变量）→ 整个渲染循环挂掉，画面卡在最后一帧
- 未定义变量 → 一点就炸
- 监听器没摘干净 → 热重载后多个实例同时改状态，表现为抖动

`layout()` 里留了一行 `[fish] layout ...` 日志，专治这类问题。

---

## 自动验证

```bash
cd _app\_test
python verify-resize.py      # 六档尺寸的取景一致性
python verify-framing.py     # 固定尺寸下的构图
python make-icons.py         # 重新生成图标
```

`verify-resize.py` 检查五件事，任一不满足就非零退出：

1. canvas CSS 是 `100%/100%`（被改写成 px 就会拉伸）
2. canvas 物理像素 = 容器 × resolution
3. `fit` 与容器高严格线性
4. 各档放大倍数一致（构图不变）
5. `resolution` 等于期望值

---

## 已知限制

- **只有 Windows**。Electron 本身跨平台，但窗口置顶/穿透/开机自启用的是 Windows API，换平台要重写 `main.js` 里那几段。
- **托盘图标不随 DPI 缩放**，高 DPI 下略糊。要修得给 `nativeImage` 按 scaleFactor 裁。
- **安装包不含模型**（1.1.0 起）。模型是第三方作品，需要你自己导入，见下方许可。

---

## 许可

模型：**大肥鱼**（DeepSeek 免费 Live2D 模型，本程序不再随包分发）
- 原画及拆分：**神宫凉子**
- Live2D 建模：**霓虹猫_NeonNeko**
- 允许个人使用、二次创作；**禁止二次销售与重新分发完整模型文件**

> 1.1.0 起采用「程序与模型分离发行」：安装包里没有 .moc3 / 贴图 / 动作 / 表情，
> 模型由用户自行导入到本机（%APPDATA%dafeiyu-deskmodels），程序不代为分发。
> 这样既尊重原作者的「禁止重新分发完整模型文件」，程序本身也可以正常商业发行。
> 用户导入的第三方模型，其授权由该模型作者决定，使用前请自行确认。

程序本体（`_app\src`）为自研代码。渲染引擎 `live2d-vendor.js` 与
`live2dcubismcore.min.js` 来自 Live2D 官方 SDK，遵循 Live2D 的专有许可，
**不可随程序再分发**，发行时需要单独处理。

---

## 十四、对话气泡、语言池、动作真实度、语音

### 14.1 气泡（`src/index.html` 的 `#bubble`）

原来是顶部一行、`white-space: nowrap`、超长直接省略号、2.4 秒就消失，看都看不清。
现在：

| 改动 | 原来的问题 |
|---|---|
| 多行自动换行 + `max-width: min(300px, 100vw - 24px)` | 单行截断，长句只剩前半截 |
| 停留时间 `1800 + 字数 × 95ms`，夹在 2.2–9 秒 | 固定 2.4 秒，长句来不及读 |
| 贴在头顶上方、尾巴朝下指着她 | 放底部会挡住衣服，尾巴也没意义 |
| 出现时缩放弹入（`cubic-bezier(.2,.9,.3,1.2)`） | 硬淡入，像系统通知 |
| 说话时 `bubble-talk` 轻微跳动 | 完全静止，不像在讲话 |

超过 56 个字会截断加省略号——气泡撑满整块屏幕反而什么都读不到。

### 14.2 语言池（`src/lines.js`）

台词是**数据不是代码**，改词不碰渲染逻辑。场景键：

- `pet.head` / `pet.face` / `pet.body` / `pet.more`（连点 3 次以上）
- `idle` / `longIdle`（两分钟没动静）
- `dsh.thinking` / `dsh.tool` / `dsh.done` / `dsh.failed`
- `drag.start` / `drag.end`
- `night`（0–5 点）/ `morning`（6–10 点）
- `voice.on` / `voice.off` / `voice.heard`

`pick(key)` 保证同一句不会连着抽到两次（重试上限 8 次）。
`timeKey()` 按钟点选场景。加场景只要加一个键，不用改任何逻辑。

### 14.3 动作真实度

**缓动时间常数分层**——这是「像活的」和「像机器人」的分界线：

| 通道 | tau | 为什么 |
|---|---|---|
| `blink` | 0.035s | 眼睑本来就快到看不清过程 |
| `gazeX` / `gazeY` | 0.09s | 真人看到东西是一瞬间扫过去的 |
| `yaw` / `pitch` / `roll` | 0.22s（点头时 0.07） | 头是「跟着转」的，永远慢眼睛半拍 |
| `body` | 0.55s | 重心转移，几乎察觉不到 |

**打哈欠 `yawn`**：只在深夜（23–5 点）或 4 分钟没动静时才进池子，概率 45%。
头仰起 `pitch +5.5`、眼眯成缝 `squint 0.72`、嘴张开 `0.85`，2.1 秒用正弦包络进出。
白天动不动打哈欠看着像没睡醒，所以加了时段门槛。

### 14.4 语音（`src/voice.js`）

一条完整往返：

```
麦克风 → VAD（音量>0.055 起录，静音 1.1s 收尾）
      → POST /api/asr-legacy  转文字
      → POST /api/send        发进 DSH 当前会话
      → GET  /api/state       轮询等回复（最长 90s）
      → 气泡显示 + POST /api/tts → 按 parts[] 逐段播放
```

**两个必踩的坑：**

1. `/api/asr` 已经下线（返回 410），**只有 `/api/asr-legacy` 能用**，
   音频格式走 `x-audio-ext: webm` 头。
2. phone-bridge 没做 CORS 预检（没有 OPTIONS 处理），所以 **发 JSON 必须用
   `content-type: text/plain`**，否则浏览器直接拦，服务端根本收不到。

**麦克风权限**：Electron 默认拒绝 `getUserMedia`，`main.js` 里必须放行：

```js
session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
  callback(permission === "media" || permission === "audioCapture");
});
```

不放行的话 `getUserMedia` 直接抛错，日志里只有一句「拿不到麦克风」。

**按钮**：右下角圆形 ◎，三态——灰蓝（关）/ 绿色（开）/ 黄色脉冲（处理中）。
深色按钮压在深蓝裙子上等于隐身，所以用了亮边框 + 外发光。

**播放**：`/api/tts` 返回的是 `parts[]`（长回复切多段），不是单个 `url`。
每段之间有 `gapAfter` 毫秒停顿要自己补——Edge TTS 不收 `<break>` 标签。

**第三个坑（只有真跑一次才发现）**：CSP 里没写 `media-src`，音频会被
`default-src` 兜住直接拦掉，报错是 `Failed to load because no supported source
was found`。**这个错误看起来像"音频格式不支持"，实际上是策略拦截。**
CSP 必须显式放行：

```
media-src 'self' blob: data: http://127.0.0.1:*;
```

**第五个坑（最隐蔽）**：`x-audio-ext` 是**自定义请求头**，只要带上它，
浏览器就会先发一次 CORS 预检（OPTIONS）。而 phone-bridge 原来**完全没处理
OPTIONS**，预检直接失败，`fetch` 抛出一个没有任何细节的 `Failed to fetch`。
把 `content-type` 换成 `text/plain` 只消除了一个触发条件，自定义头还在，
所以还是会失败。

正确的修法是让服务端回应预检（`server.mjs` 顶部统一处理）：

```js
if (req.method === 'OPTIONS') {
  res.writeHead(204, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, x-audio-ext, x-phone-token, x-file-name, accept',
    'access-control-max-age': '86400',
  });
  return res.end();
}
```

改完要重启 phone-bridge（`POST /api/restart?t=<token>`，会断手机约 3 秒）。

**第四个坑（自己挖的）**：`playAudio` 原来只在失败时打日志，成功时什么都不留。
结果是"看日志判断不出到底播了没有"。补上 `oncanplay / onplaying / onended`
三个时间点之后，日志才变成可信证据：

```
音频就绪 dur=7.9s → 开始播放 → play() 已受理 → 播放结束
```

**这条经验通用**：凡是"成功时静默"的函数，等于没有可观测性。

### 14.5 验证语音链路的办法（不需要麦克风）

`FISH_TEST_VOICE=<一句话>` 是主进程的测试通道：启动 8 秒后把这句话直接塞进
`FishVoice.__testSay()`，跳过麦克风和 ASR，只验证后半段
「发送 → DSH 回复 → TTS 播放」。用来在没有麦克风、或者半夜没人说话时自检。

```powershell
$env:ELECTRON_RUN_AS_NODE = $null
$env:FISH_TEST_VOICE = "你好 证明一下链路是通的"
Start-Process -FilePath "...\_app\runtime\electron.exe" -ArgumentList "." -WorkingDirectory "...\_app"
```

对应日志（`%APPDATA%\dafeiyu-desk\run.log`）：

```
[test] voice say=...
[voice] 测试已发送: {"ok":true,"id":"..."}
[voice] 回复: 主人，我在这儿呢。要是这句传到你这儿了，声音就出来了。
[voice] 音频就绪 dur=7.9s
[voice] 开始播放
[voice] 播放结束
```

### 14.6 语音识别能力的真相

`phone-bridge` 用的是 **Windows 自带 `System.Speech`**（离线、免费、不联网），
不是 Whisper 一类的模型。实测中文准确率一般：

| 你说 | 它认成 |
|---|---|
| 大肥鱼你好 今天天气不错 | 83因为今天真是不错 |
| 帮我看看现在几点了 | （识别失败） |

本机没有安装 Whisper / faster-whisper，要换引擎得单独部署（模型几百 MB）。
在换引擎之前，**识别失败必须有明确提示**——静默失败等于"我说了但她不理我"。


---

## 十五、内存优化：1.86 GB → 596 MB

打包后第一版渲染进程稳定占用 **1.86 GB**。对商业软件这个数字偏大，但**没有降画质**就解决了。

### 病灶

`TEXHIJACK` 用 `createImageBitmap()` 拿到 4096~8192 的原图。问题在于：

**`ImageBitmap` 会一直持有解码后的像素，而且同时占 CPU 侧和 GPU 侧两份。**
五张图（4096×8192 ×2、4096×4096 ×2、8192×8192）光 RGBA 就是 640 MB，双份就是 1.28 GB，
再加上原来的缩水贴图没被释放，凑到 1.86 GB。

### 修法

换成 `HTMLImageElement`——浏览器把 `<img>` 上传成 GPU 纹理之后，
**CPU 侧的解码数据可以被回收**，这是 `createImageBitmap` 做不到的。

```js
const img = new Image();
img.decoding = "async";
await new Promise((res, rej) => {
  img.onload = () => res();
  img.onerror = () => rej(new Error("img load fail " + u));
  img.src = u;               // 同源，直接给路径
});

const src = tex.source || tex.baseTexture.source;

// 顺手把引擎早先加载的那张缩水图关掉，别让它一直挂着
const old = src.resource;
if (old && old !== img && typeof old.close === "function") {
  try { old.close(); } catch (e) { }
}

if (typeof src.resize === "function") src.resize(img.naturalWidth, img.naturalHeight);
src.resource = img;
src.autoGenerateMipmaps = false;
src.mipLevelCount = 1;
src.update();
```

### 实测

| 时间点 | 最大进程内存 |
|---|---|
| 6 秒 | 579 MB |
| 12 秒 | 594 MB |
| 20 秒 | 596 MB |
| 30 秒 | 596 MB |

**1.86 GB → 596 MB，降 3.1 倍，画面清晰度没有任何变化**（贴图仍是 4096/8192 原图，
`[fish] tex=4096x8192,4096x8192,4096x4096,8192x8192,4096x4096` 可验证）。

### 这条的教训

「内存大」不一定是贴图太大。**同一张图的两种持有方式，内存差一倍。**
ImageBitmap 是"我拿住了像素"，`<img>` 是"我拿住了一个可以随时重建的引用"。
需要真的逐像素处理时才用前者；只是喂给 GPU 的话，后者更省。

---

## 变更记录

| 日期 | 内容 |
|---|---|
| 2026-11-01 晚 | 独立程序跑通：透明置顶窗口、纹理解包、拖动、点击三档 |
| 2026-11-01 夜 | 设置面板（数字输入）、九处几何 bug、图标、健壮性兜底、12 项回归 |
| 2026-11-01 深夜 | 对话气泡重做、语言池、缓动分层、打哈欠、语音全链路 |

### 14.7 完整链路实测记录（2026-11-02 凌晨）

用 Chromium 的假麦克风把整条链跑通，不需要真人说话：

```powershell
# 1) 用 TTS 合成一句话，前后补静音，做成"假麦克风输入"
ffmpeg -y -i thatsaid.mp3 -ac 1 -ar 48000 \
       -af "adelay=600|600,apad=pad_dur=2.5" -f wav fake-mic.wav

# 2) 启动时把 wav 当麦克风
electron.exe . --use-fake-device-for-media-stream \
               --use-file-for-fake-audio-capture=D:\...\fake-mic.wav
```

日志（`%APPDATA%\dafeiyu-desk\run.log`）——**六段全部打通**：

```
[voice] 麦克风已开
[voice] 开始录音
[voice] 停止录音 3350ms            ← VAD 起止判断准确（wav 里说话就是 3.35s）
[voice] ASR 响应 200 (42014 字节已发)
[voice] 听到: 阿丁洛菁说这是那      ← 识别出来了（引擎弱，见 14.6）
[voice] 已发送: {"ok":true}
[voice] 回复: 主人，我在这儿呢。要是这句传到你这儿了，声音就出来了。
[voice] 音频就绪 dur=7.9s
[voice] 开始播放 → 播放结束
```

以及失败路径（同一轮里出现过一次）：

```
[voice] ASR 没结果: {"ok":false,"error":"没听清，再说一次？","ms":2817}
```

气泡会显示「没听清……再说一次？」——**失败不再静默**。

> 注意：TTS 合成的音频对 ASR 本来就不友好（没有呼吸、没有口音起伏），
> 真人说话通常比这个结果好。上面的识别错误不代表真人输入的实际水平。

## 十六、2026-11-02 凌晨：语音与缩放的两个根因

### 16.1 语音按钮点不动

`pointerdown` 无条件 `dragStart()`，点按钮时手抖超过 3px，主进程就 `setPosition`
移动窗口，按钮跟着窗口跑掉，`click` 落空。

修法：加 `isUiTarget()`，沿 `parentElement` 上溯判断目标是不是 `fish-voice` /
`bubble` / `fish-retry` / `err`，是 UI 就跳过拖动和「摸她」判定。

### 16.2 说话没反应（四层，逐层揭开）

1. **阈值拍脑袋**：`VAD_LEVEL = 0.055` 写死。真人说话 RMS 通常只有 0.02~0.08，
   加上降噪后更低。改成动态阈值：开麦后测 1.2 秒底噪，取 90 分位乘 2.2。

2. **设备选错**：系统默认是 `麦克风 (USBAudio1.0)`，ffmpeg 实测 RMS 只有 0.0008；
   另一路 `麦克风 (2- USB PnP Sound Device)` 是 0.0082，差 10 倍。
   加了麦克风下拉（存 `micDevice` 到设置）。

3. **deviceId 对不上**：本地服务器原来用 `listen(0)` 随机端口，每次启动 origin 都变，
   而 Chromium 的 `deviceId` 按 origin 隔离 —— 设置窗口选的 id 在主窗口认不出来。
   改成固定端口（7801 起，占用则顺延）。

4. **采样循环只跑一帧**（最要命的一条）：

   ```js
   function tick() {
     if (!enabled) return;
     const lv = level();
     if (calibrating) { calibSamples.push(lv); return; }   // ← 这里 return 掉了
     ...
     rafId = requestAnimationFrame(tick);                   // ← 排在函数末尾
   }
   ```

   校准期间 `return` 跳过了末尾的 `requestAnimationFrame`，循环直接死掉，
   之后 `calibrating` 变 false 也没人再调 `tick`。
   **读到的永远是第一帧的 0**，导致前三条修复全都「看起来无效」。

   修法：`requestAnimationFrame` 提到函数最前面，任何 return 都不会掐死循环。

### 16.3 缩放裁剪错位

`setBounds` 之后 Windows 会陆续触发多次 ResizeObserver，中间帧的容器尺寸与取景参数
不成比例，模型被摆歪一次。

修法：新增 `relayoutSoon()` —— 120ms 防抖 + 记住 `lastStableSize`，
**连续两次读到同一个尺寸才真算**，并在一帧后复验一次。

### 16.4 诊断手段备忘

- 直接量设备：`ffmpeg -f dshow -i "audio=<设备名>" -t 2 out.wav`，再算 RMS
- 最小页面探针 `_test/mic-probe.js`：只开麦 + analyser，不碰主程序，
  几秒就能区分「流没数据」和「analyser 没数据」
- 主窗口和设置窗口都要挂 `console-message`，设置窗口不挂等于盲调
- 写含反引号或 `$` 的文本进文件，**一律先落成 .py 文件再执行**，别塞进 `bash -c`

## 十七、长时间运行稳定性（2026-11-02 凌晨实测）

脚本 `_test/monitor-stability.py`，每 15 秒采一次进程内存，跑满 20 分钟。

```
进程数      4（主 / GPU / 网络 / 渲染，全程稳定）
内存        925 MB → 714 MB（-22.8%）
峰值        959 MB
日志         49 行，错误 0
```

**结论：没有泄漏特征。**

启动阶段 925 MB 是五张原图贴图的解码峰值，稳定后回落到 714 MB，
之后 20 分钟只在 712±5 MB 之间抖动，没有单调上升。

### 怎么复现

```bash
cd _app/_test
STAB_MIN=20 python monitor-stability.py
# 测打包版：
STAB_MODE=packed STAB_MIN=20 python monitor-stability.py
```

结果写到 `_test/stability.json`，含每次采样的原始数据。

### 判定规则

| 指标 | 含义 |
|---|---|
| 内存增长 < 8% | ✓ 无泄漏特征 |
| 8% ~ 20% | △ 需继续观察 |
| > 20% | ✗ 疑似泄漏 |
| 后 1/3 样本持续单调上升 | △ 可能是缓存累积（不一定是 bug） |
| 进程数掉到 4 以下 | ✗ 有进程崩了 |

### 20 分钟不够说明什么

这只是排除了「快速泄漏」。真要上架前建议跑 8 小时以上，
并且模拟真实使用（反复开关语音、频繁改大小、长时间挂机）。

## 十八、缩放裁剪的真根因：`model.width` 是反馈回路（2026-11-02 凌晨）

主人反复报「调整大小时模型错误裁剪、中心点不对」。前面几轮修的都是时序
（`setBounds` 延迟、ResizeObserver 连发、`relayoutSoon` 防抖），**那些都是次要的**。
真根因在取景公式本身。

### 病灶

```js
const sw = Math.max(1, model.width);   // ← 这里
const sh = Math.max(1, model.height);
const fit = Math.max(W / (sw * 0.62), H / (sh * 0.33));
model.scale.set(fit);
```

pixi v8 里 `model.width = Math.abs(scale.x) * 原始宽`。
它**跟着 `model.scale` 变**。而上面这段先读 `model.width` 算 `fit`，再把 `fit` 设回
`model.scale` —— 于是每重算一次，就把上一次的缩放再叠一次：

```
第 1 次  sw = 3749          → fit = 0.2205 → scale = 0.2205
第 2 次  sw = 3749×0.2205   → fit 变 4.5 倍 → scale 再被改写
第 3 次  ……                 → 越来越歪，而且永远不会自己回来
```

窗口越大、重算次数越多，偏得越离谱。表现就是「中心点不对、只看见一块」。

### 修法

第一次读到原始尺寸就记下来，之后一直用它，绝不再读 `model.width`：

```js
if (baseW <= 0 || baseH <= 0) {
  baseW = Math.max(1, model.internalModel?.originalWidth || 0);
  baseH = Math.max(1, model.internalModel?.originalHeight || 0);
  if (baseW <= 1 || baseH <= 1) {
    model.scale.set(1);            // 兜底：先归零再量
    baseW = Math.max(1, model.width);
    baseH = Math.max(1, model.height);
  }
  console.log("[fish] model original=" + baseW + "x" + baseH);
}
const sw = baseW, sh = baseH;
```

实测拿到 **3749×7697**。注意不是之前日志里的 3819×6793 —— 那是**含缩放后**的读数，
一直被当成了原始尺寸，这也是为什么早先的六档验证看起来「线性」却没解决问题：
验证脚本比对的是同一个错误基准。

### 验证（`FISH_TEST_SWEEP=0.8,1.7,0.9,1.5,1.0,1.9,1.2`）

```
368x448  → fit=0.1764
414x504  → fit=0.1984
460x560  → fit=0.2205
552x672  → fit=0.2646
690x840  → fit=0.3307
782x952  → fit=0.3748   （同一尺寸重算两次，值完全一致）
874x1064 → fit=0.4189
```

**完全线性**：`874/368 = 2.375`，`0.4189/0.1764 = 2.375`。
同一尺寸重算两次值相同 → 反馈回路断了。

### 怎么复现这个问题

```bash
FISH_TEST_SWEEP=0.8,1.7,0.9,1.5,1.0,1.9,1.2 ./runtime/electron.exe .
```

看 `run.log` 里每个尺寸是不是只打一条 layout、且 fit 与窗口尺寸成比例。
修复前每个尺寸都会打**两条**，第二条恒为 `fit=0.8000`（叠了缩放后的读数）。

## 十九、回归脚本必须先杀两个进程名（2026-11-02 凌晨）

`_test/verify-all.py` 第一次跑出 **7 个 FAIL**，症状是「日志空白、所有项都 None」。

不是程序坏了，是脚本的 `kill()` 只杀了 `electron.exe`：

```python
def kill():
    subprocess.run(["taskkill", "/F", "/IM", "electron.exe"], capture_output=True)
    subprocess.run(["taskkill", "/F", "/IM", "大肥鱼.exe"], capture_output=True)  # ← 少了这行就空白
    time.sleep(2.2)
```

**开发版叫 `electron.exe`，打包版叫 `大肥鱼.exe`，两者共用同一个 `userData`。**
只要有一个活着，另一个启动就抢不到单实例锁，建完窗口直接 `exit 0`——
日志一片空白，看起来像「功能全坏了」。

这是「单实例锁」第二次咬人（第一次是打包版验证时）。**排查顺序：看到日志空白 + 进程数不对，
先查单实例锁，别查崩溃。**

修完复测：**12 项全 PASS。**

```
[1] 冷启动（scale=1.0）
  PASS  贴图是原图      tex 有
  PASS  窗口 460x560    {'w': 460, 'h': 560, 'scale': 1.0, 'res': 2}
  PASS  layout 与窗口一致
  PASS  canvas = 容器 x resolution
[2] 运行时改尺寸 1.0 -> 1.45
  PASS  667x812
  PASS  右下角钉住 offsetR=30 offsetB=6
[3] 重启后配置保持
  PASS  上次尺寸 1.00 / 清晰度 2 / 锐化开关已压
[4] 配置文件的手动改动也生效
  PASS  配置文件为唯一来源
[5] 恢复默认
  PASS  回到 460x560
```

## 二十、语音的两个隐蔽 bug（2026-11-02 凌晨）

用假麦克风（`--use-file-for-fake-audio-capture`）跑全链路时暴露的两个问题，
真人用的时候也会撞上，但表现是「按钮开了却没反应」和「她自说自话」。

### 20.1 VAD 阈值没有上限

```
底噪 0.4582  阈值 1.0175
说话峰值 0.1930        ← 比阈值低 5 倍，永远过不了线
```

校准那 1.2 秒里如果正好有人在说话（或者你点开麦克风就立刻开口），
量出来的「底噪」其实是说话声，算出的阈值高到不可能触发。

**修法：阈值封顶。**

```js
const VAD_MIN = 0.012;
const VAD_MAX = 0.12;      // 上限：校准期有人在说话时兜底
const VAD_RATIO = 2.2;
vadThreshold = Math.min(VAD_MAX, Math.max(VAD_MIN, noise * VAD_RATIO));
```

### 20.2 她一边说话一边听自己

播放 44 秒的回复时，日志里同时还在「开始录音 → 停止录音」循环——
**她在把自己的声音录进去**，录进来又被送去识别，形成自我对话。

`echoCancellation` 挡不住扬声器外放（它只处理回声路径，不认「这是我自己的声音」），
得在 VAD 层面直接停：

```js
// 播放期间不收音
if (currentAudio !== null) {
  if (speaking) { speaking = false; }
  return;
}
```

修完后 `开始播放` 到 `播放结束` 之间一条录音都没有。

### 20.3 假麦克风怎么喂

```bash
./runtime/electron.exe .   --use-fake-device-for-media-stream   --use-file-for-fake-audio-capture=_test/fake-mic.wav
```

`fake-mic.wav` 是用 TTS 合成一句话再补前后静音做的。
**必须补静音**，否则 wav 循环播放时 VAD 永远等不到安静，会一直录。

---

## 二十一、聊满 120 条之后她就不回了（2026-11-02 深夜）

这是最隐蔽的一个 bug，因为它**只在用得够久之后才发作**。

### 21.1 症状

语音说完 → 已发送 → **没有任何回复，90 秒后弹「她还没回我……要不再说一次？」**。
打字发也一样。重启程序就恢复正常，用一阵子又复现。

### 21.2 真因

`waitReply()` 拿「消息条数」当基准：

```js
const before = await snapshotCount(t);   // 发送前
// ...
if (msgs.length <= before) continue;     // 没新消息就继续等
```

而 `/api/state` 只返回**最近 120 条**消息，是个滑动窗口。

聊满 120 条之后：发送前 `before = 120`，发送后 `msgs.length` **还是 120**（旧的被挤掉了）。
`msgs.length <= before` 永远成立 → 循环永远走不到「找 assistant」那一步 → 90 秒超时。

### 21.3 修法

基准从「条数」换成「最后一条消息的时间戳」：

```js
const last = ms[ms.length - 1];
return last ? Number(last.at) || 0 : 0;
```

查找也跟着改成时间戳卡边界——比基准还旧就 `break`，不再往前翻：

```js
for (let i = msgs.length - 1; i >= 0; i -= 1) {
  const m = msgs[i];
  if (!m || m.role !== "assistant") continue;
  if ((Number(m.at) || 0) <= since) break;   // 比基准还旧，停
  const txt = String(m.text || "").trim();
  if (!txt || txt === myText) continue;
  await speakAndShow(txt);
  return;
}
```

顺带把「旧回复当成新回复念出来」那个串台隐患也一起堵死了（同一处逻辑）。

### 21.4 另一个坑：字段名是 `text` 不是 `content`

`/api/state` 的消息结构是 `{turnId, role, id, text, at, completed, ...}`。
**没有 `content` 字段**——用 `m.content` 会拿到一片空，看起来像「消息全空」。

### 21.5 顺便修掉的三处

**① 录音空转**：`busy` 原来只挡了「发送」，没挡「录音」。等回复时环境一吵就反复起录停录（日志里一串 `开始录音 → 停止录音 2931ms`）。tick 里一并掐掉后，录音事件从十几条降到 2 条。

**② 气泡砍字数**：原来 `say()` 超过 56 字就 `slice`，但 TTS 念的是全文——**看得见的和听得见的对不上**。改成 CSS `max-height` 限高 + 可滚动。
（`-webkit-line-clamp` 那条路走不通：它依赖 `display:-webkit-box`，跟 `width:max-content` 打架，计算出来 display 会变成 `flow-root`，clamp 失效。）

**③ 按钮点了没反应**：`busy` 状态直接 `return`，主人以为按钮坏了。现在弹一句「正忙呢，等我这句说完」。同理，录音中按按钮 = 取消这段（气泡「这次先算了，还听着呢」），而不是把整个语音关掉。

### 21.6 所有网络请求都加了超时

```js
signal: AbortSignal.timeout(20000)   // /api/send
signal: AbortSignal.timeout(120000)  // ASR（要跑 whisper，慢是正常的）
signal: AbortSignal.timeout(10000)   // /api/state 轮询
signal: AbortSignal.timeout(8000)    // /api/health 取 token
signal: AbortSignal.timeout(60000)   // /engine/tts
```

理由：**没有超时的 fetch 会把 `busy` 永远卡在 `true`**。桥接那边一卡，之后按什么按钮都没反应，看着就像程序死了——而且不会报错，只会静默卡住。

---

## 二十二、开机自启在打包版里静默失效

**现象**：设置里勾上「开机自启」，注册表 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 也确实写进去了，但重启电脑后程序没起来。开发版（`runtime\electron.exe`）一切正常。

**真因**：注册表里写的是

```
cmd.exe /c "set ELECTRON_RUN_AS_NODE= && start "" "大肥鱼.exe" "C:\…\resources""
```

`main.js` 里那行是

```js
const cmd = `cmd.exe /c "set ELECTRON_RUN_AS_NODE= && start "" "${exe}" "${RES_ROOT}""`;
```

开发版需要把项目目录当参数传给 `electron.exe`（它靠这个找 `package.json`）；**但打包版的大肥鱼.exe 自己知道去哪找 `app.asar`，多传一个目录反而被它当成「要打开的路径」，加载失败直接退出**——于是开机自启静默失效，事件查看器里也就一条一闪而过的记录。

**修法**：按是否打包分两种命令。

```js
const cmd = app.isPackaged
  ? `cmd.exe /c "set ELECTRON_RUN_AS_NODE= && start "" "${exe}""`
  : `cmd.exe /c "set ELECTRON_RUN_AS_NODE= && start "" "${exe}" "${RES_ROOT}""`;
```

**教训**：凡是「开发时好好的、打包后不对」的功能，都要问一句**开发版和打包版的启动方式有什么不同**。这里一共三处不同——`process.execPath` 不同、是否要传项目路径不同、`RES_ROOT` 指向不同（`__dirname/..` vs `process.resourcesPath`）。


---

## 二十三、全局热键与打断

### 全局热键 Ctrl+Alt+F

任何地方按下，输入条从底部浮出来，光标已经在输入框里，敲字回车就能说话。
注册在  的 ， 失败只记日志不致命
（可能被别的软件占了）。

**这条路上有一个很容易误判的坑：透明窗口的「焦点」有两层。**

- DOM 层： 指向输入框 ——  能解决这一层
- OS 层：输入焦点是否真的在窗口上 —— 这一层没解决时，**真实键盘事件送不到页面**

判断依据：**CDP 用  派发能触发处理逻辑，真实键盘不能**。
这个差异一出现，就是 OS 焦点没抢到，不是事件绑定写错了。

修法是唤出时延 60ms 再  + （窗口要先 show 一次才「可激活」），
并把  记进日志当证据：

```
[main] 热键唤出输入条 focused=true
```

### 打断她的播放

语音键在三个状态下做三件不同的事，判断顺序全部在 `busy` 检查之前：

1. **正在播放** → `stopPlayback()` 让她闭嘴，气泡「小声点儿，我听见了」
2. **正在录音** → 取消这一段，麦克风保持开着
3. **否则** → 正常开关语音

`stopPlayback()` 里有一处必须做的标记：**清空 `currentAudio.src` 会让 `onerror` 立刻炸出来**，
不标记的话日志里每次打断后面都跟一条「播放失败 code=4」，看着像真的播挂了：

```js
try { currentAudio.__stopped = true; } catch (e) { }   // 先标记再清 src
try { currentAudio.pause(); } catch (e) { }
try { currentAudio.src = ""; } catch (e) { }
```

`playAudio` 的 `done()` 里第一行检查 `if (a.__stopped) return;`。

### 又一个编码坑

验 UTF-8 日志别用 grep 查中文——`grep -a "已发送" run.log` 会一条都匹配不到
（bash 的 grep 按本地编码比对），明明发了却以为没发。这个项目所有日志验证走 Python
`io.open(path, encoding='utf-8')`。


## 二十四、RVC 换音色：为什么最后没用 `.pth`

一开始走的是 `rvc_python` + `.pth`。CPU 上 5.4 秒音频要 21 秒，装 CUDA 版 torch
之后降到 3.5 秒，看着已经能用了。

但量了一下体积：

```
py310n/tools      6171.2 MB
  site-packages   6134.9 MB
    torch         4309.0 MB   ← CUDA 版，主体是 lib/*.dll
    rvc_python    1052.5 MB   ← 含 700MB 的模型副本
```

而且 `fairseq` 要在用户机器上**现场编译**，得装 Visual Studio Build Tools。

**换句话说：在我这儿好使，在别人的电脑上装不上。** 这才是要换路的原因，
不是速度问题。

### 换成 ONNX + DirectML

三条路线在 5.4 秒音频上的实测：

| 路线 | 耗时 | 要不要编译环境 |
|---|---|---|
| pth + CPU | 21.1s | 要 fairseq |
| pth + CUDA | 3.5s | 要 fairseq |
| onnx + DirectML | 3.69s | 不要，纯 pip |

`tts-with-rvc-onnx` 的依赖里没有 fairseq（只有预编译的 torch wheel），
而且它只吃 `.onnx`。用 `rvc_python` 自带的 `export_onnx(ModelPath, ExportedPath)`
从 `.pth` 导出（`onnx==1.14.1` 才能用，新版会报 `DLL load failed`）：

```
version=v2  emb_phone=0
gin_channels: 256 self.spk_embed_dim: 109
导出完成  10.7s   结果 110.3 MB  Warma-03.onnx
```

推理用 `onnxruntime-directml`，providers 是
`['DmlExecutionProvider', 'CPUExecutionProvider']` —— **不需要 CUDA Toolkit，
N 卡 / A 卡 / I 核显都能跑**，比原来只认 N 卡更宽。

转换耗时几乎不随音频长度涨：

```
GPU  5.38 秒音频 → 3.69 秒
GPU 23.50 秒音频 → 4.0  秒     ← 大头是固定开销
```

### 结构

```
_app/rvc/rvc_server.py     常驻 HTTP 服务（8897），--backend onnx|pth
_app/rvc/rvc_setup.py      一键安装（八步，全走镜像）
_app/rvc/models/           rmvpe.onnx + vec-768-layer-12.onnx + warma/Warma-03.onnx
_app/src/voice.js          speakRvc() → 失败回落 speakLocal() → 失败回落 speakViaDsh()
```

`/engine/rvc` 由主进程转发到 `127.0.0.1:8897`（**渲染进程直连 8897 会被 CORS 拦**，
这个坑在 API 模式上已经踩过一次）。

---

## 二十五、一键安装：`[done] 安装完成` 不等于能用

脚本跑完打了 `[done]`，我以为成了。一验，两处都是假的。

### 坑 1：`Tools/Tools` 路径冲突

```
[step] 2/14 解开 Python
[error] Destination path '...\rvc\py\Tools\Tools' already exists
```

nuget 的 Python 包里有个 `tools/`，而 `extractall(TARGET)` 又在顶层落了 `Tools`
（Windows 大小写不敏感），搬文件时撞成一坨。

修法：先解到 `TARGET/_x`，只从 `_x/tools` 往外搬，撞名就 `continue`，
搬完 `rmtree` 临时目录。

### 坑 2：`onnxruntime` 被普通版顶掉

```
onnxruntime          1.23.2
onnxruntime-directml 1.23.0
providers ['AzureExecutionProvider', 'CPUExecutionProvider']   ← 没有 Dml
```

`tts-with-rvc-onnx` 依赖普通 `onnxruntime`，pip 把它一起装了；两个包共存时
`import onnxruntime` 走普通版 → 掉回 CPU（3.7 秒变 20 秒）。

**光 `pip uninstall` 不够**：会留下一个空壳命名空间包（`ort.__file__` 是 `None`）。
必须连 site-packages 里的目录一起删，再 `--force-reinstall onnxruntime-directml`。

### 坑 3：numpy 被顶到 2.x

```
numpy 2.2.6
RuntimeError: Numpy is not available      ← torch.from_numpy 直接挂
```

torch 2.1.2 是针对 numpy 1.x 编译的，撞上 2.x 之后 RVC 里每一处
numpy↔torch 转换都会炸（`onnx_inference.py:69` 的第一个 `torch.from_numpy` 就挂）。

**坑 2 和坑 3 都必须在「装完所有包之后」再修一次** —— 前面修了会被后面的
依赖安装再顶掉。脚本里对应 `7.5 切回 DirectML` 和 `7.6 把 numpy 钉回 1.x` 两步。

修完的验收（不是看 `pip list`，是真调一次）：

```
numpy 1.26.0
torch.from_numpy: [0.0, 0.0, 0.0]
providers DmlExecutionProvider,CPUExecutionProvider

[rvc] convert ok 6.39s
sr 48000 | dur 5.69s | peak 0.435 | rms 0.0878 | 非静音 61.2%
```

---

## 二十六、打包：`**/*` 只匹配一层

`extraResources` 里给 rvc 目录写 filter：

```json
"filter": ["**/*"]
```

打出来的包装了 897MB，看着挺对，`models/warma/` 却整个没进去 ——
**`**/*` 只匹配一层**，子目录里的文件全丢。要递归得写 `**/**`。

验的时候不能只看安装包变大了，要数文件：

```bash
find dist/win-unpacked/resources/rvc -type f
```

还有一次，`rvc/` 下混进了测试残留（`_in.wav`、`_out_test.wav`、`_test.log`），
被一起打进包。filter 现在写成：

```json
"filter": [
  "**/**", "!py/**", "!__pycache__/**", "!*.pyc", "!*.pyo",
  "!_tmp/**", "!*.log", "!*.wav", "!*.tmp"
]
```

`py/**` 尤其重要：一键安装后的环境是 1.9GB，绝不能进安装包。

### 另一个：App「静默退出」

现象：起不来、进程数 0、**一行日志都没有**。

真因是**单实例锁** —— 机器上挂着 5 个打包版 `大肥鱼.exe`，
`requestSingleInstanceLock()` 返回 false 就 `app.quit()`，什么都不打印。

排查顺序：`Get-Process -Name '大肥鱼'` → 有就全杀 → 再起。
这条比翻 `main.js` 快得多。

注意 `_test/_kill.py` 只匹配 `_app\runtime\` 和 `dist\win-unpacked\`
两个前缀下的进程 —— **绝不能 `taskkill /IM electron.exe`**，那会把 DSH 桌面版
和机器上所有 electron 应用一起打死。


---

## 二十七、把 `.pth` 丢进去就自动转（不用 fairseq，不用装编译环境）

### 为什么做这件事

原来的流程是：用户拿到一个 `.pth` 音色模型 → 得自己装 Python、装 torch、装 fairseq
（还要 Visual Studio Build Tools 来编译）→ 跑一行导出命令 → 才有 `.onnx` 能用。

对普通人来说，这等于「用不了」。

现在改成：**把 `.pth` 丢进 `rvc\models\` 任意子目录，下次启动自动转**。

### 为什么能不用 fairseq

这是整件事的关键发现：

```python
# 在没有 fairseq 的环境里（torch 2.1.2+cpu）
{ "weight", "config", "info", "sr", "f0", "version" }   # 顶层键，能读
emb_phone: (192, 768)                                   # v2 模型
```

`.pth` 本身是纯 state_dict，**用 `torch.load(..., weights_only=False)` 就够**。
fairseq 只在「拿 `.pth` 直接推理」时才需要（`rvc_python` 的依赖），
**转换这一步完全不需要它**。

所以把模型定义（`SynthesizerTrnMsNSFsidM` 等几个类）从 `rvc_python` 里复制出来
放在 `rvc/fish_rvc_model/`，配 torch 就能导出。那份代码是纯 PyTorch，不依赖 fairseq。

### 三个必须记住的坑

**1. 构造要用 `SynthesizerTrnMsNSFsidM`，不是 `SynthesizerTrnMs768NSFsid`**

后者是训练用的类，`forward` 有七个参数：

```
TypeError: SynthesizerTrnMs768NSFsid.forward() missing 2 required positional arguments:
           'y_lengths' and 'ds'
```

`SynthesizerTrnMsNSFsidM`（在 `models_onnx.py` 里）才是给 ONNX 准备的，
`forward` 正好是六个输入：`phone, phone_lengths, pitch, pitchf, ds, rnd`。

**2. 构造参数用 `*cfg` 解包，别手填**

checkpoint 里的 `config` 就是完整参数列表：

```python
cfg = list(ck["config"])
cfg[-3] = weight["emb_g.weight"].shape[0]      # n_spk，权威在权重里
net = SynthesizerTrnMsNSFsidM(*cfg, is_half=False, version=version)
```

手填 18 个位置参数时我把 `kernel_size` 和 `p_dropout` 搞反了，报的是：

```
ValueError: dropout probability has to be between 0 and 1, but got 3
```

**3. `sr` 可能是字符串 `"48k"`**

```python
if isinstance(raw_sr, str):
    s = raw_sr.strip().lower()
    sr = int(float(s[:-1]) * 1000) if s.endswith("k") else int(float(s))
```

### 还有两处兼容性

**torch 版本差异**：新版（2.5+）的 `torch.onnx.export` 默认走 dynamo 新路径，
会要 `onnxscript` 这个额外包。老版（2.1.x，一键安装装的就是它）没这个参数。
脚本里先试 `dynamo=False` 走老 tracing，`TypeError` 就退回不带这个参数的调用：

```python
try:
    T.onnx.export(net, inputs, dst, dynamo=False, **kw)
except TypeError:
    T.onnx.export(net, inputs, dst, **kw)
```

**onnx 版本**：`onnx==1.14.1`。新版在这台机器上报
`ImportError: DLL load failed while importing onnx_cpp2py_export`。

### 服务的处理方式

`rvc_server.py` 起完监听之后，**在后台线程里**扫 `.pth`：

```
[rvc] loaded keqing.onnx in 2.2s  backend=onnx device=dml sr=48000
[rvc] listening on 127.0.0.1:8896
[rvc] 发现 1 个待转换的 .pth
[rvc] 开始转换 warmatest.pth
[rvc] 转换完成 warmatest.onnx  110.3 MB  用时 10.8s
```

**关键点：转换在后台，服务全程可用。**

不能因为要转个模型，让正在说话的她闭嘴十二秒。

`/health` 里带转换进度：

```json
{"convert": {"running": false, "total": 1, "done": 1, "current": "", "error": ""}}
```

设置面板据此显示「正在转换 xxx（1/2）… 第一次要几秒，转完就不用再等了」。

### 出错时给的是人话

```python
if "onnxscript" in str(e):
    _msg = "缺 onnxscript（新版 torch 需要），在设置里点一次「一键安装」会装上"
elif "Module onnx is not installed" in str(e) or "No module named 'onnx'" in str(e):
    _msg = "缺 onnx 包，在设置里点一次「一键安装」会装上"
elif "No module named 'torch'" in str(e):
    _msg = "这个 Python 里没有 torch，设置里点一次「一键安装」"
```

### 实测（打包版）

```
放 newvoice.pth 进 resources\rvc\models\ztest\
→ 起服务 → RVC 启动
→ convert: {"running":false,"total":1,"done":1,"error":""}
→ ztest\ 下出现 newvoice.onnx  111M
```

### 打包过滤

`extraResources` 的 rvc filter 现在长这样：

```json
["**/**", "!__pycache__/**", "!*.pyc", "!*.pyo", "!_tmp/**",
 "!*.log", "!*.wav", "!*.tmp", "!**/__pycache__/**", "!**/*.pyc",
 "!**/*.pyo", "!*.mp3", "!models/keqing/**", "!**/_dl/**",
 "!py/Lib/site-packages/pip/**", "!py/Lib/site-packages/setuptools/**",
 "!py/Lib/site-packages/pkg_resources/**", "!py/Lib/test/**",
 "!py/Lib/idlelib/**", "!py/Lib/tkinter/**", "!py/Lib/turtledemo/**",
 "!py/Lib/ensurepip/**", "!py/Lib/site-packages/**/tests/**",
 "!py/Lib/site-packages/**/*.lib", "!py/Lib/site-packages/**/*.a",
 "!py/Lib/site-packages/**/include/**", "!**/_bak_torch/**"]
```

排掉的东西每一条都是踩出来的：

- `py/Lib/site-packages/**/*.lib` / `*.a` / `include/**` —— **编译期**才用得上，运行时一个字节都不需要。
  光 `torch\lib\dnnl.lib` 一个文件就 532 MB
- `py/Lib/test` / `idlelib` / `tkinter` / `turtledemo` / `ensurepip` / `pip` / `setuptools` ——
  标准库里的开发件，跑起来的程序用不到
- `!**/_dl/**` —— 下载中转目录（`!_dl/**` 只排顶层，`models/_dl` 排不掉，**要写 `**`**）
- `!*.mp3` / `!*.wav` —— 测试音频
- `models/keqing/**` —— 开发时试听的模型，正式包只带 warma
- `!**/_bak_torch/**` —— 换 numpy 替身时备份的 torch，绝不能混进去

**`py` 现在是打进包的**（685 MB）。早期写的是 `!py/**`（整包排除），
后来决定「用户下下来就能用」，改成只排冗余。

安装包 996 MB = 802（程序 + 模型 + ffmpeg）+ 194（Python 环境压缩后）。

模型占大头：warma 111 MB + rmvpe 345 MB + vec-768 361 MB。

---

## 二十九、把 torch 换成 numpy 替身（环境 1948MB → 685MB）

这一步是为了让「把 RVC 和依赖一起打包」真正可行 —— 原环境 1948 MB，塞进去就是
一张 2.5 GB 的安装包。

### 关键发现：torch 只做一件事

`tts_with_rvc` 里只有 `onnx_inference.py` 用到 torch，一共 12 种调用：

```
torch.from_numpy x6 / torch.stft / torch.hann_window / torch.matmul
torch.clamp / torch.log / torch.pow / torch.maximum / torch.tensor
torch.Tensor / torch.nn.Module / torch.nn.functional
```

全在 `MelSpectrogram`（hann 窗 → STFT → abs → matmul → log）和 `change_rms`（插值 + 乘方）里。
**推理本身走 onnxruntime，跟 torch 没关系。**

于是写了 `rvc/torch_shim.py`（约 15 KB）用 numpy/scipy 顶替，`rvc_server.py` 启动时如果没有
真 torch 就把它塞进 `sys.modules`。

### 对拍验证（不能凭感觉说「应该差不多」）

同一段音频（语音 + 静音 + 扫频）分别过两个版本：

```
torch  shape (128, 201)     numpy  shape (128, 201)
最大绝对差 0.000039         相关性 1.00000000
99% 分位相对差 0.000000     A 平均能量 -3.1641 / B 平均能量 -3.1641
```

端到端转出来的 wav **字节数完全一致**（520748），频段分布差异在 2 个百分点，
而且那 2 个点来自 RVC 推理本身的随机噪声输入（`rnd` 是标准正态，每次都不一样）。

### 三个性能坑（每个都是数量级）

1. **`np.fft.rfft` 会把 float32 升成 complex128** —— numpy 的 FFT 不支持单精度，
   后面每一步都变双精度。改用 `scipy.fft.rfft/fft`（支持 float32 → complex64）。
2. **`np.clip(a, 1e-5, None)` 把 float32 提升成 float64**（Python float 标量）。
   在 `clamp` 里显式 `np.float32(min)`，`log` 后 `.astype(a.dtype, copy=False)`。
3. **`np.take(out, idx, axis=axis)` 走非连续内存** —— `apply_protection` 对 `(1,768,T)`
   插值要 1.8 秒。改成先 `moveaxis` 到最后一维、`reshape(-1, n_in)` 再索引，降到 0.1 秒。

修完：真 torch 3.89s / 替身热路径 **0.62~2.13s**（比 torch 还快）。

### 注入方式

```python
try:
    import torch as _torch_check
    _TORCH_REAL = True
except Exception:
    _TORCH_REAL = False
    try:
        sys.path.insert(0, HERE)
        import torch_shim as _shim
        sys.modules["torch"] = _shim
        sys.modules["torch.nn"] = _shim.nn
        sys.modules["torch.nn.functional"] = _shim.nn.functional
        print("[rvc] 没有 torch，用 numpy 替身（省 1GB，效果一样）", flush=True)
    except Exception as _e:
        print("[rvc] torch 替身加载失败：" + str(_e), flush=True)
```

**必须用 `print` 不能用 `log`** —— 这个块在 `log()` 定义之前执行。

### 顺带确认的两件事

- `tts_with_rvc` 的 `requirements` 里写着 `torchcrepe` 和 `torchaudio`，
  但源码里 `grep` **零命中** —— 照抄来的，实际用不到。所以 `rvc_setup.py`
  用 `pip install --no-deps tts-with-rvc-onnx`，依赖全在前面的步骤手动装齐。
- 环境清理：删 `torch` / `torchaudio` / `torchcrepe` + dist-info + `functorch` / `torchgen`
  + 所有 `__pycache__`，1948 MB → **685 MB**。

---

## 二十八、语音识别的两个依赖坑（ffmpeg 和 whisper 滤镜）

打包版装上之后「打字能说话、说话没反应」，因为语音识别这条路依赖两样外部东西，
而**开发机上两样都恰好有**，所以从来没暴露过。

### 坑一：用户机器上根本不会有 ffmpeg

`engine/asr.mjs` 的 `ffmpegBin()` 原来这么找：

```js
function ffmpegBin() {
  if (process.env.PHONE_FFMPEG) return process.env.PHONE_FFMPEG;
  try {
    const base = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
    for (const d of fs.readdirSync(base)) {
      if (!/Gyan\.FFmpeg/i.test(d)) continue;
      ...
    }
  } catch {}
  return 'ffmpeg';       // ← 退到 PATH
}
```

翻译过来是：「先看我机器上用 winget 装的那个，没有就当作系统 PATH 里有」。
这两条在别人的电脑上都不成立 —— `spawn('ffmpeg')` 直接 ENOENT。

修法：把 ffmpeg 放进包里，查找顺序改成

```js
const packed = path.join(HERE, 'runtime', 'ffmpeg', 'ffmpeg.exe');
if (fs.existsSync(packed)) return packed;
// 然后才轮到 winget / PATH
```

`HERE` 是 `path.dirname(fileURLToPath(import.meta.url))`，打包后指向
`resources/engine/`，所以 `runtime/ffmpeg/ffmpeg.exe` 就是包里那份。

### 坑二：essentials 版 ffmpeg 没有 whisper 滤镜

第一版打包的是 Gyan 官方 **essentials build**（100.5 MB），想省 127MB。
装完之后识别全挂，报错还是找不到 `asr_once.ps1`（那是回退到 System.Speech 的分支），
真正的原因被包在里面了。

查一下滤镜就明白了：

```
包内 essentials 版：  (没有 whisper)
系统 full build：      .. whisper    A->A    Transcribe audio using whisper.cpp.
```

**whisper 不是默认编进去的**，要 `--enable-whisper`。官方 essentials / full 两个
渠道版本都不带，本机这个是 Gyan 8.1.1 的 full build 恰好带了。

所以最后打包的是 **227 MB 的 full build**（`ffmpeg.exe` 一个文件），
安装包从 967 MB 涨到 996 MB。换语音识别能用，值。

以后要换 ffmpeg，第一件事是验这一句：

```bash
ffmpeg.exe -hide_banner -filters | grep -i whisper
```

没有这一行就不用往下试了。

### 顺带：繁体字收敛表不全

whisper 的中文输出经常混繁体，`asr.mjs` 的 `FIXUPS` 里有一张收敛表。
实测识别出「主人,我把**聲音**換成心的了。你**聽聽這個**」，才发现表里只有
`說/嗎/們/這/個/麼`，缺 `聲/聽/換/響` 这些。

补表的办法不是凭感觉列，是**跑一段普通话、把输出里的繁体字全捞一遍**：

```
主人,我把聲音換成心的了。你聽聽這個,像不像另一個人?你不想要我去找你嗎?
  ↓ 收敛
主人,我把声音换成心的了。你听听这个,像不像另一个人?你不想要我去找你吗?
```

另外表里别写「自替换」（`[/音/g, '音']` 这种，毫无作用），
也别把长词排在短字后面（`應該` 排在 `該` 之后永远匹配不到）。

### 这轮改的工具

- `_kill.start_app(packaged=True)` —— 起打包版不用再手工拼路径
- `verify-packaged.py` 里统计进程改用 `_kill.list_own_pids()`，
  原来的 `os.popen('tasklist')` 用 GBK 解中文进程名会抛 `UnicodeDecodeError`
- `verify-packaged.py` 的面板测试先判断一次是否已经打开，
  否则上次跑完留着的面板会被「点一下」关掉，看起来像打开失败
- `mem_steps.py` —— 分段量内存（说话 / 长句流式 / 开合面板 / RVC 各涨多少）

### 内存这一块查完了，没泄漏

打包版长跑 14 分钟：906 MB 起，第 6 分钟跳到 1724 MB，之后稳在 1685 MB，
后半段波动 −39 MB。那个跳变是「空闲降分辨率 → 恢复全分辨率」，不是泄漏。

按进程拆开看：

```
主进程    106 MB
GPU 进程   663 MB   ← 五张贴图（4096×8192 ×4、8192×8192 ×1）
渲染进程   788 MB   ← JS 堆 568 + canvas 位图
网络/音频   128 MB
```

`4096×8192×4 = 134 MB` 一张，五张就是 670 MB —— GPU 那 663 MB 对得上。
想再降只能减贴图分辨率（会糊）或者上传后释放 canvas 像素
（`context lost` 之后纹理会变白），两条都是拿功能换数字，所以没动。


---

## 三十、配置导出：哪些带得走、哪些不能带

设置面板底部有两个按钮：**导出配置** / **导入配置**。换机器时把 `dafeiyu-config.json`
拷过去，导进去就复原。

导出的是「偏好」，不是「这台机器的状态」。所以分三类处理。

### 带得走的（23 项）

- 桥接地址、音色、麦克风
- 大小 / 不透明度 / 清晰度 / 锐化
- 九个开关（置顶 / 穿透 / 跟随 / 小动作 / 眨眼 / 输入条自动隐藏 / RVC 自动关闭 / 开机自启）
- 语音输出那整套（`voiceOut` / `rvcBackend` / `rvcDevice` / `rvcPitch` / `rvcAutoStop` / `rvcModel`）
- 回复模型（`replyMode` / `apiBase` / `apiModel`）

### 故意不带的（6 项）

`x` / `y` / `anchorMode` / `offsetRight` / `offsetBottom` —— 位置是**绝对坐标**，
换一台屏幕大小不同的机器可能直接跑到屏幕外面去。位置只记「离右下角多远」，
这个相对量在导入端由 `anchorMode` 重新算。

`version` —— 版本号跟着程序走，不跟着配置走。

### 绝对不能带的（2 项）

- `rvcPython` —— 每台机器上 Python 装在哪都不一样，带了反而指错
- `apiKey` —— **密钥不该落进一个随手能发出去的文件里**。导入之后需要重新填一次，
  这是故意的，不是漏的。

导入时会校验 `j.app === "dafeiyu-desk"`，导错文件会明确报「这不是大肥鱼的配置文件」，
不会静默覆盖成一片空白。

`_test/check-exportable.py` 会核对：`DEFAULTS` 的每一项，要么在导出名单里，
要么在「故意不带」和「绝对不能带」的名单里 —— **不能有第三种情况（悄悄漏掉的）**。
现在是 `DEFAULTS 31 项 / 白名单 23 项 / 漏掉 0 项`。

---

## 三十一、0.1.0 发行打磨：从「能跑」到「能发货」（2026-11-10 凌晨）

三件事：让安装包里的东西真的能用、让用户第一次打开知道怎么用、让出问题时能拿到证据。

### 30.1 打包：三个必须项

1. **`electronDist: "runtime"`** —— 不再让 electron-builder 从 github 下 Electron 35.7.5（会超时）。
   代价是 `runtime/` 里的任何残留都会被原样复制进安装目录。本次就从 `runtime/resources/` 里揪出一个
   11/5 的调试探针 `boot-check.txt`。**打包前清 `runtime/resources`，只留 `default_app.asar`**。
2. **`afterPack: scripts/afterpack.js`** —— `signAndEditExecutable: false` 之后 exe 没有图标和版本信息，
   由 afterPack 用 `tools/rcedit.exe` 补：ProductName / FileDescription / CompanyName / LegalCopyright / FileVersion。
3. **`files` 是白名单，不是黑名单** —— 没列的资源在 asar 里根本不存在，`fs` 读 asar 也不会回落到
   `resources/` 外层。`assets/LICENSE.txt` 漏列 → 安装版「查看许可」直接报找不到文件。

### 30.2 可写目录：装到 Program Files 也不能崩

原来是「引擎在哪，缓存就写哪」：whisper turbo 下到 `engine/models`、ASR 临时文件写 `engine/runtime/asr`、
TTS 缓存写 `engine/runtime/tts`。装到 `Program Files` 时普通用户全无写权限，语音整条链路会死在最后一步。

现在打包态由主进程设两个环境变量：

```
FISH_DATA_DIR  = %APPDATA%\dafeiyu-desk\runtime     （缓存、临时文件、日志）
FISH_MODEL_DIR = %APPDATA%\dafeiyu-desk\models      （whisper 模型，turbo 1.6G）
```

开发态不设，engine 回落到原来的 `engine/runtime`、`engine/models`，行为不变。
**五个写入点必须用同一套规则**：`asr.mjs` / `tts.mjs` / `xtts_server.py` / `feiyu_server.py` / `rvc_server.py`。
漏一个的表现是「合成成功、`/engine/audio` 404、一句都不播」—— 本次就是这么踩的。

设置里的「存储」可以覆盖成自定义盘符，改完要重启（引擎是启动时按路径起的子进程）。

### 30.3 关于 / 许可 / 诊断包

- `about:info` → 版本、Electron/Chromium/Node/V8、系统、三个路径
- `about:license` → 按候选路径找 `LICENSE.txt`：asar 内 → asar 根 → `resources/assets` → `resources` 根
- `diag:export` → 建 `大肥鱼诊断-<时间>`：系统信息、`run.log` 最后 4000 行、轮转日志、崩溃文件、**脱敏设置**
- 脱敏：`apiKey` / `seeKey` / `miniToken` / `token` / `password` 有值写 `<已隐藏>`，空值写 `""`
- **系统对话框的父窗口必须是可聚焦的设置窗**，用 `focusable:false` 的模型窗会静默返回取消。
  五个入口（导出诊断包 / 导出配置 / 导入配置 / 选参考音频 / 选文件夹）统一走 `dialogParent()`
- `exportDiag()` 抽成了函数：IPC 用一次，「上次崩溃了」的提示也用一次
- 崩溃提示：启动 9 秒后检查 `userData/crash` 里最近 7 天的记录，同一份只问一次（`lastCrashSeen` 存文件名）；
  三个按钮「导出诊断包 / 打开崩溃记录 / 先不用」，`cancelId` 指向「先不用」，关窗不会误触发导出

### 30.4 首次运行引导

`firstRun` 默认 `true`，启动 4.2 秒后弹一张 400×368 的透明卡片（等模型画出第一帧再弹）。
四行：右键设置 / `Ctrl+Alt+F` / `Ctrl+Alt+M` / 拖着我走。点「知道了」写 `firstRun:false`。
老配置没有这个字段的按首次处理。

### 30.5 安装验证（实测）

| 项 | 数据 |
|---|---|
| 安装包 | 1296.6 MB |
| 安装后 | 12,855 文件 / 2.7 GB |
| 静默安装 | 168 秒（`/S /D=E:\Temp\install-test`） |
| 中文路径安装 | 161.4 秒（`/S /D=E:\Temp\安装测试`），12,855 文件 / 2,742 MB，启动正常 |
| 卸载 | 13 秒，目录 0 文件 |
| 卸载残留 | 桌面/开始菜单快捷方式、注册表卸载项 全部清空 |
| userData | 保留（`deleteAppDataOnUninstall: false`） |

中文路径（`E:\Temp\安装测试`）实测可用：静默安装 161.4 秒、12,855 文件 / 2,742 MB、模型贴图与语音链路都正常。
首次冷启动时出现过一次 `tex00.png` 解码失败，`bootSafe()` 的第 1 档「重试」自动接住、模型正常显示；
第二次启动 0 次失败 —— 这是首次冷启动「5 张大图（含 8192×8192，RGBA 约 268 MB）并发解码」的偶发现象，不是中文路径特有。

静默安装的坑：`& $setup /S "/D=$dir"` 会让 `/D=` 被引号包住，装到默认目录；
要用 `Start-Process -ArgumentList '/S','/D=...' -Wait`。

### 30.6 体积构成与可裁剪项

| 部分 | 大小 | 说明 |
|---|---|---|
| rvc | 2025.9 MB | 见下 |
| engine | 359.7 MB | ffmpeg 217 + ggml-base 141（turbo 1.6G 已排除，首次用到再下） |
| Electron 本体 | 242.5 MB | exe + dll，不可裁 |
| model | 62.3 MB | Live2D 模型 |
| assets | 6.5 MB | 图标 + 语音 + 参考音色 |

rvc 内部：`models` 1472.7 MB（vec-768 360.2 + rmvpe 344.9 + 7 个角色各 110.3）、`py` 553.0 MB。
**唯一能安全裁的是角色模型**（7 个共 772 MB）—— 留 1~2 个默认角色、其余按需下载，安装包可降到约 0.9G。
vec-768 / rmvpe 是 RVC 必需，删了直接不能转。

### 30.7 语音识别模型下载：能看见、能暂停、能续传

whisper turbo（1.6G）不随安装包发。**不会静默下载**：启动 8 秒后先弹一句「语音识别模型还没下载（约 1.6G）」，
选「现在下载」才开始，选「以后再说」就只记 `turboAsked: true`、不再重复问（首启会等欢迎卡关掉 30 秒再问，
免得两个窗口叠一起）。想下随时去设置 → 语音识别模型点「下载」。设置页那一行显示实时状态：

| 状态 | 显示 | 按钮 |
|---|---|---|
| 已下载 | `已就绪 · 1549 MB` | 已下载（灰） |
| 没下过 | `未下载 · 1.6G，用语音输入时会自动开始` | 下载 |
| 下载中 | `下载中 7% · 112 / 1549 MB` | 暂停 |
| 用户暂停 | `已暂停 · 109 / 1549 MB` | 继续 |
| 出错 | `下载失败：…` | 重试 |

三个容易踩的点：

1. **`ensureTurbo(force)`**：启动时那次自动检查传 `false`，用户点「继续」传 `true`。否则用户取消过一次，之后再也不会自动重试（这是有意的：不能背着用户偷偷下 1.6G）。
2. **取消不算失败**：读循环里 `job.cancelled` 抛出后，catch 里要 `job.error = ""` 再 break，否则 UI 走 error 分支显示成「下载失败：已取消」。
3. **刚点下载那一瞬间 `got` 是 0**，判断「下载中」要用 `attempt > 0 || got > 0`，不能只看 `got > 0`，否则点下去几秒内还是显示「未下载」，用户以为没反应。

底层用 `.part` 断点续传（`Range: bytes=N-`，镜像不回 206 就删掉重下），最多 3 次重试。调试时可用 `FISH_TURBO_URL` 指向别的地址。

### 30.8 窗口位置与加载失败兜底

两处「平时看不见、出事就要命」的补丁。

**窗口位置**：`clampToScreen()` 曾经定义了却从未被调用（死代码会骗读代码的人，以为有保护）。现在换成两级：

1. 创建窗口时 `ensureStartPos(raw.x, raw.y, w, h)` —— 用窗口中心找最近的显示器，把整块夹进它的 `workArea`。`offsetRight` 被改成负数也不会跑丢。
2. 监听 `display-removed` / `display-added` / `display-metrics-changed` —— 300ms 防抖后检查窗口中心是否还在某块屏上，不在就挪回来，日志写 `[main] 显示器变化，窗口已移回可视区 (x,y)`。

实测：把 `offsetRight` / `offsetBottom` 都改成 `-400`，重启后窗口落在副屏工作区边缘 `@1121,1080`，可见、可拖，没有消失。

**再启动一次要有回应**：`second-instance` 原来只有 `win.show()`。窗口被别的窗口盖着、或者拔过显示器跑到屏幕外时，
`show()` 之后用户还是看不见——看起来就是「双击了，没反应」。现在三件事一起做：

```js
if (!win.isVisible()) win.show();
win.focus();
scheduleReflow();   // 顺便把可能跑到屏幕外的位置拉回来
```

实测：第一个实例开着时再 `Start-Process` 一次，第二个进程立刻退出（`HasExited=True`），
第一个窗口拿到焦点、标题栏变亮；electron 进程数仍是 5（第一个实例的正常进程组）。

托盘「重置位置」同样过了 `ensureStartPos()` 再 `setPosition()`——原来直接用 `defaultPos()`，
分辨率或缩放变化时理论上可能算出边界外。

**加载失败**：`did-fail-load` 与 `render-process-gone` 以前都是无条件 reload —— 本地服务起不来时就是无限白屏，用户对着一片透明发呆。

- `did-fail-load`：`code === -3`（自己触发的 reload）直接跳过；前 2 次 1.2 秒后重试；到第 3 次 `showLoadError("界面没能拉起来", ...)`。
- `render-process-gone`：前 3 次重试；第 4 次 `showLoadError("界面连续崩了", ...)`。
- `showLoadError()` 用 `data:text/html` 内联页面（不走本地服务，服务挂了也能显示），深色卡片 + 错误码 + 「再试一次」按钮，文本做了 `& < > "` 转义。
- 两个计数在 `did-finish-load` 时清零。

### 30.9 这一版仍然缺的

- **代码签名**：SmartScreen 报「未知发布者」
- **模型授权**：LICENSE 写明「禁止重新分发完整模型文件」，直接商业发行有冲突
- **自动更新**：需要发布服务器与签名证书，当前只能手动覆盖安装

### 30.10 资源占用实测（0.1.0）

打包版 `dist\win-unpacked\大肥鱼.exe`，Windows 11 22621 / i5-12600KF / 31.8 GB：

| 时间点 | 进程数 | 合计工作集 | 合计私有 | 渲染进程累计 CPU |
|---|---|---|---|---|
| 启动 25 秒 | 5 | 638 MB | — | 34.9 s |
| 空闲 90 秒 | 5 | 585 MB | 1061 MB | 79.6 s |

- 工作集稳定在 585~640 MB，90 秒内没有增长趋势（Live2D 渲染、音频、桥接全算在内）。私有内存偏高是 Chromium 的预留行为，任务管理器里看到的通常是工作集。
- 渲染进程 65 秒内涨了 44.7 秒 CPU（约 69% 单核）——Live2D 60fps 的正常开销，不是泄漏。
- 启动到窗口出现约 4 秒；飞鱼语音引擎在后台预热 19 秒，是异步的，不挡 UI。
- 打包体积构成见 30.6，隐私边界见 `assets/PRIVACY.txt`。

**再细分一次（同一台机器，2026-11-10 复测）**：

| 状态 | 实际帧率 | 分辨率档 | 合计 CPU | 拆分 |
|---|---|---|---|---|
| 工作中（60fps / res 2） | 60 | 2× | **73%** 单核 | 渲染 44% + GPU 26% + 主进程 1% |
| 空闲降到 30fps / res 1 | 30 | 1× | **67~68%** 单核 | 同上 |

- 空闲降载确实生效：`window.FishModel.perf()` 返回 `calm:true / maxFps:30 / res:1 / canvas:[322,392]`，用 `tickN` 增量算出来正好 **30 帧/秒**。
- **但降载只省了一点**（73% → 67%）：瓶颈不在像素填充，在 Live2D 每帧的模型更新 + 大贴图采样（模型贴图含一张 8192×8192）。关掉锐化实测只从 68% 降到 67%，可以认为无关。
- 注意：`perf()` 里的 `fps` 是 Pixi `ticker.FPS` 的自报值，实测会显示 83（不可信）；判断真实帧率要看 `tickN` 的增量。
- 结论：这是「一直开着一个 Live2D 模型」的固有成本，不是泄漏也不是配置错误。介意耗电的场景建议用托盘「显示 / 隐藏」把她收起来（隐藏后 Chromium 会暂停 rAF）。


### 30.11 打包自检：一条命令问「该有的都有吗」

`_app/scripts/verify-pack.js`，Node 直接跑，不依赖 Electron：

```bash
cd _app
npm run verify:pack          # 等价于 node scripts/verify-pack.js
```

它检查 37 项，退出码非 0 就是有缺失：

- 根目录：`大肥鱼.exe`（≥100MB）、`resources/app.asar`、`resources/elevate.exe`
- asar 内：`src/` 十个入口（main/preload/index/settings/settings-renderer/welcome/boot/server/renderer/voice）、`assets/{LICENSE.txt,PRIVACY.txt,icon.ico,voice/body-1.wav}`、`package.json`
- `resources/` 七个子目录：assets / bridge / engine / model / rvc / src / vendor
- `resources/assets/`：LICENSE、PRIVACY、icon.ico、voice（且 `*.wav` 计数 > 0）、refvoice
- `resources/engine/`：asr.mjs、tts.mjs、feiyu_server.py、`runtime/ffmpeg/ffmpeg.exe`
- `resources/model/*.model3.json`、`resources/rvc/rvc_server.py`
- 末尾打印体积与文件数（当前 2742.1 MB / 12854 文件）

**反向验证过**：把 `resources/assets/PRIVACY.txt` 改名后跑，脚本 `exit=1` 并准确报 `❌ resources/assets/PRIVACY.txt missing`；改回来 37 项全过。

为什么要有它：`build.files` 是白名单，漏列一个 `assets/voice` 就会让安装版 `/voice/*.wav` 全 404 —— 这种问题只有装完点开才看得见。把「必须存在的文件清单」写成脚本，每次打包后跑一遍，比人肉记靠谱。

`package.json` 里加了两个脚本：

```json
"build": "node ./node_modules/electron-builder/cli.js --win --x64",
"verify:pack": "node scripts/verify-pack.js"
```

（`build` 走 node 直调 CLI，避开 `npx` 在本机 PowerShell ExecutionPolicy 下被拦的问题。）

### 30.12 源码自检：页面引用 / CSP / IPC 桥接 / 元素 id

`_app/scripts/verify-src.js`（`npm run verify:src`），217 项：

- 7 个 `.html` 每个都有 CSP
- 每个 `<script src>` / `<link href>` 指向的文件真的存在（`/` 开头按 `_app` 根解析）
- `preload.js` 里 `invoke("x")` 的每个通道，`main.js` 都有 `ipcMain.handle("x")`；反过来只给 ⚠️ 提示（可能只是内部通道）
- **每个 `getElementById("x")` 的 id，在引用这个 js 的 html 里真的存在**

最后一条防的是这个坑：`els.xxx = document.getElementById("bad")` 拿到 `null`，后面 `.addEventListener` 一抛，
**同一次初始化里排在它后面的所有按钮都不会绑上** —— 用户看到的就是「面板一半点不动」。
动态创建的元素（`createElement` 之后 `.id = "x"`）先收集、不算缺失，否则 `#fish-retry` 这种会误报。

当前结果：**217 通过，0 失败，0 提示**（main 注册 61 个 IPC，preload 暴露 61 个，一一对应）。

反向验证过：把 `settings.html` 的 `id="sharpen"` 改名，脚本立刻报
`❌ settings-renderer.js 引用了不存在的 #sharpen` 并 `exit=1`；改回来 217 项全过。

`npm run verify` 会把两项串起来跑：先源码、再产物。改完代码先跑 `verify:src`，打完包再跑 `verify`。

### 30.13 开机自启：以注册表为准，不以开关为准

`launchAtLogin` 只是个意图，真正决定开机起不起得来的是
`HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 里的 `DafeiyuDesk` 项。

早期实现的问题：`reg add` 的回调写成了 `() => {}`，**err 直接丢掉**。被安全软件、组策略、
注册表权限拦掉时，开关照样是「开」、面板照样正常、日志一个字都没有 —— 用户下次开机
发现她没出来，也无从判断是没设上还是被拦了。

现在 `applyLaunchAtLogin()` 是 `async`，写完**回读一遍注册表**，再和用户想要的状态比对：

- 开关开、注册表没有 → `{ok:false, error:"写入注册表失败，可能被安全软件或组策略拦了"}`
- 开关关、注册表还留着 → `{ok:false, error:"删除注册表项失败"}`

两个出口都会到用户眼前：改的那一刻 `push()` 收 `s.autostart.ok === false` 弹红色 toast；
设置页加载时还会调 `autostart:status` 复核一次，把矛盾写成橙色提示挂在「开机自启」下面。
**方向反着也要报**（开关关着但注册表留着旧项），否则注销重登还会自己起来，同样莫名其妙。

启动时也会重跑一次 `applyLaunchAtLogin`，所以注册表项被误删后，下次开机会自愈。

### 30.14 设置文件损坏时怎么恢复

`settings.json` 是唯一的配置存放点（`%APPDATA%\dafeiyu-desk\settings.json`）。它可能因为磁盘写坏、
手工编辑出错、或第三方工具改写而变成非法 JSON。

**早期行为（有坑）**：`Settings.load()` 解析失败 → 直接 `{...DEFAULTS}` → 立刻 `save()` 覆盖。
用户的 API Key、音色路径、快捷键一起消失，而且原文件没了，事后查不到「原来是什么」。

**现在**：

1. `catch` 里先判断是不是 `ENOENT`（文件不存在）。**只有「文件不存在」才静默用默认值** —— 那是首次运行。
2. 文件存在但读不动 / 解析失败：先 `fs.copyFileSync(this.file, this.file + ".bad-" + Date.now())` 备份，
   把 `{ backup, error }` 记进 `this.lastLoadError`，再写默认值。
3. `main.js` 在 `S = new Settings(...)` 之后立刻检查 `S.lastLoadError`，用 `logErr` 写一条
   `[main] settings.json 读取失败，已备份到 <路径>：<原因>`。
4. `about:info` 多返回一个 `settingsBroken`；设置 → 关于 的版本行会追加
   `⚠ 上次设置文件损坏，已重置`（橙色），鼠标悬停能看到备份路径。

**用户怎么找回配置**：去 `%APPDATA%\dafeiyu-desk\` 找 `settings.json.bad-*`，
那是最接近崩溃前的一份；里面还是合法 JSON 的话，改个名覆盖回 `settings.json` 即可。

**为什么不能直接覆盖**：这是「静默数据丢失」的典型形态 —— 用户只会发现「我的设置怎么全没了」，
没有任何线索指向「文件曾经坏过」。备份 + 日志 + 界面提示三件一起做，才叫可恢复。

**写盘失败也要看得见**：`save()` 用的是「先写 `settings.json.tmp`，再 `rename`」，
所以**失败时原文件不会被改坏**（实测：把 `.tmp` 造成目录制造 `EISDIR`，`settings.json` 内容原样保留）。
但「没坏」不等于「存上了」—— `save()` 现在记 `lastSaveError`，`settings:patch` / `settings:reset`
各写一条 `ERR` 日志，`about:info` 带 `settingsSaveError`，设置 → 关于 的版本行追加红色
`⚠ 设置保存失败`，悬停能看到 `EISDIR` / `ENOSPC` 这类具体原因。

**三种失败要分清**：读失败（文件坏了 → 备份 + 重置）、写失败（磁盘满 / 只读 / 被锁 → 原文件保住，但改动没生效）、
不存在（首次运行 → 静默用默认值）。混在一起处理，就会出现「看起来正常、其实数据已经没了」。

### 30.15 静态服务的路径边界

本地服务把 `RES_ROOT` 当静态根，`url` 直接 `path.join(root, rel)`。**只判 `startsWith` 是不够的**：

```
root = C:\app\resources
url  = /../resources-evil\secret.txt
join → C:\app\resources-evil\secret.txt
startsWith("C:\app\resources") → true   ← 前缀绕过
```

正确判法是看相对位置：

```js
const relToRoot = path.relative(root, full);
if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
  res.writeHead(403).end();
  return;
}
```

`path.isAbsolute` 那一半不能省：Windows 上跨盘时 `path.relative` 会直接返回绝对路径（`D:\x`），
它既不以 `..` 开头、也不在根下面。

实测（开发版与打包版各跑一遍）：

| 请求 | 结果 |
|---|---|
| `/src/main.js`、`/model/dafeiyu.model3.json` | 200 |
| `/../package.json`、`/../app.asar` | 403 |
| `/..%2fpackage.json`（URL 编码） | 403 |
| `/%2e%2e%2fpackage.json`（点编码） | 403 |
| `/../resources-evil/x.txt`（前缀绕过） | 403 |

**为什么本地服务也要防**：挂件只监听 `127.0.0.1`，但任何网页都能用 `<img src="http://127.0.0.1:7801/...">`
发起请求（不需要 CORS），把「能不能读到」变成可观测的侧信道。路径边界是这类服务的基本卫生。

### 30.16 语音缓存要有上限（而且两套引擎都要）

`runtime/tts` 里的 wav 是「说过的每一句」的缓存，命中就秒回。它必须有上限，否则长期使用只会一直涨。

- `tts.mjs`（edge 引擎）早就有 `prune()`：`PHONE_TTS_MAX_BYTES` 默认 128 MB、`PHONE_TTS_MAX_FILES` 默认 1200，超了按 mtime 从最旧删。
- **但飞鱼是默认引擎**，走 `feiyu_server.py`，那条路径上原本一行淘汰逻辑都没有 —— 默认引擎用得越多，缓存涨得越快，而且永远不回落。
- 现在 `feiyu_server.py` 也有一份 `prune_tts()`，规则和 `tts.mjs` 完全一致（同一组环境变量），在每次 `os.replace(tmp, out)` 成功后调用。

为什么不是「启动时清一次」：用户可能连开几天不重启，只在启动清等于没清。
为什么留 1200 个文件而不是更少：语音是高频重复的（固定问候、报时、常用回复），缓存命中率很高，删太狠反而让每次都要重新合成。

### 30.17 配置导出 / 导入：带什么，不带什么

`settings:export` 写一个 JSON：`{ app:"dafeiyu-desk", version, exportedAt, settings:{...} }`，
`settings:import` 只认 `app === "dafeiyu-desk"` 且带 `settings` 的文件，然后**逐个键过滤**（`EXPORTABLE` 白名单），
不是把整个 JSON 塞进设置里。

白名单外的键一律丢掉，包括：

- `apiKey` / `seeKey` / `miniToken` / `token` / `password` —— **密钥永远不落进配置文件**
- `offsetRight` / `offsetBottom` / `x` / `y` —— 窗口位置跟屏幕绑定，换台机器搬过去反而乱
- `cacheDir` —— 目标机器上那个盘不一定在

以前漏了 `viewBox` / `hotkeySummon` / `hotkeyMic`：换台机器导入之后，取景回到默认、快捷键回到默认，
而且界面只说「已导入 N 项设置」，看不出少了什么。现在三项都跟着走，导入后立刻生效：
取景靠 `applySettings(patch)` → `settings-changed` 事件 → 渲染侧重排；快捷键靠 `registerHotkey()` 重新注册；
`launchAtLogin` 靠 `applyLaunchAtLogin()` 重写注册表。

导入的返回值和改设置一样带 `ok/error`：写盘失败会红着说「导入的设置没存上」，
开机自启被拦会红着说「导入成功，但开机自启没设置上」——**不允许「显示成功但其实没生效」**。

### 30.18 窗口崩了：重建，不要往死进程里灌页面

`render-process-gone` 触发之后，那个 `webContents` 就是死的：再往里 `loadURL`，
URL 会变、画面却永远空白，连 CDP 的 `Runtime.evaluate` 都不回话（实测挂死 120 秒被强杀）。
早期版本就是在崩溃回调里调 `showLoadError()`，结果用户看到的是一张**空白窗**，
比报错还糟 —— 因为它看起来像程序卡住了。

现在的规则：

- **前几次**：`destroy()` 掉这个窗口，500ms 后重新开一个（设置窗走 `openSettings()`，
  模型窗走 `reload()`）。用户看到的是一次极短的闪，不是一块白板。
- **连着崩够次数**：另开一张独立的说明卡 `openSettingsError(reason)` / `openModelError(detail)`，
  420×300 / 360×260、无边框、不带 preload，只写清楚「发生了什么 + 去哪看日志 + 怎么办」。
  它不冒充原页面，所以不会有人以为设置还能用。

两个计数器上的坑，都是实测踩出来的：

1. `settingsCrashes` 必须放在**模块作用域**。放在 `openSettings()` 里的话，每重建一次
   就从 0 重数，「连崩三次就换兜底窗」永远触发不了。
2. 不能在 `did-finish-load` **当下**清零。崩溃 → 自动 reload 会立刻再触发一次
   `did-finish-load`，计数永远回到 0。改成「页面稳定活过 20 秒，才算这一轮真的好了」：

```js
let crashResetTimer = null;
win.webContents.on("did-finish-load", () => {
  loadFailCount = 0;
  if (crashResetTimer) clearTimeout(crashResetTimer);
  crashResetTimer = setTimeout(() => { renderCrashCount = 0; }, 20000);
});
```

还有一个纯手误的教训：`openModelError()` 里先把宽度取名叫 `const w = 360`，
后来又把 `BrowserWindow` 叫成 `w`，于是 `w.loadURL` 变成「对数字调用方法」——
日志里一句 `TypeError: w.loadURL is not a function`，窗口根本没创建。
**宽度别叫 `w`**，叫 `boxW`；窗口就叫 `b` 或 `win`。

实测结果（`E:\Temp\cdp-crash.js <url片段>` 发 `Page.crash`）：

| 场景 | 结果 |
|---|---|
| 设置窗崩 1 次 | 日志 1 条，500ms 后自动重开，页面完整渲染 |
| 设置窗连崩 3 次 | 第 3 次后出现独立说明卡「设置页面反复崩溃 / 原因：crashed / 关闭」 |
| 模型窗崩 1~3 次 | 自动 reload，模型重新出现 |
| 模型窗连崩 4 次 | 出现独立说明卡「界面连续崩了 / 渲染进程退出 4 次（crashed）」（右下角 1530,790） |


### 30.19 启动失败要看得见：别留一个隐形僵尸

`app.whenReady().then(async () => { ... })` 里只要有一句抛出去，后面的步骤全不执行：
没有窗口、没有托盘、没有任何提示。用户双击快捷方式，看到的是「根本没启动」；
可进程其实还挂着，占着单实例锁，再双击也不会有第二份。日志里只有一条
`ERR [unhandledRejection]`，而没人会去 `%APPDATA%` 翻。

两道保险：

```js
// ① 服务起不来是最可能的失败点：接住它，别让后面 createWindow 摸黑执行。
try {
  await bootServer();
} catch (e) {
  logErr("[main] 本地服务启动失败: " + (e && e.stack ? e.stack : e));
  try { if (!tray) makeTray(); } catch (x) { }
  try { openStartupError(e); } catch (x) { }
  return;
}

// ② 看门狗：正常路径几秒内就有窗口。20 秒还什么都没有，就判定启动失败。
setTimeout(() => {
  const hasWin = (win && !win.isDestroyed()) || (settingsWin && !settingsWin.isDestroyed());
  const hasTray = !!(tray && typeof tray.isDestroyed === "function" && !tray.isDestroyed());
  if (hasWin || hasTray) return;
  logErr("[main] 启动 20 秒后仍无窗口也无托盘，判定启动失败");
  openStartupError(new Error("启动超时：20 秒内没有出现窗口"));
}, 20000);
```

`openStartupError(err)` 是 420×300 的独立说明卡（无 preload）：写原因、写
「多半是本地端口被占用，或者被安全软件拦了」、写日志路径，一个「关闭」按钮。
它不假装自己是主界面，所以不会让人以为还能继续用。

**验证方法**（不靠猜）：把 `createWindow()` 开头临时改成 `throw new Error('模拟启动失败')`，
启动后 20 秒日志出现 `启动 20 秒后仍无窗口也无托盘，判定启动失败`，屏幕上出现说明卡；
恢复代码后 `TEMP-TEST` 计数 0、`node --check` 通过、`verify:src` 219 项全过。


### 30.20 点了退出，进程得真的走

`before-quit` 里做了一堆收尾：清定时器、关本地服务、`rvcStop()`、`miniStop()`、
`taskkill /T /F` 掉一键安装的 python。这些只要有一项卡住（等一个不肯退的子进程、
等一个没关干净的连接），`app.quit()` 就永远不完成：窗口消失了、进程还在，
再双击快捷方式也没反应——因为单实例锁还攥在它手里。用户只会得出一个结论：这软件关不掉。

三段式：

```js
app.on("before-quit", () => {
  // ...原有清理...
  if (!quitForceTimer) {
    quitForceTimer = setTimeout(() => {
      logErr("[main] 退出清理超过 3 秒，强制结束进程");
      app.exit(0);
    }, 3000);
    try { quitForceTimer.unref(); } catch (e) { }
  }
});

app.on("will-quit", () => {
  if (quitForceTimer) { clearTimeout(quitForceTimer); quitForceTimer = null; }
});
```

为什么是 `app.exit(0)` 而不是再来一次 `app.quit()`：`exit` 直接结束进程、不再走事件循环，
是唯一能保证「一定关得掉」的手段。到这一步优雅已经没意义了，能关掉才是第一位的。

为什么 `unref()`：不该让这个兜底计时器自己把进程吊着——正常退出时它会立刻被 `will-quit` 清掉，
但万一哪条路径没走到 `will-quit`，`unref` 能保证它不阻止事件循环自然结束。

实测（两条路都量了时间）：

| 场景 | 结果 |
|---|---|
| 正常退出 | 921ms 结束，无 `退出清理` 日志，electron 进程数 0 |
| 人为 `ev.preventDefault()` 卡住退出 | 2934ms 强制结束，日志 `ERR [main] 退出清理超过 3 秒，强制结束进程` |

注意：如果清理本身是**同步阻塞**（主线程卡在某个 `execFileSync` 上），计时器也没机会跑——
这种情况下任何 JS 层的兜底都救不了，只能从源头上给子进程调用设超时。
现在的 `taskkill` 都是 `/F` 且 `stdio: "ignore"`，正常情况是毫秒级返回。


### 30.21 设置窗打不开时，还得有出口

设置窗是唯一的「自助面板」：看版本、导诊断包、换缓存位置、恢复默认都在里面。
可它偏偏是最可能出问题的那个页面——本地服务起不来、渲染进程连崩、被安全软件拦。
如果所有出口都只在设置窗里，用户遇到这些情况时就彻底断线了。

所以托盘菜单里补三条，全部不经过设置页：

- **导出诊断包…**：直接调 `exportDiag()`（和设置页里那个是同一个函数），选目录、打包、打开文件夹。
- **打开运行日志**：`shell.showItemInFolder(LOG_FILE)`，直接在资源管理器里选中 `run.log`。
- **再看一次新手引导**：重开 `welcome.html`，忘掉的快捷键不用去翻文档。

配套的一个必要修正：`dialogParent()` 以前没有设置窗时会退回 `win`。但 `win` 是
`focusable: false` 的透明置顶模型窗，把系统对话框挂上去会**静默返回 canceled**——
从托盘点「导出诊断包」就变成「点了没反应」。现在改成：

```js
function dialogParent() {
  try { if (settingsWin && !settingsWin.isDestroyed()) return settingsWin; } catch (e) { }
  // 千万别退回 win：focusable:false 的窗口挂对话框会静默取消。
  // 没有能聚焦的窗口时宁可不要父窗口 —— 系统会当成独立对话框弹出来。
  return undefined;
}
```

实测：只开着模型窗（没有设置窗）时触发导出，系统对话框正常出现
（标题「选一个文件夹放诊断包」，按钮「放在这里 / 取消」），不再静默失败。


### 30.22 崩溃转储与「最后一句」

**crashReporter 只写不删。** `crashReporter.start({ uploadToServer: false })` 每崩一次就在
`userData/Crashpad/reports` 留一个几百 KB 的 `.dmp`，而且**没有任何上限**——本机跑测试崩得多，
实测攒到 **72 个 / 38.3 MB**。用户机器上如果是崩溃循环，这个目录会安静地吃掉几百 MB。

现在启动时清一遍（`pruneCrashDumps()`，紧跟在 `crashReporter.start` 之后）：

```js
let kept = 0, keptBytes = 0, removed = 0;
files.sort((a, b) => b.m - a.m);          // 新的在前
for (const f of files) {
  if (kept < 10 && (keptBytes + f.s) <= 20 * 1024 * 1024) { kept++; keptBytes += f.s; continue; }
  fs.unlinkSync(f.p); removed++;
}
```

- 只留最近 **10 个**、总量不超过 **20 MB**，多的直接删。
- 有删除才写日志：`[main] 清理旧崩溃转储 N 个（保留 10 个 / 9162KB）`——不吵，但查得到。
- 实测：72 个 / 38.3 MB → 10 个 / 8.9 MB，一次启动完成。

**「最后一句」也要落盘。** 对话记录走 `chatSaveSoon()` 的 400ms 防抖；说完最后一句话
马上点退出，`before-quit` 里只拆服务不刷缓冲，那条消息就跟着定时器一起没了。
现在把落盘抽成 `chatWriteNow()`，并加 `chatFlush()` 在 `before-quit` 最前面同步写掉：

```js
app.on("before-quit", () => {
  if (cursorTimer) clearInterval(cursorTimer);
  // 先把没落盘的对话写掉，再开始拆服务（拆服务可能卡住，见下面的 3 秒兜底）。
  try { chatFlush(); } catch (e) { }
  ...
});
```

实测：`chatAppend({text:'FLUSH_TEST_1130'})` 后立刻 `quit`，进程全部退出后
`chatlog.json` 里能查到这条 —— 防抖窗口内退出也不丢。

---

## 三十二、模型适配器：把模型从代码里搬出去（2026-11-11）

### 为什么做

0.1.0 的模型层是写死的：`renderer.js` 里 `MODEL_URL = "/model/dafeiyu.model3.json"`，
`TEXTURE_COUNT = 5`，贴图路径按 `tex00..tex04` 拼，12 个参数用**数字索引**（`PIDX = { ParamAngleX: 28, ... }`）。
换一个模型，这四样全部作废——参数索引错一位，头就转到别的地方去。

而模型的授权通常写着「禁止重新分发完整模型文件」。所以商业发行必须做到「程序与模型分离」：
程序发出去，模型让用户自己放进来。要做到这一步，就得有一个**能看见、能调**的适配界面，
而不是让用户去改 JSON。

### 结构：程序只认语义槽

```
src/packs/
  semantics.js   12 个参数槽 / 13 个动作槽 / 14 个活动槽 / 7 个表情槽（唯一的「程序知道什么」）
  manifest.js    pet.json v3：读写、清洗、校验、v2 迁移
  probe.js       从磁盘探：参数表、动作组、表情、贴图、分组、cdi3
  store.js       哪个包在哪、导入、复制、删除、原子写
  rules.js       规则插件注册表（可热重载）
  doctor.js      打分与结论
  builtin.js     把 motions.js 放进 vm 里跑，拿到 82 支曲线 + 42 个场景
  index.js       串起来，对外只暴露一个 ModelAdapter
  http.js        /api/packs/* 与 /packs/<id>/<file>
  rules/
    10-core-params.js    12 个参数下拉 + 别名表
    20-actions.js        27 个场景三选一
    30-expressions.js    7 个表情
    40-layout.js         取景、偏移、边距
    50-capabilities.js   物理、眨眼组、口型组
    60-interaction.js    点击分区、跟随、呼吸幅度
```

清单长这样（片段）：

```json
{
  "manifestVersion": 3,
  "id": "dafeiyu",
  "displayName": "大肥鱼",
  "live2d": {
    "model": "dafeiyu.model3.json",
    "params": { "angleX": ["ParamAngleX"], "mouthOpen": ["ParamMouthOpenY"] },
    "aliases": { "Movement2": "ParamBodyAngleY" },
    "actions": { "engine": "builtin", "overrides": { "sleep": { "engine": "model", "motion": "idle" } } },
    "expressions": { "engine": "auto", "default": "default-body", "map": { "happy": "heart-eyes" } },
    "layout": { "viewY": 0.1, "viewH": 0.5 },
    "groups": { "eyeBlink": "EyeBlink", "lipSync": "LipSync" },
    "interaction": { "headLine": 0.42, "faceLine": 0.72 }
  }
}
```

渲染端启动只做一件事：`fetch('/api/packs/active')`，拿到的就是上面这份「查表即用」的视图
（`params` 是槽→参数名，`paramMap` 是「曲线里写的名字→本模型里的名字」，`sceneRoutes` 是场景→路由）。
拉不到就退回旧的写死路径——**适配器坏了不能让桌宠起不来**。

动作库的曲线是 `[[参数名, [[t, v], ...]], ...]`。播放前每个参数名过一遍 `paramMap`，
找不到就跳过这条曲线。所以内置的 82 支动作是「跨模型资产」：只要模型有头部、眼球、口型这些基本参数，
它就能动，不需要模型作者提供任何动作。

### 六个坑（都踩过，都留了检查）

**1. `getParameterId(i)` 不是字符串**

```js
// 错：out[cm.getParameterId(i)] = i  → 键名全是 "[object Object]"
const o = cm.getParameterId(i);
const id = o && o._id ? o._id.s : String(o);
```

`getParameterId` 返回 CubismId 对象（`{_id:{s:"ParamAngleX"}}`）。这个错误不会抛异常，
只会在播放时静默地「一个参数都找不到」，表现为「这个模型没有「think」需要的参数」。
`renderer.js:173` 早就踩过一次，`adapter.js` 又踩了一次——所以现在两处的写法必须一致。

**2. `sanitize` 把用户刚调的字段抹了**

`store.write()` 会先 `M.sanitize()` 再落盘。而 sanitize 的 layout 白名单是手写的，
加了 `viewY/viewH` 却忘了补进去，结果接口返回 `{ok:true}`、`pet.json` 里却纹丝不动。
现在 `verify:packs` 里有一条专门的回归：`sanitize({layout:{viewY:0.05,viewH:0.8}})` 必须原样还回来。
**任何新字段进清单，第一件事是加进 sanitize 的白名单，第二件事是加一条往返检查。**

**3. 主进程模块改了要重启**

`src/packs/*.js` 是 `require` 进主进程的。`rules/*.js` 有 `delete require.cache` 热重载，
其它模块没有。改完 `manifest.js` 直接去点保存，用的是内存里的旧代码，
看起来就像「修了没用」。**改内核 → 重启 → 再测**，别怀疑人生。

**4. 覆盖层只存 `pet.json`，文件解析必须回落**

内置包是只读的，用户改配置时写一份同名覆盖层到用户目录。但覆盖层里**没有** `
.moc3 / 贴图 / motion3`——它们还在安装目录。`store.dirOf()` 返回用户目录之后，
`probe()` 和静态文件服务如果只认那一个目录，就会得到「模型文件不存在」+ 全 404，
包直接从「能用」变成 0 分。所以 `probe()` 统一走 `at(rel)`（先本包、再 `fallbackDir`），
`http.js` 的 `servePackFile` 也要两条路径都试。**凡是「包内相对路径」，都问一下要不要回落。**

**5. Pixi 的 `width / height` 是缩放后的**

```js
// 错：第二次算 scale 时 fit≈1，模型炸回原大
const fit = Math.min(H / model.height, W / model.width);
// 对：
const fit = Math.min(H / im.originalHeight, W / im.originalWidth);
```

`layoutPreview()` 在 `resize` 时会重跑，用显示尺寸算出来的 `fit` 会一路收敛到 1。
同理，取景框的几何用的是**显示高度**（`model.height`），不能再乘一次 `scale`。

**6. 取景窗口的 CSP 少了 `worker-src`**

引擎解码贴图要开 Worker，`viewframe.html` 的 CSP 只写了 `script-src`，
Worker 回落到 script-src 被挡，报「模型加载失败」并附带一条 `SecurityError: Failed to construct 'Worker'`。
`index.html` / `adapter.html` 都有 `worker-src 'self' blob:`，只有它漏了。
**新开一个跑引擎的页面，CSP 抄 `index.html`，一条都别少。**

### 怎么验证

```bash
npm run verify:packs     # 23 项：语义槽、规则形状、清单往返、规则落盘、内置包实测、曲线覆盖率
npm run verify           # src 295 + packs 23 + pack 37
```

`verify:packs` 里最有价值的一条是**曲线覆盖率**：把内置 82 支动作用到的每一个参数名
拿去和模型的参数表比对，算出「多少条曲线能播」。内置包实测 483/483 = 100%。
换模型时这个数低于 60% 就说明参数绑错了，内置动作会大面积哑火。

打包前的完整回归还是要杀进程重来（见「十九、回归脚本必须先杀两个进程名」）。

### 以后加新逻辑怎么做

「任何后续的软件逻辑改动，都应该能在适配器上新增规则适配」——这条落在规则插件上。

加一个规则 = 丢一个 `src/packs/rules/xx-名字.js`：

```js
module.exports = {
  id: "my-rule",
  version: 1,
  title: "我的新配置",
  description: "这组配置是干什么的",
  order: 70,
  fields: [
    { key: "amount", type: "slider", label: "幅度", min: 0, max: 2, step: 0.05, default: 1 },
  ],
  detect(ctx) { return { amount: 1 }; },      // 探测阶段的建议值
  validate(ctx, cfg) { return []; },          // 返回 [{level:"error"|"warn"|"info", message}]
  read(manifest) { return manifest.live2d.myRule || {}; },
  apply(manifest, cfg) { manifest.live2d.myRule = cfg; },
};
```

重启（或 `adapter.reloadRules()`），适配器右栏就多一组可配项，体检也会把它算进去。
**渲染端要读这个配置，从 `/api/packs/active` 拿，不要在渲染代码里写死默认值。**

## 三十三、RVC 的两条接口从来没通过（2026-11-11）

`/engine/rvc/health` 和 `/engine/rvc`（变声）写在 `server.js` 里，调的是 `rvcFetch` 和 `rvcStatus`。
这两个函数都在 `main.js` 的模块作用域，`startServer` 的 opts 里从来没传过。

于是每次请求的轨迹是：

```
ReferenceError: rvcFetch is not defined
  → 进 catch
  → catch 里调 rvcStatus()
  → ReferenceError: rvcStatus is not defined
  → 第二层异常没人接
  → res 永不落笔
  → 前端一直等到 TCP 超时（实测 120 秒还没回）
```

从 0.1.0 就是这样。没人会在那种地方等两分钟，所以一直没被发现——
大家都以为「RVC 服务没起来」。

修了三处：
1. `main.js` 的 `startServer({...})` 里加 `rvcFetch, rvcStatus,`；
2. `server.js` 的 catch 里读状态也包一层 `try`——**catch 自己抛错等于响应永远发不出去**；
3. `rvcFetch` 内部从 `net.fetch` 换成 Node 的 `fetch`：Electron 的 `net.fetch` 走 Chromium
   网络栈，目标端口没人监听时不立刻 RST，会一路等到超时；Node `fetch` 是 23ms `ECONNREFUSED`。

结果：健康检查 **41ms** 返回 `{ok:false}`，变声 **3.5ms**。

顺手还修了 `settings-renderer.js:1100`：它请求 `127.0.0.1:8897/engine/rvc/health`，
但 8897 是 RVC 自己的 Python 服务，没有这个前缀，404 被 catch 吞掉，白等 30 轮 ×1 秒。
正确是 `8897/health` 或 `7801/engine/rvc/health`。

**可复用的排查顺序**：接口永远不返回时，先翻服务端日志找 `unhandledRejection`，
再查超时配置，最后才怀疑网络栈。异常被吞掉的地方，故障会伪装成别的东西。


