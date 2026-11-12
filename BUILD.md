# 构建与打包

## 环境

| 项 | 要求 |
|---|---|
| 系统 | Windows 10 / 11 x64 |
| Node.js | 20 LTS 或更新（开发机实测 22 / 24） |
| Electron | 35.x（把官方 `electron-v35.7.5-win32-x64` 解压到 `_app/runtime/`） |
| Python | 仅打包 RVC / XTTS / 飞鱼引擎时需要；不装也能跑「基础 + Edge TTS」 |
| 磁盘 | 源码约 3 MB；依赖 + 运行时 + 产物约 4 GB |

## 1. 准备运行时

`package.json` 里 `electronDist: "runtime"`，构建不会去 GitHub 下载 Electron：

```
_app/runtime/
├── electron.exe
├── resources/default_app.asar
└── ...（官方 zip 解压后的全部文件）
```

> 只保留 `resources/default_app.asar`，清掉 `runtime/resources/` 里的其他残留——它们会被原样复制进安装目录。

## 2. 准备 Live2D 引擎文件

仓库**不包含** Live2D Cubism Core（专有许可，不可再分发）。构建前自行取得：

1. 从 [Live2D Cubism SDK for Web](https://www.live2d.com/sdk/download/web/) 下载 SDK；
2. 把 `Core/live2dcubismcore.min.js` 放进 `_app/vendor/`；
3. `_app/vendor/live2d-vendor.js` 已包含 PixiJS 与 pixi-live2d-display 的打包结果，仓库内保留。

缺 Core 的表现：模型加载时报 `Live2DCubismCore is not defined`。

## 3. 安装依赖

```bash
cd _app
npm install
```

`node_modules` 只用于 electron-builder 与自检脚本，不会进安装包（`build.files` 是白名单）。

## 4. 自检

```bash
npm run verify:src     # 页面 CSP、脚本引用、IPC 通道、元素 id
npm run verify:packs   # 语义槽、规则形状、清单往返、内置包实测、曲线覆盖率
npm run build          # electron-builder --win --x64
npm run verify:pack    # 产物：该有的文件都有，模型文件一个都没有
npm run verify         # 三段串跑
```

`verify:pack` 的三条红线：

- `resources/model` 目录不存在
- `resources` 下没有散落的 `.moc3` / `.model3.json`
- `app.asar` 里没有 `.moc3` / `.model3.json`

## 5. 开发态启动

本机若设置了 `ELECTRON_RUN_AS_NODE=1`（很多 Electron 工具链会设），必须先清掉，否则 `electron.exe` 会当 Node 跑：

```powershell
$env:ELECTRON_RUN_AS_NODE = $null
Start-Process -FilePath ".\runtime\electron.exe" -ArgumentList "." -WorkingDirectory (Get-Location)
```

或直接用仓库外的启动脚本（会替你清）。

## 6. 打包产物

```
dist/
├── 大肥鱼-<version>-安装包.exe
├── 大肥鱼-<version>-安装包.exe.blockmap
├── win-unpacked/            # 免安装版，可直接跑
└── builder-effective-config.yaml
```

签名相关：

- `signAndEditExecutable: false`，exe 的图标 / 版本信息由 `scripts/afterpack.js` 调 `tools/rcedit.exe` 补；
- 没有证书时 `signing is skipped`，安装包可用，但 SmartScreen 会提示未知发布者；
- 有 OV / EV 证书时，在 `electron-builder` 配置里补 `win.certificateFile` / `CSC_LINK` 即可。

## 7. 常见问题

| 现象 | 原因 |
|---|---|
| 双击 exe 没窗口、进程 0 | 单实例锁：已有 `大肥鱼.exe` / `electron.exe` 在跑。先全部结束再启动 |
| 启动报 `Cannot find module 'electron'` | `ELECTRON_RUN_AS_NODE` 没清 |
| 白屏 | 页面 CSP 少 `worker-src` / `unsafe-eval` / `media-src` 之一 |
| 模型 404 | 包目录里没有 `.moc3` / `model3.json`（1.1.0 起安装包不带模型，需要用户导入） |
| 打包后开机自启失效 | 打包版启动命令不能再带项目目录参数（见 `main.js` 的 `app.isPackaged` 分支） |
