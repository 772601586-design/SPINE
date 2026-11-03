const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../miniprogram-demo');
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const KEY = 'spine-state-v1';
const storage = { [KEY]: { onboarded: true, stage: 'brace', done: [7, 9], trainRewarded: true, pine: 47, visitMenarcheStatus: 'not_applicable', uploadSaved: true, customField: 'preserve' }, 'xiaoshu-community-v1': { posts: [{ id: 'keep' }] } };
let cache = new Map(), stack = [], failWrite = false, picker, copy, lastNavigation, failNavigation = false;
const queue = [], deleted = [], files = new Set();
const wx = {
  env: { USER_DATA_PATH: '/user' },
  getStorageSync: key => clone(storage[key]),
  setStorageSync(key, value) { if (failWrite) throw Error('storage full'); storage[key] = clone(value); },
  nextTick: fn => queue.push(fn), showToast() {},
  navigateTo: options => { lastNavigation = options.url; },
  navigateBack: options => { lastNavigation = 'back'; if (failNavigation) options.fail(); },
  switchTab: options => { lastNavigation = options.url; if (failNavigation) options.fail(); },
  chooseMedia(options) { picker = options; },
  getFileSystemManager: () => ({ copyFile(options) { copy = options; }, unlink(options) { deleted.push(options.filePath); files.delete(options.filePath); } })
};
function moduleAt(filename) {
  filename = path.resolve(filename);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} }; cache.set(filename, module);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module, wx, getCurrentPages: () => stack,
    require: request => moduleAt(path.resolve(path.dirname(filename), request + '.js')),
    setInterval: () => 1, clearInterval() {}
  }, { filename });
  return module.exports;
}
function page(name) {
  let p;
  const filename = path.join(root, 'pages', name, 'index.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { Page: value => { p = value; }, wx, getCurrentPages: () => stack,
    require: request => moduleAt(path.resolve(path.dirname(filename), request + '.js'))
  }, { filename });
  p.data = clone(p.data || {});
  p.setData = values => { assert.ok(!p._unloaded, 'no setData after page unload'); Object.assign(p.data, clone(values)); };
  p.route = 'pages/' + name + '/index';
  stack = name === 'me' ? [p] : [{ route: 'pages/me/index', spineScreen: 'me' }, p];
  if (p.onLoad) p.onLoad();
  if (p.onShow) p.onShow();
  while (queue.length) queue.shift()();
  return p;
}
const input = value => ({ detail: { value } });
function choose(p, source = '/tmp/avatar.png') {
  p.chooseAvatar();
  assert.deepEqual(clone(picker.mediaType), ['image']);
  picker.success({ tempFiles: [{ tempFilePath: source }] });
  return copy;
}
function copied(options) { files.add(options.destPath); options.success(); }
let store = moduleAt(path.join(root, 'core/store.js'));
const p = page('personal-info');
assert.equal(p.data.nickname, '小禾'); assert.equal(p.data.avatar, ''); assert.equal(p.data.stageIndex, 2);
const original = JSON.stringify(storage), originalDone = clone(store.app.state.done);
p.inputNickname(input('未保存昵称')); p.changeStage(input(4)); p.onUnload();
assert.equal(JSON.stringify(storage), original, 'leaving unsaved changes does not write');
assert.equal(store.app.state.stage, 'brace'); assert.deepEqual(clone(store.app.state.done), originalDone);

const edit = page('personal-info');
edit.chooseAvatar(); picker.fail({ errMsg: 'chooseMedia:fail cancel' });
assert.equal(edit.data.avatarBusy, false); assert.equal(edit.data.error, '');
choose(edit); copy.fail({ errMsg: 'copy failed' });
assert.equal(edit.data.avatar, ''); assert.ok(edit.data.error);
const draftAvatar = choose(edit); copied(draftAvatar);
assert.equal(edit.data.avatar, draftAvatar.destPath); assert.equal(store.app.state.profileAvatar, undefined);
edit.inputNickname(input('  小树朋友  '));
const beforeMemory = JSON.stringify(store.app.state);
failWrite = true; edit.save();
assert.equal(JSON.stringify(storage), original);
assert.equal(JSON.stringify(store.app.state), beforeMemory, 'failed save does not update app memory');
assert.equal(edit.data.nickname, '  小树朋友  '); assert.equal(edit.data.avatar, draftAvatar.destPath);
assert.equal(edit.data.saving, false); assert.ok(edit.data.error);
assert.ok(files.has(draftAvatar.destPath), 'retry can reuse the staged avatar');
failWrite = false; edit.save();
assert.equal(lastNavigation, 'back');
assert.equal(storage[KEY].profileNickname, '小树朋友'); assert.equal(storage[KEY].profileAvatar, draftAvatar.destPath);
assert.deepEqual(storage[KEY].done, originalDone); assert.equal(storage[KEY].trainRewarded, true, 'nickname/avatar changes preserve completed training');
assert.equal(storage[KEY].pine, 47); assert.equal(storage[KEY].customField, 'preserve');
assert.equal(storage[KEY].visitMenarcheStatus, 'not_applicable');
assert.deepEqual(storage['xiaoshu-community-v1'], { posts: [{ id: 'keep' }] });
edit.onUnload(); assert.ok(files.has(draftAvatar.destPath), 'saved avatar survives page unload');

