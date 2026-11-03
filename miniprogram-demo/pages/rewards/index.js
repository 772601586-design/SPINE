const { bindPage } = require('../../core/bridge');
const art = require('../../core/brand-art');

// 松果与勋章：本页用到的视图字段（由构建脚本从 WXML 统计）
const definition = bindPage('rewards', ["doMakeup", "gotToday", "medals", "pine", "tasks"]);
definition.data = { brand: art };
const refresh = definition.refresh;
definition.refresh = function () {
  refresh.call(this);
  const icons = [art.sprout, art.leaves, art.report, art.calendar, art.brace, art.star];
  this.setData({ medals: this.data.medals.map((medal, index) => Object.assign({}, medal, { icon: icons[index], earned: medal.badge === '✓' })) });
};
Page(definition);
