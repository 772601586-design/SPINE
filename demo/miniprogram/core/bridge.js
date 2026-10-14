/**
 * 页面桥接：把 SpineApp.renderVals() 的结果交给小程序页面
 *
 * renderVals() 返回的视图数据里带有函数（比如每张卡片的“打卡”）。
 * 小程序的 setData 不能传函数，所以这里把函数换成编号（"f12"），
 * 存在页面实例上；WXML 里用 bindtap="act" data-fn="{{ c.check }}" 触发，
 * act() 再按编号找回原函数执行。
 *
 * 每个页面只 setData 自己用到的顶层字段（keys），由构建脚本从 WXML 里统计。
 */
const store = require('./store');

const PX = /(\d+(?:\.\d+)?)px\b/g;
const RPX_PER_PX = 750 / 390; // 原型按 390 宽设计，换算成 rpx 以适配各种屏幕

function toRpx(str) {
  return str.replace(PX, (_, n) => Math.round(parseFloat(n) * RPX_PER_PX * 100) / 100 + 'rpx');
}

function serialize(v, fns) {
  if (typeof v === 'function') {
    const id = 'f' + fns.length;
    fns.push(v);
    return id;
  }
  if (typeof v === 'string') return v.indexOf('px') !== -1 ? toRpx(v) : v;
  if (Array.isArray(v)) {
    return v.map((x, i) => {
      const o = serialize(x, fns);
      if (o && typeof o === 'object' && !Array.isArray(o)) o._k = i;
      return o;
    });
  }
  if (v && typeof v === 'object') {
    const o = {};
    Object.keys(v).forEach((k) => { o[k] = serialize(v[k], fns); });
    return o;
  }
  return v;
}

function bindPage(screen, keys, extra) {
  return Object.assign({
    data: {},
    spineScreen: screen,
    onLoad() {
      // 首次使用的入口：已经建过档的用户直接进首页
      if (screen === 'welcome' && store.app.state.onboarded) {
        wx.switchTab({ url: '/pages/today/index' });
      }
    },
    onShow() {
      store.enter(screen);
      this.refresh();
    },
    refresh() {
      const vm = store.vm();
      const fns = [];
      const data = {};
      keys.forEach((k) => { data[k] = serialize(vm[k], fns); });
      this._fns = fns;
      this.setData(data);
    },
    act(e) {
      const fn = this._fns && this._fns[Number(String(e.currentTarget.dataset.fn).slice(1))];
      if (typeof fn !== 'function') return;
      if (e.type === 'input') fn({ target: { value: e.detail.value } });
      else fn(e);
    }
  }, extra || {});
}

module.exports = { bindPage };
