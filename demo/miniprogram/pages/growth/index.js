const { bindPage } = require('../../core/bridge');

// 成长：本页用到的视图字段（由构建脚本从 WXML 统计）
Page(bindPage('growth', ["makeSummary", "nav", "nextVisitText", "trainCount", "visits"]));
