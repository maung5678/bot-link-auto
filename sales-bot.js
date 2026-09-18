'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const Stripe = require('stripe');
const { supabase, must, setRuntime } = require('./supabase-client');
const bot = require('./bot-api');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
let offset = 0;
let botUsername = '';

const menu = {
  inline_keyboard: [
    [{ text: '🎁 รับลิงก์ทันที', callback_data: 'random' }],
    [{ text: '🛒 ซื้อเครดิต / แพ็กเกจ', callback_data: 'shop' }],
    [{ text: '💰 เช็กเครดิตและวันใช้งาน', callback_data: 'account' }],
    [{ text: '🎉 ชวนเพื่อน รับเครดิตฟรี', callback_data: 'referral' }],
    [{ text: '❓ วิธีใช้ / ติดต่อผู้ดูแล', callback_data: 'support' }]
  ]
};

const homeButton = [{ text: '🏠 กลับหน้าหลัก', callback_data: 'menu' }];

function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function homeText(note = '') {
  return [
    '✨ <b>ร้านลิงก์อัตโนมัติ</b>',
    '',
    note || 'เลือกสิ่งที่ต้องการจากปุ่มด้านล่างได้เลยครับ',
    '',
    '① เติมเครดิตหรือซื้อแพ็กเกจ',
    '② กด “รับลิงก์ทันที”',
    '③ เปิดลิงก์และรับชมได้เลย'
  ].join('\n');
}

async function render(chatId, text, replyMarkup, messageId) {
  const options = { parse_mode: 'HTML', reply_markup: replyMarkup };
  if (messageId) {
    try { return await bot.editMessageText(chatId, messageId, text, options); }
    catch (error) {
      if (/message is not modified/i.test(error.message)) return null;
    }
  }
  return bot.sendMessage(chatId, text, options);
}

function referralCode(id) {
  try { return BigInt(String(id)).toString(36).toUpperCase(); }
  catch { return Buffer.from(String(id)).toString('base64url').slice(0, 12).toUpperCase(); }
}

async function ensureUser(from, refCode) {
  const id = String(from.id);
  const current = await must(await supabase.from('users').select('*').eq('telegram_id', id).maybeSingle(), 'อ่านผู้ใช้');
  if (current) {
    await must(await supabase.from('users').update({
      username: from.username || null,
      display_name: [from.first_name, from.last_name].filter(Boolean).join(' ') || null,
      updated_at: new Date().toISOString()
    }).eq('telegram_id', id), 'อัปเดตผู้ใช้');
    return current;
  }
  let inviter = null;
  if (refCode) inviter = await must(await supabase.from('users').select('telegram_id').eq('referral_code', refCode).maybeSingle(), 'ตรวจ referral');
  if (inviter && String(inviter.telegram_id) === id) inviter = null;
  const row = {
    telegram_id: id, username: from.username || null,
    display_name: [from.first_name, from.last_name].filter(Boolean).join(' ') || null,
    referral_code: referralCode(id), invited_by: inviter ? inviter.telegram_id : null
  };
  await must(await supabase.from('users').insert(row), 'สร้างผู้ใช้');
  if (inviter) await must(await supabase.from('referrals').insert({ invited_user_id: id, inviter_user_id: inviter.telegram_id }), 'บันทึก referral');
  return row;
}

async function getUser(id) {
  return must(await supabase.from('users').select('*').eq('telegram_id', String(id)).single(), 'อ่านบัญชี');
}

async function showMenu(chatId, note = '', messageId) {
  return render(chatId, homeText(note), menu, messageId);
}

async function start(message) {
  const ref = (message.text || '').split(/\s+/)[1];
  const user = await ensureUser(message.from, ref && ref.startsWith('ref_') ? ref.slice(4) : null);
  if (!user.terms_accepted) {
    return render(message.chat.id,
      '👋 <b>ยินดีต้อนรับครับ</b>\n\nก่อนเริ่มใช้งาน กรุณายืนยันว่า:\n\n✅ ใช้บริการสำหรับเนื้อหาที่ได้รับอนุญาตเท่านั้น\n✅ เครดิตใช้ได้กับบัญชีนี้และโอนให้ผู้อื่นไม่ได้\n✅ ตรวจสอบแพ็กเกจก่อนชำระเงิน\n\nกดปุ่มด้านล่างเพื่อเริ่มใช้งาน',
      { inline_keyboard: [[{ text: '✅ ยอมรับและเริ่มใช้งาน', callback_data: 'accept_terms' }]] });
  }
  return showMenu(message.chat.id, 'ยินดีต้อนรับกลับครับ 👋');
}

