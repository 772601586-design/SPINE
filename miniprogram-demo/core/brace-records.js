const KEY = 'spine_brace_records_v1';
const DAY = 86400000, OFFSET = 8 * 3600000;
function load() {
  const value = wx.getStorageSync(KEY);
  const state = value && Array.isArray(value.records) ? JSON.parse(JSON.stringify(value)) : { records: [], startedAt: null };
  // 旧记录保持显示；是否显示与当前是否佩戴是两个独立状态。
  state.enabled = state.enabled !== false;
  return state;
}
function date(time) { return new Date(time + OFFSET).toISOString().slice(0, 10); }
function duration(ms) {
  const minutes = Math.floor(ms / 60000);
  return Math.floor(minutes / 60) + '小时' + minutes % 60 + '分钟';
}
function finish(state, now) {
  if (state.startedAt === null) return;
  if (now < state.startedAt) throw new Error('设备时间早于开始时间，请检查时间设置');
  if (now > state.startedAt) state.records.push({ start: state.startedAt, end: now });
  state.startedAt = null;
}
function toggle(now = Date.now()) {
  const state = load();
  if (!state.enabled) throw new Error('支具功能已关闭，请先在“我的”中开启');
  if (state.startedAt !== null) finish(state, now);
  else state.startedAt = now;
  wx.setStorageSync(KEY, state);
}
function setEnabled(enabled, now = Date.now()) {
  if (typeof enabled !== 'boolean') throw new Error('请选择是否显示支具功能');
  const state = load();
  if (state.enabled === enabled) return;
  if (!enabled) finish(state, now);
  state.enabled = enabled;
  // 结束当前记录与关闭偏好一起保存，保存失败时两者均保持原值。
  wx.setStorageSync(KEY, state);
}
function summary(now = Date.now()) {
  const state = load(), totals = {};
  const intervals = state.records.slice();
  if (state.startedAt !== null) intervals.push({ start: state.startedAt, end: now });
  intervals.forEach(record => {
    let cursor = record.start;
    const end = Math.min(record.end, now);
    while (cursor < end) {
      const boundary = (Math.floor((cursor + OFFSET) / DAY) + 1) * DAY - OFFSET;
      const stop = Math.min(boundary, end), key = date(cursor);
      totals[key] = (totals[key] || 0) + stop - cursor;
      cursor = stop;
    }
  });
  const dates = Object.keys(totals).sort().reverse();
  return { braceEnabled: state.enabled, braceWearing: state.startedAt !== null, braceDays: dates.length,
    braceToday: duration(totals[date(now)] || 0),
    braceTotal: duration(dates.reduce((total, key) => total + totals[key], 0)),
    braceHistory: dates.map(key => ({ date: key, duration: duration(totals[key]) })) };
}
function attach(page, options = {}) {
  page.data = Object.assign({ braceEnabled: false, braceWearing: false, braceError: '' }, page.data);
  page.reloadBrace = function () {
    try { this.setData(Object.assign(summary(), { braceError: '' })); }
    catch (error) { this.setData({ braceError: '支具记录读取失败，请重试' }); }
  };
  page.toggleBraceRecord = function () {
    try { toggle(); this.reloadBrace(); }
    catch (error) { this.setData({ braceError: error.message || '保存失败，请重试' }); }
  };
  page.toggleBraceFeature = function () {
    try { setEnabled(!this.data.braceEnabled); this.reloadBrace(); }
    catch (error) { this.setData({ braceError: error.message || '保存失败，请重试' }); }
  };
  const show = page.onShow, hide = page.onHide, unload = page.onUnload;
  page.onShow = function () {
    if (show) show.call(this);
    this.reloadBrace();
    clearInterval(this._braceTimer);
    if (options.live !== false && this.data.braceEnabled) this._braceTimer = setInterval(() => this.reloadBrace(), 30000);
  };
  page.onHide = function () { clearInterval(this._braceTimer); if (hide) hide.call(this); };
  page.onUnload = function () { clearInterval(this._braceTimer); if (unload) unload.call(this); };
  return page;
}
module.exports = { KEY, load, toggle, setEnabled, summary, attach };
