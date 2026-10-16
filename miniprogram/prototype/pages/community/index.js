const { bindPage } = require('../../core/bridge');

// 社群：本页用到的视图字段（由构建脚本从 WXML 统计）
Page(bindPage('community', ["articles", "cm", "commTabs", "doDraw", "drawBg", "drawText", "guides", "pat", "patBg", "patText", "quizOpts", "quizRight", "quizWrong"]));
