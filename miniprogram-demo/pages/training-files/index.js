const t = require('../../core/training');
const store = require('../../core/store');
const documents = require('../../core/documents');
const upload = require('../../core/scheme-upload');
const processing = require('../../core/scheme-processing');
const library = require('../../core/material-library');
const filters = [{ id: 'all', label: '全部' }, { id: 'pending', label: '待整理' }, { id: 'ready', label: '已整理' }, { id: 'removed', label: '已移除' }];
function sizeLabel(size) { return !size ? '' : size < 1048576 ? Math.max(1, Math.round(size / 1024)) + ' KB' : (size / 1048576).toFixed(1) + ' MB'; }
function dateLabel(value) {
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) ? new Date(stamp + 8 * 3600000).toISOString().slice(0, 10) : '';
}
Page({
  spineScreen: 'training-files',
  data: { filters, filter: 'all', query: '', files: [], visibleCount: 0, pendingCount: 0, hiddenCount: 0,
    busy: false, selecting: false, error: '', expandedFile: '', brokenImages: {} },
  onLoad() { this._closed = false; },
  onShow() {
    this._visible = true; store.enter('training-files');
    if (this._unsubscribe) this._unsubscribe();
    this._unsubscribe = processing.subscribe(() => { if (this._visible && !this._closed) this.reload(); });
    this.reload(); this.resumePending();
  },
  onHide() { this._visible = false; if (this._unsubscribe) this._unsubscribe(); this._unsubscribe = null; },
  onUnload() { this._closed = true; this.onHide(); },
  update(values) { if (!this._closed) this.setData(values); },
  reload() {
    if (this._closed) return;
    try {
      const state = t.load(), preferences = library.load(), active = processing.activeIds();
      const all = documents.list('training').slice().reverse().map(doc => {
        const source = doc.duplicateOf || doc.id, actions = state.cards.filter(card => card.sourceSchemeDocument === source && !card.staleSource);
        const working = active.includes(doc.id) || active.includes(source);
        const status = working ? 'processing' : doc.error || doc.status === 'failed' ? 'failed' : doc.autoImportVersion ? 'ready' : 'pending';
        return Object.assign({}, doc, { displayName: preferences.names.files[doc.id] || doc.originalName || '训练方案', hidden: preferences.hidden.files.includes(doc.id),
          processing: working, statusKey: status, statusLabel: status === 'processing' ? '正在整理' : status === 'failed' ? '待重试' : status === 'ready' ? '已整理' : '待整理',
          typeLabel: doc.extension ? doc.extension.toUpperCase() : doc.kind === 'image' ? '图片' : '文件',
          sizeLabel: sizeLabel(doc.size), dateLabel: dateLabel(doc.createdAt), imageBroken: !!this.data.brokenImages[doc.id],
          actions: actions.map(card => ({ id: card.id, name: card.name, dose: t.dose(card), status: card.confirmed ? card.scheduleLabel || '已核对' : '待核对' })),
          actionCount: actions.length, duplicateLabel: doc.duplicateOf ? '重复内容已复用原动作' : '' });
      });
      const query = this.data.query.trim().toLowerCase();
      this._allFiles = all;
      this.update({ busy: active.length > 0, visibleCount: all.filter(file => !file.hidden).length,
        pendingCount: all.filter(file => !file.hidden && file.statusKey !== 'ready').length, hiddenCount: all.filter(file => file.hidden).length,
        files: all.filter(file => (this.data.filter === 'removed' ? file.hidden : !file.hidden && (this.data.filter === 'all' || this.data.filter === 'ready' && file.statusKey === 'ready' || this.data.filter === 'pending' && file.statusKey !== 'ready'))
          && (!query || (file.displayName + ' ' + file.originalName + ' ' + file.typeLabel).toLowerCase().includes(query))) });
    } catch (_) { this.update({ error: '文件列表读取失败，请稍后重试' }); }
  },
  pickFilter(event) { const filter = event.currentTarget.dataset.filter; if (filters.some(item => item.id === filter)) { this.update({ filter }); this.reload(); } },
  inputSearch(event) { this.update({ query: event.detail.value }); this.reload(); },
  clearSearch() { this.update({ query: '' }); this.reload(); },
  async resumePending() {
    if (this._resuming || this.data.selecting) return;
    this._resuming = true;
    try {
      const pending = documents.list('training').filter(doc => !library.isHidden('files', doc.id) && !doc.autoImportVersion && !doc.error && doc.status !== 'failed');
      for (const doc of pending) { if (!this._visible || this._closed) break; await this.processDocument(doc); }
    } catch (_) { this.update({ error: '待整理文件读取失败，请稍后重新进入' });
    } finally { this._resuming = false; }
  },
  async processDocument(document) {
    try {
      const result = await processing.process(document);
      if (this._visible && !this._closed) { this.update({ error: '' }); wx.showToast({ title: '已整理 ' + result.importedCount + ' 个动作', icon: 'none' }); }
      return result;
    } catch (error) { this.update({ error: error.message || '识别未完成，原件已保留，可稍后重试' }); return null; }
    finally { this.reload(); }
  },
  async selectSource(source) {
    if (this.data.selecting || this.data.busy) return;
    this.update({ selecting: true, error: '' });
    try {
      const doc = await upload.choose(source);
      if (doc) {
        this.update({ filter: 'all', query: '' }); this.reload();
        if (!this._closed) await this.processDocument(doc);
      }
    } catch (error) { this.update({ error: error.message || '文件未能保存，请重试' }); }
    finally { this.update({ selecting: false }); this.reload(); }
  },
  photograph() { return this.selectSource('camera'); },
  chooseAlbum() { return this.selectSource('album'); },
  chooseFile() { return this.selectSource('file'); },
  documentFor(event) { const id = event.currentTarget.dataset.id; return documents.list('training').find(doc => doc.id === id); },
  retry(event) { const doc = this.documentFor(event); if (doc && !this.data.busy && !this.data.selecting) return this.processDocument(doc); },
  preview(event) {
    const doc = this.documentFor(event); if (!doc) return;
    const fail = () => this.update({ error: '原件暂时无法打开，请确认文件仍在本机，或重新添加' });
    if (doc.kind === 'image') wx.previewImage({ current: doc.path, urls: [doc.path], fail });
    else if (doc.kind === 'document' && wx.openDocument) wx.openDocument({ filePath: doc.path, fileType: doc.extension, showMenu: true, fail });
    else this.review(event);
  },
  review(event) {
    const doc = this.documentFor(event);
    if (doc) wx.navigateTo({ url: '/pages/scheme/index?id=' + encodeURIComponent(doc.duplicateOf || doc.id) });
  },
  toggleActions(event) { const id = event.currentTarget.dataset.id; this.update({ expandedFile: this.data.expandedFile === id ? '' : id }); },
  openAction(event) {
    const id = event.currentTarget.dataset.card;
    if ((this._allFiles || []).some(file => file.actions.some(action => action.id === id))) wx.navigateTo({ url: '/pages/card/index?id=' + encodeURIComponent(id) });
  },
  imageError(event) { const id = event.currentTarget.dataset.id; this.update({ brokenImages: Object.assign({}, this.data.brokenImages, { [id]: true }) }); this.reload(); },
  rename(event) {
    const doc = this.documentFor(event); if (!doc || this._closed) return;
    wx.showModal({ title: '修改显示名称', editable: true, placeholderText: '填写便于查找的名称', content: library.title('files', doc.id, doc.originalName),
      success: result => {
        if (!result.confirm || this._closed) return;
        try { library.rename('files', doc.id, result.content); this.reload(); } catch (error) { this.update({ error: error.message || '名称保存失败，请重试' }); }
      } });
  },
  remove(event) {
    const doc = this.documentFor(event); if (!doc || this._closed) return;
    if (processing.activeIds().includes(doc.duplicateOf || doc.id)) return this.update({ error: '文件正在整理，请完成后再移除' });
    wx.showModal({ title: '从素材列表移除？', content: '关联动作、计划和历史记录都会保留，可在“已移除”中恢复。', confirmText: '移除',
      success: result => {
        if (!result.confirm || this._closed) return;
        try { library.hide('files', doc.id); this.reload(); } catch (_) { this.update({ error: '移除失败，请稍后重试' }); }
      } });
  },
  restore(event) {
    const doc = this.documentFor(event); if (!doc) return;
    try { library.restore('files', doc.id); this.reload(); wx.showToast({ title: '已恢复到素材列表', icon: 'success' }); }
    catch (_) { this.update({ error: '恢复失败，请稍后重试' }); }
  },
  openPlanning() { wx.switchTab({ url: '/pages/planning/index' }); }
});
