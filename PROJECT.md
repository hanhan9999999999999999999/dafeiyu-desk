# PROJECT.md · DSH Live2D（dafeiyu-desk）

> 契约文件。最后更新 2026-11-14。

## 这是什么

Electron 桌面 Live2D 伴侣 `dafeiyu-desk` v1.3.0（`main: src/main.js`，`type: commonjs`），
打包成 NSIS 安装包；带 RVC 变声与本地语音（`feiyu-voice`、`_rvc`、`_rvc2`）。
1.3.0 新增静音/音量、八级关系与相处档案、10 枚徽章、托盘快捷投喂与暂停动效；
窗口隐藏/最小化/锁屏/休眠统一走暂停来源集合，主窗与状态面板用主进程令牌避免重复结算。

## 启动 / 构建

```powershell
cd 'D:\document\DSH Live2D\_app'
npm.cmd start          # runtime\electron.exe .   （开发直接跑）
npm.cmd run build      # electron-builder --win --x64 → dist\
npm.cmd run verify     # verify:src + verify:packs + verify:pack（打包前后各跑一次）
```

- Electron 版本固定 **35.7.5**，`electronDist: runtime`（不走 npm 下载）。
- asar 打包；`afterPack: scripts/afterpack.js`。
- 产物目录 `dist\`；`extraResources` 会把 `src/`、`rvc/`、`vendor/`、`assets/`、`engine/`、`bridge/` 一起塞进去。

## 布局

| 路径 | 内容 |
| --- | --- |
| `_app\` | **真正的应用工程**（package.json / src / engine / bridge / runtime / model(s) / dist） |
| `DeepSeek Live2D Model\`、`mianfeimodelYUAN\`、`_bak_models\`、`_dl\` | 模型本体与下载/备份 |
| `_rvc\`、`_rvc2\` | RVC 变声运行时 |
| `_publish\`、`_build\` | 发布与构建产物 |
| `ref\`、`_ref\` | 参考资料 |
| `_archive\` | 历史测试与旧产物归档（`_test` 已并入这里） |

## 坑

- `_app\package.json` 里的中文在 GBK 控制台会显示成乱码（文件本身是 UTF-8），不要据此判断文件损坏。
- 打包前必须先跑 `verify`：`afterpack.js` 依赖 `dist` 里的结构，缺 `python\Lib` 或 `vendor` 会在安装包里炸。
- 顶层 `README.md` 是面向使用者的入口；本文件是开发/交接用的契约与坑位说明，两者内容不要互相复制。
- **安装包体积 / 文件数**：`rvc\py\Lib\site-packages` 里会随依赖带进上千个 `test`、`tests` 测试夹具（`onnx/backend/test/data` 一处 5525 个文件）。`extraResources.filter` 里两条都要写——目录级 `!py/Lib/site-packages/**/test`、`!py/Lib/site-packages/**/tests` 和内容级 `…/**/test/**`、`…/**/tests/**`；只写内容级会留下空目录。`verify-pack` 三条红线守着：无 `test`/`tests` 目录、文件数 ≤ 8000、最长相对路径 ≤ 190 字符（深安装目录会撞 MAX_PATH）。
- **`npm run test:install` 会真装真卸**：静默安装 → 冒烟启动 → 对同一目录再覆盖安装一次 → 静默卸载，全程约 4 分钟，会临时写桌面与开始菜单快捷方式（跑完自动删除）。覆盖安装本身要 100 秒左右（1.9 GB 重新解包），别把这段当成卡死；`INSTALL_TIMEOUT_MS` 设的是 600 秒。
- PowerShell 里 `npm` 可能被执行策略挡住（`npm.ps1` 无法加载），用 `npm.cmd`。
- **日志轮转**（`src/log.js`）：`run.log` 每写 256KB 检查一次大小，超 2MB 轮转成 `.1`（轮转前先 `unlink` 旧的 `.1`——Windows 的 `renameSync` 不覆盖已存在目标，不删就会在第二次轮转永久失败）。不要改回「只在首次写时 stat 一次」，那样长跑会把日志涨到几百兆。`scripts/test-log.js` 用 `Module._load` 打桩 `electron` 的 `app.getPath` 来测，已挂进 `npm test`。
- **崩溃兜底**（`src/main.js`）：`uncaughtException` / `unhandledRejection` / `child-process-gone` / `process.on("warning")` / `render-process-gone` / `crashReporter` 六处都要在，`verify-src` 第 6 段 8 条断言守着。`child-process-gone` 里 `reason === "killed"` 是我们自己退出时杀子进程，必须排除，否则退出会刷一堆假崩溃。
- **`verify:ui` 里的窗口断言不要用固定 sleep**：`BrowserWindow.close()` 是异步的（还有淡出），刚跑完安装回归、机器忙的时候 `sleep(260)` 后窗口仍在 `getAllWindows()` 里，会得到 `endCount=4` 这种假失败（本仓库真撞过一次）。用 `scripts/ui/quick-pet-esc.js` 里的 `waitClosed()` 轮询 + 「连续 3 次采样相同」再取值。
- **模型包有「覆盖层」**：用户点过适配器的「保存并应用」之后，`userData\models\<id>\` 里只有 `pet.json`（和 `voice.json`），**模型本体仍在安装目录**（源码版是 `_app\model\`，打包版由用户导入到 `userData\models`）。任何「这个包还完不完整」的判断都必须两处都看——`packs/store.js` 的 `missingModel` 一度只查 `hit.dir`，导致覆盖层必然被误判成「模型文件不存在（只剩配置）」，红色 34 分。现在写成 `hasModel(hit.dir) || hasModel(hit.base)`，`test-packs.js` 13 条 + `verify-src` 第 7 段守着。静态文件回落（`/packs/<id>/...` 的 `pick(dir) || pick(base)`）是同一套逻辑，改一处就要顺手看另一处。
- **模型接口的 404 必须说人话**：`packs/http.js` 里所有「没接住」的分支都走 `notFound(res, url, method, ctx)`，回包里带 `url` / `method` / `hint`，并在 `run.log` 记一行 `[packs] 没有这个接口：<METHOD> <url>`（同一组合只记一次，界面轮询不会刷满）。以前只回 `{"error":"没有这个接口"}`，用户反馈时完全无从定位。适配器端（`adapter.js` 的 `api()`）会把 `hint` 拼在错误信息后面。
- **真机看适配器用 `npm run diag:adapter`**：隔离 `userData` 起 app → 从主窗口走 IPC 打开适配器 → 连那个窗口的 CDP 抓控制台/异常/4xx，5 秒后收工。`--seed-override` 会先铺一份「只有配置没有模型」的覆盖层，专门复现误判场景；`--keep` 留着窗口自己点。适配器是另一个 BrowserWindow，里面的错不会出现在主窗口，静态检查也看不出。
- **在 DSH 里 spawn electron 必须先清 `ELECTRON_RUN_AS_NODE`**：环境里带着 `=1` 时 Electron 会当 Node 跑，然后报 `bad option: --remote-debugging-port` 并立刻退出。`smoke-electron.js` 与 `diag-adapter.js` 都会删 `ELECTRON_RUN_AS_NODE` / `CHROME_CRASHPAD_PIPE_NAME` / `ELECTRON_NO_ATTACH_CONSOLE` 三个变量再 spawn。
- **`npm run soak` 的采样不要复用长连接**：主进程 inspector 那条 WebSocket 空闲约一分钟后就不再回应，复用它采样会让第 61 秒起每次都是「`Runtime.evaluate` 超时」，整轮采样空白、判定 FAIL（看着像产品泄漏，其实是探针坏了）。现在每次采样走 `sampleFrom()` → `evalOnce()`：现查 target、现连、求值、立刻关，失败重试一次；页面 console 的事件连接断了由 `reconnectPageEvents()` 重开。`verify-src` 第 8 段 12 条守着这个形状。另：判定只用 `--warmup`（默认 60 秒）之后的样本，启动加载模型那一下的爬升单列 `bootDelta`，不参与泄漏判定。
- **`verify:ui` / `verify` 的主进程 eval 给 150 秒**：`--main-eval-file`（`quick-pet-esc.js`）自己要开窗、等气泡、截图，正常 20–40 秒；刚构建完安装包、磁盘还在写时 60 秒不够，会得到「主进程 eval 失败：`Runtime.evaluate` 超时」，然后 `verify:ui` 只跑 10 条就退出（本仓库真撞过）。超时在 `smoke-electron.js` 的 `includeCommandLineAPI: true` 那一处，`test-ui.js` 会把失败那一行原样带进断言 detail，别再吞掉。
- **自测窗口绝不能上屏**（2026-11-14 主人投诉：「跑UI测试 老是挡住我看东西」「你告诉我我怎么用电脑？」）：四个脚本（`smoke-electron.js` / `soak.js` / `churn.js` / `diag-adapter.js`）启动子进程时必须设 `FISH_TEST_HIDDEN=1`，`src/main.js` 读到它就把**所有**窗口走 `BW()` 工厂创建，建成 alpha=0 的分层窗口 + `setIgnoreMouseEvents(true, {forward:true})` + `setSkipTaskbar(true)`。三条踩过的死路别再走：①改 `BrowserWindow.prototype.show`/`showInactive`/`focus` 无效（`new BrowserWindow({})` 默认 `show:true` 直接显示，根本不调 `show()`）；②赋值 `electron.BrowserWindow` 无效（只读 getter，赋值被静默忽略，还会让 `__proxied` 自检假通过）；③`show:false` / `hide()` 有效但会让页面变 hidden，Chromium 把 `requestAnimationFrame` 压到 **1fps**，量出来的 fps 是 1，性能断言全是假的。另外光在 `BW()` 里设 opacity 还不够——主窗创建后会执行 `win.setOpacity(s.opacity)` 把透明度改回来，现在写成 `win.setOpacity(TEST_HIDDEN ? 0 : s.opacity)`（两处：主窗创建、`applySettings` 的 opacity 补丁）。新增窗口一律用 `BW({...})`，**不要**再写 `new BrowserWindow(`；`verify-src` 第 9 段 20 条守着这些形状，`npm run probe:hidden` 用 Win32 `GetLayeredWindowAttributes` 实测每个可见窗口的 alpha 必须为 0。
- **源码注释被编码事故伤过，已修但别再犯**（2026-11-14）：`src/renderer.js` 178 行、`src/settings.js` 32 行注释里的汉字曾被批量处理替换成 U+2026（`…`）、标点被替换成 `?`，于是出现 `// 状…?`、`// 扢…有可变状态集中在这里`、`// 参…音频`、`// 拿它…?setParameterValueByIndex` 这类读不懂的残句。**全部落在纯注释行上**，代码与用户可见文案没受影响（用 `node` 全量扫 + 逐行 diff 核过：178 行差异无一落在非注释行）。修法是「按代码事实重写」而不是逐字猜原文——数字都回去核了实现（`Movement2` 峰值 0.55、`Param56` 0.44→0.86、`ParamAngleY` +8.5 度）。`verify-src` 第 10 段三条断言防复发：源码纯注释行不得出现 `…?`、不得出现这批损坏时吐出来的生僻字（`扢睢弢仢朢靃霢訢濢锢徢`）、扫描文件数 ≥20。**任何批量改文本的脚本，改完必须跑这条**；另外写批量替换时一律「按行号 + 该行必须命中的特征」双校验，对不上就整体不写——按数组索引直接覆盖冲掉过相邻行（`setVisibleOnAllWorkspaces` 那次），也丢过缩进。


- **「启动慢」要有数字，别靠猜**（2026-11-14 新增）：`npm run perf` 量四段——本地服务起来、DOM 就绪、模型就绪、页面 JS 堆，外加启动期长帧个数，各带预算，超了退出码 1；`--long` 打印每个长帧标到的脚本（文件 · 耗时 · 函数）。两个坑：① Electron 35 里 `performance.getEntriesByType("paint")` 返回**空数组**（实测 `paintCount=0`），别指望拿 first-contentful-paint，用 `domContentLoaded` + `__fishDebug().model` 这两处真实时间点；② `domReady` 是相对 `timeOrigin` 的，要换算成「相对 spawn」得用 `(Date.now()-t0) - performance.now() + domReady`。每次启动主进程还会写 `boot-timing.txt`（`ready` / `server` / `window` 三段毫秒），用户报「启动慢」就让他发这个文件，一眼能分清是服务慢还是模型慢。`verify-src` 第 11 段 16 条守着这套东西（包括「perf 必须走 `sampleFrom`，不许退回长连接」和「perf 判定失败必须 exit 1，不能只打印数字」）。

- **空状态卡只有打包版才走得到，源码版永远测不到**（2026-11-15 加）：`_app\model` 里带着内置模型，源码版一启动就有模型，`bootSafe()` 里 `if (!PACK || !PACK.url)` 那条分支根本进不去。所以空状态卡的验收必须用 `dist\win-unpacked\大肥鱼.exe`（打包版按设计不带模型），`npm run probe:empty` 就是这么干的：隔离 userData 起打包版 → CDP 求值读 `#noModel.on`、两个按钮可见性、`#nmHelp` 展开后的 `li` 条数、提示文案关键字、窗口尺寸，12 项全过才算。**窗口只有 356×512**，往卡片里加内容时必须验「展开后 `document.documentElement.scrollHeight ≤ window.innerHeight`」——探针里专门有一条，因为展开把最后两条说明顶出窗口就等于没写。另外 `#nmTip` 是 `div`，多行提示要 `white-space: pre-line`，少了这个十几行会挤成一坨（这个也钉在 `verify-src` 第 12 段里）。
- **模型加载失败曾经只有一个「重试」按钮**：贴图缺了、moc3 版本比内置 Cubism Core 新，这类问题点一百次重试也不会好，用户最后只能去卸载重装。现在 `showRetry()` 并排放「重试 / 换一个模型」，后者直接 `deskfish.openAdapter(PACK.id)` 进适配器；错误文案也改成先说清「模型文件找到了，但没能加载起来」再给原因，而不是甩一行技术错误。改动形状钉在 `verify-src` 第 12 段（`mk("换一个模型"`、`openAdapter(PACK && PACK.id`、`模型文件找到了，但没能加载起来`、并且旧的 `模型没能启动"` 必须已被替换掉）。

- **UI 探针找窗口要重试，别只等一次**（2026-11-15 加）：`window.deskfish.openChatLog()` 这类 IPC 是异步建窗，`scripts\ui\quick-pet-esc.js` 原来 `sleep(900)` 后只 `getAllWindows().find()` 一次。机器忙的时候（比如安装回归同时在解 1.9 GB）窗口还没进列表，就直接判「打不开」——本仓库真撞过一次：`verify:ui` 报「对话记录窗口真按 Tab 焦点会移动 → {}」「焦点环可见 → []」，隔一分钟重跑 55/0。现在改成最多查 3 轮（900ms + 两轮各 700ms），并给 `open:false` 带上原因（`等了 2.3 秒窗口没出来`），`test-ui.js` 的 detail 会把 `error` 一起打出来——空对象等于没说。同一个道理已经写在上一段「不要用固定 sleep」里，这里是它的另一半：**找得到窗口之后**，关闭也要轮询。
- **滚动兜底要 `box-sizing: border-box`，否则 `max-height` 白写**（2026-11-15 加）：给 `.nm-card` 加 `max-height: calc(100vh - 32px)` 之后，`getComputedStyle` 明明报 `maxHeight: "480px"`，`clientHeight` 却是 515 —— 因为默认 `content-box` 下 `max-height` 只约束内容区，加上 `padding: 20px 18px 15px` 与边框正好 517。补 `box-sizing: border-box` 才真收住，再配 `overflow-y: auto` 才有得滚（只收不滚等于把内容裁掉）。另外 flex item 上的 `max-height: 100%` 会被当成 `auto`，必须用 `calc(100vh - Npx)`。改这类「窗口只有 356×512」的卡片，用 `_app\_tmp\card-probe`（356×512 窗口里直接 `loadFile` 真实 `index.html`，`$env:CARD_MODE` 切 `normal`/`missing`/`failed`/`stress`）量，别为看一行字重新 build 十分钟；跑它之前要 `Remove-Item Env:ELECTRON_RUN_AS_NODE`，否则 Electron 被当 Node 跑。

- **诊断包要能回答「她不见了」和「启动好慢」**（2026-11-15 加）：`diagExport` 早就有，但没带 `boot-timing.txt`，也没有任何显示器信息——用户说「挪到副屏就找不回来」「启动慢」时，包里没有证据。现在 `显示器.txt` 写每块屏的分辨率 / 位置 / 缩放 / 工作区，加一行 `她现在在哪: 屏N（窗口 x,y W×H）`（`screen.getDisplayMatching(win.getBounds())` 配 `ds.findIndex(d => d.id === cur.id)`），并把 `boot-timing.txt` 与 `last-boot.txt` 一起收进包。导出支持直接给目录（`exportDiag(dirOverride)` → `if (forced) { fs.mkdirSync(forced, { recursive: true }); dir = forced; }`），探针才不用点系统对话框；**这条不弹框通道只在 `!app.isPackaged || process.env.FISH_MULTI === "1"` 时注册**，正式安装版没有，否则页面里任何脚本都能往任意路径写文件（`preload.js` 的 `diagExportTo` 也按 `FISH_MULTI === "1"` 条件暴露，别用 `!process.env.FISH_PACKAGED` —— 打包版根本没这个变量，`!undefined` 为真）。验收是 `npm run test:diag`，15 项：六个文件齐、屏数与缩放、她所在屏、boot-timing 三段、设置里没有密钥。
- **`scripts/lib/cdp.js` 的 `evalOn` 已经 `JSON.parse` 过一次**（2026-11-15 加）：`lib/cdp.js:105` `try { return JSON.parse(raw); } catch (e) { return { raw: raw }; }`。探针里再 `JSON.parse(r.result.value)` 一定「解析失败」，而且会一次性红掉一屏断言（`test-diag.js` 第一次就是这么红的 8 条）。页面侧只要返回 `JSON.stringify(...)`，拿到手就是对象，直接 `r1.has` / `r2.ok` 用。
- **`verify-src.js` 的断言助手只有 `ok(n, d)` 与 `bad(name)`**（2026-11-15 加）：第 24 行 `function ok(n, d)`，没有 `check` / `assert` / `must`。写新段时 `if (cond) ok("…"); else bad("…")`，或在段内自己包一层 `const t13 = (n, c, d) => { if (c) ok(n, d); else bad(n); };`。写成 `check(...)` 会在**运行时**才炸 `ReferenceError: check is not defined`（`node --check` 完全通过，看不出来）。
- **NSIS 的 `/D=` 在第一个空格处截断，而且静默返回 0**（2026-11-15 实测）：静默装到 `E:\Temp\大肥鱼 安装测试（中文 路径）\Program Files\大肥鱼 客户端` 时，安装器退出码 0，程序却落在 `E:\Temp\大肥鱼` —— `/D=` 在**第一个空格**处断了。换成纯 ASCII 的 `E:\Temp\dfy space test\app dir` 结果一样（落到 `E:\Temp\dfy`），所以是空格、不是中文：**纯中文无空格路径完全正常**（7164 文件、冒烟 `exit=0`、卸载干净）。图形向导（双击）不走 `/D`，用户自己选含空格目录不受影响；受影响的是企业批量部署脚本。给 `spawn` 传 `/D=` 必须加 `windowsVerbatimArguments: true`（Node 默认会给含空格参数补引号，NSIS 明确要求不能有引号），但即使这样 NSIS 仍会在空格处截断——所以路径只能不含空格。`test-install.js` 第 4 段现在装一次纯中文路径（`…\大肥鱼安装回归-xxxx\程序目录`），9 条断言盯着「主程序在目标路径 / 父目录没被塞东西 / 文件数一致 / 能启动 / 卸载不留文件」；`SKIP_CJK=1` 可跳过（跑一轮约多 2 分钟）。另外注意：`CHANGELOG.md` 是 **CRLF**，其它文档多是 LF——批量插文档前先探换行符，用 `\n### 变更\n` 去匹配 CRLF 文件会一个字都替换不上，还静默成功。
- **写测试夹具时别往 `models/` 里塞 `.model3.json`**（2026-11-15 踩）：`userData\models\<id>\` 下只要有 `.model3.json`，模型库就把它当成一个可用包并自动选中、启动时去加载；字段不全的 model3 会让三重降级全部失败，console 冒出三行 `startup failed`，冒烟探针判 exit=1。我当时只是想造一个「升级前导入过的模型包」，结果测的变成了「畸形包怎么报错」。只放 `pet.json` 加一张贴图就不会被当包（`PackStore._isPackDir` 要求存在 `.model3.json`）。这条同样适用于 `/api/packs` 相关的测试。

### 导入要么整份进来，要么一点都不留

`PackStore.importDir` 现在先拷进 `userDir/\.importing-<id>-<时间戳>`，全部成功才
`fs.renameSync(tmp, dstDir)` 顶上；任何一步抛错就 `rmSync(tmp, {recursive:true})` 再原样抛出。
别改回来直接往 `models/<id>` 里写：用户导入两三百兆的包时磁盘满、权限不够、源文件被挪走
都是真会发生的，留下半个包的后果不是报错，而是**下一次扫描把它当成一个正常模型列出来**
（名字乱、参数全默认），再导一次又多一个 `-2`，用户根本不知道哪个是真的。
`scripts/test-packs.js` 用桩替换 `_copyTree`（抛 ENOSPC）覆盖了失败、成功、无残留三条。

### 超限不许静默截断

`_copyTree` 里「目录超过 6 层」「文件数到 4000」「总量到 1.2GB」以前是直接 `return`：
包照样装上、照样能选中，只是少几张贴图，界面上表现为模型发黑或者加载报错，原因只有读代码才知道。
现在三处都往 `stat.skipped` 写一条中文原因并置 `stat.truncated = true`，`importDir` 把它带回
调用方，`main.js` 的 `model:import` 透出 `truncated` / `skippedReason`，`renderer.js` 在
`if (r.truncated)` 时**不自动 reload**（reload 会把提示一起刷掉，用户只看到「发黑」这个结果），
改成把原因写在 `#nmTip` 里、让他自己按 Ctrl+R。`verify-src` 第 16 段 11 条盯着这条链路。
## 坑：导入必须 async，进度必须能退订

- **`packs/store.js` 的 `importDir` / `_copyTree` 是 async 的，别改回 `copyFileSync`。**
  几百兆的包同步复制会把主进程堵几十秒：窗口拖不动、托盘点不动，Windows 盖「未响应」。
  改回同步 = 用户以为程序死了并强杀（正在复制的包就废了，虽然有原子导入兜底）。
- **进度回调要做节流**：现在按 `stat.files % 16 !== 0 && now - lastP < 200` 跳过，
  否则 4000 个文件会发 4000 次 IPC，界面反而卡。结尾必须补发一次 `{ done: true }`，
  不然界面会永远停在 99%（节流刚好跳过了最后一次）。
- **订阅要在 `finally` 里退订**：`run()` 里三条 `return`（成功进库、成功但被截断、失败），
  任何一条漏了退订，下次导入就会叠加一个监听器，进度条跳两下。
- **别拿 `importMs` 当「导入窗口」去比对心跳时间戳**：心跳的 `at` 是相对 `t0` 的，
  而 `t0` 之后先跑了基线（第一次 `/api/packs` 冷启动可能要一整秒），直接比会整个错过窗口，
  看起来像「一次心跳都没落在导入期间」。`probe-import.js` 记的是 `impStart`。

### 配置层：专门的校验别写在通用循环前面

`sanitize()` 先 `const out = { ...DEFAULTS, viewBox: { ...DEFAULTS.viewBox } }`，再对 `viewBox` 单独夹取，
最后才进 `for (const key of Object.keys(DEFAULTS))`。**循环里必须 `if (key === "viewBox") continue;`** ——
否则通用分支的 `out[key] = val` 会把刚夹好的取景矩形用原始值盖回去，手改配置写个 `h: 9` 就让取景框缩成一个点，
人直接看不见（`h: 9` 实测）。以后再加「需要特殊校验的字段」，同一个坑：专门分支 + 循环里跳过，两件事都要做。

### DEFAULTS 是模块级常量，别被浅拷贝带出去

`{ ...DEFAULTS }` 只拷一层。`viewBox` 是对象，浅拷贝后返回值与 `DEFAULTS.viewBox` 是同一个引用，
调用方原地改 `cfg.viewBox.h` 就把全局默认值改了 —— 同一进程里之后每次 `sanitize()` 都带着那个脏值。
`test-settings-schema.js` 有一条专门验这个（改返回值后 `DEFAULTS.viewBox.h` 必须还是 0.4）。

### 取值范围为 null 的字段，`Number(null)` 是 0

`x` / `y` 的 `null` 表示「没记过绝对坐标，交给右下角锚点算」。早年直接 `Number(val)`，于是 `null → 0`，
含义变成「窗口在屏幕左上角」，而且默认值洗一遍就不再等于默认值（不幂等，`sanitize(DEFAULTS) !== DEFAULTS`）。
凡是「null 有语义」的字段，先判 `val === null || val === undefined` 再转数字。

### 纯函数规则要用单元测试钉住，别靠造坏配置文件启动去试

`src/settings.js` 的 `sanitize()` / `migrate()` 已导出，`scripts/test-settings-schema.js`（63 条）直接喂边界值：
幂等、未知键被丢、每个夹取边界、布尔/字符串类型错、`activePack` 的 `../` 穿越、快捷键空串与非法字符、
`viewBox` 夹取与 `pack` 校验、枚举与语速、8898→8899 迁移、以及喂 `null`/数组/函数不许抛。
上面三条坑全是这套测试抓出来的 —— 手点界面是抓不到 `x: null → 0` 这种的。

## 坑：二次启动要给回应，而且要留证据

- `second-instance` 里**必须打日志**。用户报「双击没反应」时，`run.log` 里有「收到第二个实例的启动请求」
  说明锁生效了、请求也到了，问题在提示；没有这行说明请求根本没到（起了两个实例 / 锁坏了）。
  没有这条日志，这两种情况在用户描述里是同一句话，排查只能靠猜。
- 只 `show()` + `focus()` **不够**。窗口停在已拔掉的显示器上时 `isVisible()` 仍返回 true，`focus()` 也拉不回来。
  必须先 `reflowToVisibleScreen()`（同步执行，不要等 `scheduleReflow` 的 300ms 防抖 —— 双击之后用户就在盯屏幕）。
- 窗口被关掉（进程还在托盘）时不能 `return`，要 `createWindow()` 重建。否则「双击」这个动作等于没兑现。
- 别在页面里用 `window.close()` 造「主窗口关掉」的测试场景：Chromium 会忽略非 script-opened 窗口的关闭请求，
  实测关不掉。这个分支只能靠 `verify-src` 静态钉住。

## 坑：同一个动作写在两个地方，其中一处一定会漏

- 「把窗口叫回用户眼前」这件事有三个入口（二次启动、托盘「显示 / 隐藏」、托盘双击图标）。
  以前是两处各写一遍，二次启动那份会夹回屏幕、会重建窗口、会留日志，托盘那份只有
  `win.isVisible() ? win.hide() : win.show()`。**凡是需要「多一步」才能生效的交互，
  复制粘贴出来的第二份一定少那一步。**现在统一走 `resurfaceMainWindow(why)`。
- 托盘菜单抽成 `src/tray-menu.js` 纯函数，`main.js` 只负责喂动作（`toggleWindow`、`quickPet`、`setMuted`…）。
  原生菜单自动化点不到，所以只能这样验：`scripts/test-tray.js` 44 条（`npm test` 里）。
- 反例断言要**排除注释行**：`isVisible() ? hide() : show()` 这种写法会被写在注释里当说明（本轮就踩到），
  `verify-src` 第 20 段改成在 `mainCode`（去掉以 `//` 开头的行）上匹配。
- 改 `main.js` 这种四千多行的文件，**别按「下一个只有 `}` 的行」找函数结尾** —— 嵌套块会骗人，
  本轮一次切掉 262 行（已在 `node --check` 前发现并回滚）。用唯一文本块做 `replace`，
  或先切前副本再改。

## 坑：不要并行跑 `test:install` 与 `verify:ui`

- `test:install` 会真装真卸 1.9 GB × 两遍（含中文路径那遍），磁盘几乎被占满。这时跑 `verify:ui`，
  窗口 `close()` 是异步的，探针那点等待会被拖穿，出现 `关完只剩主窗 → {endCount:2}` 这类假失败。
  实测：并行时 54 通过 1 失败，安装一结束单独复跑就是 55 通过 0 失败。
- 同理 `test:install`、`verify:ui`、`npm run burn`（压测）一次只跑一个。
- 判据：失败项如果是「窗口数 / 焦点 / 句柄」这类和时间有关的量，先看有没有别的重活在跑，
  **别急着改产品代码**。

## 坑：设置项必须有人读，否则等于没做

`DEFAULTS` 里加一个键很容易，让它真的改变行为要另写一段代码。
`anchorMode` 就是这样：`stashAnchor()` 每次保存位置都写 `"corner"`，但全仓没有一行读它，
`"free"`（记住绝对坐标）模式从未实现。它没有界面控件，所以一直没伤到人 ——
但只要有人给它补个开关，用户改完就会得到“保存了、但什么都没发生”。

`npm run audit:settings` 守这条线：递归扫 `src/**/*.js`（含 `packs/` 子目录，别只扫顶层），
`DEFAULTS` 里每个键必须在定义方与界面方之外至少被引用一次；只写不读的键要登记进 `WHITELIST`
并写明为什么留着。它还会反向检查：白名单里登记过、但后来其实已经有消费方的键，也要报出来
（实现了却忘了删登记，下一个人会被误导）。这个脚本挂在 `npm run verify` 上，亚秒级。

## 坑：「改了就生效」的期望值要按 calm 空闲降档算

`probe-settings.js` 验的是“改完设置当场生效”。这里有个陷阱：
`renderer.js:1518` 的 `const calm = !dragging && !working && idleFor > 8000;`
会把 `wantFps = calm ? Math.min(15, fpsCap) : fpsCap` 压到 15、`wantRes = calm ? 1 : baseResolution` 压到 1。
所以断言不能硬写“改 20 后 maxFps 应该 20” —— 空闲 8 秒后她本来就该降到 15。
期望值要算出来：`calm ? Math.min(15, 20) : 20`。两种情况都在验正确性，只是期望不同。

同理，`sharpen` 是不受 calm 影响的（`app.canvas.style.filter` 直接设），
所以它是最稳的那一条断言；`scale` 看 `window.innerWidth` 也硬（窗口真的变宽才算生效）。

## 坑：改设置不许整页重载

`probe-settings.js` 在表达式开头放了一个 `window.__probeMark = 1`，最后检查它还在。
如果哪天谁把“应用设置”写成 `location.reload()`，标记会消失 —— 用户看到的是“改一下闪一下”，
模型要重新加载，几秒钟白屏。这条断言就是为了拦住那种“改起来最简单”的实现。

## 坑：高 DPI 屏上「谁用了物理像素当 DIP」

窗口尺寸与位置全是 DIP（与系统缩放无关），canvas 的 `width/height` 是物理像素，
`style.width` 与 `getBoundingClientRect()` 又是 DIP —— 抄错一个单位，表现就是「她撑成两倍大」。
`scripts/probe-dpi.js` 用 `--force-device-scale-factor=<f>` 逐档启动来验这件事：
100% / 125% / 150% / 200% 四档实测，窗口 DIP 宽度恒 460，canvas 的 CSS 尺寸跟容器一致。

**关键公式（我第一版写错过，三档全红，其实是断言错不是产品错）**：
PIXI 的 `autoDensity: true` 会把 `canvas.style.width` 写成 `canvas.width / resolution`，
缩放由浏览器自己换算。所以

```
canvas.width（物理像素） = 窗口 DIP 宽 × renderer.resolution
屏幕真正要的物理像素     = 窗口 DIP 宽 × devicePixelRatio
```
**不要**把 `devicePixelRatio` 再乘进第一条 —— 那会让 150%/200% 三档永远对不上。

## 坑：清晰度三档的边界是 200%

`resolution` 支持 1 / 2 / 3，界面上是「标准 / 清晰 / 极致」，默认 2。
因为 `canvas.width = DIP × resolution`、屏幕要 `DIP × dpr`，所以：

- dpr ≤ 2（100% / 125% / 150% / 200%）：默认「清晰」就够，不会糊；
- dpr > 2（250% / 300%）：默认档会被浏览器放大 1.25–1.5 倍，要开「极致」才追得上。
  实测 300% + 极致：画布 1380 = 屏幕 1380，帧率仍是 29（这个模型不吃力）。

`probe-dpi.js` 对超过 200% 的档不判失败，而是打印「需要极致才追得上」——这是取舍，不是缺陷，
别为了让它变绿就把断言改成「永远通过」；要验极致就传 `--res 3`。

模型贴图本身是 4096×8192 / 8192×8192 级别，所以拉高 resolution 真的能换到细节，不是白花开销。

## 坑：同一条曲线别写两份

`src/renderer.js` 曾经有两个函数干同一件事：

- 点击回弹的 `curve(t, pts)`（第 1652 行在调，`[[0,0],[0.1,-1],[0.26,0.16],[0.52,0],[0.78,0]]`）
- 动作播放的 `lerpAt(pts, t)`（参数顺序还是反的，`__act.curves` 里每一条都走它）

两者都是 Catmull-Rom（张力 0.5、端点镜像虚拟邻居），区别只有零跨度兜底：一个
`Math.max(1e-6, p2[0] - p1[0])`，一个 `p2[0] - p1[0] || 1`。这不是两个特化，
这是同一套算法写了两遍 —— 谁调手感都只会改到其中一处。

现在统一在 **`src/lib/curve.js`**：

- 形态是 UMD：浏览器里挂 `window.__fishCurve`，Node 里 `require` 直接拿 `{ curve, clampNum }`；
- `renderer.js` 顶部解构引用，取不到只 `console.error` 一句并退化成端点值（不静默假装正常）；
- `lerpAt` 保留名字、值是 `curve` 的别名 —— 调用点（`renderer.js:1115`、`:1465`、`:1475`）一行都不用改；
- `index.html` 的 `<script src="lib/curve.js">` **必须排在 `renderer.js` 之前**，否则 `__fishCurve` 还是 undefined。

守它的东西：

- `scripts/test-curve.js` 23 条（含「拿旧实现做 600 点等价对照，最大差 0」）；
- `verify-src` 第 24 段 14 条：lib 存在/UMD/导出、renderer 引用、**反例不许再出现自己的 Catmull-Rom**、
  `lerpAt` 是别名、`clampNum` 只有一处声明、`index.html` 的加载顺序、`test:curve` 入口存在。

顺手记住一条通用的：**凡是「两处代码只差一个兜底」的地方，都是在等一次只改一半。**

## 坑：devtools 里别用相对 URL，页面刚建出来时 origin 是 null

真机探针常在页面里 `fetch("/api/packs")`。两件事要记住：

1. **调试端口看得见 target ≠ 页面能用了**。`/json/list` 在文档还是 `about:blank` 时就已经列出
   `.../src/index.html`，那一刻 `location.origin` 是字符串 `"null"`，相对请求会拼成
   `null/api/packs` 并报 `Failed to parse URL`。探针要先等到 `location.origin` 以 http 开头、
   `document.readyState === "complete"`，再开始打接口（`probe-adapter.js` 里那段轮询就是干这个的）。
2. **`new URL(p, location.href)` 在这里也会偶发 Invalid URL**（同一个未就绪窗口）。拼字符串最稳：
   `location.origin + p`。

顺带一条：`lib/cdp.js` 的 `evalOn` 已经把返回值 `JSON.parse` 过了，探针里拿到的是对象，
**不要再 `JSON.parse(result.value)`**（会一律报「解析失败」）。

## 坑：适配器的验证分三层，缺的是端到端

| 层 | 是什么 | 抓不到什么 |
| --- | --- | --- |
| `test-packs.js`（30） | 真 PackStore，但不开窗口 | 切换后渲染端有没有真的换模型 |
| `test-packs-http.js`（41） | 真 HTTP server，但**假适配器** | 真适配器在真文件上的行为 |
| `verify:ui`（55） | 界面冒烟 | 导入 → 绑定 → 切换 → 删除这条链 |

`npm run probe:adapter`（26 条）补的就是最后一层：导入真模型目录 → 体检 → 保存（顺便验白名单）
→ `POST /api/packs/active` 切过去 → 轮询主窗口 `__fishDebug().model === true` → 复制一份
→ `remove` 掉正在用的那个 → 确认画面落到别的包或空状态卡（不是白屏）。
它默认拿 `..\mianfeimodelYUAN`（19.6 MB 的真模型）当导入源，**只复制到临时 userData，不动原目录**。

## 坑：界面控件是不是死的，静态看不出来

8 个页面里 **110 个带 id 的可交互元素**（settings 76、adapter 9、index 7、chatlog 5、seewatch 5、
petpanel 4、profile 3、welcome 1），全部靠逐个 `$("id").addEventListener(...)` 绑 —— 没有
`data-act` 这类声明式派发，所以「加了个开关忘了接」在代码里看、单测、真机冒烟都发现不了。
真出过事：`#feiyuRefDir` 只有「选文件夹」按钮写它，键盘手打完全不生效，框在那儿当摆设。