async function showAccount(chatId, userId, messageId) {
  const user = await getUser(userId);
  const subscribed = user.subscription_until && new Date(user.subscription_until) > new Date();
  const until = subscribed ? new Date(user.subscription_until).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : 'ยังไม่มีแพ็กเกจรายวัน';
  return render(chatId,
    `💰 <b>เครดิตและวันใช้งาน</b>\n\n🎟 เครดิตคงเหลือ: <b>${user.credits} เครดิต</b>\n📅 ใช้งานไม่จำกัดถึง: <b>${until}</b>\n\n1 เครดิต ใช้รับลิงก์ได้ 1 ครั้ง`,
    { inline_keyboard: [[{ text: '🛒 เติมเครดิต', callback_data: 'shop' }], homeButton] }, messageId);
}

async function showShop(chatId, messageId) {
  const packages = await must(await supabase.from('packages').select('*').eq('active', true).order('sort_order'), 'อ่านแพ็กเกจ');
  const keyboard = packages.map((item) => [{
    text: `ซื้อ ${item.name}  •  ${item.price_thb} บาท`, callback_data: `buy:${item.id}`
  }]);
  keyboard.push(homeButton);
  const details = packages.map((item) => `• <b>${escapeHtml(item.name)}</b> — ${escapeHtml(item.description)}`).join('\n');
  return render(chatId,
    `🛒 <b>เลือกแพ็กเกจ</b>\n\n${details}\n\n🔒 ชำระเงินอย่างปลอดภัยผ่าน Stripe\nระบบเติมสิทธิ์ให้อัตโนมัติหลังชำระสำเร็จ`,
    { inline_keyboard: keyboard }, messageId);
}

async function createCheckout(chatId, userId, packageId, messageId) {
  if (!PUBLIC_BASE_URL || !process.env.STRIPE_SECRET_KEY) throw new Error('ยังไม่ได้ตั้ง Stripe หรือ PUBLIC_BASE_URL');
  const pkg = await must(await supabase.from('packages').select('*').eq('id', packageId).eq('active', true).single(), 'อ่านแพ็กเกจ');
  const payment = await must(await supabase.from('payments').insert({
    user_id: String(userId), package_id: pkg.id, amount_thb: pkg.price_thb
  }).select('*').single(), 'สร้างรายการชำระเงิน');
  const user = await getUser(userId);
  let customerId = user.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      name: user.display_name || user.username || `Telegram ${userId}`,
      metadata: { telegram_user_id: String(userId) }
    }, { idempotencyKey: `telegram_customer_${userId}` });
    customerId = customer.id;
    await must(await supabase.from('users').update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() }).eq('telegram_id', String(userId)), 'บันทึก Stripe customer');
  }
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    line_items: [{ price_data: {
      currency: 'thb', unit_amount: pkg.price_thb * 100,
      product_data: { name: pkg.name, description: pkg.description }
    }, quantity: 1 }],
    metadata: { payment_id: payment.id, telegram_user_id: String(userId), package_id: pkg.id },
    success_url: `${PUBLIC_BASE_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${PUBLIC_BASE_URL}/payment-cancelled`
  }, { idempotencyKey: `checkout_${payment.id}` });
  await must(await supabase.from('payments').update({ stripe_checkout_session_id: session.id }).eq('id', payment.id), 'ผูก Stripe session');
  return render(chatId,
    `🧾 <b>ตรวจสอบรายการ</b>\n\nแพ็กเกจ: <b>${escapeHtml(pkg.name)}</b>\nได้รับ: ${escapeHtml(pkg.description)}\nยอดชำระ: <b>${pkg.price_thb} บาท</b>\n\nกดปุ่มสีด้านล่างเพื่อเปิดหน้าชำระเงิน`,
    { inline_keyboard: [[{ text: `🔒 ชำระ ${pkg.price_thb} บาท`, url: session.url }], [{ text: '⬅️ เลือกแพ็กเกจอื่น', callback_data: 'shop' }], homeButton] }, messageId);
}

