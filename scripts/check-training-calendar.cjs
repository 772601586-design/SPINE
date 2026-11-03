const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../miniprogram-demo');
const KEY = 'xiaoshu.training.flow.v2';
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const action = (id, values, extra = {}) => ({ cardId: id, name: '当时动作 ' + id, groupName: '当时分组',
  confirmed: true, mode: 'count', amount: 10, sets: 2, values, guidedSets: [], ...extra });
const session = (id, date, rows) => ({ id, planId: 'plan-' + id, planName: '当时计划 ' + id, date, rows });
const records = [
  session('complete-a', '2026-10-01', [action('first', [10, 10, 0, null])]),
  session('complete-b', '2026-10-01', [action('second', [120], { mode: 'timer', amount: 120, sets: 1, totalOnly: true })]),
  session('mixed-done', '2026-10-02', [action('mixed-a', [10, 10])]),
  session('mixed-empty', '2026-10-02', [action('mixed-b', [null, null])]),
  session('cadence-only', '2026-10-03', [action('cadence', [null, null], { guidedSets: [true, true] })]),
  session('cadence-complete', '2026-10-03', [action('cadence-companion', [10, 10])]),
  session('zero', '2026-10-04', [action('zero', [0, 0])]),
  session('zero-complete', '2026-10-04', [action('zero-companion', [10, 10])]),
  session('partial', '2026-10-05', [action('partial', [10, 0])]),
  session('details & main', '2026-10-06', [
    action('count', [0, null, 8], { amount: 5, feeling: '保留原来填写的感受' }),
    action('breath', [3], { mode: 'breath', amount: 3, sets: 1 }),
    action('timer', [60], { mode: 'timer', amount: 120, sets: 1, totalOnly: true }),
    action('review', [], { confirmed: false, mode: '', amount: 0, sets: 0, sourceDoseText: '医生未注明训练量' })
  ]),
  session('details-other', '2026-10-06', [action('extra', [10, 10, null])]),
  session('previous-month', '2026-09-30', [action('september', [10, 10])]),
  session('invalid-date', '2026-10-99', [action('invalid', [10, 10])])
];
const fixture = { version: 2, cards: [{ id: 'count', name: '后来改名的动作', amount: 999, sets: 9, mode: 'timer' }],
  plans: [{ id: 'plan-details & main', name: '后来改名的计划' }], sessions: records };
const storage = { [KEY]: clone(fixture), 'spine-state-v1': { onboarded: true, stage: 'brace', screen: 'me', pine: 36 } };
const navigation = [], queue = [], modules = new Map();
let writes = 0, reads = 0, activePage;
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-10-27T16:30:00Z'])); }
  static now() { return Date.parse('2026-10-27T16:30:00Z'); }
  getDate() { throw Error('calendar must not depend on the host local timezone'); }
}
const wx = {
  getStorageSync(key) { reads++; return clone(storage[key]); },
  setStorageSync(key, value) { writes++; storage[key] = clone(value); },
  nextTick: callback => queue.push(callback), showToast() {},
  navigateTo: options => navigation.push(options.url),
  switchTab: options => navigation.push(options.url), navigateBack() {},
  setClipboardData: options => { wx.clipboard = options.data; }
};
function moduleAt(relative) {
  const filename = path.resolve(root, relative);
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} }; modules.set(filename, module);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, wx, Date: Clock,
    getCurrentPages: () => activePage ? [activePage] : [],
    require: name => moduleAt(path.resolve(path.dirname(filename), name + '.js')),
    setInterval() { return 1; }, clearInterval() {}
  }, { filename });
  return module.exports;
}
function page(name, query = {}) {
  let definition;
  const filename = path.join(root, 'pages', name, 'index.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { Page: value => { definition = value; }, wx, Date: Clock,
    require: name => moduleAt(path.resolve(path.dirname(filename), name + '.js'))
  }, { filename });
  const value = { ...definition, route: 'pages/' + name + '/index', data: clone(definition.data || {}),
    setData(values) { Object.assign(this.data, clone(values)); } };
  activePage = value;
  if (value.onLoad) value.onLoad(query);
  if (value.onShow) value.onShow();
  while (queue.length) queue.shift()();
  return value;
}
const calendar = moduleAt('core/training-calendar.js'), t = moduleAt('core/training.js');
assert.equal(t.today(), '2026-10-28', 'calendar today follows China time across the UTC date boundary');
assert.equal(calendar.validMonth('2026-10'), true);
for (const invalid of ['2026-1', '2026-00', '2026-13', '0000-01', '', '2026-10-01']) assert.equal(calendar.validMonth(invalid), false);
assert.equal(calendar.shiftMonth('2026-12', 1), '2027-01');
assert.equal(calendar.shiftMonth('2026-01', -1), '2025-12');
assert.equal(calendar.shiftMonth('2026-06', 18), '2027-12');
assert.equal(calendar.shiftMonth('0001-01', -1), '');
assert.equal(calendar.shiftMonth('9999-12', 1), '');
assert.equal(calendar.shiftMonth('2026-13', 1), '');
assert.equal(calendar.shiftMonth('2026-01', 0.5), '');
for (const [month, count, offset] of [['2024-02', 29, 3], ['2023-02', 28, 2], ['1900-02', 28, 3], ['2000-02', 29, 1], ['2026-06', 30, 0], ['2026-11', 30, 6], ['2021-02', 28, 0]]) {
  const view = calendar.monthView({ sessions: [] }, month, '2026-10-28', '');
  const days = view.cells.filter(cell => cell.date);
  assert.equal(days.length, count, month + ': Gregorian month length');
  assert.equal(view.cells.findIndex(cell => cell.date), offset, month + ': Monday-first weekday alignment');
  assert.equal(view.cells.length % 7, 0, 'calendar contains complete visual weeks');
  assert.equal(new Set(days.map(cell => cell.date)).size, count);
  assert.ok(days.every(cell => cell.state === 'empty'));
  assert.ok(view.cells.filter(cell => !cell.date).every(cell => cell.state === 'blank'));
}
assert.throws(() => calendar.monthView(fixture, '2026-13', t.today(), ''), /月份/);
assert.throws(() => calendar.dayDetails(fixture, '2026-02-30'), /日期/);

