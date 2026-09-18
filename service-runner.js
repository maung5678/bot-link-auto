'use strict';

const { spawn } = require('child_process');
const path = require('path');

const services = [
  ['COLLECTOR', 'telegram-listener.js'],
  ['SALES', 'sales-bot.js'],
  ['DASHBOARD', 'dashboard-server.js']
];
const children = new Map();
let stopping = false;

function start(name, file) {
  const child = spawn(process.execPath, [path.join(__dirname, file)], {
    cwd: __dirname, env: process.env, stdio: ['inherit', 'pipe', 'pipe']
  });
  children.set(name, child);
  child.stdout.on('data', (data) => process.stdout.write(`[${name}] ${data}`));
  child.stderr.on('data', (data) => process.stderr.write(`[${name}] ${data}`));
  child.on('exit', (code) => {
    children.delete(name);
    console.log(`[${name}] หยุดทำงาน code=${code}`);
    if (!stopping) setTimeout(() => start(name, file), 5000);
  });
}

for (const service of services) start(...service);
console.log('เริ่ม Collector + Sales Bot + Dashboard แล้ว');

function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children.values()) child.kill('SIGTERM');
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
