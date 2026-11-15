# Windows SAPI / OneCore 语音合成兜底 worker（常驻）
#
# 为什么有这个文件：Edge TTS 要走网、要连微软的 websocket，断网或者对面抽风就会失败。
# 那时候如果什么都不剩，用户看到的就是「她不会说话」——比音质差得多。
# 这个用系统自带的语音引擎，离线可用，声音是机械的，但至少能出声。
#
# 协议（和 tts.mjs 对齐，别改）：
#   启动    → 输出一行 READY
#   请求    → <b64文本>|<b64输出路径>|<b64音色>\n     （路径里的反斜杠已被调用方换成 /）
#   响应    → OK|<耗时ms>|<字节数>|<实际用的音色>
#   失败    → ERR|<说明>
#
# 注意：这个文件必须存成 UTF-8 with BOM。Windows PowerShell 5.1 读 .ps1 默认按 ANSI，
# 无 BOM 的中文注释会把引号吃掉、整个脚本语法崩（这个坑踩过，别再删 BOM）。

[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding = [Text.Encoding]::UTF8

$ErrorActionPreference = "Continue"

function B64Decode([string]$s) {
    if ([string]::IsNullOrEmpty($s)) { return "" }
    return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s))
}

function Reply([string]$line) {
    [Console]::Out.WriteLine($line)
    [Console]::Out.Flush()
}

try {
    Add-Type -AssemblyName System.Speech | Out-Null
} catch {
    Reply "ERR|System.Speech load failed: $($_.Exception.Message)"
    exit 1
}

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer

# 列出可用的中文声音，找个默认的
$zhVoice = ""
try {
    $installed = $synth.GetInstalledVoices()
    foreach ($x in $installed) {
        if ($x.Enabled -and $x.VoiceInfo.Culture.Name -like "zh-*") {
            $zhVoice = $x.VoiceInfo.Name
            break
        }
    }
} catch { }

Reply "READY"

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line -eq "") { continue }

    $parts = $line.Split("|")
    if ($parts.Length -lt 3) { Reply "ERR|bad request"; continue }

    try {
        $text = B64Decode $parts[0]
        $outPath = (B64Decode $parts[1]).Replace("/", "\")
        $want = B64Decode $parts[2]

        if ([string]::IsNullOrWhiteSpace($text)) { Reply "ERR|empty text"; continue }

        # 选音色：调用方给的名字优先，找不到就用默认中文
        $use = ""
        if ($want) {
            if ($zhVoice -and ($want -notmatch "^Microsoft")) {
                # 老式短名（Huihui/Yaoyao/Kangkang）→ 拼成完整名再试
                $cand = "Microsoft $want Desktop"
                try { $synth.SelectVoice($cand); $use = $cand } catch { $use = "" }
            }
            if (-not $use) {
                try { $synth.SelectVoice($want); $use = $want } catch { $use = "" }
            }
        }
        if (-not $use -and $zhVoice) {
            try { $synth.SelectVoice($zhVoice); $use = $zhVoice } catch { }
        }
        if (-not $use) { $use = "(default)" }

        $sw = [Diagnostics.Stopwatch]::StartNew()
        $synth.SetOutputToWaveFile($outPath)
        $synth.Speak($text)
        $synth.SetOutputToNull()
        $sw.Stop()

        if (-not (Test-Path $outPath)) { Reply "ERR|no file produced"; continue }
        $sz = (Get-Item $outPath).Length
        Reply "OK|$([int]$sw.ElapsedMilliseconds)|$sz|$use"
    } catch {
        $msg = $_.Exception.Message -replace "[\r\n]+", " "
        Reply "ERR|$msg"
    }
}

try { $synth.Dispose() } catch { }
