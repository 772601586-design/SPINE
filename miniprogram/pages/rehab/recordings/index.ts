import { requireOnboarded } from '../../../services/session';
import { api } from '../../../services/api';
import { listRecordings, saveRecording, removeRecording, matchRecording, type RecordingView } from '../../../services/local-recordings';

Page({
  data: { loading: true, saving: false, choosing: false, busyId: '', error: '', title: '',
    targetCardId: 0, kind: 'demonstration' as 'demonstration' | 'practice',
    file: null as WxMediaFile | null, recordings: [] as Array<RecordingView & { dateLabel: string; sizeLabel: string }>,
    pendingCount: 0 },
  onLoad(query: { cardId?: string; kind?: string }) {
    const cardId = Number(query.cardId);
    this.setData({ targetCardId: Number.isInteger(cardId) && cardId > 0 ? cardId : 0,
      kind: query.kind === 'practice' ? 'practice' : 'demonstration' });
  },
  onShow() { void this.reload(); },
  async reload() {
    if (!await requireOnboarded()) return;
    this.setData({ loading: true, error: '' });
    try {
      const records = await listRecordings(this.data.targetCardId || undefined);
      this.setData({ recordings: records.map(item => ({ ...item,
        dateLabel: new Date(Date.parse(item.createdAt) + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' '),
        sizeLabel: `${(item.size / 1024 / 1024).toFixed(1)} MB` })),
        pendingCount: records.filter(item => item.cardId === null).length });
    } catch (error) { this.setData({ error: error instanceof Error ? error.message : '本机录像读取失败。' }); }
    finally { this.setData({ loading: false }); }
  },
  onTitle(event: { detail: { value: string } }) { this.setData({ title: event.detail.value }); },
  chooseKind(event: { currentTarget: { dataset: { kind: string } } }) {
    if (this.data.saving) return;
    const kind = event.currentTarget.dataset.kind;
    if (kind === 'practice' || kind === 'demonstration') this.setData({ kind });
  },
  chooseCamera() { this.chooseVideo('camera'); },
  chooseAlbum() { this.chooseVideo('album'); },
  chooseVideo(source: 'camera' | 'album') {
    if (this.data.saving || this.data.choosing) return;
    this.setData({ choosing: true, error: '' });
    wx.chooseMedia({ count: 1, mediaType: ['video'], sourceType: [source],
      success: result => {
        const file = result.tempFiles[0];
        if (file) this.setData({ file, title: '' });
        this.setData({ choosing: false });
      },
      fail: error => {
        this.setData({ choosing: false });
        if (!/cancel/i.test(error.errMsg)) this.setData({ error: '未能获取录像，请检查相机、相册权限或重试。' });
      },
    });
  },
  async save() {
    if (!this.data.file || this.data.saving) return;
    this.setData({ saving: true, error: '' });
    try {
      if (this.data.targetCardId) {
        const card = await api.actionCard(this.data.targetCardId);
        if (!card.active) throw new Error('动作已移除，请从训练页重新选择。');
      }
      await saveRecording(this.data.file, this.data.title, {
        kind: this.data.kind, cardId: this.data.targetCardId || undefined,
      });
      this.setData({ file: null, title: '' });
      wx.showToast({ title: '已保存到本机', icon: 'success' });
      await this.reload();
    } catch (error) { this.setData({ error: error instanceof Error ? error.message : '保存失败，录像尚未保存。' }); }
    finally { this.setData({ saving: false }); }
  },
  discardSelection() { if (!this.data.saving) this.setData({ file: null, title: '' }); },
  openMatch(event: { currentTarget: { dataset: { id: string } } }) {
    wx.navigateTo({ url: `/pages/rehab/match/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` });
  },
  onVideoError() { this.setData({ error: '这段视频暂时无法播放，请检查文件或重新选择兼容的视频。' }); },
  async unmatch(event: { currentTarget: { dataset: { id: string } } }) {
    if (this.data.busyId) return;
    const id = event.currentTarget.dataset.id;
    this.setData({ busyId: id, error: '' });
    try { await matchRecording(id, null); await this.reload(); }
    catch (error) { this.setData({ error: error instanceof Error ? error.message : '取消匹配失败。' }); }
    finally { this.setData({ busyId: '' }); }
  },
  async remove(event: { currentTarget: { dataset: { id: string } } }) {
    if (this.data.busyId) return;
    const id = event.currentTarget.dataset.id;
    this.setData({ busyId: id, error: '' });
    try {
      const confirm = await new Promise<boolean>(resolve => wx.showModal({ title: '删除这段录像？',
        content: '将删除本机保存的这段录像及配对关系。动作卡片和训练记录会保留。',
        success: result => resolve(result.confirm), fail: () => resolve(false) }));
      if (!confirm) return;
      await removeRecording(id);
      await this.reload();
    } catch (error) { this.setData({ error: error instanceof Error ? error.message : '删除失败，请重试。' }); }
    finally { this.setData({ busyId: '' }); }
  },
});
