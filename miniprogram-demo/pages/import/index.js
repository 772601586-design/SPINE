const t = require('../../core/training');
Page({
  data: { id: '', cards: [], images: [], busy: false, error: '' },
  onLoad(query) { this.setData({ id: query.card || '', cards: t.load().cards }); this.reload(); },
  reload() { const card = t.load().cards.find(item => item.id === this.data.id); this.setData({ images: card && card.prescriptions || [] }); },
  selectCard(e) { const card = this.data.cards[Number(e.detail.value)]; if (card) { this.setData({ id: card.id }); this.reload(); } },
  createCard() { try { const card = t.saveCard({ name: '待整理动作', sets: '', amount: '', mode: 'count' }, false); this.setData({ id: card.id, cards: t.load().cards }); this.reload(); } catch (error) { this.setData({ error: error.message }); } },
  chooseImage() {
    if (!this.data.id) { this.setData({ error: '请先选择要补充资料的动作卡，或新建草稿。' }); return; }
    if (this.data.busy || this.data.images.length >= 10) return;
    wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['camera', 'album'], success: result => {
      const file = result.tempFiles[0]; if (!file) return;
      this.setData({ busy: true, error: '' });
      const extension = /\.png$/i.test(file.tempFilePath) ? '.png' : '.jpg';
      const target = wx.env.USER_DATA_PATH + '/' + t.id('prescription') + extension;
      wx.getFileSystemManager().copyFile({ srcPath: file.tempFilePath, destPath: target,
        success: () => { try { const card = t.load().cards.find(item => item.id === this.data.id); if (!card) throw Error('动作卡不存在'); t.saveCard(Object.assign({}, card, { prescriptions: (card.prescriptions || []).concat(target) }), card.confirmed); this.reload(); wx.showToast({ title: '原件已保存到本机', icon: 'success' }); } catch (error) { this.setData({ error: error.message }); } this.setData({ busy: false }); },
        fail: () => this.setData({ busy: false, error: '原件保存失败，请重试。' }) });
    } });
  },
  preview(e) { wx.previewImage({ current: e.currentTarget.dataset.path, urls: this.data.images }); },
  finish() { if (this.data.id) wx.redirectTo({ url: '/pages/card/index?id=' + this.data.id }); },
});
