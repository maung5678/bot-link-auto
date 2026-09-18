'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const fs = require('fs');
const path = require('path');
const input = require('input');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const { extractTargetLink } = require('./link-filter');
const { resolveLinkResult } = require('./controller');
const { saveResult, RESULT_FILE } = require('./result-store');
const { setRuntime } = require('./supabase-client');

const API_ID = Number(process.env.TELEGRAM_API_ID);
const API_HASH = process.env.TELEGRAM_API_HASH || '';
const SESSION_FILE = process.env.TELEGRAM_SESSION_FILE || path.join(__dirname, 'telegram.session');
const RESULT_CHAT = process.env.TELEGRAM_RESULT_CHAT || 'me';
const PLAYWRIGHT_HEADLESS = !/^(false|0|no)$/i.test(process.env.PLAYWRIGHT_HEADLESS || 'true');
const SOURCE_CHATS = new Set(
  (process.env.TELEGRAM_SOURCE_CHATS || '')
    .split(',').map((value) => value.trim().replace(/^@/, '').toLowerCase()).filter(Boolean)
);

if (!Number.isInteger(API_ID) || !API_HASH) {
  console.error('กรุณาตั้งค่า TELEGRAM_API_ID และ TELEGRAM_API_HASH ก่อนรัน');
  process.exit(1);
}

function readSession() {
  try {
    return fs.readFileSync(SESSION_FILE, 'utf8').trim();
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

function saveSession(client) {
  fs.writeFileSync(SESSION_FILE, client.session.save(), { mode: 0o600 });
}

function sourceAllowed(message) {
  if (SOURCE_CHATS.size === 0) return true;
  const chat = message.chat || {};
  const keys = new Set([
    message.chatId ? String(message.chatId) : '',
    chat.username ? String(chat.username).toLowerCase() : ''
  ].filter(Boolean));
  return [...SOURCE_CHATS].some((allowed) => keys.has(allowed));
}

function telegramUrls(message, text) {
  const urls = [];
  for (const entity of message.entities || []) {
    if (entity.url) urls.push(entity.url);
    else if (Number.isInteger(entity.offset) && Number.isInteger(entity.length)) {
      const value = String(text || '').slice(entity.offset, entity.offset + entity.length);
      if (/^https?:\/\//i.test(value)) urls.push(value);
    }
  }
  const webpageUrl = message.media && message.media.webpage && message.media.webpage.url;
  if (webpageUrl) urls.push(webpageUrl);
  for (const row of (message.replyMarkup && message.replyMarkup.rows) || []) {
    for (const button of row.buttons || []) if (button.url) urls.push(button.url);
  }
  return [...new Set(urls)];
}

async function main() {
  const client = new TelegramClient(new StringSession(readSession()), API_ID, API_HASH, {
    connectionRetries: 5
  });

  await client.start({
    phoneNumber: async () => input.text('เบอร์โทร Telegram (เช่น +66812345678): '),
    phoneCode: async () => input.text('รหัส OTP: '),
    password: async () => input.text('รหัสผ่าน 2FA (ถ้ามี): '),
    onError: (error) => console.error('[login]', error.message)
  });
  saveSession(client);

  let queue = Promise.resolve();
  let queuedCount = 0;
  let activeCount = 0;
  const updateQueueStatus = () => setRuntime('collector', activeCount ? 'working' : 'ready', `กำลังทำ ${activeCount} | รอ ${queuedCount}`).catch(() => {});
  console.log('Telegram userbot เริ่มทำงานแล้ว');
  console.log(`ส่งผลลัพธ์ไปที่: ${RESULT_CHAT}`);
  console.log(`Chromium headless: ${PLAYWRIGHT_HEADLESS}`);
  console.log(`ไฟล์บันทึกผลลัพธ์: ${RESULT_FILE}`);
  console.log('✅ Collector พร้อมรับลิงก์แล้ว');
  await updateQueueStatus();
  if (SOURCE_CHATS.size === 0) {
    console.warn('คำเตือน: ไม่ได้ตั้ง TELEGRAM_SOURCE_CHATS — จะตรวจทุกแชทและแชนแนลของบัญชีนี้');
  }

  client.addEventHandler((event) => {
    const message = event.message;
    const text = message && (message.message || message.text || '');
    if (!message || !sourceAllowed(message)) return;

    const extraUrls = telegramUrls(message, text);
    const targetUrl = extractTargetLink(text, extraUrls);
    if (!targetUrl) {
      if (/https?:\/\//i.test(text) || extraUrls.length) {
        const source = message.chatId ? String(message.chatId) : 'unknown';
        console.log(`[ข้ามลิงก์] source=${source} ไม่ตรงโดเมนใน link-patterns.json`);
      }
      return;
    }

    queuedCount++;
    console.log(`[รับลิงก์] ${message.out ? 'ข้อความที่คุณส่ง' : 'ข้อความเข้า'} | กำลังทำ ${activeCount} | รอ ${queuedCount}`);
    updateQueueStatus();
    queue = queue.then(async () => {
      queuedCount--;
      activeCount++;
      updateQueueStatus();
      const source = message.chatId ? String(message.chatId) : 'unknown';
      console.log(`[job] source=${source} url=${targetUrl}`);
      try {
        const result = await resolveLinkResult(targetUrl, { headless: PLAYWRIGHT_HEADLESS });
        const record = await saveResult({
          sourceChatId: source,
          sourceMessageId: message.id,
          ...result
        });
        await client.sendMessage(RESULT_CHAT, {
          message: `ลิงก์ Telegram\n${result.telegramUrl}\n\nบันทึกเมื่อ: ${record.recordedAtBangkok}`,
          linkPreview: false
        });
        console.log(`[done] ${result.telegramUrl}`);
      } catch (error) {
        console.error('[failed]', error);
        await client.sendMessage(RESULT_CHAT, {
          message: `ทำรายการไม่สำเร็จ\nต้นทาง: ${targetUrl}\nสาเหตุ: ${error.message}`,
          linkPreview: false
        });
      } finally {
        activeCount--;
        console.log(`[queue] กำลังทำ ${activeCount} | รอ ${queuedCount}`);
        updateQueueStatus();
      }
    }).catch((error) => console.error('[queue]', error));
  }, new NewMessage({}));

  const shutdown = async () => {
    console.log('\nกำลังปิด userbot...');
    await queue;
    await client.disconnect();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  // GramJS ไม่มี runUntilDisconnected(); คง main ไว้จนกว่าจะได้รับสัญญาณปิดโปรแกรม
  await new Promise(() => {});
}

main().catch((error) => {
  console.error('userbot stopped:', error);
  process.exitCode = 1;
});
