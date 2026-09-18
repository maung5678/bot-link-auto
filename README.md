# Bot Link Auto

Windows VPS Telegram userbot สำหรับรับลิงก์ `oklink2.online`, เปิดผ่าน Playwright, ดึงลิงก์แรกจาก `filevideo.net`, จับ Telegram bot deep link และบันทึกผลพร้อมเวลาไทย

## ติดตั้งบน Windows VPS

Repository นี้เป็น private จึงต้องล็อกอิน GitHub หรือกำหนด SSH deploy key/PAT แบบ read-only บน VPS ก่อน `clone` และ `pull`

```powershell
git clone https://github.com/maung5678/bot-link-auto.git
cd bot-link-auto
powershell -ExecutionPolicy Bypass -File .\setup-vps.ps1
```

เริ่มบอท:

```powershell
.\start-bot.cmd
```

## ดึงฟีเจอร์รุ่นล่าสุดและเริ่มใหม่

หยุด instance เดิมด้วย `Ctrl+C` แล้วรัน:

```powershell
.\update-and-start.cmd
```

หรืออัปเดตอย่างเดียว:

```powershell
powershell -ExecutionPolicy Bypass -File .\update-vps.ps1
```

ไฟล์ `.env`, `telegram.session` และ `results.jsonl` ถูก ignore และจะไม่ถูกเขียนทับจาก GitHub

ดูรายละเอียดเพิ่มเติมใน [README-TH.md](README-TH.md)
