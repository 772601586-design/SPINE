const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

function load(file, dependencies, host) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const code = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2017}}).outputText;
  vm.runInNewContext(code, {exports: {}, Error, require: name => {
    assert.ok(name in dependencies, name); return dependencies[name];
  }, ...host});
}
(async () => {
  const nav = [];
  let resolveRestore;
  const restore = new Promise(resolve => {resolveRestore = resolve;});
  let waiting = true;
  const session = {initSession: () => waiting ? restore : Promise.resolve('signedIn'),
    getCurrentIdentity: () => ({id: 1, has_profile: true, onboarding_status: 'complete'}),
    signInWithWechat: async () => {throw Error('Demo must not require a new login');}};
  let definition;
  const wx = {reLaunch: options => nav.push(options.url), switchTab: options => nav.push(options.url),
    getStorageSync: () => '', showToast() {}};
  load('pages/login/index.ts', {'../../services/session': session,
    '../../services/request': {ApiError: class extends Error {}}}, {wx, Page: value => {definition = value;}});
  const page = () => {
    const item = {...definition, data: {...definition.data}};
    item.setData = value => Object.assign(item.data, value);
    return item;
  };
  const first = page();
  const inflight = first.begin();
  first.openPrototype();
  assert.equal(nav.at(-1), '/prototype/pages/welcome/index');
  // A fresh real-login page must not be stuck behind the outgoing page's request.
  waiting = false;
  const second = page();
  await second.begin();
  assert.equal(nav.at(-1), '/pages/rehab/index');
  const count = nav.length;
  resolveRestore('signedIn');
  await inflight;
  assert.equal(nav.length, count);

  let handler;
  let clears = 0;
  let route = 'prototype/pages/today/index';
  let application;
  load('app.ts', {'./services/session': {clearSession: () => {clears++;},
    configureUnauthorizedHandler: callback => {handler = callback;}, initSession: async () => 'signedOut'},
    './services/reminders': {startReminders: async () => {}, stopReminders() {}}},
  {wx, getCurrentPages: () => [{route}], App: value => {application = value;}});
  application.onLaunch();
  const before = nav.length;
  handler();
  assert.equal(clears, 1);
  assert.equal(nav.length, before);
  route = 'pages/rehab/index';
  handler();
  assert.equal(nav.at(-1), '/pages/login/index');
  console.log('PASS: offline prototype entry, in-flight login isolation, return to real login and unauthorized routing');
})().catch(error => {console.error(error); process.exitCode = 1;});
