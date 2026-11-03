// Library visibility and display names never change source files, actions or history.
const KEY = 'xiaoshu.material-library.v1';
const kinds = ['recordings', 'files'];
const clone = value => JSON.parse(JSON.stringify(value));
function check(kind, id) {
  if (!kinds.includes(kind) || typeof id !== 'string' || !id) throw Error('请选择有效素材');
}
function load() {
  const saved = wx.getStorageSync(KEY) || {}, hidden = saved.hidden || {}, names = saved.names || {};
  return { hidden: { recordings: Array.isArray(hidden.recordings) ? hidden.recordings.slice() : [], files: Array.isArray(hidden.files) ? hidden.files.slice() : [] },
    names: { recordings: Object.assign({}, names.recordings), files: Object.assign({}, names.files) } };
}
function change(kind, id, edit) {
  check(kind, id);
  const state = load(), before = JSON.stringify(state);
  edit(state);
  if (JSON.stringify(state) !== before) wx.setStorageSync(KEY, clone(state));
  return clone(state);
}
function isHidden(kind, id) { check(kind, id); return load().hidden[kind].includes(id); }
function title(kind, id, fallback) { check(kind, id); return load().names[kind][id] || fallback || ''; }
function hide(kind, id) { return change(kind, id, state => { if (!state.hidden[kind].includes(id)) state.hidden[kind].push(id); }); }
function restore(kind, id) { return change(kind, id, state => { state.hidden[kind] = state.hidden[kind].filter(value => value !== id); }); }
function rename(kind, id, label) {
  const name = String(label || '').trim();
  if (!name || name.length > 160) throw Error('名称请填写 1～160 个字');
  return change(kind, id, state => { state.names[kind] = Object.assign({}, state.names[kind], { [id]: name }); });
}
module.exports = { KEY, load, isHidden, title, hide, restore, rename };
