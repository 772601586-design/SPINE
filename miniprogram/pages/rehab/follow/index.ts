import type { TrainingAttempt } from '../../../models/types';
import { api } from '../../../services/api';
import { requireOnboarded } from '../../../services/session';
import { Rhythm } from '../../../services/rhythm';
import { speakRhythm, stopRhythmAudio } from '../../../services/rhythm-audio';

interface PendingSet { set_index: number; client_request_id: string; actual_reps: number | null; actual_breaths: number | null; actual_hold_seconds: number | null; confirmation_source: 'guided' }
let audio: WxInnerAudioContext | null = null;
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const random = Math.random() * 16 | 0;
    return (char === 'x' ? random : (random & 0x3 | 0x8)).toString(16);
  });
}
Page({
  data: { id: 0, loading: true, syncing: false, finishing: false, changingState: false, error: '', pending: false, savedSet: false,
    attempt: null as TrainingAttempt | null, latestSet: null as Record<string, unknown> | null,
    rhythmValue: 0, rhythmProgress: 0, rhythmRunning: false, rhythmFinished: false, rhythmUnit: '', stepSeconds: '3', rhythmVoice: true,
    actual: { reps: '', breaths: '', hold: '' } },
  async onLoad(query: { id?: string }) { if (!await requireOnboarded()) return; this.setData({ id: Number(query.id) }); await this.load(); },
  async onShow() {
    if (!this._loaded) return;
    if (this._pausePromise) await this._pausePromise;
    await this.load(true);
  },
  onHide() { this.pauseRhythm(); this.pauseWhenLeaving(); if (audio) audio.stop(); },
  pauseWhenLeaving() {
    if (this._pausePromise || this.data.finishing || this.data.attempt?.status !== 'in_progress') return;
    this._pausePromise = (async () => {
      try { this.setData({ attempt: await api.pauseAttempt(this.data.id) }); }
      catch (_) { /* The next onShow fetches the authoritative status. */ }
      finally { this._pausePromise = null; }
    })();
  },
  async load(preserveActual = false) {
    this.setData({ loading: true, error: '' });
    try {
      const attempt = await api.attempt(this.data.id);
      this.setData({ attempt, savedSet: attempt.completed_sets >= attempt.planned_dose.sets,
        actual: preserveActual ? this.data.actual : { reps: String(attempt.planned_dose.reps_per_set ?? ''),
          breaths: String(attempt.planned_dose.breaths_per_set ?? ''), hold: String(attempt.planned_dose.hold_seconds ?? '') } });
    }
    catch (error) { this.setData({ error: error instanceof Error ? error.message : '无法读取训练进度' }); }
    finally { this._loaded = true; this.setData({ loading: false }); }
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
    if (this.data.syncing || this.data.finishing || !this.data.attempt || this.data.attempt.status !== 'in_progress') return;
    this.pauseRhythm();
    const pending = wx.getStorageSync(this.pendingKey()) as PendingSet | '';
    const record = pending || this.makePending();
    if (!record) return;
    const values = [record.actual_reps, record.actual_breaths, record.actual_hold_seconds];
    if (!values.some(value => value !== null && value > 0)
      || values.some((value, index) => value !== null && (!Number.isInteger(value) || value < 0 || value > (index === 2 ? 3600 : 500)))) {
      this.setData({ error: '请填写有效的实际完成量：次数不超过 500，保持秒数不超过 3600。' }); return;
    }
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
      const attempt = await api.attempt(this.data.id);
      wx.removeStorageSync(this.pendingKey());
      this.setData({ attempt, pending: false, latestSet: result, savedSet: showSaved });
      if (showSaved) wx.showToast({ title: '本组打卡成功', icon: 'success' });
    } catch (error) {
      this.setData({ pending: true, savedSet: false, error: error instanceof Error ? error.message : '本组已保存到设备，等待同步' });
    } finally { this.setData({ syncing: false }); }
  },
  async pauseResume() {
    const attempt = this.data.attempt;
    if (!attempt || this.data.changingState || this.data.syncing || this.data.finishing) return;
    this.pauseRhythm();
    this.setData({ changingState: true });
    try {
      const updated = attempt.status === 'paused' ? await api.resumeAttempt(attempt.id) : await api.pauseAttempt(attempt.id);
      this.setData({ attempt: updated });
    } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '操作失败', icon: 'none' }); }
    finally { this.setData({ changingState: false }); }
  },
  async finish() {
    if (!this.data.attempt || this.data.pending || this.data.syncing || this.data.finishing || this.data.changingState) return;
    this.pauseRhythm();
    this.setData({ finishing: true });
    try {
      const result = await api.finishAttempt(this.data.attempt.id);
      this.setData({ attempt: result });
      this.openSummary();
    } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '结束失败，请重试', icon: 'none' }); }
    finally { this.setData({ finishing: false }); }
  },
  openSummary() { wx.redirectTo({ url: `/pages/rehab/done/index?id=${this.data.id}` }); },
  retrySync() { void this.syncPending(true); },
  continueNext() { this.resetRhythm(); this.setData({ savedSet: false, latestSet: null }); },
  inputStep(event: { detail: { value: string } }) { this.resetRhythm(); this.setData({ stepSeconds: event.detail.value }); },
  toggleRhythmVoice() { this.setData({ rhythmVoice: !this.data.rhythmVoice }); if (!this.data.rhythmVoice) stopRhythmAudio(); },
  startRhythm() {
    if (this.data.attempt?.status !== 'in_progress' || this.data.rhythmRunning) return;
    const dose = this.data.attempt.planned_dose;
    if (!this._rhythm) {
      const mode = dose.hold_seconds ? 'timer' : 'count';
      const total = dose.hold_seconds || dose.reps_per_set || dose.breaths_per_set || 0;
      const seconds = Number(this.data.stepSeconds);
      if (!total || !Number.isFinite(seconds) || seconds < 1 || seconds > 60) {
        this.setData({ error: '请设置每次节奏 1～60 秒。' }); return;
      }
      this._rhythm = new Rhythm(total, seconds, mode);
      this.setData({ rhythmUnit: mode === 'timer' ? '秒' : dose.reps_per_set ? '次' : '次呼吸' });
    }
    if (this.data.rhythmFinished) this.resetRhythm();
    if (!this._rhythm) { this.startRhythm(); return; }
    this._rhythm.start(Date.now());
    if (this.data.rhythmVoice) speakRhythm('begin');
    clearInterval(this._rhythmTimer);
    this._rhythmTimer = setInterval(() => this.updateRhythm(), 200);
    this.updateRhythm();
  },
  updateRhythm() {
    if (!this._rhythm) return;
    const state = this._rhythm.state(Date.now());
    const changed = state.value !== this.data.rhythmValue;
    if (changed && this.data.rhythmVoice && (this.data.rhythmUnit !== '秒' || state.value <= 5)) speakRhythm(state.value);
    this.setData({ rhythmValue: state.value, rhythmProgress: Math.round(state.progress), rhythmRunning: state.running, rhythmFinished: state.finished });
    if (state.finished) {
      clearInterval(this._rhythmTimer);
      if (this.data.rhythmVoice) speakRhythm('done');
      wx.showToast({ title: '节奏结束，请确认实际完成量', icon: 'none' });
    }
  },
  pauseRhythm() { if (this._rhythm) this._rhythm.pause(Date.now()); clearInterval(this._rhythmTimer); stopRhythmAudio(); this.setData({ rhythmRunning: false }); },
  resetRhythm() { this.pauseRhythm(); this._rhythm = null; this.setData({ rhythmValue: 0, rhythmProgress: 0, rhythmFinished: false }); },
  playVoice() {
    const clip = this.data.attempt?.voice_media?.[0];
    if (!clip) { wx.showToast({ title: '该动作尚无已审核语音指导', icon: 'none' }); return; }
    if (audio) { audio.stop(); audio.destroy(); }
    audio = wx.createInnerAudioContext();
    audio.src = clip.url;
    audio.onError(() => wx.showToast({ title: '语音暂时无法播放', icon: 'none' }));
    audio.play();
  },
  onUnload() { this.pauseRhythm(); this.pauseWhenLeaving(); if (audio) { audio.stop(); audio.destroy(); audio = null; } },
});
