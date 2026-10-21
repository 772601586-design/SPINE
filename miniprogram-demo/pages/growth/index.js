const { bindPage } = require('../../core/bridge');
const t = require('../../core/training');
const brace = require('../../core/brace-records');
const definition = bindPage('growth', ["makeSummary", "nav", "nextVisitText", "trainCount", "visits"]);
definition.data = { trainingHistory: [], trainingWeek: [], recordedCount: 0, partialCount: 0, summaryText: '', trainingError: '' };
definition.reloadTraining = function () {
  const state = t.load(), week = t.week(t.today()), start = week[0].date, end = week[6].date;
  const history = state.sessions.filter(record => t.status(record) !== 'unrecorded').sort((a,b) => b.date.localeCompare(a.date));
  const weekly = history.filter(record => record.date >= start && record.date <= end);
  this.setData({ summaryText: '', trainCount: history.length, recordedCount: weekly.length, partialCount: weekly.filter(record => t.status(record) === 'partial').length,
    trainingHistory: history.map(record => ({ id: record.id, date: record.date, name: record.planName, status: t.status(record) === 'completed' ? '已完成' : t.status(record) === 'partial' ? '部分完成' : '未完成', count: record.rows.length })),
    trainingWeek: week.map(day => { const records = weekly.filter(record => record.date === day.date), partial = records.some(record => t.status(record) !== 'completed'); return Object.assign({}, day, { height: records.length ? partial ? 55 : 100 : 0, partial }); }) });
};
definition.openTrainingRecord = function (event) { wx.navigateTo({ url: '/pages/execution/index?session=' + event.currentTarget.dataset.id }); };
definition.backfillTraining = function () { wx.navigateTo({ url: '/pages/execution/index?backfill=1' }); };
definition.trainingSummary = function () {
  const state = t.load(), lines = ['训练周期汇总 · ' + t.today()];
  state.sessions.filter(record => t.status(record) !== 'unrecorded').sort((a,b) => a.date.localeCompare(b.date)).forEach(record => {
    lines.push(record.date + ' · ' + record.planName + ' · ' + (t.status(record) === 'completed' ? '已完成' : t.status(record) === 'partial' ? '部分完成' : '未完成'));
    record.rows.forEach(row => lines.push(row.name + '：当时要求 ' + t.dose(row) + '；实际 ' + row.values.map(value => value === null ? '未记录' : String(value)).join(' / ') + t.unit(row.mode) + (row.feeling ? '；感受：' + row.feeling : '')));
  });
  if (lines.length === 1) lines.push('还没有实际训练记录。');
  this.setData({ summaryText: lines.join('\n') });
};
definition.copyTrainingSummary = function () { wx.setClipboardData({ data: this.data.summaryText }); };
const refreshLegacy = definition.refresh;
definition.refresh = function () { refreshLegacy.call(this); this.reloadTraining(); this.reloadBrace(); };
Page(brace.attach(definition));
