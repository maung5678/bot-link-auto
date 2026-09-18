'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const Stripe = require('stripe');
const { supabase, must, setRuntime } = require('./supabase-client');
const bot = require('./bot-api');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');
const PORT = Number(process.env.DASHBOARD_PORT || 8787);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const sessions = new Map();
const dashboardHtml = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');

function send(res, status, body, type = 'application/json; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'content-type': type, 'x-content-type-options': 'nosniff', ...headers });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (chunk) => { size += chunk.length; if (size > 1024 * 1024) reject(new Error('body too large')); else chunks.push(chunk); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map((x) => x.trim().split('=').map(decodeURIComponent)).filter((x) => x.length === 2));
}
function authed(req) {
  const token = cookies(req).admin_session;
  const expires = token && sessions.get(token);
  if (!expires || expires < Date.now()) { if (token) sessions.delete(token); return false; }
  return true;
}
async function jsonBody(req) {
  const raw = await readBody(req);
  return raw.length ? JSON.parse(raw.toString('utf8')) : {};
}

async function stripeWebhook(req, res) {
  const raw = await readBody(req);
  let event;
  try {
    event = stripe.webhooks.constructEvent(raw, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET || '');
  } catch (error) {
    return send(res, 400, { error: `Webhook signature: ${error.message}` });
  }
  if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type) && event.data.object.payment_status === 'paid') {
    const checkout = event.data.object;
    const paymentId = checkout.metadata && checkout.metadata.payment_id;
    if (paymentId) {
      const payment = await must(await supabase.from('payments').select('id,user_id,amount_thb,status').eq('id', paymentId).single(), 'ตรวจรายการชำระเงิน');
      if (checkout.currency !== 'thb' || checkout.amount_total !== payment.amount_thb * 100) {
        throw new Error(`ยอดหรือสกุลเงินไม่ตรง payment=${paymentId}`);
      }
      const result = await must(await supabase.rpc('fulfill_payment', {
        p_payment_id: paymentId, p_event_id: event.id,
        p_intent_id: typeof checkout.payment_intent === 'string' ? checkout.payment_intent : null
      }), 'ยืนยันการชำระเงิน');
      if (!result.error && !result.already_paid) {
        await bot.sendMessage(result.user_id, `ชำระเงินสำเร็จ ✅\nแพ็กเกจ: ${result.package_name}\nเครดิต/สมาชิกถูกเพิ่มในบัญชีแล้ว`, {
          reply_markup: { inline_keyboard: [[{ text: '🎲 สุ่มลิงก์', callback_data: 'random' }, { text: '👤 ดูบัญชี', callback_data: 'account' }]] }
        }).catch((error) => console.error('[payment notify]', error.message));
      }
    }
  }
  if (event.type === 'checkout.session.async_payment_failed') {
    const paymentId = event.data.object.metadata && event.data.object.metadata.payment_id;
    if (paymentId) await must(await supabase.from('payments').update({ status: 'cancelled' }).eq('id', paymentId).eq('status', 'pending'), 'บันทึกการจ่ายไม่สำเร็จ');
  }
  if (event.type === 'charge.refunded') {
    const charge = event.data.object;
    if (charge.payment_intent) await must(await supabase.from('payments').update({ status: 'refunded', stripe_charge_id: charge.id }).eq('stripe_payment_intent_id', charge.payment_intent), 'บันทึก refund');
    await setRuntime('stripe_alert', 'warning', `มี refund: ${charge.id}`);
  }
  if (event.type === 'charge.dispute.created') {
    const dispute = event.data.object;
    const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge && dispute.charge.id;
    const intentId = typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent && dispute.payment_intent.id;
    if (intentId) await must(await supabase.from('payments').update({ status: 'disputed', stripe_charge_id: chargeId || null }).eq('stripe_payment_intent_id', intentId), 'บันทึก dispute');
    await setRuntime('stripe_alert', 'warning', `มี dispute: ${dispute.id}`);
  }
  send(res, 200, { received: true });
}

