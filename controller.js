// controller.js
// รับ "ลิงก์เป้าหมาย" 1 ลิงก์ -> เปิดเบราว์เซอร์ -> ฉีดสคริปต์ bypass -> รอจนถึงปลายทางจริง -> คืนค่า URL ปลายทาง
//
// ใช้งาน: const { resolveFinalUrl } = require('./controller');
//         const finalUrl = await resolveFinalUrl('https://oklink2.online/xxxx');

const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const INJECTED_SCRIPT = fs.readFileSync(
  path.join(__dirname, 'injected-script-headless.js'),
  'utf8'
);

const DEFAULT_AD_DOMAINS = [
  'taplayma.com', 'nhapma.com', 'tech8s.net', 'synurl.vip',
  'shrinkme.click', 'cuttty.com', 'shrinkme.io', 'shrinkme.com',
  'clksz.com', 'srnky.com'
];

// เว็บปลายทางที่ถือว่า "จบงาน" นอกเหนือจาก note2s.im / kenhlink.vip ที่ฝังไว้ใน default
// แก้ไฟล์นี้ได้เลยถ้าปลายทางเปลี่ยนในอนาคต โดยไม่ต้องแตะ injected-script-headless.js
const DESTINATION_HOSTS = [];

const RUN_TIMEOUT_MS = 180000; // ต้องมากกว่า/เท่ากับ CFG.RUN_TIMEOUT_MS ในสคริปต์ + เผื่อ buffer
const UBLOCK_LITE_PATH = process.env.UBLOCK_LITE_PATH || path.join(
  __dirname, 'extensions', 'uBOL'
);
const TELEGRAM_LINK_TIMEOUT_MS = 30000;

function isFileVideoUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'filevideo.net' || hostname.endsWith('.filevideo.net');
  } catch (error) {
    return false;
  }
}

function isTelegramUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === 'telegram.me' || hostname === 't.me';
  } catch (error) {
    return false;
  }
}

