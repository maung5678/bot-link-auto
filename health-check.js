'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const Stripe = require('stripe');
const { supabase, must } = require('./supabase-client');
const bot = require('./bot-api');

(async () => {
  console.log('กำลังตรวจ Supabase...');
  const packages = await must(await supabase.from('packages').select('id').limit(1), 'Supabase');
  console.log(`✅ Supabase พร้อม (${packages.length ? 'พบตาราง packages' : 'ตารางว่าง'})`);

  console.log('กำลังตรวจ Telegram Sales Bot...');
  const me = await bot.call('getMe');
  console.log(`✅ Telegram Bot พร้อม @${me.username}`);

  console.log('กำลังตรวจ Stripe...');
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');
  const balance = await stripe.balance.retrieve();
  console.log(`✅ Stripe พร้อม (livemode=${balance.livemode})`);

  if (!/^https:\/\//i.test(process.env.PUBLIC_BASE_URL || '')) {
    throw new Error('PUBLIC_BASE_URL ต้องขึ้นต้นด้วย https://');
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET) throw new Error('ยังไม่มี STRIPE_WEBHOOK_SECRET');
  console.log('✅ ค่า HTTPS และ webhook พร้อม');
  console.log('\nระบบพร้อมเริ่มด้วย start-bot.cmd');
})().catch((error) => {
  console.error(`❌ ตรวจไม่ผ่าน: ${error.message}`);
  process.exit(1);
});