async function stats() {
  const [users, links, payments, deliveries, pending] = await Promise.all([
    supabase.from('users').select('*', { count: 'exact', head: true }),
    supabase.from('links').select('*', { count: 'exact', head: true }).eq('active', true),
    supabase.from('payments').select('*', { count: 'exact', head: true }).eq('status', 'paid'),
    supabase.from('deliveries').select('*', { count: 'exact', head: true }),
    supabase.from('payments').select('*', { count: 'exact', head: true }).eq('status', 'pending')
  ]);
  [users, links, payments, deliveries, pending].forEach((x) => { if (x.error) throw x.error; });
  return { users: users.count, links: links.count, paidPayments: payments.count, deliveries: deliveries.count, pendingPayments: pending.count };
}

async function api(req, res, pathname) {
  if (pathname === '/api/login' && req.method === 'POST') {
    const { password } = await jsonBody(req);
    const a = Buffer.from(String(password)); const b = Buffer.from(String(ADMIN_PASSWORD));
    if (!ADMIN_PASSWORD || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return send(res, 401, { error: 'รหัสผ่านไม่ถูกต้อง' });
    const token = crypto.randomBytes(32).toString('hex'); sessions.set(token, Date.now() + 12 * 60 * 60 * 1000);
    return send(res, 200, { ok: true }, 'application/json; charset=utf-8', { 'set-cookie': `admin_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200` });
  }
  if (!authed(req)) return send(res, 401, { error: 'กรุณาเข้าสู่ระบบ' });
  if (pathname === '/api/stats') return send(res, 200, await stats());
  if (pathname === '/api/users') return send(res, 200, await must(await supabase.from('users').select('*').order('created_at', { ascending: false }).limit(200), 'ผู้ใช้'));
  if (pathname === '/api/links') return send(res, 200, await must(await supabase.from('links').select('*').order('created_at', { ascending: false }).limit(300), 'ลิงก์'));
  if (pathname === '/api/payments') return send(res, 200, await must(await supabase.from('payments').select('*,packages(name)').order('created_at', { ascending: false }).limit(200), 'รายการชำระ'));
  if (pathname === '/api/packages' && req.method === 'GET') return send(res, 200, await must(await supabase.from('packages').select('*').order('sort_order'), 'แพ็กเกจ'));
  if (pathname.startsWith('/api/packages/') && req.method === 'POST') {
    const id = decodeURIComponent(pathname.slice('/api/packages/'.length)); const body = await jsonBody(req);
    const update = { name: String(body.name), description: String(body.description || ''), price_thb: Number(body.price_thb), active: Boolean(body.active) };
    return send(res, 200, await must(await supabase.from('packages').update(update).eq('id', id).select().single(), 'แก้แพ็กเกจ'));
  }
  if (pathname.startsWith('/api/links/') && pathname.endsWith('/toggle') && req.method === 'POST') {
    const id = pathname.split('/')[3]; const body = await jsonBody(req);
    return send(res, 200, await must(await supabase.from('links').update({ active: Boolean(body.active) }).eq('id', id).select().single(), 'เปิดปิดลิงก์'));
  }
  if (pathname === '/api/runtime') return send(res, 200, await must(await supabase.from('runtime_status').select('*').order('name'), 'สถานะระบบ'));
  return send(res, 404, { error: 'ไม่พบ API' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/stripe/webhook' && req.method === 'POST') return await stripeWebhook(req, res);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url.pathname);
    if (url.pathname === '/payment-success') return send(res, 200, '<meta charset="utf-8"><style>body{font:28px sans-serif;text-align:center;padding:60px}</style>✅ ชำระเงินสำเร็จ<br><small>กลับไปที่ Telegram ได้เลย</small>', 'text/html; charset=utf-8');
    if (url.pathname === '/payment-cancelled') return send(res, 200, '<meta charset="utf-8"><style>body{font:28px sans-serif;text-align:center;padding:60px}</style>ยกเลิกการชำระเงินแล้ว<br><small>กลับไปเลือกแพ็กเกจใหม่ใน Telegram</small>', 'text/html; charset=utf-8');
    if (url.pathname === '/' || url.pathname === '/dashboard') return send(res, 200, dashboardHtml, 'text/html; charset=utf-8');
    return send(res, 404, 'ไม่พบหน้า', 'text/plain; charset=utf-8');
  } catch (error) {
    console.error('[dashboard]', error);
    return send(res, 500, { error: error.message });
  }
});

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`Dashboard พร้อมแล้ว: http://localhost:${PORT}`);
  await setRuntime('dashboard', 'ready', `port ${PORT}`).catch(() => {});
});
