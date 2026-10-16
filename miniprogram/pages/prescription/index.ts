import { api } from '../../services/api';
import { request } from '../../services/request';
import { requestId } from '../../services/life';
import { requireOnboarded } from '../../services/session';
import type { PersonalActionCard } from '../../models/types';
import { uploadPrivateFile } from '../../services/upload';

interface Row { card_id: number | null; expected_revision?: number; name: string; sets: string; reps_per_set: string; breaths_per_set: string; hold_seconds: string; schedule_frequency: string; side: string; personal_notes: string }
function emptyRow(): Row { return { card_id: null, name: '', sets: '', reps_per_set: '', breaths_per_set: '', hold_seconds: '', schedule_frequency: '', side: '', personal_notes: '' }; }
Page({
  data: { loading: true, busy: false, error: '', rows: [emptyRow()] as Row[], cards: [] as PersonalActionCard[],
    preview: false, saved: false, recognizing: false, ocrText: '', changes: [] as Array<{ name: string; before: string; after: string }>,
    sides: [{ value: '', label: '待核对方向' }, { value: 'left', label: '左侧' }, { value: 'right', label: '右侧' },
      { value: 'bilateral', label: '双侧' }, { value: 'not_applicable', label: '不适用' }, { value: 'individualized', label: '个体方向' }],
    frequencies: [{ value: '', label: '暂不排入今日' }, { value: 'daily', label: '每天' }, { value: 'alternate', label: '隔天' }] },
  async onLoad() {
    if (!await requireOnboarded()) return;
    try { const plan = await api.trainingPlan(); this.setData({ cards: plan?.cards || [] }); }
    catch (error) { this.fail(error); }
    finally { this.setData({ loading: false }); }
  },
  fail(error: unknown) { this.setData({ error: error instanceof Error ? error.message : '操作失败' }); },
  choosePrescription() {
    if (this.data.busy || this.data.recognizing) return;
    wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'], success: async result => {
      const file = result.tempFiles[0];
      if (!file) return;
      this.setData({ recognizing: true, error: '', preview: false });
      try {
        const attachment = await uploadPrivateFile('medical', { path: file.tempFilePath,
          name: file.tempFilePath.split('/').pop() || 'prescription.jpg', size: file.size });
        const recognized = await request<{ text: string; candidates: Array<{ name: string; sets?: number; reps_per_set?: number; breaths_per_set?: number; hold_seconds?: number }> }>('POST', '/api/v1/life/ocr/', { attachment: attachment.id }, { timeout: 60000 });
        this.setData({ ocrText: recognized.text, rows: recognized.candidates.length ? recognized.candidates.map(candidate => ({ ...emptyRow(), name: candidate.name,
          sets: String(candidate.sets || ''), reps_per_set: String(candidate.reps_per_set || ''),
          breaths_per_set: String(candidate.breaths_per_set || ''), hold_seconds: String(candidate.hold_seconds || '') })) : this.data.rows });
      } catch (error) { this.fail(error); }
      finally { this.setData({ recognizing: false }); }
    } });
  },
  inputOCR(event: { detail: { value: string } }) { this.setData({ ocrText: event.detail.value }); },
  input(event: { currentTarget: { dataset: { index: number; field: string } }; detail: { value: string } }) {
    this.setData({ [`rows[${event.currentTarget.dataset.index}].${event.currentTarget.dataset.field}`]: event.detail.value, preview: false });
  },
  addRow() { if (this.data.rows.length < 50) this.setData({ rows: [...this.data.rows, emptyRow()], preview: false }); },
  removeRow(event: { currentTarget: { dataset: { index: number } } }) {
    this.setData({ rows: this.data.rows.filter((_, index) => index !== Number(event.currentTarget.dataset.index)), preview: false });
  },
  loadCard(event: { detail: { value: string } }) {
    const card = this.data.cards[Number(event.detail.value)];
    if (!card || this.data.rows.some(row => row.card_id === card.id)) return;
    this.setData({ rows: [...this.data.rows.filter(row => row.name.trim()), { card_id: card.id, expected_revision: card.revision, name: card.name,
      sets: String(card.sets || ''), reps_per_set: String(card.reps_per_set || ''), breaths_per_set: String(card.breaths_per_set || ''),
      hold_seconds: String(card.hold_seconds || ''), side: card.side, personal_notes: card.personal_notes, schedule_frequency: card.schedule_frequency }], preview: false });
  },
  choose(event: { currentTarget: { dataset: { index: number; field: 'side' | 'schedule_frequency' } }; detail: { value: string } }) {
    const field = event.currentTarget.dataset.field;
    const options = field === 'side' ? this.data.sides : this.data.frequencies;
    this.setData({ [`rows[${event.currentTarget.dataset.index}].${field}`]: options[Number(event.detail.value)].value, preview: false });
  },
  describe(row: { sets?: unknown; reps_per_set?: unknown; breaths_per_set?: unknown; hold_seconds?: unknown }): string {
    return `${row.sets || '待填'} 组 / ${row.reps_per_set || '—'} 次 / ${row.breaths_per_set || '—'} 呼吸 / ${row.hold_seconds || '—'} 秒`;
  },
  showPreview() {
    if (!this.data.rows.length || this.data.rows.some(row => !row.name.trim())) { this.setData({ error: '请填写每个动作的名称。' }); return; }
    this.setData({ error: '', preview: true, changes: this.data.rows.map(row => {
      const previous = this.data.cards.find(card => card.id === row.card_id);
      return { name: row.name, before: previous ? this.describe(previous) : '新增动作', after: this.describe(row) };
    }) });
  },
  async save() {
    if (!this.data.preview || this.data.busy || this.data.saved) return;
    const rows = this.data.rows.map(row => ({ ...row, name: row.name.trim(), sets: row.sets ? Number(row.sets) : null,
      reps_per_set: row.reps_per_set ? Number(row.reps_per_set) : null, breaths_per_set: row.breaths_per_set ? Number(row.breaths_per_set) : null,
      hold_seconds: row.hold_seconds ? Number(row.hold_seconds) : null }));
    const signature = JSON.stringify(rows);
    if (this._signature !== signature) { this._signature = signature; this._requestId = requestId(); }
    this.setData({ busy: true, error: '' });
    try {
      await request('POST', '/api/v1/life/prescriptions/', { request_id: this._requestId, rows });
      this.setData({ saved: true });
    } catch (error) { this.fail(error); }
    finally { this.setData({ busy: false }); }
  },
  openTraining() { wx.switchTab({ url: '/pages/rehab/activity/index' }); },
});
