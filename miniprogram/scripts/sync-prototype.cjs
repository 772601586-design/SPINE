const fs = require('node:fs');
const path = require('node:path');

// Reproduce all original prototype pages in an isolated subpackage.
// Only routing, the sample-data notice and exit controls differ from the source.
const root = path.resolve(__dirname, '..');
const source = path.resolve(root, '../spine1/demo/miniprogram');
const target = path.join(root, 'prototype');
const original = JSON.parse(fs.readFileSync(path.join(source, 'app.json'), 'utf8'));
const tabs = original.tabBar.list.map(item => ({
  screen: item.pagePath.split('/')[1], label: item.text,
  icon: '/' + item.iconPath, activeIcon: '/' + item.selectedIconPath,
}));
function write(relative, text) {
  const destination = path.join(target, relative);
  fs.mkdirSync(path.dirname(destination), {recursive: true});
  fs.writeFileSync(destination, text, 'utf8');
}
for (const filename of ['spine-app.js', 'scheduler.js', 'u.wxs']) {
  write('core/' + filename, fs.readFileSync(path.join(source, 'core', filename), 'utf8'));
}
const store = fs.readFileSync(path.join(source, 'core/store.js'), 'utf8')
  .replace("'spine-state-v1'", "'spine.prototype.state.v1'")
  .replace("'pages/' + screen", "'prototype/pages/' + screen")
  .replace('wx.switchTab({ url });', 'wx.reLaunch({ url });')
  .replace('  TABS,', '  TABS,\n  navigate,');
write('core/store.js', store);
const bridge = fs.readFileSync(path.join(source, 'core/bridge.js'), 'utf8')
  .replace("wx.switchTab({ url: '/pages/today/index' });", "store.navigate('today');")
  .replace('    data: {},', `    data: { prototypeTabs: ${JSON.stringify(tabs)}.map((item, index) => Object.assign({}, item, {
      _k: index, className: item.screen === screen ? 'prototype-tab-on' : '',
      iconSource: item.screen === screen ? item.activeIcon : item.icon
    })), prototypeActive: screen },`)
  .replace('    act(e) {', `    exitDemo() { wx.reLaunch({ url: '/pages/login/index' }); },
    choosePrototypeTab(e) {
      const screen = e.currentTarget.dataset.screen;
      if (store.TABS.indexOf(screen) !== -1) store.app.go(screen);
    },
    act(e) {`);
write('core/bridge.js', bridge);
const baseStyle = fs.readFileSync(path.join(source, 'app.wxss'), 'utf8');
const style = `${baseStyle}
.prototype-content { line-height: 1.5; }
.prototype-notice { display: flex; justify-content: space-between; align-items: center; padding: 12rpx 28rpx; background: #f7eadb; color: #794b2e; font-size: 22rpx; gap: 16rpx; }
.prototype-exit { color: #1f6f66; padding: 8rpx 0; font-weight: 600; }
.prototype-tab-space { height: calc(120rpx + env(safe-area-inset-bottom)); }
.prototype-tabs { position: fixed; left: 0; right: 0; bottom: 0; z-index: 20; display: flex; background: #fff; border-top: 1rpx solid #edf0ee; padding: 14rpx 0 calc(14rpx + env(safe-area-inset-bottom)); }
.prototype-tab { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6rpx; font-size: 22rpx; color: #5b6663; }
.prototype-tab-on { color: #1f6f66; font-weight: 700; }
.prototype-tab image { width: 42rpx; height: 42rpx; }
`;
const footer = `
<view class="prototype-tab-space"></view>
<view class="prototype-tabs"><view wx:for="{{prototypeTabs}}" wx:for-item="item" wx:for-index="index" wx:key="screen" class="prototype-tab {{item.className}}" data-screen="{{item.screen}}" bindtap="choosePrototypeTab" hover-class="tap"><image src="{{item.iconSource}}" /><text>{{item.label}}</text></view></view>
`;
for (const route of original.pages) {
  const screen = route.split('/')[1];
  let js = fs.readFileSync(path.join(source, route + '.js'), 'utf8');
  js = js.replace('会清空本机上的所有记录，从首次使用重新开始。', '只重置完整 demo 的示例状态，不影响真实档案、训练记录和本机录像。');
  write(route + '.js', js);
  const markup = fs.readFileSync(path.join(source, route + '.wxml'), 'utf8');
  write(route + '.wxml', `<view class="prototype-notice"><text>完整原型 · 示例数据 · 非本人处方</text><text class="prototype-exit" bindtap="exitDemo">返回真实功能 ›</text></view>\n<view class="prototype-content">\n${markup}\n</view>${tabs.some(tab => tab.screen === screen) ? footer : ''}`);
  write(route + '.wxss', style);
  const config = JSON.parse(fs.readFileSync(path.join(source, route + '.json'), 'utf8'));
  config.navigationBarTitleText = 'Demo · ' + config.navigationBarTitleText;
  write(route + '.json', JSON.stringify(config, null, 2) + '\n');
}
// Used by the prototype's script-based regression checker; not an independent app.
write('app.json', JSON.stringify(original, null, 2) + '\n');
console.log(`Synced ${original.pages.length} prototype screens.`);
