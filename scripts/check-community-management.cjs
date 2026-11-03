const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../miniprogram-demo');
const clone = value => JSON.parse(JSON.stringify(value));
const KEY = 'xiaoshu-community-v1';
const own = { id: 'local-owned', name: '我', time: '昨天', category: '分享', mainTopic: '分享', topic: '分享', tags: ['复查'], body: '开发演示原文', title: '开发演示原文', images: ['/local/image.jpg'], private: false, hugs: 2, comments: 3 };
const other = { ...own, id: 'local-other', body: '另一条自己的帖子' };
let stored = { posts: [own, other], hugs: [own.id, 'leaf'], saved: [own.id, 'review'], replies: { [own.id]: [{ body: '原回复' }], leaf: [{ body: '其他回复' }] }, draft: { mainTopic: '日常', body: '独立草稿', images: [], tags: [], visibility: '仅自己可见' } };
let failWrites = false, modal, sheet, backCount = 0;
const wx = {
  getStorageSync(key) { assert.equal(key, KEY); return clone(stored); },
  setStorageSync(key, value) { assert.equal(key, KEY); if (failWrites) throw Error('storage full'); stored = clone(value); },
  showToast() {}, showModal(options) { modal = options; }, showActionSheet(options) { sheet = options; },
  navigateBack() { backCount++; }
};
const moduleHost = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'core/community-page.js'), 'utf8'), { module: moduleHost, wx, Date });
function page(route) {
  let p;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages', route, 'index.js'), 'utf8'), {
    Page: definition => { p = definition; }, require: request => { assert.equal(request, '../../core/community-page'); return moduleHost.exports; }
  });
  p.data = clone(p.data);
  p.setData = values => Object.assign(p.data, clone(values));
  p.onLoad(); p.onShow();
  return p;
}
const event = (id, key = 'id') => ({ currentTarget: { dataset: { [key]: id } } });
const input = value => ({ detail: { value } });
const manager = page('my-posts'), feed = page('community');
assert.equal(manager.data.screen, 'manage');
assert.equal(feed.data.screen, 'home');
assert.deepEqual(manager.data.ownPosts.map(p => p.id), [own.id, other.id]);
assert.equal(feed.data.posts.length, 5, 'built-in examples stay in the community but not in management');
const initial = JSON.stringify(stored);
manager.editPost(event('leaf')); manager.deletePost(event('leaf')); manager.changePostVisibility(event('leaf'));
assert.equal(manager.data.screen, 'manage');
assert.equal(modal, undefined); assert.equal(sheet, undefined);
assert.equal(JSON.stringify(stored), initial, 'sample posts cannot be edited, deleted or hidden');

feed.openPost(event(own.id));
manager.editPost(event(own.id));
assert.equal(feed.data.screen, 'post', 'two page instances keep independent navigation and editor state');
assert.equal(manager.data.visibility, '社群可见');
assert.deepEqual(manager.data.images, own.images);
manager.inputBody(input('取消的修改')); manager.back();
assert.equal(JSON.stringify(stored), initial, 'cancel does not change the published post');
manager.editPost(event(own.id));
manager.inputBody(input('开发演示修改后的正文'));
manager.pickType(event('求助', 'value'));
manager.inputTag(input('#训练 #支具'));
manager.visibility();
failWrites = true;
manager.submit();
assert.equal(JSON.stringify(stored), initial, 'failed edit preserves the published post and draft');
assert.equal(manager.data.screen, 'compose');
assert.equal(manager.data.body, '开发演示修改后的正文');
failWrites = false;
manager.submit();
assert.equal(manager.data.screen, 'manage');
assert.equal(stored.posts.length, 2);
assert.equal(stored.posts[0].id, own.id);
assert.equal(stored.posts[0].time, own.time);
assert.equal(stored.posts[0].body, '开发演示修改后的正文');
assert.equal(stored.posts[0].mainTopic, '求助');
assert.deepEqual(stored.posts[0].tags, ['复查', '训练', '支具']);
assert.equal(stored.posts[0].private, true);
assert.equal(stored.posts[0].hugs, 2); assert.equal(stored.posts[0].comments, 3);
assert.deepEqual(stored.replies[own.id], [{ body: '原回复' }]);
assert.equal(stored.draft.body, '独立草稿');
feed.onShow();
assert.equal(feed.data.selected.body, stored.posts[0].body, 'returning to an open detail refreshes edited content');
assert.equal(feed.data.selected.private, true);
assert.equal(feed.data.selected.hugs, 3); assert.equal(feed.data.selected.comments, 4);

