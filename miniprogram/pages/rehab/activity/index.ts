import type { TrainingPlan } from '../../../models/types';
import { api } from '../../../services/api';
import { requireOnboarded } from '../../../services/session';

Page({
  data: { loading: true, error: '', plan: null as TrainingPlan | null },
  onLoad() { void this.reload(); },
  onShow() { if (!this.data.loading) void this.reload(); },
  onPullDownRefresh() { void this.reload(true); },
  async reload(stopPull = false) {
    if (!await requireOnboarded()) { if (stopPull) wx.stopPullDownRefresh(); return; }
    this.setData({ loading: true, error: '' });
    try { this.setData({ plan: await api.trainingPlan() }); }
    catch (error) { this.setData({ error: error instanceof Error ? error.message : '暂时无法读取训练计划' }); }
    finally { this.setData({ loading: false }); if (stopPull) wx.stopPullDownRefresh(); }
  },
  addAction() { wx.navigateTo({ url: '/pages/rehab/exercises/index' }); },
  openCard(event: { currentTarget: { dataset: { id: string } } }) {
    wx.navigateTo({ url: `/pages/rehab/card/index?id=${event.currentTarget.dataset.id}` });
  },
  async removeCard(event: { currentTarget: { dataset: { id: string; name: string } } }) {
    const { id, name } = event.currentTarget.dataset;
    const confirm = await new Promise<boolean>(resolve => wx.showModal({
      title: '从后续计划移除？', content: `“${name}”不会再出现在后续计划中，过去的训练记录仍会保留。`,
      success: result => resolve(result.confirm), fail: () => resolve(false),
    }));
    if (!confirm) return;
    try { await api.removeActionCard(Number(id)); wx.showToast({ title: '已更新后续计划', icon: 'success' }); await this.reload(); }
    catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '移除失败，请重试', icon: 'none' }); }
  },
  async moveCard(event: { currentTarget: { dataset: { id: string; delta: string } } }) {
    const cards = this.data.plan?.cards.slice() ?? [];
    const index = cards.findIndex(card => card.id === Number(event.currentTarget.dataset.id));
    const target = index + Number(event.currentTarget.dataset.delta);
    if (index < 0 || target < 0 || target >= cards.length) return;
    [cards[index], cards[target]] = [cards[target], cards[index]];
    this.setData({ plan: { ...this.data.plan!, cards } });
    try { await api.reorderActionCards(cards.map(card => card.id)); }
    catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '排序未保存', icon: 'none' }); await this.reload(); }
  },
  openSwimming() { wx.showToast({ title: '游泳记录入口将在后续接入', icon: 'none' }); },
  openHistory() { wx.showToast({ title: '周期历史与回顾将在后续接入', icon: 'none' }); },
});
