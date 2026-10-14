import { requireOnboarded } from '../../services/session';

/**
 * 社区（规格 §11）。
 *
 * 帖子、审核队列与举报治理在阶段四落地。在此之前这里保持如实的空状态：
 * 不预置任何"示例动态"，也不把未开放的入口做成能点进去的空页面。
 */
Page({
  data: { loading: true, error: '' },
  async onShow() {
    this.setData({ loading: true, error: '' });
    if (!await requireOnboarded()) { this.setData({ loading: false }); return; }
    this.setData({ loading: false });
  },
  compose() { wx.showToast({ title: '发布功能尚未开放', icon: 'none' }); },
  retry() { void this.onShow(); },
});
