import { ApiError } from '../../services/request';
import { getCurrentIdentity, initSession, signInWithWechat } from '../../services/session';

let inFlight = false;

function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    return error.status === 503
      ? '服务端尚未完成微信登录配置，请联系维护者。'
      : `暂时无法登录（${error.status}），请稍后重试。`;
  }
  if (error instanceof Error && error.message) return error.message;
  return '网络暂时不可用，请检查连接后重试。';
}

/** 登录后的去向由服务端建档状态决定（规格 §2）：未建档先进建档页。 */
function enterApp(): void {
    const identity = getCurrentIdentity();
    const dismissed = identity ? wx.getStorageSync(`spine.onboarding.dismissed:${identity.id}`) === true : false;
    if (identity?.has_profile && (identity.onboarding_status === 'complete' || dismissed)) {
      wx.switchTab({ url: '/pages/rehab/index' });
    } else wx.reLaunch({ url: '/pages/onboarding/profile/index' });
}

Page({
  data: { busy: true, error: '' },
  onLoad() { void this.begin(); },
  async begin() {
    if (inFlight) return;
    inFlight = true;
    this.setData({ busy: true, error: '' });
    try {
      if ((await initSession()) === 'signedIn') { enterApp(); return; }
      const { isNew } = await signInWithWechat();
      if (isNew) wx.showToast({ title: '已创建你的账号', icon: 'none' });
      enterApp();
    } catch (error) {
      this.setData({ error: messageFor(error) });
    } finally {
      inFlight = false;
      this.setData({ busy: false });
    }
  },
  retry() { void this.begin(); },
});
