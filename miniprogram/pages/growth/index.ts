import type { BodyMeasurement, Visit } from '../../models/types';
import { api } from '../../services/api';
import { life } from '../../services/life';
import type { LifeSummary } from '../../services/life';
import { requireOnboarded } from '../../services/session';

function visitKey(visit: Visit): string {
  return visit.date_precision === 'day' ? visit.visit_date || '' : visit.date_precision === 'month' ? visit.visit_month : '';
}
function visitDate(visit: Visit): string {
  return visit.date_precision === 'day' ? visit.visit_date || '日期不详'
    : visit.date_precision === 'month' ? `${visit.visit_month}（仅年月）` : '日期不详';
}
function measurementDate(value: string): string {
  return new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 10);
}
Page({
  data: { loading: true, error: '', measurements: [] as Array<BodyMeasurement & { date: string }>,
    visits: [] as Array<Visit & { date: string }>, height: '—', weight: '—', latestDate: '',
    summary: null as LifeSummary | null, curveGroups: [] as Array<{ key: string; label: string }>, curveGroup: 0,
    curvePoints: [] as Array<{ date: string; angle: number }>, chartError: '' },
  onShow() { void this.reload(); },
  onPullDownRefresh() { void this.reload(true); },
  async reload(stopPull = false) {
    if (!await requireOnboarded()) { if (stopPull) wx.stopPullDownRefresh(); return; }
    this.setData({ loading: true, error: '' });
    try {
      const [measurements, visits] = await Promise.all([api.bodyMeasurements(), api.visits()]);
      const sorted = measurements.slice().sort((a, b) => Date.parse(b.measured_at) - Date.parse(a.measured_at));
      const latest = sorted[0];
      this.setData({ measurements: sorted.map(item => ({ ...item, date: measurementDate(item.measured_at) })),
        visits: visits.slice().sort((a, b) => visitKey(b).localeCompare(visitKey(a)))
          .map(item => ({ ...item, date: visitDate(item) })),
        height: latest?.height_cm ?? '—', weight: latest?.weight_kg ?? '—',
        latestDate: latest ? measurementDate(latest.measured_at) : '' });
      await this.loadSummary();
    } catch (_) { this.setData({ error: '成长记录暂时无法读取，点击重试。' }); }
    finally { this.setData({ loading: false }); wx.nextTick(() => this.updateCurve()); if (stopPull) wx.stopPullDownRefresh(); }
  },
  async loadSummary() {
    try {
      const summary = await life.summary();
      const groups = new Map<string, string>();
      const regions: Record<string, string> = { cervical: '颈段', thoracic: '胸段', thoracolumbar: '胸腰段', lumbar: '腰段', unknown: '部位不详' };
      const directions: Record<string, string> = { left: '左凸', right: '右凸', unknown: '方向不详' };
      for (const row of summary.curves) {
        if (!row.date || row.angle === null || row.region === 'unknown' || row.direction === 'unknown' || !row.end_vertebrae.trim()) continue;
        const key = `${row.region}|${row.direction}|${row.end_vertebrae}`;
        groups.set(key, `${regions[row.region] || row.region} · ${directions[row.direction] || row.direction} · ${row.end_vertebrae}`);
      }
      this.setData({ summary, curveGroups: Array.from(groups, ([key, label]) => ({ key, label })), curveGroup: 0, chartError: '' });
      this.updateCurve();
    } catch (_) { this.setData({ chartError: '累计记录与趋势暂时无法读取。' }); }
  },
  selectCurve(event: { detail: { value: string } }) { this.setData({ curveGroup: Number(event.detail.value) }); this.updateCurve(); },
  updateCurve() {
    const group = this.data.curveGroups[this.data.curveGroup];
    const points = (this.data.summary?.curves || []).filter(row => row.date && row.angle !== null && `${row.region}|${row.direction}|${row.end_vertebrae}` === group?.key)
      .map(row => ({ date: row.date!, angle: Number(row.angle) })).sort((a, b) => a.date.localeCompare(b.date));
    this.setData({ curvePoints: points });
    wx.nextTick(() => {
      if (!points.length) return;
      const ctx = wx.createCanvasContext('cobb-chart', this);
      ctx.clearRect(0, 0, 300, 220);
      const low = Math.max(0, Math.floor(Math.min(...points.map(point => point.angle))) - 5);
      const high = Math.max(low + 10, Math.ceil(Math.max(...points.map(point => point.angle))) + 5);
      const start = Date.parse(points[0].date), end = Date.parse(points[points.length - 1].date);
      ctx.setStrokeStyle('#d2ddd6'); ctx.beginPath(); ctx.moveTo(35, 15); ctx.lineTo(35, 185); ctx.lineTo(280, 185); ctx.stroke();
      ctx.setFillStyle('#556c61'); ctx.setFontSize(11); ctx.fillText(`${high}°`, 0, 22); ctx.fillText(`${low}°`, 0, 185);
      const positions = points.map(point => ({ x: end === start ? 150 : 40 + (Date.parse(point.date) - start) / (end - start) * 230,
        y: 180 - (point.angle - low) / (high - low) * 155 }));
      ctx.setStrokeStyle('#1f6f66'); ctx.setLineWidth(2); ctx.beginPath();
      positions.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.stroke();
      positions.forEach((point, index) => { ctx.beginPath(); ctx.arc(point.x, point.y, 4, 0, Math.PI * 2); ctx.setFillStyle('#1f6f66'); ctx.fill(); ctx.fillText(`${points[index].angle}°`, point.x - 10, point.y - 10); });
      ctx.fillText(points[0].date, 35, 210); ctx.fillText(points[points.length - 1].date, 210, 210); ctx.draw();
    });
  },
  openSummary() { wx.navigateTo({ url: '/pages/life/index?tab=summary' }); },
  openProfile() { wx.navigateTo({ url: '/pages/personal/profile/index' }); },
  addVisit() { wx.navigateTo({ url: '/pages/personal/visits/detail/index' }); },
  openVisit(event: { currentTarget: { dataset: { id: string } } }) {
    wx.navigateTo({ url: `/pages/personal/visits/detail/index?id=${event.currentTarget.dataset.id}` });
  },
});
