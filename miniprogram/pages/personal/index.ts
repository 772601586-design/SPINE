import { getCurrentIdentity, requireOnboarded, signOut } from '../../services/session';

/**
 * 个人（规格 §12）。
 *
 * 这里只是入口目录，不是功能本体。未落地的板块如实标注「尚未开放」，不做
 * 点进去一片空白的假入口，也不把这些入口藏起来假装已经做完。
 */
interface Entry { key: string; label: string; desc: string; path: string; available: boolean }

const SECTIONS: Array<{ title: string; entries: Entry[] }> = [
  {
    title: '我的内容',
    entries: [
      { key: 'profile', label: '我的档案', desc: '基础资料、身体测量、就诊时间线', path: '/pages/personal/profile/index', available: true },
      { key: 'records', label: '我的记录', desc: '支具佩戴与感受历史', path: '/pages/brace-history/index', available: true },
      { key: 'moods', label: '私人心情', desc: '心情符号与文字，可选择转发为社区草稿', path: '/pages/personal/moods/index', available: false },
      { key: 'discomfort', label: '身体记录', desc: '疼痛位置、背景与分值', path: '/pages/personal/discomfort/index', available: false },
    ],
  },
  {
    title: '社区与内容',
    entries: [
      { key: 'posts', label: '我的发布', desc: '已发布、审核中与未通过的分享', path: '/pages/personal/posts/index', available: false },
      { key: 'bookmarks', label: '收藏与科普', desc: '收藏的动作与科普文章', path: '/pages/personal/bookmarks/index', available: false },
      { key: 'achievements', label: '成就', desc: '按真实记录授予，不设每日打卡', path: '/pages/personal/achievements/index', available: false },
    ],
  },
  {
    title: '系统',
    entries: [
      { key: 'notifications', label: '通知', desc: '社区审核、评论与提醒', path: '/pages/personal/notifications/index', available: false },
      { key: 'settings', label: '设置', desc: '隐私、提醒、账号数据管理', path: '/pages/personal/settings/index', available: false },
    ],
  },
];

Page({
  data: {
    nickname: '',
    subtitle: '',
    busy: false,
    error: '',
    sections: SECTIONS,
  },

  async onShow() {
    if (!await requireOnboarded()) return;
    const identity = getCurrentIdentity();
    const nickname = identity?.nickname?.trim() ?? '';
    this.setData({
      nickname: nickname || '未设置昵称',
      subtitle: nickname ? '按自己的节奏记录就好。' : '还没有昵称，可以在档案里补上。',
    });
  },

  openEntry(event: { currentTarget: { dataset: { key: string } } }) {
    const key = event.currentTarget.dataset.key;
    for (const section of this.data.sections) {
      const entry = section.entries.find(item => item.key === key);
      if (!entry) continue;
      if (!entry.available) { wx.showToast({ title: '该功能尚未开放', icon: 'none' }); return; }
      wx.navigateTo({ url: entry.path });
      return;
    }
  },

  openProfile() { wx.navigateTo({ url: '/pages/personal/profile/index' }); },

  async logout() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    const revoked = await signOut();
    if (!revoked) wx.showToast({ title: '本机已退出，服务器撤销未确认', icon: 'none', duration: 3200 });
    this.setData({ busy: false });
  },
});
