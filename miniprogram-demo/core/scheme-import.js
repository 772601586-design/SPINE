// Imported documents are source material. Only an explicit dose and an executable
// frequency may create a live plan; missing requirements remain visible as drafts.
const t = require('./training');
const documents = require('./documents');
const clone = value => JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const normalizedName = value => String(value || '').replace(/\s/g, '').replace(/：/g, ':').replace(/（/g, '(').replace(/）/g, ')')
  .replace(/[，、]/g, ',').replace(/[—－–]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").toLowerCase();
function hash(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) { result ^= value.charCodeAt(index); result = Math.imul(result, 16777619); }
  return (result >>> 0).toString(36);
}
function stateForImport() {
  const value = wx.getStorageSync(t.KEY);
  return value && value.version === 2 && Array.isArray(value.cards) && Array.isArray(value.plans) && Array.isArray(value.sessions)
    ? clone(value) : { version: 2, cards: [], plans: [], sessions: [] };
}
function parseSchedule(frequency, date) {
  const text = String(frequency || '').replace(/\s/g, '').replace(/[。；;]$/, '');
  const start = t.validDate(date) ? date : t.today();
  const pending = reason => ({ executable: false, label: '待安排', reason, frequency: text });
  if (!text) return pending('文件未注明训练频次');
  if (/^(?:每天|每日|一天)(?:1|一)?次?$/.test(text)) return { executable: true, schedule: 'daily', start, label: '每天', key: 'daily' };
  if (/^(?:隔天|隔日|每隔一天)$/.test(text)) return { executable: true, schedule: 'alternate', calendarInterval: true, start, label: '隔天', key: 'alternate' };
  const weekdays = /^每(?:周|星期|礼拜)([一二三四五六日天、，,]+)$/.exec(text);
  if (weekdays) {
    const tokens = weekdays[1].replace(/[、，,]/g, '').split('');
    const days = Array.from(new Set(tokens.map(value => '一二三四五六日'.indexOf(value === '天' ? '日' : value)))).sort();
    if (days.length && days.every(value => value >= 0)) return { executable: true, schedule: 'weekdays', weekdays: days, start,
      label: '每周' + days.map(day => ['一', '二', '三', '四', '五', '六', '日'][day]).join('、'), key: 'weekdays-' + days.join('-') };
  }
  const explicitDate = /^(?:(?:训练日期|安排日期|指定日期)[:：]?)?(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/.exec(text);
  if (explicitDate) {
    const onlyDate = explicitDate[1] + '-' + ('0' + explicitDate[2]).slice(-2) + '-' + ('0' + explicitDate[3]).slice(-2);
    if (t.validDate(onlyDate)) return { executable: true, schedule: 'daily', start: onlyDate, onlyDate, label: onlyDate, key: 'date-' + onlyDate };
  }
  if (/^(?:每天|每日|一天)/.test(text)) return pending('文件要求一天多次，需补充各次训练安排');
  if (/^每(?:周|星期|礼拜)|^每\d+天|天内/.test(text)) return pending('文件未注明具体训练日');
  return pending('请补充可执行的训练日期或频次');
}
function doseReady(card) {
  return Number.isInteger(card.sets) && card.sets >= 1 && card.sets <= 50 && Number.isInteger(card.amount)
    && card.amount >= 1 && card.amount <= 3600 && ['timer', 'count', 'breath'].includes(card.mode);
}
const editable = ['name', 'groupName', 'sets', 'amount', 'mode', 'notes', 'totalOnly', 'frequencyText', 'confirmed'];
function sourceFields(action) {
  const card = { name: String(action.name || '').trim().slice(0, 160), groupName: String(action.groupName || '').trim().slice(0, 80),
    sets: Number(action.sets) || 0, amount: Number(action.amount) || 0, mode: String(action.mode || ''), notes: String(action.notes || '').slice(0, 4000),
    totalOnly: !!action.totalOnly, frequencyText: String(action.frequency || action.frequencyText || '').trim() };
  const conflicts = action.conflicts || {};
  ['sets', 'amount', 'mode'].forEach(field => { if (conflicts[field]) card[field] = field === 'mode' ? '' : 0; });
  if (conflicts.frequency) card.frequencyText = '';
  card.confirmed = doseReady(card); return card;
}
function importedCard(state, doc, action, rowKey) {
  const previous = state.cards.find(card => card.sourceSchemeDocument === doc.id && card.sourceSchemeRow === rowKey)
    || state.cards.find(card => !card.autoImported && (card.sourceSchemeDocument === doc.id
      || (String(card.sourceCandidateId || '').indexOf(doc.id + ':') === 0 && (card.sourceDocumentIds || []).includes(doc.id))) && normalizedName(card.name) === normalizedName(action.name)
      && normalizedName(card.groupName) === normalizedName(action.groupName));
  const baseline = sourceFields(action), fields = Object.assign({}, baseline);
  if (previous) {
    editable.forEach(field => {
      if (field === 'notes' && previous.borrowedVideoNotes && previous.notes === previous.borrowedVideoNotes) return;
      if (!previous.autoImportSnapshot || !same(previous[field], previous.autoImportSnapshot[field])) {
        if (previous[field] !== undefined) fields[field] = previous[field];
      }
    });
  }
  if (!fields.notes && previous && previous.borrowedVideoNotes && previous.notes === previous.borrowedVideoNotes) fields.notes = previous.borrowedVideoNotes;
  // Filling a previously incomplete card cannot leave it runnable with an invalid dose.
  fields.confirmed = !!fields.confirmed && doseReady(fields);
  const card = Object.assign({}, previous || {}, fields, {
    id: previous ? previous.id : 'scheme-card-' + hash(doc.id) + '-' + hash(rowKey),
    source: '康复师方案单 · ' + (doc.originalName || '已上传文件'), sourceDocumentIds: Array.from(new Set((previous && previous.sourceDocumentIds || []).concat(doc.id))),
    sourceSchemeDocument: doc.id, sourceSchemeRow: rowKey, sourceText: String(action.sourceText || ''),
    sourceDoseText: String(action.sourceDoseText || ''), warnings: clone(action.warnings || []),
    autoImported: true, autoImportSnapshot: baseline,
    recordingBatchId: previous && previous.recordingBatchId || doc.recordingBatchId || '',
    video: previous && previous.video || '', staleSource: false
  });
  const schedule = parseSchedule(card.frequencyText, action.startDate || doc.trainingStartDate);
  card.scheduleStatus = card.confirmed && schedule.executable ? 'scheduled' : 'pending';
  card.scheduleLabel = card.scheduleStatus === 'scheduled' ? schedule.label : '待安排';
  card.scheduleReason = !card.confirmed ? '训练量待补充，暂未安排训练' : schedule.reason || '';
  if (!previous) card.revision = 1;
  else { card.revision = previous.revision; if (!same(card, previous)) card.revision = (previous.revision || 0) + 1; }
  if (previous) state.cards[state.cards.indexOf(previous)] = card; else state.cards.push(card);
  return { card, schedule };
}
function reconcileStateVideos(state) {
  let linkedCount = 0;
  const targets = state.cards.filter(card => card.autoImported && !card.staleSource);
  const recordings = state.cards.filter(card => card.video && !card.sourceSchemeDocument && !card.sourceCandidateId);
  targets.forEach(card => {
    if (card.video || card.videoAssociationManual) return;
    const matchingTargets = targets.filter(item => normalizedName(item.name) === normalizedName(card.name));
    const candidates = recordings.filter(item => normalizedName(item.name) === normalizedName(card.name) && (!item.linkedToActionId || item.linkedToActionId === card.id));
    if (matchingTargets.length !== 1 || candidates.length !== 1) return;
    const recording = candidates[0];
    card.video = recording.video; card.sourceVideoCardId = recording.id;
    if (!card.notes && recording.notes) { card.notes = recording.notes; card.borrowedVideoNotes = recording.notes; }
    if (!card.recordingBatchId) card.recordingBatchId = recording.recordingBatchId || '';
    ['regions', 'muscles'].forEach(field => { if (!card[field] && recording[field]) card[field] = clone(recording[field]); });
    card.revision = (card.revision || 0) + 1; recording.linkedToActionId = card.id; linkedCount++;
  });
  return linkedCount;
}
function synchronizePlans(state, doc, imported) {
  const buckets = {};
  imported.forEach(({ card, schedule }) => {
    if (!card.confirmed || !schedule.executable) return;
    const key = schedule.key + '-' + schedule.start;
    if (!buckets[key]) buckets[key] = { schedule, cards: [] };
    buckets[key].cards.push(card);
  });
  const plans = [];
  Object.keys(buckets).forEach(key => {
    const bucket = buckets[key], schedule = bucket.schedule;
    const planId = 'scheme-plan-' + hash(doc.id) + '-' + hash(key);
    const previous = state.plans.find(plan => plan.id === planId);
    const fields = { name: (doc.originalName || '康复师训练方案').replace(/\.[a-z0-9]+$/i, '') + ' · ' + schedule.label,
      cardIds: bucket.cards.map(card => card.id), schedule: schedule.schedule, weekdays: schedule.weekdays || [],
      start: schedule.start, onlyDate: schedule.onlyDate || '', calendarInterval: !!schedule.calendarInterval,
      cycleDays: 7, cycleTimes: 3, active: true };
    const baseline = clone(fields);
    if (previous && previous.autoImportSnapshot) Object.keys(fields).forEach(field => {
      if (!same(previous[field], previous.autoImportSnapshot[field])) fields[field] = previous[field];
    });
    const plan = Object.assign({}, previous || {}, fields, { id: planId, sourceSchemeDocument: doc.id,
      autoGenerated: true, autoImportSnapshot: baseline, allowReviewRows: false });
    if (!previous) plan.revision = 1;
    else { plan.revision = previous.revision; if (!same(plan, previous)) plan.revision = (previous.revision || 0) + 1; }
    if (previous) state.plans[state.plans.indexOf(previous)] = plan; else state.plans.push(plan);
    plans.push(plan);
  });
  // Obsolete generated plans stop making future sessions. Their snapshots stay intact.
  state.plans.filter(plan => plan.autoGenerated && plan.sourceSchemeDocument === doc.id && !plans.some(item => item.id === plan.id)).forEach(plan => {
    if (plan.active) { plan.active = false; plan.revision = (plan.revision || 0) + 1; }
  });
  return plans;
}
function importDocument(document, parsed) {
  if (!document || !document.id || document.type !== 'training') throw Error('请选择训练方案文件。');
  const doc = clone(document), analysis = Array.isArray(parsed) ? { actions: parsed } : typeof parsed === 'string' ? documents.extract(parsed, 'training')
    : parsed || documents.extract(doc.text, doc.type);
  if (!analysis || !Array.isArray(analysis.actions)) throw Error('方案动作识别结果无效。');
  if (analysis.actions.length > 100) throw Error('一份方案最多导入100项动作，请分批整理。');
  const state = stateForImport(), before = JSON.stringify(state), seen = {};
  const previousImport = state.schemeImports && state.schemeImports[doc.id];
  if (!t.validDate(doc.trainingStartDate)) doc.trainingStartDate = previousImport && previousImport.startDate || t.today();
  const imported = analysis.actions.filter(action => action && String(action.name || '').trim()).map(action => {
    const base = normalizedName(action.groupName) + '\n' + normalizedName(action.name);
    seen[base] = (seen[base] || 0) + 1;
    return importedCard(state, doc, action, base + '\n' + seen[base]);
  });
  const cards = imported.map(item => item.card);
  state.cards.filter(card => card.autoImported && card.sourceSchemeDocument === doc.id && !cards.some(item => item.id === card.id)).forEach(card => {
    card.staleSource = true; card.scheduleStatus = 'pending'; card.scheduleLabel = '待安排'; card.scheduleReason = '原件动作已更新，请核对旧条目';
  });
  const linkedCount = reconcileStateVideos(state), plans = synchronizePlans(state, doc, imported);
  state.schemeImports = state.schemeImports || {};
  const fingerprint = hash(JSON.stringify(analysis.actions)), previous = state.schemeImports[doc.id];
  state.schemeImports[doc.id] = { fingerprint, cardIds: cards.map(card => card.id), planIds: plans.map(plan => plan.id),
    startDate: doc.trainingStartDate, importedAt: previous && previous.fingerprint === fingerprint ? previous.importedAt : new Date().toISOString() };
  // Cards, schedules and the import marker commit together. No session row is edited.
  if (JSON.stringify(state) !== before) wx.setStorageSync(t.KEY, clone(state));
  return clone({ cards, plans, importedCount: cards.length, scheduledCount: cards.filter(card => card.scheduleStatus === 'scheduled').length,
    pendingCount: cards.filter(card => card.scheduleStatus !== 'scheduled').length, draftCount: cards.filter(card => !card.confirmed).length, linkedCount });
}
function refreshDocument(documentId) {
  const doc = documents.load().find(item => item.id === documentId);
  if (!doc) throw Error('方案文件不存在，请重新选择。');
  if (doc.duplicateOf) {
    const original = documents.load().find(item => item.id === doc.duplicateOf && !item.duplicateOf);
    if (!original) throw Error('原方案文件不存在，请重新整理这份文件。');
    return importDocument(original);
  }
  return importDocument(doc);
}
function reconcileVideos() {
  const state = stateForImport(), linkedCount = reconcileStateVideos(state);
  if (linkedCount) wx.setStorageSync(t.KEY, clone(state));
  return clone({ linkedCount, cards: state.cards });
}
function linkVideo(actionId, recordingId) {
  const state = stateForImport(), action = state.cards.find(card => card.id === actionId);
  if (!action) throw Error('动作卡不存在，请重新选择。');
  const recording = recordingId ? state.cards.find(card => card.id === recordingId && card.video && card.id !== actionId) : null;
  if (recordingId && !recording) throw Error('现场录段不存在，请重新选择。');
  if (recording && recording.linkedToActionId && recording.linkedToActionId !== actionId) throw Error('这个录段已对应其他动作，请选择另一个录段。');
  const before = JSON.stringify(state), oldId = action.sourceVideoCardId || action.videoCardId;
  const previous = state.cards.find(card => card.id === oldId);
  if (previous && previous.linkedToActionId === action.id) delete previous.linkedToActionId;
  action.video = recording ? recording.video : ''; action.sourceVideoCardId = recording ? recording.id : ''; action.videoAssociationManual = true;
  delete action.videoCardId;
  if (recording) recording.linkedToActionId = action.id;
  if (JSON.stringify(state) !== before) { action.revision = (action.revision || 0) + 1; wx.setStorageSync(t.KEY, clone(state)); }
  return clone(action);
}
module.exports = { importDocument, refreshDocument, parseSchedule, reconcileVideos, linkVideos: reconcileVideos, linkVideo };
