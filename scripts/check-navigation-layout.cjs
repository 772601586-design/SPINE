const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../miniprogram-demo');
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const storage = {}, modules = new Map(), navigation = [], queue = [];
let activePage;
class Clock extends Date { static now() { return Date.parse('2026-10-22T04:00:00Z'); } }
const wx = { getStorageSync: key => clone(storage[key] || null), setStorageSync: (key, value) => { storage[key] = clone(value); },
  nextTick: fn => queue.push(fn), showToast() {}, navigateTo: options => navigation.push(options.url),
  switchTab: options => navigation.push(options.url), navigateBack() {}, redirectTo: options => navigation.push(options.url),
  setClipboardData: options => { wx.clipboard = options.data; } };
function moduleAt(relative) {
  const filename = path.join(root, relative);
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} }; modules.set(filename, module);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, wx, Date: Clock,
    getCurrentPages: () => activePage ? [activePage] : [], setInterval() { return 1; }, clearInterval() {},
    require: request => moduleAt(path.relative(root, path.resolve(path.dirname(filename), request + '.js'))) }, { filename });
  return module.exports;
}
function page(name) {
  let definition;
  const filename = path.join(root, 'pages', name, 'index.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { Page: item => { definition = item; }, wx, Date: Clock,
    require: request => moduleAt(path.relative(root, path.resolve(path.dirname(filename), request + '.js'))) });
  const tabState = {};
  return Object.assign(definition, { route: 'pages/' + name + '/index', data: clone(definition.data || {}), tabState,
    getTabBar() { return { setData(values) { Object.assign(tabState, values); } }; },
    setData(values) { Object.assign(this.data, clone(values)); } });
}
function flush() { while (queue.length) queue.shift()(); }
const t = moduleAt('core/training.js'), brace = moduleAt('core/brace-records.js');
const original = t.load(), session = t.session(original.plans[0].id, t.today(), false);
t.saveValues(session.id, session.rows[0].cardId, [5, 5, 5]);
brace.toggle(Clock.now() - 3600000); brace.toggle(Clock.now());
const sessionsBefore = JSON.stringify(t.load().sessions), braceBefore = JSON.stringify(storage[brace.KEY]);
const planning = page('planning'); activePage = planning; planning.onShow();
flush(); assert.equal(planning.tabState.selected, 0);
assert.ok(planning.data.cards.length); assert.ok(planning.data.drafts.length);
assert.equal(typeof planning.uploadScheme, 'function'); assert.equal(typeof planning.capture, 'function');
const train = page('train'); activePage = train; train.onShow();
flush(); assert.equal(train.tabState.selected, 1);
assert.equal(train.data.braceToday, '1小时0分钟'); assert.ok(train.data.records.some(row => row.cardId === session.rows[0].cardId));
train.onHide();
const me = page('me'); activePage = me; me.onShow(); flush(); assert.equal(me.tabState.selected, 3);
me.openGrowthRecords(); assert.equal(navigation.at(-1), '/pages/growth-records/index');
const community = page('community'); activePage = community; community.onShow(); flush(); assert.equal(community.tabState.selected, 2);
const records = page('growth-records'); activePage = records; records.onShow();
assert.equal(records.data.trainingHistory.length, 1); assert.equal(records.data.trainingHistory[0].id, session.id);
assert.equal(records.data.trainCount, 1); assert.equal(typeof records.reloadBrace, 'undefined');
records.trainingSummary(); records.copyTrainingSummary(); assert.ok(wx.clipboard.includes(session.rows[0].name));
records.openTrainingRecord({ currentTarget: { dataset: { id: session.id } } });
assert.equal(navigation.at(-1), '/pages/execution/index?session=' + session.id);
assert.equal(JSON.stringify(t.load().sessions), sessionsBefore, 'moving views preserves every actual training value');
assert.equal(JSON.stringify(storage[brace.KEY]), braceBefore, 'moving brace controls preserves wear records');
console.log('PASS: material controls move to planning, brace + daily list share training, profile opens growth records, training summaries/details remain usable, and existing records stay intact.');
