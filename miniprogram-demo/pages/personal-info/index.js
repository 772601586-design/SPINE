const store = require('../../core/store');
const stages = require('../../core/treatment-stages');
let avatarSequence = 0;
function removeLocalAvatar(path) {
  const prefix = wx.env && wx.env.USER_DATA_PATH + '/profile-avatar-';
  if (!prefix || !path || !path.startsWith(prefix) || /[\\/]/.test(path.slice(prefix.length))) return;
  try { wx.getFileSystemManager().unlink({ filePath: path, fail() {} }); } catch (_) { /* 可重试的本地缓存清理 */ }
}
Page({
  spineScreen: 'personal-info',
  data: { nickname: '', avatar: '', initial: '', avatarFailed: false, avatarBusy: false, saving: false, error: '', stages, stageIndex: 2 },
  onLoad() {
    this._createdAvatars = new Set();
    this._unloaded = false;
    const state = store.app.state, nickname = state.profileNickname || '小禾';
    this.setData({ nickname, initial: Array.from(nickname)[0], avatar: state.profileAvatar || '', stageIndex: Math.max(0, stages.findIndex(item => item.id === state.stage)) });
  },
  onShow() { store.enter('personal-info'); },
  inputNickname(e) { this.setData({ nickname: e.detail.value, initial: Array.from(e.detail.value.trim())[0] || '我', error: '' }); },
  changeStage(e) {
    const index = Number(e.detail.value);
    if (Number.isInteger(index) && stages[index]) this.setData({ stageIndex: index, error: '' });
  },
  avatarError() { this.setData({ avatarFailed: true }); },
  chooseAvatar() {
    if (this.data.avatarBusy || this.data.saving) return;
    this.setData({ avatarBusy: true, error: '' });
    const failed = error => {
      if (!this._unloaded) this.setData({ avatarBusy: false, error: /cancel/.test(error && error.errMsg || '') ? '' : '头像保存失败，请重新选择' });
    };
    wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'], success: result => {
      if (this._unloaded) return;
      const source = result.tempFiles && result.tempFiles[0] && result.tempFiles[0].tempFilePath;
      if (!source) return failed();
      const extension = (source.match(/\.(png|jpe?g|webp)$/i) || [0, 'jpg'])[1];
      const destination = wx.env.USER_DATA_PATH + '/profile-avatar-' + Date.now() + '-' + (++avatarSequence) + '.' + extension;
      try {
        wx.getFileSystemManager().copyFile({ srcPath: source, destPath: destination,
          success: () => {
            if (this._unloaded) return removeLocalAvatar(destination);
            this._createdAvatars.add(destination);
            this.setData({ avatar: destination, avatarFailed: false, avatarBusy: false });
          }, fail: failed });
      } catch (error) { failed(error); }
    }, fail: failed });
  },
  removeAvatar() { if (!this.data.avatarBusy && !this.data.saving) this.setData({ avatar: '', avatarFailed: false, error: '' }); },
  save() {
    if (this.data.saving || this.data.avatarBusy) return;
    const nickname = this.data.nickname.trim();
    if (!nickname) return this.setData({ error: '请填写昵称' });
    if (Array.from(nickname).length > 30) return this.setData({ error: '昵称最多 30 个字' });
    this.setData({ saving: true, error: '' });
    const previousAvatar = store.app.state.profileAvatar;
    try {
      store.savePersonalInfo({ nickname, avatar: this.data.avatar, stage: stages[this.data.stageIndex].id });
    } catch (_) {
      this.setData({ saving: false, error: '保存失败，请稍后重试' });
      return;
    }
    this._createdAvatars.delete(this.data.avatar);
    if (previousAvatar !== this.data.avatar) removeLocalAvatar(previousAvatar);
    wx.showToast({ title: '个人信息已保存', icon: 'success' });
    const failedToReturn = () => { if (!this._unloaded) this.setData({ saving: false, error: '信息已保存，请返回“我的”查看' }); };
    if (getCurrentPages().length > 1) wx.navigateBack({ fail: failedToReturn });
    else wx.switchTab({ url: '/pages/me/index', fail: failedToReturn });
  },
  onUnload() {
    this._unloaded = true;
    (this._createdAvatars || []).forEach(removeLocalAvatar);
  }
});