async function openFirstFileVideoLink(context, page) {
  await page.waitForLoadState('domcontentloaded');
  const links = page.locator('.note-view-content a[href]');
  await links.first().waitFor({ state: 'attached', timeout: 15000 });

  let firstLink = null;
  let fileVideoUrl = null;
  for (let index = 0, count = await links.count(); index < count; index++) {
    const candidate = links.nth(index);
    const href = await candidate.getAttribute('href');
    if (href && isFileVideoUrl(href)) {
      firstLink = candidate;
      fileVideoUrl = new URL(href, page.url()).href;
      break;
    }
  }
  if (!firstLink) throw new Error('ไม่พบลิงก์ filevideo.net ในเนื้อหา note');

  let resolveRequest;
  const telegramRequest = new Promise((resolve) => { resolveRequest = resolve; });
  const requestHandler = (request) => {
    if (isTelegramUrl(request.url())) resolveRequest(request.url());
  };
  context.on('request', requestHandler);

  try {
    const popupPromise = context.waitForEvent('page', { timeout: 10000 }).catch(() => null);
    await firstLink.click();
    const popup = await popupPromise;

    const pageUrlPoll = (async () => {
      const deadline = Date.now() + TELEGRAM_LINK_TIMEOUT_MS;
      while (Date.now() < deadline) {
        for (const candidate of context.pages()) {
          if (isTelegramUrl(candidate.url())) return candidate.url();
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error('timeout: ไม่พบลิงก์ Telegram หลังคลิกลิงก์ filevideo');
    })();

    const telegramUrl = await Promise.race([telegramRequest, pageUrlPoll]);
    if (popup) await popup.waitForLoadState('domcontentloaded').catch(() => {});
    return { fileVideoUrl, telegramUrl };
  } finally {
    context.off('request', requestHandler);
  }
}

/**
 * เปิดลิงก์ 1 ลิงก์ ผ่านกระบวนการ bypass ทั้งหมด แล้วคืน URL ปลายทางจริง
 * @param {string} startUrl ลิงก์ที่ดึงมาจากข้อความ Telegram
 * @param {object} [opts]
 * @param {boolean} [opts.headless=true]
 * @returns {Promise<string>} URL ปลายทางจริง
 */
async function resolveLinkResult(startUrl, opts = {}) {
  const headless = opts.headless !== undefined ? opts.headless : true;
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vps-link-bot-'));
  const extensionArgs = fs.existsSync(path.join(UBLOCK_LITE_PATH, 'manifest.json'))
    ? [
        `--disable-extensions-except=${UBLOCK_LITE_PATH}`,
        `--load-extension=${UBLOCK_LITE_PATH}`
      ]
    : [];
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    ...(headless ? { channel: 'chromium' } : {}),
    args: extensionArgs
  });
  const page = context.pages()[0] || await context.newPage();
  console.log(extensionArgs.length
    ? `[browser] uBlock Origin Lite: ${UBLOCK_LITE_PATH}`
    : '[browser] uBlock Origin Lite ไม่พบไฟล์ — รันต่อโดยไม่มี extension');

  // สถานะที่ต้อง "จำข้ามโดเมน" เหมือน GM_setValue/GM_getValue เดิม
  const store = {
    adDomains: DEFAULT_AD_DOMAINS.slice(),
    savedVuotlinkURL: null,
    destinationHosts: DESTINATION_HOSTS
  };

  let doneResolve, doneReject;
  const donePromise = new Promise((res, rej) => { doneResolve = res; doneReject = rej; });

  // bridge: log จากหน้าเว็บ -> console ฝั่ง Node (ปรับเป็นเขียนไฟล์/ส่งต่อได้ตามต้องการ)
  await page.exposeFunction('__bridgeLog', (line) => {
    console.log(`[page] ${line}`);
  });

  // คืน store ล่าสุดให้ทุก document ตอนเริ่มทำงาน เพื่อให้สถานะข้ามโดเมนได้จริง
  await page.exposeFunction('__bridgeGetStore', () => JSON.parse(JSON.stringify(store)));

  // คลิกผ่าน Playwright เพื่อให้เป็น trusted browser input (บางเว็บไม่รับ element.click())
  await page.exposeFunction('__bridgeClick', async (selector) => {
    await page.locator(selector).first().click({ timeout: 5000 });
  });

  // bridge: หน้าเว็บแจ้งว่ามีการ set ค่า -> อัปเดต store ฝั่ง Node ทันที
  // แล้ว re-register addInitScript ด้วยค่าล่าสุด เพื่อให้หน้าถัดไป (ต่างโดเมน) อ่านได้แบบ sync
  await page.exposeFunction('__bridgeGmSet', async (key, value) => {
    if (key === 'adDomains') store.adDomains = JSON.parse(value);
    if (key === 'savedVuotlinkURL') store.savedVuotlinkURL = value;
  });

  // bridge: หน้าเว็บแจ้งว่าถึงปลายทางจริงแล้ว
  await page.exposeFunction('__bridgeDone', (finalUrl) => {
    doneResolve(finalUrl);
  });

  // ใช้ loader เพียงชุดเดียว และดึง store สดจาก Node ในทุก navigation
  // เพื่อเลี่ยงลำดับ addInitScript หลายชุดที่ Playwright ไม่รับประกัน
  await page.addInitScript(async (injectedScript) => {
    while (typeof window.__bridgeGetStore !== 'function') {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    window.__GM_STORE__ = await window.__bridgeGetStore();
    (0, eval)(injectedScript);
  }, INJECTED_SCRIPT);

  const timeout = new Promise((_, rej) =>
    setTimeout(() => rej(new Error('timeout: ไม่ถึงปลายทางภายในเวลาที่กำหนด')), RUN_TIMEOUT_MS)
  );

  try {
    await page.goto(startUrl, { waitUntil: 'domcontentloaded' });
    const noteUrl = await Promise.race([donePromise, timeout]);
    const { fileVideoUrl, telegramUrl } = await openFirstFileVideoLink(context, page);
    return { startUrl, noteUrl, fileVideoUrl, telegramUrl };
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function resolveFinalUrl(startUrl, opts = {}) {
  const result = await resolveLinkResult(startUrl, opts);
  return result.telegramUrl;
}

module.exports = { resolveFinalUrl, resolveLinkResult };

// เรียกตรง ๆ จาก command line เพื่อทดสอบ: node controller.js "https://oklink2.online/xxxx"
if (require.main === module) {
  const url = process.argv[2];
  if (!url) {
    console.error('ใช้งาน: node controller.js <ลิงก์เริ่มต้น>');
    process.exit(1);
  }
  resolveFinalUrl(url, { headless: false }) // headless:false ตอนทดสอบ จะได้เห็นหน้าจอ
    .then((finalUrl) => {
      console.log('=== FINAL URL ===');
      console.log(finalUrl);
      process.exit(0);
    })
    .catch((err) => {
      console.error('resolve failed:', err.message);
      process.exit(1);
    });
}
