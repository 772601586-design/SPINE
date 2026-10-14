const { bindPage } = require('../../core/bridge');

// 跟练：本页用到的视图字段（由构建脚本从 WXML 统计）
Page(bindPage('follow', ["fBig", "fCard", "fNext", "fOpenCard", "fPhase", "fPoseText", "fSmall", "followNext", "followTitle", "paused", "playLabel", "playing", "segs", "togglePlay"]));
