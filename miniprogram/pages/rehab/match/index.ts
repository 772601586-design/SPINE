import type { PersonalActionCard } from '../../../models/types';
import { api } from '../../../services/api';
import { requireOnboarded } from '../../../services/session';
import { listRecordings, matchRecording, type RecordingView } from '../../../services/local-recordings';
import { doseText } from '../../../services/presentation';
import { recordingMatchReason } from '../../../services/recording-suggestions';

Page({
  data: { id: '', loading: true, saving: false, error: '', selected: 0,
    recording: null as RecordingView | null, cards: [] as Array<PersonalActionCard & { dose: string; reason: string }> },
  onLoad(query: { id?: string }) { this.setData({ id: query.id || '' }); void this.reload(); },
  async reload() {
    if (!await requireOnboarded()) return;
    this.setData({ loading: true, error: '', recording: null, cards: [] });
    try {
      const [recordings, plan] = await Promise.all([listRecordings(), api.trainingPlan()]);
      const recording = recordings.find(item => item.id === this.data.id);
      if (!recording) throw new Error('这段录像已移除，请返回列表重新选择。');
      this.setData({ recording, selected: recording.cardId || 0,
        cards: (plan?.cards || []).map(card => ({ ...card, dose: doseText(card), reason: recordingMatchReason(recording.title, card.name, card.source_title) }))
          .sort((a, b) => Number(!!b.reason) - Number(!!a.reason)) });
    } catch (error) { this.setData({ error: error instanceof Error ? error.message : '配对资料暂时无法读取。' }); }
    finally { this.setData({ loading: false }); }
  },
  select(event: { currentTarget: { dataset: { id: number } } }) {
    if (!this.data.saving) this.setData({ selected: Number(event.currentTarget.dataset.id) });
  },
  async save() {
    if (this.data.saving || !this.data.selected || !this.data.recording?.available) return;
    this.setData({ saving: true, error: '' });
    try {
      const card = await api.actionCard(this.data.selected);
      if (!card.active) throw new Error('动作卡已被移除，请重新选择。');
      await matchRecording(this.data.id, card.id);
      wx.showToast({ title: '录像已配到动作', icon: 'success' });
      wx.navigateBack({ delta: 1 });
    } catch (error) { this.setData({ error: error instanceof Error ? error.message : '保存配对失败，请重试。' }); }
    finally { this.setData({ saving: false }); }
  },
  onVideoError() { this.setData({ error: '视频暂时无法播放，请返回列表检查或重新录制。' }); },
  openLibrary() { wx.navigateTo({ url: '/pages/rehab/exercises/index' }); },
  returnToList() { wx.navigateBack({ delta: 1 }); },
});