`npm run audit:ui`（`scripts/audit-ui-bindings.js`）的判据分两步，缺一步就不可用：

1. **上下文**：id 出现处 ±420 字符内有 `addEventListener` / `onclick` / `bind(` / `wire(` 等。
2. **变量名映射**：代码里常见 `E.scaleNum.addEventListener` 与 `el.stop.addEventListener`，绑定离 id
   很远。所以要先建「变量名 → id」，三种写法都要认：
   `const x = document.getElementById("id")`、`const x = $("id")`、**以及对象字面量里的**
   `{ stop: $("stop"), levelBtn: $("levelBtn") }` —— 少了最后这条，petpanel 那两个真接好的按钮
   会被报成死键（本轮就这么假报过一轮，67 个假阳性里有一半是它）。

三条纪律：

- **先跑到「真实 src 0 死键」再上断言**。判据松一点就是 110 全过，紧一点就是 67 个可疑，两个极端都等于没有。
- **自测必须造 fixture 证明它抓得到**（`scripts/test-ui-bindings.js` 11 条：直接绑、短名对象、
  长名对象、只在注释里提、谁都没提）。只会报 0 的审计脚本比没有更糟 —— 它给你假安心。
- **内联 `<script>` 也要扫**。有的页面把几行绑定直接写在 HTML 里，只看 `src=` 会漏。

