const config = require('./knowledge-config');
function request(method, path, data) {
  let env = 'develop';
  if (wx.getAccountInfoSync) env = wx.getAccountInfoSync().miniProgram.envVersion;
  if (!/^https:\/\//.test(config.apiBase) && (env !== 'develop' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(config.apiBase))) {
    return Promise.reject(new Error('请配置知识库服务的 HTTPS 地址。'));
  }
  const token = wx.getStorageSync('spine.session.token');
  return new Promise((resolve, reject) => wx.request({ url: config.apiBase + path, method, data, timeout: 12000,
    header: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Token ' + token } : {}) },
    success(res) {
      if (res.statusCode >= 200 && res.statusCode < 300) resolve(Array.isArray(res.data.data) && res.data.meta ? { ...res.data.meta, results: res.data.data } : res.data.data);
      else { const e = new Error(res.statusCode === 401 ? '请登录后使用收藏和反馈' : res.data.error && res.data.error.message || '内容暂不可用'); e.status = res.statusCode; reject(e); }
    }, fail() { reject(new Error('知识库服务暂不可用，请检查网络后重试。')); }
  }));
}
let signingIn;
module.exports = async function(method, path, data) {
  if ((method !== 'GET' || path.includes('bookmarked=1')) && !wx.getStorageSync('spine.session.token') && wx.login) {
    if (!signingIn) signingIn = new Promise((resolve, reject) => wx.login({
      success: async result => { try { const session = await request('POST', '/api/v1/auth/wechat/', { code: result.code }); wx.setStorageSync('spine.session.token', session.token); resolve(); } catch (e) { reject(e); } },
      fail: () => reject(new Error('微信登录失败，请重试。'))
    })).finally(() => { signingIn = null; });
    await signingIn;
  }
  return request(method, path, data);
};
