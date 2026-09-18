'use strict';

const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) throw new Error('กรุณาตั้ง SUPABASE_URL และ SUPABASE_SECRET_KEY ใน .env');

const supabase = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { 'X-Client-Info': 'bot-link-auto-vps' } }
});

async function must(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function setRuntime(name, status, detail = '') {
  return must(await supabase.from('runtime_status').upsert({ name, status, detail, updated_at: new Date().toISOString() }), 'runtime status');
}

module.exports = { supabase, must, setRuntime };
