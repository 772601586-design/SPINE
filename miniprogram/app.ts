import { configureUnauthorizedHandler, initSession } from './services/session';

App({
  onLaunch() {
    configureUnauthorizedHandler(() => {
      wx.clearStorageSync();
      wx.reLaunch({ url: '/pages/login/index' });
    });
    void initSession();
  },
  globalData: {},
});
