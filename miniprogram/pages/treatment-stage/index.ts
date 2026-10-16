import { TREATMENT_STAGES, treatmentStage } from '../../config/profile-options';
import { api } from '../../services/api';
import { ApiError } from '../../services/request';
import { requireOnboarded } from '../../services/session';

Page({
  data: { loading: true, saving: false, error: '', conflict: false, selected: '', revision: 0,
    stages: TREATMENT_STAGES, encouragement: treatmentStage('') },
  onLoad() { void this.reload(); },
  async reload() {
    if (!await requireOnboarded()) return;
    this.setData({ loading: true, error: '', conflict: false });
    try {
      const profile = await api.profile();
      this.setData({ selected: profile.treatment_stage, revision: profile.revision,
        encouragement: treatmentStage(profile.treatment_stage) });
    } catch (_) { this.setData({ error: '阶段资料暂时无法读取，请重试。' }); }
    finally { this.setData({ loading: false }); }
  },
  choose(event: { currentTarget: { dataset: { value: string } } }) {
    if (this.data.saving) return;
    const selected = event.currentTarget.dataset.value;
    this.setData({ selected, encouragement: treatmentStage(selected) });
  },
  async save() {
    if (this.data.saving || !this.data.revision || this.data.conflict) return;
    this.setData({ saving: true, error: '' });
    try {
      const profile = await api.saveProfile({ treatment_stage: this.data.selected, expected_revision: this.data.revision });
      this.setData({ revision: profile.revision });
      wx.showToast({ title: '阶段已保存', icon: 'success' });
      wx.navigateBack({ delta: 1 });
    } catch (error) {
      const conflict = error instanceof ApiError && error.status === 409;
      this.setData({ conflict, error: conflict ? '资料已在别处更新，请重新加载后再选择。'
        : error instanceof Error ? error.message : '保存失败，请重试。' });
    } finally { this.setData({ saving: false }); }
  },
});
