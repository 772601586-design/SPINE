import type { Brace, ComfortEntry, WearSession, WearStatistics } from '../../models/types';
import { api } from '../../services/api';
import { requireSession } from '../../services/session';

function dayInShanghai(): string { return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10); }
function durationLabel(seconds: number): string { const minutes = Math.max(0, Math.floor(seconds / 60)); return `${Math.floor(minutes / 60)}小时${minutes % 60}分钟`; }

Page({
  data: { loading: false, error: '', braceName: '', wearing: false, elapsedText: '', todayText: '', hasTodayRecord: false },
  onShow() { void this.reload(); },
  onPullDownRefresh() { void this.reload(true); },
  async reload(stopPull = false) {
    if (!await requireSession()) { if (stopPull) wx.stopPullDownRefresh(); return; }
    this.setData({ loading: true, error: '' });
    try {
      const [braces, wears] = await Promise.all([api.braces(), api.wears()]);
      const active = wears.find(wear => wear.ended_at === null);
      const selected = active ? braces.find(brace => brace.id === active.brace)
        : braces.find(brace => brace.is_active) ?? braces[0];
      if (!selected) { this.setData({ braceName: '', wearing: false, elapsedText: '', todayText: '', hasTodayRecord: false }); return; }
      const stats: WearStatistics = await api.statistics(selected.id);
      const today = stats.days.find(day => day.date === dayInShanghai());
      const feelings: ComfortEntry[] = await api.feelings();
      void feelings;
      const elapsed = active ? Math.floor((Date.now() - Date.parse(active.started_at)) / 1000) : 0;
      this.setData({ braceName: selected.name, wearing: !!active,
        elapsedText: durationLabel(elapsed), todayText: durationLabel(today?.seconds ?? 0), hasTodayRecord: !!today });
    } catch (_) { this.setData({ error: '暂时无法读取记录，请重试。' }); }
    finally { this.setData({ loading: false }); if (stopPull) wx.stopPullDownRefresh(); }
  },
  openBrace() { wx.navigateTo({ url: '/pages/brace/index' }); },
  showPending() { wx.showToast({ title: '运动养护尚未开放', icon: 'none' }); },
});