// Read-only projections use saved session snapshots even if live cards/plans have changed.
const frozen = freeze(clone(fixture)), before = JSON.stringify(frozen);
const historicalOnly = { sessions: frozen.sessions };
Object.defineProperty(historicalOnly, 'cards', { get() { throw Error('must not read current cards'); } });
Object.defineProperty(historicalOnly, 'plans', { get() { throw Error('must not read current plans'); } });
const month = calendar.monthView(historicalOnly, '2026-10', t.today(), '2026-10-06');
const cell = date => month.cells.find(day => day.date === date);
assert.equal(cell('2026-10-01').state, 'completed', 'all established sessions complete is green');
assert.equal(cell('2026-10-01').recordCount, 2);
for (const date of ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06']) {
  assert.equal(cell(date).state, 'incomplete', date + ': incomplete/null/guided-only/zero sessions keep the day warm');
}
assert.equal(cell('2026-10-02').recordCount, 2, 'all-null sessions must not be filtered out');
assert.equal(cell('2026-10-07').state, 'empty', 'no established session is neutral');
assert.equal(cell('2026-10-28').today, true);
assert.equal(cell('2026-10-06').selected, true);
assert.equal(month.completedDays, 1);
assert.equal(month.incompleteDays, 5);
assert.equal(month.cells.some(day => day.date === '2026-10-99'), false);

const day = calendar.dayDetails(historicalOnly, '2026-10-06');
assert.equal(day.state, 'incomplete');
assert.equal(day.recordCount, 2);
assert.equal(day.actionCount, 5);
assert.equal(day.completedActions, 2);
assert.equal(day.sessions[0].name, '当时计划 details & main');
const [counts, breath, timer, pending] = day.sessions[0].actions;
assert.equal(counts.name, '当时动作 count');
assert.equal(counts.dose, '2组 × 5次');
assert.equal(counts.groupName, '当时分组');
assert.equal(counts.feeling, '保留原来填写的感受');
assert.deepEqual(clone(counts.sets.map(set => set.actual)), ['0次', '未记录', '8次']);
assert.equal(counts.sets[0].recorded, true, 'explicit zero is a recorded amount');
assert.equal(counts.sets[0].done, false);
assert.equal(counts.sets[1].recorded, false);
assert.equal(counts.sets[2].extra, true);
assert.equal(counts.sets[2].label, '追加第 1 组');
assert.equal(counts.sets[2].expected, '额外记录');
assert.equal(breath.sets[0].actual, '3次呼吸');
assert.equal(timer.dose, '2分钟');
assert.equal(timer.sets[0].actual, '60秒');
assert.equal(timer.sets[0].label, '单次练习');
assert.match(pending.dose, /医生未注明训练量/);
assert.equal(pending.sets.length, 0);
assert.equal(day.sessions[1].actions[0].done, true, 'extra unrecorded sets do not alter planned completion');
assert.equal(day.sessions[1].actions[0].sets[2].actual, '未记录');
assert.equal(calendar.dayDetails(historicalOnly, '2026-10-04').sessions[0].status, 'not_completed');
assert.equal(calendar.dayDetails(historicalOnly, '2026-10-03').sessions[0].status, 'unrecorded');
assert.equal(calendar.dayDetails(historicalOnly, '2026-10-07').state, 'empty');
assert.equal(JSON.stringify(frozen), before, 'calendar and detail projections cannot mutate history');
assert.equal(reads, 0, 'pure projections do not load storage');
assert.equal(writes, 0, 'pure projections do not write storage');

