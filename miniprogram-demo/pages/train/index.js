const t = require('../../core/training');
const legacy = require('../../core/store');
const schemeUpload = require('../../core/scheme-upload');
Page({
  data: { date: t.today(), days: [], plans: [], cards: [], drafts: [], records: [], groups: [], error: '', currentPlans: [], complete: 0, total: 0, schemePicker: false, schemeBusy: false },
  onShow() { legacy.enter('train'); try { t.importAttachmentPlan(); } catch (error) { this.setData({ error: error.message }); return; } this.reload(); },
  reload() {
    try {
      const state = t.load(), date = this.data.date;
      const currentPlans = state.plans.filter(plan => t.due(plan, date, state) || state.sessions.some(record => record.planId === plan.id && record.date === date));
      const records = [];
      currentPlans.forEach(plan => {
        const saved = state.sessions.find(record => record.planId === plan.id && record.date === date);
        const rows = saved ? saved.rows.map(row => {
          const card = state.cards.find(card => card.id === row.cardId);
          return row.confirmed === false && card && card.confirmed ? Object.assign({}, card, { cardId: card.id, values: Array(card.sets).fill(null) }) : row;
        }) : plan.cardIds.map(cardId => state.cards.find(card => card.id === cardId)).filter(Boolean).map(card => Object.assign({}, card, { cardId: card.id, values: Array(card.sets || 0).fill(null) }));
        rows.forEach(row => records.push(Object.assign({}, row, { rowId: plan.id + ':' + row.cardId, planId: plan.id, planName: saved ? saved.planName : plan.name,
          groupName: row.groupName || '未分组', dose: t.dose(row), completed: t.complete(row), guidedDone: t.guidedComplete(row),
          progress: t.progress(row), ready: row.confirmed !== false && row.sets > 0 && row.amount > 0 && (!!saved || state.cards.some(card => card.id === row.cardId && card.confirmed)) })));
      });
      const groups = [], order = ['认知能力学习','姿势矫正','柔韧性练习','3D矫正练习','核心/肩胛带稳定性训练','颈椎矫正动作','拉伸·整理放松'];
      records.forEach(row => { let group = groups.find(item => item.name === row.groupName); if (!group) { group = { name: row.groupName, rows: [], complete: 0 }; groups.push(group); } group.rows.push(row); if (row.completed) group.complete++; });
      groups.sort((a,b) => (order.includes(a.name) ? order.indexOf(a.name) : 99) - (order.includes(b.name) ? order.indexOf(b.name) : 99));
      let number = 0; groups.forEach((group,index) => { group.number = index + 1; group.rows.forEach(row => { row.number = ++number; }); });
      this.setData({ days: t.week(date), currentPlans, records, groups, total: records.length, complete: records.filter(row => row.completed).length,
        plans: state.plans.map(plan => Object.assign({}, plan, { scheduleLabel: t.scheduleLabel(plan), count: plan.cardIds.length })),
        cards: state.cards.map(card => Object.assign({}, card, { dose: t.dose(card), status: t.cardStatus(card) })), drafts: state.cards.filter(card => !card.confirmed), error: '' });
    } catch (error) { this.setData({ error: error.message }); }
  },
  selectDate(e) { this.setData({ date: e.currentTarget.dataset.date }); this.reload(); },
  chooseDate(e) { this.setData({ date: e.detail.value }); this.reload(); },
  capture() {
    if (this._capturing) return;
    this._capturing = true;
    wx.chooseMedia({ count: 1, mediaType: ['video'], sourceType: ['camera'], maxDuration: 300,
      success: result => {
        const file = result.tempFiles[0];
        if (file) wx.navigateTo({ url: '/pages/capture/index?video=' + encodeURIComponent(file.tempFilePath) });
      },
      fail: error => { if (!/cancel/.test(error.errMsg)) this.setData({ error: '视频拍摄未完成，请重试。' }); },
      complete: () => { this._capturing = false; } });
  },
  createCard() { wx.navigateTo({ url: '/pages/card/index?new=1&manual=1' }); },
  uploadScheme() { if (!this.data.schemeBusy) this.setData({ schemePicker: true }); },
  closeSchemePicker() { this.setData({ schemePicker: false }); },
  stopTouch() {},
  photographScheme() { return this.selectScheme('camera'); },
  chooseSchemeFile() { return this.selectScheme('file'); },
  async selectScheme(source) {
    if (this.data.schemeBusy) return;
    this.setData({ schemePicker: false, schemeBusy: true, error: '' });
    try { const document = await schemeUpload.choose(source); if (document) wx.navigateTo({ url: '/pages/scheme/index?id=' + document.id }); }
    catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ schemeBusy: false }); }
  },
  openCard(e) { wx.navigateTo({ url: '/pages/card/index?id=' + e.currentTarget.dataset.id }); },
  openDrafts() { if (this.data.drafts.length) wx.navigateTo({ url: '/pages/card/index?id=' + this.data.drafts[0].id }); else this.createCard(); },
  createPlan() { wx.navigateTo({ url: '/pages/plan/index' }); },
  openPlan(e) { wx.navigateTo({ url: '/pages/plan/index?id=' + e.currentTarget.dataset.id }); },
  openSchedule() { if (this.data.plans.length) wx.navigateTo({ url: '/pages/plan/index?id=' + this.data.plans[0].id }); else this.createPlan(); },
  launch(row) {
    try {
      if (!row.ready) { wx.navigateTo({ url: '/pages/card/index?id=' + row.cardId + '&manual=1' }); return; }
      const record = t.session(row.planId, this.data.date, false);
      wx.navigateTo({ url: '/pages/follow/index?session=' + record.id + '&card=' + row.cardId });
    } catch (error) { this.setData({ error: error.message }); }
  },
  startExercise(event) {
    const row = this.data.records.find(item => item.planId === event.currentTarget.dataset.plan && item.cardId === event.currentTarget.dataset.card);
    if (row) this.launch(row);
  },
  backfill() { wx.navigateTo({ url: '/pages/execution/index?backfill=1&date=' + this.data.date }); },
});