cache = new Map(); store = moduleAt(path.join(root, 'core/store.js'));
const reopened = page('personal-info');
assert.equal(reopened.data.nickname, '小树朋友'); assert.equal(reopened.data.avatar, draftAvatar.destPath);
reopened.changeStage(input(4)); assert.equal(store.app.state.stage, 'brace', 'stage picker edits only the draft');
reopened.save(); reopened.onUnload();
assert.equal(store.app.state.stage, 'adult'); assert.deepEqual(storage[KEY].done, []); assert.equal(storage[KEY].trainRewarded, false);
const replacement = page('personal-info'), nextAvatar = choose(replacement); copied(nextAvatar);
assert.ok(!deleted.includes(draftAvatar.destPath), 'old avatar is retained until a successful save');
failWrite = true; replacement.save(); failWrite = false;
assert.ok(!deleted.includes(draftAvatar.destPath));
replacement.changeStage(input(3)); replacement.save(); replacement.onUnload();
assert.deepEqual(storage[KEY].done, [1, 2, 3, 4]); assert.equal(storage[KEY].stage, 'off');
assert.ok(deleted.includes(draftAvatar.destPath)); assert.ok(files.has(nextAvatar.destPath));

const cancelAvatar = page('personal-info'), unused = choose(cancelAvatar); copied(unused); cancelAvatar.onUnload();
assert.ok(deleted.includes(unused.destPath)); assert.ok(files.has(nextAvatar.destPath));
const late = page('personal-info'), delayed = choose(late); late.onUnload(); copied(delayed);
assert.ok(deleted.includes(delayed.destPath), 'late copy completion cleans up without updating an unloaded page');
const remove = page('personal-info'); remove.removeAvatar(); remove.save(); remove.onUnload();
assert.equal(storage[KEY].profileAvatar, ''); assert.ok(deleted.includes(nextAvatar.destPath));

const validation = page('personal-info'), beforeInvalid = JSON.stringify(storage);
validation.inputNickname(input('   ')); validation.save(); assert.ok(validation.data.error);
validation.inputNickname(input('名'.repeat(31))); validation.save(); assert.ok(validation.data.error);
assert.equal(JSON.stringify(storage), beforeInvalid);
assert.throws(() => store.savePersonalInfo({ nickname: '开发演示', avatar: '', stage: 'invalid' }));
validation.inputNickname(input('返回失败时已保存')); failNavigation = true; validation.save(); failNavigation = false;
assert.equal(validation.data.saving, false); assert.match(validation.data.error, /已保存/);
assert.equal(storage[KEY].profileNickname, '返回失败时已保存'); validation.onUnload();

const me = page('me');
assert.equal(me.data.profileNickname, '返回失败时已保存'); assert.equal(me.data.profileAvatar, '');
me.openPersonalInfo(); assert.equal(lastNavigation, '/pages/personal-info/index');
me.openGrowthRecords(); assert.equal(lastNavigation, '/pages/growth-records/index');
const template = fs.readFileSync(path.join(root, 'pages/me/index.wxml'), 'utf8');
assert.equal((template.match(/class="me-records-card"/g) || []).length, 1);
assert.ok(!/Rigo|Risser|初潮|档案完整度|completeW|completeText|stageLabel|12 岁|切换阶段/.test(template), 'Me does not expose patient details or completeness');
const info = fs.readFileSync(path.join(root, 'pages/personal-info/index.wxml'), 'utf8');
assert.ok(info.includes('本机演示') && info.includes('未连接账号'));
console.log('PASS: legacy profile compatibility, persisted nickname/avatar/stage, atomic failure handling, staged edits, avatar cancel/copy/unload/replacement cleanup, stage semantics, record preservation, navigation recovery and simplified Me.');
