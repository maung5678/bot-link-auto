@echo off
cd /d "%~dp0"
if not exist ".env" (
  echo ไม่พบ .env กรุณารัน setup-vps.ps1 ก่อน
  pause
  exit /b 1
)
npm.cmd start
pause
