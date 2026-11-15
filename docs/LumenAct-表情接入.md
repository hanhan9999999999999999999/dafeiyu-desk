# LumenAct 表情接入

把 [LumenAct](https://github.com/AaBb-coder/LumenAct) 的动捕表演数据接进「大肥鱼」，
让她的表情不再从固定几档里挑，而是由**她说的话**决定演哪一段。

---

## 一句话说清做了什么

LumenAct 有一套 97 段人工标注的表演曲线（原本驱动 VRM 模型 166 条 blendshape 轨道）。
把它映射成本模型真能动的 23 个参数之后，接到 `say()` 上：她说「气死我了」，
脸就换成生气；说「好困」，眼睛就半阖下去。

---

## 为什么不整套搬 LumenAct

| LumenAct 的部件 | 结论 | 理由 |
|---|---|---|
| `models/semantic/selector.onnx`（153 MB） | **不用** | 输入一句话、输出一个情绪标签。而 DSH 那边的对话模型本来就知道自己是什么情绪，把台词直接拿来选段更准，也不用往 Electron 里塞 onnxruntime |
| `preview/curve-player.js` | **不用，思路借鉴** | 它做的是「按帧读 f32 → 0.4 秒 smoothstep 交叉淡化 → 写形态键」。本项目已有 `lib/curve.js`（Catmull-Rom）和 `__act` 淡化层，比按帧读整段更省内存 |
| `models/expression/catalog.json` + `curves.f32` | **用** | 这是全部价值所在：97 段动捕曲线。13.5 MB 的 f32 被我抽稀成 388 KB 的关键帧 |
| 166 条 blendshape 通道 | **只用 23 条** | 本模型没有 `mouth_a`/`eye_zitome`/`eyebrow_shy` 这些参数，得先映射 |

---

## 数据链路

```
catalog.json + curves.f32          原始：20325 帧 × 166 通道，f32 小端
        │
        ├─ ① 减 neutral（第 77 段第 0 帧）
        │     必须差分。neutral 自身带大量非零基线：vrc.eye_up=100、sp_ear_elf=100、
        │     eyebrow_angry_L=35.3、mouth_upperteeth_down=23.8。直接搬会把脸搬歪。
        │
        ├─ ② 166 → 23 个参数映射（见下方映射表）
        │     例：ParamMouthForm = mouth_smile×0.85 − mouth_angry×0.75 − mouth_M×0.0065
        │
        ├─ ③ RDP 抽稀，容差按参数量纲分设
        │     头部角度用 0.30（度数区间），表情参数用 0.010~0.014
        │     超过 360 帧的长段降采样到 15fps
        │
        └─ ④ 输出 window.FishExprCurves（_expr/expr-curves.js，388 KB，97 段）
               │
               └─ renderer.js  playExprStyle(id)
                      → launchMotion("lumen-"+id, curves, dur)
                      → __act 层（和手写动作同一个播放器、同一套交叉淡化）
```

**构建脚本**：`_expr/build-curves.cjs`（需要 `_ref/LumenAct/hf/` 下的 catalog.json 与 curves.f32）
**误差验证**：`_expr/verify-curves.cjs` → `_expr/误差验证.md`

---

## 参数映射表（166 → 23）

| 本模型参数 | 来源 | 说明 |
|---|---|---|
| `ParamAngleX/Y/Z` | Head Turn / Nod / Tilt | 弧度 → 度数 ×40/40/30，另乘 `mix 0.55`（见下） |
| `ParamEyeBallX` | −Left Eye In-Out | 左右为镜像，取一边并取反 |
| `ParamEyeBallY` | Left Eye Down-Up | |
| `ParamEyeLOpen/ROpen` | `1 − max(eye_close, eye_wink_1, eye_zitome×0.6, eye_wink_2×0.9)` | 眨眼与眯眼的合成 |
| `EyeSmile` | `eye_smile + eye_wink_1×0.25` | |
| `ParamMouthForm` | 笑 − 怒 − 抿嘴 | 正笑脸、负脸撇嘴 |
| `ParamMouthOpenY` | `mouth_a + a_2×0.8 + o×0.9 + vrc.v_aa×0.8 + wa×0.7` | |
| `Mouthpucker` | `mouth_kiss + mouth_circle×0.6` | |
| `CheeckPuff` | `mouth_cheek_inflate` | |
| `ParamBrowLY/RY` | `up + smile×0.5 − down×1.15 − serious×0.8` | |
| `ParamBrowLAngle/RAngle` | `angry×0.7 − worry×0.8` | |
| `BrowInnerUp` `ShockL/R` `RCry/LCry` `Angry` `PupilX` | 同名 blendshape | |

**为什么头部只有 0.55**：LumenAct 的头动是按它自己那个参考角色的松紧度标的，
整份搬过来会显得「头甩得比身体快」。0.55 是留一半给项目自己的呼吸和待机摆动，
两套动作叠在一起才不打架。这个值在 `_expr/build-curves.cjs` 的 `mixedParams` 里。

**流式验证的坑**：`eye_near`、`vrc.eye_up`、`sp_ear_elf` 这类在 neutral 里恒为常数，
差分后全 0——它们不是「没用」，是这次表演没用到。

---

## 播放层：为什么必须合成、不能覆盖

`__act` 原本是**绝对覆盖**：w=1 时 `v = nw`，把参数整份写成曲线值。
手写动作（nod、nuzzle、stretch）能这么干，因为它们本来就是一整段戏；
但 LumenAct 的段是「一张脸」，如果整份覆盖，会出现三件事：

- 表演 5 秒里**她不眨眼**（`ParamEyeLOpen` 被曲线锁死）
- 说话时**嘴不动**（`ParamMouthOpenY` 被曲线锁死）
- 身体**僵住**（`ParamAngleX` 被曲线锁死，呼吸和待机摆动全被冲掉）

所以加了 `ACT_MERGE`（`renderer.js`）：

| 模式 | 参数 | 合成方式 |
|---|---|---|
| `"+"` | 角度、视线（`ParamAngle*`、`ParamBodyAngle*`、`ParamEyeBall*`、`Pupil*`） | `base + nw × 权重`，淡出自然回 base |
| `"min"` | 眼睑（`ParamEyeLOpen/ROpen`） | 谁更闭听谁的 → 眨眼照常生效 |
| `"max"` | 张嘴（`ParamMouthOpenY`、`JawOpen`） | 说话优先 |
| 默认 | 表情骨架（EyeSmile、MouthForm、眉、Shock、CheeckPuff…） | 整份接管 |

---

## 台词 → 段：怎么选

`pickStyleByText(text)`：27 组同义词 → LumenAct 的 28 个标签 → 打分取最高。

```
得分 = 词长 × min(出现次数, 3) × (1 + 靠前程度)
```

词长优先，所以「不好意思」压得过「好」。几个实测：

| 台词 | 路由 |
|---|---|
| 被夸得有点不好意思 | 害羞 #54 → 有时 #91「被夸后嘴硬害羞」 |
| 气死我了，居然这样 | 生气愤怒 |
| 好困啊，眼睛都睁不开了 | 睡眼朦胧敷衍 #58 |
| 哇！这也太惊喜了吧 | 大眼微笑 #46 |
| 算了算了，我认错 | 道歉抱歉 #44 |

**三个门槛，都是为了「别让她脸一直抖」**：

1. `score ≥ 4` — 只蹭到一个单字（「好」「行」）不换脸
2. 同一情绪 5 秒内不重播（按 label 判重，不按段 id——一个标签下有好几段，随机挑到另一段不代表情绪变了）
3. 正在播交互动作（摸头、喂食）时不抢——那些是她对主人的即时反应，比台词的情绪更该被看见

**标签名会错配**：`byLabel` 的真实键是「开心欢快」「大眼微笑」「睡眼朦胧敷衍」，
而 catalog 的 `labels` 数组写的是「开心欣慰」「大眼睛微笑」「睁不开眼疲惫困倦」。
写错就静默查不到，那句话永远路由不到这个情绪。`resolveLabel()` 按共同字符数兜底。

---

## 对外接口（`window.FishModel`）

```js
FishModel.expr("54")                    // 按段号播
FishModel.exprText("有点不好意思")        // 按句子挑段播
FishModel.exprList()                    // 97 段清单（id/label/sub/emotion/env/pace/dur）
FishModel.exprCur()                     // 现在演的是哪一段
FishModel.exprLocked()                  // 是否在表演独占期
FishModel.exprStop()                    // 立刻收表演、回中性
```

`expr(id, {maxSec, holdMs})`：
- `maxSec`（默认 9）— 超长段截断。neutral 那段有 52 秒，整段播完像卡住。
  硬裁不会让脸停在半空，`__act` 的淡出兜底会平滑送回 base。
- `holdMs` — 独占期长度，默认 `dur×1000 + 700`。

**表演独占期**：播段时设 `__exprLockUntil`，期间 `actionFor("idle"/"idleSoft")`
直接返回 `{ok:false, why:"expr-lock"}`。不加这个，主进程每几秒轮换一次的待机动作
会把演到一半的段顶掉（看着像「她演两秒就走神」）。用户交互场景不拦。

---

## 改的时候注意

**加情绪词**：改 `renderer.js` 的 `EXPR_WORDS`。左边第一项必须是 `byLabel` 的真实键，
不确定就先跑：

```bash
node -e "const w={};global.window=w;require('./src/expr-curves.js');console.log(Object.keys(w.FishExprCurves.byLabel).join('\n'))"
```

**重新生成曲线库**：改 `_expr/build-curves.cjs` 的 `TARGETS` 后
```bash
node _expr/build-curves.cjs      # 生成 _expr/expr-curves.js
node _expr/verify-curves.cjs     # 逐帧比对，看误差验证.md
cp _expr/expr-curves.js _app/src/expr-curves.js
```

**参数活性**：本模型 509 个参数里，美术真正接到 ArtMesh 上的没那么多。
实测确认**动了没反应**的：`EyeSmile`、`ParamBrowRY`、`ParamBrowRAngle`、`Mouthpucker`、
`ShockL`、`Angry`、`ParamI`、`TongueOut`、`Emotion`、`IDLE`、`key4`、`SweatBurst1`。
这些参数在曲线里给了值也不会显示——**不是转换错了，是模型没接**。
换模型后要用 `_app/_tmp/probe-params.js` 重新测一遍再调映射表。

---

## 这轮顺手修的真 bug

**`lerpAt` 参数顺序反了**（三处）。签名是 `curve(t, pts)`，调用写成 `lerpAt(pts, t)`，
`curve` 第一个形参拿到数组、第二个拿到数字，首行 `typeof pts.length !== "number"` 直接
`return 0` —— **所有手写动作的曲线值恒为 0**，动作一直是靠「把参数往 0 拉」在撑。

- `renderer.js:1131` `want[id] = Math.round(lerpAt(t, pts)*1000)/1000`
- `renderer.js:1453` `prevWants.set(id, lerpAt(ptc, pts))`
- `renderer.js:1463` `nw = lerpAt(t, pts)`

修之前 82 个动作全部「看起来在动、实际没演」；修之后 `_act().want` 才第一次吐出真值。

**备份**：`D:\备份\20261115-122110-lumenact接入\`

---

## 第二版：六步排期做完之后（2026-11-15 下午）

上面那份是「第一版接入」的记录。之后按六步排期又做了一轮，现在的能力如下。

### 1. 多模型适配（不再绑死「大肥鱼」）

`src/packs/semantics.js` 的 `PARAM_SLOTS` 从 12 个扩到 **26 个**，其中 14 个是表情槽
（`eyeSmile / browLY / browRY / browLAngle / browRAngle / browInnerUp / shockL / shockR /
cryL / cryR / angry / pupilX / mouthPucker / cheekPuff`）。每个槽有 `canon` 和一串 `alts`，
外接模型的参数名对上任意一个就能用。

曲线库的键也从「参数名」改成了**槽位 id**（`fish.exprcurves.v2`），播放时用
`resolveExprSlot()` 现场翻译：先看适配器里手动绑的 `PACK.params[slot]`，再试 `canon`，
再试 `alts`，都没有就跳过。所以换模型不用重新生成那 386 KB 的曲线库。

`FishModel.exprSlots()` 报这个模型能演多少，**按权重算而不是按个数**：

| 模型形态 | 表情能力 |
|---|---|
| 大肥鱼（全标准名） | 100%（23/23 直连） |
| 老模型改名（`AngleX`、`EyeOpenL`、`MouthOpen`…） | 88% |
| 标准 Cubism 3/4 最小集 | 65% |
| 只有头眼嘴 | 56% |

权重按「这个参数对读情绪有多重要」定：眼睑 3、嘴型 2.5、歪头 2、角度 1.5、眉毛 1.2、
嘴张开 1、鼓脸/撇嘴 0.6、泪 0.5。按个数平均会把只有眼睑+嘴型的模型算成 42%，
可那种模型照样能演害羞和生气，报 42% 只会把人吓跑。

适配器页（`adapter.html`）也接上了：体检面板里有「表情能力 N%」+ 直连/降级/缺的明细
+ 一个「试演」按钮（播害羞段），CANON 表补了 14 个表情标准名。

### 2. 情绪对齐（语气当先验）

`say(t, mood)` 的 `mood` 以前完全没用上。现在 28 个标签各有一个四维坐标
`[效价, 唤醒, 社交, 支配]`，语气也是四维；文本给出了标签、语气也给了方向时，
按 7:3 混一下再取最近邻，只有距离 > 0.45 才改判 —— 说「有点担心明天的事」配 `happy`，
不会被语气带跑成开心。

`role: "relay"` 时把效价与支配取反：转述别人的话时不该跟着一起高兴。

同类情绪还加了距离防抖：12 秒内换到同一片情绪区就不重演，不然微笑→大眼微笑→开心欢快
会来回切，看着像脸在抖。

### 3. key 贴片（这只模型特有的加分项）

509 个参数里一大半美术没接 ArtMesh。但 `key1~key13` 那 13 个整张贴图开关是活的，
而且比参数强得多：`key7` 脸红、`key4` 爱心眼、`key2` 落泪、`key3` 蚊香眼、`key5` >< 笑眼、
`key6` 屑屑眼、`key1` 黑脸、`key9` 张嘴。

所以给 13 个情绪配了贴片（`EXPR_KEY_PATCH`），用山形包络叠在参数表演之上。黑脸只闪
1.1 秒，因为它会把整张脸盖成剪影。别的模型没这些参数时 `findIdx < 0` 自动跳过，
不会写死。`TUNE.exprPatch = false` 可以整个关掉。

### 4. 双轨混音（表情和动作不再互斥）

`__act` 拆成两条轨：`__act`（body，动作）和 `__exprTrack`（expr，表情）。按参数域分工：

- `EXPR_DOMAIN`：眼睑、眉、嘴型、泪、鼓脸 —— 只有表情轨能写
- `BODY_DOMAIN`：`ParamBodyAngle*`、手部 `Param36/39/41…`、`Movement1/2/3` —— 只有动作轨能写
- 其余（`ParamAngle*`、`ParamEyeBall*`）算共享，靠 `ACT_MERGE` 叠增量

效果是摸头的时候脸上还能挂着害羞。以前两者抢同一条通道，谁后播谁赢：摸头时表情断，
演表情时手不动。`exprStop()` 现在也只停表情轨，不会顺手掐掉正在播的摸头。

### 5. 情绪编排（一句话里的多个转折）

`say()` 一次给一整句话，以前只演分最高的那一个标签。现在切成小句各自打分、
相邻同情绪合并、最多 4 段，排成播放表依次演：

```
"哇真的假的，气死我了，好难过啊，谢谢你"
  → 惊讶震惊 #9 → 生气愤怒 #62 → 难过流泪 #27 → 欣慰宽慰 #53
```

`FishModel.exprSeq(text)` 只算不播，可以先看一句话会被演成几张脸；
`exprText(text, {seq:false})` 是只演一段的逃生门。

### 6. 段挑选不再纯随机

同一个标签下常有好几段（微笑 7 段、惊讶 9 段、生气 4 段）。现在先按这一段的
`subcategory` / `environment` 跟这句话重了几个字排队，都不重合才随机。
说「被夸」就挑「被夸后嘴硬害羞」，而不是一半概率演成普通害羞。

时长也按 `pace` 定了：说「快/突然」的给 5 秒，「慢/从容」的给 12 秒，
`subcategory` 里有「倾听/等待/休息」的给 20 秒（那类本来就要撑很久），其余 9 秒。
没有这条时，44 秒的「友善倾听」会被按 9 秒统一裁短，44 秒的段和 2 秒的段一个待遇。

---

## 仍然没做的

- **LumenAct 的 10 条 muscle 通道**：`Neck*` 三条恒为 0 是死通道；头部三条已映射进
  `ParamAngle*`，眼球两条已映射进 `ParamEyeBall*`，剩下没有可用的。
- **共享参数的能量分配**：`ParamAngle*` 两轨都会写，现在是直接叠加。极端情况下
  （动作甩头 + 表情歪头同向）能到 50 度左右，还没做限幅。

- **语义模型没接**：见上表。如果以后要「不看台词、只看情境挑情绪」，再考虑接 onnx。

---

## 附带修好的：自带桥接为什么起不来

（2026-11-15 补）

**症状**：设置里点「启动」自带桥接，8898 起来了，health 也回 200，但一发消息就
`initialize 超时`；看屏幕报「dsh 常驻进程退出（code=1）」。

**根因**：`bridge/mini-bridge.mjs:36` 按「最省资源的先试」挑 profile：

```js
const want = ['phone-sdk', 'phone-lite', 'headless', 'desktop', 'web'];
```

它要的是**长驻 + stdin JSON-RPC** 的 profile，也就是挂了 `@deepseek-ai/dsh-sdk-app` 的那个。
但这台机器的 `D:\dsh-home\profiles` 里只有 `desktop / phone / phone-lite`，于是退到 phone-lite
—— 而 phone-lite 是一次性 headless app（`Answer one task and exit`），不应答 `initialize`，必然超时。

**修法**：新建 `D:\dsh-home\profiles\phone-sdk\`，三份文件：

```
package.json      bundles = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-sdk-app"]
cordis.yml        []
cordis.patch.yml  直接复制 phone-lite 的那份（provider / 凭据 / 权限 / 工具都调好了）
```

两个坑：

- `package.json` **必须无 BOM**。PS 5.1 的 `Set-Content -Encoding UTF8` 会写 BOM，DSH 的
  `JSON.parse` 直接报错。要用 `[System.IO.File]::WriteAllText` 配
  `New-Object System.Text.UTF8Encoding $false`。
- 只挂 `dsh-sdk-app` 不行，它依赖 dsh-base 的十几个插件，会报「required plugins did not activate」。
  必须两个一起挂。

**验证**：`_tmp/probe-mini.cjs` 走真实 HTTP —— `send 200` → **4 秒** → `assistant: 我在呢`。

**另外**：mini-bridge 有看门狗（每 2 秒 `process.kill(ppid,0)`），从命令行 `Start-Process` 它，
pwsh 一退它跟着退（日志里能看到「父进程 X 已退出，跟着关」）。命令行验证要用 `_tmp/keep-mini.cjs`
这样的保活壳；正式路径是主程序 `miniStart()`，父进程是 Electron，本来就长驻。
