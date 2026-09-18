@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\update-vps.ps1"
if errorlevel 1 (
  echo อัปเดตไม่สำเร็จ จึงยังไม่เริ่มบอท
  pause
  exit /b 1
)
call start-bot.cmd
