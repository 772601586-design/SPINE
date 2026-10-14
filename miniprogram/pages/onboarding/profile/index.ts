import {
  DIAGNOSIS_LABELS, DIAGNOSIS_OPTIONS, MANAGEMENT_OPTIONS, currentMonth, todayDate, type Option,
} from '../../../config/profile-options';
import { api } from '../../../services/api';
import { ApiError } from '../../../services/request';
import { getCurrentIdentity, initSession, refreshIdentity } from '../../../services/session';
import { uploadPrivateFile, type LocalFile } from '../../../services/upload';

/**
 * 首次建档（规格 §2.1 /onboarding/profile）。
 *
 * 只强制昵称，其余字段都可以留空——「能跳过」不等于「假装填过」：没填的字段一律
 * 不提交，让服务端存 NULL/空字符串，而不是替用户猜一个默认值。
 */
interface MethodOption extends Option { checked: boolean }

function fieldErrorFor(error: unknown): { message: string; fields: Record<string, string[]> } {
  if (error instanceof ApiError) {
    const fields = error.fieldErrors ?? {};
    const first = Object.values(fields)[0];
    return { message: first && first.length > 0 ? first[0] : error.message, fields };
  }
  if (error instanceof Error && error.message) return { message: error.message, fields: {} };
  return { message: '网络暂时不可用，请稍后重试。', fields: {} };
}

