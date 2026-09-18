@echo off
chcp 65001 >nul
title อัปเดตและเริ่ม Bot Link Auto
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0console-ui.ps1"
mode con cols=110 lines=35 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\update-vps.ps1"
if errorlevel 1 (
  echo อัปเดตไม่สำเร็จ จึงยังไม่เริ่มบอท
  pause
  exit /b 1
)
call start-bot.cmd
