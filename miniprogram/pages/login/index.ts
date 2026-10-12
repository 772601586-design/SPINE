import { api } from '../../services/api';
import { ApiError } from '../../services/request';
import { initSession, isInvalidCredential, signIn } from '../../services/session';

Page({
  data: { checking: true, unavailable: false, busy: false, showPassword: false, username: '', password: '', error: '' },
  async onLoad() {
    const result = await initSession();
    if (result === 'signedIn') { wx.switchTab({ url: '/pages/today/index' }); return; }
    this.setData({ checking: false, unavailable: result === 'unavailable', error: result === 'unavailable' ? '暂时无法验证登录状态，请检查网络后重试。' : '' });
  },
  onUsername(event: { detail: { value: string } }) { this.setData({ username: event.detail.value }); },
  onPassword(event: { detail: { value: string } }) { this.setData({ password: event.detail.value }); },
  togglePassword() { this.setData({ showPassword: !this.data.showPassword }); },
  async retry() {
    this.setData({ checking: true, unavailable: false, error: '' });
    const result = await initSession(true);
    if (result === 'signedIn') { wx.switchTab({ url: '/pages/today/index' }); return; }
    this.setData({ checking: false, unavailable: result === 'unavailable', error: result === 'unavailable' ? '网络仍不可用，登录状态未清除。' : '' });
  },
  async submit() {
    if (this.data.busy) return;
    const username = this.data.username.trim();
    const password = this.data.password;
    if (!username || !password) { this.setData({ error: '请输入账号和密码。' }); return; }
    this.setData({ busy: true, error: '' });
    try {
      await signIn(username, password);
      this.setData({ password: '' });
      wx.switchTab({ url: '/pages/today/index' });
    } catch (error) {
      const message = isInvalidCredential(error) ? '账号或密码不正确，请重试。'
        : error instanceof ApiError ? `暂时无法登录（${error.status}），请稍后重试。`
        : '网络暂时不可用，请检查连接后重试。';
      this.setData({ error: message });
    } finally { this.setData({ busy: false }); }
  },
});
