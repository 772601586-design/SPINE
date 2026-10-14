import type { TrainingAttempt } from '../../../models/types';
import { api } from '../../../services/api';
import { requireOnboarded } from '../../../services/session';

interface PendingSet { set_index: number; client_request_id: string; actual_reps: number | null; actual_breaths: number | null; actual_hold_seconds: number | null; confirmation_source: 'guided' }
let audio: WxInnerAudioContext | null = null;
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const random = Math.random() * 16 | 0;
    return (char === 'x' ? random : (random & 0x3 | 0x8)).toString(16);
  });
}
Page({
  data: { id: 0, loading: true, syncing: false, error: '', pending: false, savedSet: false,
    attempt: null as TrainingAttempt | null, latestSet: null as Record<string, unknown> | null,
    actual: { reps: '', breaths: '', hold: '' } },
  async onLoad(query: { id?: string }) { if (!await requireOnboarded()) return; this.setData({ id: Number(query.id) }); await this.load(); },
  onHide() { if (this.data.attempt?.status === 'in_progress') void api.pauseAttempt(this.data.id).catch(() => undefined); },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const attempt = await api.attempt(this.data.id);
      this.setData({ attempt, actual: { reps: String(attempt.planned_dose.reps_per_set ?? ''),
        breaths: String(attempt.planned_dose.breaths_per_set ?? ''), hold: String(attempt.planned_dose.hold_seconds ?? '') } });
    }
    catch (error) { this.setData({ error: error instanceof Error ? error.message : '无法读取训练进度' }); }
    finally { this.setData({ loading: false }); }
    if (wx.getStorageSync(this.pendingKey())) await this.syncPending(true);
  },
  pendingKey() { return `spine.training.pending-set.${this.data.id}`; },
  currentSet() { return (this.data.attempt?.completed_sets ?? 0) + 1; },
  makePending(): PendingSet | null {
    const attempt = this.data.attempt;
    if (!attempt) return null;
    return {
      set_index: this.currentSet(), client_request_id: uuid(),
      actual_reps: this.numberOrNull(this.data.actual.reps), actual_breaths: this.numberOrNull(this.data.actual.breaths),
      actual_hold_seconds: this.numberOrNull(this.data.actual.hold), confirmation_source: 'guided',
    };
  },
  numberOrNull(value: string) { return value.trim() ? Number(value) : null; },
  inputActual(event: { currentTarget: { dataset: { field: 'reps' | 'breaths' | 'hold' } }; detail: { value: string } }) {
    this.setData({ [`actual.${event.currentTarget.dataset.field}`]: event.detail.value });
  },
  async completeSet() {
    if (this.data.syncing || !this.data.attempt || this.data.attempt.status !== 'in_progress') return;
    const pending = wx.getStorageSync(this.pendingKey()) as PendingSet | '';
    const record = pending || this.makePending();
    if (!record) return;
    if (!pending) wx.setStorageSync(this.pendingKey(), record);
    await this.syncPending(true);
  },
  async syncPending(showSaved = false) {
    if (this.data.syncing) return;
    const pending = wx.getStorageSync(this.pendingKey()) as PendingSet | '';
    if (!pending) return;
    this.setData({ syncing: true, pending: true, error: '' });
    try {
      const result = await api.completeSet(this.data.id, pending as unknown as Record<string, unknown>);
      wx.removeStorageSync(this.pendingKey());
      const attempt = await api.attempt(this.data.id);
      this.setData({ attempt, pending: false, latestSet: result, savedSet: showSaved });
      if (showSaved) wx.showToast({ title: '本组打卡成功', icon: 'success' });
    } catch (error) {
      this.setData({ pending: true, savedSet: false, error: error instanceof Error ? error.message : '本组已保存到设备，等待同步' });
    } finally { this.setData({ syncing: false }); }
  },
  async pauseResume() {
    const attempt = this.data.attempt;
    if (!attempt) return;
    try {
      const updated = attempt.status === 'paused' ? await api.resumeAttempt(attempt.id) : await api.pauseAttempt(attempt.id);
      this.setData({ attempt: updated });
    } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' }); }
  },
  async finish() {
    if (!this.data.attempt || this.data.pending) return;
    try {
      const result = await api.finishAttempt(this.data.attempt.id);
      wx.showModal({ title: result.status === 'completed' ? '本次训练已完成' : '本次训练已保存',
        content: result.status === 'completed' ? '本次训练记录已保存。' : '已保存实际完成量，本次标记为部分完成。',
        showCancel: false, success: () => wx.navigateBack({ delta: 2 }) });
    } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '结束失败，请重试', icon: 'none' }); }
  },
  retrySync() { void this.syncPending(true); },
  continueNext() { this.setData({ savedSet: false, latestSet: null }); },
  playVoice() {
    const clip = this.data.attempt?.voice_media?.[0];
    if (!clip) { wx.showToast({ title: '该动作尚无已审核语音指导', icon: 'none' }); return; }
    if (audio) { audio.stop(); audio.destroy(); }
    audio = wx.createInnerAudioContext();
    audio.src = clip.url;
    audio.onError(() => wx.showToast({ title: '语音暂时无法播放', icon: 'none' }));
    audio.play();
  },
  onUnload() { if (audio) { audio.stop(); audio.destroy(); audio = null; } },
});
