const KEY = 'spine_brace_records_v1';
const DAY = 86400000, OFFSET = 8 * 3600000;
function load() {
  const value = wx.getStorageSync(KEY);
  return value && Array.isArray(value.records) ? JSON.parse(JSON.stringify(value)) : { records: [], startedAt: null };
}
function date(time) { return new Date(time + OFFSET).toISOString().slice(0, 10); }
function duration(ms) {
  const minutes = Math.floor(ms / 60000);
  return Math.floor(minutes / 60) + '小时' + minutes % 60 + '分钟';
}
function toggle(now = Date.now()) {
  const state = load();
  if (state.startedAt !== null) {
    if (now < state.startedAt) throw new Error('设备时间早于开始时间，请检查时间设置');
    if (now > state.startedAt) state.records.push({ start: state.startedAt, end: now });
    state.startedAt = null;
  } else state.startedAt = now;
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
  return { braceWearing: state.startedAt !== null, braceDays: dates.length,
    braceToday: duration(totals[date(now)] || 0),
    braceTotal: duration(dates.reduce((total, key) => total + totals[key], 0)),
    braceHistory: dates.map(key => ({ date: key, duration: duration(totals[key]) })) };
}
function attach(page) {
  page.reloadBrace = function () {
    try { this.setData(Object.assign(summary(), { braceError: '' })); }
    catch (error) { this.setData({ braceError: '支具记录读取失败，请重试' }); }
  };
  page.toggleBraceRecord = function () {
    try { toggle(); this.reloadBrace(); }
    catch (error) { this.setData({ braceError: error.message || '保存失败，请重试' }); }
  };
  const show = page.onShow, hide = page.onHide, unload = page.onUnload;
  page.onShow = function () {
    if (show) show.call(this);
    this.reloadBrace();
    clearInterval(this._braceTimer);
    this._braceTimer = setInterval(() => this.reloadBrace(), 30000);
  };
  page.onHide = function () { clearInterval(this._braceTimer); if (hide) hide.call(this); };
  page.onUnload = function () { clearInterval(this._braceTimer); if (unload) unload.call(this); };
  return page;
}
module.exports = { KEY, load, toggle, summary, attach };
