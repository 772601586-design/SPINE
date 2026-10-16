const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercises local persistence and account isolation with a simulated WeChat host.
// Camera capture, filesystem quotas and video decoding still require device testing.
const root = path.resolve(__dirname, '..');
const storage = new Map();
const files = new Set(['/temp/clip.mp4']);
let user = { id: 1 };
let failIndexWrite = false;
let delayedCopy;
let deferCopy = false;
const host = {
  env: { USER_DATA_PATH: 'wxfile://usr' },
  getStorageSync: key => storage.get(key) || '',
  setStorageSync(key, value) {
    if (failIndexWrite) throw Error('quota');
    storage.set(key, structuredClone(value));
  },
  getStorageInfoSync: () => ({keys: [...storage.keys()]}),
  removeStorageSync: key => storage.delete(key),
  getFileSystemManager: () => ({
    access: options => files.has(options.path) ? options.success() : options.fail({errMsg: 'not found'}),
    mkdir: options => {files.add(options.dirPath); options.success();},
    copyFile(options) {
      if (!files.has(options.srcPath)) {options.fail({errMsg: 'missing source'}); return;}
      const complete = () => {files.add(options.destPath); options.success();};
      if (deferCopy) delayedCopy = complete; else complete();
    },
    unlink: options => {files.delete(options.filePath); options.success();},
  }),
};
function load(relative, dependencies, asPage = false) {
  const source = fs.readFileSync(path.join(root, relative + '.ts'), 'utf8');
  const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2017}}).outputText;
  const exports = {};
  let page;
  vm.runInNewContext(code, {exports, wx: host, Error, Page(options) {
    page = options;
    page.setData = value => Object.assign(page.data, value);
  }, require(name) {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }});
  return asPage ? page : exports;
}

