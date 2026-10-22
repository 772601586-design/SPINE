const t = require('../../core/training');
const legacy = require('../../core/store');
const documents = require('../../core/documents');
const recognition = require('../../core/document-recognition');
const schemeUpload = require('../../core/scheme-upload');
const importer = require('../../core/scheme-import');
Page({
  data: { plans: [], cards: [], drafts: [], videos: [], files: [], cardGroups: [], totalCards: 0, showSchedules: false,
    error: '', busy: false, schemeBusy: false, schemePicker: false, processingLabel: '' },
  onShow() {
    this._closed = false;
    if (this.getTabBar) wx.nextTick(() => { const bar = this.getTabBar(); if (bar) bar.setData({ selected: 0 }); });
    legacy.enter('planning');
    try {
      t.importAttachmentPlan();
      documents.list('training').filter(doc => doc.autoImportVersion && doc.text && !doc.duplicateOf).forEach(doc => importer.refreshDocument(doc.id));
      importer.reconcileVideos();
      this.reload();
      this.importPendingFiles();
    } catch (error) { this.update({ error: error.message }); }
  },
  onUnload() { this._closed = true; },
  update(values) { if (!this._closed) this.setData(values); },
  reload() {
    const state = t.load(), sources = documents.list('training'), sourceMap = {};
    sources.forEach(doc => { sourceMap[doc.id] = doc; });
    const seenVideos = new Set(), videos = [];
    state.cards.forEach(card => { if (card.video && !seenVideos.has(card.video)) {
      const action = state.cards.find(item => item.id === card.linkedToActionId) || card;
      videos.push({ id: action.id, name: action.name, video: card.video }); seenVideos.add(card.video);
    } });
    const files = sources.slice().reverse().map(doc => {
      const actions = state.cards.filter(card => card.sourceSchemeDocument === (doc.duplicateOf || doc.id));
      const processing = this._processingDocumentId === doc.id;
      return Object.assign({}, doc, { actionCount: actions.length, originalName: doc.originalName || '训练方案单',
        statusLabel: processing ? '正在识别并整理…' : doc.error ? '识别未完成' : doc.duplicateOf ? '相同方案已整理' : actions.length ? '已生成 ' + actions.length + ' 个动作' : doc.text ? '文字已提取' : '已保存，等待识别' });
    });
    const cards = state.cards.filter(card => !card.linkedToActionId), cardGroups = [];
    cards.forEach(card => {
      const groupName = card.groupName || '未分组';
      let group = cardGroups.find(item => item.name === groupName);
      if (!group) { group = { name: groupName, rows: [] }; cardGroups.push(group); }
      const plan = state.plans.find(item => item.active && item.cardIds.includes(card.id));
      const source = sourceMap[card.sourceSchemeDocument];
      const ready = !card.staleSource && card.confirmed && card.sets > 0 && card.amount > 0 && !!t.unit(card.mode);
      group.rows.push(Object.assign({}, card, { ready, dose: t.dose(card),
        sourceLabel: source ? source.originalName || '训练方案单' : card.video ? '现场录制' : card.source || '手动整理',
        scheduleLabel: plan ? plan.onlyDate || t.scheduleLabel(plan) : card.scheduleLabel || '待安排',
        statusLabel: card.staleSource ? '原件已更新，待核对' : !ready ? '要求待补充' : plan ? '已安排训练' : '待安排训练' }));
    });
    const plans = state.plans.map(plan => Object.assign({}, plan, { scheduleSummary: plan.onlyDate || t.scheduleLabel(plan), actionCount: plan.cardIds.length }));
    this.update({ plans, cards, drafts: cards.filter(card => !card.confirmed), videos, files, cardGroups, totalCards: cards.length });
  },
  async importPendingFiles() {
    if (this.data.busy || this._closed) return;
    const pending = documents.list('training').filter(doc => !doc.autoImportVersion && !doc.error && doc.status !== 'failed');
    for (const doc of pending) { if (this._closed || this.data.busy) break; await this.processDocument(doc); }
  },
  async processDocument(document) {
    if (this.data.busy) return null;
    this._processingDocumentId = document.id;
    this.update({ busy: true, schemeBusy: true, processingLabel: '正在读取文件并生成动作卡…', error: '' });
    this.reload();
    try {
      const result = document.text ? { text: document.text, engine: document.engine || 'saved-text' }
        : await recognition.recognizeFile(Object.assign({}, document, { name: document.originalName }));
      const latest = documents.load().find(item => item.id === document.id);
      if (!latest) throw Error('文件已移除，请重新上传。');
      const text = latest.text && latest.text !== document.text ? latest.text : String(result.text || '').trim();
      if (!text) throw Error('文件中没有识别到动作文字，请查看原件后重试。');
      const saved = documents.save(Object.assign({}, latest, { text, engine: result.engine || '', status: 'recognized', error: '' }));
      const canonicalText = value => String(value || '').replace(/\r\n?/g, '\n').trim();
      const duplicate = documents.list('training').find(doc => doc.id !== saved.id && !doc.duplicateOf && doc.autoImportVersion
        && doc.originalName === saved.originalName && (doc.trainingStartDate || '') === (saved.trainingStartDate || '')
        && canonicalText(doc.text) === canonicalText(saved.text));
      const imported = importer.importDocument(duplicate || saved);
      if (!imported.importedCount) throw Error('未提取到明确动作，可核对文件文字后重新整理。');
      const planDraftRows = imported.cards.map(card => ({ id: card.sourceSchemeRow, name: card.name, groupName: card.groupName,
        sets: card.sets || '', amount: card.amount || '', mode: card.mode, notes: card.notes, frequency: card.frequencyText,
        sourceText: card.sourceText, sourceDoseText: card.sourceDoseText, warnings: card.warnings || [] }));
      documents.save(Object.assign({}, saved, { autoImportVersion: 1, duplicateOf: duplicate ? duplicate.id : '', planDraftRows, importedCardCount: imported.importedCount,
        scheduledCount: imported.scheduledCount, pendingCount: imported.pendingCount, importedAt: new Date().toISOString() }));
      importer.reconcileVideos();
      if (!this._closed) wx.showToast({ title: '已整理 ' + imported.importedCount + ' 个动作', icon: 'none' });
      return imported;
    } catch (error) {
      const latest = documents.load().find(item => item.id === document.id);
      if (latest) { try { documents.save(Object.assign({}, latest, { status: 'failed', error: error.message || '文件识别未完成' })); } catch (_) {} }
      this.update({ error: error.message || '文件识别未完成，可在文件列表重试。' });
      return null;
    } finally {
      this._processingDocumentId = '';
      this.update({ busy: false, schemeBusy: false, processingLabel: '' });
      this.reload();
    }
  },
  capture() {
    if (this._capturing || this.data.busy) return;
    this._capturing = true;
    wx.chooseMedia({ count: 1, mediaType: ['video'], sourceType: ['camera'], maxDuration: 300,
      success: result => { const file = result.tempFiles[0]; if (file) wx.navigateTo({ url: '/pages/capture/index?video=' + encodeURIComponent(file.tempFilePath) + '&returnTo=planning' }); },
      fail: error => { if (!/cancel/.test(error.errMsg || '')) this.update({ error: '视频拍摄未完成，请重试。' }); },
      complete: () => { this._capturing = false; } });
  },
  createCard() { wx.navigateTo({ url: '/pages/card/index?new=1&manual=1' }); },
  uploadScheme() { return this.chooseSchemeFile(); },
  closeSchemePicker() { this.update({ schemePicker: false }); },
  stopTouch() {},
  photographScheme() { return this.selectScheme('camera'); },
  chooseSchemeFile() { return this.selectScheme('file'); },
  async selectScheme(source) {
    if (this.data.busy || this._choosing) return;
    this._choosing = true;
    this.update({ error: '' });
    try {
      const document = await schemeUpload.choose(source);
      if (document) { this.reload(); await this.processDocument(document); }
    } catch (error) { this.update({ error: error.message }); }
    finally { this._choosing = false; }
  },
  retryImport(event) {
    const document = documents.load().find(item => item.id === event.currentTarget.dataset.id);
    if (document) return this.processDocument(document);
  },
  openFile(event) {
    const document = documents.load().find(item => item.id === event.currentTarget.dataset.id);
    if (!document) return;
    if (document.kind === 'image') wx.previewImage({ current: document.path, urls: [document.path] });
    else if (document.kind === 'document' && typeof wx.openDocument === 'function') wx.openDocument({ filePath: document.path, fileType: document.extension, showMenu: true, fail: () => this.update({ error: '原件暂时无法打开，请稍后重试。' }) });
    else this.editFile(event);
  },
  openVideo(event) { this.openCard(event); },
  editFile(event) {
    const document = documents.load().find(item => item.id === event.currentTarget.dataset.id);
    if (document) wx.navigateTo({ url: '/pages/scheme/index?id=' + (document.duplicateOf || document.id) });
  },
  openCard(event) { wx.navigateTo({ url: '/pages/card/index?id=' + event.currentTarget.dataset.id }); },
  openDrafts() { if (this.data.drafts.length) this.openCard({ currentTarget: { dataset: { id: this.data.drafts[0].id } } }); else this.createCard(); },
  createPlan() { wx.navigateTo({ url: '/pages/plan/index' }); },
  openPlan(event) { this.update({ showSchedules: false }); wx.navigateTo({ url: '/pages/plan/index?id=' + event.currentTarget.dataset.id }); },
  openSchedule() { if (!this.data.plans.length) this.createPlan(); else this.update({ showSchedules: !this.data.showSchedules }); },
});
