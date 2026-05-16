@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
title Upload source to Rejsebureau-DK repo

echo =====================================================
echo  Upload full app source to GitHub repo
echo =====================================================
echo.
echo This script copies your local source ZIP/folder into this repo,
echo creates a GitHub Actions Windows installer build, commits and pushes.
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo [ERR] Git is not installed or not in PATH.
  echo Install Git for Windows first.
  pause
  exit /b 1
)

where powershell >nul 2>nul
if errorlevel 1 (
  echo [ERR] powershell.exe not found.
  pause
  exit /b 1
)

set "REPO_URL=https://github.com/jekidev/Rejsebureau-DK-.git"
set "WORK=%USERPROFILE%\Desktop\Rejsebureau-DK-installer-build"

echo Work folder:
echo %WORK%
echo.

if not exist "%WORK%" (
  git clone "%REPO_URL%" "%WORK%"
) else (
  cd /d "%WORK%"
  git pull
)
if errorlevel 1 (
  echo [ERR] Could not clone/pull repo.
  pause
  exit /b 1
)

cd /d "%WORK%"

echo.
echo Paste the path to your FULL SOURCE ZIP or extracted source folder.
echo Example ZIP: C:\Users\JK\Downloads\Telegram_Group_Messenger_Source.zip
echo Example folder: C:\Users\JK\Downloads\dist-premium-fixed-v4\app-source
echo.
set /p "SRC=Source path: "
set "SRC=%SRC:"=%"

if not exist "%SRC%" (
  echo [ERR] Source path does not exist:
  echo %SRC%
  pause
  exit /b 1
)

if exist app-source rmdir /s /q app-source
mkdir app-source

powershell -NoProfile -ExecutionPolicy Bypass -Command "$src=$env:SRC; $dst=Join-Path (Get-Location) 'app-source'; if(Test-Path $src -PathType Leaf){Expand-Archive -LiteralPath $src -DestinationPath $dst -Force}else{Copy-Item -LiteralPath (Join-Path $src '*') -Destination $dst -Recurse -Force}; if(Test-Path (Join-Path $dst 'node_modules')){Remove-Item (Join-Path $dst 'node_modules') -Recurse -Force}; if(Test-Path (Join-Path $dst 'dist')){Remove-Item (Join-Path $dst 'dist') -Recurse -Force}; if(Test-Path (Join-Path $dst 'dist-premium')){Remove-Item (Join-Path $dst 'dist-premium') -Recurse -Force}"
if errorlevel 1 (
  echo [ERR] Failed copying/unzipping source.
  pause
  exit /b 1
)

mkdir .github\workflows 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$y=@'
name: Build Customer Windows Installer

on:
  workflow_dispatch:
  push:
    branches: [ main ]

jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: app-source/package-lock.json

      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'

      - name: Install node dependencies
        working-directory: app-source
        run: npm install

      - name: Build normal Windows setup wizard
        working-directory: app-source
        run: npx electron-builder --win --x64 --config electron-builder.premium.json

      - name: Upload customer installer
        uses: actions/upload-artifact@v4
        with:
          name: Telegram-Group-Messenger-Premium-Customer-Installer
          path: app-source/dist-premium/*.exe
'@; Set-Content -Path '.github/workflows/windows-installer.yml' -Value $y -Encoding UTF8"

git add .
git commit -m "Add app source and customer installer build" 2>nul
git push
if errorlevel 1 (
  echo [ERR] Git push failed. Check login/permissions.
  pause
  exit /b 1
)

echo.
echo [OK] Source uploaded and workflow pushed.
echo Open GitHub Actions in the repo and download the installer artifact when build is done:
echo https://github.com/jekidev/Rejsebureau-DK-/actions
echo.
pause
