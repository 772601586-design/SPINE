import type { Brace, WearSession } from '../../models/types';
import { api } from '../../services/api';
import { requireSession } from '../../services/session';

function localInput(value?: string | null): string {
  if (!value) return '';
  return new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
}
function toServer(value: string): string {
  const text = value.trim().replace(' ', 'T');
  const zoned = /(Z|[+-]\d\d:\d\d)$/.test(text) ? text : `${text}+08:00`;
  const date = new Date(zoned);
  if (!Number.isFinite(date.getTime())) throw new Error('时间格式应为 YYYY-MM-DD HH:mm。');
  return date.toISOString();
}
function requestId(): string { const bytes = Array.from({length:32},()=>Math.floor(Math.random()*16).toString(16)).join(''); return `${bytes.slice(0,8)}-${bytes.slice(8,12)}-4${bytes.slice(13,16)}-${((parseInt(bytes[16],16)&3)|8).toString(16)}${bytes.slice(17,20)}-${bytes.slice(20)}`; }

Page({
  data: { braceId: 0, braceName: '', id: 0, editing: false, version: 1, startedAt: '', endedAt: '', notes: '', reason: '', busy: false, error: '' },
  requestId: '',
  async onLoad(query: { braceId?: string; id?: string }) {
    if (!await requireSession()) return;
    const braceId = Number(query?.braceId ?? 0); const id = Number(query?.id ?? 0);
    this.setData({ braceId, id, editing: !!id }); this.requestId = requestId();
    try {
      const [braces, wears] = await Promise.all([api.braces(), api.wears()]);
      const brace = braces.find(b => b.id === (id ? wears.find(w => w.id === id)?.brace : braceId));
      if (id) {
        const wear = wears.find(w => w.id === id);
        if (!wear) { this.setData({ error: '佩戴记录不存在或不可访问。' }); return; }
        this.setData({ braceName: brace?.name ?? '支具', startedAt: localInput(wear.started_at), endedAt: localInput(wear.ended_at), notes: wear.notes, version: wear.version });
      } else this.setData({ braceName: brace?.name ?? '支具', startedAt: localInput(new Date().toISOString()), endedAt: localInput(new Date().toISOString()) });
    } catch (_) { this.setData({ error: '读取支具信息失败。' }); }
  },
  input(event: { currentTarget: { dataset: { key: string } }; detail: { value: string } }) { this.setData({ [event.currentTarget.dataset.key]: event.detail.value }); },
  async save() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      const started = toServer(this.data.startedAt);
      const ended = this.data.endedAt.trim() ? toServer(this.data.endedAt) : null;
      if (!this.data.editing && !ended) throw new Error('补录必须填写结束时间。');
      if (ended && Date.parse(ended) <= Date.parse(started)) throw new Error('结束时间必须晚于开始时间。');
      if (this.data.editing && !this.data.reason.trim()) throw new Error('请填写修正原因。');
      if (this.data.editing) await api.correctWear(this.data.id, { started_at: started, ended_at: ended, notes: this.data.notes.trim(), version: this.data.version, reason: this.data.reason.trim() });
      else await api.backfill({ brace: this.data.braceId, started_at: started, ended_at: ended, notes: this.data.notes.trim(), request_id: this.requestId, original_timezone: 'Asia/Shanghai' });
      wx.showToast({ title: '已保存', icon: 'success' }); wx.navigateBack();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      this.setData({ error: message.includes('409') || message.includes('冲突') ? '该时间段与已有记录重叠。请先核对历史记录，系统不会重复累计。' : message || '保存失败，信息仍保留，请重试。' });
    } finally { this.setData({ busy: false }); }
  },
});
