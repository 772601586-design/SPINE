const t = require('../../core/training');
const voice = require('../../core/voice');

function ready(row) {
  return row && row.confirmed !== false && Number.isInteger(row.sets) && row.sets > 0
    && Number.isInteger(row.amount) && row.amount > 0 && ['timer', 'count', 'breath'].includes(row.mode);
}

Page({
  data: {
    session: '', card: '', selected: null, index: 0, value: 0, running: false,
    finished: false, hasStarted: false, trainingStarted: false, seconds: '3', error: '', progress: 0, voiceOn: true,
    celebrating: false, saving: false, navTop: 0, navHeight: 44,
    confetti: Array.from({ length: 12 }, (_, i) => ({ x: Math.round(Math.cos(i * Math.PI / 6) * 130), y: Math.round(Math.sin(i * Math.PI / 6) * 110), angle: i * 45, color: ['#79b9a8', '#e9bf76', '#bad6cd'][i % 3] })),
    actionGroups: [], actionNumber: 0, actionTotal: 0, completedActions: 0, currentDone: false,
  },
  onLoad(query) {
    this.configureNavigation();
    this.setData({ session: query.session || '', card: query.card || '' });
    this.reload();
  },
  configureNavigation() {
    try {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync ? wx.getSystemInfoSync() : {};
      const top = info.statusBarHeight || 0;
      const menu = wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect();
      this.setData({ navTop: top, navHeight: menu && menu.height > 0 ? Math.max(44, (menu.top - top) * 2 + menu.height) : 44 });
    } catch (_) { /* 默认导航高度可用于浏览器预览 */ }
  },
  setExitGuard(enabled) {
    try {
      if (enabled && wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({ message: '确认要离开吗？', fail() {} });
      else if (!enabled && wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload({ fail() {} });
    } catch (_) { /* 自定义退出按钮始终使用确认框 */ }
  },
  onShow() {
    this.setExitGuard(!this.data.celebrating);
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
    const index = row.values.slice(0, row.sets).findIndex((value, i) => (value === null || value < row.amount) && !(row.guidedSets || [])[i]);
    this.setData({
      selected: Object.assign({}, row, {
        unit: t.unit(row.mode), dose: t.dose(row),
        groups: Array.from({ length: row.totalOnly ? 0 : row.sets }, (_, setIndex) => setIndex),
      }),
      index: index < 0 ? row.sets - 1 : index, hasStarted: false, trainingStarted: false, running: false,
      value: row.mode === 'timer' ? row.amount : 0, progress: 0, finished: false, error: '',
    });
    this.elapsed = 0;
    this.syncChecklist(record);
  },
  inputSeconds(e) { this.pause(); this.elapsed = 0; this.setData({ seconds: e.detail.value, value: 0, progress: 0, finished: false, hasStarted: false }); },
  toggleVoice() { this.setData({ voiceOn: !this.data.voiceOn }); if (!this.data.voiceOn) voice.stop(); },
  selectGroup(e) {
    this.pause();
    const index = Number(e.currentTarget.dataset.index);
    if (!Number.isInteger(index) || !this.data.selected || index < 0 || index >= this.data.selected.sets) return;
    this.elapsed = 0;
    this.setData({ index, value: this.data.selected.mode === 'timer' ? this.data.selected.amount : 0, progress: 0, finished: false, hasStarted: false });
    this.syncChecklist();
  },
  togglePlayback() { if (this.data.running) this.pause(); else this.start(); },
  start() {
    const row = this.data.selected;
    if (!row || this.data.running || this.data.celebrating || this.data.saving || this._exitPending) return;
    if (!ready(row)) { this.setData({ error: '请先核对并确认当前动作要求。' }); return; }
    const step = Number(this.data.seconds);
    if (row.mode !== 'timer' && (!Number.isFinite(step) || step < 1 || step > 60)) {
      this.setData({ error: '每次节奏请设置 1～60 秒。' }); return;
    }
    if (this.data.finished) { this.elapsed = 0; this.setData({ finished: false, progress: 0, value: row.mode === 'timer' ? row.amount : 0 }); }
    this.started = Date.now();
    if (this.data.voiceOn) voice.speak('begin');
    this.setData({ running: true, hasStarted: true, trainingStarted: true, error: '' });
    this.timer = setInterval(() => this.tick(), 200);
  },
  tick() {
    if (!this.data.running || !this.data.selected) return;
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
        } catch (error) { this.setData({ error: error.message || '记录保存失败，请重试' }); return; }
      }
      if (this.data.voiceOn) voice.speak('done');
      wx.showToast({ title: '本组节奏结束', icon: 'none' });
    }
  },
  pause() {
    if (this.data.running) this.elapsed += Math.max(0, Date.now() - this.started);
    clearInterval(this.timer);
    voice.stop();
    this.setData({ running: false });
  },
  completeExercise() {
    if (!this.data.selected || !this.data.trainingStarted || this.data.saving || this.data.celebrating || this._exitPending) return;
    this.pause();
    this.setData({ saving: true, error: '' });
    try {
      const record = t.load().sessions.find(item => item.id === this.data.session);
      const row = record && record.rows.find(item => item.cardId === this.data.card);
      if (!ready(row)) throw Error('当前动作要求已变化，请返回训练页重新确认。');
      // “完成”是用户确认整项动作已按计划完成；额外手动记录的组保留。
      const values = Array.from({ length: Math.max(row.sets, row.values.length) }, (_, i) => i < row.sets ? row.amount : row.values[i]);
      const saved = t.saveValues(this.data.session, this.data.card, values);
      this.syncChecklist(saved);
      this.setData({ saving: false, celebrating: true });
      this.setExitGuard(false);
    } catch (error) {
      this.setData({ saving: false, error: error.message || '保存失败，请重试' });
    }
  },
  requestExit() {
    if (this._exitPending || this.data.saving) return;
    if (this.data.celebrating) return this.leave();
    this.pause();
    this._exitPending = true;
    wx.showModal({
      title: '确认要离开吗？', content: '', confirmText: '确认离开', cancelText: '继续训练',
      success: result => { this._exitPending = false; if (result.confirm && !this._unloaded) this.leave(); },
      fail: () => { this._exitPending = false; }
    });
  },
  leave() {
    this.pause();
    this.setExitGuard(false);
    const failed = () => {
      if (!this._unloaded) { this.setData({ error: '暂时无法返回，请再试一次' }); this.setExitGuard(!this.data.celebrating); }
    };
    if (typeof getCurrentPages === 'function' && getCurrentPages().length > 1) wx.navigateBack({ fail: failed });
    else wx.switchTab({ url: '/pages/train/index', fail: failed });
  },
  returnToTraining() {
    this.pause();
    this.setExitGuard(false);
    wx.switchTab({ url: '/pages/train/index', fail: () => { if (!this._unloaded) this.setData({ error: '暂时无法返回，请再试一次' }); } });
  },
  onHide() { this.pause(); },
  onUnload() { this.pause(); this._unloaded = true; this.setExitGuard(false); },
});
