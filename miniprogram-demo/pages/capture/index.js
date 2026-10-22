const t = require('../../core/training');
const taxonomy = require('../../core/exercise-taxonomy');
Page({
  data: { card: '', returnCard: '', drafts: [], busy: false, selecting: false, detailsOpen: false, detailsCard: '', actionName: '', actionNotes: '', detailsError: '', error: '', practice: false, recordingBatchId: '', createdCount: 0 },
  onLoad(query) {
    const card = t.load().cards.find(item => item.id === query.card);
    this.setData({ card: query.card || '', returnCard: query.card || '', returnTo: query.returnTo || '', practice: query.practice === '1',
      recordingBatchId: card ? card.recordingBatchId || 'local-current' : query.batch || t.id('visit') });
    this.reload();
    this.setData({ regionOptions: taxonomy.regions, muscleOptions: taxonomy.muscles, selectedRegions: [], selectedMuscles: [] });
    if (query.video) this.store(decodeURIComponent(query.video));
  },
  reload() {
    this.setData({ drafts: t.load().cards.filter(card => !card.confirmed && (card.recordingBatchId || 'local-current') === this.data.recordingBatchId) });
  },
  record() {
    if (this.data.busy || this.data.selecting) return;
    if (this.data.detailsCard) { this.setData({ detailsOpen: true }); return; }
    this.choose();
  },
  stopTouch() {},
  choose() {
    if (this.data.busy || this.data.selecting || this.data.detailsCard) return;
    this.setData({ selecting: true, error: '' });
    wx.chooseMedia({ count: 1, mediaType: ['video'], sourceType: ['camera'], maxDuration: 300,
      success: result => { const file = result.tempFiles[0]; if (file) this.store(file.tempFilePath); },
      fail: error => { if (!/cancel/.test(error.errMsg)) this.setData({ error: '视频拍摄未完成，请重试。' }); },
      complete: () => this.setData({ selecting: false }) });
  },
  store(path) {
    if (this.data.busy || this.data.detailsCard) return;
    this.setData({ busy: true, error: '' });
    const target = wx.env.USER_DATA_PATH + '/' + t.id('training-video') + '.mp4';
    wx.getFileSystemManager().copyFile({ srcPath: path, destPath: target, success: () => {
      try {
        const existing = t.load().cards.find(card => card.id === this.data.card);
        let saved;
        if (existing) saved = t.saveCard(Object.assign({}, existing, this.data.practice ? { practice: target } : { video: target }), existing.confirmed);
        else saved = t.saveCard({ name: '现场视频 ' + (this.data.createdCount + 1), notes: '', mode: '', sets: '', amount: '',
          video: target, recordingBatchId: this.data.recordingBatchId }, false);
        // A second recording creates another draft rather than replacing the first clip.
        this.setData({ createdCount: this.data.createdCount + 1, card: this.data.practice ? this.data.card : '',
          detailsOpen: true, detailsCard: saved.id, actionName: existing ? saved.name : '', actionNotes: saved.notes || '',
          selectedRegions: saved.regions || [], selectedMuscles: saved.muscles || [],
          regionOptions: taxonomy.regions.map(item => Object.assign({}, item, { checked: (saved.regions || []).includes(item.code) })),
          muscleOptions: taxonomy.muscles.map(item => Object.assign({}, item, { checked: (saved.muscles || []).includes(item.code) })), detailsError: '' });
        this.reload();
      } catch (error) { this.setData({ error: error.message }); }
      this.setData({ busy: false });
    }, fail: () => this.setData({ busy: false, error: '视频持久保存失败，请重试后再离开。' }) });
  },
  inputName(event) { this.setData({ actionName: event.detail.value, detailsError: '' }); },
  inputNotes(event) { this.setData({ actionNotes: event.detail.value, detailsError: '' }); },
  selectRegions(event) { this.setData({ selectedRegions: event.detail.value }); },
  selectMuscles(event) { this.setData({ selectedMuscles: event.detail.value }); },
  saveDetails() { return this.persistDetails(false); },
  saveAndNext() { return this.persistDetails(true); },
  persistDetails(next) {
    if (this.data.busy || this.data.selecting || !this.data.detailsCard) return false;
    const name = this.data.actionName.trim(), notes = this.data.actionNotes.trim();
    if (!name || !notes) { this.setData({ detailsError: '请填写动作名称和动作关键要点。' }); return false; }
    this.setData({ busy: true, detailsError: '' });
    try {
      const card = t.load().cards.find(item => item.id === this.data.detailsCard);
      if (!card) throw Error('本段视频草稿不存在，请重新进入整理。');
      const regions = this.data.selectedRegions || [], muscles = this.data.selectedMuscles || [];
      const unchanged = card.name === name && card.notes === notes && JSON.stringify(card.regions || []) === JSON.stringify(regions) && JSON.stringify(card.muscles || []) === JSON.stringify(muscles);
      t.saveCard(Object.assign({}, card, { name, notes, regions, muscles }), card.confirmed && unchanged);
      this.setData({ detailsOpen: false, detailsCard: '', actionName: '', actionNotes: '', busy: false });
      this.reload();
      if (next) this.record(); else wx.showToast({ title: '本段动作信息已保存', icon: 'success' });
      return true;
    } catch (error) { this.setData({ busy: false, detailsError: error.message }); return false; }
  },
  open(e) { wx.navigateTo({ url: '/pages/card/index?id=' + e.currentTarget.dataset.id }); },
  finish() {
    if (this.data.busy || this.data.selecting) return;
    if (this.data.detailsCard) { this.setData({ detailsOpen: true, detailsError: '请先保存本段动作名称和关键要点。' }); return; }
    if (this.data.returnTo === 'planning') { wx.switchTab({ url: '/pages/planning/index' }); return; }
    if (this.data.returnCard && this.data.createdCount <= 1) { wx.navigateBack(); return; }
    if (this.data.drafts.length) wx.navigateTo({ url: '/pages/card/index?id=' + this.data.drafts[this.data.drafts.length - 1].id });
    else wx.switchTab({ url: '/pages/train/index' });
  },
});
