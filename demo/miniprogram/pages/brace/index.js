const { bindPage } = require('../../core/bridge');

// 我的支具：本页用到的视图字段（由构建脚本从 WXML 统计）
Page(bindPage('brace', ["braceBtn", "braceStatus", "nav", "toggleBrace"]));
