'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const pageSource = fs.readFileSync(path.join(root, 'miniprogram/knowledge/page.js'), 'utf8');
const config = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8'));
const demoConfig = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram-demo/app.json'), 'utf8'));
assert.equal(config.pages[0], 'pages/login/index');
assert.equal(demoConfig.pages[0], 'pages/welcome/index');
for (const app of [config, demoConfig]) assert.ok(app.pages.includes('pages/knowledge/index'));
assert.equal(pageSource, fs.readFileSync(path.join(root, 'miniprogram-demo/core/knowledge-page.js'), 'utf8'));

function page(request) {
  const host = { module: { exports: {} }, wx: { navigateTo(o) { assert.ok(o.url.startsWith('/pages/knowledge/index')); }, showToast() {}, setClipboardData() {} } };
  vm.runInNewContext(pageSource, host);
  const p = host.module.exports(request);
  p.data = JSON.parse(JSON.stringify(p.data));
  p.setData = updates => Object.assign(p.data, updates);
  return p;
}
async function main() {
  // The actual server uses {data:[...],meta:{...}}; test both client adapters.
  const envelope = { data: [{ id: 'test' }], meta: { count: 2, page: 1, next: 2, suggestions: ['test'] } };
  const host = { module: { exports: {} }, require: () => ({ apiBase: 'http://127.0.0.1:8000' }), wx: {
    getStorageSync: () => '', request: options => options.success({ statusCode: 200, data: envelope }),
  } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'miniprogram-demo/core/knowledge-api.js'), 'utf8'), host);
  const response = await host.module.exports('GET', '/api/v1/knowledge/articles/');
  assert.equal(response.results[0].id, 'test'); assert.equal(response.next, 2);
  const ts = require('../frontend/node_modules/typescript');
  const source = ts.transpileModule(fs.readFileSync(path.join(root, 'miniprogram/services/request.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const native = { exports: {}, require: () => ({ API_BASE_URL: 'http://127.0.0.1:8000', RUNTIME_TARGET: 'developerTool' }), wx: host.wx };
  vm.runInNewContext(source, native);
  assert.ok(Array.isArray(await native.exports.request('GET', '/unchanged-existing-endpoint/')), 'Existing clients still receive arrays');
  assert.equal((await native.exports.request('GET', '/knowledge/', undefined, { preservePagination: true })).next, 2);

  let pending = [];
  const p = page(() => new Promise(resolve => pending.push(resolve)));
  p.onLoad({ mode: 'list' });
  const older = p.load(); const newer = p.load();
  pending[1]({ results: [{ id: 'new' }], next: null, count: 1 }); await newer;
  pending[0]({ results: [{ id: 'old' }], next: null, count: 1 }); await older;
  assert.equal(p.data.results[0].id, 'new', 'Slow stale response cannot overwrite newer search');
  p.data.next = 2;
  const append = p.load(true); pending[2]({ results: [{ id: 'new' }, { id: 'next' }], next: null, count: 2 }); await append;
  assert.equal(p.data.results.length, 2, 'Pages deduplicate by stable article ID');

  const withdrawn = page(async () => { const error = new Error('withdrawn'); error.status = 410; throw error; });
  withdrawn.onLoad({ mode: 'article', id: 'test' }); withdrawn.data.article = { title: 'stale medical content' }; await withdrawn.load();
  assert.equal(withdrawn.data.article, null); assert.match(withdrawn.data.error, /撤稿/);
  const detail = page(async () => ({ id: 'test', title: 'Test only', keywords: [], updated_at: '2026-11-03', body_html: '<p>Test</p>' }));
  detail.onLoad({ mode: 'article', id: 'test' }); await detail.load();
  assert.equal(detail.onShareAppMessage().path, '/pages/knowledge/index?mode=article&id=test');
  detail.onHide(); assert.equal(detail.data.article, null, 'Hidden article is revalidated on next show');

  if (process.argv.includes('--live')) {
    const origin = 'http://127.0.0.1:8000/api/v1/knowledge/';
    const catalog = await (await fetch(origin + 'catalog/')).json();
    assert.equal(catalog.data.categories.length, 6); assert.equal(catalog.data.topics.length, 6);
    const search = await (await fetch(origin + 'articles/?q=侧弯度数')).json();
    assert.ok(Array.isArray(search.data)); assert.equal(typeof search.meta.count, 'number');
    for (const c of catalog.data.categories) assert.equal((await fetch(origin + 'articles/?category=' + c.id)).status, 200);
    for (const t of catalog.data.topics) assert.equal((await fetch(origin + 'articles/?topic=' + t.id)).status, 200);
    const draft = await fetch(origin + 'articles/01-01/'); assert.equal(draft.status, 404);
    console.log('PASS: live API catalog, all six category/topic routes, serialized pagination and imported-draft access control.');
  }
  console.log('PASS: existing launch routes, shared client UI, real response envelopes, pagination dedupe, stale requests, withdrawal clearing and safe share links.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
