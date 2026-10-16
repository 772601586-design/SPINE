import type { Brace, ComfortEntry, WearSession, WearStatistics } from '../../models/types';
import { api } from '../../services/api';
import { life } from '../../services/life';
import { requireSession } from '../../services/session';

function label(seconds: number): string { const mins = Math.floor(Math.max(seconds, 0) / 60); return `${Math.floor(mins / 60)}小时${mins % 60}分钟`; }
function timeText(value: string): string { return new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' '); }
function nowId(): string { const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join(''); return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-${((parseInt(hex[16],16)&3)|8).toString(16)}${hex.slice(17,20)}-${hex.slice(20)}`; }

Page({
  data: { loading: true, busy: false, error: '', braceOptions: [] as Brace[], selectedIndex: 0, selectedId: 0,
    selectedName: '', canStart: false, active: null as WearSession | null, activeBraceName: '', activeStarted: '', elapsedText: '', activeIsDifferent: false,
    todayText: '', hasToday: false, recentFeelings: [] as Array<Record<string, unknown>>, startRequestId: '', targetHours: '', targetError: '' },
  timer: 0,
  onLoad() { void this.reload(); },
  onShow() { if (this.data.selectedId) void this.reload(); this.updateElapsed(); },
  onHide() { if (this.timer) clearInterval(this.timer); },
  onUnload() { if (this.timer) clearInterval(this.timer); },
  async reload() {
    if (!await requireSession()) return;
    this.setData({ loading: true, error: '' });
    void this.loadTarget();
    try {
      const [braces, wears, feelings] = await Promise.all([api.braces(), api.wears(), api.feelings()]);
      const active = wears.find(w => !w.ended_at) ?? null;
      const wanted = this.data.selectedId || active?.brace;
      const selected = braces.find(b => b.id === wanted) ?? braces.find(b => b.is_active) ?? braces[0];
      const stats: WearStatistics | null = selected ? await api.statistics(selected.id) : null;
      const date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0,10);
      const today = stats?.days.find(item => item.date === date);
      const recent = selected ? feelings.filter(f => f.brace === selected.id).slice(0, 3).map(f => ({
        id: f.id, time: timeText(f.occurred_at), comfort: f.comfort_level ? ['','很不舒服','不太舒服','一般','比较舒适','很舒适'][f.comfort_level] : '舒适度未填写',
        pain: f.pain === null ? '未填写' : `${f.pain}分`, tags: f.tags.join('、'), notes: f.notes,
      })) : [];
      const options = braces.map(b => ({ ...b, name: `${b.name}${b.is_active ? '' : '（停用）'}` }));
      const index = selected ? Math.max(0, braces.findIndex(b => b.id === selected.id)) : 0;
      this.setData({ braceOptions: options, selectedIndex: index, selectedId: selected?.id ?? 0,
        selectedName: selected?.name ?? '', canStart: !!selected?.is_active, active,
        activeBraceName: braces.find(b => b.id === active?.brace)?.name ?? '支具', activeStarted: active ? timeText(active.started_at) : '',
        activeIsDifferent: !!active && !!selected && active.brace !== selected.id,
        todayText: today ? label(today.seconds) : '', hasToday: !!today, recentFeelings: recent, loading: false });
      this.updateElapsed(); this.startTimer();
    } catch (_) { this.setData({ loading: false, error: '读取支具数据失败，请检查网络后重试。' }); }
  },
  startTimer() { if (this.timer) clearInterval(this.timer); this.timer = setInterval(() => this.updateElapsed(), 60000) as unknown as number; },
  updateElapsed() { const active = this.data.active; if (!active) return; const mins = Math.floor((Date.now() - Date.parse(active.started_at)) / 60000); this.setData({ elapsedText: `${Math.floor(mins / 60)}小时${mins % 60}分钟` }); },
  async chooseBrace(event: { detail: { value: string } }) {
    const index = Number(event.detail.value); const brace = this.data.braceOptions[index];
    if (!brace) return;
    this.setData({ selectedIndex: index, selectedId: brace.id });
    await this.reload();
  },
  openArchive() { wx.navigateTo({ url: '/pages/brace-archive/index' }); },
  async loadTarget() {
    try { const preferences = await life.preferences(); this.setData({ targetHours: preferences.brace_target_hours || '', targetError: '' }); }
    catch (_) { this.setData({ targetError: '个人目标暂时无法读取。' }); }
  },
  openTarget() { wx.navigateTo({ url: '/pages/life/index?tab=reminder' }); },
  addBrace() { wx.navigateTo({ url: '/pages/brace-form/index' }); },
  async startWear() {
    if (this.data.busy || !this.data.selectedId || this.data.active) return;
    const id = this.data.startRequestId || nowId(); this.setData({ busy: true, startRequestId: id, error: '' });
    try { await api.startWear(this.data.selectedId, id); this.setData({ startRequestId: '' }); await this.reload(); }
    catch (error) { this.setData({ error: error instanceof Error ? error.message : '开始记录失败，请重试。' }); }
    finally { this.setData({ busy: false }); }
  },
  async endWear() {
    const active = this.data.active; if (!active || this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      const result = await api.endWear(active.id);
      await this.reload();
      if (result.training_prompt?.eligible) {
        wx.showModal({
          title: '佩戴记录已保存，现在要练一下吗？', content: '你有可开始的个人动作卡，可以查看训练计划；也可以暂时不用。',
          confirmText: '查看我的训练计划', cancelText: '暂时不用',
          success: async choice => {
            try { await api.braceTrainingPromptChoice(active.id, choice.confirm ? 'continue' : 'skip'); }
            catch (_) { wx.showToast({ title: '选择暂未同步，请稍后重试', icon: 'none' }); }
            if (choice.confirm) wx.switchTab({ url: '/pages/rehab/activity/index' });
          },
        });
      } else {
        wx.showToast({ title: '佩戴记录已保存', icon: 'success' });
      }
    }
    catch (error) { this.setData({ error: error instanceof Error ? error.message : '结束记录失败，请重试。' }); }
    finally { this.setData({ busy: false }); }
  },
  openFeeling() { if (this.data.selectedId) wx.navigateTo({ url: `/pages/comfort-form/index?braceId=${this.data.selectedId}` }); else wx.showToast({ title: '请先添加支具档案', icon: 'none' }); },
  editFeeling(event: { currentTarget: { dataset: { id: number } } }) { wx.navigateTo({ url: `/pages/comfort-form/index?braceId=${this.data.selectedId}&id=${event.currentTarget.dataset.id}` }); },
  openBackfill() { wx.navigateTo({ url: `/pages/wear-form/index?braceId=${this.data.selectedId}` }); },
  openHistory() { wx.navigateTo({ url: `/pages/brace-history/index?braceId=${this.data.selectedId}` }); },
  openTrends() { wx.navigateTo({ url: `/pages/brace-trends/index?braceId=${this.data.selectedId}` }); },
  openRequirements() { wx.showModal({ title: '佩戴要求', content: '专业制定的佩戴要求尚未接入。本轮不设置默认目标。', showCancel: false }); },
});
