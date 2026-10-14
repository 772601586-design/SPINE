const { bindPage } = require('../../core/bridge');

// 训练：本页用到的视图字段（由构建脚本从 WXML 统计）
Page(bindPage('train', ["draftCount", "hasDrafts", "modules", "nav", "rxLine", "weekRows"]));
