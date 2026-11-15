# 模型适配器 · AI 交接说明

> 给**接手维护这件事的大模型 / 开发者**看的。人看的版本在 `docs/模型适配器-使用说明.md`。
> 这份文档的目标：你读完能直接改代码，不用重新逆向一遍整套设计。

---

## 0. 一句话架构

```
Live2D 模型的真实参数名  ──[compat.js 打分匹配]──►  槽位(slot)  ──[S.cfgs 持久化]──►  动画引擎用槽位演
        ParamHeadAngleX                                   angleX                            摸头/害羞/口型
```

**槽位是契约**。动画、表情、口型全部只认槽位；模型差异全部收敛在「槽位 → 参数名」这张映射表里。
任何新功能都不该直接写 `ParamAngleX`。

---

## 1. 涉及的文件

| 文件 | 职责 | 改它的时机 |
|---|---|---|
| `src/packs/semantics.js` | 槽位定义（唯一真源）：`PARAM_SLOTS`(26) / `ACTION_SLOTS`(13) / `ACTIVITY_SLOTS`(14) / `ACTION_SLOTS_ALL`(27) / `EXPR_SLOTS`(7) / `EXPR_PARAM_SLOTS`(14) / `PERF_PARAM_SLOTS`(23)；必需项 `REQUIRED_PARAMS`(angleX/angleZ/eyeLOpen/eyeROpen/mouthOpen) / `REQUIRED_ACTIONS`(idle,sleep,thinking,done,failed) / `REQUIRED_EXPRS`(default) | 要加新槽位、改必需项时 |
| `src/packs/compat.js` | 匹配打分（纯函数，可在 Node 里 require）：`ALIAS` / `SPEC` / `PAIRS` / `PROXY` / `scoreSlot` / `resolve` / `levelOf` / `summarize` | 匹配错、误判、要支持新的命名风格时 |
| `src/packs/probe.js` | 探测模型文件 → 产出 `report`（含 `report.compat`、`report.guesses`、`report.matched`） | 改探测流程、加报告字段时 |
| `src/adapter.js` | 适配器窗口逻辑：`renderBadge`(637) 徽章、`renderCompat`(673) 兼容性卡、`CANON`(779) 宽松名映射、`paramMapNow`(803) 出映射、`cfgOf`(1152)、`save`(1525) | 改 UI 交互时 |
| `src/adapter.html` | 窗口 DOM + CSS（含 `.compat` 兼容性卡、`.howto` 三步上手折叠块） | 改外观时 |
| `src/expr-curves.js` | 表情曲线，键是**槽位 id**（`angleX`/`eyeSmile`），播放前按绑定翻译 | 加表情动作时 |
| `src/motions.js` / `motions-extra.js` | 动作曲线，同样以槽位为键 | 加动作时 |
| `scripts/test-compat.js` | 匹配层的回归（27 断言，五组敌对模型） | **改 compat.js 必须跑** |

---

## 2. 数据契约

### 2.1 `report.compat`（probe 产出，adapter 消费）

```js
{
  score: 0..100,
  quality: "full" | "good" | "ok" | "basic",
  level:   "full" | "good" | "ok" | "basic",   // 与 quality 同义，UI 用这个
  levelText: "完全兼容" | "基本兼容" | "能用，但会少一些细节" | "只保证基础动作",
  lines: string[],          // 人话说明，直接铺在卡片里
  missing: string[],        // 缺的槽位 id
  proxied: [{slot, via, kind}],  // 用替身补上的
  sideShared: string[],     // 左右共用一个参数的槽位（单眼/单眉模型）
  exprMissing: string[],    // 对不上的表情
}
```

`report.guesses.params` / `report.guesses.expressions` 是**槽位 → 真实名**的映射表，
`report.matched.params` 是对应的人类可读匹配依据。`compat` 为 `null` 表示兼容层抛错，
此时 probe 会退回旧的 `canon → fuzzyParam/fuzzyExpr` 路径，并把原因写进 `report.warnings`。
**这条兜底路径必须一直留着** —— 匹配层的一个 bug 不该让整个适配器打不开。

### 2.2 持久化

- 每个规则（rule）一份配置：`S.cfgs[ruleId]`，例如 `S.cfgs["core-params"]`、`S.cfgs["actions"]`、`S.cfgs["expressions"]`。
- `paramMapNow()` 用 `S.cfgs["core-params"]` 与 `CANON` 拼出当前生效的映射。
- 模型包本体在用户目录 `packs/`（导入即复制，不动原文件）。

---

## 3. 匹配算法（`compat.js`）

打分制，不是「第一个能塞进去的就算」：

