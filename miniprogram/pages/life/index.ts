import { life, requestId } from '../../services/life';
import type { LifeArticle, LifePreferences, LifeRecord, LifeRewards, LifeSummary } from '../../services/life';
import { requireOnboarded } from '../../services/session';
import { uploadPrivateFile } from '../../services/upload';
import { startReminders } from '../../services/reminders';
import { api } from '../../services/api';

const TABS = [{ key: 'swim', title: '辅助运动' }, { key: 'pain', title: '身体记录' },
  { key: 'reminder', title: '提醒设置' }, { key: 'learning', title: '学习与指南' },
  { key: 'rewards', title: '松果勋章' }, { key: 'summary', title: '复查准备' }];
type InputEvent = { currentTarget: { dataset: { field: string; id: number; index: number } }; detail: { value: string } };
Page({
  data: { tabs: TABS, tab: 'swim', loading: true, busy: false, error: '', result: '',
    date: new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10), minutes: '', pain: '', notes: '',
    reviewEnabled: false, reviewDate: '', sedentary: '0', targetHours: '',
    weekdays: ['一', '二', '三', '四', '五', '六', '日'].map((label, index) => ({ index, label, selected: false })),
    preferences: null as LifePreferences | null, records: [] as LifeRecord[], articles: [] as LifeArticle[],
    article: null as LifeArticle | null, rewards: null as LifeRewards | null, summary: null as LifeSummary | null,
    drawingPath: '', drawingAttachment: '', uploading: false },
  async onLoad(query: { tab?: string }) {
    if (TABS.some(item => item.key === query.tab)) this.setData({ tab: query.tab! });
    await this.reload();
  },
  onPullDownRefresh() { void this.reload().finally(() => wx.stopPullDownRefresh()); },
  async reload() {
    if (!await requireOnboarded()) return;
    this.setData({ loading: true, error: '' });
    try {
      const [preferences, records, articles, rewards, summary] = await Promise.all([
        life.preferences(), life.records(), life.articles(), life.rewards(), life.summary(),
      ]);
      this.setData({ preferences, records, articles, rewards, summary,
        reviewEnabled: preferences.review_enabled, reviewDate: preferences.review_date || '',
        sedentary: String(preferences.sedentary_minutes), targetHours: preferences.brace_target_hours || '',
        weekdays: this.data.weekdays.map(item => ({ ...item, selected: preferences.swim_weekdays.includes(item.index) })) });
    } catch (error) { this.fail(error); }
    finally { this.setData({ loading: false }); }
  },
  fail(error: unknown) { this.setData({ error: error instanceof Error ? error.message : '操作失败，请重试' }); },
  selectTab(event: { currentTarget: { dataset: { tab: string } } }) {
    this.setData({ tab: event.currentTarget.dataset.tab, result: '', article: null });
  },
  input(event: InputEvent) { this.setData({ [event.currentTarget.dataset.field]: event.detail.value }); },
  toggleReview() { this.setData({ reviewEnabled: !this.data.reviewEnabled }); },
  toggleWeekday(event: { currentTarget: { dataset: { index: number } } }) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ weekdays: this.data.weekdays.map(item => item.index === index ? { ...item, selected: !item.selected } : item) });
  },
  async savePreferences() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '', result: '' });
    try {
      await life.savePreferences({ review_enabled: this.data.reviewEnabled, review_date: this.data.reviewDate || null,
        sedentary_minutes: Number(this.data.sedentary), brace_target_hours: this.data.targetHours ? Number(this.data.targetHours) : null,
        swim_weekdays: this.data.weekdays.filter(item => item.selected).map(item => item.index) });
      this.setData({ result: '设置已保存。复查提醒会在今日页面显示；久坐提醒在小程序前台运行时提示。' });
      void startReminders();
      await this.reload();
    } catch (error) { this.fail(error); }
    finally { this.setData({ busy: false }); }
  },
  async saveRecord() {
    if (this.data.busy) return;
    const kind = this.data.tab === 'pain' ? 'pain' : 'swim';
    if (kind === 'swim' && (!Number.isInteger(Number(this.data.minutes)) || Number(this.data.minutes) <= 0)) {
      this.setData({ error: '请填写实际游泳分钟数。' }); return;
    }
    if (kind === 'pain' && (!this.data.pain.trim() || !Number.isInteger(Number(this.data.pain)) || Number(this.data.pain) < 0 || Number(this.data.pain) > 10)) {
      this.setData({ error: '请填写 0～10 的整数。' }); return;
    }
    const payload = { kind, date: this.data.date, minutes: kind === 'swim' ? Number(this.data.minutes) : null,
      pain: kind === 'pain' ? Number(this.data.pain) : null, notes: this.data.notes };
    const signature = JSON.stringify(payload);
    if (this._recordSignature !== signature) { this._recordSignature = signature; this._recordRequest = requestId(); }
    this.setData({ busy: true, error: '', result: '' });
    try {
      await life.record({ ...payload, request_id: this._recordRequest });
      this._recordSignature = '';
      this.setData({ notes: '', minutes: '', pain: '', result: '本次记录已保存。' });
      await this.reload();
    } catch (error) { this.fail(error); }
    finally { this.setData({ busy: false }); }
  },
  async openArticle(event: { currentTarget: { dataset: { id: number } } }) {
    const article = this.data.articles.find(item => item.id === Number(event.currentTarget.dataset.id));
    if (!article) return;
    this.setData({ article, result: '', error: '' });
    try { await life.read(article.id); } catch (error) { this.fail(error); }
  },
  closeArticle() { this.setData({ article: null, result: '' }); },
  async answer(event: { currentTarget: { dataset: { index: number } } }) {
    if (!this.data.article || this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      const answer = await life.answer(this.data.article.id, Number(event.currentTarget.dataset.index));
      this.setData({ result: `${answer.correct ? '回答正确' : '再想一想'}。${answer.explanation}`, rewards: await life.rewards() });
    } catch (error) { this.fail(error); }
    finally { this.setData({ busy: false }); }
  },
  chooseDrawing() {
    if (this.data.uploading) return;
    wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'], success: async result => {
      const file = result.tempFiles[0];
      if (!file) return;
      this.setData({ uploading: true, error: '', drawingPath: file.tempFilePath, drawingAttachment: '' });
      try {
        const attachment = await uploadPrivateFile('private_record', { path: file.tempFilePath,
          name: file.tempFilePath.split('/').pop() || 'drawing.jpg', size: file.size });
        this.setData({ drawingAttachment: attachment.id });
      } catch (error) { this.fail(error); }
      finally { this.setData({ uploading: false }); }
    } });
  },
  async saveDrawing() {
    if (!this.data.drawingAttachment || this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      if (!this._drawingRequest) this._drawingRequest = requestId();
      await life.record({ request_id: this._drawingRequest, kind: 'drawing', date: this.data.date, attachment: this.data.drawingAttachment, notes: '' });
      this._drawingRequest = '';
      this.setData({ drawingPath: '', drawingAttachment: '', result: '绘画已作为私人记录保存，每周最多奖励一次。' });
      await this.reload();
    } catch (error) { this.fail(error); }
    finally { this.setData({ busy: false }); }
  },
  copySummary() { if (this.data.summary) wx.setClipboardData({ data: this.data.summary.summary_text }); },
  async previewDrawing(event: { currentTarget: { dataset: { id: number } } }) {
    const record = this.data.records.find(item => item.id === Number(event.currentTarget.dataset.id));
    if (!record?.attachment) return;
    try { const access = await api.attachmentAccess(record.attachment); if (access.access_url) wx.previewImage({ urls: [access.access_url] }); }
    catch (error) { this.fail(error); }
  },
  async makeup() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      if (this._makeupDate !== this.data.date) { this._makeupDate = this.data.date; this._makeupRequest = requestId(); }
      await life.record({ request_id: this._makeupRequest, kind: 'makeup', date: this.data.date, notes: '日历补记' });
      this.setData({ result: '日历补记已保存，已扣除 10 松果。补记仅保存日期标记，实际训练量请按真实完成情况记录。' });
      await this.reload();
    } catch (error) { this.fail(error); }
    finally { this.setData({ busy: false }); }
  },
});
