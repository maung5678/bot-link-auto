$desktop = [Environment]::GetFolderPath('Desktop')
$shell = New-Object -ComObject WScript.Shell

$startShortcut = $shell.CreateShortcut((Join-Path $desktop 'เริ่ม Bot Link Auto.lnk'))
$startShortcut.TargetPath = (Join-Path $PSScriptRoot 'start-bot.cmd')
$startShortcut.WorkingDirectory = $PSScriptRoot
$startShortcut.Description = 'เริ่ม Collector, Sales Bot และ Dashboard'
$startShortcut.Save()

$dashboardShortcut = $shell.CreateShortcut((Join-Path $desktop 'เปิด Dashboard Bot Link Auto.lnk'))
$dashboardShortcut.TargetPath = (Join-Path $PSScriptRoot 'start-dashboard.cmd')
$dashboardShortcut.WorkingDirectory = $PSScriptRoot
$dashboardShortcut.Description = 'เปิดหน้า Dashboard ภาษาไทย'
$dashboardShortcut.Save()

Write-Host 'สร้าง Shortcut บน Desktop เรียบร้อยแล้ว'