## 坑：开关「存进去了」和「真的生效了」是两件事

- `audit:ui` 只证明控件绑了事件，`test:persist` 只证明值活得过来，中间那段没人验。
  一个开关完全可以：点了有反应、`settings.json` 也写了，然后什么都没发生。
- `npm run probe:toggles` 按三层取证，缺一层都不算：
  ① 渲染侧真的变了（`__fishDebug()` 里的 `follow`/`autoIdle`/`blink`/`sharpen`/`fpsCap`，
  锐化还要看 `canvas.style.filter` 真的挂上/撤掉）；
  ② 主窗口真的变了（`window.deskfish.testWinState()` 回的 `alwaysOnTop`/`ignoreMouse` ——
  这两个改的是 BrowserWindow，渲染进程看不见，Win32 层又被自测伪装污染，只能问主进程）；
  ③ `settings.json` 落的就是这个值。
- **`electron.BrowserWindow` 没有 `isIgnoreMouseEvents()`**，自己留一份：`applySettings` 里
  `win.__ignoreMouse = !!s.clickThrough;`。别在 `BW()` 的隐藏逻辑里写，那是自测伪装不是用户设置。
- **开关必须乐观更新**：`push()` 要等主进程返回才 `paint()`，这期间 `cur` 还是旧值。
  手快连点第二下会用旧值算出同一个目标 —— 请求发了、滑块抖了、值没变，表现是「关不掉」，
  而且最难查，因为每一步都“有反应”。正确写法是点下去先 `cur[key] = next` + 立刻重画，再发请求；
  `push` 的 catch 里补 `paint(await api.settingsGet())` 把界面拉回真实状态。
