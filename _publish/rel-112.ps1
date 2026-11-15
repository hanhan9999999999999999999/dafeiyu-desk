$ErrorActionPreference = 'Stop'
$repo = 'hanhan9999999999999999999/dafeiyu-desk'
$line = (Select-String -Path "$env:USERPROFILE\.git-credentials" -Pattern 'github.com' | Select-Object -First 1).Line
if ($line -notmatch '^https://([^:]+):([^@]+)@') { throw 'no github credential' }
$tok = $Matches[2]
$H = @{ Authorization = "Bearer $tok"; 'User-Agent' = 'dafeiyu-release'; Accept = 'application/vnd.github+json' }
$body = @{
  tag_name = 'v1.1.2'
  target_commitish = '3670e87bd3f123ecf65d9f5dd4f795ca2a984320'
  name = 'v1.1.2 · 素材库表情试播、预览清晰度、后台占用'
  draft = $false
  prerelease = $false
  body = @"
## 这一版做了什么

### 修好了「点了没反应」
- 素材库里的表情按钮以前只认 model3.json 声明过的表情，扫描出来的 .exp3.json 会被静默忽略。现在适配器自己读 exp3 并按 Blend 画进模型，未声明的表情也能试播（淡入 0.25s / 保持 2.2s / 淡出 0.35s）。
- 适配器预览改成 2 倍超采样 + mipmap，4096/8192 的大贴图不再糊成一片。

### 设置页更直白
- 「变声引擎」页可以四选一（TTS / RVC / XTTS / 飞鱼），下面跟着显示对应参数；以前只显示当前那套，看起来像功能被砍了。
- 「看屏幕」页写明默认走程序自带的看图逻辑（不需要 Key），外部接口收进折叠区；切回自带会清掉旧配置。

### 后台占用
- 超过 2048 的贴图先缩到 2048 再上 GPU；关适配器、换模型都会释放 WebGL 资源。
- 语音引擎空闲 10 分钟卸载模型，再半分钟连 Python 进程一起退出。
- 开机自启的 reg 调用全部 windowsHide，不再闪控制台窗口。
- 同机实测：冷启动常驻 583 MB（1.1.1 约 1425 MB），适配器关闭后从 2022 MB 回落到 852 MB。

## 安装

| 文件 | 大小 | SHA-256 |
|---|---|---|
| dafeiyu-1.1.2-setup.exe | 940,094,007 B（≈ 896.5 MB） | 27738b161255e05f8eb80875b40bfe46cd700ec68cb93a4e256d11ce0c1da9e9 |

安装包不含任何 Live2D 模型；第一次打开会引导导入你自己的模型（zip 或文件夹）。
程序未做代码签名，SmartScreen 会提示「未知发布者」。
"@
}
$bytes = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Depth 6 -Compress))
$r = Invoke-RestMethod "https://api.github.com/repos/$repo/releases" -Method Post -Headers $H -Body $bytes -ContentType 'application/json; charset=utf-8' -TimeoutSec 60
Write-Host "release id $($r.id) url $($r.html_url)"
