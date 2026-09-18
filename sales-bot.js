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
    [{ text: '🎲 สุ่มลิงก์', callback_data: 'random' }],
    [{ text: '💳 ซื้อเครดิต/สมาชิก', callback_data: 'shop' }],
    [{ text: '👤 บัญชีของฉัน', callback_data: 'account' }, { text: '👥 แนะนำเพื่อน', callback_data: 'referral' }],
    [{ text: '☎️ ติดต่อผู้ดูแล', callback_data: 'support' }]
  ]
};

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

async function showMenu(chatId, text = 'เลือกเมนูที่ต้องการได้เลยครับ') {
  return bot.sendMessage(chatId, text, { reply_markup: menu });
}

async function start(message) {
  const ref = (message.text || '').split(/\s+/)[1];
  const user = await ensureUser(message.from, ref && ref.startsWith('ref_') ? ref.slice(4) : null);
  if (!user.terms_accepted) {
    return bot.sendMessage(message.chat.id,
      'ยินดีต้อนรับครับ\n\nร้านนี้จำหน่ายเฉพาะเนื้อหาทั่วไปที่ได้รับอนุญาต การซื้อสำเร็จแล้วไม่สามารถโอนเครดิตให้บัญชีอื่นได้\n\nกรุณากดยอมรับเงื่อนไขก่อนใช้งาน', {
        reply_markup: { inline_keyboard: [[{ text: '✅ ยอมรับเงื่อนไขและเริ่มใช้งาน', callback_data: 'accept_terms' }]] }
      });
  }
  return showMenu(message.chat.id, 'ยินดีต้อนรับกลับครับ');
}

async function showAccount(chatId, userId) {
  const user = await getUser(userId);
  const subscribed = user.subscription_until && new Date(user.subscription_until) > new Date();
  const until = subscribed ? new Date(user.subscription_until).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : 'ไม่มี';
  return showMenu(chatId, `👤 บัญชีของฉัน\n\nเครดิตคงเหลือ: ${user.credits}\nสมาชิกถึง: ${until}`);
}

async function showShop(chatId) {
  const packages = await must(await supabase.from('packages').select('*').eq('active', true).order('sort_order'), 'อ่านแพ็กเกจ');
  const keyboard = packages.map((item) => [{
    text: `${item.name} — ${item.price_thb} บาท`, callback_data: `buy:${item.id}`
  }]);
  keyboard.push([{ text: '⬅️ กลับเมนู', callback_data: 'menu' }]);
  return bot.sendMessage(chatId, '💳 เลือกแพ็กเกจที่ต้องการ\n\nชำระอย่างปลอดภัยผ่าน Stripe Checkout', {
    reply_markup: { inline_keyboard: keyboard }
  });
}

async function createCheckout(chatId, userId, packageId) {
  if (!PUBLIC_BASE_URL || !process.env.STRIPE_SECRET_KEY) throw new Error('ยังไม่ได้ตั้ง Stripe หรือ PUBLIC_BASE_URL');
  const pkg = await must(await supabase.from('packages').select('*').eq('id', packageId).eq('active', true).single(), 'อ่านแพ็กเกจ');
  const payment = await must(await supabase.from('payments').insert({
    user_id: String(userId), package_id: pkg.id, amount_thb: pkg.price_thb
  }).select('*').single(), 'สร้างรายการชำระเงิน');
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price_data: {
      currency: 'thb', unit_amount: pkg.price_thb * 100,
      product_data: { name: pkg.name, description: pkg.description }
    }, quantity: 1 }],
    metadata: { payment_id: payment.id, telegram_user_id: String(userId), package_id: pkg.id },
    success_url: `${PUBLIC_BASE_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${PUBLIC_BASE_URL}/payment-cancelled`
  });
  await must(await supabase.from('payments').update({ stripe_checkout_session_id: session.id }).eq('id', payment.id), 'ผูก Stripe session');
  return bot.sendMessage(chatId, `แพ็กเกจ: ${pkg.name}\nยอดชำระ: ${pkg.price_thb} บาท\n\nกดปุ่มด้านล่างเพื่อชำระเงิน`, {
    reply_markup: { inline_keyboard: [[{ text: '🔒 ไปหน้าชำระเงิน Stripe', url: session.url }], [{ text: '⬅️ กลับ', callback_data: 'shop' }]] }
  });
}

async function onCallback(query) {
  const chatId = query.message.chat.id;
  const userId = String(query.from.id);
  await ensureUser(query.from);
  await bot.answerCallbackQuery(query.id, 'กำลังดำเนินการ…').catch(() => {});
  if (query.data === 'accept_terms') {
    await must(await supabase.rpc('accept_terms_and_reward', { p_user_id: userId }), 'ยอมรับเงื่อนไข');
    return showMenu(chatId, 'เริ่มใช้งานเรียบร้อยแล้ว ✅\nผู้แนะนำได้รับเครดิตเมื่อคุณเริ่มใช้งานจริง');
  }
  const user = await getUser(userId);
  if (!user.terms_accepted) return start({ chat: { id: chatId }, from: query.from, text: '/start' });
  if (query.data === 'menu') return showMenu(chatId);
  if (query.data === 'account') return showAccount(chatId, userId);
  if (query.data === 'shop') return showShop(chatId);
  if (query.data === 'referral') {
    return showMenu(chatId, `👥 ลิงก์แนะนำเพื่อนของคุณ\nhttps://t.me/${botUsername}?start=ref_${user.referral_code}\n\nรับ 1 เครดิตเมื่อเพื่อนยืนยันและใช้งานจริง\nรับเพิ่ม 3 เครดิตเมื่อเพื่อนซื้อครั้งแรก`);
  }
  if (query.data === 'support') return showMenu(chatId, process.env.SUPPORT_TEXT || 'ติดต่อผู้ดูแลผ่านบัญชีที่แจ้งไว้ในหน้าร้าน');
  if (query.data === 'random') {
    const result = await must(await supabase.rpc('claim_random_link', { p_user_id: userId }), 'สุ่มลิงก์');
    if (result.error === 'no_credit') return showShop(chatId);
    if (result.error === 'no_link') return showMenu(chatId, 'ขออภัย ตอนนี้ยังไม่มีลิงก์ใหม่สำหรับคุณ กรุณาลองใหม่ภายหลัง');
    if (result.error) return showMenu(chatId, 'บัญชีนี้ยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแล');
    return showMenu(chatId, `🎁 ลิงก์ของคุณ\n${result.telegram_url}\n\nเครดิตคงเหลือ: ${result.subscribed ? 'สมาชิกใช้งานไม่จำกัด' : result.credits}`);
  }
  if (query.data.startsWith('buy:')) return createCheckout(chatId, userId, query.data.slice(4));
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
