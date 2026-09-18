# Bot Link Auto

ระบบขายลิงก์สินค้าทั่วไปที่ได้รับอนุญาต ประกอบด้วย Collector, Telegram Sales Bot, Stripe Checkout, Supabase และ Admin Dashboard ภาษาไทย

## ติดตั้งบน Windows VPS

Repository นี้เป็น public จึง `clone` และ `pull` บน VPS ได้โดยไม่ต้องล็อกอิน GitHub

```powershell
git clone https://github.com/maung5678/bot-link-auto.git
cd bot-link-auto
powershell -ExecutionPolicy Bypass -File .\setup-vps.ps1
```

ก่อนเริ่มระบบ ให้สร้าง Supabase project แล้วเปิด SQL Editor จากนั้นคัดลอกและ Run ไฟล์ `supabase/migrations/001_initial.sql` ทั้งไฟล์

ตั้ง Stripe webhook ให้ส่ง `checkout.session.completed` มาที่:

```text
https://YOUR-DOMAIN/stripe/webhook
```

แล้วนำ Signing secret (`whsec_...`) มาใส่ตอนรัน `setup-vps.ps1` หน้า Dashboard และ webhook ต้องอยู่หลัง HTTPS reverse proxy/tunnel ที่เชื่อถือได้

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

ระบบนี้ต้องใช้กับสินค้าที่ถูกกฎหมายและผู้ขายมีสิทธิ์จัดจำหน่ายเท่านั้น ห้ามใช้ Stripe กับเนื้อหาหรือธุรกิจที่อยู่ในรายการต้องห้ามของ Stripe

ดูรายละเอียดเพิ่มเติมใน [README-TH.md](README-TH.md)
