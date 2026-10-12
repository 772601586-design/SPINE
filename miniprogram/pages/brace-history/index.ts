import type { ComfortEntry, WearRevision, WearSession } from '../../models/types';
import { api } from '../../services/api';
import { requireSession } from '../../services/session';

function time(value: string | null): string {
  return value ? new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ') : '佩戴中';
}

Page({
  data: { braceId: 0, loading: true, error: '', wears: [] as Array<Record<string, unknown>>, feelings: [] as Array<Record<string, unknown>> },
  async onLoad(query: Record<string, string | undefined> = {}) { this.setData({ braceId: Number(query.braceId ?? 0) }); await this.reload(); },
  onShow() { if (!this.data.loading) void this.reload(); },
  onPullDownRefresh() { void this.reload(true); },
  async reload(stopPull = false) {
    if (!await requireSession()) { if (stopPull) wx.stopPullDownRefresh(); return; }
    this.setData({ loading: true, error: '' });
    try {
      const [braces, wears, feelings] = await Promise.all([api.braces(), api.wears(), api.feelings()]);
      const visibleWears: WearSession[] = wears.filter(w => !this.data.braceId || w.brace === this.data.braceId);
      const visibleFeelings: ComfortEntry[] = feelings.filter(f => !this.data.braceId || f.brace === this.data.braceId);
      const braceName = (id: number) => braces.find(b => b.id === id)?.name ?? '支具';
      const wearRows = visibleWears.map(w => ({ id: w.id, braceName: braceName(w.brace), startText: time(w.started_at), endText: time(w.ended_at), notes: w.notes, version: w.version }));
      const feelingRows = visibleFeelings.map(f => ({ id: f.id, braceName: braceName(f.brace), time: time(f.occurred_at),
        comfort: f.comfort_level ? ['', '很不舒服', '不太舒服', '一般', '比较舒适', '很舒适'][f.comfort_level] : '舒适度未填写',
        pain: f.pain === null ? '未填写' : `${f.pain} 分`, positions: f.positions.join('、'), tags: f.tags.join('、'), notes: f.notes }));
      this.setData({ wears: wearRows, feelings: feelingRows, loading: false });
    } catch (_) { this.setData({ loading: false, error: '读取历史失败，请重试。' }); }
    finally { if (stopPull) wx.stopPullDownRefresh(); }
  },
  correctWear(event: { currentTarget: { dataset: { id: number } } }) { wx.navigateTo({ url: `/pages/wear-form/index?id=${event.currentTarget.dataset.id}` }); },
  editFeeling(event: { currentTarget: { dataset: { id: number } } }) { const suffix = this.data.braceId ? `&braceId=${this.data.braceId}` : ''; wx.navigateTo({ url: `/pages/comfort-form/index?id=${event.currentTarget.dataset.id}${suffix}` }); },
  openFollowups(event: { currentTarget: { dataset: { id: number } } }) { wx.navigateTo({ url: `/pages/follow-ups/index?entryId=${event.currentTarget.dataset.id}` }); },
  async showRevisions(event: { currentTarget: { dataset: { id: number } } }) {
    try {
      const records: WearRevision[] = await api.revisions(event.currentTarget.dataset.id);
      const text = records.length ? records.map(item => `${time(item.created_at)} · ${item.reason}\n${time(String(item.before.started_at))} → ${time(item.before.ended_at ? String(item.before.ended_at) : null)}\n改为 ${time(String(item.after.started_at))} → ${time(item.after.ended_at ? String(item.after.ended_at) : null)}`).join('\n\n') : '尚无修改历史';
      wx.showModal({ title: '修改历史', content: text, showCancel: false });
    } catch (_) { wx.showToast({ title: '历史读取失败', icon: 'none' }); }
  },
});
