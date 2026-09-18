# Bot Link Auto — คู่มือภาษาไทย

## สิ่งที่ต้องมี

- Windows VPS
- Node.js LTS
- บัญชี Telegram ที่เป็นสมาชิกแชทหรือแชนแนลต้นทาง
- Telegram API ID และ API Hash จาก my.telegram.org
- Bot Token ใหม่จาก BotFather สำหรับบอทหน้าร้าน
- Supabase project URL และ Secret key
- Stripe Secret key และ Webhook signing secret
- โดเมน HTTPS ที่ชี้มายัง Dashboard port 8787

## ติดตั้งครั้งแรกจาก GitHub

เปิด PowerShell บน VPS แล้วรัน:

```powershell
git clone https://github.com/maung5678/bot-link-auto.git
cd bot-link-auto
powershell -ExecutionPolicy Bypass -File .\setup-vps.ps1
```

สคริปต์จะถาม Telegram, Supabase, Stripe, URL หน้าเว็บ, รหัสผ่านแอดมิน และติดตั้ง Chromium ให้อัตโนมัติ

## เตรียม Supabase

1. สร้าง Project ใน Supabase
2. เปิด SQL Editor
3. เปิดไฟล์ใน `supabase\migrations` แล้ว Run ตามลำดับชื่อไฟล์ (`001...` แล้ว `002...`)
4. เปิด Connect/API Keys แล้วนำ Project URL และ Secret key ไปกรอกในตัวติดตั้ง
5. ห้ามนำ Secret key ไปใส่ในหน้าเว็บหรือ GitHub

## เตรียม Stripe

1. เริ่มจาก Test mode
2. คัดลอก Secret key (`sk_test_...`)
3. สร้าง webhook endpoint เป็น `https://โดเมนของคุณ/stripe/webhook`
4. เลือก events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded`, `charge.dispute.created`
5. คัดลอก Signing secret (`whsec_...`)
6. ทดสอบการจ่ายครบก่อนเปลี่ยนเป็น Live mode

หลังเตรียม Supabase/Stripe แล้วตรวจทั้งหมดด้วย:

```powershell
npm.cmd run check-config
```

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

Collector จะบันทึกลิงก์ลง Supabase และ `results.jsonl`; ลูกค้าใช้ Sales Bot ซื้อเครดิต/สมาชิกและสุ่มลิงก์ ส่วนผู้ดูแลเปิด `http://localhost:8787/dashboard`

## ไฟล์สำคัญที่ห้ามแชร์

- `.env`
- `telegram.session`
- `results.jsonl`

ถ้าต้องการเห็น Chromium ให้ตอบ `y` ตอน `setup-vps.ps1` ถ้า VPS ทำงานเบื้องหลังให้ตอบ `N`
