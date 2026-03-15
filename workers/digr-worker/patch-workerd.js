#!/usr/bin/env node
/**
 * Patch workerd for Termux/Android arm64.
 *
 * workerd doesn't include "android arm64 LE" in its platform map,
 * but the linux-arm64 binary works fine. This script adds the mapping
 * so `wrangler deploy` works from Termux.
 *
 * Run automatically via postinstall, or manually: node patch-workerd.js
 */
const fs = require('fs');
const path = require('path');

if (process.platform !== 'android') {
  // Only needed on Android/Termux
  process.exit(0);
}

const mainJs = path.join(__dirname, 'node_modules', 'workerd', 'lib', 'main.js');
if (!fs.existsSync(mainJs)) {
  console.log('workerd not installed yet, skipping patch');
  process.exit(0);
}

let content = fs.readFileSync(mainJs, 'utf8');

if (content.includes('"android arm64 LE"')) {
  console.log('workerd already patched for android arm64');
  process.exit(0);
}

// Add android arm64 mapping right before linux arm64
const patched = content.replace(
  '"linux arm64 LE": "@cloudflare/workerd-linux-arm64"',
  '"android arm64 LE": "@cloudflare/workerd-linux-arm64",\n  "linux arm64 LE": "@cloudflare/workerd-linux-arm64"'
);

if (patched === content) {
  console.error('Could not find insertion point in workerd/lib/main.js');
  process.exit(1);
}

fs.writeFileSync(mainJs, patched);
console.log('Patched workerd for android arm64 (maps to linux-arm64)');
