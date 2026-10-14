/**
 * 全局状态与页面路由
 *
 * 整个小程序只有一个 SpineApp 实例（业务逻辑和网页原型完全相同）。
 * - 业务逻辑通过 state.screen 表达“要去哪一页”；这里把它翻译成小程序导航：
 *     底部 5 个 tab 页 → wx.switchTab
 *     目标页已经在页面栈里 → wx.navigateBack 回到它
 *     其他 → wx.navigateTo（页面栈满了就 redirectTo）
 * - 用户点系统返回键时，页面 onShow 会调用 enter() 同步 state.screen，不触发导航。
 * - state 存在本地（wx 存储），下次打开接着用；“我的”页底部可以重置示例数据。
 */
const SpineApp = require('./spine-app');

const STORAGE_KEY = 'spine-state-v1';
const TABS = ['today', 'train', 'growth', 'community', 'me'];
const routeOf = (screen) => 'pages/' + screen + '/index';

let app = null;
let scheduled = false;

function load() {
  let saved = null;
  try { saved = wx.getStorageSync(STORAGE_KEY) || null; } catch (e) { saved = null; }
  app = new SpineApp({ startAt: saved && saved.onboarded ? '直接进首页' : '首次使用' });
  if (saved) Object.assign(app.state, saved, { toast: '' });
  app.__host = { schedule };
}

function save() {
  try {
    const s = Object.assign({}, app.state, { toast: '' });
    wx.setStorageSync(STORAGE_KEY, s);
  } catch (e) { /* 存储失败不影响使用 */ }
}

function currentPage() {
  const pages = getCurrentPages();
  return pages[pages.length - 1];
}

function navigate(screen) {
  const url = '/' + routeOf(screen);
  if (TABS.indexOf(screen) !== -1) {
    app.state.onboarded = true;
    wx.switchTab({ url });
    return;
  }
  const pages = getCurrentPages();
  const idx = pages.map((p) => p.route).lastIndexOf(routeOf(screen));
  if (idx !== -1) {
    wx.navigateBack({ delta: pages.length - 1 - idx });
  } else if (pages.length >= 9) {
    wx.redirectTo({ url });
  } else {
    wx.navigateTo({ url });
  }
}

function flush() {
  scheduled = false;
  const s = app.state;
  if (s.toast) {
    // 业务逻辑里的顶部提示改用小程序原生 toast；显示后清空，下次同样的提示也能再出现
    wx.showToast({ title: s.toast, icon: 'none', duration: 2000 });
    s.toast = '';
  }
  save();
  const page = currentPage();
  const here = page && page.spineScreen;
  if (s.screen && s.screen !== here) {
    navigate(s.screen);
  } else if (page && page.refresh) {
    page.refresh();
  }
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  wx.nextTick(flush);
}

module.exports = {
  get app() { if (!app) load(); return app; },
  TABS,
  /** 页面显示时调用：同步当前页（用户可能是点系统返回键回来的） */
  enter(screen) {
    if (!app) load();
    if (app.state.screen !== screen) app.state.screen = screen;
    if (TABS.indexOf(screen) !== -1 && !app.state.onboarded) { app.state.onboarded = true; save(); }
  },
  vm() { if (!app) load(); return app.renderVals(); },
  /** 清空本地数据，从首次使用重新开始 */
  reset() {
    try { wx.removeStorageSync(STORAGE_KEY); } catch (e) { /* ignore */ }
    app = null;
    load();
    wx.reLaunch({ url: '/' + routeOf('welcome') });
  }
};