- `verify-src` 第 27 段守这些。其中一条断言特意不按文案找锚点：`设置没存上：` 在 `try` 里
  还有一处同文案的 toast，拿 `indexOf` 取第一处会抓到它，断言永远绿、也永远证明不了什么。

## 坑：注册上了 ≠ 按下去会发生，而且唤出会顺手改掉窗口属性

- 全局快捷键要 **OS 层真按键**，CDP 派发的键盘事件到不了 `globalShortcut`。所以「按了热键之后窗口变成什么样」
  只能靠一条自测专用通道 `__test:summon`（只在 `FISH_MULTI=1` 下注册，正式安装版没有）去跑一次真正的唤出动作。
- `summonDock()` 原来无条件 `win.setAlwaysOnTop(true, "screen-saver")`。而 `applySettings` 里的置顶同步只在
  **这次 patch 里含 `alwaysOnTop`** 时才跑 —— 没有第二条路径会把它降回去。症状：关掉「总在最前」→ 按一次唤出 →
  窗口从此压在所有窗口上（包括全屏游戏）。改法：`if (S.get().alwaysOnTop) ... else win.setAlwaysOnTop(false)`。
- 「这个键在不在 `bound` 里」**不能**用来判断某个功能是否生效：同一个键分给两个功能时，主进程只保留先注册的那个，
  但那个键确实在 `bound` 里（另一个功能注册成功了）。必须另记一份 `skipped`，界面按它分开说「被别的软件占用」与
  「和另一个功能用了同一个键」—— 两句话对应两种完全不同的处置（关软件 / 改自己的设置）。
