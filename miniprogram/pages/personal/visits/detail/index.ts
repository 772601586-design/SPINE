import { currentMonth, todayDate, type Option } from '../../../../config/profile-options';
import type { DatePrecision, VisitDetail } from '../../../../models/types';
import { api } from '../../../../services/api';
import { ApiError, request } from '../../../../services/request';
import { requireOnboarded } from '../../../../services/session';
import { isPreviewableImage, mimeFor, uploadPrivateFile } from '../../../../services/upload';

/**
 * 就诊编辑 / 详情（规格 §2.1 /personal/visits/:id）。
 *
 * 三条规则在这里落地：
 * 1. **日期精度三选一**，选「不详」就不会往库里写任何日期字段——不拿某一天冒充。
 * 2. **附件必须先上传成 medical 用途、再绑定分类**；解绑不等于删除原件。
 * 3. **弯曲记录逐条录入**，同一份报告左右两个弯是两条记录，不合并成一个角度。
 */
const CATEGORY_OPTIONS: Option[] = [
  { value: 'xray_image', label: 'X 光影像/扫描件' },
  { value: 'imaging_report', label: '影像报告' },
  { value: 'diagnosis_record', label: '医生诊断记录' },
  { value: 'other', label: '其他' },
];

const REGION_OPTIONS: Option[] = [
  { value: 'cervical', label: '颈段' },
  { value: 'thoracic', label: '胸段' },
  { value: 'thoracolumbar', label: '胸腰段' },
  { value: 'lumbar', label: '腰段' },
  { value: 'unknown', label: '不详' },
];

const DIRECTION_OPTIONS: Option[] = [
  { value: 'left', label: '左凸' },
  { value: 'right', label: '右凸' },
  { value: 'unknown', label: '不详' },
];

const PRECISIONS: Array<{ value: DatePrecision; label: string }> = [
  { value: 'day', label: '精确到天' },
  { value: 'month', label: '精确到月' },
  { value: 'unknown', label: '日期不详' },
];

function labelOfOptions(options: Option[], value: string | null | undefined): string {
  return options.find(item => item.value === (value ?? ''))?.label ?? '';
}

function dateText(value: string | null): string { return value ? value.slice(0, 10) : ''; }

