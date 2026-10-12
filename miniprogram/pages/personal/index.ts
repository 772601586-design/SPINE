import { getCurrentUser, requireSession, signOut } from '../../services/session';
Page({
  data: { username: '', busy: false, error: '' },
  async onShow() { if (await requireSession()) this.setData({ username: getCurrentUser()?.username ?? '' }); },
  openHistory() { wx.navigateTo({ url: '/pages/brace-history/index' }); },
  async logout() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    const revoked = await signOut();
    if (!revoked) wx.showToast({ title: '本机已退出，服务器撤销未确认', icon: 'none', duration: 3200 });
    this.setData({ busy: false, username: '' });
  },
});
