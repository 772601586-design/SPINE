const t = require('../../core/training');
const voice = require('../../core/voice');

function ready(row) {
  return row && row.confirmed !== false && Number.isInteger(row.sets) && row.sets > 0
    && Number.isInteger(row.amount) && row.amount > 0 && ['timer', 'count', 'breath'].includes(row.mode);
}

Page({
  data: {
    session: '', card: '', selected: null, index: 0, value: 0, running: false,
    finished: false, seconds: '3', error: '', actual: '', progress: 0, voiceOn: true,
    actionGroups: [], actionNumber: 0, actionTotal: 0, completedActions: 0, currentDone: false,
  },
  onLoad(query) {
    this.setData({ session: query.session || '', card: query.card || '' });
    this.reload();
  },
  onShow() {
    let record = t.load().sessions.find(item => item.id === this.data.session);
    if (!record) return;
    if (record.rows.some(row => row.confirmed === false) && typeof t.session === 'function') {
      try { record = t.session(record.planId, record.date, false); }
      catch (error) { this.setData({ error: error.message }); }
    }
    if (!this.data.selected) this.reload();
    else this.syncChecklist(record);
  },
  syncChecklist(record) {
    record = record || t.load().sessions.find(item => item.id === this.data.session);
    if (!record) return;
    const groups = [];
    let completedActions = 0;
    record.rows.forEach((row, index) => {
      const isReady = ready(row);
      const actualDone = isReady && t.complete(row);
      const guidedDone = isReady && typeof t.guidedComplete === 'function' && t.guidedComplete(row);
      const done = actualDone || guidedDone;
      const groupName = row.groupName || '未分组';
      let group = groups.find(item => item.name === groupName);
      if (!group) { group = { name: groupName, rows: [] }; groups.push(group); }
      if (done) completedActions += 1;
      const guidedSets = row.guidedSets || [];
      group.rows.push({
        cardId: row.cardId, name: row.name,
        dose: isReady ? t.dose(row) : row.sourceDoseText || '组数、次数或时间待核对',
        number: index + 1, done, actualDone, guidedDone, current: row.cardId === this.data.card,
        stateText: !isReady ? '要求待核对' : actualDone ? '实际量已确认'
          : guidedDone ? '跟练已结束 · 实际量待确认' : row.cardId === this.data.card ? '当前动作' : '待跟练',
        sets: Array.from({ length: isReady ? row.sets : 0 }, (_, setIndex) => ({
          number: setIndex + 1, label: row.totalOnly ? '单次练习' : '第 ' + (setIndex + 1) + ' 组',
          done: guidedSets[setIndex] === true || (typeof row.values[setIndex] === 'number' && row.values[setIndex] >= row.amount),
          current: row.cardId === this.data.card && setIndex === this.data.index,
        })),
      });
    });
    this.setData({
      actionGroups: groups,
      actionNumber: record.rows.findIndex(row => row.cardId === this.data.card) + 1,
      actionTotal: record.rows.length, completedActions,
      currentDone: groups.some(group => group.rows.some(row => row.current && row.done)),
    });
  },
  reload() {
    const record = t.load().sessions.find(item => item.id === this.data.session);
    const row = record && record.rows.find(item => item.cardId === this.data.card);
    if (!row) { this.setData({ selected: null, error: '请从训练首页选择已确认的计划进入跟练。' }); return; }
    if (!ready(row)) {
      this.setData({ selected: null, error: '当前动作要求待核对，请先补齐并确认组数、次数或时间。' });
      this.syncChecklist(record); return;
    }
    const index = row.values.slice(0, row.sets).findIndex(value => value === null || value < row.amount);
    this.setData({
      selected: Object.assign({}, row, {
        unit: t.unit(row.mode), dose: t.dose(row),
        groups: Array.from({ length: row.totalOnly ? 0 : row.sets }, (_, setIndex) => setIndex),
      }),
      index: index < 0 ? row.sets - 1 : index, actual: '',
      value: row.mode === 'timer' ? row.amount : 0, progress: 0, finished: false, error: '',
    });
    this.elapsed = 0;
    this.syncChecklist(record);
  },
  inputSeconds(e) { this.pause(); this.elapsed = 0; this.setData({ seconds: e.detail.value, value: 0, progress: 0 }); },
  toggleVoice() { this.setData({ voiceOn: !this.data.voiceOn }); if (!this.data.voiceOn) voice.stop(); },
  selectGroup(e) {
    this.pause();
    const index = Number(e.currentTarget.dataset.index);
    if (!Number.isInteger(index) || !this.data.selected || index < 0 || index >= this.data.selected.sets) return;
    this.elapsed = 0;
    this.setData({ index, value: this.data.selected.mode === 'timer' ? this.data.selected.amount : 0, progress: 0, finished: false, actual: '' });
    this.syncChecklist();
  },
  selectAction(e) {
    const cardId = e.currentTarget.dataset.cardId;
    const record = t.load().sessions.find(item => item.id === this.data.session);
    const row = record && record.rows.find(item => item.cardId === cardId);
    if (!row) return;
    if (!ready(row)) { this.pause(); wx.navigateTo({ url: '/pages/card/index?id=' + row.cardId }); return; }
    if (cardId === this.data.card) return;
    this.pause();
    this.setData({ card: cardId });
    this.reload();
  },
  inputActual(e) { this.setData({ actual: e.detail.value }); },
  start() {
    const row = this.data.selected;
    if (!row || this.data.running) return;
    if (!ready(row)) { this.setData({ error: '请先核对并确认当前动作要求。' }); return; }
    const step = Number(this.data.seconds);
    if (row.mode !== 'timer' && (!Number.isFinite(step) || step < 1 || step > 60)) {
      this.setData({ error: '每次节奏请设置 1～60 秒。' }); return;
    }
    if (this.data.finished) { this.elapsed = 0; this.setData({ finished: false }); }
    this.started = Date.now();
    if (this.data.voiceOn) voice.speak('begin');
    this.setData({ running: true, error: '' });
    this.timer = setInterval(() => this.tick(), 200);
  },
  tick() {
    const row = this.data.selected;
    const elapsed = (this.elapsed + Date.now() - this.started) / 1000;
    const duration = row.mode === 'timer' ? row.amount : row.amount * Number(this.data.seconds);
    const value = row.mode === 'timer' ? Math.max(0, Math.ceil(row.amount - elapsed))
      : Math.min(row.amount, Math.floor(elapsed / Number(this.data.seconds)));
    const finished = elapsed >= duration;
    if (value !== this.data.value && this.data.voiceOn && (row.mode !== 'timer' || value <= 5) && !finished) voice.speak(value);
    this.setData({ value, progress: Math.min(100, Math.round(elapsed / duration * 100)), finished });
    if (finished) {
      this.pause();
      if (typeof t.saveGuidedSet === 'function') {
        try {
          const record = t.saveGuidedSet(this.data.session, this.data.card, this.data.index);
          this.syncChecklist(record);
        } catch (error) { this.setData({ error: error.message }); }
      }
      if (this.data.voiceOn) voice.speak('done');
      wx.showToast({ title: '节奏结束，请确认实际完成量', icon: 'none' });
    }
  },
  pause() {
    if (this.data.running) this.elapsed += Math.max(0, Date.now() - this.started);
    clearInterval(this.timer);
    voice.stop();
    this.setData({ running: false });
  },
  confirm() {
    this.pause();
    try {
      if (!this.data.actual.trim()) throw Error('请填写实际完成量，未完成可去手动记录。');
      t.saveSet(this.data.session, this.data.card, this.data.index, Number(this.data.actual));
      this.reload();
      wx.showToast({ title: '实际量已保存', icon: 'success' });
    } catch (error) { this.setData({ error: error.message }); }
  },
  manual() {
    this.pause();
    wx.redirectTo({ url: '/pages/execution/index?session=' + this.data.session + '&card=' + this.data.card });
  },
  next() {
    this.pause();
    const record = t.load().sessions.find(item => item.id === this.data.session);
    if (!record) { this.reload(); return; }
    const index = record.rows.findIndex(row => row.cardId === this.data.card);
    const next = record.rows.slice(index + 1).find(ready);
    if (next) { this.setData({ card: next.cardId }); this.reload(); }
    else this.manual();
  },
  onHide() { this.pause(); },
  onUnload() { this.pause(); },
});
