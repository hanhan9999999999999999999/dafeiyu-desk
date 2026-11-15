# 大肥鱼挂件 · 维护说明

> 最后更新：2026-11-01 13:0x
> 挂件 id：`dafeiyu`　显示名：大肥鱼
> 位置：`C:\Users\Administrator\.dsh\pets\dafeiyu\`

---

## 一、她是什么

一只 Live2D 模型，用 DSH 自带的 `@linxin666/dsh-pet` 插件挂在界面右下角，跟随当前窗口会话的状态做表情和动作。

- 模型来源：`D:\document\DSH Live2D\DeepSeek Live2D Model\DeepSeek\`（原作者：原画及拆分 神宫凉子，Live2D 建模 霓虹猫_NeonNeko）
- 授权：仅供个人使用，**禁止二次销售与重新分发完整模型文件**
- 性格文案：`voice.json`，我写的

---

## 二、日常操作

| 想做什么 | 怎么做 |
| --- | --- |
| 藏起来 / 叫出来 | 鼠标悬停到她身上 → 面板里点「先下去」；隐藏后右下角会出现「召唤大肥鱼」按钮 |
| 调大小和位置 | 设置 → 宠物卡片：`size`（尺寸，现在是 500）、`right` / `bottom`（距右下角像素） |
| 换成别的宠物 | 设置页宠物卡片里切换 `petId` |
| 直接改接口 | `POST /api/pet/set-visible` body `{"visible":true}`；`POST /api/pet/set-config` 改尺寸位置 |

> `set-visible` 的 `visible` 必须传**布尔值**，传 `"true"` 字符串会被拒。

---

## 三、她怎么"演"

七个活动相位 → 动作 + 表情的映射写在 `pet.json` 的 `live2d` 段：

| 相位 | 何时出现 | 动作 | 表情 |
| --- | --- | --- | --- |
| `idle` | 没活干 | idle（循环） | 默认体型 |
| `waiting` | 排队/等你说话 | idle | 脸红 |
| `thinking` | 思考中 | finger 竖手指 | 屑屑眼 |
| `tool` | 跑工具 | grass 狗尾草 | 圈圈眼 |
| `review` | 整理结果 | fingerback 收回 | 默认体型 |
| `done` | 干完了 | handup 举手 | 爱心眼 |
| `failed` | 翻车了 | lost 脱捕 | 流冷汗 |

**只跟随当前窗口的会话**：`/api/pet/state` 的顶层 `phase` 是所有会话混算的，所以客户端里加了一层 `__pinSession` —— 按当前 sessionId 从 `sessions[]` 里挑自己那条，挑不到就老实待机，不会去演别人的动作。

---

## 四、八个动作

| 组名 | 原文件 | 时长 | 循环 |
| --- | --- | --- | --- |
| `idle` | IDLE.motion3.json | 5.98s | **是** |
| `handup` | 默认手切举手 | 1.13s | 否 |
| `handdown` | 举手切默认手 | 1.02s | 否 |
| `finger` | 竖手指切出来动画 | 1.25s | 否 |
| `fingerback` | 竖手指切回默认 | 1.25s | 否 |
| `grass` | 狗尾草切换出来 | 1.23s | 否 |
| `grassback` | 狗尾草切回默认手 | 1.13s | 否 |
| `lost` | 脱捕 | 13.15s | 否 |

**过渡动作播完会自动收回**：`handup→handdown`、`finger→fingerback`、`grass→grassback`，收回后回 idle。这条逻辑在 `client.js` 的 `motionFinish` 回调里，配对表是 `__backOf`。

---

## 五、二十三个表情（Exp3 原名 → ASCII 名）

```
默认体型 default-body   体型1 body-1      体型2 body-2     兔牙 teeth
前倾 lean              加载 loading       单片眼镜 monocle  圈圈眼 dizzy
尾巴开关 tail          屑屑眼 smug-eye    流冷汗 cold-sweat 流泪 tears
爱心眼 heart-eyes      竖食指开 finger-on 竖食指关 finger-off
胸口衣服 chest-cloth   脱鞋 shoes-off     脸红 blush       裙子切换 skirt
钢盆 bucket            黑框眼镜 glasses   黑脸 black-face  ＞＜ x-eyes
```

---

## 六、改过哪些文件

### 宿主侧（改完要重启才生效）

| 文件 | 改了什么 | 备份 |
| --- | --- | --- |
| `C:\Users\Administrator\.dsh\profiles\desktop\package.json` | `dsh.profile.bundles` 加进 `@linxin666/dsh-pet`（34→35 项），同时加进 `dependencies` | `package.json.bak-pet-20261101-112617` |
| `C:\Users\Administrator\.dsh\profiles\desktop\cordis.patch.yml` | 第 48 行 `- id: web-ui-pet` → `- id: pet`（这个 bundle 自插的 entry id 叫 `pet`，不是 `web-ui-pet`） | `cordis.patch.yml.bak-*` |

> **注意**：`package.json` 曾经因为开头有 UTF-8 BOM 导致整个应用起不来。改这个文件请用 Python 的 `json` 读写或确保不写 BOM，改完检查头三个字节不能是 `ef bb bf`。

### 插件侧（改完刷新即生效，因为 `/plugins/` 是 `no-store`）

`C:\Users\Administrator\.dsh\profiles\desktop\node_modules\@linxin666\dsh-pet\lib\client.js`

| 位置 | 改动 |
| --- | --- |
| `playGroup` | 还原成原生 `model.motion(group, index, 3)`，不再自己接管循环 |
| `motionFinish` | 播完按 `__backOf` 配对收回，再回 idle |
| `Live2DModel.from` 前 | 把 `modelUrl` 拼成绝对 URL（自定义协议下 `origin` 为 `null`，相对路径会解析成 `dsh-app://pet/...` 而 404） |
| `pollNow` | 加 `__pinSession`，把顶层 phase/bubble 钉到当前会话 |
| 文件末尾 | 注入左下角 🐟 开关按钮（`#dsh-live2d-toggle`） |