(async () => {
  const config = load('config/local-recordings', {});
  const recordings = load('services/local-recordings', {
    '../config/local-recordings': config, './session': {getCurrentUser: () => user},
  });
  const clip = {tempFilePath: '/temp/clip.mp4', size: 1024, duration: 12};
  const saved = await recordings.saveRecording(clip, '  现场示范  ');
  assert.ok(saved.filePath.startsWith('wxfile://usr/spine-recordings/1/'));
  assert.ok(files.has(saved.filePath));
  assert.equal(saved.title, '现场示范');
  assert.equal(saved.cardId, null);
  const legacy = {...saved};
  delete legacy.kind;
  storage.set(config.LOCAL_RECORDING_PREFIX + '1', [legacy]);
  assert.equal((await recordings.listRecordings())[0].kind, 'demonstration');
  files.delete(clip.tempFilePath);
  assert.equal((await recordings.listRecordings())[0].available, true);
  await recordings.matchRecording(saved.id, 17);
  assert.equal((await recordings.listRecordings(17)).length, 1);
  await recordings.matchRecording(saved.id, null);
  assert.equal((await recordings.listRecordings())[0].cardId, null);

  user = {id: 2};
  assert.equal((await recordings.listRecordings()).length, 0);
  await assert.rejects(recordings.matchRecording(saved.id, 17));
  await recordings.removeRecording(saved.id);
  assert.ok(files.has(saved.filePath));
  user = {id: 1};

  files.add(clip.tempFilePath);
  const countBefore = files.size;
  failIndexWrite = true;
  await assert.rejects(recordings.saveRecording(clip, '不能保留孤立副本'));
  failIndexWrite = false;
  assert.equal(files.size, countBefore);
  await assert.rejects(recordings.saveRecording({...clip, size: 51 * 1024 * 1024}, '过大'));

  deferCopy = true;
  const switching = recordings.saveRecording(clip, '切换账号中');
  await new Promise(resolve => setImmediate(resolve));
  user = {id: 2};
  delayedCopy();
  await assert.rejects(switching);
  assert.equal(files.size, countBefore);
  user = {id: 1};
  deferCopy = false;

  const session = load('services/session', {
    './api': {api: {}}, './request': {configureUnauthorizedHandler() {}},
    '../config/local-recordings': config,
  });
  storage.set('spine.session.token', 'test-token');
  storage.set('spine.training.pending-set.99', {private: true});
  session.clearSession();
  assert.ok(!storage.has('spine.session.token'));
  assert.ok(!storage.has('spine.training.pending-set.99'));
  assert.equal((await recordings.listRecordings())[0].id, saved.id);

  files.delete(saved.filePath);
  assert.equal((await recordings.listRecordings())[0].available, false);
  await assert.rejects(recordings.matchRecording(saved.id, 17));
  await recordings.removeRecording(saved.id);
  assert.equal((await recordings.listRecordings()).length, 0);

  storage.set(config.LOCAL_RECORDING_PREFIX + '1', [{...saved, filePath: 'wxfile://usr/other/file.mp4'}]);
  await assert.rejects(recordings.listRecordings());
  storage.delete(config.LOCAL_RECORDING_PREFIX + '1');

  const nav = [];
  let confirmDeletion = false;
  Object.assign(host, {showToast() {}, navigateBack() {}, navigateTo: options => nav.push(options.url),
    showModal: options => options.success({confirm: confirmDeletion}),
    chooseMedia: options => options.success({tempFiles: [clip]})});
  const api = {trainingPlan: async () => ({cards: [{id: 17, name: '动作', sets: 2, reps_per_set: 5}]}),
    actionCard: async () => ({id: 17, active: true})};
  const pageDeps = {'../../../services/session': {requireOnboarded: async () => true}, '../../../services/api': {api},
    '../../../services/local-recordings': recordings};
  const page = load('pages/rehab/recordings/index', pageDeps, true);
  page.chooseAlbum();
  page.setData({title: '页面示范'});
  await page.save();
  assert.equal(page.data.file, null);
  assert.equal(page.data.pendingCount, 1);
  const entry = page.data.recordings[0];
  page.openMatch({currentTarget: {dataset: {id: entry.id}}});
  assert.equal(nav.at(-1), '/pages/rehab/match/index?id=' + entry.id);
  const presentation = load('services/presentation', {});
  const match = load('pages/rehab/match/index', {...pageDeps, '../../../services/api': {api},
    '../../../services/presentation': presentation}, true);
  match.setData({id: entry.id});
  await match.reload();
  match.select({currentTarget: {dataset: {id: 17}}});
  await match.save();
  assert.equal((await recordings.listRecordings(17)).length, 1);
  api.actionCard = async () => {throw Error('card removed');};
  await match.save();
  assert.equal(match.data.error, 'card removed');
  assert.equal((await recordings.listRecordings(17)).length, 1);
  await page.remove({currentTarget: {dataset: {id: entry.id}}});
  assert.ok(files.has(entry.filePath));
  confirmDeletion = true;
  await page.remove({currentTarget: {dataset: {id: entry.id}}});
  assert.ok(!files.has(entry.filePath));
  assert.equal(page.data.recordings.length, 0);
  api.actionCard = async () => ({id: 17, active: true});
  page.onLoad({cardId: '17', kind: 'practice'});
  page.chooseAlbum();
  await page.save();
  const practice = (await recordings.listRecordings(17))[0];
  assert.equal(practice.kind, 'practice');
  assert.equal(practice.title, '我的练习录像');
  assert.equal(page.data.pendingCount, 0);
  await recordings.matchRecording(practice.id, null);
  await recordings.matchRecording(practice.id, 17);
  assert.equal((await recordings.listRecordings(17))[0].kind, 'practice');
  const demonstration = await recordings.saveRecording(clip, '示范', {cardId: 17});
  const practice2 = await recordings.saveRecording(clip, '第二次练习', {cardId: 17, kind: 'practice'});
  const cardPage = load('pages/rehab/card/index', {...pageDeps, '../../../services/presentation': presentation}, true);
  cardPage.setData({id: 17});
  await cardPage.loadLocalVideos();
  assert.equal(cardPage.data.localVideos.length, 1);
  assert.equal(cardPage.data.practiceOptions.length, 2);
  assert.equal(cardPage.data.demoOptions[0].id, demonstration.id);
  cardPage.selectTab({currentTarget: {dataset: {value: 'check'}}});
  assert.equal(cardPage.data.tab, 'check');
  cardPage.chooseComparison({currentTarget: {dataset: {kind: 'practice'}}, detail: {value: '1'}});
  const selectedId = cardPage.data.practiceOptions[cardPage.data.practiceIndex].id;
  await cardPage.loadLocalVideos();
  assert.equal(cardPage.data.practiceOptions[cardPage.data.practiceIndex].id, selectedId);
  cardPage.recordPractice();
  assert.equal(nav.at(-1), '/pages/rehab/recordings/index?cardId=17&kind=practice');
  files.delete(practice2.filePath);
  await cardPage.loadLocalVideos();
  assert.equal(cardPage.data.practiceOptions.length, 1);
  assert.equal(cardPage.data.missingVideoCount, 1);
  assert.equal(cardPage.data.demoOptions[0].id, demonstration.id);
  api.actionCard = async () => ({id: 17, active: false});
  page.chooseAlbum();
  const beforeReject = (await recordings.listRecordings()).length;
  await page.save();
  assert.ok(page.data.error);
  assert.equal((await recordings.listRecordings()).length, beforeReject);
  console.log('PASS: durable copy, manual matching/unmatching, account isolation, rollback, size limits, account changes during save, logout preservation, missing files and path validation');
  console.log('PASS: capture/save/list/match page flow, stale card rejection and delete confirmation');
  console.log('PASS: legacy demonstration compatibility, practice role separation, direct card binding, comparison selection retention, missing clip fallback and inactive card rejection');
})().catch(error => {console.error(error); process.exitCode = 1;});
