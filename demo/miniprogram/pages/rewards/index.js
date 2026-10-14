const { bindPage } = require('../../core/bridge');

// 松果与勋章：本页用到的视图字段（由构建脚本从 WXML 统计）
Page(bindPage('rewards', ["doMakeup", "gotToday", "makeupBg", "makeupLeft", "makeupText", "medals", "pine", "tasks"]));
