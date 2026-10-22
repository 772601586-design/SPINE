// Training flow from output/design. Local demo records are separate from legacy sample state.
const KEY = 'xiaoshu.training.flow.v2';
const copy = value => JSON.parse(JSON.stringify(value));
const id = prefix => prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
function today() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }
function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !isNaN(Date.parse(value + 'T00:00:00Z'))
    && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
}
function weekday(date) { return (new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7; }
function days(a, b) { return Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000); }
function seed() {
  return { version: 2, cards: [
    { id: 'sample-breath', name: '坐姿呼吸练习', notes: '示例：按现场指导核对个人要点与节奏。', sets: 3, amount: 5, mode: 'breath', confirmed: true, revision: 1, video: '', source: '示例要求' },
    { id: 'sample-wall', name: '靠墙站姿练习', notes: '示例：以本人现场指导为准。', sets: 3, amount: 30, mode: 'timer', confirmed: true, revision: 1, video: '', source: '示例要求' },
  ], plans: [{ id: 'sample-plan', name: '我的训练计划', cardIds: ['sample-breath', 'sample-wall'], schedule: 'daily',
    weekdays: [0, 2, 4], cycleDays: 7, cycleTimes: 3, start: today(), active: true, revision: 1 }], sessions: [] };
}
function load() {
  const saved = wx.getStorageSync(KEY);
  if (saved && saved.version === 2 && Array.isArray(saved.cards) && Array.isArray(saved.plans) && Array.isArray(saved.sessions)) return copy(saved);
  const state = seed(); wx.setStorageSync(KEY, state); return state;
}
function mutate(work) { const state = load(); const result = work(state); wx.setStorageSync(KEY, state); return copy(result === undefined ? state : result); }
function cardStatus(card) { return card.confirmed ? '资料已核对' : '草稿 · 待核对'; }
const unit = mode => mode === 'timer' ? '秒' : mode === 'breath' ? '次呼吸' : mode === 'count' ? '次' : '';
const dose = card => card.totalOnly && card.amount ? (card.mode === 'timer' && card.amount % 60 === 0 ? card.amount / 60 + '分钟' : card.amount + unit(card.mode))
  : !card.sets || !card.amount || !card.mode ? (card.sourceDoseText ? card.sourceDoseText + ' · 要求待核对' : (card.sets || '待填写') + '组 × ' + (card.amount || '待填写') + (unit(card.mode) || '（类型待核对）'))
  : card.sets + '组 × ' + card.amount + unit(card.mode);
function complete(row) { return Number.isInteger(row.sets) && row.sets > 0 && row.amount > 0 && row.values.length >= row.sets && row.values.slice(0, row.sets).every(value => typeof value === 'number' && value >= row.amount); }
function guidedComplete(row) { return row.sets > 0 && row.amount > 0 && (row.guidedSets || []).slice(0, row.sets).filter(Boolean).length === row.sets; }
function progress(row) { return row.values.filter(value => typeof value === 'number' && value > 0).length; }
function status(session) { return session.rows.length && session.rows.every(complete) ? 'completed' : session.rows.some(row => progress(row)) ? 'partial'
  : session.rows.some(row => row.values.some(value => value !== null)) ? 'not_completed' : 'unrecorded'; }
