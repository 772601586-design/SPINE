const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../miniprogram-demo');
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const event = id => ({ currentTarget: { dataset: { id } } });
const input = value => ({ detail: { value } });
function harness() {
  const key = 'xiaoshu.training.flow.v2';
  const storage = { [key]: { version: 2, cards: [], plans: [], sessions: [] } };
  const writes = [], choices = [], copies = [], navigation = [], sheets = [], modals = [], toasts = [], deleted = [], screenEntries = [];
  let failedKey = '', failCopy = false, deferredCopy = false;
  const wx = {
    env: { USER_DATA_PATH: '/durable' }, getStorageSync: name => clone(storage[name] || ''),
    setStorageSync(name, value) { if (failedKey === name) throw Error('模拟存储失败'); storage[name] = clone(value); writes.push(name); },
    chooseMedia(options) { choices.push(options); },
    showToast(options) { toasts.push(options); }, showActionSheet(options) { sheets.push(options); }, showModal(options) { modals.push(options); },
    navigateTo(options) { navigation.push({ type: 'navigateTo', url: options.url }); },
    navigateBack() { navigation.push({ type: 'navigateBack' }); }, switchTab(options) { navigation.push({ type: 'switchTab', url: options.url }); },
    getFileSystemManager() { return { copyFile(options) { copies.push(options); if (!deferredCopy) { if (failCopy) options.fail({}); else options.success({}); } },
      unlink(options) { deleted.push(options.filePath); } }; },
  };
  const modules = new Map();
  function moduleAt(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} }; modules.set(filename, module);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, exports: module.exports, wx, Date,
      require: request => request.endsWith('/store') ? { enter(screen) { screenEntries.push(screen); } } : moduleAt(path.resolve(path.dirname(filename), request + '.js')) }, { filename });
    return module.exports;
  }
  const t = moduleAt(path.join(root, 'core/training.js')), library = moduleAt(path.join(root, 'core/material-library.js'));
  function page(query = {}) {
    const filename = path.join(root, 'pages/capture/index.js'); let definition;
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { Page: value => { definition = value; }, wx, Date,
      require: request => request.endsWith('/store') ? { enter(screen) { screenEntries.push(screen); } } : moduleAt(path.resolve(path.dirname(filename), request + '.js')) }, { filename });
    const instance = Object.assign(definition, { data: clone(definition.data), updatesAfterUnload: 0,
      setData(patch) { if (this._unloaded) this.updatesAfterUnload++; Object.assign(this.data, clone(patch)); } });
    instance.onLoad(query); return instance;
  }
  function selected(source = '/temporary/video.mp4', complete = true) {
    const options = choices[choices.length - 1]; options.success({ tempFiles: [{ tempFilePath: source }] }); if (complete) options.complete();
  }
  function makeCard(fields = {}, confirmed = false) {
    return t.saveCard(Object.assign({ name: '现场动作', notes: '', mode: '', sets: '', amount: '', video: '/saved/old.mp4', recordingBatchId: 'older' }, fields), confirmed);
  }
  return { key, storage, writes, choices, copies, navigation, sheets, modals, toasts, deleted, screenEntries, t, library, page, selected, makeCard,
    failStorage(value) { failedKey = value; }, failCopy(value) { failCopy = value; }, deferCopy(value) { deferredCopy = value; } };
}
// The page opens a library without an automatic native picker. Drafts survive reopening and continuous segments stay independent.
{
  const h = harness(), p = h.page({ returnTo: 'planning' });
  assert.equal(p.spineScreen, 'capture'); p.onShow(); assert.deepEqual(h.screenEntries, ['capture']);
  assert.equal(h.choices.length, 0); assert.equal(p.data.recordings.length, 0);
  p.record(); p.record();
  assert.equal(h.choices.length, 1); assert.deepEqual(clone(h.choices[0].sourceType), ['camera']);
  h.selected('/temporary/first.mp4', false);
  assert.equal(p.data.selecting, false, 'success clears selection even when the browser shim omits complete');
  const firstId = p.data.detailsCard, firstVideo = h.t.load().cards[0].video;
  assert.match(firstVideo, /^\/durable\//); assert.equal(p.data.detailsOpen, true);
  assert.equal(p.saveDetails(), false); assert.equal(p.saveAndNext(), false);
  p.inputNotes(input('先记下肩部放松'));
  p.selectRegions(input(['abdominal_lateral'])); p.selectMuscles(input(['obliques']));
  p.toggleTaxonomy(); p.toggleTaxonomy();
  assert.equal(p.data.regionOptions.find(item => item.code === 'abdominal_lateral').checked, true);
  assert.equal(p.saveDraft(), true);
  const partial = h.t.load().cards.find(card => card.id === firstId);
  assert.equal(partial.name, '未命名录段'); assert.equal(partial.notes, '先记下肩部放松'); assert.equal(partial.confirmed, false);
  assert.deepEqual(clone(partial.muscles), ['obliques']);
  p.onUnload();
  const reopened = h.page({ returnTo: 'planning' });
  assert.equal(reopened.data.recordings.length, 1, 'all batches are visible after reopening');
  reopened.editDetails(event(firstId)); assert.equal(reopened.data.actionName, ''); assert.equal(reopened.data.actionNotes, partial.notes);
  reopened.inputName(input('侧桥动作')); assert.equal(reopened.saveAndNext(), true);
  assert.equal(h.choices.length, 2); h.selected('/temporary/second.mp4');
  assert.notEqual(reopened.data.detailsCard, firstId); assert.equal(reopened.saveDraft(), true);
  assert.equal(h.t.load().cards.length, 2); assert.equal(h.t.load().cards.find(card => card.id === firstId).video, firstVideo);
  reopened.fromAlbum(); assert.deepEqual(clone(h.choices[2].sourceType), ['album']); h.selected('/temporary/album.mov'); reopened.saveDraft();
  assert.equal(h.t.load().cards.length, 3); assert.equal(new Set(h.t.load().cards.map(card => card.video)).size, 3);
  reopened.finish(); assert.deepEqual(h.navigation.pop(), { type: 'switchTab', url: '/pages/planning/index' });
  assert.deepEqual(h.deleted, []);
}
// Search, filters, aliases, preview, association links, hide and restore are independent of source records and training history.
{
  const h = harness();
  const source = h.makeCard({ name: '原录段', notes: '肩部放松' });
  const action = h.makeCard({ name: '关联动作', notes: '正式动作要点', sourceVideoCardId: source.id, video: source.video, mode: 'count', sets: 2, amount: 6 }, true);
  h.t.saveCard(Object.assign({}, source, { linkedToActionId: action.id }), false);
  const draft = h.makeCard({ name: '新草稿', video: '/saved/new.mp4', recordingBatchId: 'newer' });
  h.storage[h.key].plans.push({ id: 'keep-plan', cardIds: [action.id] });
  h.storage[h.key].sessions.push({ id: 'keep-history', rows: [{ cardId: action.id, video: source.video, values: [0, 6, 9] }] });
  h.library.rename('recordings', source.id, '复诊现场录段');
  const p = h.page(), original = JSON.stringify(h.storage[h.key]);
  assert.equal(p.data.recordings.length, 2, 'a linked action does not duplicate its source recording');
  p.changeFilter(event('linked')); assert.deepEqual(clone(p.data.recordings.map(item => item.id)), [source.id]);
  p.open(event(source.id)); assert.equal(h.navigation.pop().url, '/pages/card/index?id=' + action.id);
  p.changeFilter(event('draft')); assert.deepEqual(clone(p.data.recordings.map(item => item.id)), [draft.id]);
  p.changeFilter(event('all')); p.searchInput(input('复诊')); assert.equal(p.data.recordings[0].id, source.id);
  p.preview(event(source.id)); assert.equal(p.data.previewId, source.id);
  p.more(event(source.id)); h.sheets.pop().success({ tapIndex: 0 }); h.modals.pop().success({ confirm: false });
  assert.equal(h.library.isHidden('recordings', source.id), false);
  p.more(event(source.id)); h.sheets.pop().success({ tapIndex: 0 }); h.modals.pop().success({ confirm: true });
  assert.equal(h.library.isHidden('recordings', source.id), true); assert.equal(p.data.previewId, '');
  assert.equal(p.data.recordings.length, 0); p.changeFilter(event('hidden')); assert.equal(p.data.recordings[0].id, source.id);
  p.more(event(source.id)); h.sheets.pop().success({ tapIndex: 0 });
  assert.equal(h.library.isHidden('recordings', source.id), false);
  assert.equal(JSON.stringify(h.storage[h.key]), original, 'organizing visibility never mutates cards, plans or sessions');
  assert.deepEqual(h.deleted, []);
  p.changeFilter(event('all')); h.failStorage(h.library.KEY); p.changeVisibility(source.id, true);
  assert.equal(h.library.isHidden('recordings', source.id), false); assert.match(p.data.error, /未保存/);
}
// Copy failure and metadata-storage failure retain the original file and retry the same clip without duplicates or premature navigation.
{
  const h = harness(), p = h.page();
  h.failCopy(true); p.record(); h.selected('/original/keep.mp4');
  assert.equal(p.data.pendingSave, true); assert.equal(h.t.load().cards.length, 0);
  const target = h.copies[0].destPath; p.finish(); p.record();
  assert.equal(h.navigation.length, 0); assert.equal(h.choices.length, 1);
  h.failCopy(false); h.failStorage(h.key); p.retrySave();
  assert.equal(h.copies[1].destPath, target); assert.equal(p.data.pendingSave, true); assert.equal(h.t.load().cards.length, 0);
  h.failStorage(''); p.retrySave();
  assert.equal(h.copies.length, 2, 'already copied media is not copied again on storage retry');
  assert.equal(h.t.load().cards.length, 1); assert.equal(h.t.load().cards[0].video, target);
  const saved = JSON.stringify(h.storage[h.key]); p.inputName(input('尚未保存的名称')); p.inputNotes(input('尚未保存的要点'));
  h.failStorage(h.key); assert.equal(p.saveDraft(), false); assert.equal(p.data.detailsOpen, true); assert.equal(p.data.actionName, '尚未保存的名称');
  assert.equal(JSON.stringify(h.storage[h.key]), saved); h.failStorage(''); assert.equal(p.saveDraft(), true); assert.equal(p.saveDraft(), false);
  assert.deepEqual(h.deleted, []);
}
// Late copy/picker callbacks persist a durable draft without calling setData, opening forms or navigating on an unloaded page.
{
  const h = harness(), p = h.page();
  h.deferCopy(true); p.record(); h.selected('/original/late-copy.mp4'); p.onUnload(); h.copies[0].success({});
  assert.equal(h.t.load().cards.length, 1); assert.equal(p.updatesAfterUnload, 0); assert.equal(h.navigation.length, 0);
  const q = h.page(); q.fromAlbum(); q.onUnload(); h.selected('/original/late-picker.mp4'); h.copies[1].success({});
  assert.equal(h.t.load().cards.length, 2); assert.equal(q.updatesAfterUnload, 0); assert.deepEqual(h.deleted, []);
}
// Existing-card attachment and practice preserve dose, confirmation and return targets; changing metadata still requires review.
{
  const h = harness(), card = h.makeCard({ name: '已核对动作', notes: '原要点', mode: 'timer', sets: 3, amount: 20 }, true);
  const p = h.page({ card: card.id, practice: '1' }); p.record(); h.selected('/original/practice.mp4');
  let updated = h.t.load().cards.find(item => item.id === card.id);
  assert.equal(updated.video, card.video); assert.match(updated.practice, /^\/durable\//); assert.equal(updated.confirmed, true);
  assert.equal(p.saveAndNext(), true); assert.equal(h.choices.length, 1, 'practice remains one clip and cannot start the next segment');
  p.finish(); assert.deepEqual(h.navigation.pop(), { type: 'navigateBack' }); assert.equal(h.t.load().cards.length, 1);
  const q = h.page({ card: card.id }); q.editDetails(event(card.id)); assert.equal(q.saveDetails(), true);
  assert.equal(h.t.load().cards[0].confirmed, true);
  q.editDetails(event(card.id)); q.inputNotes(input('修改后的要点')); assert.equal(q.saveDetails(), true);
  updated = h.t.load().cards[0]; assert.equal(updated.confirmed, false); assert.equal(updated.sets, 3); assert.equal(updated.amount, 20);
  const pendingName = h.makeCard({ name: '未命名录段', recordingNamePending: '未命名录段' });
  h.t.saveCard(Object.assign({}, pendingName, { name: '动作卡中补全的名称' }), false);
  q.editDetails(event(pendingName.id)); assert.equal(q.data.actionName, '动作卡中补全的名称', 'organizer edits override placeholder markers');
}
// Cancellations and malformed legacy links remain harmless.
{
  const h = harness(), p = h.page({ video: '%E0%A4%A' });
  assert.match(p.data.error, /路径/); assert.equal(h.copies.length, 0);
  p.record(); const camera = h.choices[0]; camera.fail({ errMsg: 'chooseMedia:fail cancel' });
  assert.equal(p.data.error, ''); assert.equal(p.data.selecting, false); assert.equal(h.t.load().cards.length, 0);
}
const markup = fs.readFileSync(path.join(root, 'pages/capture/index.wxml'), 'utf8');
assert.match(markup, /bindtap="saveDraft"/); assert.match(markup, /bindtap="fromAlbum"/);
assert.match(markup, /wx:if="{{!practice}}"[^>]*bindtap="saveAndNext"/);
console.log('PASS: capture library opens before picker; camera/album durable drafts, partial metadata, taxonomy, continuous segments, source-safe hide/restore, associations, retries, async unload and practice compatibility.');