Page({
  data: {
    loading: true,
    ready: false,
    blocking: '',
    saving: false,
    error: '',
    fieldErrors: {} as Record<string, string[]>,
    todayMonth: currentMonth(),
    todayDate: todayDate(),
    nickname: '',
    birthMonth: '',
    diagnosisIndex: 0,
    diagnosisLabels: DIAGNOSIS_LABELS,
    methods: MANAGEMENT_OPTIONS.map(item => ({ ...item, checked: false })) as MethodOption[],
    notes: '',
    hasExtra: false,
    stage: 'profile' as 'profile' | 'xray',
    xrayConfirmed: false,
    xrayFile: null as LocalFile | null,
    xrayIsImage: false,
    xrayDatePrecision: 'unknown' as 'day' | 'month' | 'unknown',
    xrayDate: todayDate(),
    uploadingXray: false,
    visitId: '',
    isEditing: false,
  },

  async onLoad(query: Record<string, string> = {}) {
    this.setData({ isEditing: query.edit === '1' });
    this.setData({ loading: true, blocking: '' });
    const state = await initSession();
    if (state === 'signedOut') { wx.reLaunch({ url: '/pages/login/index' }); return; }
    if (state === 'unavailable') {
      this.setData({ loading: false, blocking: '暂时无法连接服务，请检查网络后重试。' });
      return;
    }
    const identity = getCurrentIdentity();
    if (identity?.onboarding_status === 'complete' && query.edit !== '1') { wx.switchTab({ url: '/pages/rehab/index' }); return; }
    if (identity?.has_profile) {
      try {
        const profile = await api.profile();
        const key = `spine.onboarding.visit:${identity.id}`;
        this.setData({ loading: false, ready: true, stage: 'xray', nickname: profile.nickname,
          birthMonth: profile.birth_month, notes: profile.notes,
          visitId: String(wx.getStorageSync(key) || '') });
      } catch (_) { this.setData({ loading: false, blocking: '暂时无法读取已保存的档案，请重试。' }); }
      return;
    }
    this.setData({ loading: false, ready: true, nickname: identity?.nickname ?? '' });
  },

  retryLoad() { void this.onLoad(this.data.isEditing ? { edit: '1' } : {}); },

  onNickname(event: { detail: { value: string } }) { this.setData({ nickname: event.detail.value }); },
  onBirthMonth(event: { detail: { value: string } }) { this.setData({ birthMonth: event.detail.value }); },
  onDiagnosis(event: { detail: { value: string } }) { this.setData({ diagnosisIndex: Number(event.detail.value) }); },
  onNotes(event: { detail: { value: string } }) { this.setData({ notes: event.detail.value }); },
  toggleExtra() { this.setData({ hasExtra: !this.data.hasExtra }); },

  toggleMethod(event: { currentTarget: { dataset: { index: number } } }) {
    const index = Number(event.currentTarget.dataset.index);
    const methods = this.data.methods.map((item, position) =>
      position === index ? { ...item, checked: !item.checked } : item);
    this.setData({ methods });
  },

  clearBirthMonth() { this.setData({ birthMonth: '' }); },

  onXrayConfirmed(event: { detail: { value: string[] } }) {
    this.setData({ xrayConfirmed: (event.detail.value || []).includes('confirmed') });
  },

  chooseXrayImage() {
    wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['original'], sourceType: ['album', 'camera'],
      success: result => {
        const file = result.tempFiles[0];
        if (file) this.setData({ xrayFile: { path: file.tempFilePath,
          name: file.tempFilePath.split('/').pop() || 'xray.jpg', size: file.size }, xrayIsImage: true });
      }, fail: () => undefined });
  },

  chooseXrayPdf() {
    wx.chooseMessageFile({ count: 1, type: 'file', extension: ['pdf'], success: result => {
      const file = result.tempFiles[0];
      if (file) this.setData({ xrayFile: { path: file.path, name: file.name || 'xray.pdf', size: file.size }, xrayIsImage: false });
    }, fail: () => undefined });
  },

  async saveProfileDraft(): Promise<void> {
    const nickname = this.data.nickname.trim();
    if (!nickname) throw new Error('请先填写昵称。');
    if (nickname.length > 50) throw new Error('昵称最多 50 个字。');
    const payload: Record<string, unknown> = { nickname };
    if (this.data.birthMonth) payload.birth_month = this.data.birthMonth;
    const diagnosis = DIAGNOSIS_OPTIONS[this.data.diagnosisIndex]?.value;
    if (diagnosis) payload.diagnosis_status = diagnosis;
    const selected = this.data.methods.filter(item => item.checked).map(item => item.value);
    if (selected.length) payload.management_methods = selected;
    if (this.data.notes.trim()) payload.notes = this.data.notes.trim();
    await api.saveProfile(payload);
    await refreshIdentity();
    this.setData({ stage: 'xray' });
  },

  async ensureVisit(): Promise<string> {
    if (this.data.visitId) return this.data.visitId;
    const visitData: Record<string, unknown> = { title: '小树建档影像', date_precision: this.data.xrayDatePrecision };
    if (this.data.xrayDatePrecision === 'day') visitData.visit_date = this.data.xrayDate;
    if (this.data.xrayDatePrecision === 'month') visitData.visit_month = this.data.xrayDate.slice(0, 7);
    const visit = await api.createVisit(visitData);
    const userId = getCurrentIdentity()?.id;
    if (userId) wx.setStorageSync(`spine.onboarding.visit:${userId}`, visit.id);
    this.setData({ visitId: visit.id });
    return visit.id;
  },

  previewXray() {
    const file = this.data.xrayFile;
    if (file && this.data.xrayIsImage) wx.previewImage({ urls: [file.path], current: file.path });
  },
  chooseXrayDatePrecision(event: { currentTarget: { dataset: { value: string } } }) {
    const value = event.currentTarget.dataset.value as 'day' | 'month' | 'unknown';
    this.setData({ xrayDatePrecision: value });
  },
  onXrayDate(event: { detail: { value: string } }) { this.setData({ xrayDate: event.detail.value }); },

  async uploadXray() {
    if (this.data.uploadingXray || !this.data.xrayFile) return;
    if (!this.data.xrayConfirmed) {
      this.setData({ error: '请确认这是本人已有的 X 光影像，并已检查文件可查看。' }); return;
    }
    this.setData({ uploadingXray: true, error: '' });
    wx.showLoading({ title: '安全上传中', mask: true });
    try {
      const visitId = await this.ensureVisit();
      const attachment = await uploadPrivateFile('medical', this.data.xrayFile);
      await api.bindMedicalAttachment(visitId, {
        attachment: attachment.id, category: 'xray_image', owner_confirmed_xray: true,
      });
      await api.completeProfile();
      await refreshIdentity();
      const userId = getCurrentIdentity()?.id;
      if (userId) {
        wx.removeStorageSync(`spine.onboarding.visit:${userId}`);
        wx.removeStorageSync(`spine.onboarding.dismissed:${userId}`);
      }
      wx.showToast({ title: '档案已建立', icon: 'success' });
      wx.switchTab({ url: '/pages/rehab/index' });
    } catch (error) {
      this.setData({ error: fieldErrorFor(error).message });
    } finally {
      wx.hideLoading(); this.setData({ uploadingXray: false });
    }
  },

  async saveForLater() {
    if (this.data.stage === 'profile') {
      try { await this.saveProfileDraft(); }
      catch (error) { this.setData({ error: fieldErrorFor(error).message }); return; }
    }
    const userId = getCurrentIdentity()?.id;
    if (userId) wx.setStorageSync(`spine.onboarding.dismissed:${userId}`, true);
    wx.switchTab({ url: '/pages/rehab/index' });
  },

  async submit() {
    if (this.data.saving) return;
    this.setData({ saving: true, error: '', fieldErrors: {} });
    try {
      await this.saveProfileDraft();
    } catch (error) {
      const parsed = fieldErrorFor(error);
      this.setData({ error: parsed.message, fieldErrors: parsed.fields });
    } finally {
      this.setData({ saving: false });
    }
  },

});
