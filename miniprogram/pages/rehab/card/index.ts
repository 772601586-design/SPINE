import type { PersonalActionCard } from '../../../models/types';
import { api } from '../../../services/api';
import { requireOnboarded } from '../../../services/session';

type Field = 'sets' | 'reps_per_set' | 'breaths_per_set' | 'hold_seconds' | 'rest_seconds' | 'personal_notes';
Page({
  data: { id: 0, card: null as PersonalActionCard | null, loading: true, saving: false, error: '',
    sides: [
      { code: 'left', label: '左侧' }, { code: 'right', label: '右侧' }, { code: 'bilateral', label: '双侧' },
      { code: 'alternating', label: '交替' }, { code: 'not_applicable', label: '不适用' }, { code: 'individualized', label: '个体方向' },
    ],
    form: { sets: '', reps_per_set: '', breaths_per_set: '', hold_seconds: '', rest_seconds: '', side: '', personal_notes: '' } },
  async onLoad(query: { id?: string }) {
    if (!await requireOnboarded()) return;
    this.setData({ id: Number(query.id) });
    await this.load();
  },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const card = await api.actionCard(this.data.id);
      this.setData({ card, form: {
        sets: String(card.sets ?? ''), reps_per_set: String(card.reps_per_set ?? ''),
        breaths_per_set: String(card.breaths_per_set ?? ''), hold_seconds: String(card.hold_seconds ?? ''),
        rest_seconds: String(card.rest_seconds ?? ''), side: card.side,
        personal_notes: card.personal_notes,
      } });
    } catch (error) { this.setData({ error: error instanceof Error ? error.message : '无法读取动作卡' }); }
    finally { this.setData({ loading: false }); }
  },
  input(event: { currentTarget: { dataset: { field: Field } }; detail: { value: string } }) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: event.detail.value });
  },
  chooseSide(event: { currentTarget: { dataset: { value: string } } }) {
    this.setData({ form: { ...this.data.form, side: event.currentTarget.dataset.value } });
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
    };
    try {
      const card = await api.updateActionCard(this.data.card.id, payload);
      this.setData({ card });
      wx.showToast({ title: card.verification_status === 'ready' ? '参数已保存并核对' : confirmed ? '已保存，请补齐必要参数' : '草稿已保存', icon: card.verification_status === 'ready' ? 'success' : 'none' });
    } catch (error) {
      this.setData({ error: error instanceof Error ? error.message : '保存失败，请重试' });
    } finally { this.setData({ saving: false }); }
  },
  saveDraft() { void this.save(false); },
  confirmParameters() { void this.save(true); },
  async start() {
    if (!this.data.card || this.data.saving) return;
    if (this.data.card.verification_status !== 'ready') {
      wx.showToast({ title: '请先保存并核对必要参数', icon: 'none' }); return;
    }
    try {
      const attempt = await api.startAttempt(this.data.card.id);
      wx.navigateTo({ url: `/pages/rehab/follow/index?id=${attempt.id}` });
    } catch (error) { wx.showToast({ title: error instanceof Error ? error.message : '暂时不能开始训练', icon: 'none' }); }
  },
});
