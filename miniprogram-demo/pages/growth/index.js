// Keep older saved links working after brace records moved into the training tab.
Page({
  onLoad() {
    wx.switchTab({ url: '/pages/train/index' });
  }
});