- 验证入口：`npm run probe:hotkeys`（18 条）。它会先关掉设置窗再打开，因为 `refreshHotkeyStatus()` 只在初始化 / 保存 / 导入时跑，
  窗口早开着读到的是旧文案。
- `verify-src` 第 28 段 16 条钉住上述约定，其中两条是反例：`summonDock` 里不许再出现无条件的 `setAlwaysOnTop(true, ...)` 紧跟
  `setFocusable`；撞车的键不许因为 `bound` 里有就当成已生效。

## 坑：麦克风失败一律静默，用户只会说「点了没反应」

语音这条线上有三处失败，修之前全是哑的：

| 位置 | 修之前 | 用户感知 |
| --- | --- | --- |
| `voice.js` 的 `enable()` catch | `log(...)` 一行 + `return false` | 按钮不变、她也不说话 |
| `settings-renderer.js` 的 `fillMicDevices()` | 空 `catch (e) { }` | 下拉只剩「系统默认」，以为程序没找到设备 |
| 说话中途设备被拔 | 没人监听 | 按钮还亮着，像她突然不理人 |

- 三处共用 `src/lib/micerr.js`（UMD，跟 `lib/curve.js` 同款），把 DOMException 的 `name` 翻成两句：`short` 给她说（气泡），`detail` 给设置页/诊断包（说清下一步动哪里）。
- **同一个原因在不同机器上 name 不一样**：权限没给可能是 `NotAllowedError`、`PermissionDeniedError`、甚至 `SecurityError`；所以按「最具体先匹配」写成表，最后一定有一句兜底，不许出现空文案。
- 失败时三个动作缺一不可：`lastMicError = micErrText(e)`（留住 code）、`setBtn("off")`（别让按钮骗人）、`FishSay(lastMicError.short)`（她说一句话）。
- 轨道断开要用 `addEventListener("ended"|"mute")`，且 `disable()` 里把 `watchedTrack = null`；`stop()` **不会**触发 `ended`，自测要用 `__dropMic()` 对真轨道派发事件。
- 探针 `scripts/probe-mic.js` 用 `--use-fake-device-for-media-stream` 造一个假麦克风，**不碰用户真设备**；四种失败靠临时替换 `navigator.mediaDevices.getUserMedia` 造出来，不依赖机器状态。
- `verify-src` 第 29 段守这些：七种分类、兜底文案、三处接线、加载顺序、探针存在，以及一条反例「不许退回只记日志」。

### 坑：`return false` 不算错误，所以它永远到不了界面

`voice.js` 的 `speak()` 是五级降级链，全挂时 **`return false`，不抛错**；
调用方（`finishReply` / `speakAndShow`）以前只 `try/catch` 不查返回值 ——
于是「她一声不吭」这件事在代码里根本不存在，只在日志里留一行 `TTS 失败`。

三条纪律：

1. **降级链的终点要留证据**：`speak()` 里每处 catch 都 `note(e)`，
   而且**只记第一处**（用户所选那一档为什么不行），回落链上的失败不覆盖它。
2. **调用方必须查返回值**：`const ok = await speak(clean); if (ok === false) notifySpeakFailed();`。
   只写 catch 等于把「没出声」当正常。
3. **不吵自己关掉的人**：`notifySpeakFailed()` 开头 `if (muted) return;`。

验证方式（`npm run probe:voice-out`，11 条）：真机替换 `window.fetch` 让
`/engine/tts`、`/engine/tts_stream`、`/engine/rvc`、`/api/tts` 全返回 503，
再走**真实的** `__finishReply()` —— 不打桩内部函数，否则测的是自己写的假路径。
断言里有一条是「失败提示不是技术报错原文」，另一条是「静音时不弹」。

分类表在 `src/lib/voiceerr.js`（UMD，同 `micerr.js` / `curve.js`）：
**按最具体的先匹配** —— `RVC HTTP 500 合成失败` 必须归 `rvc` 而不是 `engine`，
否则用户会去重装引擎，而真正坏的是换音色那步。`test-voiceerr.js` 25 条钉住这一点。

## 坑：「没等到回复」和「没说完」是两件事，而且都不许静默

`voice.js` 的 `waitReply()` 有三条出口，以前两条是哑的：

| 出口 | 以前 | 现在 |
| --- | --- | --- |
| 正常收到（`completed`） | 念完、记账 | 不变 |
| 超时但拿到半截 | 念完就收工，什么都不说 | `replyIssue = {code:"partial"}` + 「……好像没说完（等了 N 秒）」 |
| 超时一个字都没有 | 要求 `window.FishLines` 存在才说话 | `replyIssue = {code:"stalled"}` + 「她还没回我……（等了 N 秒）要不再说一次？」 |

四条纪律：

1. **「念完了」不等于「说完了」**。半截被时间掐断时，用户看不出区别，必须补一句。
2. **不要拿一个可选模块当说话的前提**。`window.FishSay && window.FishLines` 这种写法，在台词库没加载时等于把整句话删掉。
3. **基线读不到时不要当成 0**。`since = 0` 会让 state 里任何一条旧 assistant 消息都变成「她刚回的那句」，用户听见她答非所问，比沉默更难查。现在 `snapOk` 为假就退到 `Date.now() - 60000`。
4. **超时数值要能注入**（`window.__fishReplyTimeoutMs`），否则每跑一次探针都要真等 90 秒；但文案里的秒数必须用实际值算，不能写死。

验证：`npm run probe:reply`（12 条，真机走 `__waitReply`，mock `/api/health` + `/api/state`），`verify-src` 第 31 段 16 条，其中一条是反例「不许再出现 `window.FishSay && window.FishLines`」。

## 坑：一条 catch 把「读不懂」和「没有」混成一件事

`chatLoad()` 原来是：读文件 → `JSON.parse` → 过滤 → 赋值，全部包在一个 `try` 里，
`catch` 里只有一句 `chatItems = []`。看起来「鲁棒」，实际是**把两种完全不同的情况混成了一种**：

- 文件不存在（第一次用）→ 空数组，正确；
- 文件存在但读不懂（写到一半 / 磁盘满 / 用户手改坏）→ 也当空数组，**接下来那次写盘就把原文件覆盖掉了**。

而 `chatSaveSoon()` 是 400ms 防抖，用户说一句话就会触发。也就是说：一次读不懂，几秒内就变成永久丢失。

四条纪律：

1. **解析要返回状态，不要返回空集合**。`parseChat()` 返回 `{items, dropped, cut, error}`，
   `error` 分 `empty` / `json` / `shape` —— 上层才有机会做别的处置。
2. **读不懂先留证据**。现在会 `copyFileSync` 一份 `chatlog.json.bad-<时间戳>` 再往下跑。
   不指望用户能看懂，但事后能捞回来。
3. **脏数据要如实报数**。丢掉几条没有正文的（`dropped`）、裁掉几条超过上限的（`cut`），都写日志。
   默默改用户的数据，是最难被发现的一种错。
4. **读写共用同一套归一化**。`serializeChat()` 和 `parseChat()` 走同一个 `normalizeItem()`，
   保证「写得出去 = 读得回来」；上限也只在一个地方定义（`CHATFILE.MAX`），不许两处各写一个 3000。

验证：`npm run test:chatfile`（40 条纯函数）、`npm run probe:chat`（13 条真机：写两句 → 重启还在 → 写坏文件 → 留备份 → 还能继续写），
`verify-src` 第 32 段 17 条，其中一条是反例「`chatLoad()` 里不许再自己 `JSON.parse`」。
红证据：把 `if (r.error)` 临时改成 `if (false && r.error)`，探针立刻报「坏文件被留了一份 .bad-*（没有）」，11 通过 1 失败。

## 坑：一个事件同时表示「换模型」和「换规则」

`pack-changed` 这个名字听起来只表示「模型换了」，实际上有三处会发它：
切模型（`adapter:activate`）、保存适配器配置（`adapter:reload`）、导入新包。
而渲染端收到它的反应只有一句 `location.reload()` —— **改一下取景 = 整页重载 = 重新解析 16 MB 的 moc3**。

现在拆成两条：

| 事件 | 什么时候发 | 页面怎么反应 |
| --- | --- | --- |
| `pack-changed` | 换模型 / 导入新包 | `location.reload()`（贴图、参数索引、动作路由全变了，增量改容易漏） |
| `pack-rules` | 只改了取景 / 表情 / 动作路由 | `applyPackRules()`：重读包配置、重算取景、`layout()`，模型不动 |

三条纪律：

