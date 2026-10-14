// 用法：node tools/check.js .   （在 miniprogram 目录下运行；可加随机种子：node tools/check.js . 7）
// 小程序运行模拟：mock wx / Page / getCurrentPages，渲染 WXML 检查绑定，并按流程点击
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(process.argv[2] || '.');
const SEED = Number(process.argv[3] || 1);

// ---------- 极简 WXML 解析 ----------
function parse(src) {
  src = src.replace(/<!--[\s\S]*?-->/g, '');
  const root = { tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<(\/?)([\w-]+)((?:\s+[\w:-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[5] !== undefined) { if (m[5].trim()) stack[stack.length - 1].children.push({ text: m[5] }); continue; }
    const [, close, tag, attrStr, self] = m;
    if (close) {
      const top = stack.pop();
      if (top.tag !== tag) throw new Error('mismatched </' + tag + '> vs <' + top.tag + '>');
      continue;
    }
    const attrs = {};
    attrStr.replace(/([\w:-]+)(?:="([^"]*)")?/g, (_, k, v) => { attrs[k] = v === undefined ? true : v.replace(/&quot;/g, '"'); });
    const node = { tag, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!self && tag !== 'wxs') stack.push(node);
  }
  if (stack.length !== 1) throw new Error('unclosed <' + stack[stack.length - 1].tag + '>');
  return root;
}

const HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
function evalExpr(expr, scope, missing) {
  expr = expr.trim();
  if (expr === "'\\n'") return '\n';
  let m = expr.match(/^u\.enc\((.+)\)$/);
  if (m) return String(evalExpr(m[1], scope, missing)).replace(/#/g, '%23').replace(/ /g, '%20');
  if (expr === 'true') return true;
  if (expr === 'false') return false;
  const parts = expr.split('.');
  let v;
  for (let i = scope.length - 1; i >= 0; i--) { if (parts[0] in scope[i]) { v = scope[i][parts[0]]; break; } }
  for (let k = 1; k < parts.length; k++) { if (v == null) break; v = v[parts[k]]; }
  if (v === undefined) missing.add(expr);
  return v;
}
function interp(str, scope, missing) {
  const single = str.match(/^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/);
  if (single) return evalExpr(single[1], scope, missing);
  return str.replace(HOLE, (_, e) => { const v = evalExpr(e, scope, missing); return v == null ? '' : String(v); });
}
function render(node, scope, out, missing) {
  if (node.text !== undefined) { out.text.push(interp(node.text, scope, missing)); return; }
  const a = node.attrs;
  if (a['wx:if'] !== undefined) { if (!interp(a['wx:if'], scope, missing)) return; }
  if (a['wx:for'] !== undefined) {
    const list = interp(a['wx:for'], scope, missing) || [];
    if (!Array.isArray(list)) { missing.add('NOT-ARRAY ' + a['wx:for']); return; }
    list.forEach((item, i) => {
      if (item && typeof item === 'object' && item._k === undefined) missing.add('NO _k in ' + a['wx:for']);
      const s = {}; s[a['wx:for-item'] || 'item'] = item; s[a['wx:for-index'] || 'index'] = i;
      node.children.forEach((c) => render(c, scope.concat([s]), out, missing));
    });
    return;
  }
  Object.keys(a).forEach((k) => { if (typeof a[k] === 'string' && a[k].indexOf('{{') !== -1 && k !== 'wx:if') interp(a[k], scope, missing); });
  if (a.bindtap) out.taps.push(a.bindtap === 'act' ? { fn: interp(a['data-fn'], scope, missing) } : { method: a.bindtap });
  if (a.bindinput) out.inputs.push({ fn: interp(a['data-fn'], scope, missing) });
  node.children.forEach((c) => render(c, scope, out, missing));
}

// ---------- mock 运行环境 ----------
let rnd = SEED;
const random = () => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return rnd / 2147483648; };
const storage = {};
let ticks = [];
const stack = [];
const toasts = [];
const pageDefs = {};
const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json')));
const TABS = appJson.tabBar.list.map((t) => t.pagePath);
const tabInstances = {};
const navLog = [];

function makePage(route) {
  const def = pageDefs[route];
  if (!def) throw new Error('no page ' + route);
  const inst = Object.create(null);
  Object.keys(def).forEach((k) => { inst[k] = typeof def[k] === 'function' ? def[k] : JSON.parse(JSON.stringify(def[k] === undefined ? null : def[k])); });
  inst.route = route; inst.data = {};
  inst.setData = function (d) { Object.assign(this.data, d); };
  return inst;
}
function show(inst) { inst.onShow && inst.onShow(); }
function open(route, kind) {
  route = route.replace(/^\//, '').replace(/\?.*$/, '');
  navLog.push(kind + ' ' + route.split('/')[1]);
  if (kind === 'switchTab') {
    if (TABS.indexOf(route) === -1) throw new Error('switchTab to non-tab ' + route);
    stack.length = 0;
    let inst = tabInstances[route];
    if (!inst) { inst = makePage(route); tabInstances[route] = inst; stack.push(inst); inst.onLoad && inst.onLoad({}); }
    else stack.push(inst);
    show(inst); return;
  }
  if (TABS.indexOf(route) !== -1) throw new Error(kind + ' to tab page ' + route);
  if (kind === 'reLaunch') { stack.length = 0; Object.keys(tabInstances).forEach((k) => delete tabInstances[k]); }
  if (kind === 'redirectTo') stack.pop();
  if (kind === 'navigateTo' && stack.length >= 10) throw new Error('page stack overflow');
  const inst = makePage(route); stack.push(inst); inst.onLoad && inst.onLoad({}); show(inst);
}
global.wx = {
  getStorageSync: (k) => storage[k], setStorageSync: (k, v) => { storage[k] = JSON.parse(JSON.stringify(v)); },
  removeStorageSync: (k) => { delete storage[k]; },
  showToast: (o) => toasts.push(o.title), showModal: (o) => o.success && o.success({ confirm: true }),
  nextTick: (f) => ticks.push(f),
  navigateTo: (o) => ticks.push(() => open(o.url, 'navigateTo')),
  redirectTo: (o) => ticks.push(() => open(o.url, 'redirectTo')),
  reLaunch: (o) => ticks.push(() => open(o.url, 'reLaunch')),
  switchTab: (o) => ticks.push(() => open(o.url, 'switchTab')),
  navigateBack: (o) => ticks.push(() => { const d = (o && o.delta) || 1; navLog.push('back ' + d); for (let i = 0; i < d && stack.length > 1; i++) stack.pop(); show(stack[stack.length - 1]); })
};
global.getCurrentPages = () => stack.slice();
global.App = () => {};
let currentRoute = null;
global.Page = (opts) => { pageDefs[currentRoute] = opts; };
appJson.pages.forEach((r) => { currentRoute = r; require(path.join(ROOT, r + '.js')); });
const wxml = {};
appJson.pages.forEach((r) => { wxml[r] = parse(fs.readFileSync(path.join(ROOT, r + '.wxml'), 'utf8')); });

function drain() { let n = 0; while (ticks.length) { if (++n > 200) throw new Error('tick loop'); ticks.shift()(); } }
function cur() { return stack[stack.length - 1]; }
const problems = [];
function check(tag) {
  const p = cur();
  const missing = new Set();
  const out = { taps: [], inputs: [], text: [] };
  render(wxml[p.route], [p.data], out, missing);
  missing.forEach((m) => problems.push(tag + ' @' + p.route + ' missing ' + m));
  out.taps.forEach((t) => { if (!t.method && !/^f\d+$/.test(String(t.fn))) problems.push(tag + ' @' + p.route + ' bad fn ' + t.fn); });
  return out;
}
function tapText(re) {
  const out = check('find');
  // 按文字找：重新渲染并记录每个可点元素包含的文字
  const p = cur();
  const hits = [];
  (function walk(node, scope) {
    if (node.text !== undefined) return;
    const a = node.attrs; const miss = new Set();
    if (a['wx:if'] !== undefined && !interp(a['wx:if'], scope, miss)) return;
    if (a['wx:for'] !== undefined) {
      (interp(a['wx:for'], scope, miss) || []).forEach((item, i) => { const s = {}; s[a['wx:for-item']] = item; s[a['wx:for-index']] = i; node.children.forEach((c) => walk(c, scope.concat([s]))); });
      return;
    }
    if (a.bindtap) {
      const txt = []; (function t(n, sc) { if (n.text !== undefined) txt.push(interp(n.text, sc, miss)); else { if (n.attrs['wx:if'] !== undefined && !interp(n.attrs['wx:if'], sc, miss)) return; n.children.forEach((c) => t(c, sc)); } })(node, scope);
      hits.push({ fn: a.bindtap === 'act' ? interp(a['data-fn'], scope, miss) : null, method: a.bindtap === 'act' ? null : a.bindtap, text: txt.join('') + ' ' + (a['aria-label'] ? interp(a['aria-label'], scope, miss) : '') });
    }
    node.children.forEach((c) => walk(c, scope));
  })(wxml[p.route], [p.data]);
  const h = hits.find((x) => re.test(x.text.trim()));
  if (!h) throw new Error('no tap matching ' + re + ' on ' + p.route + ' :: ' + hits.map((x) => x.text.trim()).join(' / '));
  if (h.method) p[h.method](); else p.act({ type: 'tap', currentTarget: { dataset: { fn: h.fn } } });
  drain();
  return h.text.trim();
}
const where = () => cur().route.split('/')[1];
function expect(screen, step) { if (where() !== screen) problems.push(step + ': expected ' + screen + ' got ' + where()); }

// ---------- 场景 1：首次使用 → 首页 → 打卡 → 跟练 → 完成 ----------
open(appJson.pages[0], 'reLaunch'); drain();
expect('welcome', 'launch');
check('welcome');
tapText(/^自定义/); check('custom gender');
tapText(/下一步/); expect('stage', 'welcome next');
tapText(/刚开始戴支具/); tapText(/下一步/); expect('basics', 'stage next');
tapText(/下一步|继续|好了/); expect('ready', 'basics next');
tapText(/开始|进入|首页/); expect('today', 'ready → today');
const stackAfterOnboard = stack.length;
if (stackAfterOnboard !== 1) problems.push('stack after onboarding ' + stackAfterOnboard);
check('today-new');

// 回到支具期，打卡全部
cur().spineScreen; // noop
const store = require(path.join(ROOT, 'core/store.js'));
store.app.setState({ stage: 'brace', done: [1, 2, 3, 4] }); drain(); check('today-brace');
tapText(/^打卡$/);
tapText(/开始跟练|跟练剩下/); expect('follow', 'start follow');
let guard = 0;
while (where() === 'follow' && guard++ < 20) tapText(/完成，下一个/);
expect('done', 'follow to done');
const pine1 = store.app.state.pine;
tapText(/回到今日|返回今日|好的|完成/);
expect('today', 'done → today');

// ---------- 场景 2：先录后配 ----------
open('pages/train/index', 'switchTab'); drain();
tapText(/现场录/); expect('record', 'to record');
tapText(/开始录制/); tapText(/停止录制/);
const inp = check('record-name').inputs[0];
cur().act({ type: 'input', currentTarget: { dataset: { fn: inp.fn } }, detail: { value: '弓箭步' } }); drain();
if (store.app.state.recName !== '弓箭步') problems.push('recName not set');
tapText(/录完了/); expect('train', 'record done');
tapText(/拍处方/); expect('import', 'to import');
tapText(/编辑/); check('import-edit'); tapText(/完成编辑/);
tapText(/下一步|确认导入/); expect('match', 'to match');
tapText(/换一个/); tapText(/完成|确认|好了/);
expect('train', 'match done');

// ---------- 场景 3：卡片、成长、上传、我的、支具、松果、社群 ----------
tapText(/强化运动/); expect('card', 'open card');
tapText(/^练/); tapText(/只练这一个/); expect('follow', 'single follow');
tapText(/完成，下一个/); if (!/card|done/.test(where())) problems.push('single follow ended on ' + where());
open('pages/growth/index', 'switchTab'); drain();
tapText(/添加复查|上传/); expect('upload', 'to upload');
tapText(/编辑/); tapText(/完成编辑/); tapText(/保存/);
open('pages/me/index', 'switchTab'); drain(); check('me');
tapText(/复查提醒/); tapText(/切换阶段/); expect('stage', 'stage from me');
tapText(/成年后自我管理/); tapText(/保存/); expect('me', 'stage saved');
tapText(/我的支具/); expect('brace', 'brace');
cur().onUnload && cur().onUnload(); stack.pop(); show(cur()); // 系统返回
expect('me', 'native back');
tapText(/松果/); expect('rewards', 'rewards');
tapText(/补卡/);
open('pages/community/index', 'switchTab'); drain();
tapText(/^学习/); tapText(/四弯型/);
tapText(/^交流/);

// ---------- 场景 4：随机点击 ----------
['check', 'new', 'brace', 'off', 'adult'].forEach((stg) => {
  store.app.setState({ stage: stg }); drain();
  for (let i = 0; i < 400; i++) {
    const out = check('fuzz-' + stg); (global.visits = global.visits || {})[where()] = (global.visits[where()] || 0) + 1;
    if (!out.taps.length) { open('pages/today/index', 'switchTab'); drain(); continue; }
    const t = out.taps[Math.floor(random() * out.taps.length)];
    if (t.method) continue;
    try { cur().act({ type: 'tap', currentTarget: { dataset: { fn: t.fn } } }); drain(); }
    catch (e) { problems.push('fuzz ' + stg + ' @' + cur().route + ' ' + e.message); break; }
    if (random() < 0.08 && stack.length > 1) { stack.pop(); show(cur()); }
    if (random() < 0.12) { open(TABS[Math.floor(random() * TABS.length)], 'switchTab'); drain(); }
  }
});

// ---------- 场景 5：重置 ----------
open('pages/me/index', 'switchTab'); drain();
tapText(/重置示例数据/); expect('welcome', 'reset');
if (store.app.state.onboarded) problems.push('reset kept onboarded');

const uniq = [...new Set(problems)];
console.log('pine after done', pine1, '| toasts', toasts.length, '| nav steps', navLog.length);
console.log('visits', JSON.stringify(global.visits), 'navlog', navLog.length); console.log('PROBLEMS', uniq.length); uniq.slice(0, 40).forEach((p) => console.log('  ' + p));