// The detail route remains read-only until an explicit jump to the existing editor.
const storedBefore = JSON.stringify(storage);
const detailPage = page('training-day', { date: '2026-10-06' });
assert.equal(detailPage.data.day.sessions.length, 2);
assert.equal(detailPage.data.day.sessions[0].actions[0].sets[0].actual, '0次');
detailPage.openRecord({ currentTarget: { dataset: { id: 'details & main' } } });
assert.equal(navigation.at(-1), '/pages/execution/index?session=details%20%26%20main');
const count = navigation.length;
detailPage.openRecord({ currentTarget: { dataset: { id: 'complete-a' } } });
assert.equal(navigation.length, count, 'the editor link must belong to the displayed day');
assert.equal(JSON.stringify(storage), storedBefore);
assert.equal(writes, 0);
const emptyPage = page('training-day', { date: '2026-10-07' });
assert.equal(emptyPage.data.day.recordCount, 0);
const invalidPage = page('training-day', { date: '2026-02-30' });
assert.equal(invalidPage.data.day, null);
assert.ok(invalidPage.data.error);
const defaultPage = page('training-day');
assert.equal(defaultPage.data.day.date, '2026-10-28');

// Editing one existing record refreshes all-day status without replacing history snapshots.
const refreshPage = page('training-day', { date: '2026-10-02' });
assert.equal(refreshPage.data.day.state, 'incomplete');
t.saveValues('mixed-empty', 'mixed-b', [10, 10]);
assert.equal(writes, 1);
refreshPage.onShow();
assert.equal(refreshPage.data.day.state, 'completed');
assert.equal(writes, 1, 're-entering detail only reads the updated records');

// Calendar browsing and returning from the editor preserve the chosen month and date.
const growthBefore = JSON.stringify(storage), growth = page('growth-records');
assert.equal(growth.data.calendarMonth, '2026-10');
assert.equal(growth.data.selectedTrainingDate, '2026-10-28');
assert.equal(growth.data.calendarDays.find(day => day.date === '2026-10-02').state, 'completed');
growth.previousMonth();
assert.equal(growth.data.calendarMonth, '2026-09');
assert.equal(growth.data.monthCompletedDays, 1);
growth.openTrainingDay({ currentTarget: { dataset: { date: '2026-09-30' } } });
assert.equal(navigation.at(-1), '/pages/training-day/index?date=2026-09-30');
assert.equal(growth.data.selectedTrainingDate, '2026-09-30');
const navigationBeforeInvalidDay = navigation.length;
for (const date of ['', '2026-09-31', '2026-10-01']) growth.openTrainingDay({ currentTarget: { dataset: { date } } });
assert.equal(navigation.length, navigationBeforeInvalidDay, 'blank/invalid/out-of-month cells cannot open detail');
growth.onShow();
assert.equal(growth.data.calendarMonth, '2026-09');
assert.equal(growth.data.selectedTrainingDate, '2026-09-30');
assert.equal(JSON.stringify(storage), growthBefore, 'month browsing and day selection never write training or profile data');
assert.equal(writes, 1);

t.saveValues('previous-month', 'september', [10, 0]);
growth.onShow();
assert.equal(growth.data.calendarMonth, '2026-09', 'returning after an edit keeps the browsed month');
assert.equal(growth.data.selectedTrainingDate, '2026-09-30');
assert.equal(growth.data.calendarDays.find(day => day.date === '2026-09-30').state, 'incomplete');
assert.equal(growth.data.monthCompletedDays, 0);
assert.equal(growth.data.monthIncompleteDays, 1);
assert.equal(writes, 2, 'only the two intentional editor updates write storage');
growth.nextMonth();
assert.equal(growth.data.calendarMonth, '2026-10');
growth.chooseMonth({ detail: { value: '2024-02' } });
assert.equal(growth.data.calendarDays.filter(day => day.date).length, 29);
growth.chooseMonth({ detail: { value: '2024-13' } });
assert.equal(growth.data.calendarMonth, '2024-02');
growth.chooseMonth({ detail: { value: '0001-01' } }); growth.previousMonth();
assert.equal(growth.data.calendarMonth, '0001-01');
growth.chooseMonth({ detail: { value: '9999-12' } }); growth.nextMonth();
assert.equal(growth.data.calendarMonth, '9999-12');
growth.resetMonth();
assert.equal(growth.data.calendarMonth, '2026-10');
assert.equal(growth.data.selectedTrainingDate, '2026-10-28');
growth.trainingSummary(); growth.copyTrainingSummary();
assert.match(wx.clipboard, /当时计划 details & main/);
assert.match(wx.clipboard, /0 \/ 未记录 \/ 8次/);
growth.backfillTraining();
assert.equal(navigation.at(-1), '/pages/execution/index?backfill=1');
assert.equal(writes, 2);

console.log('PASS: month boundaries/leap years, Monday alignment, all-session daily status, zero/null/extra sets, historical snapshots, read-only browsing/details, safe navigation and month-preserving editor-return refresh.');
