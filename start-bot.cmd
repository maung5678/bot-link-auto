@echo off
chcp 65001 >nul
title Bot Link Auto - ภาษาไทย
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0console-ui.ps1"
mode con cols=110 lines=35 >nul
set NODE_OPTIONS=--enable-source-maps
cd /d "%~dp0"
if not exist ".env" (
  echo ไม่พบ .env กรุณารัน setup-vps.ps1 ก่อน
  pause
  exit /b 1
)
npm.cmd start
pause
