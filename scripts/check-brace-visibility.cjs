const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../miniprogram-demo');
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const storage = {}, modules = new Map(), queue = [], timers = new Set();
let activePage, failWrites = false, nextTimer = 0;
let now = Date.parse('2026-10-26T04:00:00Z');
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
const wx = {
  getStorageSync: key => clone(storage[key]),
  setStorageSync(key, value) {
    if (failWrites) throw new Error('storage full');
    storage[key] = clone(value);
  },
  removeStorageSync: key => { delete storage[key]; },
  nextTick: callback => queue.push(callback),
  showToast() {}, showModal() {}, navigateTo() {}, navigateBack() {},
  switchTab() {}, redirectTo() {}, reLaunch() {}
};
function moduleAt(relative) {
  const filename = path.join(root, relative);
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} };
  modules.set(filename, module);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, wx, Date: Clock,
    getCurrentPages: () => activePage ? [activePage] : [],
    setInterval() { const id = ++nextTimer; timers.add(id); return id; },
    clearInterval(id) { timers.delete(id); },
    require: request => moduleAt(path.relative(root, path.resolve(path.dirname(filename), request + '.js')))
  }, { filename });
  return module.exports;
}
function page(name) {
  let definition;
  const filename = path.join(root, 'pages', name, 'index.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    wx, Date: Clock, Page: value => { definition = value; },
    require: request => moduleAt(path.relative(root, path.resolve(path.dirname(filename), request + '.js')))
  }, { filename });
  return Object.assign(definition, {
    route: 'pages/' + name + '/index', data: clone(definition.data || {}),
    getTabBar() { return { setData() {} }; },
    setData(values) { Object.assign(this.data, clone(values)); }
  });
}
function show(target) {
  if (activePage && activePage.onHide) activePage.onHide();
  activePage = target;
  target.onShow();
  while (queue.length) queue.shift()();
}

const brace = moduleAt('core/brace-records.js');
const historical = { start: now - 7200000, end: now - 3600000 };
storage[brace.KEY] = { records: [historical], startedAt: null };
const oldStorage = JSON.stringify(storage[brace.KEY]);
assert.equal(brace.load().enabled, true, 'records saved before this preference default to showing the feature');
assert.equal(JSON.stringify(storage[brace.KEY]), oldStorage, 'reading old records never rewrites them');

const me = page('me'), train = page('train'), oldBrace = page('brace');
show(me);
assert.equal(me.data.braceEnabled, true);
assert.equal(timers.size, 0, 'the profile setting does not need a live wear-summary timer');
me.toggleBraceFeature();
assert.equal(me.data.braceEnabled, false);
assert.equal(brace.load().enabled, false);
assert.deepEqual(clone(brace.load().records), [historical]);
show(train);
assert.equal(train.data.braceEnabled, false, 'switching to training reloads the saved visibility preference');
const trainTemplate = fs.readFileSync(path.join(root, 'pages/train/index.wxml'), 'utf8');
const braceBar = trainTemplate.match(/<view\b[^>]*class="brace-bar"[^>]*>/);
assert.ok(braceBar, 'training retains the compact brace bar');
assert.match(braceBar[0], /wx:if="{{\s*braceEnabled\s*}}"/, 'the saved preference actually controls whether the bar is rendered');

const beforeBlockedStart = JSON.stringify(storage[brace.KEY]);
assert.throws(() => brace.toggle(now), undefined, 'disabled features cannot start through a stale or direct entry');
assert.equal(JSON.stringify(storage[brace.KEY]), beforeBlockedStart);
show(oldBrace);
oldBrace.toggleBraceRecord();
assert.equal(oldBrace.data.braceEnabled, false);
assert.equal(oldBrace.data.braceWearing, false);
assert.ok(oldBrace.data.braceError, 'the old page cannot silently bypass the feature preference');
assert.equal(JSON.stringify(storage[brace.KEY]), beforeBlockedStart);

show(me);
me.toggleBraceFeature();
assert.equal(brace.load().enabled, true);
assert.equal(brace.load().startedAt, null, 'enabling visibility does not begin wearing');
brace.toggle(now);
const startedAt = now;
now += 45 * 60000;
me.reloadBrace();
me.toggleBraceFeature();
assert.equal(me.data.braceEnabled, false);
assert.equal(me.data.braceWearing, false);
assert.equal(brace.load().startedAt, null);
assert.deepEqual(clone(brace.load().records), [historical, { start: startedAt, end: now }], 'disabling saves the active interval and preserves history');
const stopped = JSON.stringify(storage[brace.KEY]);
now += 30000;
brace.setEnabled(false, now);
assert.equal(JSON.stringify(storage[brace.KEY]), stopped, 'repeating disable never creates another interval');
brace.setEnabled(true, now);
assert.equal(brace.load().startedAt, null, 're-enabling does not resume a stopped interval');

// Persisted state is authoritative across fresh module and page instances.
brace.setEnabled(false, now);
modules.clear();
const afterRestart = moduleAt('core/brace-records.js');
assert.equal(afterRestart.load().enabled, false);
const reopenedMe = page('me');
show(reopenedMe);
assert.equal(reopenedMe.data.braceEnabled, false);
reopenedMe.toggleBraceFeature();
afterRestart.toggle(now);
now += 60000;
reopenedMe.reloadBrace();
const beforeFailure = JSON.stringify(storage[brace.KEY]);
failWrites = true;
reopenedMe.toggleBraceFeature();
assert.equal(reopenedMe.data.braceEnabled, true, 'failed persistence does not visually switch the feature off');
assert.equal(reopenedMe.data.braceWearing, true);
assert.ok(reopenedMe.data.braceError);
assert.equal(JSON.stringify(storage[brace.KEY]), beforeFailure, 'failure must preserve both preference and active/history records');
failWrites = false;
reopenedMe.toggleBraceFeature();
assert.equal(reopenedMe.data.braceEnabled, false);
assert.equal(reopenedMe.data.braceWearing, false);
assert.equal(reopenedMe.data.braceError, '');

moduleAt('core/store.js').reset();
assert.equal(storage[afterRestart.KEY], undefined, 'demo reset clears the preference together with its records');
assert.equal(afterRestart.load().enabled, true, 'reset restores the default visible state');
assert.equal(afterRestart.load().startedAt, null);
assert.deepEqual(clone(afterRestart.load().records), []);
if (activePage.onHide) activePage.onHide();
console.log('PASS: brace visibility persists across pages/restarts, old records remain compatible, disable saves active wear once, re-enable does not start wear, old routes cannot bypass it, failed writes preserve state, and reset restores defaults.');
