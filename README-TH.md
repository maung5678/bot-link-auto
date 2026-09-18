# VPS Link Bot

## สิ่งที่ต้องมี

- Windows VPS
- Node.js LTS
- บัญชี Telegram ที่เป็นสมาชิกแชทหรือแชนแนลต้นทาง
- Telegram API ID และ API Hash จาก my.telegram.org

## ติดตั้งครั้งแรกจาก GitHub

เปิด PowerShell บน VPS แล้วรัน:

```powershell
git clone https://github.com/maung5678/bot-link-auto.git
cd bot-link-auto
powershell -ExecutionPolicy Bypass -File .\setup-vps.ps1
```

สคริปต์จะถาม API ID, API Hash, แชทต้นทาง และติดตั้ง Chromium ให้อัตโนมัติ

## เริ่มทำงาน

ดับเบิลคลิก `start-bot.cmd` หรือรัน:

```powershell
npm.cmd start
```

## อัปเดตออนไลน์จาก GitHub

หยุดบอทเดิมด้วย `Ctrl+C` แล้วดับเบิลคลิก `update-and-start.cmd` หรือรัน:

```powershell
powershell -ExecutionPolicy Bypass -File .\update-vps.ps1
npm.cmd start
```

ระบบจะ `git pull --ff-only`, ซิงก์ dependencies และตรวจ Chromium ให้อัตโนมัติ โดยไม่ลบ `.env`, `telegram.session` หรือ `results.jsonl`

ครั้งแรกกรอกเบอร์โทร, OTP และรหัส 2FA ในหน้าต่าง Terminal หลังจากนั้นระบบใช้ `telegram.session` อัตโนมัติ

ผลลัพธ์จะส่งเข้า Saved Messages และบันทึกใน `results.jsonl` พร้อมเวลา UTC/เวลาไทย

## ไฟล์สำคัญที่ห้ามแชร์

- `.env`
- `telegram.session`
- `results.jsonl`

ถ้าต้องการเห็น Chromium ให้ตอบ `y` ตอน `setup-vps.ps1` ถ้า VPS ทำงานเบื้องหลังให้ตอบ `N`
