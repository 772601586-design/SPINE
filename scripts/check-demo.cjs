const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'spine1/demo/miniprogram');
const destination = path.join(root, 'miniprogram-demo');
let compared = 0;
function same(relative) {
  const original = path.join(source, relative);
  if (fs.statSync(original).isDirectory()) {
    for (const entry of fs.readdirSync(original)) same(path.join(relative, entry));
    return;
  }
  assert.ok(fs.readFileSync(original).equals(fs.readFileSync(path.join(destination, relative))), `${relative} differs from the source demo`);
  compared++;
}
for (const entry of ['app.js', 'app.json', 'app.wxss', 'sitemap.json', 'core', 'pages', 'assets']) same(entry);
const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
assert.equal(project.miniprogramRoot, 'miniprogram-demo/');
const app = JSON.parse(fs.readFileSync(path.join(destination, 'app.json'), 'utf8'));
assert.equal(app.pages.length, 18);
assert.equal(app.tabBar.list.length, 5);
assert.equal(app.pages[0], 'pages/welcome/index');
const result = spawnSync(process.execPath, [path.join(source, 'tools/check.js'), destination], { encoding: 'utf8' });
assert.equal(result.status, 0, result.stderr);
assert.match(result.stdout, /PROBLEMS\s+0\b/, result.stdout);
console.log(result.stdout.trim());
console.log(`PASS: ${compared} runtime files are byte-for-byte identical to the source demo; project opens the 18-page native demo directly.`);
