/* Shared controller for both existing native clients. No medical records are read. */
function decodeRouteValue(value) {
  if (typeof value !== 'string') return '';
  // WeChat passes encoded query values to onLoad. Decode once, keeping malformed
  // shared links (or an ordinary percent sign) from interrupting page rendering.
  try { return decodeURIComponent(value); } catch (_) { return value; }
}

module.exports = function knowledgePage(request) {
  const base = '/api/v1/knowledge/';
  const open = params => wx.navigateTo({ url: '/pages/knowledge/index?' + Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&') });
  return {
    data: { mode: 'home', loading: true, busy: false, error: '', query: '', heading: '脊柱侧弯知识库', categories: [], topics: [],
      recommended: [], questions: [], results: [], suggestions: [], next: null, count: 0, article: null, feedback: '', showFeedback: false },
    onLoad(options) {
      this.options = Object.assign({}, options);
      for (const key of ['mode', 'id', 'q', 'title', 'category', 'topic', 'question', 'bookmarked']) {
        if (this.options[key] !== undefined) this.options[key] = decodeRouteValue(this.options[key]);
      }
      this.sequence = 0;
      this.closed = false;
      this.setData({ mode: this.options.mode || 'home', query: this.options.q || '', heading: this.options.title || '问题与阅读' });
    },
    onShow() { this.closed = false; this.load(); },
    onHide() { this.sequence++; if (this.data.mode === 'article') this.setData({ article: null }); },
    onUnload() { this.closed = true; this.sequence++; },
    async load(append) {
      const seq = ++this.sequence;
      this.setData({ loading: true, error: '', ...(append ? {} : { results: [], article: null }) });
      try {
        if (this.data.mode === 'home') {
          const data = await request('GET', base + 'catalog/');
          if (seq === this.sequence && !this.closed) this.setData(data);
        } else if (this.data.mode === 'article') {
          const data = await request('GET', base + 'articles/' + encodeURIComponent(this.options.id) + '/');
          data.dateLabel = String(data.updated_at || '').slice(0, 10);
          data.keywordLabel = data.keywords.join(' · ');
          if (seq === this.sequence && !this.closed) this.setData({ article: data });
        } else {
          const params = { q: this.data.query, page: append ? this.data.next : 1 };
          for (const k of ['category', 'topic', 'question', 'bookmarked']) if (this.options[k]) params[k] = this.options[k];
          const query = Object.keys(params).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
          const data = await request('GET', base + 'articles/?' + query);
          if (seq === this.sequence && !this.closed) {
            const all = append ? this.data.results.concat(data.results) : data.results;
            this.setData({ ...data, results: all.filter((a, i) => all.findIndex(b => a.id === b.id) === i) });
          }
        }
      } catch (error) {
        if (seq === this.sequence && !this.closed) this.setData({ error: error.status === 410 ? '这篇文章已撤稿，暂不可阅读。' : error.message || '网络连接失败，请重试。', article: null });
      } finally { if (seq === this.sequence && !this.closed) this.setData({ loading: false }); }
    },
    retry() { this.load(); },
    inputQuery(e) { this.setData({ query: e.detail.value }); },
    search() { open({ mode: 'list', q: this.data.query.trim(), title: '搜索结果' }); },
    category(e) { open({ mode: 'list', category: e.currentTarget.dataset.id, title: e.currentTarget.dataset.name }); },
    topic(e) { open({ mode: 'list', topic: e.currentTarget.dataset.id, title: e.currentTarget.dataset.name }); },
    question(e) { open({ mode: 'list', question: e.currentTarget.dataset.id, title: e.currentTarget.dataset.text }); },
    suggestion(e) { open({ mode: 'list', q: e.currentTarget.dataset.text, title: '搜索结果' }); },
    article(e) { open({ mode: 'article', id: e.currentTarget.dataset.id }); },
    home() { wx.navigateTo({ url: '/pages/knowledge/index' }); },
    favorites() { open({ mode: 'list', bookmarked: '1', title: '我的收藏' }); },
    more() { if (!this.data.loading && this.data.next) this.load(true); },
    onReachBottom() { this.more(); },
    async bookmark() {
      if (this.data.busy || !this.data.article) return;
      this.setData({ busy: true });
      try {
        const result = await request(this.data.article.bookmarked ? 'DELETE' : 'PUT', base + 'articles/' + this.data.article.id + '/bookmark/');
        this.setData({ 'article.bookmarked': result.bookmarked });
      } catch (e) { wx.showToast({ title: e.message || '请先登录后再收藏', icon: 'none' }); }
      finally { this.setData({ busy: false }); }
    },
    toggleFeedback() { this.setData({ showFeedback: !this.data.showFeedback }); },
    inputFeedback(e) { this.setData({ feedback: e.detail.value }); },
    async sendFeedback() {
      if (this.data.busy || !this.data.feedback.trim()) return;
      this.setData({ busy: true });
      try {
        await request('POST', base + 'articles/' + this.data.article.id + '/feedback/', { text: this.data.feedback });
        this.setData({ feedback: '', showFeedback: false }); wx.showToast({ title: '已提交内容团队', icon: 'success' });
      } catch (e) { wx.showToast({ title: e.message || '提交失败，请重试', icon: 'none' }); }
      finally { this.setData({ busy: false }); }
    },
    copySource(e) { wx.setClipboardData({ data: e.currentTarget.dataset.url }); },
    onShareAppMessage() { return { title: this.data.article ? this.data.article.title : 'Scolio 脊柱侧弯知识库', path: '/pages/knowledge/index' + (this.data.article ? '?mode=article&id=' + encodeURIComponent(this.data.article.id) : '') }; },
    community() { wx.switchTab({ url: '/pages/community/index' }); },
  };
};
