$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot '.git'))) {
  throw 'โฟลเดอร์นี้ไม่ได้ติดตั้งผ่าน git clone กรุณา clone repository บน VPS ก่อน'
}

Write-Host 'กำลังตรวจและดึง source รุ่นล่าสุดจาก GitHub...'
git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw 'git pull ไม่สำเร็จ' }

Write-Host 'กำลังซิงก์ Node dependencies...'
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci ไม่สำเร็จ' }

Write-Host 'กำลังตรวจ Playwright Chromium...'
npx.cmd playwright install chromium
if ($LASTEXITCODE -ne 0) { throw 'ติดตั้ง Chromium ไม่สำเร็จ' }

Write-Host 'อัปเดตเสร็จแล้ว ข้อมูล .env, session และ results ยังอยู่ครบ'
