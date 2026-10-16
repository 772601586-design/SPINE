const { bindPage } = require('../../core/bridge');

// 动作卡片：本页用到的视图字段（由构建脚本从 WXML 统计）
Page(bindPage('card', ["card", "cardEditBg", "cardEditFg", "cardEditLabel", "cardEditText", "cardEditing", "cardTabs", "cardView", "ct", "followThis", "nav", "toggleCardEdit"]));
