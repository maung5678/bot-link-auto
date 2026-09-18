$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'ไม่พบ Node.js กรุณาติดตั้ง Node.js LTS ก่อน แล้วรันสคริปต์นี้ใหม่'
}

$apiId = Read-Host 'TELEGRAM_API_ID'
$apiHash = Read-Host 'TELEGRAM_API_HASH'
$botToken = Read-Host 'TELEGRAM_BOT_TOKEN ใหม่จาก BotFather'
$sourceChats = Read-Host 'แชทต้นทาง (username หรือ ID คั่นด้วย comma, เว้นว่าง=ทุกแชท)'
$supabaseUrl = Read-Host 'SUPABASE_URL'
$supabaseSecret = Read-Host 'SUPABASE_SECRET_KEY (ขึ้นต้น sb_secret_)'
$stripeSecret = Read-Host 'STRIPE_SECRET_KEY (sk_test_ หรือ sk_live_)'
$stripeWebhook = Read-Host 'STRIPE_WEBHOOK_SECRET (whsec_)'
$publicBaseUrl = Read-Host 'PUBLIC_BASE_URL แบบ HTTPS (ไม่ใส่ / ท้าย)'
$adminPassword = Read-Host 'ตั้งรหัสผ่านหน้า Admin Dashboard'
$supportText = Read-Host 'ข้อความติดต่อผู้ดูแล เช่น ติดต่อ @username'
$showBrowser = Read-Host 'แสดงหน้าต่าง Chromium หรือไม่? (y/N)'
$headless = if ($showBrowser -match '^(y|yes)$') { 'false' } else { 'true' }
$extensionPath = Join-Path $PSScriptRoot 'extensions\uBOL'
$resultPath = Join-Path $PSScriptRoot 'results.jsonl'

$envText = @"
TELEGRAM_API_ID=$apiId
TELEGRAM_API_HASH=$apiHash
TELEGRAM_BOT_TOKEN=$botToken
TELEGRAM_RESULT_CHAT=me
TELEGRAM_SOURCE_CHATS=$sourceChats
PLAYWRIGHT_HEADLESS=$headless
UBLOCK_LITE_PATH=$extensionPath
RESULT_FILE=$resultPath
SUPABASE_URL=$supabaseUrl
SUPABASE_SECRET_KEY=$supabaseSecret
STRIPE_SECRET_KEY=$stripeSecret
STRIPE_WEBHOOK_SECRET=$stripeWebhook
PUBLIC_BASE_URL=$publicBaseUrl
DASHBOARD_PORT=8787
ADMIN_PASSWORD=$adminPassword
SUPPORT_TEXT=$supportText
"@
Set-Content -LiteralPath (Join-Path $PSScriptRoot '.env') -Value $envText -Encoding utf8

Write-Host 'กำลังติดตั้ง Node dependencies...'
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci ไม่สำเร็จ' }

Write-Host 'กำลังติดตั้ง Playwright Chromium...'
npx.cmd playwright install chromium
if ($LASTEXITCODE -ne 0) { throw 'ติดตั้ง Chromium ไม่สำเร็จ' }

Write-Host ''
Write-Host 'กำลังสร้าง Shortcut บน Desktop...'
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'install-shortcuts.ps1')

Write-Host ''
Write-Host 'ติดตั้งไฟล์เสร็จแล้ว'
Write-Host 'สำคัญ: เปิด Supabase SQL Editor แล้วรันไฟล์ supabase\migrations\001_initial.sql ก่อนเริ่มระบบ'
Write-Host 'จากนั้นรัน start-bot.cmd เพื่อเริ่ม Collector + Sales Bot + Dashboard'
