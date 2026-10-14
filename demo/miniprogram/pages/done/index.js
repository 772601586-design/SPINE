const { bindPage } = require('../../core/bridge');

// 完成打卡：本页用到的视图字段（由构建脚本从 WXML 统计）
Page(bindPage('done', ["justRewarded", "nav", "pine", "trainCount"]));
