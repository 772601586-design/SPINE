const t = require('../../core/training');
Page({
  data: { session: '', card: '', date: t.today(), backfill: false, planIndex: 0, plans: [], rows: [], selected: null, values: [], notes: '', error: '', saving: false, statusText: '' },
  onLoad(query) { this.setData({ session: query.session || '', card: query.card || '', date: query.date || t.today(), backfill: query.backfill === '1', plans: t.load().plans.filter(plan => plan.active) }); this.reload(); },
  reload() { const record = t.load().sessions.find(item => item.id === this.data.session); if (!record) return; const selected = record.rows.find(row => row.cardId === this.data.card) || record.rows[0]; this.setData({ date: record.date, rows: record.rows, card: selected.cardId, selected: Object.assign({}, selected, { dose: t.dose(selected), unit: t.unit(selected.mode) }), values: selected.values.map((value,index) => ({ index, value: value === null ? '' : String(value) })), notes: selected.feeling || '', statusText: t.complete(selected) ? '全部完成' : t.progress(selected) ? '部分完成' : selected.values.some(value => value !== null) ? '未完成' : '未记录' }); },
  chooseDate(e) { this.setData({ date: e.detail.value }); },
  choosePlan(e) { this.setData({ planIndex: Number(e.detail.value) }); },
  begin() { try { const plan = this.data.plans[this.data.planIndex]; if (!plan) throw Error('请先创建并核对训练计划。'); const record = t.session(plan.id, this.data.date, true); this.setData({ session: record.id }); this.reload(); } catch (error) { this.setData({ error: error.message }); } },
  selectRow(e) { this.setData({ card: e.currentTarget.dataset.id }); this.reload(); },
  input(e) { const values = this.data.values.slice(); values[Number(e.currentTarget.dataset.index)].value = e.detail.value; this.setData({ values }); },
  inputNotes(e) { this.setData({ notes: e.detail.value }); },
  addGroup() { if (this.data.values.length < 100) this.setData({ values: this.data.values.concat({ index: this.data.values.length, value: '' }) }); },
  fillAll() { this.setData({ values: this.data.values.map(row => ({ index: row.index, value: row.index < this.data.selected.sets ? String(this.data.selected.amount) : row.value })) }); },
  save() { this.persist(false); },
  continueTraining() { this.persist(true); },
  persist(follow) {
    if (this.data.saving || !this.data.selected) return;
    try { this.setData({ saving: true }); const record = t.saveValues(this.data.session, this.data.card, this.data.values.map(row => row.value), this.data.notes); this.setData({ error: '', saving: false }); this.reload(); wx.showToast({ title: '实际完成量已保存', icon: 'success' }); if (follow) { const next = record.rows.find(row => !t.complete(row)) || record.rows[0]; wx.redirectTo({ url: '/pages/follow/index?session=' + record.id + '&card=' + next.cardId }); } }
    catch (error) { this.setData({ saving: false, error: error.message }); }
  },
});
