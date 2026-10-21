// Documents are source material. Only explicit training text can suggest requirements.
const KEY = 'xiaoshu.training.documents.v1';
const copy = value => JSON.parse(JSON.stringify(value));
const makeId = () => 'document-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
const types = ['medical', 'training'];
const statuses = ['pending', 'recognized', 'failed'];

function load() {
  const saved = wx.getStorageSync(KEY);
  return Array.isArray(saved) ? copy(saved) : [];
}

function save(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw Error('请提供有效的资料。');
  const documents = load();
  const previous = documents.find(item => item.id === values.id);
  const next = Object.assign({}, previous || {
    id: makeId(), path: '', text: '', status: 'pending', createdAt: new Date().toISOString(), error: ''
  }, copy(values));
  if (!types.includes(next.type)) throw Error('请选择病例单或训练方案单。');
  if (!statuses.includes(next.status)) throw Error('资料识别状态无效。');
  next.id = previous ? previous.id : String(next.id || makeId());
  ['path', 'text', 'error', 'createdAt'].forEach(key => { next[key] = String(next[key] || ''); });
  if (next.recordingBatchId !== undefined) next.recordingBatchId = String(next.recordingBatchId || '');
  if (previous) documents[documents.indexOf(previous)] = next;
  else documents.push(next);
  // Never mutate the object returned by getStorageSync, including when this write fails.
  wx.setStorageSync(KEY, copy(documents));
  return copy(next);
}

function remove(id) {
  const documents = load().filter(item => item.id !== id);
  wx.setStorageSync(KEY, copy(documents));
  return copy(documents);
}

function list(type) { return load().filter(item => !type || item.type === type); }

const numeral = '[0-9一二三四五六七八九十百两]+';
const range = '(?:\\s*(?:[~～\\-–—]|至|到|或)\\s*' + numeral + ')?';
function number(value) {
  if (/^\d+$/.test(value)) return Number(value) > 0 ? String(Number(value)) : '';
  const digits = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (digits[value]) return String(digits[value]);
  if (value === '十') return '10';
  if (/^[一二三四五六七八九]?十[一二三四五六七八九]?$/.test(value)) {
    const parts = value.split('十');
    return String((parts[0] ? digits[parts[0]] : 1) * 10 + (parts[1] ? digits[parts[1]] : 0));
  }
  return '';
}
function unique(values) { return values.filter((value, index) => values.indexOf(value) === index); }
// Windows OCR inserts spaces between Chinese characters. Normalize only analysis text;
// keep the source lines unchanged, and never join separate digits into a new quantity.
function analysisText(value) { return value.replace(/([\u3400-\u9fff])[ \t\u3000]+(?=[\u3400-\u9fff])/g, '$1'); }
function matchAll(text, pattern) {
  const matches = []; let match;
  while ((match = pattern.exec(text))) matches.push(match);
  return matches;
}
function amountUnit(value) {
  if (/秒/.test(value)) return 'timer';
  if (/呼吸/.test(value)) return 'breath';
  return 'count';
}
function readNumber(value, warning, warnings) {
  const result = number(value.replace(/\s/g, ''));
  if (!result && warnings.indexOf(warning) < 0) warnings.push(warning);
  return result;
}
function readDose(text, action) {
  const setMatches = matchAll(text, new RegExp('(' + numeral + range + ')\\s*组', 'g'));
  const setValues = setMatches.map(match => readNumber(match[1], '组数含范围、备选值或无法确认的数字，请核对原文。', action.warnings));
  if (setValues.length && setValues.every(Boolean) && unique(setValues).length === 1) action.sets = setValues[0];
  if (setValues.some(value => !value)) action.conflicts.sets = true;
  if (unique(setValues.filter(Boolean)).length > 1) {
    action.conflicts.sets = true;
    action.warnings.push('原文出现不同组数，已留空，请核对。');
  }

  // Amount must explicitly say per set, use a multiplication sign, or carry /组.
  const perSet = '(?:每组\\s*[:：]?\\s*|组\\s*[×xX*]\\s*)(' + numeral + range + ')\\s*(次呼吸|个呼吸|呼吸|秒(?:钟)?|次)';
  const suffix = '(' + numeral + range + ')\\s*(次呼吸|个呼吸|呼吸|秒(?:钟)?|次)\\s*[/／]\\s*组';
  const breathFirst = '每组\\s*[:：]?\\s*呼吸\\s*(' + numeral + range + ')\\s*(次)';
  const amountMatches = matchAll(text, new RegExp(perSet, 'g')).concat(matchAll(text, new RegExp(suffix, 'g')));
  const breathMatches = matchAll(text, new RegExp(breathFirst, 'g'));
  const doses = amountMatches.map(match => ({
    value: readNumber(match[1], '每组完成量含范围、备选值或无法确认的数字，请核对原文。', action.warnings), mode: amountUnit(match[2])
  })).concat(breathMatches.map(match => ({
    value: readNumber(match[1], '每组呼吸次数无法唯一确认，请核对原文。', action.warnings), mode: 'breath'
  })));
  const distinct = unique(doses.filter(item => item.value).map(item => item.value + ':' + item.mode));
  const alternatives = /每组[^\n；;。]*(?:次呼吸|个呼吸|呼吸|秒(?:钟)?|次)\s*(?:或|至|到|[~～\-–—/／])\s*[0-9一二三四五六七八九十百两]/.test(text);
  if (doses.length && doses.every(item => item.value) && distinct.length === 1 && !alternatives) {
    action.amount = doses[0].value; action.mode = doses[0].mode;
  }
  if (doses.some(item => !item.value) || distinct.length > 1 || alternatives) {
    // Amount and its unit travel together. Do not let a later document fill only
    // one half of a dose which this source could not state unambiguously.
    action.conflicts.amount = true; action.conflicts.mode = true;
  }
  if (distinct.length > 1 || alternatives) action.warnings.push('原文出现不同每组完成量或单位，已留空，请核对。');
  if (!doses.length && /[0-9一二三四五六七八九十百两]+\s*(?:次呼吸|个呼吸|呼吸|秒(?:钟)?|次)/.test(text)) {
    action.warnings.push('未明确每组完成量，已留空，请核对原文。');
  }
}