1. **事件名要说清语义**。一个事件被三处复用，其中两处的「正确反应」完全不同，早晚会有一处错。
2. **改完要能证明「真的没重载」**。做法：CDP 的 `Page.addScriptToEvaluateOnNewDocument` 往页面注入一段
   自增 `localStorage.__nav` 的脚本 —— 每个新文档创建时执行一次，localStorage 同源跨 reload 保留，
   于是这个数就是页面被加载了几次。比截图比时间都硬。
3. **切模型时页面会 reload，所以触发要发 HTTP 而不是 IPC**。走 IPC 的话那次 `Runtime.evaluate` 会被导航打断，
   拿到的是超时而不是结果；用页面 `location.origin` 发 `POST /api/packs/active` 更稳（注意不是调试端口）。

验证：`npm run probe:switch`（16 条：切一次模型 Δnav=1、换规则 Δnav=0、`__applyPackRules` 返回 true、
取景值读得到、切到的确实是新包），`verify-src` 第 33 段 15 条。
红证据：把 `adapter:reload` 改回发 `pack-changed`，探针立刻报 `❌ 只换规则不重载页面 Δnav=1（期望 0）`。

**另一个没能证实的猜想（记下来别再试）**：`adapter:activate` 里发完消息还有一次 `setTimeout(120)` 的
`webContents.reload()`，我原以为会和页面自己的 `location.reload()` 叠成两次导航、让她闪两次白。
把那次 reload 加回去跑红证据，`Δnav` 仍然是 1 —— **Chromium 把这两次合并了**。所以那次多余的 reload
保留原样没动：没证据说明它有害，删它反而多一个「页面没收到消息就不重载」的风险。

## 坑：数据搬了家，搬家的人却站在一个没人走的门口

取景（`viewBox`）原本住在 `settings.json` 里，1.3.0 改成住在模型自己的 `live2d.layout`。
渲染端改成只读模型那份之后，旧值就没人读了 —— 而迁移代码写在**模型适配器**里：

```js
// src/adapter.js —— 只在用户打开适配器、选中那个包时才跑
if (vb && vb.pack === id && typeof vb.h === "number" && r.writable) { … }
```

于是升级用户只要不打开适配器，他调过的取景就永远躺在设置里，谁也不读，谁也不说。
现在启动时在主进程里搬一次（窗口出来 2.5 秒后，不挡首屏）：

| 情况 | 行为 |
| --- | --- |
| 有 `pack` 标记、包还在、且在用户目录里 | 写进模型 `live2d.layout`，清掉设置里的旧值，留日志 |
| 包已经不在 | 原样留着，日志说明「标着 X，但这个模型已经不在」 |
| 是内置包 | 原样留着，日志说明「它改不了」 |
| 没有 `pack` 标记 | 直接返回，不猜 |

四条纪律：

1. **迁移不能挂在「用户可能来」的入口上**。适配器、设置页、某个右键菜单 —— 只要它是可选的，就一定有人永远不来。
2. **`writable` 这个名字最容易骗人**。`ModelAdapter.open()` 返回的 `writable` 恒为 `true`，它表示「这份文档可以编辑」（内置包也能编辑，写出来是一层覆盖层），**不表示模型文件能改**。想判断「是不是内置包」看 `origin === "builtin"`。
3. **搬不动的原样留着，别清空**。清空看起来干净，实际是把用户仅剩的一份证据删了；留着无害（已经没有代码读它），还能在诊断包里看见。
4. **搬完要留一条日志**。下次有人问「我的取景去哪了」，这句日志就是答案。

验证：`npm run probe:viewbox`（9 条，三段真机：可搬 / 包不在 / 没有标记，外加「第二次启动不会被改回默认」），
`verify-src` 第 34 段 14 条。红证据：把启动时那句 `setTimeout(…migrateLegacyViewBox…)` 摘掉，
探针立刻 4 通过 5 失败。

另外一个自己踩的坑：第一版探针断言去读 `pet.json` 的 `cfgs.layout`，永远是空的 ——
规则把值写到 **`manifest.live2d.layout`**（`src/packs/rules/40-layout.js:54-60`），`cfgs` 只是界面那份。

## 坑：只活在内存里的故障，重启就没了

麦克风打不开、说话整条链路失败、等回复只等到一半 —— 这三类失败原来各自只做两件事：
界面上弹一句话、内存里存一个变量（`lastMicError` / `lastSpeakError` / `lastReplyIssue`）。

问题是：**气泡几秒就消失，变量一重启就清空，而用户报障的时机基本都是「刚才不行，现在已经重启了」。**
于是诊断包里只有 2MB 的 run.log，得一行行翻 `[voice]` 前缀才知道发生过什么，
而且如果用户重启过，那次运行的日志已经被轮转掉了。

现在的做法：

| 环节 | 做什么 |
| --- | --- |
| 渲染进程 | 每次失败 `reportFault(kind, err)` → IPC `fault:report`（kind = `mic` / `speak` / `reply`） |
| 主进程 | 白名单字段裁一遍 → 推进 `faultRing`（最多 40 条）→ `faults.json`（tmp + rename） |
| 启动 | `faultLoad()` 把上一次的读回来，所以重启之后现场还在 |
| 诊断包 | 多一份 `故障记录.txt`：时间 / 类别 / 她说的 / 下一步 / **原始错误** |

四条纪律：

1. **给人话是给人看的，原始错误是给排障的人看的，两个都要留。** 只留人话 = 下次还得猜。
2. **上报要裁字段**。页面里能塞任意结构，主进程只认 `kind`/`code`/`short`/`detail`/`raw`，长度各自截断。
3. **落盘用 tmp + rename**。这个文件会被频繁重写，直接覆盖时崩一次就留下半个 JSON。
4. **环形缓冲，不无限长**。40 条足够回答「最近几次为什么不行」，再多只会让诊断包变肥。

验证：`npm run probe:fault`（19 条：手动上报字段原样收下、真触发一次语音全链失败也进记录、
`faults.json` 落盘、诊断包里有 `故障记录.txt` 且含原始错误、重启之后还在、发 60 条只留 40 条），
`verify-src` 第 35 段 15 条。

## 坑：省电的那一半，被另一半抵消了

「人不在就停」这件事本来做得很细：`pauseReasons` 记四个来源（最小化 / 锁屏 / 休眠 / 手动），
`powerMonitor` 的 `lock-screen` / `unlock-screen` / `suspend` / `resume` 都接了，全撤了才恢复。

但漏了一半：**全局鼠标位置那个 33ms 的定时器没看这个状态**。

```js
cursorTimer = setInterval(() => {
  if (win === null || win.isDestroyed()) return;
  const p = screen.getCursorScreenPoint();   // 人不在也照采
  …
  win.webContents.send("cursor", { … });     // 人不在也照推
}, 33);
```

ticker 停了，可这 30fps 的 IPC 每一下都要渲染进程的主线程醒一次。
锁屏八小时 ≈ 86 万次没人看的坐标 —— 省下来的那点电又还回去了。

现在回调开头：

```js
if (isRenderPaused() || !win.isVisible()) return;
```

连 `getCursorScreenPoint()` 都不调，也不做点击穿透的位置判断。

三条纪律：

1. **「人不在」是一个状态，不是一个地方**。加了暂停就要把所有周期性工作都对着它查一遍：
   推坐标、轮询桥接 `/api/health`、动画 tick、定时落盘。漏一个就等于没省。
2. **守卫要放在采样之前，不是发送之前**。放在 send 前面只省了 IPC，`getCursorScreenPoint()` 还在跑；
   放在回调第一行才是真的不做。
3. **这种「少做了」很难被眼睛发现**。用计数证明：`win.__cursorSent` 每发一帧加一，
   探针读两个时间点的差值 —— 正常 1.2 秒约 30 帧、暂停期间必须是 0、恢复后又是 30。

验证：`npm run probe:cursor`（7 条），`verify-src` 第 36 段 11 条（含「守卫必须在 send 之前」的顺序断言）。
红证据：摘掉守卫那一行，探针立刻 `❌ 暂停之后一帧都不该推  {"delta":26}`。

## 坑：周期任务要比「不画了」多问一句

上一轮堵住了推鼠标坐标，但同一时刻还有三处在跑：`startDshWatcher()` 每 2 秒的会话扫描、
`pollDsh()` 每 8 秒的桥接轮询、`seeTick()` 的截图。**ticker 停了只说明「不画了」，不等于「不干活了」。**
锁屏一整夜，前两项加起来是几万次没人看的工作。

四条纪律：

- **守卫放在干活之前。** 扫描要先问「人还在吗」再 `newestSessionWrite()`，不然白扫一趟再退出，
  省下来的只有 CPU 空转那一点点。截图同理：`if (!force && isRenderPaused()) return`。
- **状态只有一个来源。** `renderPaused` 活在 `startModel` 的作用域里，IIFE 顶层的 `pollDsh` 读不到它。
  留了一个读口 `window.__fishPausedNow = () => renderPaused;`，别让别处再存一份 ——
  两份状态迟早不一致，而且不一致的时候通常没人发现。
- **裸引用未定义变量会变成静默故障。** 曾经在 `pollDsh` 里直接写 `if (renderPaused) return;`，
  结果每 8 秒一条 `ReferenceError: renderPaused is not defined`，被 `setInterval` 的回调吞成 uncaught，
  界面一切正常，只有 `run.log` 里整整齐齐排着。**探针读不到计数时，先去看 run.log，别先怀疑探针。**
- **用计数证明「停」而不是「看代码觉得停了」。** 主进程侧留 `win.__dshScans`、渲染侧留 `window.__dshPolls`，
  探针在暂停前后各读一次，差值为 0 才算停。

第 37 段把这几条钉住了；`npm run probe:idle` 是真机三段的验证（正常 / 暂停 / 恢复）。

## 坑：「不收集、不上传」要能被机器验证

隐私说明是承诺，承诺要靠代码守。桌宠会读屏幕、会下模型、会连桥接 —— 任何一处悄悄加个上报域名，
用户看不出来，评审也看不出来（混在一堆 `127.0.0.1` 里）。

所以：**外网目标是一份白名单，不是一句口号。**

