'use strict';

const fs = require('fs');
const path = require('path');
const { supabase, must } = require('./supabase-client');

const RESULT_FILE = process.env.RESULT_FILE || path.join(__dirname, 'results.jsonl');

function bangkokTimestamp(date) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).format(date).replace(' ', 'T') + '+07:00';
}

async function saveResult(result) {
  const now = new Date();
  const record = {
    recordedAtUtc: now.toISOString(),
    recordedAtBangkok: bangkokTimestamp(now),
    ...result
  };
  fs.appendFileSync(RESULT_FILE, JSON.stringify(record) + '\n', 'utf8');
  await must(await supabase.from('links').upsert({
    start_url: result.startUrl,
    note_url: result.noteUrl,
    file_video_url: result.fileVideoUrl,
    telegram_url: result.telegramUrl,
    source_chat_id: result.sourceChatId,
    source_message_id: result.sourceMessageId == null ? null : String(result.sourceMessageId),
    active: true
  }, { onConflict: 'telegram_url' }), 'บันทึกลิงก์ลง Supabase');
  return record;
}

module.exports = { saveResult, RESULT_FILE };
