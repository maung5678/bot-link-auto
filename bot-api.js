'use strict';

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('กรุณาตั้ง TELEGRAM_BOT_TOKEN ใน .env');
const base = `https://api.telegram.org/bot${token}`;

async function call(method, body = {}) {
  const response = await fetch(`${base}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(`Telegram ${method}: ${data.description || response.status}`);
  return data.result;
}

function sendMessage(chatId, text, extra = {}) {
  return call('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true, ...extra });
}

function answerCallbackQuery(id, text) {
  return call('answerCallbackQuery', { callback_query_id: id, text, show_alert: false });
}

module.exports = { call, sendMessage, answerCallbackQuery };
