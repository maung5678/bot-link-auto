// link-filter.js
// เลือกลิงก์ "เป้าหมาย" 1 ลิงก์จากข้อความ Telegram ที่มีหลายลิงก์ปนกัน
// แก้ไฟล์ link-patterns.json ได้เลยถ้าโดเมนเป้าหมายเปลี่ยนในอนาคต ไม่ต้องแก้โค้ด

const fs = require('fs');
const path = require('path');

function loadPatterns() {
  const p = path.join(__dirname, 'link-patterns.json');
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

/**
 * ดึงลิงก์ทั้งหมดจากข้อความ แล้วเลือกอันแรกที่ตรงกับ whitelist domain
 * @param {string} text ข้อความ Telegram ทั้งก้อน
 * @returns {string|null} ลิงก์เป้าหมาย หรือ null ถ้าไม่เจอ
 */
function extractTargetLink(text, extraUrls = []) {
  const { targetDomains } = loadPatterns();
  const urlRe = /https?:\/\/[^\s<>]+/g;
  const found = [...(String(text || '').match(urlRe) || []), ...extraUrls]
    .map((url) => String(url || '').trim().replace(/[\]\[(){}.,;:!?"']+$/g, ''))
    .filter(Boolean);

  for (const url of found) {
    let hostname;
    try { hostname = new URL(url).hostname; } catch (e) { continue; }
    if (targetDomains.some((d) => hostname === d || hostname.endsWith('.' + d))) {
      return url;
    }
  }
  return null;
}

module.exports = { extractTargetLink };
