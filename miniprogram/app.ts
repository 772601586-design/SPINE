import { clearSession, configureUnauthorizedHandler, initSession } from './services/session';
import { startReminders, stopReminders } from './services/reminders';

App({
  onLaunch() {
    configureUnauthorizedHandler(() => {
      clearSession();
      const pages = getCurrentPages();
      if (pages[pages.length - 1]?.route.startsWith('prototype/')) return;
      wx.reLaunch({ url: '/pages/login/index' });
    });
    void initSession().then(() => startReminders());
  },
  onShow() { void startReminders(); },
  onHide() { stopReminders(); },
  globalData: {},
});
