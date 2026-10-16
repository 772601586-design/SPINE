const { bindPage } = require('../../core/bridge');

// 现场录动作：本页用到的视图字段（由构建脚本从 WXML 统计）
Page(bindPage('record', ["recCount", "recFinish", "recMore", "recName", "recNameVal", "recReady", "recRec", "recStart", "recStop", "setRecName"]));
