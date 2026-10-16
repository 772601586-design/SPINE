const { bindPage } = require('../../core/bridge');

// 导入处方：本页用到的视图字段（由构建脚本从 WXML 统计）
Page(bindPage('import', ["importBtn", "importNext", "rxEditBg", "rxEditFg", "rxEditLabel", "rxEditText", "rxEditing", "rxNameOpts", "rxRows", "rxView", "toggleRxEdit"]));
