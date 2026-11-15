# 构建与自检

这份文档只讲「怎么把大肥鱼跑起来、怎么确认它没坏、怎么打出安装包」。
产品功能与使用方式见 [README.md](README.md)，版本变更见 [../CHANGELOG.md](../CHANGELOG.md)。

## 环境

- Windows 10 / 11 x64（只在这个平台打包与测试）
- Node.js 20 或更高（`node -v` 确认）
- 约 3 GB 空闲磁盘（依赖 + 打包产物）
- 打包与 `verify:ui` 需要真实的桌面会话，不能在无显示的 CI 容器里跑

## 安装依赖

```bash
cd _app
npm install
```

`npm install` 只装 `electron-builder`。Electron 运行时有两种来源：

- 仓库开发机常见的便携版：放在 `_app/runtime/`（已在 `.gitignore` 里），`npm start` 直接用；
- 干净 clone：用 npx 拉取与产品一致的 Electron 版本：

```bash
npx --yes electron@35.7.5 .
```

产品固定 Electron 35.7.5；换版本会改变渲染与原生窗口行为，发版前不要顺手升级。

## 自检

```bash
npm run verify        # 静态 + 服务 + 养成逻辑，约 20 秒
npm run verify:ui     # 真机 UI 验收，约 60 秒，会短暂弹出桌宠窗口
npm run test:install  # 安装/卸载回归，约 1–2 分钟，只动临时目录与临时快捷方式
npm run test:persist  # 设置持久化：改音量与缩放 → 重启 → 值还在 → 恢复默认，约 30 秒
```

`verify` 依次跑：

| 命令 | 查什么 |
| --- | --- |
| `verify:src` | 页面 CSP、引用文件、IPC 桥接、`getElementById`、README 相对链接、两份 LICENSE 是否一致、CHANGELOG 版本段、HTML 引用的脚本是否存在 |
| `verify:packs` | 模型包解析与 zip 条目名的各种写法 |
| `verify:pack` | 打包产物红线：不含模型、许可与运行时齐全、安装目录没有调试日志、`docs/RELEASE-<版本>.md` 的体积与 SHA-256 和安装包一致 |
| `verify:server` | 本地桥接的 HTTP 行为与异常输入 |
| `test` | 养成数值（10 项）、设置迁移（7 项）、右键菜单模板（11 项）与检查更新分支（26 项） |
| `test:install` | 静默安装到临时目录、桌面/开始菜单快捷方式、安装版启动、静默卸载与目录清理（13 项） |
| `test:persist` | 改成 37% 音量与 1.15 缩放后退出，用同一 userData 再启动，确认值还在、恢复默认回到 0.85/1（8 项） |

`verify:ui` 启动源码版应用，用 CDP 走一遍真机交互：相处档案（480×706、标题栏可拖、正文不溢出、Esc 关窗）、
托盘快捷互动（喂食 / 冷却说明 / 摸摸头）、养成面板的 Tab/Enter/焦点环与读屏原因、许可弹层只关自身、
连接地址行键盘选择、看屏幕说明随桥接/外部接口切换、三个辅助窗口的焦点环、右键菜单真弹出、最小化与锁屏暂停/恢复、
四个窗口反复开关 12 次不叠窗。
它把结果写成 55 条断言；任何一条失败都会以退出码 1 结束，并留下 `_shots/profile-ui.png` 供人工复核。

单跑某个探针时用 `scripts/smoke-electron.js`：

```bash
node scripts/smoke-electron.js --wait 7000 --shot _shots/main.png
node scripts/smoke-electron.js --eval-file scripts/ui/open-profile.js --eval-wins "profile=@scripts/ui/inspect-profile.js"
node scripts/smoke-electron.js --main-eval-file scripts/ui/quick-pet-esc.js
```

冒烟脚本会清理 `ELECTRON_RUN_AS_NODE` 等会毒化 Electron 启动的环境变量，并占用 9231（渲染进程）/
9232（主进程）两个调试端口；跑之前先关掉旧的调试实例。

