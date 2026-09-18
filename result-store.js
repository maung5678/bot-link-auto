'use strict';

const fs = require('fs');
const path = require('path');

const RESULT_FILE = process.env.RESULT_FILE || path.join(__dirname, 'results.jsonl');

function bangkokTimestamp(date) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  }).format(date).replace(' ', 'T') + '+07:00';
}

function appendResult(result) {
  const now = new Date();
  const record = {
    recordedAtUtc: now.toISOString(),
    recordedAtBangkok: bangkokTimestamp(now),
    ...result
  };
  fs.appendFileSync(RESULT_FILE, JSON.stringify(record) + '\n', 'utf8');
  return record;
}

module.exports = { appendResult, RESULT_FILE };
