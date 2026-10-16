import type { TodayDeck, TrainingAttempt } from '../../../models/types';
import { api } from '../../../services/api';
import { requireOnboarded } from '../../../services/session';

Page({
  data: { id: 0, loading: true, starting: false, error: '', attempt: null as TrainingAttempt | null,
    deck: null as TodayDeck | null, nextName: '' },
  onLoad(query: { id?: string }) { this.setData({ id: Number(query.id) }); void this.reload(); },
  onPullDownRefresh() { void this.reload(true); },
  async reload(stopPull = false) {
    if (!await requireOnboarded()) { if (stopPull) wx.stopPullDownRefresh(); return; }
    this.setData({ loading: true, error: '' });
    try {
      const [attempt, deck] = await Promise.all([api.attempt(this.data.id), api.todayDeck()]);
      this.setData({ attempt, deck,
        nextName: deck.open_attempt?.card_name || deck.cards.find(item => !item.done)?.card.name || '' });
    } catch (_) { this.setData({ error: '记录暂时无法读取，请重试。' }); }
    finally { this.setData({ loading: false }); if (stopPull) wx.stopPullDownRefresh(); }
  },
  async continueToday() {
    if (this.data.starting) return;
    this.setData({ starting: true, error: '' });
    try {
      const deck = await api.todayDeck();
      const next = deck.cards.find(item => !item.done);
      this.setData({ deck, nextName: deck.open_attempt?.card_name || next?.card.name || '' });
      if (!deck.open_attempt && !next) return;
      const attempt = deck.open_attempt || await api.startAttempt(next!.card.id);
      wx.redirectTo({ url: `/pages/rehab/follow/index?id=${attempt.id}` });
    } catch (error) { this.setData({ error: error instanceof Error ? error.message : '暂时无法开始下一项。' }); }
    finally { this.setData({ starting: false }); }
  },
  backToday() { wx.switchTab({ url: '/pages/rehab/index' }); },
});
