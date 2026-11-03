const { bindPage } = require('../../core/bridge');
const store = require('../../core/store');
const brace = require('../../core/brace-records');
const art = require('../../core/brand-art');

const definition = bindPage('me', ["nav", "pine", "remindOn", "swBg", "swLeft", "toggleRemind"], {
  openPersonalInfo() { wx.navigateTo({ url: '/pages/personal-info/index' }); },
  avatarError() { this.setData({ profileAvatarFailed: true }); },
  openGrowthRecords() { wx.navigateTo({ url: '/pages/growth-records/index' }); },
  openMyPosts() { wx.navigateTo({ url: '/pages/my-posts/index' }); },
  resetDemo() {
    wx.showModal({
      title: '重置示例数据',
      content: '会清空本机上的所有记录，从首次使用重新开始。',
      confirmText: '重置',
      success: (r) => { if (r.confirm) store.reset(); }
    });
  }
});
const refresh = definition.refresh;
definition.refresh = function () {
  refresh.call(this);
  const state = store.app.state, nickname = state.profileNickname || '小禾';
  this.setData({ brandPinecone: art.pinecone, profileNickname: nickname, profileAvatar: state.profileAvatar || '', profileInitial: Array.from(nickname)[0], profileAvatarFailed: false });
};
Page(brace.attach(definition, { live: false }));
