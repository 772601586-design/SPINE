import type { Brace, WearSession, WearStatistics } from '../../models/types';
import { api } from '../../services/api';
import { requireOnboarded } from '../../services/session';

/**
 * 康复首页（规格 §2.2）。
 *
 * 两张主卡：动作与运动、支具佩戴。这里**不做今日任务清单**——周期计划落地前，
 * 动作卡只陈述「还没有周期」，不造一个当天待办来充数。支具卡接的是既有真实数据。
 */
function dayInShanghai(): string { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }
function durationLabel(seconds: number): string {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  return `${Math.floor(minutes / 60)}小时${minutes % 60}分钟`;
}

Page({
  data: {
    loading: true,
    error: '',
    nickname: '',
    // 动作与运动
    hasPlan: false,
    planLabel: '',
    phaseLabel: '',
    weekText: '',
    recentSwim: '',
    // 支具佩戴
    hasBrace: false,
    braceName: '',
    wearing: false,
    elapsedText: '0小时0分钟',
    dayLabel: '',
    dayText: '',
    dayConfirmed: false,
  },

  onShow() { void this.reload(); },
  onPullDownRefresh() { void this.reload(true); },

  async reload(stopPull = false) {
    if (!await requireOnboarded()) { if (stopPull) wx.stopPullDownRefresh(); return; }
    this.setData({ loading: true, error: '' });
    try {
      const [braces, wears] = await Promise.all([api.braces(), api.wears()]);
      await this.loadBraceCard(braces, wears);
      // 周期计划与游泳记录在阶段二/三落地；在此之前保持明确的空状态，不显示假数据。
      this.setData({ hasPlan: false, planLabel: '', phaseLabel: '', weekText: '', recentSwim: '' });
    } catch (_) {
      this.setData({ error: '暂时无法读取康复概览，请重试。' });
    } finally {
      this.setData({ loading: false });
      if (stopPull) wx.stopPullDownRefresh();
    }
  },

  async loadBraceCard(braces: Brace[], wears: WearSession[]) {
    const active = wears.find(wear => wear.ended_at === null) ?? null;
    const selected = active
      ? braces.find(brace => brace.id === active.brace)
      : braces.find(brace => brace.is_active) ?? braces[0];
    if (!selected) {
      this.setData({ hasBrace: false, braceName: '', wearing: false, dayText: '', dayConfirmed: false });
      return;
    }
    const stats: WearStatistics = await api.statistics(selected.id);
    const today = stats.days.find(day => day.date === dayInShanghai());
    const elapsed = active ? Math.floor((Date.now() - Date.parse(active.started_at)) / 1000) : 0;
    this.setData({
      hasBrace: true,
      braceName: selected.name,
      wearing: !!active,
      elapsedText: durationLabel(elapsed),
      dayLabel: '今日',
      dayText: today ? durationLabel(today.seconds) : '',
      dayConfirmed: !!today,
    });
  },

  openActivity() { wx.navigateTo({ url: '/pages/rehab/activity/index' }); },
  openBrace() { wx.navigateTo({ url: '/pages/brace/index' }); },
  createPlan() { wx.showToast({ title: '周期计划将在下一阶段开放', icon: 'none' }); },
  openSwimming() { wx.showToast({ title: '游泳记录将在后续阶段开放', icon: 'none' }); },
});
