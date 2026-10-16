const { bindPage } = require('../../core/bridge');
const store = require('../../core/store');

// 我的：本页用到的视图字段（由构建脚本从 WXML 统计）
Page(bindPage('me', ["complete", "completeText", "completeW", "nav", "pine", "remindOn", "stageLabel", "swBg", "swLeft", "toggleRemind"], {
  resetDemo() {
    wx.showModal({
      title: '重置示例数据',
      content: '会清空本机上的所有记录，从首次使用重新开始。',
      confirmText: '重置',
      success: (r) => { if (r.confirm) store.reset(); }
    });
  }
}));
