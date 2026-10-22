const t = require('../../core/training');
const documents = require('../../core/documents');
const recognition = require('../../core/document-recognition');
Page({
  data: { document: null, text: '', busy: false, error: '', rows: [], reviewing: false, checked: false,
    modes: [{ value: '', label: '待核对类型' }, { value: 'count', label: '每组次数' }, { value: 'timer', label: '每组秒数' }, { value: 'breath', label: '每组呼吸次数' }] },
  async onLoad(query) {
    const document = documents.load().find(item => item.id === query.id && item.type === 'training');
    if (!document) { this.setData({ error: '方案单不存在，请返回训练页重新上传。' }); return; }
    this.setData({ document, text: document.text || '', rows: document.planDraftRows || [], reviewing: !!(document.planDraftRows || []).length });
    if (document.kind === 'text' && !document.text) {
      this.setData({ busy: true });
      try {
        const text = await new Promise((resolve, reject) => wx.getFileSystemManager().readFile({ filePath: document.path, encoding: 'utf8',
          success: result => resolve(String(result.data).replace(/^\uFEFF/, '')), fail: () => reject(Error('文件内容读取失败，请重新选择 UTF-8 文本文件。')) }));
        if (text.length > 20000) throw Error('方案文字超过 20000 字，请分成较小的方案单。');
        const saved = documents.save(Object.assign({}, document, { text, status: 'recognized' })); this.setData({ document: saved, text });
      } catch (error) { this.setData({ error: error.message }); }
      finally { this.setData({ busy: false }); }
    }
    if (document.kind === 'document') this.previewFile();
  },
  previewImage() { if (this.data.document) wx.previewImage({ urls: [this.data.document.path] }); },
  previewFile() {
    if (!this.data.document) return;
    if (typeof wx.openDocument !== 'function') { this.setData({ error: '请在微信中打开文件预览，或将方案文字粘贴到下方。' }); return; }
    wx.openDocument({ filePath: this.data.document.path, fileType: this.data.document.extension, showMenu: true,
      fail: () => this.setData({ error: '文件预览暂时无法打开，可重新上传照片，或粘贴方案文字。' }) });
  },
  inputText(event) { this.setData({ text: event.detail.value, rows: [], checked: false, reviewing: false }); },
  async generate() {
    if (this.data.busy || !this.data.document) return;
    this.setData({ busy: true, error: '', checked: false });
    try {
      let text = this.data.text.trim();
      if (!text && this.data.document.kind === 'image') {
        const result = await recognition.recognize(this.data.document.path); text = String(result.text || '').trim(); this.setData({ text });
      }
      if (!text) throw Error('请对照方案单补充或粘贴方案文字，再生成训练计划。');
      const actions = documents.extract(text, 'training').actions;
      if (!actions.length) throw Error('未提取到明确动作，请核对方案文字，或点击“添加动作”逐项填写。');
      const rows = actions.map(action => Object.assign({ groupName: '', sourceDoseText: '' }, action, { id: t.id('scheme-row') }));
      const saved = documents.save(Object.assign({}, this.data.document, { text, status: 'recognized', error: '', planDraftRows: rows }));
      this.setData({ document: saved, rows, reviewing: true });
    } catch (error) { this.setData({ error: error.message, reviewing: true }); }
    finally { this.setData({ busy: false }); }
  },
  inputRow(event) {
    const rows = this.data.rows.map(row => Object.assign({}, row));
    rows[Number(event.currentTarget.dataset.index)][event.currentTarget.dataset.field] = event.detail.value;
    this.setData({ rows, checked: false });
  },
  chooseMode(event) {
    const rows = this.data.rows.map(row => Object.assign({}, row));
    rows[Number(event.currentTarget.dataset.index)].mode = this.data.modes[Number(event.detail.value)].value;
    this.setData({ rows, checked: false });
  },
  addRow() { if (this.data.rows.length < 50) this.setData({ reviewing: true, checked: false, rows: this.data.rows.concat({ id: t.id('scheme-row'), name: '', groupName: '', sourceDoseText: '', sets: '', amount: '', mode: '', notes: '', warnings: [] }) }); },
  removeRow(event) { this.setData({ checked: false, rows: this.data.rows.filter((_, index) => index !== Number(event.currentTarget.dataset.index)) }); },
  toggleCheck() { this.setData({ checked: !this.data.checked }); },
  confirmPlan() {
    if (this.data.busy || !this.data.document) return;
    if (!this.data.checked) { this.setData({ error: '请先对照方案单核对训练要求。' }); return; }
    this.setData({ busy: true, error: '' });
    try {
      const saved = documents.save(Object.assign({}, this.data.document, { text: this.data.text, planDraftRows: this.data.rows }));
      const cards = t.saveSchemeActions(saved.id, this.data.rows);
      this.setData({ document: saved });
      wx.navigateTo({ url: '/pages/plan/index?cards=' + encodeURIComponent(cards.map(card => card.id).join(',')),
        fail: () => this.setData({ error: '计划页面未打开，请重试。' }) });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ busy: false }); }
  },
});