`scripts/audit-network.js` 扫 `src/` 与 `engine/` 里所有 `http(s)://`，分三类：
本机（`127.0.0.1` / `localhost` / `[::1]` / `0.0.0.0`）、变量拼出来的（地址由用户决定）、硬编码外网。
第三类必须出现在 `ALLOW` 表里，写清 `why`（谁在用）、`where`（出处文件）、`note`（用户能不能改），
而且出处要对得上 —— 地址挪走了白名单还留着挡路，也算红。

现在只有三个：

| 域名 | 用途 | 什么时候发生 |
| --- | --- | --- |
| `hf-mirror.com` | 下 whisper large-v3-turbo（1.6G） | 用户点下载 / 第一次用语音输入；`FISH_TURBO_URL` 可整条换掉 |
| `api.github.com` | 检查更新（只问版本号） | 只在你点「检查更新」时；启动不跑 |
| `github.com` | 打下载页 / 项目主页 | 交给系统浏览器，程序自己不请求 |

三条纪律：

1. **注释里的地址也要审。** 注释常常写着「我们会连哪里」，那正是要核对的地方。
2. **`www.w3.org` 不是外网。** 它是 SVG/XML 命名空间，永远不会被请求 —— 判据里单独排除，
   否则每个带 `<svg xmlns=...>` 的文件都会闹一次假红。
3. **裸 `http.request` 要红。** 出站统一走 `fetch` / `net.fetch`，否则审计点就被绕过去了。
   判据只认 `\bhttps?\.(request|get)\(` —— 写成 `\.(request|get)\(` 会把 `S.get()` / `map.get()` 全算进来（踩过）。

运行期那一半靠 `scripts/probe-network.js`：只留观察，不抓包。自测实例里把 `net.fetch` 换成一个记录器，
然后 A 段等 14 秒（跨一次桥接心跳）断言「外网 0 条」，B 段点一次检查更新断言「只出现了 api.github.com」。

**关键一条：先断言记录器装上了（`hooked === true`），再断言 0 条。** 否则替换失败时「一条外网都没有」是假绿 ——
这类假绿比红灯危险得多。

顺带发现隐私说明与代码有两处不符（写着默认 `api.deepseek.com`，实际默认空；漏了检查更新），已改。
**文档里写的每一个『默认值』，都值得回去 grep 一遍代码。**

## 坑：删得干净，和删得不多，是同一个按钮的两半

一个「清除本机数据」按钮看着最简单，其实两边都会出事：

| 只做一半 | 用户看到什么 |
| --- | --- |
| 只删文件，不清内存 | 点完显示「已清除」，说一句话记录又回来了（内存里那份下次写盘原样写回） |
| 只清该清的，漏了备份 | `.bad-` 那份恰恰是「读不懂的旧对话」，内容和聊天记录一样敏感 |
| 顺手把整个 userData 递归删了 | 设置没了（等于恢复出厂）、用户辛苦导入的模型也没了 |
| 清单写在两个地方 | 代码里加了新文件、登记表没加 → 用户点了按钮还是没清干净 |

四条纪律：

1. **清单只有一份，但要被两处引用。** `scripts/audit-privacy.js` 里的 `FILES`
   是登记表，`main.js` 的 `data:wipe` 是执行清单；审计脚本负责对账，
   双向 diff 必须为空（一边多了、一边少了都红）。
2. **删之前先证明路径在数据目录内。** `inside(p)` 用 `path.relative(U, p)`
   判断，`..` 开头或绝对路径一律拒绝 —— 这条守卫比清单本身更重要，
   因为清单是人写的，守卫是机器判的。
3. **不删的项必须写理由。** 登记表里 `wipe:false` 的两条（`settings.json`、
   `models`）都带 `why`。只写「删哪些」而不写「为什么这些不删」，
   下一个接手的人迟早会「顺手统一一下」。
4. **清完内存要一起清。** `chatItems = null` 加上 `clearTimeout(chatSaveTimer)`，
   少任何一句都会在 400ms 后把聊天记录写回来 —— 这是最容易漏、
   也最像「功能坏了」的一种。

### 判据别数条数

第一版探针断言「removed.length >= 10」，实测 9 条就红了 —— 但产品是对的：
这台机器上到底存在几个窗口位置文件、日志轮转了几份，每次都不一样。
改成「该删的关键项都在名单里」（`chatlog.json` / `faults.json` /
`runtime/tts/probe-1.wav` / `crash/probe-crash.txt`），既稳又能抓住真错。

### 红证据

- 把 `settings.json` 加进清除清单 → `❌ 设置还在`（18 通过 2 失败）
- 去掉 `chatItems = null` → `❌ 内存里的对话记录也清了  1`（19 通过 1 失败）

两个方向都抓到了，说明这 20 条断言不是摆设。


## 坑：第一屏只讲「怎么点」，不讲「还缺什么」

引导卡原来的四句话都是操作说明：右键点我、按快捷键、拖着我。
对一个**已经能用**的人是够的，对一个刚装完的人是答非所问 —— 他真正会撞上的第一件事是
「说完一句，她没反应」，而错误链是这样的：

```
voice.js:517  if (!apiBase) throw new Error("没有填 API 地址");
      ↓ 调用方 catch
voice.js:165  humanErr(e) → 兜底 return m.slice(0, 40)   // 原样吐出「没有填 API 地址」
      ↓
界面上出现一句 40 字的技术话，没有任何入口告诉用户去哪儿填
```

做法：把引导卡改成**开场体检**，由主进程 `welcome:precheck` 返回结构化的项
（`{key, ok, need, hint, act}`），页面只负责渲染和给出口。

四条纪律：

1. **体检放主进程**。引导页是 `127.0.0.1:7801` 上的页面，去问接口、问桥接会被同源策略拦；
   而「接口地址填没填」「桥接通不通」本来就在主进程手里（`S.get()` + `electron.net.fetch`）。
   只有麦克风那条留给页面自己问 —— 它是浏览器权限，主进程看不到。
2. **「能说话」是两条路，不是一条**。填了 `apiBase` 直连，或者桥接（`bridgeUrl`）通，都算齐。
   只判 `apiBase` 会把所有用桥接的人误报成「还差一个对话接口」。探针里专门有一段起假桥接验这个。
3. **可选项不要打扰**。麦克风只在 `permissions.query` 明确返回 `"denied"` 时才提；
   `"prompt"`（还没问过）不提 —— 第一次见面就弹「你没给我权限」是恐吓，不是帮助。
4. **收起时把内容也清掉**。只切 `hidden` 会留下一段看不见但还在的旧文案：
   窗口重新量高、或者用读屏软件时，它会读出一句已经不成立的「她还缺一个对话接口」。

验证：`probe:welcome` 21 条（缺接口 / 填上 / 只用桥接 / 点去设置 四段，自己起一个假桥接），
`verify-src` 第 40 段 22 条（含反例「引导页不许再出现 `getElementById("nomo")`」）。
红证据：把 `const talk = !!base || bridgeOk;` 改成 `const talk = true;`（等于不体检接口）→
探针 **9 通过 12 失败**，恢复后 21/0。

5. **文案里别写真实域名**。提示里原来写「例如 https://api.deepseek.com/v1」，udit:network 当场把它当成
   「未登记的外网域名」报红（它按 https?:// 抓，分不清代码和文案）。这正说明审计在干活 —— 但正确的修法不是加白名单
   （那会造出一条「没有任何代码去连」的僵尸条目，也会让用户以为默认连它），而是把文案改成占位的 https://你的域名/v1。
   同理：注释里、地方化字符串里出现的域名，一律按「程序可能会连」对待。

## 坑：建得出来，收不回去的临时目录

探针每跑一次会 `fs.mkdtempSync` 一个 `dfy-*` 目录当隔离的 userData。清理写在 `finally` 里 —— 
看起来很稳，其实三条路全会漏：

| 漏的路 | 为什么 | 谁踩过 |
| --- | --- | --- |
| try 里 `process.exit(2)` | **Node 的 process.exit 不执行 finally** | 大多数探针的早退分支 |
| 外层 `.catch(e => process.exit(1))` | catch 里没接清理 | probe-hotkeys / probe-empty |
| 被外部杀掉（工具超时、Ctrl-C） | 任何 finally 都来不及 | 跑得久的那几个（dpi / diag） |

攒到 round 35 收尾时，`%TEMP%` 里躺着 26 个：`dfy-diag-*` 8 个、`dfy-dpi-*` 14 个、
其余 4 个各 1 个，最老的已经在那里待了 10 个小时。

**纪律一：`process.exit()` 不是「正常退出」。** 它跳过 finally、跳过 await，直接结束进程。
要在退出时做事，只能挂 `process.on("exit")`（同步代码），或者别在 try 里 exit。

**纪律二：退出钩子管不了 SIGKILL，所以要「下次启动时顺手收」。** `scripts/lib/tmp.js` 在
第一次 `makeTmp` 时扫一遍 `%TEMP%`，只清两种：`.probe-pid` 里的进程已经不在的、
以及没有 pid 标记且超过一小时的。正在跑的另一个探针有 pid 文件且在跑，一根头发都不动。

**纪律三：判活用 pid 文件，别用目录名或创建时间。** 目录名不带任何信息；创建时间说不清
「这个进程是被 kill 了还是还在跑」。`.probe-pid` 里写 pid，`process.kill(pid, 0)` 抛 ESRCH
就是死了（抛 EPERM 是活着但不归我管，也算活着）。

**纪律四：时间比较必须把负年龄夹到 0。** Windows 的文件系统时间精度会让 `mtimeMs` 比
`Date.now()` 大 1 毫秒，`Date.now() - mtime` 减出来是 `-1`，而 `-1 < 0` 成立 —— 
「门槛 0 秒」这条断言会随机判成「还没到期」。修之前这个单测三次错一次：

```
第 1 次: 结果：19 通过，0 失败
第 2 次: 结果：18 通过，1 失败 | 失败项：把门槛放到 0 秒它就清掉
第 3 次: 结果：19 通过，0 失败
```

改成 `const age = Math.max(0, Date.now() - mtime);` 之后连跑六次全绿。**偶发失败的测试
比失败的测试更危险 —— 它会教人「再跑一次就好了」。**

