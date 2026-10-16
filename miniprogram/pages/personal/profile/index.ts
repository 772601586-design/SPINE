import {
  DIAGNOSIS_LABELS, DIAGNOSIS_OPTIONS, MANAGEMENT_OPTIONS, currentMonth, labelOf, labelsOf, todayDate,
  type Option,
  GENDER_OPTIONS, MENARCHE_OPTIONS, treatmentStage,
} from '../../../config/profile-options';
import type { BodyMeasurement, Profile } from '../../../models/types';
import { api } from '../../../services/api';
import { ApiError } from '../../../services/request';
import { requireOnboarded } from '../../../services/session';

/**
 * 我的档案（规格 §2.1 /personal/profile）。
 *
 * 两个真源各管一段：基础资料在 `Profile`（带 `revision` 防覆盖），身高体重是
 * 一条条 `BodyMeasurement` 历史记录。界面按这个结构呈现，**不把最新体重写回档案**，
 * 否则同一个数字会有两个源头，早晚对不上。
 */
interface MethodOption extends Option { checked: boolean }

function dateText(value: string): string { return value ? value.slice(0, 10) : ''; }

function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return '档案已在别处更新，请重新加载后再保存。';
    return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return '网络暂时不可用，请稍后重试。';
}

Page({
  data: {
    loading: true,
    blocking: '',
    error: '',
    saving: false,
    conflict: false,
    profile: null as Profile | null,
    profileStatusText: '',
    needsXray: false,
    revision: 0,
    nickname: '',
    birthMonth: '',
    gender: '', genderCustom: '', menarche: '', treatmentLabel: '',
    genders: GENDER_OPTIONS, menarcheOptions: MENARCHE_OPTIONS,
    diagnosisIndex: 0,
    diagnosisLabels: DIAGNOSIS_LABELS,
    methods: MANAGEMENT_OPTIONS.map(item => ({ ...item, checked: false })) as MethodOption[],
    notes: '',
    methodsText: '',
    diagnosisText: '',
    latestText: '',
    todayMonth: currentMonth(),
    today: todayDate(),

    measurements: [] as Array<Record<string, unknown>>,
    measureOpen: false,
    measureDate: todayDate(),
    measureHeight: '',
    measureWeight: '',
    measureNotes: '',
    savingMeasure: false,
    measureError: '',
  },

  onShow() { void this.reload(); },

  async reload() {
    if (!await requireOnboarded()) return;
    this.setData({ loading: true, error: '', conflict: false });
    try {
      const [profile, measurements] = await Promise.all([api.profile(), api.bodyMeasurements()]);
      this.fill(profile);
      this.setData({ measurements: this.shapeMeasurements(measurements), loading: false });
    } catch (error) {
      this.setData({ loading: false, blocking: messageFor(error) });
    }
  },

  fill(profile: Profile) {
    const methods = MANAGEMENT_OPTIONS.map(item => ({
      ...item, checked: profile.management_methods.includes(item.value),
    }));
    const index = Math.max(0, DIAGNOSIS_OPTIONS.findIndex(item => item.value === (profile.diagnosis_status ?? '')));
    const latest = profile.latest_measurement;
    this.setData({
      profile, revision: profile.revision,
      profileStatusText: profile.onboarding_status === 'complete' ? '建档资料已确认'
        : profile.onboarding_status === 'needs_update' ? '待补充本人已有的 X 光影像' : '档案草稿，尚未完成确认',
      needsXray: profile.onboarding_status !== 'complete',
      nickname: profile.nickname,
      birthMonth: profile.birth_month || '',
      gender: profile.gender, genderCustom: profile.gender_custom, menarche: profile.menarche_status,
      treatmentLabel: treatmentStage(profile.treatment_stage).label,
      diagnosisIndex: index,
      diagnosisText: labelOf(DIAGNOSIS_OPTIONS, profile.diagnosis_status),
      methods,
      methodsText: labelsOf(MANAGEMENT_OPTIONS, profile.management_methods),
      notes: profile.notes,
      latestText: latest
        ? `最近一次 ${dateText(latest.measured_at)}：身高 ${latest.height_cm ?? '未填'} cm，体重 ${latest.weight_kg ?? '未填'} kg`
        : '还没有测量记录。',
    });
  },

  shapeMeasurements(items: BodyMeasurement[]): Array<Record<string, unknown>> {
    return items.map(item => ({
      id: item.id,
      date: dateText(item.measured_at),
      height: item.height_cm ?? '—',
      weight: item.weight_kg ?? '—',
      notes: item.notes,
    }));
  },

  onNickname(event: { detail: { value: string } }) { this.setData({ nickname: event.detail.value }); },
  onBirthMonth(event: { detail: { value: string } }) { this.setData({ birthMonth: event.detail.value }); },
  chooseGender(event: { currentTarget: { dataset: { value: string } } }) {
    const gender = event.currentTarget.dataset.value;
    this.setData({ gender, genderCustom: gender === 'custom' ? this.data.genderCustom : '' });
  },
  onGenderCustom(event: { detail: { value: string } }) { this.setData({ genderCustom: event.detail.value }); },
  chooseMenarche(event: { currentTarget: { dataset: { value: string } } }) {
    this.setData({ menarche: event.currentTarget.dataset.value });
  },
  openTreatment() { wx.navigateTo({ url: '/pages/treatment-stage/index' }); },
  onDiagnosis(event: { detail: { value: string } }) {
    const index = Number(event.detail.value);
    this.setData({ diagnosisIndex: index, diagnosisText: DIAGNOSIS_OPTIONS[index]?.label ?? '' });
  },
  onNotes(event: { detail: { value: string } }) { this.setData({ notes: event.detail.value }); },
  clearBirthMonth() { this.setData({ birthMonth: '' }); },

  toggleMethod(event: { currentTarget: { dataset: { index: number } } }) {
    const index = Number(event.currentTarget.dataset.index);
    const methods = this.data.methods.map((item, position) =>
      position === index ? { ...item, checked: !item.checked } : item);
    this.setData({ methods });
  },

  async save() {
    if (this.data.saving) return;
    const nickname = this.data.nickname.trim();
    if (nickname.length === 0) { this.setData({ error: '昵称不能为空。' }); return; }
    const payload: Record<string, unknown> = {
      nickname,
      birth_month: this.data.birthMonth,
      gender: this.data.gender, gender_custom: this.data.genderCustom.trim(), menarche_status: this.data.menarche,
      diagnosis_status: DIAGNOSIS_OPTIONS[this.data.diagnosisIndex]?.value ?? '',
      management_methods: this.data.methods.filter(item => item.checked).map(item => item.value),
      notes: this.data.notes.trim(),
      expected_revision: this.data.revision,
    };
    this.setData({ saving: true, error: '', conflict: false });
    try {
      const saved = await api.saveProfile(payload);
      this.fill(saved);
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (error) {
      this.setData({ error: messageFor(error), conflict: error instanceof ApiError && error.status === 409 });
    } finally {
      this.setData({ saving: false });
    }
  },

  toggleMeasureForm() { this.setData({ measureOpen: !this.data.measureOpen, measureError: '' }); },
  onMeasureDate(event: { detail: { value: string } }) { this.setData({ measureDate: event.detail.value }); },
  onMeasureHeight(event: { detail: { value: string } }) { this.setData({ measureHeight: event.detail.value }); },
  onMeasureWeight(event: { detail: { value: string } }) { this.setData({ measureWeight: event.detail.value }); },
  onMeasureNotes(event: { detail: { value: string } }) { this.setData({ measureNotes: event.detail.value }); },

  async addMeasurement() {
    if (this.data.savingMeasure) return;
    const height = this.data.measureHeight.trim();
    const weight = this.data.measureWeight.trim();
    if (!height && !weight) { this.setData({ measureError: '身高和体重至少要填一项。' }); return; }
    const payload: Record<string, unknown> = {
      // 只选到日，落库按当天正午（+08:00）：既保证"当天"语义，也不受设备时区影响。
      measured_at: `${this.data.measureDate}T12:00:00+08:00`,
      source: 'self',
    };
    if (height) payload.height_cm = height;
    if (weight) payload.weight_kg = weight;
    const notes = this.data.measureNotes.trim();
    if (notes) payload.notes = notes;

    this.setData({ savingMeasure: true, measureError: '' });
    try {
      await api.addBodyMeasurement(payload);
      this.setData({ measureHeight: '', measureWeight: '', measureNotes: '', measureOpen: false });
      await this.reload();
    } catch (error) {
      this.setData({ measureError: messageFor(error) });
    } finally {
      this.setData({ savingMeasure: false });
    }
  },

  openVisits() { wx.navigateTo({ url: '/pages/personal/visits/index' }); },
  continueOnboarding() { wx.navigateTo({ url: '/pages/onboarding/profile/index?edit=1' }); },
});
