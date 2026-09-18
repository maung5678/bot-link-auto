$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'ไม่พบ Node.js กรุณาติดตั้ง Node.js LTS ก่อน แล้วรันสคริปต์นี้ใหม่'
}

$apiId = Read-Host 'TELEGRAM_API_ID'
$apiHash = Read-Host 'TELEGRAM_API_HASH'
$sourceChats = Read-Host 'แชทต้นทาง (username หรือ ID คั่นด้วย comma, เว้นว่าง=ทุกแชท)'
$showBrowser = Read-Host 'แสดงหน้าต่าง Chromium หรือไม่? (y/N)'
$headless = if ($showBrowser -match '^(y|yes)$') { 'false' } else { 'true' }
$extensionPath = Join-Path $PSScriptRoot 'extensions\uBOL'
$resultPath = Join-Path $PSScriptRoot 'results.jsonl'

$envText = @"
TELEGRAM_API_ID=$apiId
TELEGRAM_API_HASH=$apiHash
TELEGRAM_RESULT_CHAT=me
TELEGRAM_SOURCE_CHATS=$sourceChats
PLAYWRIGHT_HEADLESS=$headless
UBLOCK_LITE_PATH=$extensionPath
RESULT_FILE=$resultPath
"@
Set-Content -LiteralPath (Join-Path $PSScriptRoot '.env') -Value $envText -Encoding utf8

Write-Host 'กำลังติดตั้ง Node dependencies...'
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci ไม่สำเร็จ' }

Write-Host 'กำลังติดตั้ง Playwright Chromium...'
npx.cmd playwright install chromium
if ($LASTEXITCODE -ne 0) { throw 'ติดตั้ง Chromium ไม่สำเร็จ' }

Write-Host ''
Write-Host 'ติดตั้งเสร็จแล้ว รัน start-bot.cmd เพื่อเริ่ม userbot'