async function onCallback(query) {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const userId = String(query.from.id);
  await ensureUser(query.from);
  await bot.answerCallbackQuery(query.id, 'กำลังดำเนินการ…').catch(() => {});
  if (query.data === 'accept_terms') {
    await must(await supabase.rpc('accept_terms_and_reward', { p_user_id: userId }), 'ยอมรับเงื่อนไข');
    return showMenu(chatId, 'พร้อมใช้งานแล้ว ✅', messageId);
  }
  const user = await getUser(userId);
  if (!user.terms_accepted) return start({ chat: { id: chatId }, from: query.from, text: '/start' });
  if (query.data === 'menu') return showMenu(chatId, '', messageId);
  if (query.data === 'account') return showAccount(chatId, userId, messageId);
  if (query.data === 'shop') return showShop(chatId, messageId);
  if (query.data === 'referral') {
    return render(chatId,
      `🎉 <b>ชวนเพื่อน รับเครดิตฟรี</b>\n\nส่งลิงก์นี้ให้เพื่อน:\n<code>https://t.me/${botUsername}?start=ref_${user.referral_code}</code>\n\n🎁 รับ 1 เครดิต เมื่อเพื่อนเริ่มใช้งาน\n🎁 รับเพิ่ม 3 เครดิต เมื่อเพื่อนซื้อครั้งแรก`,
      { inline_keyboard: [[{ text: '📤 เปิดลิงก์สำหรับส่งต่อ', url: `https://t.me/share/url?url=${encodeURIComponent(`https://t.me/${botUsername}?start=ref_${user.referral_code}`)}` }], homeButton] }, messageId);
  }
  if (query.data === 'support') return render(chatId,
    `❓ <b>วิธีใช้งาน</b>\n\n1. กด “ซื้อเครดิต / แพ็กเกจ”\n2. ชำระเงินผ่าน Stripe\n3. กลับมาที่บอทและกด “รับลิงก์ทันที”\n\n☎️ <b>ติดต่อผู้ดูแล</b>\n${escapeHtml(process.env.SUPPORT_TEXT || 'กรุณาติดต่อบัญชีผู้ดูแลที่แจ้งไว้')}`,
    { inline_keyboard: [homeButton] }, messageId);
  if (query.data === 'random') {
    const result = await must(await supabase.rpc('claim_random_link', { p_user_id: userId }), 'สุ่มลิงก์');
    if (result.error === 'no_credit') return showShop(chatId, messageId);
    if (result.error === 'no_link') return showMenu(chatId, 'ขออภัย ลิงก์ใหม่สำหรับคุณหมดชั่วคราว กรุณาลองอีกครั้งภายหลัง', messageId);
    if (result.error) return showMenu(chatId, 'บัญชีนี้ยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแล', messageId);
    return render(chatId,
      `🎁 <b>ลิงก์ของคุณพร้อมแล้ว</b>\n\nกดปุ่ม “เปิดลิงก์” ด้านล่างได้เลย\n\n${result.subscribed ? '⭐ แพ็กเกจไม่จำกัดยังใช้งานอยู่' : `🎟 เครดิตคงเหลือ: <b>${result.credits}</b>`}`,
      { inline_keyboard: [[{ text: '🚀 เปิดลิงก์', url: result.telegram_url }], [{ text: '🎁 รับลิงก์อีกครั้ง', callback_data: 'random' }], homeButton] }, messageId);
  }
  if (query.data.startsWith('buy:')) return createCheckout(chatId, userId, query.data.slice(4), messageId);
}

async function handleUpdate(update) {
  if (update.callback_query) return onCallback(update.callback_query);
  const message = update.message;
  if (!message || !message.from) return;
  if ((message.text || '').startsWith('/start')) return start(message);
  await ensureUser(message.from);
  return showMenu(message.chat.id);
}

async function main() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('กรุณาตั้ง STRIPE_SECRET_KEY ใน .env');
  const me = await bot.call('getMe');
  botUsername = me.username;
  await setRuntime('sales_bot', 'ready', `@${botUsername}`);
  console.log(`Sales Bot พร้อมแล้ว: @${botUsername}`);
  while (true) {
    try {
      const updates = await bot.call('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] });
      for (const update of updates) {
        offset = update.update_id + 1;
        handleUpdate(update).catch((error) => console.error('[sales update]', error));
      }
    } catch (error) {
      console.error('[sales poll]', error.message);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

main().catch(async (error) => {
  console.error('Sales Bot หยุดทำงาน:', error);
  await setRuntime('sales_bot', 'failed', error.message).catch(() => {});
  process.exit(1);
});
