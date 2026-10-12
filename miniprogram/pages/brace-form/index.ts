import type { Brace } from '../../models/types';
import { api } from '../../services/api';
import { requireSession } from '../../services/session';
Page({
  data: { id: 0, editing: false, name: '', braceType: '', startedOn: '', institution: '', notes: '', isActive: true, hasOpenWear: false, busy: false, error: '' },
  async onLoad(query: { id?: string }) {
    if (!await requireSession()) return;
    const id = Number(query?.id ?? 0);
    if (!id) return;
    this.setData({ id, editing: true });
    try {
      const [braceList, wears] = await Promise.all([api.braces(), api.wears()]);
      const brace = braceList.find(item => item.id === id);
      if (!brace) { this.setData({ error: '支具档案不存在或不可访问。' }); return; }
      const hasOpenWear = wears.some(wear => wear.brace === id && !wear.ended_at);
      this.setData({ name: brace.name, braceType: brace.brace_type, startedOn: brace.started_on ?? '', institution: brace.institution, notes: brace.notes, isActive: brace.is_active, hasOpenWear });
    } catch (_) { this.setData({ error: '档案读取失败，请重试。' }); }
  },
  input(event: { currentTarget: { dataset: { key: string } }; detail: { value: string } }) { this.setData({ [event.currentTarget.dataset.key]: event.detail.value }); },
  toggleActive(event: { detail: { value: boolean } }) { this.setData({ isActive: event.detail.value }); },
  async save() {
    if (this.data.busy) return;
    if (!this.data.name.trim()) { this.setData({ error: '请填写支具名称。' }); return; }
    this.setData({ busy: true, error: '' });
    try {
      const body: Partial<Brace> = { name: this.data.name.trim(), brace_type: this.data.braceType.trim(), started_on: this.data.startedOn.trim() || null, institution: this.data.institution.trim(), notes: this.data.notes.trim(), is_active: this.data.isActive };
      await api.saveBrace(body, this.data.id || undefined);
      wx.showToast({ title: '已保存', icon: 'success' }); wx.navigateBack();
    } catch (_) { this.setData({ error: '保存失败，内容仍保留。请检查日期和网络后重试。' }); }
    finally { this.setData({ busy: false }); }
  },
});
