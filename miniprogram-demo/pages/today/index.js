const { bindPage } = require('../../core/bridge');

// 今日：本页用到的视图字段（由构建脚本从 WXML 统计）
Page(bindPage('today', ["addSwim", "allDone", "braceDash", "braceGoal", "braceHours", "coreDayText", "dateLine", "deck", "deckLen", "doStand", "doneCount", "hasDeck", "hasLeft", "leftCount", "makeSummary", "nav", "pains", "pine", "ringDash", "showPrep", "st", "standDone", "standTodo", "startFollow", "swim"]));