function due(plan, date, state) {
  if (!plan.active || date < plan.start) return false;
  if (plan.onlyDate && date !== plan.onlyDate) return false;
  if (plan.schedule === 'weekdays') return plan.weekdays.includes(weekday(date));
  if (plan.schedule === 'alternate') {
    if (plan.calendarInterval) return days(plan.start, date) % 2 === 0;
    const last = state.sessions.filter(item => item.planId === plan.id && item.date < date && status(item) === 'completed').map(item => item.date).sort().pop();
    return !last || days(date, last) >= 2;
  }
  if (plan.schedule === 'period') {
    const cycle = Math.floor(days(date, plan.start) / plan.cycleDays);
    const count = state.sessions.filter(item => item.planId === plan.id && item.date <= date && item.date >= plan.start
      && Math.floor(days(item.date, plan.start) / plan.cycleDays) === cycle && status(item) === 'completed').length;
    return state.sessions.some(item => item.planId === plan.id && item.date === date) || count < plan.cycleTimes;
  }
  return true;
}
function snapshot(plan, state, date) {
  const rows = plan.cardIds.map(cardId => state.cards.find(card => card.id === cardId)).filter(Boolean);
  if (!rows.length || (!plan.allowReviewRows && rows.some(card => !card.confirmed))) throw Error('计划中有动作待核对，请先整理动作卡，再确认计划。');
  return { id: id('session'), date, planId: plan.id, planName: plan.name, planRevision: plan.revision, createdAt: new Date().toISOString(),
    rows: rows.map(card => ({ cardId: card.id, revision: card.revision, name: card.name, notes: card.notes, video: card.video,
      groupName: card.groupName || '', sourceDoseText: card.sourceDoseText || '', totalOnly: !!card.totalOnly, confirmed: card.confirmed,
      sets: card.sets, mode: card.mode, amount: card.amount, values: Array(card.sets || 0).fill(null), guidedSets: [] })) };
}
function session(planId, date, backfill) {
  if (!validDate(date) || date > today()) throw Error('请选择今天或过去的真实训练日期。');
  return mutate(state => {
    const existing = state.sessions.find(item => item.planId === planId && item.date === date);
    if (existing) {
      // A requirement reviewed later can enter an unfinished placeholder; actual history stays intact.
      existing.rows = existing.rows.map(row => {
        const card = state.cards.find(item => item.id === row.cardId);
        if (row.confirmed !== false || !card || !card.confirmed) return row;
        return Object.assign({}, row, { revision: card.revision, name: card.name, notes: card.notes, groupName: card.groupName || '',
          sourceDoseText: card.sourceDoseText || '', totalOnly: !!card.totalOnly, confirmed: true, sets: card.sets, amount: card.amount,
          mode: card.mode, values: Array(card.sets).fill(null), guidedSets: [] });
      });
      return existing;
    }
    const plan = state.plans.find(item => item.id === planId);
    if (!plan || !plan.active) throw Error('计划已暂停或不存在，请先选择有效计划。');
    if (!backfill && !due(plan, date, state)) throw Error('该日期没有安排这份计划；如实际练习过，可选择补记真实训练。');
    const created = snapshot(plan, state, date); state.sessions.push(created); return created;
  });
}
function saveCard(values, confirm) {
  return mutate(state => {
    const existing = state.cards.find(card => card.id === values.id);
    const card = Object.assign({}, existing || { id: id('card'), revision: 0, source: '现场指导（手动填写）' }, values);
    card.id = existing ? existing.id : values.id || id('card');
    card.name = String(card.name || '').trim(); card.notes = String(card.notes || '').trim();
    card.groupName = String(card.groupName || '').trim().slice(0, 80);
    if (existing && (Number(values.sets) !== existing.sets || Number(values.amount) !== existing.amount || values.mode !== existing.mode)) card.totalOnly = false;
    card.sets = Number(card.sets); card.amount = Number(card.amount);
    if (!card.name) throw Error('请填写动作名称。');
    if (!['timer', 'count', 'breath'].includes(card.mode) && (confirm || card.mode)) throw Error('请选择训练类型。');
    if (confirm && (!Number.isInteger(card.sets) || card.sets < 1 || card.sets > 50 || !Number.isInteger(card.amount) || card.amount < 1 || card.amount > 3600)) throw Error('核对要求：组数 1～50，每组完成量 1～3600。');
    card.confirmed = !!confirm; card.revision = (existing ? existing.revision : 0) + 1;
    if (existing) state.cards[state.cards.indexOf(existing)] = card; else state.cards.push(card);
    return card;
  });
}
function saveSchemeActions(documentId, rows) {
  if (!documentId || !Array.isArray(rows) || !rows.length || rows.length > 50) throw Error('请先核对方案单中的动作，最多生成 50 个动作。');
  return mutate(state => {
    const seen = new Set();
    return rows.map(row => {
      const name = String(row.name || '').trim(), sets = Number(row.sets), amount = Number(row.amount);
      if (!row.id || seen.has(row.id)) throw Error('动作条目重复，请重新核对。');
      seen.add(row.id);
      if (!name || name.length > 160 || !Number.isInteger(sets) || sets < 1 || sets > 50 || !Number.isInteger(amount) || amount < 1 || amount > 3600 || !['timer', 'count', 'breath'].includes(row.mode)) throw Error('请补齐每个动作的名称、组数、每组完成量和类型。');
      const previous = state.cards.find(card => card.sourceSchemeDocument === documentId && (card.sourceSchemeRow === row.id || card.name.replace(/\s/g, '') === name.replace(/\s/g, '')));
      const card = Object.assign({}, previous || {}, { id: previous ? previous.id : id('card'), name, sets, amount, mode: row.mode,
        notes: String(row.notes || '').slice(0, 2000), groupName: String(row.groupName || '').trim().slice(0, 80), frequencyText: String(row.frequency || ''), confirmed: true,
        revision: previous ? previous.revision + 1 : 1, source: '方案单（本人核对）', sourceDocumentIds: [documentId],
        sourceSchemeDocument: documentId, sourceSchemeRow: row.id });
      if (previous) state.cards[state.cards.indexOf(previous)] = card; else state.cards.push(card);
      return card;
    });
  });
}
function savePlan(values) {
  return mutate(state => {
    const existing = state.plans.find(item => item.id === values.id); const plan = Object.assign({}, existing || {}, values);
    plan.name = String(plan.name || '').trim();
    if (!plan.name || !validDate(plan.start) || !['daily', 'weekdays', 'alternate', 'period'].includes(plan.schedule)) throw Error('请填写计划名称、有效开始日期和日程。');
    if (!Array.isArray(plan.cardIds) || !plan.cardIds.length || new Set(plan.cardIds).size !== plan.cardIds.length) throw Error('请选择不重复的已核对动作。');
    plan.allowReviewRows = !!(existing && existing.allowReviewRows);
    if (plan.cardIds.some(cardId => !state.cards.some(card => card.id === cardId && (card.confirmed || plan.allowReviewRows)))) throw Error('只有资料已核对的动作才能加入计划。');
    if (plan.schedule === 'weekdays' && (!plan.weekdays.length || plan.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6))) throw Error('请选择训练星期。');
    plan.cycleDays = Number(plan.cycleDays); plan.cycleTimes = Number(plan.cycleTimes);
    if (plan.schedule === 'period' && (!Number.isInteger(plan.cycleDays) || plan.cycleDays < 1 || plan.cycleDays > 90
        || !Number.isInteger(plan.cycleTimes) || plan.cycleTimes < 1 || plan.cycleTimes > plan.cycleDays)) throw Error('请设置有效周期天数和次数，次数不能大于天数。');
    plan.id = existing ? existing.id : id('plan'); plan.revision = existing ? existing.revision + 1 : 1;
    if (existing) state.plans[state.plans.indexOf(existing)] = plan; else state.plans.push(plan);
    return plan;
  });
}
function saveValues(sessionId, cardId, values, feeling) {
  return mutate(state => {
    const record = state.sessions.find(item => item.id === sessionId);
    if (!record) throw Error('本次记录不存在，请返回训练页重新选择。');
    const row = record.rows.find(item => item.cardId === cardId);
    if (row && row.confirmed === false) throw Error('请先核对动作要求，再填写实际完成量。');
    if (!row || values.length < row.sets || values.length > 100) throw Error('实际组数不能少于原要求的占位，最多保存 100 组。');
    const numbers = values.map(value => value === '' || value === null ? null : Number(value));
    if (numbers.some(value => value !== null && (!Number.isInteger(value) || value < 0 || value > 3600))) throw Error('实际完成量请填写 0～3600 的整数，未练可留空。');
    if (feeling !== undefined) { if (typeof feeling !== 'string' || feeling.length > 1000) throw Error('感受最多填写 1000 字。'); row.feeling = feeling; }
    row.values = numbers; record.updatedAt = new Date().toISOString(); return record;
  });
}
function saveSet(sessionId, cardId, index, value) {
  const record = load().sessions.find(item => item.id === sessionId);
  const row = record && record.rows.find(item => item.cardId === cardId);
  if (!row || !Number.isInteger(index) || index < 0 || index >= row.sets) throw Error('当前组不存在。');
  const values = row.values.slice(); values[index] = value; return saveValues(sessionId, cardId, values);
}
function saveGuidedSet(sessionId, cardId, index) {
  return mutate(state => {
    const record = state.sessions.find(item => item.id === sessionId);
    const row = record && record.rows.find(item => item.cardId === cardId);
    if (!row || row.confirmed === false || !Number.isInteger(index) || index < 0 || index >= row.sets || !row.amount) throw Error('请先核对当前动作要求。');
    const guidedSets = Array.from({ length: row.sets }, (_, i) => !!(row.guidedSets || [])[i]);
    guidedSets[index] = true; row.guidedSets = guidedSets; return record;
  });
}

