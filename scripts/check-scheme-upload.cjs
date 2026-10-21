const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../miniprogram-demo');
const clone = value => JSON.parse(JSON.stringify(value));
const storage = {}, cache = new Map(), navigation = [];
let cameraOptions, fileOptions, recognitionResult = '1. 坐姿呼吸练习 3组 每组5次呼吸\n2. 靠墙站姿练习 3组 每组30秒';
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
const t = moduleAt('core/training.js'), documents = moduleAt('core/documents.js'), upload = moduleAt('core/scheme-upload.js');
function page(name) {
  let definition;
  vm.runInNewContext(fs.readFileSync(path.join(root, `pages/${name}/index.js`), 'utf8'), { wx, Page: value => { definition = value; },
    require: request => request.endsWith('document-recognition') ? { recognize: async () => { if (recognitionFails) throw Error('OCR unavailable'); return { text: recognitionResult }; } }
      : request.endsWith('/documents') ? documents : request.endsWith('/scheme-upload') ? upload : request.endsWith('/store') ? { enter() {} } : t });
  return Object.assign(definition, { data: clone(definition.data), setData(values) { Object.assign(this.data, clone(values)); } });
}
(async () => {
  const training = page('train'); training.uploadScheme();
  assert.equal(training.data.schemePicker, true);
  const selected = training.photographScheme();
  assert.equal(training.data.schemePicker, false);
  assert.deepEqual(clone(cameraOptions.sourceType), ['camera']);
  assert.deepEqual(clone(cameraOptions.mediaType), ['image']);
  cameraOptions.success({ tempFiles: [{ tempFilePath: '/temp/photo.jpg', size: 100 }] });
  await selected;
  const image = documents.load()[0];
  assert.equal(image.kind, 'image'); assert.ok(image.path.startsWith('/private/'));
  assert.equal(navigation.at(-1), '/pages/scheme/index?id=' + image.id);
  const scheme = page('scheme'); await scheme.onLoad({ id: image.id });
  await scheme.generate();
  assert.equal(scheme.data.rows.length, 2);
  assert.equal(t.load().cards.length, 2, 'recognition alone does not add unconfirmed requirements to the plan');
  scheme.confirmPlan(); assert.match(scheme.data.error, /核对/);
  scheme.toggleCheck(); scheme.confirmPlan();
  const destination = navigation.at(-1), ids = decodeURIComponent(destination.split('cards=')[1]).split(',');
  assert.equal(ids.length, 2); assert.equal(t.load().cards.length, 4);
  scheme.confirmPlan(); assert.equal(t.load().cards.length, 4, 'retry does not duplicate generated actions');
  const plan = page('plan'); plan.onLoad({ cards: ids.join(',') });
  assert.deepEqual(clone(plan.data.selected.map(card => card.id)), ids);
  plan.save(); assert.equal(navigation.at(-1), '/pages/train/index');
  const before = JSON.stringify(storage[t.KEY]);
  assert.throws(() => t.saveSchemeActions(image.id, [scheme.data.rows[0], { ...scheme.data.rows[1], amount: '' }]), /补齐/);
  assert.equal(JSON.stringify(storage[t.KEY]), before, 'an invalid later row cannot partially update generated cards');
  training.uploadScheme(); const cancelled = training.chooseSchemeFile();
  assert.equal(fileOptions.type, 'file'); fileOptions.fail({ errMsg: 'chooseMessageFile:fail cancel' }); await cancelled;
  assert.equal(documents.load().length, 1);
  const fileSelected = training.chooseSchemeFile(); fileOptions.success({ tempFiles: [{ path: '/temp/file.pdf', name: '训练方案.pdf', size: 100 }] }); await fileSelected;
  const pdf = documents.load()[1]; assert.equal(pdf.kind, 'document');
  const pdfPage = page('scheme'); await pdfPage.onLoad({ id: pdf.id }); assert.equal(wx.lastOpenedFile, pdf.path);
  await pdfPage.generate(); assert.equal(pdfPage.data.rows.length, 0); assert.ok(pdfPage.data.error);
  const textSelected = training.chooseSchemeFile(); fileOptions.success({ tempFiles: [{ path: '/temp/file.txt', name: '方案.txt', size: 100 }] }); await textSelected;
  const textPage = page('scheme'); await textPage.onLoad({ id: documents.load()[2].id }); assert.equal(textPage.data.text, recognitionResult);
  const textCount = documents.load().length, rejected = training.chooseSchemeFile();
  fileOptions.success({ tempFiles: [{ path: '/temp/app.exe', name: 'app.exe', size: 100 }] }); await rejected;
  assert.equal(documents.load().length, textCount); assert.ok(training.data.error);
  recognitionFails = true;
  const pending = documents.save({ type: 'training', kind: 'image', path: '/private/pending.jpg' });
  const offline = page('scheme'); await offline.onLoad({ id: pending.id }); await offline.generate();
  assert.equal(offline.data.busy, false); assert.match(offline.data.error, /OCR/); assert.equal(offline.data.rows.length, 0);
  console.log('PASS: camera/file chooser, local document previews, cancellation, text loading, reviewed plan generation, retries, atomic validation and offline recognition.');
})().catch(error => { console.error(error); process.exitCode = 1; });