**纪律五：写清理工具的人，自己的单测必须隔离。** 第一版 `sweepStale()` 只扫真实 `%TEMP%`，
而单测里要验「门槛 0 秒能删」，于是跑单测时把那 26 个历史残留一起清了 —— 结论对了，
但**单测不该有这种副作用**。加了 `root` 参数，并有一条断言专门守着「扫描根就是隔离根」。

验证：`scripts/test-tmp.js` 19 条（建/判活/死清/活留/无标记兜底/dry/前缀/KEEP/隔离根），
`verify-src` 第 41 段 19 条（含反例「探针里不许再有裸的 `fs.mkdtempSync`」）。

## 坑：句柄数看不出来的那种泄漏

`churn`（反复开关面板）和 `soak`（长时间挂着）一直在看 `getActiveResourcesInfo().length`，
但那里面**没有 EventEmitter 的监听器**。于是这类泄漏一路绿灯：

| 症状 | 实际发生了什么 |
| --- | --- |
| 句柄数不变 | 监听器不是句柄 |
| 内存涨得很慢 | 一个监听器几十字节 |
| 功能看起来正常 | 回调只是多跑一遍，不报错 |
| 三小时后 CPU 莫名高 | 那个事件每次触发，回调队列长了一截 |

四条纪律：

1. **热路径里不许订阅。** `applySettings` / `applyPackRules` 这类「改一次就跑一次」的函数里
   出现 `.on(` 就是错的 —— 哪怕只加一次也能被用户连点十次。
2. **订阅要登记。** `scripts/lib/listeners-reg.json` 记着每个文件的「订阅键 → 次数」，
   新增一处就红。这不是形式主义：登记的时候必须写下「它为什么不会堆」，写不出来就是会堆。
3. **深层订阅要单独解释。** 缩进 ≥6 说明它写在某个会被重复调用的函数体里，
   要么整改，要么在 `except` 里写清楚（本轮 4 处：3 处挂在每次新建的对象上，1 处是 `once`）。
4. **断言要「完全相等」，不是「涨幅小」。** 长生命周期 emitter 一次都不该加；
   写 `<= 2` 就等于允许它慢慢涨，而慢慢涨正是这类 bug 的形状。

两条踩坑：

- **基线要等窗口数稳定。** 引导卡在 `firstRun` 时是 4.2 秒后才弹的，探针如果采基线太早，
  会拿到 `windows=1`，跑完变 `2`，然后报「漏了一个窗口」—— 我第一次就是这么红的。
  正解：`await sleep(4500)` + 关一次引导卡，再采基线。
- **句柄降下来是好事。** 窗口关闭会释放 TCP/Timeout，所以判据只能是「涨不超过 2」，
  写成 `Math.abs(delta) <= 2` 会把「降了 7 个」也判成失败。

## 坑：省电的那一半，要能被量出来

空闲降帧是这么写的（`src/renderer.js`）：

```js
const idleFor = Date.now() - lastMoveAt;
const calm = !dragging && !working && idleFor > 8000;
const wantFps = calm ? Math.min(15, fpsCap) : fpsCap;
const wantRes = calm ? 1 : baseResolution;
```

写得没问题。问题是**没有任何一条断言证明它省了电** —— 代码里写着「省电」，测试里只写着「帧率变了」。
这两件事之间差着一次测量。

### 五条纪律

1. **「活动」的定义要跟产品一致。** 渲染侧的 `lastMoveAt` 只由**主进程推来的全局鼠标坐标**更新
   （`onCursor`，坐标真的变了才重置）。所以改设置、点按钮都不算「主人动了一下」。
   第一版探针用 `settingsPatch` 当活动，帧率一直是 15，我还以为是降帧退不掉 —— 是我判据错了。
   正确做法：`__test:nudge` 走**真实的 cursor 推送路径**，不碰用户的真鼠标。
2. **判据要指向「她自己」。** 全部进程 CPU 之和会被 GPU 进程、Utility 进程稀释；
   真要看她省不省电，得单独看渲染进程（`type` 匹配 `Tab`）那一个数。
3. **指标拿不到时不许当 0。** `Performance.getMetrics` 在这个 Electron 版本上返回 `{}`，
   于是「每秒脚本时间 0 ms」看起来完美 —— 其实一个数都没读到。现在那条改成「有值才判」，
   没值时只打印诊断信息，并另加一条 Tab CPU 断言顶上去。
4. **红证据要能区分「省了」和「没省」。** 把 `calm` 恒定为 `false` 再跑：
   CPU 2.8% → 6.4%、Tab 1.8% → 4.1%、帧率 15 → 30。三个数一起动，说明这条链真的在起作用。
5. **工具自己的重写也要能保住人工说明。** `audit-listeners --write-reg` 原来只写 `counts`，
   把 `except` 里那四条理由一起抹掉。现在重写时读回旧文件，`note` 与 `except` 原样保留。

### 实测（2026-11-15，1920×1080 @100%）

| 场景 | 总 CPU | 渲染进程 CPU | 帧率 | 30 秒内存 |
| --- | --- | --- | --- | --- |
| 空闲（降帧生效） | 2.8% | 1.8% | 15 | +5 MB |
| 空闲（红证据：不降帧） | 6.4% | 4.1% | 30 | +4 MB |

降帧把空闲功耗削掉一半以上。这个数字以前只是「设计上应该省电」。

## 坑：断了线的她，还在装忙

第 39 轮发现的。两件事，一件在脸上，一件在逻辑里。

**一、失败分支是空的。**

```js
fetch(bridgeBase + "/api/health", …)
  .then((r) => r.json())
  .then((j) => {
    const ours = !!(j && j.app === "dsh-phone-bridge");
    const busy = ours && (j.busy === true || Number(j.queued) > 0);
    if (busy) phase = "thinking";
    else if (phase === "thinking") phase = "idle";
  })
  .catch(() => { })          // ← 这里
```

桥一断，`phase` 就永远停在 `thinking`。它同时管两件事：

| 谁在看 | 后果 |
| --- | --- |
| 表情与姿态（`renderer.js` 里 `const thinking = phase === "thinking"`） | 一直挂着思考相 |
| 空闲自言自语（`if (dshPhase === "thinking" \|\| phase === "thinking") return;`） | 她再也不主动说话 |

用户看到的是「她坏了」，日志里一个字都没有。

**二、两个来源观测同一件事，各写一份状态。**

「她在忙」有两个观测点：主进程 watcher 每 2 秒看 DSH 会话文件有没有在写；手机桥每 8 秒说一次 busy。
以前两边都直接写 `phase`，谁最后写谁赢 —— 2 秒一次的 watcher 永远压过 8 秒一次的桥。
实测（假桥一直说 busy）：`phase` 一直是 `idle`，也就是「桥说她在忙，她一脸闲」。

### 四条纪律

1. **连不上要复位状态，不能只记日志。** 失败分支写 `catch(() => { })` 等于「当作没发生」。
2. **两个来源观测同一件事，就各记一个再取并集。** 别让两个地方都写同一个变量，否则比的是谁跑得勤。
3. **断线判定要有次数门槛。** 一次抖动就变脸，用户会觉得她一惊一乍；这里用「连续两次（约 16 秒）」。
4. **假桥也要给 CORS 头。** 页面在 `127.0.0.1:7801`，桥在另一个端口 —— 没有
   `access-control-allow-origin` 时 fetch 被浏览器直接拦掉，报的错和「桥挂了」一模一样，
   我第一版就是这么被绕进去的（7 条红，其中 5 条在查错方向）。

### 红证据（两个方向）

```
=== 红 A：桥断了之后什么都不做（退回空的 catch） ===
❌ 桥断了之后不再挂着思考相  {"phase":"thinking"}
❌ 桥断了之后状态标成断开  {"link":"ok","dshFail":0}
❌ 断的时候她主动说了一句
结果：10 通过，4 失败

=== 红 B：桥说忙，但被 2 秒一次的 watcher 抹掉 ===
❌ 桥说忙的时候她挂着思考相  {"phase":"idle","link":"ok"}
结果：13 通过，1 失败
```

两个方向都要有：只验「断了会复位」会漏掉「忙的判据被抹掉」，只验后者会漏掉前者。

## 坑：偶发崩溃不要当逻辑 bug 追（2026-11-15）

`test:install` 在 round 36 记过一次「24 通过 2 失败」，连跑两次全绿就没再追。round 39 又出现，这次抓住了：

```
❌ 装进中文目录后主程序在目标路径  → E:\Temp\大肥鱼安装回归-mwh97lad\程序目录\大肥鱼.exe
❌ 中文路径安装退出码为 0  → {"ms":2057,"out":"","code":3221225477}
```

`3221225477 = 0xC0000005`（ACCESS_VIOLATION）—— **安装器自己崩了**，只跑了 2057 ms，正常要 96–120 秒。

排查边界（都做过了，别重复）：

1. 连跑 8 轮完整 `test:install` 全绿 → 不是稳定复现；
2. 单做「纯中文路径静默安装」连跑 8 轮（`_tmp\loop-cjk.js`）全绿、105–129 秒 → **中文路径本身没问题**；
3. Windows Application 日志里没有对应事件（WER 没记）。

结论：索引/杀毒与安装器抢刚写出的 1.9 GB 文件时的一次性失败，**不在产品代码里**。

处置两条，都要：

- 测试侧：`runInstaller` 遇到 `0xC0000000` 以上的退出码**重试一次**，`retried / firstCode` 写进 `_tmp\install-report.json` —— 断言要的是「最终装好了」，但证据不许吞掉；
- 用户侧：发布说明「已知限制」写一句「极少数机器上安装器可能异常退出，重跑即可；反复出现就换纯英文路径」。

纪律：**偶发失败先加可诊断性，再决定要不要改产品**。这轮给 `check()` 加 `FAILS[]`、给 `run()` 加 `capture`、失败写 `install-report.json`，加完第一次跑就把 `0xC0000005` 抓出来了 —— 比任何猜测都值钱。

另一条同源的小坑：**测试收尾的 `rmSync` 也要重试**。刚卸载完的目录常被索引/杀毒短暂占住，删一次失败、被 catch 吞掉，就在 `%TEMP%` 留一个空壳（本项目已经积累过一批）。现在统一走 `rmdirHard(dir)`，断言守的是「不留下文件」，不是「目录项必须消失」。
