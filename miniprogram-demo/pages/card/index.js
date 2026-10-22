const t = require('../../core/training');
const docs = require('../../core/documents');
const recognition = require('../../core/document-recognition');
const importer = require('../../core/scheme-import');
const blank = () => ({ id: '', name: '', groupName: '', notes: '', sets: '', amount: '', mode: '', checked: false, confirmed: false,
  video: '', practice: '', source: '', sourceText: '', sourceDoseText: '', sourceCandidateId: '', sourceDocumentIds: [], frequencyText: '', warnings: [],
  sourceSchemeDocument: '', sourceSchemeRow: '', sourceVideoCardId: '' });
Page({
  data: Object.assign(blank(), { tab: 'learn', saved: false, manualExpanded: false, contextExpanded: false, error: '', unit: '', history: [],
    recordingBatchId: '', videoOptions: [], videoIndex: 0, videoLabel: '选择现场录段', videoCount: 0,
    documents: [], actionItems: [], actionCount: 0, showRecognizedActions: false, contextText: '', recognizing: false, recognizingLabel: '',
    manualTextOpen: false, activeDocumentTypeLabel: '', documentText: '', documentTextId: '',
    modes: [{ key: 'count', label: '计数' }, { key: 'timer', label: '计时 / 秒' }, { key: 'breath', label: '呼吸次数' }] }),
  onLoad(query) {
    this._closed = false; this._edits = {}; this._candidateMap = {};
    const cards = t.load().cards;
    const card = query.id ? cards.find(item => item.id === query.id) : query.new === '1' ? null
      : cards.filter(item => !item.confirmed && (item.video || item.recordingBatchId)).slice(-1)[0];
    this.loadCard(card);
    if (query.manual === '1') this.setData({ manualExpanded: true });
  },
  loadCard(card) {
    const fields = card ? Object.assign(blank(), card, { checked: !!card.confirmed, sets: String(card.sets || ''), amount: String(card.amount || '') }) : blank();
    const batch = fields.recordingBatchId || (card ? 'local-current' : t.id('visit'));
    this.setData(Object.assign(fields, { recordingBatchId: batch, tab: 'learn', error: '', saved: !!card, unit: t.unit(fields.mode),
      manualExpanded: !!(card && (card.confirmed || card.amount || card.sets)) }));
    if (this._edits[fields.id || 'new']) this.setData(this._edits[fields.id || 'new']);
    this.reloadMaterials(); this.reloadHistory();
  },
  onShow() {
    if (this.data.id) {
      const card = t.load().cards.find(item => item.id === this.data.id);
      if (card) this.setData({ video: card.video || '', practice: card.practice || '' });
    }
    this.reloadMaterials(); this.reloadHistory();
  },
  onUnload() { this._closed = true; },
  reloadMaterials() {
    try {
      const state = t.load(), videos = state.cards.filter(card => card.video && (!card.sourceSchemeDocument || card.id === this.data.id));
      const videoOptions = [{ id: '', name: '稍后选择视频' }].concat(videos);
      const index = videoOptions.findIndex(card => card.id === (this.data.sourceVideoCardId || this.data.id));
      const relevant = docs.load().filter(doc => doc.recordingBatchId === this.data.recordingBatchId
        || (!doc.recordingBatchId && this.data.recordingBatchId === 'local-current') || (this.data.sourceDocumentIds || []).includes(doc.id) || doc.id === this.data.sourceSchemeDocument);
      const documents = relevant.map(doc => Object.assign({}, doc, { typeLabel: doc.type === 'medical' ? '病例单' : '训练方案单',
        statusLabel: doc.id === this._recognizingId ? '正在识别…' : doc.status === 'recognized' ? '文字已整理 · 待核对' : doc.status === 'failed' ? '需要补充' : '原件已保存',
        recognizing: doc.id === this._recognizingId, shortText: (doc.text || '').slice(0, 80) }));
      const candidateMap = {}, byName = {}, contexts = [];
      documents.forEach(doc => {
        if (!doc.text) return;
        const extracted = docs.extract(doc.text, doc.type);
        if (doc.type === 'medical') { if (extracted.context) contexts.push(extracted.context); return; }
        extracted.actions.forEach((action, actionIndex) => {
          const key = action.name.replace(/\s/g, ''), previous = byName[key];
          if (previous) {
            const target = candidateMap[previous];
            ['sets','amount','mode','frequency'].forEach(field => {
              if (action.conflicts && action.conflicts[field]) { target[field] = ''; target.conflicts[field] = true; return; }
              if (target[field] && action[field] && target[field] !== action[field]) {
                target[field] = ''; target.conflicts[field] = true;
                target.warnings.push('不同方案中的' + ({ sets: '组数', amount: '每组完成量', mode: '训练类型', frequency: '频次' })[field] + '不一致，请对照原件确认。');
              } else if (!target[field] && !target.conflicts[field]) target[field] = action[field] || '';
            });
            target.sourceText += '\n' + action.sourceText; target.sourceDocumentIds.push(doc.id);
            target.warnings = target.warnings.concat(action.warnings || []);
          } else {
            const id = doc.id + ':' + encodeURIComponent(key); byName[key] = id;
            candidateMap[id] = Object.assign({}, action, { id, conflicts: Object.assign({}, action.conflicts), sourceDocumentIds: [doc.id], warnings: (action.warnings || []).slice() });
          }
        });
      });
      this._candidateMap = candidateMap;
      const actionItems = Object.keys(candidateMap).map(id => {
        const action = candidateMap[id], matched = state.cards.find(card => card.sourceCandidateId === id);
        const dose = (action.sets ? action.sets + '组' : '组数待补充') + (action.amount ? ' · 每组' + action.amount + (t.unit(action.mode) || '（单位待核对）') : ' · 每组要求待补充');
        return Object.assign({}, action, { dose, matchLabel: matched ? matched.video ? '已对应现场视频' : '已补充动作卡' : '对应当前视频', hasWarnings: !!action.warnings.length });
      });
      this.setData({ videoOptions, videoIndex: index > -1 ? index : 0, videoLabel: index > 0 ? videoOptions[index].name : '选择现场录段',
        videoCount: videos.filter(card => (card.recordingBatchId || 'local-current') === this.data.recordingBatchId).length,
        documents, actionItems, actionCount: actionItems.length, showRecognizedActions: documents.some(doc => doc.type === 'training' && doc.text), contextText: contexts.join('\n\n') });
    } catch (error) { this.setData({ error: error.message }); }
  },
  input(e) { this.setData({ [e.currentTarget.dataset.field]: e.detail.value, checked: false, confirmed: false, saved: false }); },
  mode(e) { this.setData({ mode: e.currentTarget.dataset.mode, unit: t.unit(e.currentTarget.dataset.mode), checked: false, confirmed: false, saved: false }); },
  selectTab(e) { this.setData({ tab: e.currentTarget.dataset.tab }); },
  toggleManual() { this.setData({ manualExpanded: !this.data.manualExpanded }); },
  toggleContext() { this.setData({ contextExpanded: !this.data.contextExpanded }); },
  check() { this.setData({ checked: !this.data.checked }); },
  cacheEdits() {
    const data = this.data, edit = { manualExpanded: data.manualExpanded, unit: data.unit, saved: data.saved };
    Object.keys(blank()).forEach(key => { edit[key] = data[key]; }); this._edits[data.id || 'new'] = edit;
  },
  selectVideo(e) {
    const chosen = this.data.videoOptions[Number(e.detail.value)];
    if (!chosen) return;
    if (this.data.sourceSchemeDocument) {
      if (chosen.id === this.data.id && !this.data.sourceVideoCardId) return;
      try {
        const card = importer.linkVideo(this.data.id, chosen.id === this.data.id ? this.data.sourceVideoCardId : chosen.id);
        this.setData({ video: card.video || '', sourceVideoCardId: card.sourceVideoCardId || '', error: '' });
        this.reloadMaterials();
        wx.showToast({ title: chosen.id ? '已关联动作视频' : '已取消视频关联', icon: 'none' });
      } catch (error) { this.setData({ error: error.message }); }
      return;
    }
    this.cacheEdits(); this.loadCard(t.load().cards.find(card => card.id === chosen.id));
  },
  uploadDocument(e) {
    if (this.data.recognizing) return;
    const type = e.currentTarget.dataset.type; if (!['medical','training'].includes(type)) return;
    if (this.data.documents.length >= 12) { this.setData({ error: '本次资料最多保存12页，请先核对已有资料。' }); return; }
    if (!this.data.id && !this.persist(false, true)) return;
    const batch = this.data.recordingBatchId;
    wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['camera','album'], success: result => {
      const file = result.tempFiles && result.tempFiles[0]; if (!file) return;
      const target = wx.env.USER_DATA_PATH + '/' + t.id(type === 'medical' ? 'medical' : 'training-plan') + (/\.png$/i.test(file.tempFilePath) ? '.png' : '.jpg');
      wx.getFileSystemManager().copyFile({ srcPath: file.tempFilePath, destPath: target, success: () => {
        try { docs.save({ type, path: target, status: 'pending', text: '', recordingBatchId: batch });
          if (!this._closed) { this.reloadMaterials(); wx.showToast({ title: '原件已保存，可继续补充', icon: 'success' }); }
        } catch (error) { if (!this._closed) this.setData({ error: error.message }); }
      }, fail: () => { if (!this._closed) this.setData({ error: '原件保存失败，请重新选择图片。' }); } });
    }, fail: error => { if (!/cancel/.test(error.errMsg || '')) this.setData({ error: '资料未添加，可以重新选择图片。' }); } });
  },
  previewDocument(e) {
    const doc = this.data.documents.find(item => item.id === e.currentTarget.dataset.id);
    if (doc) wx.previewImage({ current: doc.path, urls: this.data.documents.map(item => item.path) });
  },
  async recognizeOne(e) {
    if (this.data.recognizing) return;
    if (this.data.manualTextOpen) { this.setData({ error: '请先保存或取消原文校对，再开始识别。' }); return; }
    const doc = this.data.documents.find(item => item.id === e.currentTarget.dataset.id);
    if (doc) await this.runRecognition([doc]);
  },
  async recognizeDocuments() {
    if (this.data.recognizing) return;
    if (this.data.manualTextOpen) { this.setData({ error: '请先保存或取消原文校对，再开始识别。' }); return; }
    const pending = this.data.documents.filter(doc => !doc.text || doc.status === 'failed');
    if (!pending.length) { this.reloadMaterials(); wx.showToast({ title: '已整理文字，请逐项核对', icon: 'none' }); return; }
    await this.runRecognition(pending);
  },
  async runRecognition(documents) {
    this.setData({ recognizing: true, error: '' }); let successful = 0;
    try {
      for (let index = 0; index < documents.length; index++) {
        const snapshot = documents[index];
        const doc = docs.load().find(item => item.id === snapshot.id);
        // A queued page may have been manually corrected since this batch began.
        if (!doc || doc.text !== snapshot.text || doc.engine !== snapshot.engine) continue;
        this._recognizingId = doc.id;
        if (!this._closed) { this.setData({ recognizingLabel: '正在识别 ' + (index + 1) + ' / ' + documents.length }); this.reloadMaterials(); }
        try {
          const result = await recognition.recognize(doc.path), raw = String(result.text || '').trim();
          const latest = docs.load().find(item => item.id === doc.id);
          if (!latest || latest.text !== doc.text || latest.engine !== doc.engine) continue;
          docs.save(Object.assign({}, doc, { text: raw, status: raw ? 'recognized' : 'failed', engine: result.engine || '',
            error: raw ? '' : '没有识别到清晰文字，可换一张图片或手动校对。' })); if (raw) successful++;
        } catch (error) {
          const latest = docs.load().find(item => item.id === doc.id);
          if (latest && latest.text === doc.text && latest.engine === doc.engine) docs.save(Object.assign({}, latest, { status: 'failed', error: error.message }));
        }
        if (this._closed) break;
      }
    } catch (error) { if (!this._closed) this.setData({ error: error.message }); }
    finally {
      this._recognizingId = '';
      if (!this._closed) { this.setData({ recognizing: false, recognizingLabel: '' }); this.reloadMaterials();
        if (successful) wx.showToast({ title: '文字已识别，请核对并对应视频', icon: 'none' }); }
    }
  },
  editDocumentText(e) {
    if (this.data.recognizing) { wx.showToast({ title: '识别结束后可校对原文', icon: 'none' }); return; }
    const doc = this.data.documents.find(item => item.id === e.currentTarget.dataset.id);
    if (doc) this.setData({ manualTextOpen: true, documentTextId: doc.id, documentText: doc.text || '', activeDocumentTypeLabel: doc.typeLabel });
  },
  inputDocumentText(e) { this.setData({ documentText: e.detail.value }); },
  cancelDocumentText() { this.setData({ manualTextOpen: false, documentTextId: '', documentText: '' }); },
  saveDocumentText() {
    try {
      const doc = docs.load().find(item => item.id === this.data.documentTextId); if (!doc) throw Error('资料不存在，请重新选择原件。');
      if (!this.data.documentText.trim()) throw Error('请填写与原件对应的文字，或返回重新识别。');
      if (this.data.documentText.length > 20000) throw Error('每页校对文字最多20000字。');
      docs.save(Object.assign({}, doc, { text: this.data.documentText.trim(), status: 'recognized', engine: 'manual', error: '' }));
      this.cancelDocumentText(); this.reloadMaterials(); wx.showToast({ title: '校对文字已保存', icon: 'success' });
    } catch (error) { this.setData({ error: error.message }); }
  },
  applyCandidate(e) {
    const action = this._candidateMap[e.currentTarget.dataset.id]; if (!action) return;
    const existing = t.load().cards.find(card => card.sourceCandidateId === action.id && card.id !== this.data.id);
    if (existing) { this.cacheEdits(); this.loadCard(existing); wx.showToast({ title: '已打开这个动作，可继续核对', icon: 'none' }); return; }
    this.setData({ name: action.name, groupName: action.groupName || '', sets: action.sets || '', amount: action.amount || '', mode: action.mode || '', unit: t.unit(action.mode),
      notes: action.notes || '', sourceText: action.sourceText, sourceDoseText: action.sourceDoseText || '', frequencyText: action.frequency || '', warnings: action.warnings || [],
      sourceCandidateId: action.id, sourceDocumentIds: action.sourceDocumentIds, source: '训练方案单（识别后待本人核对）',
      checked: false, confirmed: false, saved: false, manualExpanded: true, error: '' });
  },
  saveDraft() { this.persist(false); },
  saveConfirmed() {
    if (!this.data.checked) { this.setData({ error: '请先对照现场指导和原件核对录入要求，并勾选确认。' }); return; }
    if (!this.data.mode) { this.setData({ error: '原件未明确训练类型，请核对后选择计数、计时或呼吸次数。' }); return; }
    this.persist(true);
  },
  persist(confirm, quiet) {
    try {
      if (confirm && !this.data.name.trim()) throw Error('请核对并填写动作名称。');
      const card = t.saveCard({ id: this.data.id || undefined, name: this.data.name.trim() || '待整理的现场动作', groupName: this.data.groupName.trim(), notes: this.data.notes,
        sets: this.data.sets, amount: this.data.amount, mode: this.data.mode, video: this.data.video, practice: this.data.practice,
        source: this.data.source || '现场指导（手动填写）', recordingBatchId: this.data.recordingBatchId, sourceText: this.data.sourceText, sourceDoseText: this.data.sourceDoseText,
        sourceCandidateId: this.data.sourceCandidateId, sourceDocumentIds: this.data.sourceDocumentIds, frequencyText: this.data.frequencyText, warnings: this.data.warnings,
        sourceSchemeDocument: this.data.sourceSchemeDocument, sourceSchemeRow: this.data.sourceSchemeRow, sourceVideoCardId: this.data.sourceVideoCardId }, confirm);
      this.setData({ id: card.id, confirmed: card.confirmed, checked: card.confirmed, saved: true, error: '' });
      delete this._edits[card.id]; this.reloadMaterials();
      if (!quiet) wx.showToast({ title: confirm ? '已保存并核对' : '草稿已保存', icon: 'success' }); return card;
    } catch (error) { this.setData({ error: error.message }); return null; }
  },
  plan() {
    if (!this.data.confirmed || !this.data.saved && !this.data.checked) { this.setData({ error: '请先保存并核对动作资料。' }); return; }
    wx.navigateTo({ url: '/pages/plan/index?card=' + this.data.id });
  },
  prescription() { this.uploadDocument({ currentTarget: { dataset: { type: 'training' } } }); },
  capture() {
    if (!this.data.id && !this.persist(false, true)) return;
    const query = this.data.video ? 'batch=' + this.data.recordingBatchId : 'card=' + this.data.id;
    wx.navigateTo({ url: '/pages/capture/index?' + query });
  },
  capturePractice() { if (this.data.id) wx.navigateTo({ url: '/pages/capture/index?card=' + this.data.id + '&practice=1' }); },
  reloadHistory() {
    const history = [];
    t.load().sessions.forEach(record => record.rows.filter(row => row.cardId === this.data.id && t.progress(row)).forEach(row => history.push({
      id: record.id, date: record.date, dose: t.dose(row), actual: row.values.map(value => value === null ? '—' : value).join(' / '), unit: t.unit(row.mode) })));
    this.setData({ history: history.reverse() });
  },
});
