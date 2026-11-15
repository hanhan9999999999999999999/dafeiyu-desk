$ErrorActionPreference = 'Stop'
$repo = 'hanhan9999999999999999999/dafeiyu-desk'
$line = (Select-String -Path "$env:USERPROFILE\.git-credentials" -Pattern 'github.com' | Select-Object -First 1).Line
if ($line -notmatch '^https://([^:]+):([^@]+)@') { throw 'no github credential' }
$tok = $Matches[2]
$H = @{ Authorization = "Bearer $tok"; 'User-Agent' = 'dafeiyu-release'; Accept = 'application/vnd.github+json' }
$body = @{
  tag_name = 'v1.1.3'
  target_commitish = 'b519055c9a0cce54d7b99e276c260e8a5f7e9dc4'
  name = 'v1.1.3 · 坏模型包说清楚、预热可选、内存再降'
  draft = $false
  prerelease = $false
  body = @"
## 这一版做了什么

### 坏掉的模型包不再含糊
- 升级后残留的 models\<id>\pet.json 只剩配置、没有 .moc3 / 贴图。以前诊断报「缺 5 个必需参数」，像没适配好；现在直接报「模型文件不存在（只剩配置）—— 重新导入完整模型」，并且不允许应用。
- 适配器模型库给这类包加红色「缺模型文件」标签，选中后预览区说明原因、保存和应用按钮变灰，不再弹 Network error。
- 换模型时顶部贴图/参数/动作组/表情统计会先清空，不再显示上一只模型的数字。

### 语音预热改成可选（默认关）
- 飞鱼装进显存约 8GB，只偶尔说话的人不该开机就付这笔钱。开关在「声音与行为 → 变声引擎 → 启动时预热」。
- 打开后第一句更快；关掉会立刻让引擎卸载模型，自己拉起的服务进程 1.2 秒后退出。按麦克风或叫出输入条时会自动预热，正常聊天不受影响。

### 内存
- Cubism 的 WASM 堆 256MB → 128MB，渲染进程 JS 堆实测 558MB → 300MB。
- 打包版冷启动 Electron 五进程约 800MB（1.1.1 约 1425MB）；DSH 桥接的 node 进程另算（约 220MB）。
- 关闭适配器不再刷一屏 Pixi Assets 警告。

## 安装

| 文件 | 大小 | SHA-256 |
|---|---|---|
| dafeiyu-1.1.3-setup.exe | 940,097,859 B（≈ 896.5 MB） | 994958b8dfe3fcec622ec44f0204b6e4296e2a968939b5e221f18bce10569af9 |

安装包不含任何 Live2D 模型；第一次打开会引导导入你自己的模型（zip 或文件夹）。
程序未做代码签名，SmartScreen 会提示「未知发布者」。
"@
}
$bytes = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Depth 6 -Compress))
$r = Invoke-RestMethod "https://api.github.com/repos/$repo/releases" -Method Post -Headers $H -Body $bytes -ContentType 'application/json; charset=utf-8' -TimeoutSec 60
Write-Host "release id $($r.id) url $($r.html_url)"
