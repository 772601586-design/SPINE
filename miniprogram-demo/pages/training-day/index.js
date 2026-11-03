const t = require('../../core/training');
const calendar = require('../../core/training-calendar');
const store = require('../../core/store');
Page({
  spineScreen: 'training-day',
  data: { day: null, error: '' },
  onLoad(query) { this.date = query.date || t.today(); },
  onShow() {
    store.enter('training-day');
    try { this.setData({ day: calendar.dayDetails(t.load(), this.date), error: '' }); }
    catch (error) { this.setData({ day: null, error: error.message || '记录读取失败，请返回重试' }); }
  },
  openRecord(event) {
    const id = event.currentTarget.dataset.id;
    if (this.data.day && this.data.day.sessions.some(record => record.id === id)) wx.navigateTo({ url: '/pages/execution/index?session=' + encodeURIComponent(id) });
  }
});
