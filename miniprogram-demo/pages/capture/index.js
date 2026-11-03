const t = require('../../core/training');
const taxonomy = require('../../core/exercise-taxonomy');
const library = require('../../core/material-library');
const store = require('../../core/store');
const filters = [{ id: 'all', name: '全部' }, { id: 'draft', name: '待补充' }, { id: 'linked', name: '已关联' }, { id: 'hidden', name: '已移除' }];
Page({
  spineScreen: 'capture',
  data: { card: '', returnCard: '', returnTo: '', drafts: [], recordings: [], filters, filter: 'all', search: '', totalCount: 0,
    busy: false, selecting: false, pendingSave: false, previewId: '', detailsOpen: false, detailsCard: '', actionName: '', actionNotes: '',
    detailsError: '', error: '', practice: false, recordingBatchId: '', createdCount: 0, taxonomyOpen: false,
    regionOptions: [], muscleOptions: [], selectedRegions: [], selectedMuscles: [] },
  onLoad(query) {
    query = query || {};
    this._unloaded = false;
    this._pendingRecording = null;
    const card = t.load().cards.find(item => item.id === query.card);
    this.setData({ card: query.card || '', returnCard: query.card || '', returnTo: query.returnTo || '', practice: query.practice === '1',
      recordingBatchId: card ? card.recordingBatchId || 'local-current' : query.batch || t.id('visit') });
    this.reload();
    if (query.video) {
      try { this.store(decodeURIComponent(query.video)); }
      catch (error) { this.update({ error: '视频路径无法读取，请重新添加。' }); }
    }
  },
  onShow() { store.enter('capture'); this.reload(); },
  onUnload() { this._unloaded = true; },
  update(patch) { if (!this._unloaded) this.setData(patch); },
  reload() {
    if (this._unloaded) return;
    const state = t.load(), search = this.data.search.trim().toLowerCase();
    const records = state.cards.filter(card => card.video && !card.sourceVideoCardId).map(card => {
      const linked = state.cards.find(item => item.id === card.linkedToActionId) || state.cards.find(item => item.sourceVideoCardId === card.id);
      const inPlan = state.plans.some(plan => (plan.cardIds || []).includes(card.id));
      const associated = !!linked || inPlan, hidden = library.isHidden('recordings', card.id);
      return { id: card.id, title: library.title('recordings', card.id, card.name || '未命名录段'), notes: card.notes || '', video: card.video,
        hidden, associated, pending: !associated && !card.confirmed, targetId: linked ? linked.id : card.id,
        status: hidden ? '已移除' : associated ? '已关联动作' : card.confirmed ? '已核对' : '待补充',
        actionName: linked ? linked.name : inPlan ? '已加入计划' : '', batch: card.recordingBatchId || 'local-current' };
    }).reverse();
    const visible = records.filter(item => (this.data.filter === 'hidden' ? item.hidden : !item.hidden) &&
      (this.data.filter !== 'draft' || item.pending) && (this.data.filter !== 'linked' || item.associated) &&
      (!search || (item.title + ' ' + item.notes + ' ' + item.actionName).toLowerCase().includes(search)));
    this.update({ recordings: visible, totalCount: records.filter(item => !item.hidden).length,
      previewId: visible.some(item => item.id === this.data.previewId) ? this.data.previewId : '',
      drafts: state.cards.filter(card => !card.confirmed && (card.recordingBatchId || 'local-current') === this.data.recordingBatchId) });
  },
  changeFilter(event) { this.update({ filter: event.currentTarget.dataset.id, previewId: '' }); this.reload(); },
  searchInput(event) { this.update({ search: event.detail.value }); this.reload(); },
  preview(event) { const id = event.currentTarget.dataset.id; this.update({ previewId: this.data.previewId === id ? '' : id }); },
  record() { this.startChoice('camera'); },
  fromAlbum() { this.startChoice('album'); },
  startChoice(source) {
    if (this._unloaded || this.data.busy || this.data.selecting) return;
    if (this._pendingRecording) { this.update({ error: '这段视频尚未保存，请先重试保存。' }); return; }
    if (this.data.detailsCard) { this.update({ detailsOpen: true }); return; }
    if (this.data.practice && this.data.createdCount) { this.finish(); return; }
    this.choose(source);
  },
  stopTouch() {},
  choose(source) {
    if (this._unloaded || this.data.busy || this.data.selecting || this.data.detailsCard || this._pendingRecording) return;
    this.update({ selecting: true, error: '' });
    try {
      wx.chooseMedia({ count: 1, mediaType: ['video'], sourceType: [source === 'album' ? 'album' : 'camera'], maxDuration: 300,
        success: result => {
          this.update({ selecting: false });
          const file = (result.tempFiles || [])[0];
          if (file && file.tempFilePath) this.store(file.tempFilePath);
          else this.update({ error: '未读取到视频，请重新添加。' });
        },
        fail: error => { this.update({ selecting: false }); if (!/cancel/i.test(error.errMsg || '')) this.update({ error: '视频添加未完成，请重试。' }); },
        complete: () => this.update({ selecting: false }) });
    } catch (error) { this.update({ selecting: false, error: '无法打开视频选择，请稍后重试。' }); }
  },
  store(path) {
    if (this.data.busy || this.data.detailsCard || this._pendingRecording || !path) return;
    this._pendingRecording = { source: path, target: wx.env.USER_DATA_PATH + '/' + t.id('training-video') + '.mp4',
      id: t.id('card'), existingId: this.data.card, practice: this.data.practice, batch: this.data.recordingBatchId,
      number: this.data.createdCount + 1, copied: false };
    this.retrySave();
  },
  retrySave() {
    const pending = this._pendingRecording;
    if (!pending || pending.saving) return;
    pending.saving = true;
    this.update({ busy: true, error: '' });
    const fail = message => {
      pending.saving = false;
      this.update({ busy: false, pendingSave: true, error: message });
    };
    const save = () => {
      try {
        const existing = t.load().cards.find(card => card.id === pending.existingId);
        let saved;
        if (existing) saved = t.saveCard(Object.assign({}, existing, pending.practice ? { practice: pending.target } : { video: pending.target }), existing.confirmed);
        else saved = t.saveCard({ id: pending.id, name: '现场视频 ' + pending.number, notes: '', mode: '', sets: '', amount: '',
          video: pending.target, recordingBatchId: pending.batch, recordingNamePending: '现场视频 ' + pending.number }, false);
        this._pendingRecording = null;
        this.update({ createdCount: pending.number, card: '', busy: false, pendingSave: false, error: '' });
        if (!this._unloaded) { this.showDetails(saved, !existing); this.reload(); }
      } catch (error) { fail('视频已保留，资料保存未完成。' + (error.message || '') + ' 请重试保存后再离开。'); }
    };
    if (pending.copied) { save(); return; }
    try {
      wx.getFileSystemManager().copyFile({ srcPath: pending.source, destPath: pending.target,
        success: () => { pending.copied = true; save(); },
        fail: () => fail('视频持久保存失败，原视频未删除。请重试保存后再离开。') });
    } catch (error) { fail('视频持久保存失败，原视频未删除。请重试保存后再离开。'); }
  },
  showDetails(card, fresh) {
    const regions = card.regions || [], muscles = card.muscles || [];
    this.update({ detailsOpen: true, detailsCard: card.id, actionName: fresh || card.recordingNamePending === card.name ? '' : card.name,
      actionNotes: card.notes || '', selectedRegions: regions, selectedMuscles: muscles,
      regionOptions: taxonomy.regions.map(item => Object.assign({}, item, { checked: regions.includes(item.code) })),
      muscleOptions: taxonomy.muscles.map(item => Object.assign({}, item, { checked: muscles.includes(item.code) })),
      taxonomyOpen: !!(regions.length || muscles.length), detailsError: '' });
  },
  editDetails(event) {
    if (this.data.busy || this.data.selecting || this._pendingRecording) return;
    const card = t.load().cards.find(item => item.id === event.currentTarget.dataset.id);
    if (card) this.showDetails(card, false);
  },
  inputName(event) { this.update({ actionName: event.detail.value, detailsError: '' }); },
  inputNotes(event) { this.update({ actionNotes: event.detail.value, detailsError: '' }); },
  selectRegions(event) { const values = event.detail.value; this.update({ selectedRegions: values, regionOptions: taxonomy.regions.map(item => Object.assign({}, item, { checked: values.includes(item.code) })) }); },
  selectMuscles(event) { const values = event.detail.value; this.update({ selectedMuscles: values, muscleOptions: taxonomy.muscles.map(item => Object.assign({}, item, { checked: values.includes(item.code) })) }); },
  toggleTaxonomy() { this.update({ taxonomyOpen: !this.data.taxonomyOpen }); },
  saveDraft() { return this.persistDetails(false, true); },
  saveDetails() { return this.persistDetails(false, false); },
  saveAndNext() { return this.persistDetails(!this.data.practice, false); },
  persistDetails(next, partial) {
    if (this._unloaded || this.data.busy || this.data.selecting || !this.data.detailsCard) return false;
    const enteredName = this.data.actionName.trim(), notes = this.data.actionNotes.trim();
    if (!partial && (!enteredName || !notes)) { this.update({ detailsError: '请填写动作名称和动作关键要点。' }); return false; }
    this.update({ busy: true, detailsError: '' });
    try {
      const card = t.load().cards.find(item => item.id === this.data.detailsCard);
      if (!card) throw Error('本段视频草稿不存在，请重新进入整理。');
      const name = enteredName || '未命名录段', regions = this.data.selectedRegions || [], muscles = this.data.selectedMuscles || [];
      const unchanged = card.name === name && card.notes === notes && JSON.stringify(card.regions || []) === JSON.stringify(regions) && JSON.stringify(card.muscles || []) === JSON.stringify(muscles);
      t.saveCard(Object.assign({}, card, { name, notes, regions, muscles, recordingNamePending: enteredName ? '' : name }), card.confirmed && unchanged);
      this.update({ detailsOpen: false, detailsCard: '', actionName: '', actionNotes: '', busy: false });
      this.reload();
      if (next) this.record(); else wx.showToast({ title: partial ? '草稿已保存' : '动作信息已保存', icon: 'success' });
      return true;
    } catch (error) { this.update({ busy: false, detailsError: error.message }); return false; }
  },
  more(event) {
    if (this.data.busy || this.data.selecting || this._pendingRecording) return;
    const id = event.currentTarget.dataset.id, record = this.data.recordings.find(item => item.id === id);
    if (!record) return;
    wx.showActionSheet({ itemList: [record.hidden ? '恢复到素材列表' : '从素材列表移除'], success: result => {
      if (this._unloaded || result.tapIndex !== 0) return;
      if (record.hidden) { this.changeVisibility(id, false); return; }
      wx.showModal({ title: '从素材列表移除？', content: '关联动作、训练计划和历史记录都会保留，可在“已移除”中恢复。', confirmText: '移除',
        success: answer => { if (!this._unloaded && answer.confirm) this.changeVisibility(id, true); } });
    } });
  },
  changeVisibility(id, hidden) {
    try {
      if (hidden) library.hide('recordings', id); else library.restore('recordings', id);
      this.update({ error: '', previewId: '' }); this.reload();
      wx.showToast({ title: hidden ? '已从列表移除' : '已恢复', icon: 'success' });
    } catch (error) { this.update({ error: '整理未保存，请重试。' + (error.message || '') }); }
  },
  open(event) {
    if (this.data.busy || this.data.selecting || this._pendingRecording) return;
    const record = this.data.recordings.find(item => item.id === event.currentTarget.dataset.id);
    wx.navigateTo({ url: '/pages/card/index?id=' + encodeURIComponent(record ? record.targetId : event.currentTarget.dataset.id) });
  },
  finish() {
    if (this.data.busy || this.data.selecting) return;
    if (this._pendingRecording) { this.update({ error: '请先重试保存这段视频，再离开。' }); return; }
    if (this.data.detailsCard) { this.update({ detailsOpen: true, detailsError: '请先保存动作信息，或选择“先存草稿”。' }); return; }
    if (this.data.returnTo === 'planning') { wx.switchTab({ url: '/pages/planning/index' }); return; }
    if (this.data.returnCard && this.data.createdCount <= 1) { wx.navigateBack(); return; }
    if (this.data.drafts.length) wx.navigateTo({ url: '/pages/card/index?id=' + this.data.drafts[this.data.drafts.length - 1].id });
    else wx.switchTab({ url: '/pages/train/index' });
  },
});

