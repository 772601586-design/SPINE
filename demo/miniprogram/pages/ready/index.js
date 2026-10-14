const { bindPage } = require('../../core/bridge');

// 准备好了：本页用到的视图字段（由构建脚本从 WXML 统计）
Page(bindPage('ready', ["nav", "readyReport", "readyRx", "readyText", "readyTitle", "st", "stageLabel"]));