const beforePrivacy = JSON.stringify(stored);
manager.changePostVisibility(event(own.id));
assert.deepEqual(clone(sheet.itemList), ['仅自己可见', '社群可见']);
assert.equal(JSON.stringify(stored), beforePrivacy, 'opening/cancelling audience selection does not save');
sheet.success({ tapIndex: -1 }); assert.equal(JSON.stringify(stored), beforePrivacy);
failWrites = true; sheet.success({ tapIndex: 1 });
assert.equal(JSON.stringify(stored), beforePrivacy);
assert.equal(manager.data.ownPosts[0].private, true);
failWrites = false; sheet.success({ tapIndex: 1 });
assert.equal(stored.posts[0].private, false);
assert.equal(page('my-posts').data.ownPosts[0].private, false, 'audience choice persists after reopening');
feed.onShow(); assert.equal(feed.data.selected.private, false);

manager.editPost(event(own.id));
manager.inputBody(input('')); manager.setData({ images: [] }); manager.submit();
assert.equal(manager.data.screen, 'compose', 'an edit cannot save empty text with no images');
manager.back();
const beforeDelete = JSON.stringify(stored);
manager.deletePost(event(own.id)); modal.success({ confirm: false });
assert.equal(JSON.stringify(stored), beforeDelete, 'cancelled deletion changes nothing');
manager.deletePost(event(own.id)); failWrites = true; modal.success({ confirm: true });
assert.equal(JSON.stringify(stored), beforeDelete, 'failed deletion preserves every post and interaction');
assert.equal(manager.data.ownPosts.length, 2);
failWrites = false;
const staleEditor = page('my-posts'); staleEditor.editPost(event(own.id));
manager.deletePost(event(own.id)); modal.success({ confirm: true });
assert.deepEqual(stored.posts.map(p => p.id), [other.id]);
assert.deepEqual(stored.hugs, ['leaf']); assert.deepEqual(stored.saved, ['review']);
assert.equal(stored.replies[own.id], undefined);
assert.deepEqual(stored.replies.leaf, [{ body: '其他回复' }]);
assert.equal(stored.draft.body, '独立草稿');
staleEditor.inputBody(input('过期编辑')); staleEditor.submit();
assert.deepEqual(stored.posts.map(p => p.id), [other.id], 'a stale editor cannot resurrect a deleted post');
feed.onShow();
assert.equal(feed.data.screen, 'home'); assert.deepEqual(feed.data.selected, {});
assert.ok(!feed.data.posts.some(p => p.id === own.id), 'deleted content disappears from both feed and open detail');
manager.deletePost(event(other.id)); modal.success({ confirm: true });
assert.equal(manager.data.ownPosts.length, 0);
manager.back(); assert.equal(backCount, 1, 'root management back returns to Me');

const bundle = require('./serve-demo.cjs').buildDemoBundle();
const preview = bundle.pages['pages/my-posts/index'];
assert.ok(preview.wxml.includes('management-actions') && !preview.wxml.includes('<include'));
assert.ok(preview.wxss.includes('.management-actions') && !preview.wxss.includes('@import'));
console.log('PASS: own-post management, independent page/editor state, edit/cancel, preserved interactions and drafts, audience persistence, confirmed deletion, failed writes, stale-editor protection, feed/detail refresh, navigation and shared preview templates.');