备份：同目录 `client.js.bak-live2d-*`，直接复制回去就还原。

### 宠物包

`C:\Users\Administrator\.dsh\pets\dafeiyu\`（扁平结构，所有引用相对 pet 根目录）

```
pet.json             清单（v2）
dafeiyu.model3.json  模型引用 + 8 动作 + 23 表情
dafeiyu.moc3         16.5MB 模型本体（Cubism 5.0）
dafeiyu.physics3.json 物理（头发/尾巴/裙子）
dafeiyu.cdi3.json    参数与部件名（148 个部件 / 509 个参数）
tex/tex00..04.png    5 张贴图，已从 45MB 降到 1.8MB
mot/*.motion3.json   8 个动作
exp/*.exp3.json      23 个表情
voice.json           性格文案（气泡/工具/面板）
```

`C:\Users\Administrator\.dsh\pets\.runtime\live2dcubismcore.min.js` —— Cubism Core 5.1.0，207155 字节，从 `cubism.live2d.com` 下载。插件按 Live2D 授权不会代下这个文件，删了模型就起不来。

---

## 七、改坏了的还原办法

**动作文件回到出厂状态**（八个全部 `Loop=true`）：

```powershell
Copy-Item "D:\document\DSH Live2D\DeepSeek Live2D Model\DeepSeek\Animation\*.motion3.json" `
          "C:\Users\Administrator\.dsh\pets\dafeiyu\mot\" -Force
```

**插件回到原版**：

```powershell
Copy-Item "C:\Users\Administrator\.dsh\profiles\desktop\node_modules\@linxin666\dsh-pet\lib\client.js.bak-live2d-*" `
          "C:\Users\Administrator\.dsh\profiles\desktop\node_modules\@linxin666\dsh-pet\lib\client.js" -Force
```

**整个宠物包重建**：跑 `D:\document\DSH Live2D\_build\make-pet.mjs`，再跑 `verify-pet.mjs` 验证。

---

## 八、别动的东西

- `dafeiyu.moc3` —— 模型本体，改了就废
- `tex/*.png` —— 贴图，改尺寸要同步改 UV，别单独换
- `physics3.json` —— 物理参数，动了头发和尾巴会乱甩
- `exp/*.exp3.json` —— 表情曲线。**2026-11-01 下午已获授权改**（见第十节），改之前先备份到 `_build\backup\`
- `live2dcubismcore.min.js` —— 删了模型直接不显示
- **`package.json` 的编码** —— 有 BOM 会导致整个 DSH 打不开

---

## 九、诊断脚本

都在 `D:\document\DSH Live2D\_build\`：

| 脚本 | 用途 |
| --- | --- |
| `make-pet.mjs` | 从原始素材重建宠物包 |
| `verify-pet.mjs` | 校验清单 + 资源闭包完整性 |
| `verify-registry.mjs` | 校验宿主能否扫到这个宠物 |
| `verify-voice.mjs` | 校验 voice.json 解析结果 |
| `shrink-tex.py` | 贴图降采样 |
| `pin-current-session.py` | 会话钉住补丁 |
| `_restart-dsh.ps1` | **危险，别用**（曾经把应用搞挂过） |


---

## 十、2026-11-01 下午：圈圈眼根治 + 动作收敛

主人说「还是有空心圈的表情 动作也比较混乱 排查一下 直接把空心圈这个表情禁用掉」，随后授权直接改模型。

### 圈圈眼（key3）的两个真源头

不是映射选错，是模型自己带的：

1. **`mot/lost.motion3.json` 自带 `key3`（圈圈眼）和 `key8`（加载）两条曲线** —— `failed` 相位播的就是 `lost`，一播就开圈圈眼，动作停下后参数不复位，就一直留着。
2. **`exp/dizzy.exp3.json`** 本身就是打开 `key3` 的表情。

### 处置

| 文件 | 改动 | 手法 |
| --- | --- | --- |
| `mot/lost.motion3.json` | `key3` / `key8` 值全压 0 | 不删曲线，只把数值分量置零、时间轴保留 |
| `mot/lost.motion3.json` | `AngleX/Y/Z`、`PositionX/Y/Z` 值全压 0 | 同上，失败时不再整只模型旋转位移 |
| `exp/dizzy.exp3.json` | `key3` 值归零 | 即使被调用也画不出圈圈眼 |

**为什么压零而不是删曲线**：Cubism 读 motion3 会核对 `Meta.CurveCount / TotalPointCount / TotalSegmentCount`，删曲线必须同步重算，算错整个动作加载失败。压零则长度不变、计数不变，零风险。

校验方式：按 Segments 编码逐段走一遍，累计点数/段数必须与 Meta 完全相等。当前 `lost`：`curves=24 points=681 segs=271`，完全吻合。

### 一个必须记住的坑

**`pet.json` 里的 `motions` / `expressions` 映射是宿主启动时的不可变快照**（`service.js:110` 注释原话 "the registry is an immutable snapshot"，且没有刷新接口）。

- 改 `.motion3.json` / `.exp3.json` → **刷新页面就生效**（它们是 HTTP 资源）
- 改 `pet.json` 的映射 → **必须重启宿主**，否则 `/api/pet/pets` 一直返回旧值

判断改完有没有生效，别靠肉眼，直接打接口：

```
curl -s http://127.0.0.1:52081/api/pet/pets
```

再过滤 `id == dafeiyu` 的 `live2d` 字段。

### 新增脚本

| 脚本 | 用途 |
| --- | --- |
| `disable-key3.py` | 压平 `lost` 的 key3/key8 + 归零 `dizzy` 的 key3 |
| `flatten-lost-pose.py` | 压平 `lost` 的旋转位移六条曲线 |
| `fix-expression-keys.py` | 给 13 个 key 表情补齐互斥开关 |
| `add-idle-face.py` | 注入 idle 微表情（空闲时自己换脸） |
| `add-gaze.py` | 注入跟随鼠标（头/眼/上半身七参数） |
| `add-gaze-life.py` | 给跟随加口型（thinking/review 嘟囔）与走神（90 秒无鼠标） |
| `add-situation-face.py` | 情境表情：连败 3 次黑脸、0-6 点困脸 |
| `add-toggle-button.py` | 注入左下角 🐟 开关 |
| `fix-model-url.mjs` | 把 modelUrl 规范成绝对 URL（自定义协议下相对路径会丢 host） |
| `restore-native-loop.mjs` | 把过渡动作的 `Meta.Loop` 改回 false |

### 备份位置

`_build\backup\` 下有 `lost.motion3.json.bak-key3`、`lost.motion3.json.bak-flatpose`、`dizzy.exp3.json.bak-key3`、`exp.bak-keyswitch/`。

---

## 十一、让她活起来（驱动层）

模型本身只会呼吸和播动作。下面三层是我加的"活的驱动源"—— 她没有脸可以被摄像头捕捉，
但有注意力、有说话的节奏、有情绪，这三样就够当驱动信号了。

### 1. 跟随鼠标 `installGaze(pixiApp)`

鼠标位置归一化成 `-1..1`，每帧朝目标插值（正常 `0.10`），驱动七个参数：

| 参数 | 公式 | 效果 |
| --- | --- | --- |
| `ParamAngleX` | `cx * 26` | 头左右转 |
| `ParamAngleY` | `-cy * 22` | 头抬起/低下 |
| `ParamEyeBallX` | `cx` | 眼球左右 |
| `ParamEyeBallY` | `-cy` | 眼球上下 |
| `ParamAngleZ` | `cx * 8` | 头轻微歪 |
| `ParamBodyAngleX` | `cx * 8` | 上半身跟着转 |
| `ParamBodyAngleZ` | `-cx * 3` | 腰的反向补偿 |

鼠标移出窗口 → `mouseleave` 把目标归零，她自己转回正面。
执行顺序上她排在引擎 `update` 之后，所以写进去的值不会被动作覆盖；
且这些参数都不在 `idle` 的动作曲线里，不会打架。

### 2. 口型

`thinking` / `review` 两个相位（我在想事情、在整理）时嘴按正弦微动：

```js
__mouth += 0.55
ParamMouthOpenY = 0.55 * (0.5 + 0.5 * sin(__mouth))
ParamMouthForm  = 0.35     // 嘴角微扬，不是呆张
```

这不是音素级口型（那要接 TTS 音频做频谱分析）。这一层是"在嘟囔"——
看得见嘴动，听不见声。

### 3. 走神

鼠标 90 秒不动：目标改到 `(-0.55, 0.35)`，插值压到 `0.02`。她会慢慢把头偏开，
像发呆。鼠标一动立刻回神。

### 4. 情境表情

相位映射之外，再加两条情境判断（`applyPhase` 里）：

| 条件 | 表情 |
| --- | --- |
| `failed` 连续累计 ≥ 3（`done` 时清零） | `black-face` 黑脸 |
| 本地时间 0-6 点且处于 `idle`/`waiting` | `loading` 困 |

配合原有的 idle 微表情（22-42 秒随机换一次，3.6-6.2 秒后恢复），
13 个 key 表情里现在有 9 个真的会被用到。

### 清理

`installGaze` 返回清理函数，赋给 `stopGaze`，在 `destroyResources` 里调用
（和 `stopResizeTracking` 同一个模式），`ticker.remove` + 解绑两个监听。
`__faceTimer` / `__faceBackTimer` 由 `__clearFaceTimers` 统一清。

### 备份

`client.js.bak-gaze`、`client.js.bak-gaze2`、`client.js.bak-situation`。

---

## 十二、清晰度战役与"活"的第二轮（2026-11-01 傍晚）

这一节记的是这半天里最费劲、也最值得记的一段 —— 因为前面十几轮全在改错东西。

### 1. 真正的病根：贴图根本没进 GPU

症状：头和手清楚，衣服糊；窗口开多大都糊；同样的模型在 `_hires.html` 里清楚，在 DSH 里糊。

一路排查过的**假线索**（全不是原因）：

| 试过的 | 结果 |
| --- | --- |
| `resolution` 3 → 2 → 1 | 无效 |
| `lod: "full"` / `"single-auto"` | 无效 |
| 手动生成 mip 链（14 级） | 更糊 |
| 超采样 SSAA（`resolution: 2`） | 更糊 |
| 512 → 4096 放大 tex02 | 略好，没解决 |
| 取景 `Math.min` → `Math.max` | 与糊无关 |
| 换贴图文件名绕缓存 | 无必要（且会 404） |

**决定性证据**：在 `client.js` 里加探针，直接读 `model.textures[i].baseTexture.source.width`：

```
tsrc = 512x1024, 512x1024, 1024x1024, 1024x1024, 1024x1024
```

五张贴图**全被压到最大边 1024**。而磁盘上明明是 4096×8192。

再对照 —— 同一张图，主线程自己取：

```
[pet-live2d] blob url=/pet/dafeiyu/tex/tex00.png bytes=10462576 type=image/png
[pet-live2d] bitmap 4096x8192
```

**主线程拿到 10.4MB 原图、解出 4096×8192；引擎的 Worker 解码路径把它压成 512×1024。**

结论：**文件没问题、HTTP 没问题、缓存没问题，是引擎在 `dsh-app://` 自定义协议下走 `WorkerManager.loadImageBitmap` 时把图压了。**

### 2. 解法：纹理解包（TEXHIJACK）

不信引擎的加载管线，自己取原图替换底纹。插在 `modelAttached = true;` 之后：

```js
const __texBase = __origin + "/pet/dafeiyu/tex/tex";
(loaded.textures || []).forEach((__tex, __i) => {
  const __u = __texBase + String(__i).padStart(2, "0") + ".png?rgba";
  fetch(__u).then(r => r.blob()).then(b => createImageBitmap(b)).then(bmp => {
    const __src = __tex && __tex.baseTexture && __tex.baseTexture.source;
    if (typeof __src.resize === "function") __src.resize(bmp.width, bmp.height);
    __src.resource = bmp;
    __src.autoGenerateMipmaps = false;
    __src.mipLevelCount = 1;
    __src.update();
    if (__src.style) {
      __src.style.minFilter = "linear";
      __src.style.magFilter = "linear";
      __src.style.mipmapFilter = "none";
      __src.style.anisotropicLevel = 16;
    }
  });
});
```

日志会打 `TEXHIJACK 0:4096x8192 | 1:4096x8192 | 2:4096x4096 | 3:8192x8192 | 4:4096x4096`。

**两条被证伪的替代方案**（别再试）：
- `preferCreateImageBitmap: false` —— vendor 里有 `e.settings instanceof SD && (r.preferCreateImageBitmap = !1)` 强覆盖，开关无效
- 改 `model3.json` 的 Textures 文件名 —— `resolveLive2dEntry` 只在 `loadPetRegistry` 时跑，`servable` 是启动快照，新名字直接 404，整个模型加载失败

### 3. mip 链陷阱

贴图换成 4096 之后，如果 mip 链还是按 1024 建的那 11 层，**只有 1024 窗口 1:1 时清楚，其他尺寸又开始翻旧 mip，于是又糊**。

所以 TEXHIJACK 里必须**彻底关掉 mip**（`mipLevelCount = 1`、`mipmapFilter = "none"`）。这也是 AAAAGENT 的做法，其源码注释原话：

> No mip chain is allocated for the 8192/4096 texture sources.

### 4. 清晰度最终定案

主人一句话定了性：**「1024 大小完全没问题」「衣服就是会糊，你 1024 大小怎么处理的对小点的也怎么处理呗」**。

算下来：`size=1024` 时模型在屏幕上占 1917px，`size=520` 时只有 974px —— **纹理都缩 2 倍，差的只是屏幕像素总数**。要让小窗口等效大窗口，唯一的路是内部按更大分辨率渲染再缩小显示。

```js
resolution: Math.max(2, devicePixelRatio || 1)
```

**内部 960×1040 渲染 → CSS 缩到 480×520 显示。** 主人回复：**「模型现在清晰了」**。

> **这一段别再动。** 渲染参数已经锁死，动之前先问。

### 5. 朝向 bug：她看的是窗口中心，不是你

原来的归一化：

```js
const w = window.innerWidth;
tx = (ev.clientX - w / 2) / (w / 2);   // 原点 = 窗口中心
```

挂件挂在右下角时，鼠标在挂件左边但仍在窗口右半边 → `tx` 是正的 → 她往右看。**看起来就是"根本不理你"。**

改成以**画布自身位置**为原点：

```js
const rc = pixiApp.canvas.getBoundingClientRect();
const cx = rc.left + rc.width / 2;
const cy = rc.top + rc.height / 2;
const range = Math.max(300, Math.min(innerWidth, innerHeight) * 0.45);
tx = (ev.clientX - cx) / range;
ty = (ev.clientY - cy) / range;
```

### 6. 三样东西从池子里拿掉

主人原话：「不要再举手和拿狗尾巴草了，截图发给你的这个表情也不要出现（就是眼睛变成很简单的配色然后头往一边一歪）」。

那是 `smug-eye`（屑屑眼，开 `key6`）。

```js
const __BANNED_GROUPS = { handup: 1, handdown: 1, finger: 1, fingerback: 1, grass: 1, grassback: 1 };
const __BANNED_EXPR   = { "smug-eye": 1, "x-eyes": 1, "black-face": 1 };
__IDLE_FACES = ["blush", "teeth"];   // 原 ["blush","smug-eye","x-eyes","teeth"]
```

**成对动作必须两边都禁**（举起 / 放下），只禁一边会卡在半空。

**副作用**：`thinking→finger`、`tool→grass`、`done→handup` 全部失效，除 idle 外暂时没有专属动作。

### 7. 眼部与头部的第二轮重写

| 手法 | 目的 |
| --- | --- |
| 死区 7% | 鼠标在中心小块晃时眼球不抽 |
| 头眼分工 `gazeX = gx * (0.9 - |gx| * 0.34)` | 头偏得越多眼珠转得越少，符合真人 |
| saccade 微跳 | 人眼从不平滑，每隔 0.8–2.7 秒极小的跳动，是"活"的关键 |
| 多频头部漂移 | 三个互不成整数比的正弦叠加，永不精确重复，去掉节拍器感 |

```js
const __drift  = sin(t*0.75)*0.55 + sin(t*1.73+1.1)*0.27 + sin(t*0.31+2.4)*0.18;
const __drift2 = sin(t*0.53+0.7)*0.62 + sin(t*1.21+2.9)*0.38;
```

### 8. 跨会话联动（第一条真联动）

挂件原先只反映**当前会话**。现在 `__pinSession` 改了判断：

1. 当前会话在忙 → 跟当前会话
2. 当前会话空闲，但**别的会话**（手机 phone-bridge、另一个窗口）在 `thinking/tool/review/waiting` → 跟着忙
3. 都闲着 → 才回 idle

数据来源就是 `/api/pet/state` 本来就带的 `sessions` 数组（宿主 `index.js:5918` 把当前会话 unshift 到 `[0]`）。**没新开通道、没改宿主。**

### 9. waiting 脸红只持续 4.2 秒

`waiting` 映射到 `blush`，而这个相位经常持续几分钟 —— 实测 856 条探针里 `waiting` 占 254 条，等于长时间发烧脸。改成 4.2 秒后 `resetExpression` 回默认脸。

### 10. 当前渲染终态（锁死）

```
resolution: Math.max(2, devicePixelRatio || 1)
antialias: false
lod: "single-auto"
TEXHIJACK → 4096 原图
minFilter:"linear"  magFilter:"linear"  mipmapFilter:"none"  anisotropicLevel:16
canvas.style.filter = "url(#dsh-sharpen)"   // feConvolveMatrix 2.36
取景：__UPPER = 0.33  __WIDE = 0.62  公式 Math.max(...)
```

### 备份表

`client.js.bak-texhijack-*`、`.bak-nomip-*`、`.bak-gaze2-*`、`.bak-head2-*`、`.bak-others-*`、`.bak-waitface-*`、`.bak-pitch-*`、`.bak-res2-*`、`.bak-ban-*`、`.bak-lookat-*`

---

## 十三、动作衔接、手机联动、小动作（2026-11-01 傍晚）

### 13.1 点头曲线改柔

原曲线 `[[0,0],[0.12,-1],[0.32,0.42],[0.7,0],[0.9,0]]` 里那个 `+0.42` 的回弹过冲，是"硬"的来源 —— 头点下去弹回来，弹得比落点还高，像被敲了一下。

改成 `[[0,0],[0.1,-1],[0.26,0.16],[0.52,0],[0.78,0]]`：过冲削到三分之一，总时长 0.9s → 0.78s。

### 13.2 相位切换的"转身"过渡

`__gazeLife.phaseAt = Date.now()` 记录切换时刻，跟随速度按相位年龄分段：

```js
const __phaseAge = (Date.now() - (__gazeLife.phaseAt || 0)) / 1000;
const tau = key === "blink" ? 0.035
          : tapAge <= 0.78    ? 0.055
          : __phaseAge < 0.55 ? 0.45    // 刚切换的 0.55 秒内慢一点，给一个转身的感觉
          : 0.22;
```

### 13.3 接上手机桥接（Remote Connect DSH）

`D:\document\Remote Connect DSH\phone-bridge\server.mjs` 加了 `access-control-allow-origin: *`（只加响应头，零逻辑改动），让 `dsh-app://app` 页面能读 `http://127.0.0.1:8899/api/health`。

挂件侧每 8 秒轮询一次，读四个字段：

| 字段 | 判断 |
|---|---|
| `busy` | 手机那边正在跑任务 |
| `queued` | 排队几个 |
| `link.running` | 内网穿透隧道（**没用来做提示**，见下） |
| `todos.stats.open` | 还有几条待办 |

判定加在 `__pinSession` 里，顺序是：当前会话 → 手机忙/排队 → 其他会话忙 → idle。
手机那头在忙或有排队时，她切 `thinking`，气泡写「手机那头还排着 N 个」。

**撤掉的功能**：本来想「`link.running === false` 就提示手机连不上」，写完即删 —— 在家用局域网直连手机时压根不开隧道，会一直误报。误报比不报还烦人。

### 13.4 三个不动手的小动作

手不能动（主人禁了举手/狗尾草）的前提下，只能靠头、颈、肩、眼珠做戏。三样，全是参数临时偏移，**不碰任何 `.motion3.json`**：

| 动作 | 偏移 | 时长 |
|---|---|---|
| 歪头 | `roll +3.2°` `yaw +1.8°` | 2.4s |
| 深呼吸 | `body +1.1°` `pitch -0.8°` | 2.8s |
| 瞥一眼 | `gazeX +0.5` `yaw +2.4°` `roll -1.2°` | 1.9s |

包络用 `Math.sin(Math.PI * __gt)`：0 → 1 → 0，两端都平滑收敛。触发间隔 11–25 秒随机，走神（`__away`）时不叠加。

### 13.5 备份表（本轮）

`client.js.bak-smooth-*`（点头曲线 + 相位缓动）、`.bak-phone-*`（手机联动）、`.bak-link-*`（撤掉的断线提示）、`.bak-gesture-*`（小动作）、`server.mjs.bak-cors-*`（手机桥接 CORS）


## 十四、点击反应（2026-11-01 晚）

### 14.1 只认点在她身上

原来：

```js
const onDown = () => { __gazeLife.tapAt = Date.now(); };
```

挂在 **`window`** 上——点侧边栏、点输入框、点任何地方她都在点头。现在先判坐标：

```js
const onDown = (ev) => {
    try {
        const __rc = pixiApp.canvas.getBoundingClientRect();
        if (ev.clientX < __rc.left || ev.clientX > __rc.right) return;
        if (ev.clientY < __rc.top || ev.clientY > __rc.bottom) return;
    } catch (e) { return; }
    __gazeLife.tapAt = Date.now();
    __gazeLife.petAt = Date.now();
    __gazeLife.lastMove = Date.now();
    __blinkStart = -1;
    __nextBlink = 0;
};
```

顺带四件：把她从走神里拉回来（`lastMove` 复位）、立刻眨眼、按部位歪头、1.3 秒自然收回。

### 14.2 按部位分三档

| 点哪儿 | 判定 | 反应 |
|---|---|---|
| 头 | `fy < 0.34` | `pitch -3.2 / roll +4.6 / squint 0.62`（眯眼） |
| 脸 | `fy < 0.66` | `roll +6.4 / yaw +3.2 / pitch -1.4`（扭脸） |
| 身体 | 其余 | `body +4.2 / pitch +2.4 / yaw +3.6`（一缩） |

2.5 秒内连点累加，封顶 4 档，力度 `1 + (n-1) × 0.32`。

### 14.3 squint 通道与 NaN 事故

摸头要眯眼，于是加了 `target.squint`，混进眼睛闭合计算：

```js
const __closed = Math.max(st.blink, st.blinkVal, st.squint || 0);
```

**踩的坑**：`mv` 状态对象里没加 `squint`，而缓动循环是

```js
for (const key of Object.keys(target)) mv[key] += (target[key] - mv[key]) * k;
```

`undefined` 参与运算得 **NaN**，`Math.max(..., NaN)` 还是 NaN，最后 `ParamEyeLOpen = NaN`——**眼睛直接消失**。

**规律：往参数表加任何新字段，`target` / `mv` / `__pending` 三处必须同时加，漏一处就是 NaN。**

### 14.4 台词换成自己的

接口照调（好感度要涨），但显示的句子用自己的池：

- 连点 ≥3：「够了够了」「再点我咬你」「上瘾了是吧」「手拿开啦」
- 摸头：「唔……头发要乱了」「别揉，刚理好的」「……就一下啊」「痒」
- 戳身体：「喂——」「戳哪儿呢」「别闹」「裙子要掉了」
- 戳脸：「看什么看」「脸要被你戳穿了」「手拿开啦」「……哼」

只有冷却期（`j.delta === 0`，10 秒内重复点）才回落到宿主原话。

### 14.5 顺手修的：歪头的真凶

「她的头老是往我右边侧」——查了 `idle.motion3.json` 的 21 条曲线，**里面根本没有 `ParamAngleZ`**。真凶是 tick 里写死的：

```js
roll: (thinking ? -7 + __drift2 * 0.9 : ...)   // -7 × 3.6 = -25°
yaw: thinking ? 4 + __drift2 * 0.9             // 4 × 6.5 = 26°
```

我一天到晚在跑工具 → 她几乎永远 thinking → 永远歪着、永远侧着。改成 `-1.6` / `2.2`，幅度只剩 6° / 14°。

**这也是「点击没反应」的真凶**：摸头只有 8.6° 偏移，叠在 25° 的歪头上，肉眼看不出。

### 14.6 再修一次狗尾草

「狗尾巴草又出现了」——`grass` 把 `Movement1` 从 0 拉到 1（长出草），播完本该 `grassback` 拉回 0，但 `grassback` 已被 `__BANNED_GROUPS` 拦掉，回退到 `idle`，而 `idle` 没有 `Movement1` 曲线 → **参数永久停在 1**。

**禁动作只挡「开始」，管不了「停在哪」。** 修法是在 `applyParams` 里常驻写死三个开关：

```js
put("Movement1", 0);   // 狗尾草
put("Movement2", 0);   // 手臂
put("Movement3", 0);   // 竖食指
```

### 14.7 备份表

| 备份文件 | 对应改动 |
|---|---|
| `client.js.bak-petreaction-*` | 只认点中画布 |
| `client.js.bak-touchzone-*` | 三档部位 |
| `client.js.bak-squint-*` | squint 通道 + NaN 修复 |
| `client.js.bak-touchline-*` | 自己的台词池 |
| `client.js.bak-unwarp-*` | 歪头真凶 |
| `client.js.bak-noprop-*` | 三个 Movement 常驻压零 |

---

## 十五、点击链路排查（2026-11-01 晚）

### 15.1 症状

点她没反应。探针一直 `pet=0:-`。

### 15.2 五层诊断，一层层往下剥

探针里加了这些字段，从外往里：

| 字段 | 含义 |
|---|---|
| `dbg=<p>/<m>` | capture 阶段独立监听收到的 pointerdown / mousedown 次数 |
| `bind=` | 执行到 `addEventListener("mousedown", onDown)` 那行的次数 |
| `ot=` | 那一刻 `typeof onDown` |
| `bub=` | bubble 阶段独立监听到的 mousedown 次数 |
| `call=` | `onDown` 真正被调用的次数 |
| `rejX=` `rejY=` `rejC=` | 被横向判定 / 纵向判定 / try-catch 挡回的次数 |
| `rc=` | 那一刻拿到的 canvas 屏幕矩形 |
| `ev=` | 实际点击坐标 |

### 15.3 结论一：事件到了，是坐标不对

```
dbg=63/13  call=2  rejX=2  rejY=0  rejC=0
rc=1457,578,1919,1078   ev=593,955
```

画布在 `(1457,578)-(1919,1078)`（右下角 462×500），而点击落在 `(593,955)`（屏幕左下）。
`rejX` 涨了两次 = 两次都因为 `ev.x < rc.left` 被挡回。
**机制本身没问题**：`bind=1`、`ot=function`、`call=2` 都说明绑定和执行都是好的。

### 15.4 结论二：冒泡链上有 stopPropagation

```
dbg=13   （capture 看到 13 次）
bub=2    （bubble 只看到 2 次）
```

十一次事件在半路被吃了。真正点在画布上的那几次很可能就在被吃掉的里面。

**修法**：`onDown` 挪到捕获阶段。

```js
window.addEventListener("mousedown", onDown, { passive: true, capture: true });
```

捕获从 window 往下走，中途任何 `stopPropagation` 都拦不住。

### 15.5 教训

**"没反应"要先分清是哪一层没反应。** 这次一口气加了五个计数器，一次读日志就把「没绑上」「被拦了」「坐标不对」三种可能分开了 —— 比猜快得多。

`node --check` 只查语法，查不出 TDZ 和"绑定被清理"。真要确认运行期行为，只能靠这种埋点回传。
