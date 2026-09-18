@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "DASHBOARD_PORT=8787"
for /f "tokens=1,* delims==" %%A in ('findstr /b "DASHBOARD_PORT=" ".env" 2^>nul') do set "DASHBOARD_PORT=%%B"
start "" "http://localhost:%DASHBOARD_PORT%/dashboard"
