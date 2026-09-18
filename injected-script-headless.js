// injected-script-headless.js
// แปลงจาก Tampermonkey userscript "Vuotlink + Shortlink All-in-One Auto Bypass v3.0.0"
// ให้รันผ่าน Playwright page.addInitScript() แทน (ไม่มี GM_*, ไม่มี UI)
//
// Bridge functions ที่ต้องมีให้ (เซ็ตผ่าน page.exposeFunction ก่อนเรียกไฟล์นี้):
//   window.__bridgeLog(line)              -> ส่ง log กลับ Node console
//   window.__bridgeGmSet(key, value)      -> แจ้ง Node ว่ามีการ set ค่า (เพื่อ sync ไปหน้าถัดไป)
//   window.__bridgeDone(finalUrl)         -> แจ้งว่าเจอปลายทางจริงแล้ว จบงาน
//
// ตัวแปร window.__GM_STORE__ ต้องถูกตั้งไว้ "ก่อน" ไฟล์นี้รัน (ผ่าน argument ของ addInitScript)
// รูปแบบ: { adDomains: string[], savedVuotlinkURL: string|null, destinationHosts: string[] }

(function () {
  'use strict';

  if (window.top !== window.self) return; // ข้าม iframe เหมือนต้นฉบับ

  var STORE = window.__GM_STORE__ || { adDomains: [], savedVuotlinkURL: null, destinationHosts: [] };

  // ---- GM_* mock (sync read จาก STORE ที่ inject มาพร้อมหน้า, write แจ้ง Node แบบ fire-and-forget) ----
  function GM_getValue(key, def) {
    if (key === 'adDomains') return JSON.stringify(STORE.adDomains || []);
    if (key === 'savedVuotlinkURL') return STORE.savedVuotlinkURL;
    return def;
  }
  function GM_setValue(key, value) {
    if (key === 'adDomains') STORE.adDomains = JSON.parse(value);
    if (key === 'savedVuotlinkURL') STORE.savedVuotlinkURL = value;
    try { window.__bridgeGmSet && window.__bridgeGmSet(key, value); } catch (e) {}
  }

  var CFG = {
    TICK_MS: 500,
    VUOTLINK_TIMEOUT_MS: 15000,
    EZ_MIN_WAIT_MS: 3000,
    EZ_MAX_POSTS: 4,
    EZ_RETRY_GAP_MS: 4000,
    WPS_MAX_POSTS: 3,
    WPS_RETRY_GAP_MS: 4000,
    WPS_RELOAD_MAX_ROUNDS: 4,
    CSRF_MAX_RETRIES: 3,
    CSRF_RETRY_DELAY_MS: 2000,
    CSRF_DETECT_WINDOW_MS: 30000,
    RUN_TIMEOUT_MS: 180000
  };

  var TAG = '[Headless]';
  var t0 = Date.now();

  var navigating = false;
  var chainExpired = false;
  var chainExpiredNotified = false;
  var timers = new Set();
  var activeXhrs = [];
  var csrfAbort = null;

  var getLinkClicked = false;
  var vuotlinkSaved = false;
  var bounced = false;
  var bounceStatusShown = false;
  var _bypassTriggered = false;
  var _csrfDetectStarted = false;
  var _doneFired = false;

  function ts() { return ((Date.now() - t0) / 1000).toFixed(1) + 's'; }

  function log() {
    var line = ts() + ' ' + [].slice.call(arguments).join(' ');
    try { window.__bridgeLog && window.__bridgeLog(line); } catch (e) {}
    try { console.log.apply(console, [TAG].concat([].slice.call(arguments))); } catch (e) {}
  }

  function setStatus(msg) { log('[status]', msg); }

  function $(sel, root) { return (root || document).querySelector(sel); }

  function visible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    return !!(r.width || r.height);
  }

  function host(u) { try { return new URL(u).hostname; } catch (e) { return ''; } }

  function isGoodTarget(u) {
    return /^https?:/i.test(u)
      && !/payout-rates|\/auth\/|\/pages\/|privacy|terms|dmca|\.css(\?|$)|\.js(\?|$)/i.test(u)
      && host(u) !== location.hostname;
  }

  function tSetTimeout(fn, ms) {
    var id = setTimeout(function () { timers.delete(id); fn(); }, ms);
    timers.add(id);
    return id;
  }
  function tSetInterval(fn, ms) {
    var id = setInterval(fn, ms);
    timers.add(id);
    return id;
  }
  function trackXhr(x) {
    activeXhrs.push(x);
    x.addEventListener('loadend', function () {
      var i = activeXhrs.indexOf(x);
      if (i > -1) activeXhrs.splice(i, 1);
    });
  }

  // ============================ DOMAINS =====================================
  function getAdDomains() {
    try { return JSON.parse(GM_getValue('adDomains', '[]')); } catch (e) { return []; }
  }

  // ============================ NAVIGATION ==================================
  function go(url) {
    if (navigating || !isGoodTarget(url)) return;
    navigating = true;
    setStatus('ไปที่ ' + url.slice(0, 60) + '...');
    log('navigating ->', url);
    try {
      var here = location.pathname + location.search;
      history.pushState(null, '', url);
      history.replaceState(null, '', here);
    } catch (e) { /* cross-origin pushState ไม่ได้ — ไม่เป็นไร */ }
    tSetTimeout(function () { location.href = url; }, 60);
  }

  function fireClick(el) {
    var r = el.getBoundingClientRect();
    var base = {
      bubbles: true, cancelable: true, view: window,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2
    };
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (type) {
      var Ev = type.indexOf('pointer') === 0 ? window.PointerEvent : window.MouseEvent;
      try { el.dispatchEvent(new Ev(type, base)); } catch (e) {}
    });
  }

  function extractUrls(text) {
    var out = [];
    var re = /https?:\/\/[^\s"'<>]+/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      if (isGoodTarget(m[0])) out.push(m[0]);
      if (out.length >= 5) break;
    }
    return out;
  }

  function setupErrorListener() {
    window.addEventListener('error', function (e) {
      if (e && e.message && /Refused to display|X-Frame-Options|frame-ancestors/i.test(e.message)) {
        var urls = extractUrls(e.message);
        if (urls.length) { log('จับ URL จาก console error:', urls[0]); go(urls[0]); }
      }
    });
  }

  // ============================ PAGE DETECTORS ==============================
  function isEz4() { return /(^|\.)ez4short\.com$/i.test(location.hostname); }
  function isVuotlink() { return /(^|\.)vuotlink\.xyz$/i.test(location.hostname); }
  function hasWpsForm() { return !!$('form input[name="newwpsafelink"]'); }
  function isDroplink() {
    if ($('#droplink-step-one, #droplink-step-two, #modal-droplink-step-one, #tp-generate')) return true;
    try { return /droplink-step-one|tp-generate/.test(document.body ? document.body.innerHTML : ''); }
    catch (e) { return false; }
  }
  // ปลายทาง: ค่า default note2s.im/kenhlink.vip + เพิ่มจาก config ได้ (STORE.destinationHosts)
  function isNotes() {
    if (/\/notes\//i.test(location.pathname)) return true;
    var extra = STORE.destinationHosts || [];
    var all = ['note2s.im', 'kenhlink.vip'].concat(extra);
    return all.some(function (h) { return location.hostname === h || location.hostname.endsWith('.' + h); });
  }
  function isAdBounceSite() {
    var h = location.hostname;
    if (h.indexOf('tech8s.net') !== -1) return false;
    return getAdDomains().some(function (d) { return h.indexOf(d) !== -1; });
  }
  function findExternalContinueLink() {
    var a = $('a#go_d2[href], a#go_d[href], a.submitBtn[href]');
    if (!a) return null;
    var h = a.getAttribute('href') || '';
    return isGoodTarget(h) ? h : null;
  }
  function pickFromHtml(html) {
    if (!html) return null;
    var m = html.match(/<a[^>]*id=["']go_d2?["'][^>]*href=["']([^"']+)["']/i)
         || html.match(/<a[^>]*href=["']([^"']+)["'][^>]*id=["']go_d2?["']/i);
    if (m && isGoodTarget(m[1])) return m[1];
    m = html.match(/https?:\/\/[^"'\s<>]*safe\.php\?link=[A-Za-z0-9_-]+/i);
    if (m) return m[0];
    m = html.match(/<a[^>]*class=["'][^"']*btn-success[^"']*["'][^>]*href=["']([^"']+)["']/i);
    if (m && isGoodTarget(m[1])) return m[1];
    return null;
  }

  // ====================== PHASE: AD BOUNCE ===================================
  function adBounceTick() {
    if (bounced) return;
    var returnURL = GM_getValue('savedVuotlinkURL');
    if (returnURL) {
      bounced = true;
      log('อยู่บน ad site (' + location.hostname + ') -> ย้อนกลับไป:', returnURL);
      go(returnURL);
    } else if (!bounceStatusShown) {
      bounceStatusShown = true;
      setStatus('อยู่บน ad site แต่ยังไม่มี URL vuotlink ที่บันทึกไว้ — รอเฉย ๆ');
    }
  }

  // ====================== PHASE: VUOTLINK AUTO GET-LINK ======================
  function vuotlinkTick() {
    if (!vuotlinkSaved) {
      vuotlinkSaved = true;
      GM_setValue('savedVuotlinkURL', location.href);
      log('บันทึก URL vuotlink:', location.href);
    }
    if (getLinkClicked) return;
    var btn = $('a.get-link');
    if (btn) {
      getLinkClicked = true;
      log('กดปุ่ม Get Link');
      setStatus('กดปุ่ม Get Link รอเด้งต่อ...');
      if (window.__bridgeClick) {
        window.__bridgeClick('a.get-link').catch(function (e) {
          log('Playwright click fail:', e.message);
          btn.click();
        });
      } else {
        btn.click();
      }
    } else {
      setStatus('Vuotlink: รอปุ่ม Get Link...');
    }
  }

  // ====================== PHASE 1: WP-SafeLink ===============================
  var postAttempts = 0;
  var lastPostAt = 0;
  function rounds() {
    try { return parseInt(sessionStorage.getItem('ab_rounds') || '0', 10) || 0; }
    catch (e) { return 0; }
  }
  function wpsTick() {
    var href = findExternalContinueLink();
    if (href) { go(href); return; }

    var input = $('form input[name="newwpsafelink"]');
    var form = input && input.closest('form');
    if (!form || postAttempts >= CFG.WPS_MAX_POSTS) {
      if (postAttempts >= CFG.WPS_MAX_POSTS && Date.now() - lastPostAt > 6000) {
        try { sessionStorage.setItem('ab_rounds', String(rounds() + 1)); } catch (e) {}
        if (rounds() <= CFG.WPS_RELOAD_MAX_ROUNDS) location.reload();
        else setStatus('หยุดกัน loop — ลองมือครั้งเดียว');
      }
      return;
    }
    if (Date.now() - lastPostAt < CFG.WPS_RETRY_GAP_MS) return;
    lastPostAt = Date.now();
    postAttempts++;

    var parts = [];
    new FormData(form).forEach(function (v, k) {
      parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });
    var xhr = new XMLHttpRequest();
    trackXhr(xhr);
    xhr.open('POST', form.getAttribute('action') || location.href, true);
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
    xhr.onload = function () {
      var target = pickFromHtml(xhr.responseText);
      log('wps POST ->', target ? 'พบลิงก์: ' + target : 'ไม่เจอลิงก์');
      try { sessionStorage.setItem('ab_rounds', '0'); } catch (e) {}
      if (target) { go(target); return; }
      if (/go_d2|droplink|tp-generate/i.test(xhr.responseText)) location.reload();
    };
    xhr.onerror = function () { log('wps POST network error'); };
    setStatus('กำลังส่งฟอร์ม WP-SafeLink (ครั้งที่ ' + postAttempts + ')...');
    xhr.send(parts.join('&'));
  }

  // ====================== PHASE 2: droplink ===================================
  function dlTick() {
    var href = findExternalContinueLink();
    if (href) { go(href); return; }
    var gen = $('#tp-generate');
    if (gen && visible(gen)) { setStatus('กดปุ่ม generate...'); fireClick(gen); return; }
    if (Date.now() - t0 > 6000) {
      var b = $('button#go_d, button#go_d2');
      if (b && visible(b) && !b.__abClicked) {
        b.__abClicked = 1;
        setStatus('กดปุ่ม continue...');
        fireClick(b);
      }
    }
  }

  // ====================== PHASE 3: EZ4Short ===================================
  var ezLastPost = 0;
  var ezPosts = 0;
  function ezTick() {
    var gl = $('a.btn.btn-success[href]');
    if (gl) {
      var h = gl.getAttribute('href') || '';
      if (isGoodTarget(h)) { go(h); return; }
    }
    if (ezPosts >= CFG.EZ_MAX_POSTS) return;
    var ready = Date.now() - t0 > CFG.EZ_MIN_WAIT_MS;
    var gap = Date.now() - ezLastPost > CFG.EZ_RETRY_GAP_MS;
    if (ready && gap && $('#go-link')) {
      ezLastPost = Date.now();
      ezPosts++;
      ezPost($('#go-link'));
    }
  }
  function ezPost(form) {
    if (!form) return;
    try {
      var parts = [];
      new FormData(form).forEach(function (v, k) {
        if (k === '_Token[fields]' || k === '_Token[unlocked]') v = decodeURIComponent(v);
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
      });
      var xhr = new XMLHttpRequest();
      trackXhr(xhr);
      xhr.open('POST', form.getAttribute('action') || '/links/go', true);
      xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
      xhr.setRequestHeader('Accept', 'application/json, text/javascript, */*; q=0.01');
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      xhr.onload = function () {
        try {
          var d = JSON.parse(xhr.responseText);
          log('ez4 resp:', d.status, d.message, d.url || '');
          if (d && d.url && isGoodTarget(d.url)) go(d.url);
        } catch (e) { log('ez4 parse fail:', e.message); }
      };
      xhr.onerror = function () { log('ez4 network error'); };
      setStatus('ขอลิงก์จาก ez4short (ครั้งที่ ' + ezPosts + ')...');
      xhr.send(parts.join('&'));
    } catch (e) { log('ez4 post fail:', e.message); }
  }

  // ====================== CSRF BYPASS (/links/gosl/) ==========================
  function extractCsrfTokens() {
    var csrfToken =
      (document.querySelector('input[name="_csrfToken"]') || {}).value ||
      (document.querySelector('meta[name="csrf-token"]') || {}).content ||
      (document.cookie.match(/csrfToken=([^;]+)/) || [])[1];
    var adFormData = '';
    var alias = '';
    document.querySelectorAll('script').forEach(function (s) {
      var m1 = s.textContent.match(/ad_form_data\s*=\s*'([^']+)';/);
      var m2 = s.textContent.match(/linkAlias\s*=\s*'([^']+)';/);
      if (m1) adFormData = m1[1];
      if (m2) alias = m2[1];
    });
    if (!alias) {
      try {
        var urlParams = new URLSearchParams(window.location.search);
        alias = urlParams.get('alias') || '';
      } catch (e) {}
    }
    return { csrfToken: csrfToken, adFormData: adFormData, alias: alias };
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function performCsrfBypass(statusCb, successCb, errorCb) {
    statusCb = statusCb || setStatus;
    successCb = successCb || function (msg) { log('CSRF success:', msg); };
    errorCb = errorCb || function (msg) { log('CSRF error:', msg); };

    var tokens = extractCsrfTokens();
    if (!tokens.csrfToken || !tokens.adFormData || !tokens.alias) {
      var missing = [];
      if (!tokens.csrfToken) missing.push('CSRF Token');
      if (!tokens.adFormData) missing.push('Ad Form Data');
      if (!tokens.alias) missing.push('Alias');
      var msg = 'Missing: ' + missing.join(', ');
      log(msg);
      errorCb(msg);
      return false;
    }

    var targetUrl = '/links/gosl/?alias=' + tokens.alias;
    log('POST', targetUrl);

    for (var attempt = 1; attempt <= CFG.CSRF_MAX_RETRIES; attempt++) {
      statusCb('Attempt ' + attempt + '/' + CFG.CSRF_MAX_RETRIES + '...');
      log('CSRF Attempt ' + attempt + '/' + CFG.CSRF_MAX_RETRIES);
      try {
        csrfAbort = new AbortController();
        var response = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-CSRF-Token': tokens.csrfToken,
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': 'application/json, text/javascript, */*; q=0.01'
          },
          body: new URLSearchParams({ ad_form_data: tokens.adFormData }),
          credentials: 'same-origin',
          signal: csrfAbort.signal
        });
        csrfAbort = null;
        if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + response.statusText);
        var result = await response.json();
        log('CSRF Response:', JSON.stringify(result));
        if (result && result.url) {
          successCb('Redirecting...');
          log('CSRF สำเร็จ ->', result.url);
          tSetTimeout(function () { window.location.href = result.url; }, 500);
          return true;
        } else {
          var errMsg = (result && (result.message || result.error)) || 'Quota exceeded';
          log('ถูกปฏิเสธ:', errMsg);
          if (attempt < CFG.CSRF_MAX_RETRIES) { statusCb(errMsg + ' — retrying...'); await sleep(CFG.CSRF_RETRY_DELAY_MS); }
          else { errorCb(errMsg); return false; }
        }
      } catch (err) {
        csrfAbort = null;
        log('CSRF Attempt ' + attempt + ' failed:', err.message);
        if (attempt < CFG.CSRF_MAX_RETRIES) { statusCb('Error: ' + err.message + ' — retrying...'); await sleep(CFG.CSRF_RETRY_DELAY_MS); }
        else { errorCb('Failed: ' + err.message); return false; }
      }
    }
    return false;
  }

  var ALERT_SUCCESS_RE = /hết mã vượt|het ma vuot|đã hết|het roi|quota exceeded|limit reached/i;
  function checkAlertAndBypass() {
    if (_bypassTriggered) return;
    var alertEl = document.querySelector('.alert.alert-success, .alert-success, [class*="alert-success"]');
    if (alertEl && ALERT_SUCCESS_RE.test(alertEl.textContent || '')) {
      _bypassTriggered = true;
      log('ตรวจพบ alert หมดโควตา -> ยิง CSRF bypass อัตโนมัติ!');
      performCsrfBypass();
    }
  }
  function startCsrfAutoDetect() {
    if (_csrfDetectStarted) return;
    _csrfDetectStarted = true;
    if (/\/links\/gosl\//i.test(location.pathname + location.search)) {
      log('ตรวจพบ /links/gosl/ -> auto CSRF bypass ใน 2 วินาที...');
      tSetTimeout(function () {
        if (_bypassTriggered) return;
        _bypassTriggered = true;
        performCsrfBypass();
      }, 2000);
    }
    checkAlertAndBypass();
    var alertPoll = tSetInterval(checkAlertAndBypass, 1000);
    tSetTimeout(function () { clearInterval(alertPoll); }, CFG.CSRF_DETECT_WINDOW_MS);
    var obs = new MutationObserver(function () { checkAlertAndBypass(); });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    tSetTimeout(function () { obs.disconnect(); }, CFG.CSRF_DETECT_WINDOW_MS);
  }

  // ============================ MAIN LOOP ====================================
  function tick() {
    if (navigating) return;
    try {
      if (isNotes()) {
        if (!_doneFired) {
          _doneFired = true;
          setStatus('ถึงปลายทางแล้ว');
          try { window.__bridgeDone && window.__bridgeDone(location.href); } catch (e) {}
        }
        return;
      }
      if (isVuotlink()) { vuotlinkTick(); return; }
      if (isAdBounceSite()) { adBounceTick(); return; }
      if (!chainExpired) {
        if (isEz4()) { setStatus('EZ4Short: รอ countdown...'); ezTick(); return; }
        if (hasWpsForm()) { setStatus('WP-SafeLink: กำลังผ่าน...'); wpsTick(); return; }
        if (isDroplink()) { setStatus('Droplink: รอลิงก์ continue...'); dlTick(); return; }
      } else if (!chainExpiredNotified) {
        chainExpiredNotified = true;
        setStatus('หมดเวลา 3 นาที — เหลือโหมด bounce/vuotlink เท่านั้น');
      }
    } catch (e) { log('tick error:', e.message); }
  }

  function startLoop() {
    var loop = tSetInterval(tick, CFG.TICK_MS);
    tSetTimeout(function () { clearInterval(loop); chainExpired = true; }, CFG.RUN_TIMEOUT_MS);
  }

  function boot() {
    log('headless bootstrap เริ่มที่', location.href);
    setupErrorListener();
    startLoop();
    startCsrfAutoDetect();
    // เผื่อหน้าที่โหลดมาแล้วเป็นปลายทางเลย (ไม่ทันรอบ tick แรก)
    tick();
  }

  boot();
})();
