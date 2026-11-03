const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../miniprogram-demo');
const clone = value => JSON.parse(JSON.stringify(value));
const KEY = 'xiaoshu.training.flow.v2';

function harness(options = {}) {
  let clock = Date.parse('2026-10-27T04:00:00Z');
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  const selected = Object.assign({ cardId: 'current', name: '当前动作', confirmed: true, sets: 2,
    amount: 10, mode: 'timer', values: [null, null], guidedSets: [], feeling: '保留此前填写的感受' }, options.row);
  const other = { cardId: 'other', name: '另一动作', confirmed: true, sets: 2, amount: 5,
    mode: 'count', values: [2, null], guidedSets: [true], feeling: '另一动作的感受' };
  const storage = { [KEY]: { version: 2, cards: [], plans: [], sessions: [
    { id: 'session', planId: 'plan', date: '2026-10-27', rows: [selected, other] }
  ] } };
  const state = { failWrites: false, failNavigation: false, writes: 0, stackDepth: options.stackDepth || 2,
    timers: new Map(), timerId: 0, speech: [], voiceStops: 0, modals: [], navigation: [], toasts: [], guard: false };
  const wx = {
    getStorageSync: key => clone(storage[key] || null),
    setStorageSync(key, value) {
      if (state.failWrites) throw Error('storage full');
      storage[key] = clone(value); state.writes++;
    },
    getWindowInfo: () => ({ statusBarHeight: 24 }),
    getMenuButtonBoundingClientRect: () => ({ top: 30, height: 32 }),
    showToast: value => state.toasts.push(value),
    showModal: value => state.modals.push(value),
    enableAlertBeforeUnload() { state.guard = true; },
    disableAlertBeforeUnload() { state.guard = false; },
    navigateBack(value) { state.navigation.push('back'); if (state.failNavigation) value.fail(); },
    switchTab(value) { state.navigation.push(value.url); if (state.failNavigation) value.fail(); }
  };
  const training = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'core/training.js'), 'utf8'), { module: training, wx, Date: Clock });
  const t = training.exports;
  const voice = { speak: value => state.speech.push(value), stop: () => { state.voiceStops++; } };
  function open() {
    let definition;
    vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/follow/index.js'), 'utf8'), {
      wx, Date: Clock, Page: value => { definition = value; },
      require: name => { assert.ok(['../../core/training', '../../core/voice'].includes(name)); return name.endsWith('/training') ? t : voice; },
      getCurrentPages: () => Array.from({ length: state.stackDepth }, () => ({})),
      setInterval(callback) { const id = ++state.timerId; state.timers.set(id, callback); return id; },
      clearInterval(id) { state.timers.delete(id); }
    });
    const page = { ...definition, data: clone(definition.data), setData(values) { Object.assign(this.data, clone(values)); } };
    page.onLoad({ session: 'session', card: 'current' }); page.onShow(); return page;
  }
  return { state, storage, t, open, record: () => clone(t.load().sessions[0]),
    advance(milliseconds) { clock += milliseconds; for (const callback of [...state.timers.values()]) callback(); },
    answerExit(confirm) { assert.ok(state.modals.length, 'an exit confirmation must be displayed'); state.modals.shift().success({ confirm, cancel: !confirm }); }
  };
}