function readFrequency(text, action) {
  const patterns = [
    new RegExp('每(?:周|星期|礼拜)\\s*' + numeral + '\\s*次', 'g'),
    /每(?:周|星期|礼拜)[一二三四五六日天](?:[一二三四五六日天、，,\s]*[一二三四五六日天])?/g,
    new RegExp('每\\s*' + numeral + '\\s*天\\s*' + numeral + '\\s*次', 'g'),
    new RegExp(numeral + '\\s*天内\\s*' + numeral + '\\s*次', 'g'),
    new RegExp('(?:每天|每日|一天)(?:\\s*' + numeral + '\\s*次)?', 'g'),
    /(?:隔天|隔日|每隔一天)/g
  ];
  const matches = [];
  patterns.forEach(pattern => matchAll(text, pattern).forEach(match => {
    const end = match.index + match[0].length;
    if (!matches.some(item => match.index >= item.start && end <= item.end)) matches.push({ start: match.index, end, value: match[0].trim() });
  }));
  const frequencies = unique(matches.map(item => item.value));
  if (frequencies.length === 1) action.frequency = frequencies[0];
  if (frequencies.length > 1) {
    action.conflicts.frequency = true;
    action.warnings.push('原文出现多个频次要求，已留空，请核对。');
  }
}

function heading(line) {
  return /^(?:训练方案(?:单)?|康复训练(?:方案)?|动作清单|训练要求|训练频次|注意事项|个人资料|姓名|诊断|病史|病历|病例)(?:\s*[:：].*)?$/.test(line);
}
function cleanName(line) {
  line = line.replace(/^(?:\d+|[一二三四五六七八九十]+)\s*[.、·•)）:：]\s*/, '');
  let value = line.replace(/^(?:(?:\d+|[一二三四五六七八九十]+)[.、·)）:：]\s*|[（(](?:\d+|[一二三四五六七八九十]+)[)）]\s*|[-•·]\s*)/, '').trim();
  value = value.replace(/^(?:动作名称|动作)\s*[:：]\s*/, '');
  const boundary = /(?:\s|[，,；;：:])*(?:(?:[0-9一二三四五六七八九十百两]+(?:\s*(?:[~～\-–—]|至|到|或)\s*[0-9一二三四五六七八九十百两]+)?\s*组)|每组|每次|每天|每日|每周|每星期|每礼拜|每\s*[0-9一二三四五六七八九十百两]+\s*天|隔天|隔日|每隔|要点\s*[:：]|方向\s*[:：]|注意\s*[:：])/;
  const found = boundary.exec(value);
  if (found) value = value.slice(0, found.index);
  return value.split(/[，,；;。\n]/)[0].trim().replace(/[\s:：、-]+$/, '');
}
function isContinuation(line) {
  return /^(?:每组|每次|组数|次数|时长|频次|训练量|方向|个人要点|动作要点|要点|注意|保持|缓慢|向左|向右|左侧|右侧|双侧|每天|每日|每周|隔天|隔日|每隔|\d+\s*组)/.test(line);
}

