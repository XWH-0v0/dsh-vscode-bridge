# 把 extension/ 装进 VSCode 的扩展目录。
# 用法：pwsh -File scripts/install.ps1
# 装完必须在 VSCode 里执行一次 "Developer: Reload Window" 才会生效。
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
$folderName = "$($manifest.publisher).$($manifest.name)-$($manifest.version)"
$target = Join-Path $env:USERPROFILE ".vscode\extensions\$folderName"

if (Test-Path $target) {
  Remove-Item $target -Recurse -Force
}
New-Item -ItemType Directory -Path $target | Out-Null
Copy-Item (Join-Path $source '*') $target -Recurse -Force

Write-Host "已安装：$target"
Write-Host "扩展版本：$($manifest.version)"

$instanceDir = Join-Path $env:USERPROFILE '.dsh\vscode-bridge'
if (Test-Path $instanceDir) {
  $instances = Get-ChildItem $instanceDir -Filter 'instance-*.json' -ErrorAction SilentlyContinue
  if ($instances) {
    Write-Host "检测到 $($instances.Count) 个已运行的桥接实例（VSCode 侧的扩展可能还是旧代码）。"
  }
}

if (-not $SkipHint) {
  Write-Host ''
  Write-Host '下一步：在 VSCode 里按 Ctrl+Shift+P，执行 “Developer: Reload Window”。'
  Write-Host '重载后状态栏会出现 “DSH:<端口>”，可点开查看连接信息。'
}
