import type { DatePrecision, Visit } from '../../../models/types';
import { api } from '../../../services/api';
import { ApiError } from '../../../services/request';
import { requireOnboarded } from '../../../services/session';

/**
 * 就诊时间线（规格 §2.1 /personal/visits）。
 *
 * 日期的三种精度**必须区分显示**：只知道年月就写「2025-03（仅年月）」，什么都不
 * 知道就写「日期不详」。两者都不能被渲染成某一天，否则时间线会替用户记住一个
 * 从没发生过的日期。排序也照此处理——日期不详的排在最后。
 */
const PRECISION_LABEL: Record<DatePrecision, string> = {
  day: '精确到天', month: '精确到月', unknown: '日期不详',
};

function timeText(value: string | null): string {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}

function shape(visit: Visit): Record<string, unknown> {
  const primary = visit.date_precision === 'day'
    ? (visit.visit_date ?? '')
    : visit.date_precision === 'month' ? `${visit.visit_month}（仅年月）` : '日期不详';
  const secondary = [visit.institution, visit.department].filter(text => !!text).join(' · ');
  const nextReview = timeText(visit.next_review_date);
  return {
    id: visit.id,
    primary,
    secondary,
    title: visit.title || '未填写标题',
    precision: PRECISION_LABEL[visit.date_precision],
    unknown: visit.date_precision === 'unknown',
    attachmentCount: visit.attachment_count,
    curveCount: visit.curve_count,
    nextReview,
    createdText: timeText(visit.created_at),
  };
}

Page({
  data: {
    loading: true,
    error: '',
    visits: [] as Array<Record<string, unknown>>,
  },

  onShow() { void this.reload(); },
  onPullDownRefresh() { void this.reload(true); },

  async reload(stopPull = false) {
    if (!await requireOnboarded()) { if (stopPull) wx.stopPullDownRefresh(); return; }
    this.setData({ loading: true, error: '' });
    try {
      const visits = await api.visits();
      this.setData({ visits: visits.map(shape), loading: false });
    } catch (error) {
      const text = error instanceof ApiError ? error.message : '暂时无法读取就诊记录，请重试。';
      this.setData({ loading: false, error: text });
    } finally {
      if (stopPull) wx.stopPullDownRefresh();
    }
  },

  create() { wx.navigateTo({ url: '/pages/personal/visits/detail/index' }); },
  open(event: { currentTarget: { dataset: { id: string } } }) {
    wx.navigateTo({ url: `/pages/personal/visits/detail/index?id=${event.currentTarget.dataset.id}` });
  },
});
