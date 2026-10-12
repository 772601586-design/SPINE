import type { Brace } from '../../models/types';
import { api } from '../../services/api';
import { requireSession } from '../../services/session';
Page({
  data: { braces: [] as Brace[], loading: true, error: '' },
  onLoad() { void this.reload(); },
  onShow() { if (!this.data.loading) void this.reload(); },
  async reload() { if (!await requireSession()) return; this.setData({ loading: true }); try { const braces = await api.braces(); this.setData({ braces, loading: false, error: '' }); } catch (_) { this.setData({ loading: false, error: '档案读取失败，请重试。' }); } },
  add() { wx.navigateTo({ url: '/pages/brace-form/index' }); },
  edit(event: { currentTarget: { dataset: { id: number } } }) { wx.navigateTo({ url: `/pages/brace-form/index?id=${event.currentTarget.dataset.id}` }); },
});
