$ErrorActionPreference = 'Stop'
$repo = 'hanhan9999999999999999999/dafeiyu-desk'
$root = 'D:\document\DSH Live2D\_publish\dafeiyu-desk'
$line = (Select-String -Path "$env:USERPROFILE\.git-credentials" -Pattern 'github.com' | Select-Object -First 1).Line
if ($line -notmatch '^https://([^:]+):([^@]+)@') { throw 'no github credential' }
$tok = $Matches[2]
$H = @{ Authorization = "Bearer $tok"; 'User-Agent' = 'dafeiyu-release'; Accept = 'application/vnd.github+json' }
$api = "https://api.github.com/repos/$repo"

function PostJson($url, $obj, $timeout = 60) {
  $bytes = [Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Depth 8 -Compress))
  Invoke-RestMethod $url -Method Post -Headers $H -Body $bytes -ContentType 'application/json; charset=utf-8' -TimeoutSec $timeout
}

$ref = Invoke-RestMethod "$api/git/ref/heads/main" -Headers $H -TimeoutSec 60
$parent = $ref.object.sha
Write-Host "parent $parent"

Push-Location $root
$files = git ls-files
$tree = @()
$i = 0
foreach ($rel in $files) {
  $i++
  $abs = Join-Path $root ($rel -replace '/', '\')
  $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($abs))
  $blob = PostJson "$api/git/blobs" @{ content = $b64; encoding = 'base64' }
  $mode = if ($rel -match '\.(sh|command)$') { '100755' } else { '100644' }
  $tree += @{ path = $rel; mode = $mode; type = 'blob'; sha = $blob.sha }
  if ($i % 15 -eq 0) { Write-Host "blobs $i/$($files.Count)" }
}
$treeObj = PostJson "$api/git/trees" @{ tree = $tree }
$commit = PostJson "$api/git/commits" @{
  message = '大肥鱼 1.1.2：素材库表情试播、预览清晰度、后台占用与设置页整理'
  tree = $treeObj.sha
  parents = @($parent)
}
PostJson "$api/git/refs/heads/main" @{ sha = $commit.sha; force = $true } | Out-Null
Write-Host "commit $($commit.sha) tree $($treeObj.sha) files $($tree.Count)"
Pop-Location