## 打包

```bash
npm run build
```

产物在 `dist/`：

- `大肥鱼-1.3.0-安装包.exe` —— 给用户下载的中文名安装包，约 900 MB；
- `dafeiyu-desk-setup-1.3.0.exe` —— 同一文件的硬链接，自动更新 `latest.yml` 指向它，避免非 ASCII 文件名；
- `win-unpacked/` —— 未压缩目录，排障时直接跑里面的 `大肥鱼.exe`。

`scripts/fix-latest.js` 会在打包后建硬链接并改写 `latest.yml`；跨卷或权限不允许硬链接时退回复制。
`scripts/afterpack.js` 负责写入 exe 图标与版本信息（依赖 `tools/rcedit.exe`），并清掉安装目录根部的 `*.log`
（`electron-builder` 会把整个 `runtime/` 复制进去，开发机的 `debug.log` 会跟着进包）。

### 发版打包：release:bundle

```bash
npm run release:bundle
```

核对 `latest.yml` 的 version / path / size / sha512、安装包与 `docs/RELEASE-<版本>.md` 的体积和 SHA-256，
把要上传的东西收进 `dist/release-<版本>/`：ASCII 安装包（硬链接，不占第二份空间）、`.blockmap`、
`latest.yml`、`RELEASE-NOTES.md`、`release-manifest.json`。任何一项对不上就以退出码 1 结束——这时不要上传。
全部通过后会打印一条 `gh release create` 命令，复制即可。

### 打包后必做：干净用户目录里的首启

开发和打包版共用同一份 `%APPDATA%\大肥鱼`，本机的模型缓存会掩盖「新用户第一次打开」的问题。
发版前用一份临时 user-data 跑一次打包产物：

```bash
node scripts/smoke-electron.js --exe "dist/win-unpacked/大肥鱼.exe" \
  --user-data _tmp/fresh --wait 9000 \
  --main-eval-file scripts/ui/list-wins.js
```

预期：`count: 2`（`welcome.html` 400×~430 + `index.html`），汇总里「空状态卡」为
「显示（没有可用模型）」、「错误」为「无」。三样有任何一样不对就先别发版。

### 安装包不包含模型

这是发版红线，不是可选项：

- `resources/model` 不存在；
- `resources` 下没有散落的 `.moc3` / `.model3.json`；
- `app.asar` 里没有 `.moc3` / `.model3.json`。

`verify:pack` 会逐条检查。模型由用户通过「模型适配器 → 导入」装进
`%APPDATA%\dafeiyu-desk\models`，程序只做本机复制。原因与条款见 [LICENSE.txt](LICENSE.txt) 第二节。

## 目录

```text
_app/
├─ src/           主进程、preload、渲染进程与各面板（31 个文件，无构建步骤）
├─ assets/        图标、许可、截图等随包资源
├─ scripts/       自检、冒烟、打包钩子
│  └─ ui/         真机 UI 验收探针
├─ vendor/        PixiJS 与 Live2D Cubism Core
├─ bridge/        迷你本地桥接（可选，8899）
├─ model/         开发用模型配置（.moc3 与贴图不入库）
└─ runtime/       便携版 Electron（不入库）
```

## 常见问题

**控制台中文是乱码？**
PowerShell 默认按 GBK 解码 UTF-8 输出，文件本身没坏。用 `node -e` 读 JSON，或把输出重定向到文件再看。

**`npm start` 报找不到 `runtime\electron.exe`？**
这份 clone 没带便携运行时，用上面的 `npx electron@35.7.5 .`，或自己放一份到 `runtime/`。

**冒烟起不来（退出码 2）？**
先看 9231 / 9232 是否被占用；再从普通 PowerShell 窗口跑一次，确认不是被 IDE 注入的环境变量影响。

**安装包为什么这么大？**
带 Electron 运行时、Node 依赖与语音引擎。模型不在里面。
