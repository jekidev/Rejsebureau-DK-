param(
  [string]$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
)

$ErrorActionPreference = "Stop"

Push-Location $ProjectDir
try {
  npm install
  npm run build

  $desktop = [Environment]::GetFolderPath("Desktop")
  $installer = Join-Path $ProjectDir "dist\\Telegram Group Messenger Setup 1.0.0.exe"
  if (!(Test-Path $installer)) {
    throw "Installer not found at $installer"
  }

  Copy-Item -Force $installer -Destination (Join-Path $desktop (Split-Path $installer -Leaf))
  Write-Host ("Copied installer to: " + (Join-Path $desktop (Split-Path $installer -Leaf)))
} finally {
  Pop-Location
}

