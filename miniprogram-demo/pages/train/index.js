const t = require('../../core/training');
const legacy = require('../../core/store');
const brace = require('../../core/brace-records');
const definition = {
  openKnowledge() { wx.navigateTo({ url: '/pages/knowledge/index?mode=list&topic=schroth&title=Schroth训练原理' }); },
  data: { date: t.today(), days: [], records: [], groups: [], error: '', currentPlans: [], complete: 0, total: 0 },
  onShow() { if (this.getTabBar) wx.nextTick(() => { const bar = this.getTabBar(); if (bar) bar.setData({ selected: 1 }); }); legacy.enter('train'); this.setData({ date: t.today() }); try { t.importAttachmentPlan(); } catch (error) { this.setData({ error: error.message }); return; } this.reload(); },
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
      this.setData({ days: t.week(date), currentPlans, records, groups, total: records.length, complete: records.filter(row => row.completed).length, error: '' });
    } catch (error) { this.setData({ error: error.message }); }
  },
  selectDate(e) { this.setData({ date: e.currentTarget.dataset.date }); this.reload(); },
  chooseDate(e) { this.setData({ date: e.detail.value }); this.reload(); },
  openPlanning() { wx.switchTab({ url: '/pages/planning/index' }); },
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
};
Page(brace.attach(definition));
