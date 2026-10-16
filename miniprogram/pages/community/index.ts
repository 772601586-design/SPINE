import { life, requestId } from '../../services/life';
import type { LifePost } from '../../services/life';
import { requireOnboarded } from '../../services/session';

Page({
  data: { loading: true, busy: false, error: '', group: 'companions', mine: false, body: '', reason: '', reportId: 0,
    posts: [] as LifePost[], groups: [{ key: 'companions', label: '同行伙伴' }, { key: 'brace', label: '支具生活' }, { key: 'deco', label: 'Deco' }] },
  onShow() { void this.reload(); },
  async reload() {
    if (!await requireOnboarded()) return;
    this.setData({ loading: true, error: '' });
    try { this.setData({ posts: await life.posts(this.data.group, this.data.mine) }); }
    catch (error) { this.fail(error); }
    finally { this.setData({ loading: false }); }
  },
  fail(error: unknown) { this.setData({ error: error instanceof Error ? error.message : '操作失败，请重试' }); },
  inputBody(event: { detail: { value: string } }) { this.setData({ body: event.detail.value }); },
  inputReason(event: { detail: { value: string } }) { this.setData({ reason: event.detail.value }); },
  selectGroup(event: { currentTarget: { dataset: { group: string } } }) { this.setData({ group: event.currentTarget.dataset.group }); void this.reload(); },
  toggleMine() { this.setData({ mine: !this.data.mine }); void this.reload(); },
  async compose() {
    if (this.data.busy || !this.data.body.trim()) return;
    this.setData({ busy: true, error: '' });
    const signature = `${this.data.group}:${this.data.body.trim()}`;
    if (this._postSignature !== signature) { this._postSignature = signature; this._postRequest = requestId(); }
    try {
      await life.post({ request_id: this._postRequest, group: this.data.group, body: this.data.body.trim() });
      this._postSignature = '';
      this.setData({ body: '' });
      wx.showToast({ title: '分享已提交，等待审核', icon: 'none' });
      await this.reload();
    } catch (error) { this.fail(error); }
    finally { this.setData({ busy: false }); }
  },
  async like(event: { currentTarget: { dataset: { id: number } } }) {
    if (this.data.busy) return;
    const post = this.data.posts.find(item => item.id === Number(event.currentTarget.dataset.id));
    if (!post) return;
    this.setData({ busy: true, error: '' });
    try { await life.like(post.id, !post.liked); await this.reload(); } catch (error) { this.fail(error); }
    finally { this.setData({ busy: false }); }
  },
  async remove(event: { currentTarget: { dataset: { id: number } } }) {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try { await life.removePost(Number(event.currentTarget.dataset.id)); await this.reload(); } catch (error) { this.fail(error); }
    finally { this.setData({ busy: false }); }
  },
  startReport(event: { currentTarget: { dataset: { id: number } } }) { this.setData({ reportId: Number(event.currentTarget.dataset.id), reason: '' }); },
  cancelReport() { this.setData({ reportId: 0, reason: '' }); },
  async submitReport() {
    if (this.data.busy || !this.data.reason.trim()) return;
    this.setData({ busy: true, error: '' });
    try { await life.report(this.data.reportId, this.data.reason.trim()); this.cancelReport(); wx.showToast({ title: '已提交审核处理', icon: 'none' }); }
    catch (error) { this.fail(error); }
    finally { this.setData({ busy: false }); }
  },
  openLearning() { wx.navigateTo({ url: '/pages/life/index?tab=learning' }); },
  retry() { void this.reload(); },
});
