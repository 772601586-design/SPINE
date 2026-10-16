import type { PersonalActionCard } from '../../../models/types';
import { api } from '../../../services/api';
import { requireOnboarded } from '../../../services/session';
import { listRecordings, type RecordingView } from '../../../services/local-recordings';
import { doseText } from '../../../services/presentation';

type Field = 'sets' | 'reps_per_set' | 'breaths_per_set' | 'hold_seconds' | 'rest_seconds' | 'personal_notes';
Page({
  data: { id: 0, card: null as PersonalActionCard | null, loading: true, saving: false, starting: false, dirty: false, error: '',
    localVideos: [] as RecordingView[], videoError: '',
    tab: 'learn', editing: false, doseLabel: '', sideLabel: '',
    tabs: [{value: 'learn', label: '学 · 看示范'}, {value: 'practice', label: '练 · 按计划'}, {value: 'check', label: '查 · 看变化'}],
    practiceVideos: [] as RecordingView[],
    demoOptions: [] as Array<RecordingView & { label: string }>, practiceOptions: [] as Array<RecordingView & { label: string }>,
    demoIndex: 0, practiceIndex: 0, missingVideoCount: 0,
    sides: [
      { code: 'left', label: '左侧' }, { code: 'right', label: '右侧' }, { code: 'bilateral', label: '双侧' },
      { code: 'alternating', label: '交替' }, { code: 'not_applicable', label: '不适用' }, { code: 'individualized', label: '个体方向' },
    ],
    frequencies: [{value: '', label: '暂不排入今日'}, {value: 'daily', label: '每天'}, {value: 'alternate', label: '隔天'}],
    form: { sets: '', reps_per_set: '', breaths_per_set: '', hold_seconds: '', rest_seconds: '', side: '', personal_notes: '', schedule_frequency: '' } },
  async onLoad(query: { id?: string }) {
    if (!await requireOnboarded()) return;
    this.setData({ id: Number(query.id) });
    await this.load();
    await this.loadLocalVideos();
  },
  onShow() { if (this.data.id) void this.loadLocalVideos(); },
  async loadLocalVideos() {
    try {
      const recordings = await listRecordings(this.data.id);
      const demoId = this.data.demoOptions[this.data.demoIndex]?.id;
      const practiceId = this.data.practiceOptions[this.data.practiceIndex]?.id;
      const localVideos = recordings.filter(item => item.kind === 'demonstration');
      const practiceVideos = recordings.filter(item => item.kind === 'practice');
      const options = (items: RecordingView[]) => items.filter(item => item.available).map(item => ({ ...item,
        label: `${item.title} · ${new Date(Date.parse(item.createdAt) + 8 * 3600000).toISOString().slice(0, 10)}` }));
      const demoOptions = options(localVideos);
      const practiceOptions = options(practiceVideos);
      this.setData({ localVideos, practiceVideos, demoOptions, practiceOptions, videoError: '',
        demoIndex: Math.max(0, demoOptions.findIndex(item => item.id === demoId)),
        practiceIndex: Math.max(0, practiceOptions.findIndex(item => item.id === practiceId)),
        missingVideoCount: recordings.filter(item => !item.available).length });
    } catch (_) { this.setData({ localVideos: [], practiceVideos: [], demoOptions: [], practiceOptions: [],
      videoError: '本机录像暂时无法读取，请到录像列表重试。' }); }
  },
  selectTab(event: { currentTarget: { dataset: { value: string } } }) {
    const tab = event.currentTarget.dataset.value;
    if (['learn', 'practice', 'check'].includes(tab)) this.setData({ tab });
  },
  toggleEditing() { this.setData({ editing: !this.data.editing }); },
  chooseComparison(event: { currentTarget: { dataset: { kind: string } }; detail: { value: string } }) {
    const index = Number(event.detail.value);
    const practice = event.currentTarget.dataset.kind === 'practice';
    const options = practice ? this.data.practiceOptions : this.data.demoOptions;
    if (Number.isInteger(index) && index >= 0 && index < options.length) {
      this.setData(practice ? { practiceIndex: index } : { demoIndex: index });
    }
  },
  openRecordings() { wx.navigateTo({ url: '/pages/rehab/recordings/index' }); },
  recordDemonstration() { wx.navigateTo({ url: `/pages/rehab/recordings/index?cardId=${this.data.id}&kind=demonstration` }); },
  recordPractice() { wx.navigateTo({ url: `/pages/rehab/recordings/index?cardId=${this.data.id}&kind=practice` }); },
  onLocalVideoError() { this.setData({ videoError: '本机录像暂时无法播放，请到录像列表检查文件。' }); },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const card = await api.actionCard(this.data.id);
      this.setData({ card, dirty: false, doseLabel: doseText(card),
        sideLabel: this.data.sides.find(item => item.code === card.side)?.label || '待设置', form: {
        sets: String(card.sets ?? ''), reps_per_set: String(card.reps_per_set ?? ''),
        breaths_per_set: String(card.breaths_per_set ?? ''), hold_seconds: String(card.hold_seconds ?? ''),
        rest_seconds: String(card.rest_seconds ?? ''), side: card.side,
        personal_notes: card.personal_notes,
        schedule_frequency: card.schedule_frequency,
      } });
    } catch (error) { this.setData({ error: error instanceof Error ? error.message : '无法读取动作卡' }); }
    finally { this.setData({ loading: false }); }
  },
  input(event: { currentTarget: { dataset: { field: Field } }; detail: { value: string } }) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: event.detail.value, dirty: true });
  },
  chooseSide(event: { currentTarget: { dataset: { value: string } } }) {
    this.setData({ form: { ...this.data.form, side: event.currentTarget.dataset.value }, dirty: true });
  },
  chooseFrequency(event: { currentTarget: { dataset: { value: string } } }) {
    this.setData({ form: { ...this.data.form, schedule_frequency: event.currentTarget.dataset.value }, dirty: true });
  },
  numberOrNull(value: string) { return value.trim() === '' ? null : Number(value); },
  async save(confirmed: boolean) {
    if (!this.data.card || this.data.saving) return;
    this.setData({ saving: true, error: '' });
    const form = this.data.form;
    const payload = {
      expected_revision: this.data.card.revision,
      sets: this.numberOrNull(form.sets), reps_per_set: this.numberOrNull(form.reps_per_set),
      breaths_per_set: this.numberOrNull(form.breaths_per_set), hold_seconds: this.numberOrNull(form.hold_seconds),
      rest_seconds: this.numberOrNull(form.rest_seconds), side: form.side,
      personal_notes: form.personal_notes, confirm_parameters: confirmed,
      schedule_frequency: form.schedule_frequency,
    };
    try {
      const card = await api.updateActionCard(this.data.card.id, payload);
      this.setData({ card, dirty: false, doseLabel: doseText(card),
        sideLabel: this.data.sides.find(item => item.code === card.side)?.label || '待设置' });
      wx.showToast({ title: card.verification_status === 'ready' ? '参数已保存并核对' : confirmed ? '已保存，请补齐必要参数' : '草稿已保存', icon: card.verification_status === 'ready' ? 'success' : 'none' });
    } catch (error) {
      this.setData({ error: error instanceof Error ? error.message : '保存失败，请重试' });
    } finally { this.setData({ saving: false }); }
  },
  saveDraft() { void this.save(false); },
  confirmParameters() { void this.save(true); },
  async start() {
    if (!this.data.card || this.data.saving || this.data.starting) return;
    if (this.data.dirty) { wx.showToast({ title: '请先保存并核对修改后的参数', icon: 'none' }); return; }
    if (this.data.card.verification_status !== 'ready') {
      wx.showToast({ title: '请先保存并核对必要参数', icon: 'none' }); return;
    }
    this.setData({ starting: true });
    try {
      const attempt = await api.startAttempt(this.data.card.id);
      wx.navigateTo({ url: `/pages/rehab/follow/index?id=${attempt.id}` });
    } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '暂时不能开始训练', icon: 'none' }); }
    finally { this.setData({ starting: false }); }
  },
});