// User-supplied attachment, transcribed without personal identifiers or inferred quantities.
function importAttachmentPlan() {
  const current = load(); if (current.attachmentChecklistVersion === 1) return;
  return mutate(state => {
    const cards = [], add = (groupName, name, sourceDoseText, sets, amount, mode, notes, totalOnly) => {
      const card = { id: 'attachment-2025-' + (cards.length + 1), groupName, name, sourceDoseText, sets: sets || 0, amount: amount || 0,
        mode: mode || '', notes: notes || '', totalOnly: !!totalOnly, confirmed: !!(sets && amount && mode), revision: 1, video: '', source: '用户提供的2025训练方案（按原文整理）' };
      cards.push(card); return card;
    };
    add('认知能力学习', '绘制脊柱曲线图', '每天10张', 0, 0, '', '根据曲线类型认识体态、骨盆和躯干偏移。原文单位为张，需核对记录方式。');
    add('姿势矫正', '坐姿：双手臂撑课桌', '未注明次数或时长', 0, 0, '', '坐凳子前1/3，骨盆固定不动，躯干挺直；原文：左臀下垫书本，或屈曲右腿降低右髋。双肩打开，下巴回缩，观察骨盆—脊柱居中线。');
    add('姿势矫正', '站姿：撑杆站立', '3分钟', 1, 180, 'timer', '', true);
    add('柔韧性练习', '猫—骆驼', '2分钟', 1, 120, 'timer', '', true);
    add('柔韧性练习', '右弓箭步：拉伸左髂腰肌', '30秒 × 2组', 2, 30, 'timer');
    add('3D矫正练习', '强化运动', '5分钟', 1, 300, 'timer', '左臀下垫沙包，降低右髋（右腿下压）；左手把肋木横杆高度平腰，右手握肋骨架高度平头顶；注意收紧左前肋及右后背，使劲吹气。', true);
    add('3D矫正练习', '肌肉圆柱', '5分钟', 1, 300, 'timer', '请对照原方案图片和现场指导核对摆位。', true);
    const core = '核心/肩胛带稳定性训练';
    add(core, '卷腹仰卧自行车', '50次 × 2组', 2, 50, 'count');
    add(core, '平板支撑', '3分钟', 1, 180, 'timer', '本组原文注明：隔天练习。', true);
    add(core, '右侧桥', '3分钟', 1, 180, 'timer', '本组原文注明：隔天练习。', true);
    add(core, '臀桥', '100个 × 2组', 2, 100, 'count');
    ['Y', 'W', 'T'].forEach(name => add(core, 'Y-W-T：' + name, '各30个 × 3组', 3, 30, 'count', '原文Y-W-T各30个、3组；本组隔天练习。'));
    ['头顶画圆圈', '鼻尖写“8”', '下巴画半圆', '沉肩拉耳', '抬头望月', '双手压额', '后仰拉伸'].forEach(name => add('颈椎矫正动作', name, '整套约5分钟，单项训练量待核对', 0, 0, '', '原文：默念4个8拍，整套动作约5分钟；未将整套时长分配给单个动作。'));
    add('拉伸·整理放松', '跪位前伸', '2分钟', 1, 120, 'timer', '', true);
    add('拉伸·整理放松', '坐位前伸', '2分钟', 1, 120, 'timer', '', true);
    add('拉伸·整理放松', '悬吊配合呼吸', '3分钟', 1, 180, 'timer', '', true);
    state.cards = state.cards.concat(cards.filter(card => !state.cards.some(existing => existing.id === card.id)));
    // Replace only the untouched starter examples; retain every custom plan and record.
    const sample = state.plans.find(plan => plan.id === 'sample-plan');
    if (sample && sample.revision === 1 && sample.cardIds.join(',') === 'sample-breath,sample-wall' && !state.sessions.some(record => record.planId === sample.id)) sample.active = false;
    const base = { start: today(), active: true, revision: 1, weekdays: [0,2,4], cycleDays: 7, cycleTimes: 3, allowReviewRows: true };
    const regular = cards.filter(card => card.groupName !== core), alternate = cards.filter(card => card.groupName === core);
    state.plans.push(Object.assign({}, base, { id: 'attachment-2025-regular', name: '附件方案 · 本次练习', onlyDate: today(), schedule: 'daily', cardIds: regular.map(card => card.id) }));
    state.plans.push(Object.assign({}, base, { id: 'attachment-2025-core', name: '附件方案 · 核心稳定性', schedule: 'alternate', cardIds: alternate.map(card => card.id) }));
    state.attachmentChecklistVersion = 1;
  });
}
function scheduleLabel(plan) {
  if (plan.schedule === 'weekdays') return '每周' + plan.weekdays.map(day => ['一', '二', '三', '四', '五', '六', '日'][day]).join('、');
  if (plan.schedule === 'alternate') return plan.calendarInterval ? '隔天（按开始日期安排）' : '完成后隔天安排，未完成顺延';
  if (plan.schedule === 'period') return '每 ' + plan.cycleDays + ' 天 ' + plan.cycleTimes + ' 次';
  return '每天';
}
function week(date) {
  const monday = new Date(Date.parse(date + 'T00:00:00Z') - weekday(date) * 86400000);
  return Array.from({ length: 7 }, (_, index) => {
    const value = new Date(monday.getTime() + index * 86400000).toISOString().slice(0, 10);
    return { date: value, day: Number(value.slice(8)), label: ['一', '二', '三', '四', '五', '六', '日'][index], selected: value === date };
  });
}
module.exports = { KEY, today, load, id, validDate, weekday, days, unit, dose, cardStatus, complete, guidedComplete, progress, status,
  due, snapshot, session, saveCard, saveSchemeActions, savePlan, saveValues, saveSet, saveGuidedSet, importAttachmentPlan, scheduleLabel, week };
