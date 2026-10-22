const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../miniprogram-demo');
const clone = value => JSON.parse(JSON.stringify(value));
const storage = {}, cache = new Map();
const navigation = [];
const wx = { getStorageSync: key => storage[key] ? clone(storage[key]) : '', setStorageSync: (key, value) => { storage[key] = clone(value); },
  showToast() {}, navigateTo(options) { navigation.push({ type: 'navigateTo', url: options.url }); },
  navigateBack() { navigation.push({ type: 'navigateBack' }); }, switchTab(options) { navigation.push({ type: 'switchTab', url: options.url }); }, env: { USER_DATA_PATH: '/files' },
  getFileSystemManager: () => ({ copyFile: options => options.success({}) }) };
let recognize = () => Promise.resolve({ text: '' });
function moduleAt(file) {
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), { module, exports: module.exports, wx, Date, Promise,
    require: request => moduleAt(path.relative(root, path.resolve(root, path.dirname(file), request + '.js'))) });
  cache.set(file, module.exports); return module.exports;
}
const t = moduleAt('core/training.js'), docs = moduleAt('core/documents.js');
function page(name) {
  let definition;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages', name, 'index.js'), 'utf8'), {
    Page: value => { definition = value; }, wx, Date, Promise,
    require: request => request.endsWith('/document-recognition') ? { recognize: value => recognize(value) }
      : request.endsWith('/exercise-taxonomy') ? moduleAt('core/exercise-taxonomy.js') : request.endsWith('/scheme-import') ? moduleAt('core/scheme-import.js') : request.endsWith('/documents') ? docs : t,
  });
  return Object.assign(definition, { data: clone(definition.data), setData(patch) { Object.assign(this.data, clone(patch)); } });
}
(async () => {
  const organizer = page('card'); organizer.onLoad({});
  assert.equal(organizer.data.mode, '', 'an incomplete draft does not assume the completion unit');
  organizer.saveDraft(); assert.ok(organizer.data.id);
  const resumed = page('card'); resumed.onLoad({});
  assert.equal(resumed.data.id, organizer.data.id, 'a draft without video must survive reopening the organizer');
  const fresh = page('card'); fresh.onLoad({ new: '1', manual: '1' });
  assert.equal(fresh.data.id, ''); assert.equal(fresh.data.manualExpanded, true, 'manual creation starts a new card');
  const batch = organizer.data.recordingBatchId;
  const first = docs.save({ type: 'training', path: '/first.png', recordingBatchId: batch, text: '1. 靠墙站姿练习 3组 4组 每组30秒', status: 'recognized' });
  docs.save({ type: 'training', path: '/second.png', recordingBatchId: batch, text: '1. 靠墙站姿练习 3组 每组30秒', status: 'recognized' });
  organizer.reloadMaterials();
  const conflicting = organizer.data.actionItems[0];
  assert.equal(conflicting.sets, '', 'a second document must not refill a conflicting requirement');
  assert.equal(conflicting.conflicts.sets, true);
  organizer.applyCandidate({ currentTarget: { dataset: { id: conflicting.id } } });
  assert.equal(organizer.data.checked, false); assert.equal(organizer.data.sets, '');

  const isolated = 'stable-candidate-batch';
  const source = docs.save({ type: 'training', path: '/source.png', recordingBatchId: isolated, text: '1. 坐姿呼吸练习 3组 每组5次呼吸\n2. 靠墙站姿练习 3组 每组30秒', status: 'recognized' });
  const wall = t.saveCard({ name: '靠墙站姿练习', mode: 'timer', sets: 3, amount: 30, video: '/wall.mp4', recordingBatchId: isolated }, false);
  const other = t.saveCard({ name: '另一现场录段', mode: '', sets: '', amount: '', video: '/other.mp4', recordingBatchId: isolated }, false);
  organizer.loadCard(wall);
  const wallCandidate = organizer.data.actionItems.find(item => item.name === '靠墙站姿练习');
  const breathId = organizer.data.actionItems.find(item => item.name === '坐姿呼吸练习').id;
  t.saveCard(Object.assign({}, wall, { sourceCandidateId: wallCandidate.id }), false);
  docs.save(Object.assign({}, source, { text: '1. 侧桥支撑 2组 每组20秒\n2. 坐姿呼吸练习 3组 每组5次呼吸\n3. 靠墙站姿练习 3组 每组30秒' }));
  organizer.loadCard(other);
  const movedBreath = organizer.data.actionItems.find(item => item.name === '坐姿呼吸练习');
  assert.equal(movedBreath.id, breathId, 'adding a line must not change the identity of another action');
  organizer.applyCandidate({ currentTarget: { dataset: { id: movedBreath.id } } });
  assert.equal(organizer.data.id, other.id, 'the new candidate cannot redirect to another action/video');

  const queueBatch = 'queued-documents';
  const active = t.saveCard({ name: '录段', mode: '', sets: '', amount: '', recordingBatchId: queueBatch }, false);
  const queued1 = docs.save({ type: 'training', path: '/queue1.png', text: '', status: 'pending', recordingBatchId: queueBatch });
  const queued2 = docs.save({ type: 'training', path: '/queue2.png', text: '', status: 'pending', recordingBatchId: queueBatch });
  organizer.loadCard(active);
  let finish, calls = 0;
  recognize = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const running = organizer.runRecognition([queued1, queued2]);
  docs.save(Object.assign({}, queued2, { text: '靠墙站姿练习 4组 每组6次', engine: 'manual', status: 'recognized' }));
  finish({ text: '坐姿呼吸练习 3组 每组5次呼吸' }); await running;
  assert.equal(calls, 1, 'a queued page edited meanwhile is skipped');
  assert.equal(docs.load().find(item => item.id === queued2.id).text, '靠墙站姿练习 4组 每组6次');
  organizer.loadCard(active);
  const inFlight = Object.assign({}, docs.load().find(item => item.id === queued1.id), { text: '', status: 'pending', engine: '' });
  docs.save(inFlight);
  const pending = organizer.runRecognition([inFlight]);
  docs.save(Object.assign({}, inFlight, { text: '手动校对原文', engine: 'manual', status: 'recognized' }));
  finish({ text: '稍后返回的OCR内容' }); await pending;
  assert.equal(docs.load().find(item => item.id === inFlight.id).text, '手动校对原文', 'in-flight OCR cannot replace a manual correction');

  const importer = moduleAt('core/scheme-import.js');
  const importedDocument = docs.save({ type: 'training', originalName: '视频关联回归.txt', path: '/imported.txt', status: 'recognized',
    recordingBatchId: 'manual-video-association', text: '1. 导入抬腿训练 每天 3组 每组12次\n2. 导入侧桥支撑 每天 2组 每组20秒' });
  const parsedImportedActions = [
    { name: '导入抬腿训练', groupName: '康复师核心训练组', sets: '3', amount: '12', mode: 'count', notes: '原件中的动作要点', frequency: '每天', sourceText: '导入抬腿训练 每天 3组 每组12次' },
    { name: '导入侧桥支撑', groupName: '康复师稳定训练组', sets: '2', amount: '20', mode: 'timer', notes: '原件中的支撑要点', frequency: '每天', sourceText: '导入侧桥支撑 每天 2组 每组20秒' },
  ];
  const imported = importer.importDocument(importedDocument, parsedImportedActions);
  const action = imported.cards[0], secondAction = imported.cards[1];
  const recordingA = t.saveCard({ name: '现场讲解甲', mode: '', sets: '', amount: '', video: '/manual-association-a.mp4', recordingBatchId: 'recordings-a' }, false);
  const recordingB = t.saveCard({ name: '现场讲解乙', mode: '', sets: '', amount: '', video: '/manual-association-b.mp4', recordingBatchId: 'recordings-b' }, false);
  const importedPage = page('card'); importedPage.onLoad({ id: action.id });
  importedPage.input({ currentTarget: { dataset: { field: 'notes' } }, detail: { value: '尚未点保存的个人动作要点' } });
  const pageIdentity = ['id', 'name', 'groupName', 'sets', 'amount', 'mode', 'sourceSchemeDocument', 'sourceSchemeRow'];
  const identityBefore = Object.fromEntries(pageIdentity.map(field => [field, importedPage.data[field]]));
  const persistedFields = ['id', 'name', 'groupName', 'sets', 'amount', 'mode', 'confirmed', 'sourceSchemeDocument', 'sourceSchemeRow'];
  const storedIdentityBefore = Object.fromEntries(persistedFields.map(field => [field, action[field]]));
  const chooseRecording = (target, recordingId) => {
    const index = target.data.videoOptions.findIndex(item => item.id === recordingId);
    assert.ok(index >= 0, 'the recording must be available in the actual page picker');
    target.selectVideo({ detail: { value: String(index) } });
  };
  chooseRecording(importedPage, recordingA.id);
  assert.deepEqual(Object.fromEntries(pageIdentity.map(field => [field, importedPage.data[field]])), identityBefore,
    'associating a recording keeps the imported action open with its name, grouping and dose');
  assert.equal(importedPage.data.notes, '尚未点保存的个人动作要点', 'changing only the video preserves unsaved notes');
  let storedAction = t.load().cards.find(item => item.id === action.id);
  assert.equal(storedAction.video, recordingA.video, 'the video association persists without a separate form save');
  assert.equal(storedAction.sourceVideoCardId, recordingA.id);
  assert.deepEqual(Object.fromEntries(persistedFields.map(field => [field, storedAction[field]])), storedIdentityBefore,
    'manual video association cannot change the imported requirements or confirmation state');
  assert.equal(storedAction.notes, '原件中的动作要点', 'unsaved form notes are retained locally rather than silently overwriting saved notes');
  assert.equal(t.load().cards.find(item => item.id === recordingA.id).linkedToActionId, action.id);

  const secondImportedPage = page('card'); secondImportedPage.onLoad({ id: secondAction.id });
  chooseRecording(secondImportedPage, recordingA.id);
  assert.match(secondImportedPage.data.error, /已对应其他动作/);
  assert.equal(secondImportedPage.data.id, secondAction.id);
  assert.equal(t.load().cards.find(item => item.id === secondAction.id).video, '', 'an occupied recording cannot be stolen by another action');
  assert.equal(t.load().cards.find(item => item.id === recordingA.id).linkedToActionId, action.id);
  assert.equal(t.load().cards.find(item => item.id === action.id).video, recordingA.video);

  chooseRecording(importedPage, recordingB.id);
  assert.equal(importedPage.data.notes, '尚未点保存的个人动作要点');
  assert.equal(t.load().cards.find(item => item.id === action.id).video, recordingB.video);
  assert.equal(t.load().cards.find(item => item.id === recordingA.id).linkedToActionId, undefined, 'replacing a recording releases the old association');
  assert.equal(t.load().cards.find(item => item.id === recordingB.id).linkedToActionId, action.id);
  chooseRecording(importedPage, '');
  storedAction = t.load().cards.find(item => item.id === action.id);
  assert.equal(storedAction.video, ''); assert.equal(storedAction.sourceVideoCardId, '');
  assert.equal(storedAction.videoAssociationManual, true);
  assert.equal(importedPage.data.notes, '尚未点保存的个人动作要点');
  assert.equal(t.load().cards.find(item => item.id === recordingB.id).linkedToActionId, undefined);
  t.saveCard(Object.assign({}, t.load().cards.find(item => item.id === recordingB.id), { name: action.name }), false);
  importer.reconcileVideos();
  assert.equal(t.load().cards.find(item => item.id === action.id).video, '', 'explicit unlink survives automatic reconciliation even with a uniquely named matching video');
  const repeatedImport = importer.importDocument(importedDocument, parsedImportedActions);
  assert.equal(repeatedImport.cards[0].id, action.id, 'the same imported action retains its identity on re-import');
  importer.reconcileVideos();
  assert.equal(t.load().cards.find(item => item.id === action.id).video, '', 're-import also preserves a manual unlink');
  importedPage.saveDraft();
  assert.equal(t.load().cards.find(item => item.id === action.id).notes, '尚未点保存的个人动作要点', 'the retained notes can still be explicitly saved');

  const capture = page('capture'); capture.onLoad({});
  const mediaChoices = [];
  wx.chooseMedia = options => { mediaChoices.push(options); };
  capture.record();
  assert.equal(mediaChoices.length, 1, 'record opens the camera directly');
  assert.deepEqual(clone(mediaChoices[0].sourceType), ['camera']);
  assert.deepEqual(clone(mediaChoices[0].mediaType), ['video']);
  capture.record();
  assert.equal(mediaChoices.length, 1, 'duplicate clicks do not open multiple native pickers');
  mediaChoices[0].fail({ errMsg: 'chooseMedia:fail cancel' }); mediaChoices[0].complete();
  assert.equal(capture.data.error, '');
  assert.equal(capture.data.detailsOpen, false, 'cancelling the camera does not create a metadata form');
  capture.record();
  mediaChoices[1].success({ tempFiles: [{ tempFilePath: '/a.mp4' }] });
  mediaChoices[1].complete();
  assert.equal(capture.data.detailsOpen, true, 'successful recording opens the action details dialog');
  const firstVideoId = capture.data.detailsCard;
  capture.record();
  assert.equal(mediaChoices.length, 2, 'the next camera waits until details are saved');
  assert.equal(capture.saveAndNext(), false, 'both metadata fields are required');
  capture.inputName({ detail: { value: '侧桥动作' } });
  capture.inputNotes({ detail: { value: '注意肩部放松，按现场指导保持方向' } });
  assert.equal(capture.data.regionOptions.length, 8);
  assert.equal(capture.data.muscleOptions.length, 14);
  capture.selectRegions({ detail: { value: ['abdominal_lateral'] } });
  capture.selectMuscles({ detail: { value: ['obliques', 'transversus_abdominis'] } });
  assert.equal(capture.saveAndNext(), true);
  assert.equal(mediaChoices.length, 3, 'save and next opens the camera after persisting details');
  assert.deepEqual(clone(mediaChoices[2].sourceType), ['camera']);
  assert.equal(t.load().cards.find(card => card.id === firstVideoId).name, '侧桥动作');
  assert.deepEqual(clone(t.load().cards.find(card => card.id === firstVideoId).muscles), ['obliques', 'transversus_abdominis']);
  assert.equal(t.load().cards.find(card => card.id === firstVideoId).notes, '注意肩部放松，按现场指导保持方向');
  mediaChoices[2].success({ tempFiles: [{ tempFilePath: '/b.mp4' }] }); mediaChoices[2].complete();
  capture.inputName({ detail: { value: '坐姿呼吸' } });
  capture.inputNotes({ detail: { value: '记录第二个动作的关键要点' } });
  assert.equal(capture.saveDetails(), true);
  assert.equal(capture.data.detailsOpen, false);
  assert.equal(mediaChoices.length, 3, 'saving without continuing does not reopen the camera');
  assert.equal(capture.saveDetails(), false, 'repeated save cannot duplicate the recorded card');
  const clips = t.load().cards.filter(card => card.recordingBatchId === capture.data.recordingBatchId);
  assert.equal(clips.length, 2); assert.notEqual(clips[0].video, clips[1].video);
  assert.equal(clips[0].mode, ''); assert.equal(capture.data.drafts.length, 2);
  assert.equal(docs.load().find(item => item.id === first.id).text.includes('3组 4组'), true);
  const planningCapture = page('capture'); planningCapture.onLoad({ returnTo: 'planning' });
  assert.equal(planningCapture.data.returnTo, 'planning');
  let navigationBefore = navigation.length;
  planningCapture.finish();
  assert.deepEqual(navigation.slice(navigationBefore), [{ type: 'switchTab', url: '/pages/planning/index' }], 'finishing from planning returns to the planning tab');
  planningCapture.setData({ detailsCard: firstVideoId, detailsOpen: false });
  navigationBefore = navigation.length;
  planningCapture.finish();
  assert.equal(navigation.length, navigationBefore, 'an unfinished recording keeps the details form open instead of navigating away');
  assert.equal(planningCapture.data.detailsOpen, true);
  assert.match(planningCapture.data.detailsError, /先保存/);
  planningCapture.setData({ detailsCard: '', selecting: true });
  planningCapture.finish();
  assert.equal(navigation.length, navigationBefore, 'native camera selection must finish before returning to planning');
  console.log('PASS: draft requirements and OCR edits stay intact; imported video association keeps action/dose/unsaved notes, prevents stealing and preserves manual unlink; continuous recordings stay separate and return to planning.');
})().catch(error => { console.error(error); process.exitCode = 1; });
