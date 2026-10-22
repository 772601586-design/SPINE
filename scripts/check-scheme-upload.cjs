const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../miniprogram-demo');
const clone = value => JSON.parse(JSON.stringify(value));
const storage = {}, cache = new Map(), navigation = [];
let cameraOptions, fileOptions, recognitionResult = '每天\n1. 坐姿呼吸练习 3组 每组5次呼吸\n2. 靠墙站姿练习 3组 每组30秒';
let recognitionFails = false;
const wx = {
  env: { USER_DATA_PATH: '/private' }, getStorageSync: key => clone(storage[key] || null), setStorageSync: (key, value) => { storage[key] = clone(value); },
  chooseMedia: options => { cameraOptions = options; }, chooseMessageFile: options => { fileOptions = options; },
  getFileSystemManager: () => ({ copyFile: options => options.success(), readFile: options => options.success({ data: recognitionResult }) }),
  showToast() {}, previewImage() {}, openDocument: options => { wx.lastOpenedFile = options.filePath; },
  navigateTo: options => navigation.push(options.url), switchTab: options => navigation.push(options.url),
};
function moduleAt(relative) {
  if (cache.has(relative)) return cache.get(relative);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, relative), 'utf8'), { module, wx,
    require: name => moduleAt(path.relative(root, path.resolve(root, path.dirname(relative), name + '.js'))) });
  cache.set(relative, module.exports); return module.exports;
}
const t = moduleAt('core/training.js'), documents = moduleAt('core/documents.js');
const recognize = async () => { if (recognitionFails) throw Error('OCR unavailable'); return { text: recognitionResult }; };
function page(name) {
  let definition;
  vm.runInNewContext(fs.readFileSync(path.join(root, `pages/${name}/index.js`), 'utf8'), { wx, Page: value => { definition = value; },
    require: request => request.endsWith('document-recognition') ? { recognize, recognizeFile: recognize }
      : request.endsWith('/store') ? { enter() {} } : moduleAt(path.relative(root, path.resolve(root, 'pages', name, request + '.js'))) });
  return Object.assign(definition, { data: clone(definition.data), setData(values) { Object.assign(this.data, clone(values)); } });
}
(async () => {
  t.importAttachmentPlan();
  const recording = t.saveCard({ name: '靠墙站姿练习', video: '/wall.mp4', notes: '保持放松', sets: '', amount: '', mode: '' }, false);
  const sessionsBefore = JSON.stringify(t.load().sessions);
  const training = page('planning');
  const selected = training.photographScheme();
  assert.deepEqual(clone(cameraOptions.sourceType), ['camera']);
  assert.deepEqual(clone(cameraOptions.mediaType), ['image']);
  cameraOptions.success({ tempFiles: [{ tempFilePath: '/temp/photo.jpg', size: 100 }] });
  await selected;
  const image = documents.load()[0];
  assert.equal(image.kind, 'image'); assert.ok(image.path.startsWith('/private/'));
  assert.equal(image.autoImportVersion, 1); assert.equal(image.planDraftRows.length, 2);
  assert.equal(navigation.length, 0, 'upload remains on planning with generated actions below');
  const actions = t.load().cards.filter(card => card.sourceSchemeDocument === image.id);
  assert.equal(actions.length, 2); assert.ok(actions.every(card => card.confirmed));
  assert.equal(t.load().plans.filter(plan => plan.sourceSchemeDocument === image.id).length, 1);
  assert.ok(t.load().plans.some(plan => plan.sourceSchemeDocument === image.id && t.due(plan, t.today(), t.load())));
  const wall = actions.find(card => card.name === '靠墙站姿练习');
  assert.equal(wall.video, '/wall.mp4'); assert.equal(wall.amount, 30);
  assert.equal(t.load().cards.find(card => card.id === recording.id).linkedToActionId, wall.id);
  assert.ok(!training.data.cards.some(card => card.id === recording.id), 'linked recording does not duplicate the action card');
  assert.equal(training.data.videos.length, 1);
  assert.equal(training.data.videos[0].id, wall.id, 'video gallery opens the complete linked action rather than the recording draft');
  assert.equal(training.data.files[0].actionCount, 2);
  assert.equal(JSON.stringify(t.load().sessions), sessionsBefore, 'import never rewrites historical sessions');
  training.openSchedule(); assert.equal(training.data.showSchedules, true);
  const generatedPlan = training.data.plans.find(plan => plan.sourceSchemeDocument === image.id);
  assert.ok(generatedPlan.scheduleSummary);
  training.openPlan({ currentTarget: { dataset: { id: generatedPlan.id } } });
  assert.equal(navigation.at(-1), '/pages/plan/index?id=' + generatedPlan.id, 'all generated schedules can be reviewed individually');
  assert.equal(training.data.showSchedules, false);

  const actionIds = clone(actions.map(card => card.id)), count = t.load().cards.length;
  await training.retryImport({ currentTarget: { dataset: { id: image.id } } });
  assert.equal(t.load().cards.length, count, 'retry does not duplicate generated actions');
  assert.deepEqual(clone(t.load().cards.filter(card => card.sourceSchemeDocument === image.id).map(card => card.id)), actionIds);
  const duplicateUpload = training.photographScheme();
  cameraOptions.success({ tempFiles: [{ tempFilePath: '/temp/photo.jpg', size: 100 }] }); await duplicateUpload;
  assert.equal(t.load().cards.length, count, 'same filename/content upload reuses the existing actions');
  assert.equal(documents.load()[1].duplicateOf, image.id);
  training.onShow();
  assert.equal(t.load().cards.length, count, 'returning to planning skips duplicate source aliases');
  moduleAt('core/scheme-import.js').refreshDocument(documents.load()[1].id);
  assert.equal(t.load().cards.length, count, 'direct refresh also resolves a duplicate source to its canonical document');
  training.editFile({ currentTarget: { dataset: { id: documents.load()[1].id } } });
  assert.equal(navigation.at(-1), '/pages/scheme/index?id=' + image.id, 'duplicate file edits target the shared source rather than create new cards');

  const cancelled = training.uploadScheme();
  assert.equal(fileOptions.type, 'file'); fileOptions.fail({ errMsg: 'chooseMessageFile:fail cancel' }); await cancelled;
  assert.equal(documents.load().length, 2);
  const fileSelected = training.chooseSchemeFile(); fileOptions.success({ tempFiles: [{ path: '/temp/file.pdf', name: '训练方案.pdf', size: 100 }] }); await fileSelected;
  const pdf = documents.load()[2]; assert.equal(pdf.kind, 'document'); assert.equal(pdf.importedCardCount, 2);
  training.openFile({ currentTarget: { dataset: { id: pdf.id } } }); assert.equal(wx.lastOpenedFile, pdf.path);
  const textSelected = training.chooseSchemeFile(); fileOptions.success({ tempFiles: [{ path: '/temp/file.txt', name: '方案.txt', size: 100 }] }); await textSelected;
  const text = documents.load()[3], scheme = page('scheme'); await scheme.onLoad({ id: text.id });
  assert.equal(scheme.data.text, recognitionResult); assert.equal(scheme.data.rows.length, 2);
  scheme.confirmPlan(); assert.match(scheme.data.error, /核对/);
  const beforeReview = t.load().cards.length;
  scheme.toggleCheck(); scheme.confirmPlan();
  assert.equal(t.load().cards.length, beforeReview, 'optional source review updates imported cards rather than duplicating');
  const before = JSON.stringify(storage[t.KEY]);
  assert.throws(() => t.saveSchemeActions(image.id, [scheme.data.rows[0], { ...scheme.data.rows[1], amount: '' }]), /补齐/);
  assert.equal(JSON.stringify(storage[t.KEY]), before, 'an invalid later row cannot partially update generated cards');
  const fileCount = documents.load().length, rejected = training.chooseSchemeFile();
  fileOptions.success({ tempFiles: [{ path: '/temp/app.exe', name: 'app.exe', size: 100 }] }); await rejected;
  assert.equal(documents.load().length, fileCount); assert.ok(training.data.error);

  recognitionFails = true;
  const failed = training.chooseSchemeFile(); fileOptions.success({ tempFiles: [{ path: '/temp/failure.pdf', name: '待识别.pdf', size: 100 }] }); await failed;
  const pending = documents.load().at(-1);
  assert.equal(pending.status, 'failed'); assert.equal(training.data.busy, false); assert.match(training.data.error, /OCR/);
  assert.ok(training.data.files.find(doc => doc.id === pending.id).error, 'failed original remains visible with retry');
  recognitionFails = false; recognitionResult = '侧桥支撑 2组 每组20秒 每周三次';
  await training.retryImport({ currentTarget: { dataset: { id: pending.id } } });
  const unscheduled = t.load().cards.find(card => card.sourceSchemeDocument === pending.id);
  assert.ok(unscheduled); assert.equal(unscheduled.confirmed, true); assert.equal(unscheduled.scheduleStatus, 'pending');
  assert.ok(!t.load().plans.some(plan => plan.active && plan.cardIds.includes(unscheduled.id)), 'unspecified weekdays stay pending');
  training.capture(); assert.deepEqual(clone(cameraOptions.mediaType), ['video']);
  cameraOptions.success({ tempFiles: [{ tempFilePath: '/capture.mp4' }] }); cameraOptions.complete();
  assert.match(navigation.at(-1), /returnTo=planning/);
  console.log('PASS: direct camera/folder entry, automatic actions and daily plans, exact video association, retry/duplicate idempotency, source review, preserved history, cancellation, unavailable OCR and unresolved frequency.');
})().catch(error => { console.error(error); process.exitCode = 1; });
