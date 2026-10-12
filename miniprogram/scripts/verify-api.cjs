const assert = require('node:assert/strict');

const storage = new Map();
global.wx = {
  getStorageSync: key => storage.get(key),
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: key => storage.delete(key),
  clearStorageSync: () => storage.clear(),
  reLaunch() {},
  switchTab() {},
  showToast() {},
  request(options) {
    fetch(options.url, {
      method: options.method,
      headers: options.header,
      body: options.data === undefined ? undefined : JSON.stringify(options.data),
      signal: AbortSignal.timeout(options.timeout),
    }).then(async response => {
      const body = await response.text();
      if (response.status >= 500) global.__lastServerError = body;
      let data;
      try { data = body ? JSON.parse(body) : null; } catch { data = body; }
      options.success({ statusCode: response.status, data, header: Object.fromEntries(response.headers.entries()) });
    }).catch(error => options.fail({ errMsg: error.message }));
    return { abort() {} };
  },
};

const envModule = require('../../.verification/miniprogram-js/config/environment.js');
const { api } = require('../../.verification/miniprogram-js/services/api.js');
const { signIn, initSession, signOut } = require('../../.verification/miniprogram-js/services/session.js');
const { request, ApiError } = require('../../.verification/miniprogram-js/services/request.js');
let phase = 'setup';
const id = () => {
  const n = require('node:crypto').randomUUID();
  return n;
};

(async () => {
  const usernameA = process.env.SPINE_VERIFY_USER_A;
  const usernameB = process.env.SPINE_VERIFY_USER_B;
  const password = process.env.SPINE_VERIFY_PASSWORD;
  const base = process.env.SPINE_VERIFY_API || 'http://127.0.0.1:8001';
  if (!usernameA || !usernameB || !password) throw new Error('Verification credentials are missing.');
  // The service object is redirected only in this test harness; application config is unchanged.
  envModule.API_BASE_URL = base;

  phase = 'login A';
  await signIn(usernameA, password);
  const oldToken = wx.getStorageSync('spine.session.token');
  assert.equal((await api.me()).username, usernameA);
  phase = 'create brace';
  const brace = await api.saveBrace({ name: `Mini 验证支具 ${id().slice(0, 8)}`, brace_type: '联调', notes: '自动验证，保留记录', institution: '', started_on: '2026-09-01', is_active: true });

  phase = 'wear start and restore';
  const startRequestId = id();
  const open = await api.startWear(brace.id, startRequestId);
  assert.equal((await api.startWear(brace.id, startRequestId)).id, open.id);
  assert.equal(open.ended_at, null);
  assert.equal(await initSession(true), 'signedIn');
  assert.equal((await api.wears()).some(w => w.id === open.id && !w.ended_at), true);
  await api.endWear(open.id);
  await api.endWear(open.id);

  phase = 'cross-day backfill';
  const backfillRequestId = id();
  const backfillData = { brace: brace.id, started_at: '2026-09-15T23:30:00+08:00', ended_at: '2026-09-16T01:00:00+08:00', notes: '跨日自动验证', request_id: backfillRequestId, original_timezone: 'Asia/Shanghai' };
  const backfill = await api.backfill(backfillData);
  assert.equal((await api.backfill(backfillData)).id, backfill.id);
  let totals = await api.statistics(brace.id);
  const dayMap = Object.fromEntries(totals.days.map(d => [d.date, d.minutes]));
  assert.equal(dayMap['2026-09-15'], 30);
  assert.equal(dayMap['2026-09-16'], 60);

  phase = 'overlap rejection and correction';
  const clash = await api.backfill({ brace: brace.id, started_at: '2026-09-16T00:00:00+08:00', ended_at: '2026-09-16T00:30:00+08:00', notes: '', request_id: id(), original_timezone: 'Asia/Shanghai' }).then(() => false).catch(e => e instanceof ApiError && e.status === 409);
  assert.equal(clash, true);
  await api.correctWear(backfill.id, { ended_at: '2026-09-16T02:00:00+08:00', version: backfill.version, reason: '自动验证修正' });
  totals = await api.statistics(brace.id);
  const corrected = Object.fromEntries(totals.days.map(d => [d.date, d.minutes]));
  assert.equal(corrected['2026-09-15'], 30);
  assert.equal(corrected['2026-09-16'], 120);
  assert.equal((await api.revisions(backfill.id)).length, 1);

  phase = 'comfort entries and follow-up';
  phase = 'save nullable pain record';
  const feelingRequestId = id();
  const feelingData = { brace: brace.id, wear_session: backfill.id, comfort_level: 2, pain: null, pain_note: '联调文字', positions: ['腰部'], tags: ['压迫'], occurred_at: '2026-09-16T00:10:00+08:00', notes: '', request_id: feelingRequestId };
  const feeling = await api.saveFeeling(feelingData);
  assert.equal((await api.saveFeeling(feelingData)).id, feeling.id);
  assert.equal(feeling.pain, null);
  phase = 'save zero pain record';
  const zero = await api.saveFeeling({ brace: brace.id, wear_session: backfill.id, comfort_level: 3, pain: 0, pain_note: '零分', positions: [], tags: [], occurred_at: '2026-09-16T00:20:00+08:00', notes: '', request_id: id() });
  assert.equal(zero.pain, 0);
  phase = 'save follow-up';
  const followUpData = { entry: feeling.id, status: 'improved', occurred_at: '2026-09-16T01:00:00+08:00', notes: '自动验证', request_id: id() };
  const followUp = await api.addFollowUp(followUpData);
  assert.equal((await api.addFollowUp(followUpData)).id, followUp.id);
  assert.equal((await api.followUps(feeling.id))[0].status, 'improved');

  phase = 'logout and stale token';
  assert.equal(await signOut(), true);
  wx.setStorageSync('spine.session.token', oldToken);
  const oldRejected = await api.me().then(() => false).catch(e => e instanceof ApiError && e.status === 401);
  assert.equal(oldRejected, true);
  wx.clearStorageSync();
  phase = 'login B and deny A data';
  await signIn(usernameB, password);
  const privateDenied = await request('GET', `/api/v1/braces/${brace.id}/`).then(() => false).catch(e => e instanceof ApiError && e.status === 404);
  assert.equal(privateDenied, true);
  const associationDenied = await api.saveFeeling({ brace: brace.id, pain: 0, positions: [], tags: [], occurred_at: '2026-09-16T00:10:00+08:00', request_id: id() }).then(() => false).catch(e => e instanceof ApiError && e.status === 400);
  assert.equal(associationDenied, true);
  await signOut();
  console.log('Mini Program TypeScript request/session integration: PASS (real Django/PostgreSQL; A/B isolation, session recovery/revocation, wear, cross-midnight stats, correction audit, nullable pain, follow-up).');
})().catch(error => {
  const detail = typeof global.__lastServerError === 'string'
    ? (() => {
        try { const json = JSON.parse(global.__lastServerError); return typeof json.detail === 'string' ? json.detail.slice(0, 300) : ''; }
        catch { return (global.__lastServerError.match(/(?:Exception Value|exception_value)[\s\S]{0,300}/)?.[0] || '').replace(/<[^>]+>/g, '').slice(0, 300); }
      })()
    : '';
  console.error(`Verification failed during ${phase}${error instanceof ApiError ? ` (HTTP ${error.status})` : ''}${detail ? `: ${detail}` : '.'}`);
  process.exitCode = 1;
});
