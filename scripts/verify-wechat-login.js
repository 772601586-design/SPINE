/**
 * 微信登录端到端验证（官方自动化 SDK，不走 GUI 点击）
 *
 * 前置条件：
 *   1. 微信开发者工具已打开 D:\SPINE 项目，且已扫码登录
 *   2. 工具 -> 设置 -> 安全设置 -> 服务端口：开启
 *   3. 后端已用 backend/.env 里的 WECHAT_APPSECRET 启动
 *
 * 运行：
 *   NODE_PATH=<workspace>/node_modules node scripts/verify-wechat-login.js
 *
 * 只读验证：不修改任何数据；打印的 token 与 openid 均已脱敏。
 */
const http = require('http');
const path = require('path');
const automator = require('miniprogram-automator');

const API = { host: '127.0.0.1', port: 8000 };
const AUTO_PORT = 9420;
const SHOT = path.join(__dirname, '..', '.tools', 'wechat-login-check.png');

function api(pathname, method, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Token ${token}`;
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);
    const req = http.request(
      { host: API.host, port: API.port, path: pathname, method, headers, timeout: 15000 },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(raw); } catch (_) { parsed = raw; }
          resolve({ status: res.statusCode, body: parsed });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const mask = (v) => (typeof v === 'string' && v.length > 8 ? `${v.slice(0, 4)}${'*'.repeat(v.length - 8)}${v.slice(-4)}` : String(v));

(async () => {
  let mini;
  try {
    mini = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${AUTO_PORT}` });
  } catch (error) {
    console.error('[FAIL] 无法连接开发者工具自动化端口。');
    console.error('       原因:', error.message);
    console.error('       请确认：工具已打开本项目，且 设置 -> 安全设置 -> 服务端口 已开启。');
    process.exit(2);
  }

  try {
    console.log('[1/5] 已连接开发者工具');

    const loginResult = await mini.callWxMethod('login');
    const code = loginResult && loginResult.code;
    if (!code) throw new Error(`wx.login 未返回 code: ${JSON.stringify(loginResult)}`);
    console.log('[2/5] 真实 wx.login 取到 code:', mask(code));

    const login = await api('/api/v1/auth/wechat/', 'POST', { code });
    if (login.status !== 200) {
      console.error('[FAIL] 后端微信登录返回', login.status, JSON.stringify(login.body));
      process.exit(3);
    }
    const token = login.body.token;
    console.log('[3/5] 后端换取 Token 成功:', mask(token));
    console.log('      user.id =', login.body.user && login.body.user.id, '| is_new =', login.body.is_new);

    const me = await api('/api/v1/auth/me/', 'GET', null, token);
    console.log('[4/5] 用该 Token 调 /auth/me/ ->', me.status, JSON.stringify(me.body));
    if (me.status !== 200) { console.error('[FAIL] Token 不可用'); process.exit(4); }

    try {
      await mini.screenshot({ path: SHOT });
      console.log('[5/5] 已截图:', SHOT);
    } catch (e) {
      console.log('[5/5] 截图跳过:', e.message);
    }

    console.log('\n[PASS] 微信登录链路端到端打通。');
    process.exit(0);
  } catch (error) {
    console.error('[FAIL]', error.message);
    process.exit(1);
  } finally {
    try { await mini.disconnect(); } catch (_) { /* ignore */ }
  }
})();
