/**
 * 排卡规则（纯函数，不依赖界面）
 *
 * 卡组 = 处方动作中“今天该做”的那些，按模块顺序排列。
 * 隔天规则（按单个动作计算，只在后台运行，页面上不显示规则文字）：
 *   - 每天的动作：每天出现
 *   - 隔天的动作：上次完成日为 d 时，d+1 不出现，d+2 起出现；
 *                 从没做过或一直没做，就一直出现（顺延）
 * 日期用整数天表示：今天 = 0，明天 = 1，前天 = -2。
 *
 * ⚠ 模块分类与顺序待医生确认，确认后只改 MODULE_ORDER 和 ALT_MODULES。
 */
const Scheduler = {
  MODULE_ORDER: ['柔韧', '3D 矫正', '核心', '颈椎', '拉伸放松'],
  ALT_MODULES: ['核心'],

  freqOf(card) {
    return this.ALT_MODULES.indexOf(card.mod) !== -1 ? 'alt' : 'daily';
  },

  isDue(card, lastDoneDay, day) {
    if (this.freqOf(card) === 'daily') return true;
    if (lastDoneDay == null) return true;
    return day - lastDoneDay >= 2;
  },

  /** cards: { id: { mod } }；lastDone: { id: 最近完成日 }；返回当天卡组的 id 列表 */
  buildDeck(cards, lastDone, day) {
    const order = this.MODULE_ORDER;
    return Object.keys(cards).map(Number)
      .filter((id) => this.isDue(cards[id], lastDone[id], day))
      .sort((a, b) => (order.indexOf(cards[a].mod) - order.indexOf(cards[b].mod)) || (a - b));
  },

  /** 今天打卡后，推算明天的卡组 */
  tomorrow(cards, lastDone, doneToday) {
    const next = Object.assign({}, lastDone);
    doneToday.forEach((id) => { next[id] = 0; });
    return this.buildDeck(cards, next, 1);
  }
};

/** 示例历史：核心动作上次在前天（-2）练过，所以今天是核心日。正式版从打卡记录计算。 */
const HISTORY = { lastDone: { 5: -2, 6: -2, 7: -2, 8: -2, 9: -2 } };

module.exports = { Scheduler, HISTORY };
