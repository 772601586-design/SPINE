const { bindPage } = require('../../core/bridge');

// 欢迎：本页用到的视图字段（由构建脚本从 WXML 统计）
Page(bindPage('welcome', ["genders", "isCustomGender", "nav"]));
