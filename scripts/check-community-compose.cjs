const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const filename = path.resolve(__dirname, '../miniprogram-demo/pages/community/index.js');
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const KEY = 'xiaoshu-community-v1';
let saved = { posts: [], hugs: ['leaf'], saved: [], replies: {}, draft: {
  composeType: '问问题', mood: '担心', body: '已有草稿正文', images: ['/local/saved.jpg'], visibility: '仅自己可见'
} };
let failWrites = false;
let now = 1793059200000;
const toasts = [];
const wx = {
  getStorageSync(key) { assert.equal(key, KEY); return clone(saved); },
  setStorageSync(key, value) { assert.equal(key, KEY); if (failWrites) throw Error('storage full'); saved = clone(value); },
  showToast(options) { toasts.push(options.title); }
};
class Clock extends Date { static now() { return ++now; } }
function page() {
  let definition;
  const core = path.resolve(__dirname, '../miniprogram-demo/core/community-page.js');
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(core, 'utf8'), { module, wx, Date: Clock }, { filename: core });
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { Page: value => { definition = value; }, wx, Date: Clock,
    require: request => { assert.equal(request, '../../core/community-page'); return module.exports; }
  }, { filename });
  definition.data = clone(definition.data);
  definition.setData = values => Object.assign(definition.data, clone(values));
  definition.onLoad();
  return definition;
}
const event = (value, key = 'value') => ({ currentTarget: { dataset: { [key]: value } } });
const input = value => ({ detail: { value } });
const p = page();
const legacy = JSON.stringify(saved);
p.compose(event(undefined, 'type'));
assert.equal(p.data.mainTopic, '求助');
assert.deepEqual(p.data.mainTopics, ['求助', '分享', '日常']);
assert.equal(p.data.body, '已有草稿正文');
assert.deepEqual(p.data.images, ['/local/saved.jpg']);
assert.equal(p.data.visibility, '仅自己可见');
assert.equal(JSON.stringify(saved), legacy, 'opening a legacy draft must not rewrite it');

p.pickType(event('分享'));
p.inputTag(input('#复查 #训练，#复查 #分享'));
p.addTag();
assert.equal(p.data.mainTopic, '分享', 'supplemental tags never replace the main topic');
assert.deepEqual(p.data.tags, ['复查', '训练']);
p.inputTag(input('#支具'));
p.saveDraft();
assert.deepEqual(saved.draft.tags, ['复查', '训练', '支具'], 'pending tag input is saved even without pressing Add');
assert.equal(saved.draft.mainTopic, '分享');
assert.equal(saved.posts.length, 0, 'saving a draft does not publish');
assert.equal(p.data.tagInput, '');

const reopened = page();
reopened.compose(event(undefined, 'type'));
assert.equal(reopened.data.mainTopic, '分享');
assert.deepEqual(reopened.data.tags, ['复查', '训练', '支具']);
assert.equal(reopened.data.body, '已有草稿正文');
reopened.removeTag(event(2, 'index'));
assert.deepEqual(reopened.data.tags, ['复查', '训练']);
reopened.inputBody(input('新版发布正文'));
const beforeFailure = JSON.stringify(saved);
const beforeLocalFailure = JSON.stringify(reopened.local);
failWrites = true;
reopened.saveDraft();
assert.equal(JSON.stringify(saved), beforeFailure);
assert.equal(JSON.stringify(reopened.local), beforeLocalFailure, 'failed draft write preserves the previous draft in memory');
reopened.submit();
assert.equal(JSON.stringify(saved), beforeFailure);
assert.equal(JSON.stringify(reopened.local), beforeLocalFailure, 'failed publish preserves both posts and draft');
assert.equal(reopened.data.screen, 'compose');
assert.equal(reopened.data.body, '新版发布正文');
failWrites = false;
reopened.submit();
assert.equal(saved.posts.length, 1);
assert.equal(saved.posts[0].mainTopic, '分享');
assert.deepEqual(saved.posts[0].tags, ['复查', '训练']);
assert.equal(saved.posts[0].private, true, 'the Publish label does not override audience choice');
assert.equal(saved.draft, null);
assert.deepEqual(saved.hugs, ['leaf'], 'existing reactions survive draft and publish writes');
assert.deepEqual(reopened.data.posts[0].displayTags, ['分享', '复查', '训练']);
reopened.search();
reopened.inputSearch(input('#训练'));
assert.ok(reopened.data.shownPosts.some(post => post.id === saved.posts[0].id), 'hashtags are searchable');

const fresh = page();
fresh.compose(event(undefined, 'type'));
assert.equal(fresh.data.mainTopic, '日常');
const count = saved.posts.length;
fresh.saveDraft();
assert.equal(saved.posts.length, count, 'empty drafts can be saved');
fresh.submit();
assert.equal(saved.posts.length, count, 'blank content does not publish an invented mood');
assert.equal(fresh.data.screen, 'compose');
fresh.pickType(event('求助'));
fresh.visibility();
fresh.setData({ images: ['/local/image-only.jpg'] });
fresh.submit();
assert.equal(saved.posts[0].mainTopic, '求助');
assert.equal(saved.posts[0].body, '');
assert.equal(saved.posts[0].private, false);
assert.deepEqual(saved.posts[0].images, ['/local/image-only.jpg']);
assert.ok(toasts.includes('保存失败，请稍后重试'));
console.log('PASS: community main/supplemental topics, tag deduplication/removal/search, legacy draft restore, pending tags, draft/publish isolation, failed-write preservation and audience choice.');