// A paused interval must not become training time when the user continues.
{
  const h = harness(), page = h.open();
  assert.equal(page.data.hasStarted, false);
  assert.equal(page.data.trainingStarted, false);
  page.completeExercise();
  assert.equal(h.state.writes, 0, 'Finish cannot save an exercise that has never started');
  assert.equal(page.data.celebrating, false);
  page.togglePlayback(); page.start();
  assert.equal(h.state.timers.size, 1, 'repeated Start cannot create parallel timers');
  assert.equal(page.data.hasStarted, true);
  assert.equal(page.data.running, true);
  h.advance(2200); page.togglePlayback();
  assert.equal(page.elapsed, 2200);
  assert.equal(page.data.running, false);
  assert.equal(h.state.timers.size, 0);
  h.advance(30000); page.togglePlayback(); h.advance(1800);
  assert.equal(page.data.value, 6, 'only four seconds of active training have elapsed');
  assert.equal(page.data.progress, 40);
  page.pause();
  page.selectGroup({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(page.data.hasStarted, false, 'a fresh group shows Start rather than Continue');
  assert.equal(page.data.trainingStarted, true, 'an exercise remains started after selecting another group');
  assert.equal(page.data.value, 10);
  assert.equal(h.state.writes, 0);
  page.onUnload();
}

// Finish is an explicit confirmation of every planned set of this exercise only.
{
  const h = harness({ row: { values: [4, null, 6, null] } }), page = h.open();
  const before = h.record();
  page.start(); h.advance(1000); page.completeExercise();
  const after = h.record();
  assert.deepEqual(after.rows[0].values, [10, 10, 6, null]);
  assert.equal(after.rows[0].feeling, before.rows[0].feeling);
  assert.deepEqual(after.rows[1], before.rows[1], 'Finish must not complete other exercises');
  assert.deepEqual(after.rows[0].guidedSets, before.rows[0].guidedSets, 'manual confirmation does not invent cadence history');
  assert.equal(page.data.currentDone, true);
  assert.equal(page.data.celebrating, true);
  assert.equal(page.data.saving, false);
  assert.equal(h.state.timers.size, 0);
  assert.equal(h.state.guard, false);
  const writes = h.state.writes;
  page.completeExercise(); page.start();
  assert.equal(h.state.writes, writes, 'duplicate Finish does not rewrite the record');
  assert.equal(h.state.timers.size, 0, 'celebration cannot restart training');
  page.requestExit();
  assert.equal(h.state.modals.length, 0, 'successfully saved completion may return directly');
  assert.deepEqual(h.state.navigation, ['back']);
  page.onUnload();
}

// Natural cadence completion remains separate from the user's Finish confirmation.
{
  const h = harness({ row: { amount: 2 } }), page = h.open();
  page.start(); h.advance(2000);
  assert.equal(page.data.finished, true);
  assert.equal(page.data.celebrating, false);
  assert.deepEqual(h.record().rows[0].values, [null, null]);
  assert.deepEqual(h.record().rows[0].guidedSets, [true, false]);
  assert.equal(h.state.timers.size, 0);
  page.onUnload();
  const reopened = h.open();
  assert.equal(reopened.data.index, 1, 'reopening resumes the first set without saved cadence or actual completion');
  reopened.onUnload();
}

// A rejected write cannot show the celebration or change persistent training data.
{
  const h = harness(), page = h.open(), before = JSON.stringify(h.storage);
  page.start(); h.advance(1000); h.state.failWrites = true; page.completeExercise();
  assert.equal(JSON.stringify(h.storage), before);
  assert.equal(page.data.celebrating, false);
  assert.equal(page.data.saving, false);
  assert.match(page.data.error, /storage full/);
  assert.equal(h.state.guard, true);
  assert.equal(h.state.timers.size, 0);
  assert.equal(h.state.navigation.length, 0);
  h.state.failWrites = false; page.completeExercise();
  assert.equal(page.data.celebrating, true, 'failed Finish can be retried without losing the started state');
  assert.deepEqual(h.record().rows[0].values, [10, 10]);
  assert.equal(h.state.writes, 1);
  page.onUnload();
}
{
  const h = harness({ row: { amount: 1 } }), page = h.open();
  page.start(); h.state.failWrites = true; h.advance(1000);
  assert.equal(page.data.celebrating, false);
  assert.deepEqual(h.record().rows[0].values, [null, null]);
  assert.deepEqual(h.record().rows[0].guidedSets, []);
  assert.equal(h.state.toasts.length, 0, 'failed cadence persistence must not show a success toast');
  assert.ok(!h.state.speech.includes('done'));
  page.onUnload();
}

// Exit confirmation pauses immediately, cancellation keeps the page resumable, and exit cleans up.
{
  const h = harness(), page = h.open();
  page.start(); h.advance(1000);
  const stops = h.state.voiceStops;
  page.requestExit(); page.requestExit();
  assert.equal(h.state.modals.length, 1);
  assert.equal(h.state.modals[0].title, '确认要离开吗？');
  assert.equal(page.data.running, false);
  assert.equal(h.state.timers.size, 0);
  assert.ok(h.state.voiceStops > stops);
  page.start(); page.completeExercise();
  assert.equal(h.state.timers.size, 0, 'modal blocks restarting behind the confirmation');
  assert.equal(h.state.writes, 0);
  h.answerExit(false);
  assert.equal(h.state.navigation.length, 0);
  assert.equal(page.data.hasStarted, true);
  assert.equal(page.data.running, false, 'cancelling Exit keeps the exercise paused');
  page.start(); h.advance(1000); page.onHide();
  assert.equal(page.elapsed, 2000);
  assert.equal(h.state.timers.size, 0);
  h.advance(30000); page.onShow(); page.start(); h.advance(1000);
  assert.equal(page.data.value, 7, 'time hidden in the background is not counted');
  page.requestExit(); h.answerExit(true);
  assert.deepEqual(h.state.navigation, ['back']);
  assert.equal(h.state.guard, false);
  page.onUnload();
  assert.equal(h.state.timers.size, 0);
  assert.equal(h.state.writes, 0, 'exiting without Finish does not record planned quantities');
}
{
  const h = harness({ stackDepth: 1 }), page = h.open();
  h.state.failNavigation = true;
  page.requestExit(); h.answerExit(true);
  assert.deepEqual(h.state.navigation, ['/pages/train/index']);
  assert.match(page.data.error, /返回/);
  assert.equal(h.state.guard, true, 'failed navigation restores the exit guard');
  h.state.failNavigation = false;
  page.requestExit(); h.answerExit(true); page.onUnload();
  assert.equal(h.state.timers.size, 0);
  assert.equal(h.state.guard, false);
}

console.log('PASS: follow Start/Pause/Continue timing, full-exercise Finish, preserved other data, cadence-only progress, failed-write retry, duplicate Finish, exit confirmation and cleanup.');