function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return '记录已在别处更新，请重新加载后再保存。';
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
    deleting: false,
    mode: 'create' as 'create' | 'edit',
    id: '',
    navTitle: '新增就诊',

    precisions: PRECISIONS,
    precision: 'day' as DatePrecision,
    precisionHint: '',
    visitDate: todayDate(),
    visitMonth: currentMonth(),
    todayDate: todayDate(),
    todayMonth: currentMonth(),
    nextReview: '',
    hasNextReview: false,

    institution: '',
    department: '',
    title: '',
    diagnosisExcerpt: '',
    adviceExcerpt: '',
    notes: '',
    revision: 0,
    ocrText: '', recognizing: false,

    categoryLabels: CATEGORY_OPTIONS.map(item => item.label),
    categoryIndex: 0,
    uploading: false,
    attachments: [] as Array<Record<string, unknown>>,

    curves: [] as Array<Record<string, unknown>>,
    regionLabels: REGION_OPTIONS.map(item => item.label),
    directionLabels: DIRECTION_OPTIONS.map(item => item.label),
    curveRegionIndex: 1,
    curveDirectionIndex: 2,
    curveAngle: '',
    curveEnd: '',
    savingCurve: false,
    curveError: '',
    curveOpen: false,
  },

  async onLoad(query: Record<string, string>) {
    if (!await requireOnboarded()) { this.setData({ loading: false }); return; }
    const id = query && query.id ? String(query.id) : '';
    if (!id) {
      this.setData({ loading: false, mode: 'create', navTitle: '新增就诊', precision: 'day', precisionHint: '' });
      return;
    }
    this.setData({ id, mode: 'edit', navTitle: '就诊详情' });
    await this.load(id);
  },

  async load(id: string) {
    this.setData({ loading: true, error: '' });
    try {
      const visit = await api.visit(id);
      this.fill(visit);
      this.setData({ loading: false });
    } catch (error) {
      this.setData({ loading: false, blocking: messageFor(error) });
    }
  },

  retryLoad() {
    if (this.data.mode === 'edit') void this.load(this.data.id);
    else this.setData({ blocking: '' });
  },

  fill(visit: VisitDetail) {
    const precision = visit.date_precision;
    this.setData({
      precision,
      precisionHint: precision === 'day' ? ''
        : precision === 'month' ? '只知道年月时不会写入具体日期。'
          : '选「日期不详」不会写入任何日期字段。',
      visitDate: visit.visit_date ?? todayDate(),
      visitMonth: visit.visit_month || currentMonth(),
      nextReview: visit.next_review_date ?? '',
      hasNextReview: !!visit.next_review_date,
      institution: visit.institution,
      department: visit.department,
      title: visit.title,
      diagnosisExcerpt: visit.diagnosis_excerpt,
      adviceExcerpt: visit.advice_excerpt,
      notes: visit.notes,
      revision: visit.revision,
      attachments: visit.attachments.map(binding => ({
        id: binding.attachment.id,
        categoryLabel: labelOfOptions(CATEGORY_OPTIONS, binding.category),
        filename: binding.attachment.original_filename,
        mime: binding.attachment.mime_type,
        isImage: isPreviewableImage(binding.attachment.mime_type),
        sizeText: sizeText(binding.attachment.size_bytes),
        caption: binding.caption,
      })),
      curves: visit.curves.map(curve => ({
        id: curve.id,
        regionLabel: labelOfOptions(REGION_OPTIONS, curve.region),
        directionLabel: labelOfOptions(DIRECTION_OPTIONS, curve.direction),
        angle: curve.cobb_angle ?? '未填',
        end: curve.end_vertebrae,
        sourceText: curve.source_text,
      })),
    });
  },

  choosePrecision(event: { currentTarget: { dataset: { value: string } } }) {
    const precision = event.currentTarget.dataset.value as DatePrecision;
    const hint = precision === 'day' ? ''
      : precision === 'month' ? '只知道年月时不会写入具体日期。'
        : '选「日期不详」不会写入任何日期字段。';
    this.setData({ precision, precisionHint: hint });
  },

  onVisitDate(event: { detail: { value: string } }) { this.setData({ visitDate: event.detail.value }); },
  onVisitMonth(event: { detail: { value: string } }) { this.setData({ visitMonth: event.detail.value }); },
  onNextReview(event: { detail: { value: string } }) { this.setData({ nextReview: event.detail.value }); },
  clearNextReview() { this.setData({ nextReview: '' }); },
  onInstitution(event: { detail: { value: string } }) { this.setData({ institution: event.detail.value }); },
  onDepartment(event: { detail: { value: string } }) { this.setData({ department: event.detail.value }); },
  onTitle(event: { detail: { value: string } }) { this.setData({ title: event.detail.value }); },
  onDiagnosis(event: { detail: { value: string } }) { this.setData({ diagnosisExcerpt: event.detail.value }); },
  onAdvice(event: { detail: { value: string } }) { this.setData({ adviceExcerpt: event.detail.value }); },
  onNotes(event: { detail: { value: string } }) { this.setData({ notes: event.detail.value }); },
  onOCRText(event: { detail: { value: string } }) { this.setData({ ocrText: event.detail.value }); },
  chooseReportOCR() {
    if (this.data.recognizing || this.data.saving) return;
    wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'], success: async result => {
      const file = result.tempFiles[0];
      if (!file) return;
      this.setData({ recognizing: true, error: '' });
      try {
        const attachment = await uploadPrivateFile('medical', { path: file.tempFilePath,
          name: file.tempFilePath.split('/').pop() || 'report.jpg', size: file.size });
        const recognized = await request<{ text: string }>('POST', '/api/v1/life/ocr/', { attachment: attachment.id }, { timeout: 60000 });
        this.setData({ ocrText: recognized.text });
      } catch (error) { this.setData({ error: messageFor(error) }); }
      finally { this.setData({ recognizing: false }); }
    } });
  },
  confirmOCR() {
    if (!this.data.ocrText.trim()) return;
    const notes = [this.data.notes, `报告文字（本人核对）\n${this.data.ocrText.trim()}`].filter(Boolean).join('\n\n');
    if (notes.length > 2000) { this.setData({ error: '核对后的备注合计不能超过 2000 字，请精简后再保存。' }); return; }
    this.setData({ notes, ocrText: '' });
  },

  payload(): Record<string, unknown> {
    const precision = this.data.precision;
    const data: Record<string, unknown> = {
      date_precision: precision,
      institution: this.data.institution.trim(),
      department: this.data.department.trim(),
      title: this.data.title.trim(),
      diagnosis_excerpt: this.data.diagnosisExcerpt.trim(),
      advice_excerpt: this.data.adviceExcerpt.trim(),
      notes: this.data.notes.trim(),
      next_review_date: this.data.hasNextReview && this.data.nextReview ? this.data.nextReview : null,
    };
    // 精度决定提交哪个日期字段，另一个显式清空——服务端也会再核一遍互斥。
    if (precision === 'day') { data.visit_date = this.data.visitDate; data.visit_month = ''; }
    else if (precision === 'month') { data.visit_month = this.data.visitMonth; data.visit_date = null; }
    else { data.visit_date = null; data.visit_month = ''; }
    return data;
  },

  async save() {
    if (this.data.saving) return;
    this.setData({ saving: true, error: '' });
    try {
      if (this.data.mode === 'create') {
        const created = await api.createVisit(this.payload());
        this.setData({ mode: 'edit', id: created.id, navTitle: '就诊详情' });
        this.fill(created);
        wx.showToast({ title: '已保存', icon: 'success' });
      } else {
        const payload = { ...this.payload(), expected_revision: this.data.revision };
        const updated = await api.updateVisit(this.data.id, payload);
        this.fill(updated);
        wx.showToast({ title: '已保存', icon: 'success' });
      }
    } catch (error) {
      this.setData({ error: messageFor(error) });
    } finally {
      this.setData({ saving: false });
    }
  },

  remove() {
    if (this.data.mode !== 'edit') return;
    wx.showModal({
      title: '删除这次就诊？',
      content: '删除后这份记录不再出现在时间线，已上传的资料也不再可读。',
      showCancel: true,
      success: (result) => { if (result.confirm) void this.confirmRemove(); },
    });
  },

  async confirmRemove() {
    if (this.data.deleting) return;
    this.setData({ deleting: true, error: '' });
    try {
      await api.deleteVisit(this.data.id);
      wx.showToast({ title: '已删除', icon: 'none' });
      wx.navigateBack({ delta: 1 });
    } catch (error) {
      this.setData({ error: messageFor(error) });
    } finally {
      this.setData({ deleting: false });
    }
  },

  // ---- 附件 ----

  onCategory(event: { detail: { value: string } }) { this.setData({ categoryIndex: Number(event.detail.value) }); },

  pickImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (result) => {
        const file = result.tempFiles[0];
        if (!file) return;
        const name = file.tempFilePath.split('/').pop() ?? 'image.jpg';
        void this.upload({ path: file.tempFilePath, name, size: file.size });
      },
    });
  },

  pickDocument() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['pdf'],
      success: (result) => {
        const file = result.tempFiles[0];
        if (!file) return;
        void this.upload({ path: file.path, name: file.name || 'report.pdf', size: file.size });
      },
    });
  },

  async upload(file: { path: string; name: string; size: number }) {
    if (this.data.uploading) return;
    if (this.data.mode !== 'edit') { this.setData({ error: '请先保存这次就诊，再上传资料。' }); return; }
    const mime = mimeFor(file.name);
    if (mime === 'application/octet-stream') { this.setData({ error: '只支持 JPG、PNG 图片或 PDF 报告。' }); return; }
    this.setData({ uploading: true, error: '' });
    wx.showLoading({ title: '上传中', mask: true });
    try {
      const attachment = await uploadPrivateFile('medical', file);
      await api.bindMedicalAttachment(this.data.id, {
        attachment: attachment.id,
        category: CATEGORY_OPTIONS[this.data.categoryIndex].value,
      });
      await this.load(this.data.id);
    } catch (error) {
      this.setData({ error: messageFor(error) });
    } finally {
      wx.hideLoading();
      this.setData({ uploading: false });
    }
  },

  async openAttachment(event: { currentTarget: { dataset: { id: string; image: boolean; name: string } } }) {
    const { id, image, name } = event.currentTarget.dataset;
    try {
      // 短期地址会过期，每次打开都重新签一条，而不是复用列表里那份。
      const fresh = await api.attachmentAccess(id);
      const url = fresh?.access_url;
      if (!url) { this.setData({ error: '暂时无法获取文件地址。' }); return; }
      if (image) { wx.previewImage({ urls: [url], current: url }); return; }
      wx.showModal({
        title: name || '文件',
        content: '受保护的文件需要通过系统应用打开，地址有效期很短，仅本人可用。',
        showCancel: true,
        success: (result) => { if (result.confirm) wx.setClipboardData({ data: url }); },
      });
    } catch (error) {
      this.setData({ error: messageFor(error) });
    }
  },

  unbind(event: { currentTarget: { dataset: { id: string } } }) {
    const attachmentId = event.currentTarget.dataset.id;
    wx.showModal({
      title: '解除附带？',
      content: '只解除与这次就诊的关联，原件仍在你名下，不会删除。',
      showCancel: true,
      success: (result) => { if (result.confirm) void this.doUnbind(attachmentId); },
    });
  },

  async doUnbind(attachmentId: string) {
    try {
      await api.unbindMedicalAttachment(this.data.id, attachmentId);
      await this.load(this.data.id);
    } catch (error) {
      this.setData({ error: messageFor(error) });
    }
  },

  // ---- 弯曲记录 ----

  toggleCurveForm() { this.setData({ curveOpen: !this.data.curveOpen, curveError: '' }); },
  onCurveRegion(event: { detail: { value: string } }) { this.setData({ curveRegionIndex: Number(event.detail.value) }); },
  onCurveDirection(event: { detail: { value: string } }) { this.setData({ curveDirectionIndex: Number(event.detail.value) }); },
  onCurveAngle(event: { detail: { value: string } }) { this.setData({ curveAngle: event.detail.value }); },
  onCurveEnd(event: { detail: { value: string } }) { this.setData({ curveEnd: event.detail.value }); },

  async addCurve() {
    if (this.data.savingCurve) return;
    if (this.data.mode !== 'edit') { this.setData({ curveError: '请先保存这次就诊，再追加记录。' }); return; }
    const angle = this.data.curveAngle.trim();
    if (angle && !(Number(angle) >= 0 && Number(angle) <= 180)) { this.setData({ curveError: '角度应在 0–180 度之间。' }); return; }
    const payload: Record<string, unknown> = {
      region: REGION_OPTIONS[this.data.curveRegionIndex].value,
      direction: DIRECTION_OPTIONS[this.data.curveDirectionIndex].value,
    };
    if (angle) payload.cobb_angle = angle;
    const end = this.data.curveEnd.trim();
    if (end) payload.end_vertebrae = end;

    this.setData({ savingCurve: true, curveError: '' });
    try {
      await api.addCurve(this.data.id, payload);
      this.setData({ curveAngle: '', curveEnd: '', curveOpen: false });
      await this.load(this.data.id);
    } catch (error) {
      this.setData({ curveError: messageFor(error) });
    } finally {
      this.setData({ savingCurve: false });
    }
  },

  async removeCurve(event: { currentTarget: { dataset: { id: string } } }) {
    try {
      await api.deleteCurve(event.currentTarget.dataset.id);
      await this.load(this.data.id);
    } catch (error) {
      this.setData({ error: messageFor(error) });
    }
  },
});
