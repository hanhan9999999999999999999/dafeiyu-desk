# 大肥鱼 1.6.6

2026-11-16 · Windows 10 / 11 x64 · 930,574,603 B（约 887.5 MB）

这一版只修**「看屏幕」把 DSH 的 token 用得像流水**这一件事，不动界面、不动对话手感、
不动语音。装上之后你能感知到的只有一处：看屏幕时 DSH 的用量不再一天几十万地涨，
而且同一个「看屏幕会话」会一直被沿用，直到它真的太长才换新的。

- 安装包在 Release 里叫 `dafeiyu-desk-setup-1.6.6.exe`（本地打包产物名是 `大肥鱼-1.6.6-安装包.exe`，同一份文件；资产名用 ASCII 是为了自动更新能按 `latest.yml` 里的 path 取到）
- SHA-256 `53CB11AE4F96DBC6C3BC3CC3066EE84FA43F7BAC669F2C8C6B3DD861BBFA2856`
- 核对：`Get-FileHash .\dafeiyu-desk-setup-1.6.6.exe -Algorithm SHA256`

逐条技术细节见 [CHANGELOG 的 1.6.6 一节](../CHANGELOG.md)，这里按「你会感知到什么」重排。

## 一、你感知到的变化

- **用量掉下来**：以前每一眼都是一次新会话（`cached 0`，提示词全量重发）；
  现在一个会话连用 40 轮、或上下文过 6 万、或挂了 6 小时才轮换。
- **慢慢看的时候更省**：画面没什么变化，间隔会自己拉长到最多 6 倍；
  有东西动了立刻恢复原来的节奏。另外加了每小时硬上限（默认 60 眼），到点了照样刷新画面，只是这一眼不问模型。
- **点开「看屏幕」不再先卡 75 秒**：以前每一眼都先对自带的迷你桥试一次只有别处才有的接口，
  失败后再退回来；现在先比地址，认得出是迷你桥就直接走对的那条路。
- **不再白起一个子进程**：以前程序一启动就无条件预热，你一眼都没看也白起一个 DSH；
  现在打开「看屏幕」时才预热。
- **看屏幕的用量进了主账本**：设置页的用量统计里能看见 `deepseek-flash · 看屏幕` 这一行，
  以前它只记在桥的内存里，关掉就没了。

## 二、病根：五处，最靠前的是回调没被调用

单轮其实不贵（input 250–450 tokens）。贵在**频次**（1.6 秒截一帧、最快 3 秒问一次模型）
和**每次都开一个新会话**。查下来是这五处叠在一起：

1. `bridge/runner-sdk.mjs` 的 `runTurn()` 声明了 `onSession` 回调，可整个文件里**没有一处调用它**。
   桥每轮只能拿到自己刚生成的 `session-<uuid>`，上层记不住 → 每轮都是新会话。
2. 桥把会话号只放在内存（`visionSessionId`）里，进程一退就丢 → 大肥鱼重启一次，看屏幕就换一次会话。
3. 桥 `server.listen` 之后 `setTimeout(..., 6000)` 无条件预热：用户一眼都没看，也白起一个 DSH 子进程 + 一个新会话。
4. 设置里的桥接地址指着自带的迷你桥（8898），那条路只有 `/api/vision`、没有 `/api/upload`；
   `seeAnalyze` 却总是先试 `/api/upload`，于是每一眼都先白失败一次。
5. 看屏幕的用量只记在桥的内存里。`noteUsage` 明明打了 `· 看屏幕` 标签，却进不了主账本 `usage.json`。

## 三、实测数字

同一台机器、同一个模型（`deepseek-flash`），临时数据目录 + 独立端口跑：

- 预热：`> 60s` 不返回 → **2.2s** 返回。
- 连打两轮：同一个 `session-df455fa1-…`，`turns 1 → 2`，用量账本里两条 `deepseek-flash · 看屏幕`。
- 把桥杀掉再起：`/api/vision/state` 立刻回同一个号，第三轮还是它 → **「重启即换会话」消失**。
- 预置 `turns: 40` 再打：换到新号、`turns` 归 1，落盘文件同步 → 轮换生效。
- `node --check` 三个改动文件全过；`npm test` 与 `npm run verify:src`（1058 通过 / 0 失败）全绿。

## 四、额外加了一个 profile：`phone-sdk`

桥要跟 DSH 走 stdio JSON-RPC，靠的是插件 `@deepseek-ai/dsh-sdk-jsonrpc-server`。
它是插件、不是 bundle，塞进 `package.json` 的 `bundles` 不会被加载——必须写进
`cordis.patch.yml` 的 `insert` 列表。

原来的 `phone-lite` 是另一个项目自动维护的（里面还指向一个已经不存在的 MCP 脚本），所以这次**另建**
`D:\dsh-home\profiles\phone-sdk\`：phone-lite 的精简副本，只留模型
（`deepseek-account` / `deepseek-flash` / `reasoningEffort: low`）、账号、权限，最后挂上 JSON-RPC。
省掉 151 个技能的目录 token（首轮成本），也避开了那些外部绝对路径。
`phone-lite` 一个字节都没动，随时可以并回去。

## 五、装之前 / 装之后

- **覆盖安装**：直接运行安装包即可，用户数据（设置、聊天记录、模型包）在 `%APPDATA%\dafeiyu-desk`，
  卸载与覆盖都不会删（`deleteAppDataOnUninstall: false`）。
- **生效方式**：装完启动就是新的，不用改任何设置；会话号落在
  `%APPDATA%\dafeiyu-desk\vision-session.json`，第一次是空的，之后跨重启沿用。
- **想看它现在用的哪个会话**：`http://127.0.0.1:8898/api/vision/state`（迷你桥起来时）。
- **回滚**：装回 1.6.5 的安装包即可。`vision-session.json` 与 `bridge-usage.json` 对旧版是陌生文件，
  旧版不会读，留着无害。

## 六、这个包仍然没有签名

构建里 `signAndEditExecutable: true` 会把图标与版本资源写进 exe（主程序版本资源为 `1.6.6`，
公司名「小代码酱」，产品名「大肥鱼」），但**没有 Authenticode 证书**，`forceCodeSigning: false`
所以能正常出包。第一次运行时 SmartScreen 会拦一次「Windows 已保护你的电脑」，
点「更多信息 → 仍要运行」即可；企业策略下可能直接不让装。
证书怎么买、怎么接进构建机见 [发行-签名与密钥](发行-签名与密钥.md)。
