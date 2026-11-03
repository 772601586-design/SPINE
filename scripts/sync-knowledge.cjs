// Both native clients share the reading UI; their existing request/login adapters stay separate.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
for (const [from, to] of [
  ['miniprogram/knowledge/page.js', 'miniprogram-demo/core/knowledge-page.js'],
  ...['wxml', 'wxss', 'json'].map(ext => [`miniprogram/pages/knowledge/index.${ext}`, `miniprogram-demo/pages/knowledge/index.${ext}`]),
]) {
  fs.mkdirSync(path.dirname(path.join(root, to)), { recursive: true });
  fs.copyFileSync(path.join(root, from), path.join(root, to));
}
console.log('Knowledge reading UI synchronized.');
