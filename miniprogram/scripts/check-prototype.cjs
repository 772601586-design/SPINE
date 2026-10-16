const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');

// Run the original 18-screen scenario + 4,000-tap regression against the adapted
// subpackage. Normalize its route prefix only at the test host boundary.
const root = path.resolve(__dirname, '..');
const original = path.resolve(root, '../spine1/demo/miniprogram');
const target = path.join(root, 'prototype');
const sourceConfig = JSON.parse(fs.readFileSync(path.join(original, 'app.json'), 'utf8'));
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
const bundle = app.subPackages.find(item => item.root === 'prototype');
assert.deepEqual(bundle.pages, sourceConfig.pages);
for (const route of bundle.pages) {
  for (const extension of ['js', 'json', 'wxml', 'wxss']) {
    assert.ok(fs.existsSync(path.join(target, route + '.' + extension)), route + '.' + extension);
  }
  const markup = fs.readFileSync(path.join(target, route + '.wxml'), 'utf8');
  assert.ok(markup.includes(fs.readFileSync(path.join(original, route + '.wxml'), 'utf8')), route + ': original content missing');
}
for (const filename of ['spine-app.js', 'scheduler.js', 'u.wxs']) {
  assert.equal(fs.readFileSync(path.join(target, 'core', filename), 'utf8'),
    fs.readFileSync(path.join(original, 'core', filename), 'utf8'), filename + ': prototype business logic diverged');
}
let checker = fs.readFileSync(path.join(original, 'tools/check.js'), 'utf8');
checker = checker.replace("const ROOT = path.resolve(process.argv[2] || '.');", `const ROOT = ${JSON.stringify(target)};`);
// Prototype main screens use a custom footer, so reLaunch replaces native switchTab.
checker = checker.replace("if (kind === 'switchTab') {", "if (kind === 'switchTab' || (kind === 'reLaunch' && TABS.indexOf(route) !== -1)) {");
checker = checker.replace("  navLog.push(kind + ' ' + route.split('/')[1]);", "  route = route.replace(/^prototype\\//, '');\n  navLog.push(kind + ' ' + route.split('/')[1]);");
checker = checker.replace('  inst.route = route;', "  inst.route = 'prototype/' + route;");
checker = checker.replace('inst.route = \'prototype/\' + route; inst.data = {};', "inst.route = 'prototype/' + route; inst.data = JSON.parse(JSON.stringify(def.data || {}));");
checker = checker.replace('wxml[p.route]', "wxml[p.route.replace(/^prototype\\//, '')]");
checker = checker.replace('wxml[p.route]', "wxml[p.route.replace(/^prototype\\//, '')]");
checker = checker.replace("cur().route.split('/')[1]", "cur().route.split('/')[2]");
// The two outer notices are real controls and should not be hit by the random
// original-content walk, which would intentionally exit/reset the test application.
checker = checker.replace(".filter((x) => x.method !== 'resetDemo')", ".filter((x) => !['resetDemo', 'exitDemo', 'choosePrototypeTab'].includes(x.method))");
checker = checker.replace("console.log('PROBLEMS', uniq.length);", "if (uniq.length) process.exitCode = 1;\nconsole.log('PROBLEMS', uniq.length);");
checker += `
storage['spine.session.token'] = 'real-session-sentinel';
storage['spine.local-recordings.v1.1'] = ['real-recording-sentinel'];
for (const screen of ['today', 'train', 'growth', 'community', 'me']) {
  store.app.go(screen); drain();
  cur().choosePrototypeTab({currentTarget: {dataset: {screen}}}); drain();
  if (where() !== screen) throw new Error('Prototype footer routing failed: ' + screen);
}
cur().resetDemo(); drain();
if (where() !== 'welcome') throw new Error('Prototype reset did not return to onboarding');
if (storage['spine.session.token'] !== 'real-session-sentinel') throw new Error('Prototype reset touched real session');
if (storage['spine.local-recordings.v1.1'][0] !== 'real-recording-sentinel') throw new Error('Prototype reset touched local recordings');
pageDefs['pages/login/index'] = {data: {}};
cur().exitDemo(); drain();
if (where() !== 'login') throw new Error('Prototype exit did not return to real app');
`;
const runner = new Module(path.join(__dirname, '.prototype-check-runner.cjs'), module);
runner.filename = path.join(__dirname, '.prototype-check-runner.cjs');
runner.paths = module.paths;
runner._compile(checker, runner.filename);
console.log('Prototype subpackage: 18 screens present, adapted routing checked.');