```
scoreSlot(slotId, paramIds):
  标准名命中        +1000
  别名命中（ALIAS）  +940
  关键词命中          +600 + 20*命中组数      // SPEC[slot].must 是「同义词组数组」，每组至少命中一个词
  侧别不符（l 槽拿到 r 参数）  -320
  该槽没有侧别却给了带侧别的参数 -60
  deny 词每个        -260                    // 例：angleX 的 deny 含 body/arm/leg/breath
  token 数 > 3 每个  -25                     // 太长的参数名更像别的东西
PASS = 420
```

**deny 是这套算法的关键。** 历史 bug：`ParamBodyAngleX` 能满足 angleX 的 `["angle","x"]`，
模型里参数顺序一变，身体角度就被认成转头，人看着像脖子折了。`SPEC.angleX.deny` 里列了
`body/arm/leg/hand/breath/eye/mouth/brow`，把这类误判压到 PASS 以下。

**`PAIRS` 与单侧模型**：`eyeLOpen/eyeROpen`、`browLY/browRY`、`browLAngle/browRAngle`、
`shockL/shockR`、`cryL/cryR`。如果模型只有一个 `ParamEyeOpen`，两个槽会指到同一个参数，
这时**两个槽都要 push 进 `sideShared`**（以前只标了一个，UI 上看着像半边没绑上）。

**`PROXY` 替身**（缺槽时的降级，必须在 `proxied` 里如实上报，不能假装是原生）：

| 缺的槽 | 用谁 | kind | 语义 |
|---|---|---|---|
| `eyeSmile` | `eyeLOpen` / `eyeROpen` | `squint` | 睁眼压到 0.45 倍，近似弯眼 |
| `mouthForm` | `mouthPucker` | `invert` | 取反，抿嘴当微笑的替代 |
| `browInnerUp` / `angry` | `browLAngle` / `browRAngle` | `share` | 直接共用 |

---

## 4. 加一个槽位要改哪几处（清单）

1. `src/packs/semantics.js`：在 `PARAM_SLOTS` 加定义 `{id, label, canon, alts, range, unit, group, hint}`。
2. `src/packs/compat.js`：
   - `ALIAS[slot]` 加常见别名；
   - `SPEC[slot] = {must:[[同义词组…],…], side?, deny:[…]}`；
   - 若与别的槽成对，加进 `PAIRS`；
   - 若有合理替身，加进 `PROXY`。
3. `src/expr-curves.js` 或 `src/motions.js`：给这个槽加曲线（键就是槽位 id）。
4. `src/adapter.js`：`CANON_LABEL[slot] = "中文名"`（兼容性卡与人话提示要用）。
5. `scripts/test-compat.js`：加一条断言（至少验证「敌对参数名不抢这个槽」）。
6. 跑：`node scripts/test-compat.js`、`node scripts/test-packs.js`、`node scripts/verify-src.js`。

---

## 5. 不变量（改代码时不许破坏）

1. **槽位是唯一契约**：业务代码不出现 `Param*` 字面量（`CANON`/`ALIAS` 这类映射表除外）。
2. **缺就是缺**：匹配不到就留空，不许为了「全绿」硬塞。硬塞的后果是动作抽筋，比缺槽难查得多。
3. **替身要标出来**：`proxied` 必须如实上报，UI 上写清「槽位 ← via」。
4. **`report.compat === null` 时必须有兜底**：退回旧的 canon/fuzzy 路径。
5. **纯函数层不许 require Electron**：`compat.js` 要能在 Node 里直接跑单测。
6. **大小写/分隔符差异一律靠 `norm()`/`tokens()` 消化**，不要在调用处写特例。

---

## 6. 调试套路

```bash
# 单个模型为什么没绑上某个槽
node -e "const c=require('./src/packs/compat.js');console.log(c.scoreSlot('angleX',['ParamBodyAngleX','ParamAngleX','ParamHeadAngleY']))"

# 完整匹配结果
node -e "const c=require('./src/packs/compat.js');console.log(JSON.stringify(c.resolve({paramIds:['ParamAngleX','ParamEyeLOpen','ParamEyeROpen','ParamMouthOpenY','ParamBodyAngleZ'],exprNames:['exp_01']}),null,2))"

# 回归
node scripts/test-compat.js && node scripts/test-packs.js && node scripts/verify-src.js
```

界面上的「兼容性」卡就是 `renderCompat(report)` 直接铺出来的 ——
**先看卡上写的「缺」和「替身」，再看 `report.guesses.params` 的具体映射**，多数问题在这两步就能定位。

---

## 7. 别做的事

- 别把匹配逻辑复制第二份到渲染层（曾经有过，两处判定不一致，修一次漏一次）。
- 别用「参数下标 / 出现顺序」当依据（不同模型导出顺序不同，稳定性为零）。
- 别在 UI 上把 `basic` 说成「兼容」——用户会以为能用，然后在动作出错时以为是别的 bug。
- 别把模型文件打进安装包分发（版权）。
