import type { TodayAction, TodayDeck } from '../../models/types';
import { api } from '../../services/api';
import { life } from '../../services/life';
import type { LifeSummary } from '../../services/life';
import { getCurrentIdentity, requireOnboarded } from '../../services/session';
import { shanghaiDate, durationText, doseText } from '../../services/presentation';
import { treatmentStage } from '../../config/profile-options';

Page({
  data: {
    loading: true, braceError: '', planError: '', profileError: '', nickname: '', dateLine: '', greeting: '',
    encouragement: treatmentStage(''),
    hasBrace: false, braceName: '', wearing: false, wearText: '暂无记录',
    cards: [] as Array<TodayAction & { id: number; dose: string }>, deck: null as TodayDeck | null,
    readyCount: 0, planTitle: '', starting: false, lifeSummary: null as LifeSummary | null, lifeError: '',
  },
  onShow() {
    void this.reload();
    clearInterval(this._dayTimer);
    this._dayTimer = setInterval(() => {
      if (this.data.deck && this.data.deck.date !== shanghaiDate()) void this.reload();
    }, 30000);
  },
  onHide() { clearInterval(this._dayTimer); },
  onUnload() { clearInterval(this._dayTimer); },
  onPullDownRefresh() { void this.reload(true); },
  async reload(stopPull = false) {
    if (this.data.loading && this.data.dateLine) { if (stopPull) wx.stopPullDownRefresh(); return; }
    if (!await requireOnboarded()) { if (stopPull) wx.stopPullDownRefresh(); return; }
    const date = shanghaiDate();
    const hour = Number(new Date(Date.now() + 8 * 3600000).toISOString().slice(11, 13));
    this.setData({ loading: true, braceError: '', planError: '', profileError: '',
      dateLine: `${date.slice(5, 7)} 月 ${date.slice(8)} 日`,
      greeting: hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好',
      nickname: getCurrentIdentity()?.nickname || '小树的朋友' });
    try { await Promise.all([this.loadPlan(), this.loadBrace(), this.loadProfile(), this.loadLife()]); }
    finally { this.setData({ loading: false }); if (stopPull) wx.stopPullDownRefresh(); }
  },
  async loadProfile() {
    try {
      const profile = await api.profile();
      this.setData({ nickname: profile.nickname, encouragement: treatmentStage(profile.treatment_stage) });
    } catch (_) { this.setData({ profileError: '阶段提示暂时无法读取，点击重试。', encouragement: treatmentStage('') }); }
  },
  async loadLife() {
    try { this.setData({ lifeSummary: await life.summary(), lifeError: '' }); }
    catch (_) { this.setData({ lifeError: '生活提醒暂时无法读取，点击重试。', lifeSummary: null }); }
  },
  openLife(event: { currentTarget: { dataset: { tab: string } } }) { wx.navigateTo({ url: `/pages/life/index?tab=${event.currentTarget.dataset.tab}` }); },
  async loadPlan() {
    try {
      const deck = await api.todayDeck();
      this.setData({ cards: deck.cards.map(item => ({ ...item, id: item.card.id, dose: doseText(item.card) })), deck,
        readyCount: deck.remaining_count, planTitle: deck.plan_title,
        dateLine: `${deck.date.slice(5, 7)} 月 ${deck.date.slice(8)} 日` });
    } catch (_) { this.setData({ planError: '今日卡组暂时无法读取，点击重试。', cards: [], deck: null, readyCount: 0 }); }
  },
  async loadBrace() {
    try {
      const [braces, wears] = await Promise.all([api.braces(), api.wears()]);
      const active = wears.find(wear => wear.ended_at === null);
      const brace = active ? braces.find(item => item.id === active.brace) : braces.find(item => item.is_active) ?? braces[0];
      if (!brace) { this.setData({ hasBrace: false, wearing: false, wearText: '尚未添加' }); return; }
      const stats = await api.statistics(brace.id);
      const day = stats.days.find(item => item.date === shanghaiDate());
      this.setData({ hasBrace: true, braceName: brace.name, wearing: !!active,
        wearText: day ? durationText(day.seconds) : '暂无确认记录' });
    } catch (_) { this.setData({ braceError: '支具记录暂时无法读取，点击重试。' }); }
  },
  openActivity() { wx.switchTab({ url: '/pages/rehab/activity/index' }); },
  async startToday() {
    if (this.data.starting) return;
    this.setData({ starting: true });
    try {
      // Refresh just before starting so another device or midnight cannot leave a stale queue.
      const deck = await api.todayDeck();
      const next = deck.cards.find(item => !item.done);
      if (!deck.open_attempt && !next) { await this.reload(); return; }
      const attempt = deck.open_attempt || await api.startAttempt(next!.card.id);
      wx.navigateTo({ url: `/pages/rehab/follow/index?id=${attempt.id}` });
    } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '暂时无法开始训练', icon: 'none' }); }
    finally { this.setData({ starting: false }); }
  },
  openBrace() { wx.navigateTo({ url: '/pages/brace/index' }); },
  openCard(event: { currentTarget: { dataset: { id: number } } }) {
    wx.navigateTo({ url: `/pages/rehab/card/index?id=${event.currentTarget.dataset.id}` });
  },
  openGrowth() { wx.switchTab({ url: '/pages/growth/index' }); },
});
