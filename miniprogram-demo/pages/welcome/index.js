const { bindPage } = require('../../core/bridge');
const store = require('../../core/store');

function currentMonth() {
  const today = new Date();
  return today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');
}

function isBirthMonth(value, latestMonth) {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
    && value >= '1900-01' && value <= latestMonth;
}

const welcomePage = bindPage('welcome', ['nav']);

Page({
  ...welcomePage,
  refresh() {
    const latestMonth = currentMonth();
    const savedMonth = store.app.state.birthMonth;
    const birthMonth = isBirthMonth(savedMonth, latestMonth) ? savedMonth : '';
    const [year, month] = birthMonth.split('-');
    this.setData({
      currentMonth: latestMonth,
      birthMonth,
      birthMonthLabel: birthMonth ? year + ' 年 ' + Number(month) + ' 月' : ''
    });
    welcomePage.refresh.call(this);
  },
  onBirthMonth(event) {
    const value = event.detail.value;
    if (isBirthMonth(value, currentMonth())) store.app.setState({ birthMonth: value });
  },
  clearBirthMonth() {
    store.app.setState({ birthMonth: '' });
  }
});
