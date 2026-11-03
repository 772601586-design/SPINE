const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../miniprogram-demo');
const json = value => JSON.parse(JSON.stringify(value));
const storage = { 'spine-state-v1': { pine: 36 } };
const writes = [];
let failStorage = false;
class Clock extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-21T04:00:00Z'])); } static now() { return Date.parse('2026-10-21T04:00:00Z'); } }
const host = { wx: { getStorageSync: key => json(storage[key] || null), setStorageSync: (key, value) => {
  if (failStorage) throw Error('storage full'); storage[key] = json(value); writes.push(key);
} }, Date: Clock, module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(path.join(root, 'core/training.js'), 'utf8'), host);
const t = host.module.exports;
assert.equal(t.today(), '2026-10-21');
assert.equal(t.week('2026-10-21')[0].date, '2026-10-19');
assert.equal(t.validDate('2026-02-30'), false);
const draft = t.saveCard({ name: '现场新动作', sets: '', amount: '', mode: 'timer' }, false);
assert.ok(draft.id);
assert.equal(draft.confirmed, false);
const settings = { name: '核对后的计划', start: '2026-10-19', schedule: 'weekdays', weekdays: [0, 2, 4], cycleDays: 7, cycleTimes: 3, active: true, cardIds: [draft.id] };
assert.throws(() => t.savePlan(settings), /已核对/);
const card = t.saveCard({ ...draft, sets: 3, amount: 30 }, true);
const plan = t.savePlan(settings);
assert.equal(t.due(plan, '2026-10-21', t.load()), true);
assert.equal(t.due(plan, '2026-10-20', t.load()), false);
assert.throws(() => t.session(plan.id, '2026-10-22', true), /今天或过去/);
assert.throws(() => t.session(plan.id, '2026-10-20', false), /没有安排/);
const run = t.session(plan.id, '2026-10-21', false);
assert.equal(t.status(run), 'unrecorded');
assert.equal(t.status(t.saveValues(run.id, card.id, [0, '', ''])), 'not_completed', 'explicit zero is a saved noncompletion, not missing data');
assert.equal(t.session(plan.id, '2026-10-21', false).id, run.id);
let saved = t.saveValues(run.id, card.id, [30, 20, '']);
assert.equal(t.status(saved), 'partial');
assert.equal(t.complete(saved.rows[0]), false);
// Guided and manual updates target the same set, including a retry.
t.saveSet(run.id, card.id, 1, 30);
saved = t.saveSet(run.id, card.id, 2, 30);
assert.equal(t.status(saved), 'completed');
t.saveSet(run.id, card.id, 2, 30);
assert.equal(t.load().sessions.length, 1);
assert.equal(t.load().sessions[0].rows[0].values.length, 3);
assert.throws(() => t.saveValues(run.id, card.id, [30, -1, 30]), /实际完成量/);
saved = t.saveValues(run.id, card.id, [30, 30, 30, 5]);
assert.equal(saved.rows[0].sets, 3, 'extra actual sets do not change the prescription');
assert.equal(saved.rows[0].values.length, 4);
t.saveCard({ ...card, sets: 4, amount: 40 }, true);
t.savePlan({ ...plan, name: '新计划名称' });
assert.equal(t.load().sessions[0].rows[0].amount, 30, 'history keeps its original dose');
assert.equal(t.load().sessions[0].planName, '核对后的计划');
const backfill = t.session(plan.id, '2026-10-20', true);
t.saveValues(backfill.id, card.id, [40, 20, '', '']);
assert.equal(storage['spine-state-v1'].pine, 36, 'backfill never spends pine cones');
assert.equal(t.load().sessions.find(row => row.id === backfill.id).date, '2026-10-20');
const beforeFailure = JSON.stringify(storage[t.KEY]);
failStorage = true;
assert.throws(() => t.saveValues(run.id, card.id, [1, 2, 3]), /storage full/);
assert.equal(JSON.stringify(storage[t.KEY]), beforeFailure, 'failed persistence cannot mutate saved data');
failStorage = false;
const alternate = t.savePlan({ ...settings, id: undefined, schedule: 'alternate', cardIds: [card.id] });
const alternateRun = t.session(alternate.id, '2026-10-19', false);
t.saveValues(alternateRun.id, card.id, [40, 40, 40, 40]);
assert.equal(t.due(alternate, '2026-10-20', t.load()), false);
assert.equal(t.due(alternate, '2026-10-21', t.load()), true);
const period = t.savePlan({ ...settings, id: undefined, schedule: 'period', cycleDays: 7, cycleTimes: 1, cardIds: [card.id] });
const periodRun = t.session(period.id, '2026-10-19', false);
t.saveValues(periodRun.id, card.id, [40, 40, 40, 40]);
assert.equal(t.due(period, '2026-10-20', t.load()), false);
assert.equal(t.due(period, '2026-10-26', t.load()), true);
const config = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
assert.deepEqual(config.tabBar.list.map(item => item.text), ['制定', '训练', '社群', '我的']);
assert.deepEqual(config.tabBar.list.map(item => item.pagePath), ['pages/planning/index', 'pages/train/index', 'pages/community/index', 'pages/me/index']);
assert.ok(!config.tabBar.list.some(item => item.pagePath === 'pages/today/index'));
for (const route of config.pages) {
  for (const extension of ['js', 'json', 'wxml']) assert.ok(fs.existsSync(path.join(root, `${route}.${extension}`)), `${route}.${extension}`);
  new vm.Script(fs.readFileSync(path.join(root, `${route}.js`), 'utf8'), { filename: route });
  JSON.parse(fs.readFileSync(path.join(root, `${route}.json`), 'utf8'));
}
// Exercise page event handlers against the same persisted records.
const braceHost = { wx: host.wx, Date: Clock, module: { exports: {} }, setInterval: () => 1, clearInterval() {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'core/brace-records.js'), 'utf8'), braceHost);
function page(route) {
  let definition;
  const wx = { showToast() {}, chooseMedia(options) {
    assert.deepEqual(json(options.sourceType), ['camera']);
    assert.deepEqual(json(options.mediaType), ['video']);
    options.success({ tempFiles: [{ tempFilePath: '/tmp/video.mp4' }] }); options.complete();
  }, navigateTo(options) { assert.ok(config.pages.includes(options.url.split('?')[0].slice(1))); },
    redirectTo(options) { this.navigateTo(options); }, switchTab(options) { assert.ok(config.tabBar.list.some(tab => '/' + tab.pagePath === options.url)); } };
  const dependencies = { '../../core/training': t, '../../core/store': { enter() {} }, '../../core/brace-records': braceHost.module.exports, '../../core/voice': { stop() {}, speak() {} }, '../../core/scheme-upload': { choose: async () => null },
    '../../core/documents': { list: () => [] }, '../../core/document-recognition': {}, '../../core/scheme-import': { reconcileVideos() {} },
    '../../core/scheme-processing': { process: async () => ({}) }, '../../core/material-library': { isHidden: () => false, title: (_kind, _id, fallback) => fallback } };
  vm.runInNewContext(fs.readFileSync(path.join(root, `pages/${route}/index.js`), 'utf8'), {
    require: name => { assert.ok(dependencies[name], name); return dependencies[name]; }, Page: value => { definition = value; }, wx, Date: Clock,
    setInterval: () => 1, clearInterval() {},
  });
  return Object.assign(definition, { data: json(definition.data), setData(values) { Object.assign(this.data, json(values)); } });
}
const planningPage = page('planning'); planningPage.onShow();
assert.ok(planningPage.data.cards.length);
planningPage.capture(); planningPage.createCard(); planningPage.createPlan();
const trainingPage = page('train'); trainingPage.onShow(); trainingPage.backfill(); trainingPage.onHide();
const manual = page('execution'); manual.onLoad({ session: run.id, card: card.id });
manual.input({ currentTarget: { dataset: { index: 0 } }, detail: { value: '15' } }); manual.save();
assert.equal(t.load().sessions.find(item => item.id === run.id).rows[0].values[0], 15);
const follow = page('follow'); follow.onLoad({ session: run.id, card: card.id });
follow.start(); follow.completeExercise();
assert.deepEqual(json(t.load().sessions.find(item => item.id === run.id).rows[0].values), [30, 30, 30, 5], 'Finish confirms the current exercise prescription and retains extra manual sets');
assert.equal(follow.data.celebrating, true);
follow.onHide(); follow.onUnload();
// The old welcome/ready flow must enter the first native planning tab.
const legacyCache = new Map(), queue = [], navigation = [];
const legacyWx = Object.assign({}, host.wx, {
  removeStorageSync: key => { delete storage[key]; }, nextTick: callback => queue.push(callback), showToast() {},
  switchTab: options => { assert.ok(config.tabBar.list.some(item => '/' + item.pagePath === options.url)); navigation.push(options.url); },
  navigateTo: options => navigation.push(options.url), navigateBack() {}, redirectTo: options => navigation.push(options.url), reLaunch: options => navigation.push(options.url),
});
function legacyModule(relative) {
  const filename = path.join(root, relative);
  if (legacyCache.has(filename)) return legacyCache.get(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, wx: legacyWx, Date: Clock,
    getCurrentPages: () => [{ route: 'pages/welcome/index', spineScreen: 'welcome' }],
    require: request => legacyModule(path.relative(root, path.resolve(path.dirname(filename), request + '.js'))),
  }, { filename });
  legacyCache.set(filename, module.exports); return module.exports;
}
const legacyStore = legacyModule('core/store.js');
legacyStore.app.go('today');
while (queue.length) queue.shift()();
assert.equal(navigation.at(-1), '/pages/planning/index');
const welcome = legacyModule('core/bridge.js').bindPage('welcome', []);
welcome.onLoad();
assert.equal(navigation.at(-1), '/pages/planning/index');
legacyStore.app.go('growth');
while (queue.length) queue.shift()();
assert.equal(navigation.at(-1), '/pages/train/index', 'legacy growth links open the relocated brace section');
legacyStore.app.renderVals().saveUpload();
while (queue.length) queue.shift()();
assert.equal(navigation.at(-1), '/pages/growth-records/index', 'new growth uploads remain in the profile growth records');
const pine = legacyStore.app.state.pine;
legacyStore.app.renderVals().doMakeup();
while (queue.length) queue.shift()();
assert.equal(legacyStore.app.state.pine, pine);
assert.equal(navigation.at(-1), '/pages/execution/index');
console.log('PASS: four tabs; draft confirmation; scheduling; partial completion; guided/manual shared sets; free backfill; history snapshots; extra sets; failed writes; page handlers and routes.');
