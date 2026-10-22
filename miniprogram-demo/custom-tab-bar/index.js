Component({
  data: {
    selected: 0,
    tabs: [
      { path: 'pages/planning/index', label: '制定', icon: 'planning' },
      { path: 'pages/train/index', label: '训练', icon: 'training' },
      { path: 'pages/community/index', label: '社群', icon: 'community' },
      { path: 'pages/me/index', label: '我的', icon: 'profile' },
    ],
  },
  lifetimes: { attached() { this.syncSelected(); } },
  pageLifetimes: { show() { this.syncSelected(); } },
  methods: {
    syncSelected() {
      const pages = getCurrentPages();
      const current = pages[pages.length - 1];
      const selected = this.data.tabs.findIndex(tab => current && tab.path === current.route);
      if (selected >= 0) this.setData({ selected });
    },
    switchTab(event) {
      const selected = Number(event.currentTarget.dataset.index);
      const tab = this.data.tabs[selected];
      if (!tab || selected === this.data.selected) return;
      wx.switchTab({ url: '/' + tab.path, success: () => this.setData({ selected }) });
    },
  },
});
