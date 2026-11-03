const t = require('./training');
const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
const pad = value => String(value).padStart(2, '0');
function validMonth(value) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(value || '') && Number(value.slice(0, 4)) > 0; }
function shiftMonth(month, delta) {
  if (!validMonth(month) || !Number.isInteger(delta)) return '';
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1 + delta;
  const year = Math.floor(index / 12);
  return year > 0 && year <= 9999 ? String(year).padStart(4, '0') + '-' + pad(index % 12 + 1) : '';
}
function recordsOn(state, date) { return (state.sessions || []).filter(record => record.date === date); }
function dayState(records) { return !records.length ? 'empty' : records.every(record => t.status(record) === 'completed') ? 'completed' : 'incomplete'; }
function monthView(state, month, today, selected) {
  if (!validMonth(month)) throw Error('请选择有效月份');
  const first = month + '-01', offset = t.weekday(first);
  const year = Number(month.slice(0, 4));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const count = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(month.slice(5)) - 1];
  const byDate = {};
  (state.sessions || []).forEach(record => {
    if (t.validDate(record.date) && record.date.slice(0, 7) === month) (byDate[record.date] || (byDate[record.date] = [])).push(record);
  });
  let completedDays = 0, incompleteDays = 0;
  const length = Math.ceil((offset + count) / 7) * 7;
  const cells = Array.from({ length }, (_, index) => {
    const day = index - offset + 1;
    if (day < 1 || day > count) return { key: 'blank-' + index, date: '', day: '', state: 'blank' };
    const date = month + '-' + pad(day), records = byDate[date] || [], status = dayState(records);
    if (status === 'completed') completedDays++;
    if (status === 'incomplete') incompleteDays++;
    const label = status === 'completed' ? '全部完成' : status === 'incomplete' ? '未全部完成' : '无训练记录';
    return { key: date, date, day, state: status, today: date === today, selected: date === selected,
      recordCount: records.length, label: date + '，' + label + (date === today ? '，今天' : '') };
  });
  return { month, title: Number(month.slice(0, 4)) + ' 年 ' + Number(month.slice(5)) + ' 月', cells, completedDays, incompleteDays };
}
function dayDetails(state, date) {
  if (!t.validDate(date)) throw Error('请选择有效日期');
  const records = recordsOn(state, date);
  let actionCount = 0, completedActions = 0;
  const sessions = records.map((record, index) => {
    const actions = record.rows.map((row, rowIndex) => {
      const done = t.complete(row), values = row.values || [], unit = t.unit(row.mode);
      actionCount++; if (done) completedActions++;
      return { key: record.id + ':' + rowIndex, name: row.name, groupName: row.groupName || '',
        dose: t.dose(row), done, feeling: row.feeling || '',
        sets: Array.from({ length: Math.max(row.sets || 0, values.length) }, (_, setIndex) => {
          const value = values[setIndex], recorded = typeof value === 'number' && Number.isFinite(value), extra = setIndex >= row.sets;
          return { number: setIndex + 1, label: extra ? '追加第 ' + (setIndex - row.sets + 1) + ' 组' : row.totalOnly ? '单次练习' : '第 ' + (setIndex + 1) + ' 组',
            actual: recorded ? String(value) + unit : '未记录', recorded, extra,
            expected: extra ? '额外记录' : '要求 ' + row.amount + unit,
            done: recorded && !extra && value >= row.amount };
        }) };
    });
    const status = t.status(record);
    return { id: record.id, name: record.planName || '训练记录 ' + (index + 1), status,
      statusText: status === 'completed' ? '全部完成' : status === 'partial' ? '部分完成' : status === 'unrecorded' ? '未记录' : '未完成', actions };
  });
  const status = dayState(records);
  return { date, title: Number(date.slice(0, 4)) + ' 年 ' + Number(date.slice(5, 7)) + ' 月 ' + Number(date.slice(8)) + ' 日',
    weekday: '星期' + weekdays[t.weekday(date)], state: status, statusText: status === 'completed' ? '全部完成' : status === 'incomplete' ? '未全部完成' : '无记录',
    sessions, recordCount: sessions.length, actionCount, completedActions };
}
module.exports = { weekdays, validMonth, shiftMonth, monthView, dayDetails };
