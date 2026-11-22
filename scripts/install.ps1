# 把 extension/ 装进 VSCode 的扩展目录。
# 用法：powershell -File scripts/install.ps1
#
# 安装目录固定为 local.dsh-vscode-bridge（不带版本号）：升级时原地覆盖，路径不变，
# 这样扩展的自更新（触发文件 -> 重启宿主）在跨版本时同样有效。
param(
  [switch]$SkipHint
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $projectRoot 'extension'
$manifestPath = Join-Path $source 'package.json'

if (-not (Test-Path $manifestPath)) {
  throw "找不到扩展清单：$manifestPath"
}

$manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$extRoot = Join-Path $env:USERPROFILE '.vscode\extensions'
$target = Join-Path $extRoot 'local.dsh-vscode-bridge'

# 清理历史版本目录（v0.2.0 及更早按版本号建目录）
Get-ChildItem $extRoot -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match '^local\.dsh-vscode-bridge-\d' } |
  ForEach-Object {
    try {
      Remove-Item $_.FullName -Recurse -Force
      Write-Host "已清理旧版本目录：$($_.Name)"
    } catch {
      Write-Warning "旧版本目录清理失败（可能仍被正在运行的窗口占用）：$($_.Name) — $($_.Exception.Message)"
    }
  }

New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item (Join-Path $source '*') $target -Recurse -Force
Write-Host "已安装：$target（版本 $($manifest.version)）"

# 写重载触发文件：开启了 dshVscodeBridge.hotReload 的窗口会自动重启扩展宿主
$triggerDir = Join-Path $env:USERPROFILE '.dsh\vscode-bridge'
New-Item -ItemType Directory -Path $triggerDir -Force | Out-Null
$trigger = Join-Path $triggerDir 'reload.trigger'
Set-Content -Path $trigger -Value (Get-Date -Format o) -Encoding UTF8
Write-Host "已写触发文件：$trigger"

if (-not $SkipHint) {
  Write-Host ''
  Write-Host '下一步：'
  Write-Host '  - 开启了 dshVscodeBridge.hotReload 的窗口：几秒后自动重启扩展宿主。'
  Write-Host '  - 否则执行一次 “Developer: Reload Window”，或调 vscode_dev(action:"reload")。'
}
