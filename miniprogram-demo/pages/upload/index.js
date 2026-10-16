const { bindPage } = require('../../core/bridge');

// 添加复查记录：本页用到的视图字段（由构建脚本从 WXML 统计）
Page(bindPage('upload', ["saveUpload", "toggleUpEdit", "upEditBg", "upEditFg", "upEditLabel", "upEditText", "upEditing", "upFields", "upView"]));
