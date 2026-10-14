const { bindPage } = require('../../core/bridge');

// 选择治疗阶段：本页用到的视图字段（由构建脚本从 WXML 统计）
Page(bindPage('stage', ["stageBtn", "stageNext", "stageStep", "stages"]));