function extract(text, type) {
  const source = String(text || '');
  const result = { actions: [], context: '', unparsed: [] };
  if (!source.trim()) return result;
  if (type === 'medical') { result.context = source.slice(0, 500); return result; }
  if (type !== 'training') { result.unparsed.push(source); return result; }
  const lines = source.split(/\r?\n/).filter(line => line.trim());
  const groups = []; let groupName = '';
  lines.forEach(sourceLine => {
    const line = analysisText(sourceLine).trim();
    const section = /^(?:[一二三四五六七八九十]+[、.．]\s*)([^：:]+(?:学习|矫正|矫正动作|练习|训练|整理放松))(?:\s*[（(][^）)]*[）)])?\s*$/.exec(line);
    if (section) { groupName = section[1].trim(); result.unparsed.push(sourceLine); return; }
    if (heading(line)) { result.unparsed.push(sourceLine); return; }
    const numbered = /^(?:(?:\d+|[一二三四五六七八九十]+)[.、·)）:：]|[（(](?:\d+|[一二三四五六七八九十]+)[)）]|[-•·])/.test(line);
    if (!numbered && isContinuation(line)) {
      if (groups.length) groups[groups.length - 1].push(sourceLine);
      else result.unparsed.push(sourceLine);
      return;
    }
    const name = cleanName(line);
    // A numbered item alone can be an instruction. Require an action-like name or explicit name label.
    const actionLike = /(?:练习|训练|呼吸|站姿|坐姿|卧姿|拉伸|支撑|伸展|抬腿|侧桥|平板|矫正|步行|行走|深蹲|站立|坐位|卧位|旋转|弯曲|屈伸|跪姿|爬行|放松|夹球|靠墙|猫式|桥式|蚌式|死虫|鸟狗)/.test(name);
    const namedRequirement = numbered && /(?:[0-9一二三四五六七八九十百两]+\s*组|每组)/.test(line);
    if (!name || name.length > 60 || (!actionLike && !namedRequirement && !/^动作(?:名称)?\s*[:：]/.test(line))) {
      result.unparsed.push(sourceLine); return;
    }
    const group = [sourceLine]; group.groupName = groupName; groups.push(group);
  });
  groups.forEach((group, index) => {
    const sourceText = group.join('\n');
    const normalized = analysisText(sourceText);
    const name = cleanName(analysisText(group[0]).trim());
    const action = { id: 'text-action-' + (index + 1), name, groupName: group.groupName || '', sets: '', amount: '', mode: '', notes: '', frequency: '', sourceText, warnings: [],
      conflicts: { sets: false, amount: false, mode: false, frequency: false } };
    readDose(normalized, action); readFrequency(normalized, action);
    const note = /(?:个人要点|动作要点|要点|方向|注意事项|注意)\s*[:：]\s*([^\n]+)/g;
    const explicitNotes = matchAll(normalized, note).map(match => match[1].trim());
    const directionNotes = normalized.split(/[\n，,；;。]/).map(item => item.trim()).filter(item =>
      /(?:向左|向右|左侧|右侧|双侧|左右|左腿|右腿|左手|右手|骨盆|肩膀|肩部|胸廓|保持|缓慢|呼气|吸气)/.test(item)
      && item.indexOf(name) < 0 && !/^(?:个人要点|动作要点|要点|方向|注意事项|注意)\s*[:：]/.test(item));
    action.notes = unique(explicitNotes.concat(directionNotes)).join('；');
    result.actions.push(action);
  });
  return result;
}

module.exports = { KEY, load, save, remove, list, extract };
