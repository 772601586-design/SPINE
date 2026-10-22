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
  if (/秒|分钟|分$/.test(value)) return 'timer';
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
  const units = '(次呼吸|个呼吸|呼吸|分钟|分\\s*钟|秒(?:钟)?|次|个)';
  const perSet = '(?:每组\\s*[:：]?\\s*|组\\s*[×xX*]\\s*)(' + numeral + range + ')\\s*' + units;
  const suffix = '(' + numeral + range + ')\\s*' + units + '\\s*[/／]\\s*组';
  const breathFirst = '每组\\s*[:：]?\\s*呼吸\\s*(' + numeral + range + ')\\s*(次)';
  const amountMatches = matchAll(text, new RegExp(perSet, 'g')).concat(matchAll(text, new RegExp(suffix, 'g')));
  const breathMatches = matchAll(text, new RegExp(breathFirst, 'g'));
  let doses = amountMatches.map(match => ({
    value: readNumber(match[1], '每组完成量含范围、备选值或无法确认的数字，请核对原文。', action.warnings), mode: amountUnit(match[2]), minutes: /分/.test(match[2])
  })).concat(breathMatches.map(match => ({
    value: readNumber(match[1], '每组呼吸次数无法唯一确认，请核对原文。', action.warnings), mode: 'breath'
  })));
  // A quantity next to explicit sets is a per-set dose, with or without ×.
  // Strip cadence first so “每天2次” cannot become a repetition count.
  const doseText = text.replace(/(?:每天|每日|一天)\s*[0-9一二三四五六七八九十百两]+\s*次/g, '')
    .replace(/每(?:周|星期|礼拜)\s*[0-9一二三四五六七八九十百两]+\s*次/g, '')
    .replace(/每\s*[0-9一二三四五六七八九十百两]+\s*天\s*[0-9一二三四五六七八九十百两]+\s*次/g, '');
  if (!doses.length && action.sets) doses = matchAll(doseText, new RegExp('(' + numeral + range + ')\\s*' + units, 'g')).map(match => ({
    value: readNumber(match[1], '每组完成量含范围、备选值或无法确认的数字，请核对原文。', action.warnings), mode: amountUnit(match[2]), minutes: /分/.test(match[2])
  }));
  // An explicitly stated single duration is complete without inventing a set count.
  if (!doses.length && !setMatches.length) {
    const totalDurations = matchAll(doseText, new RegExp('(' + numeral + range + ')\\s*(分钟|分\\s*钟|秒(?:钟)?)', 'g'));
    if (totalDurations.length === 1 && !/(?:整套|整组|全套|合计|共计|约)/.test(doseText)) {
      const duration = totalDurations[0];
      doses = [{ value: readNumber(duration[1], '时长含范围、备选值或无法确认的数字，请核对原文。', action.warnings), mode: 'timer', minutes: /分/.test(duration[2]) }];
      if (doses[0].value) { action.sets = '1'; action.totalOnly = true; }
    }
  }
  doses.forEach(item => { if (item.value && item.minutes) item.value = String(Number(item.value) * 60); });
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
  const stated = matchAll(doseText, new RegExp('(?:' + numeral + range + ')\\s*(?:组|次呼吸|个呼吸|呼吸|分钟|分\\s*钟|秒(?:钟)?|次|个)', 'g'));
  action.sourceDoseText = stated.map(match => match[0]).join(' × ');
}

function readFrequency(text, action) {
  const patterns = [
    /(?:训练日期|安排日期|指定日期)\s*[:：]?\s*\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}日?/g,
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
  return /^(?:训练方案(?:单)?|康复训练(?:方案)?|动作清单|训练要求|训练频次|注意事项|个人资料|姓名|性别|年龄|出生日期|出生年月|日期|就诊日期|诊断(?:分型)?|阶段目标|病史|病历|病例|运动处方(?:[（(]\d+[）)])?)(?:\s*[:：].*)?$/.test(line)
    || /^(?:\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}|https?:\/\/|博客|微信公众号|联系电话|电话|地址)/.test(line);
}
function cleanName(line) {
  line = line.replace(/^(?:\d+|[一二三四五六七八九十]+)\s*(?:[.、·•)）:：]|\s+(?=[\u3400-\u9fffA-Z]))\s*/, '');
  let value = line.replace(/^(?:(?:\d+|[一二三四五六七八九十]+)[.、·)）:：]\s*|[（(](?:\d+|[一二三四五六七八九十]+)[)）]\s*|[-•·]\s*)/, '').trim();
  value = value.replace(/^(?:动作名称|动作)\s*[:：]\s*/, '');
  const boundary = /(?:\s|[，,；;：:])*(?:各?\s*[0-9一二三四五六七八九十百两]+(?:\s*(?:[~～\-–—]|至|到|或)\s*[0-9一二三四五六七八九十百两]+)?\s*(?:组|次呼吸|个呼吸|呼吸|分钟|分\s*钟|秒(?:钟)?|次|个|张)|每组|每次|每天|每日|每周|每星期|每礼拜|每\s*[0-9一二三四五六七八九十百两]+\s*天|隔天|隔日|每隔|要点\s*[:：]|方向\s*[:：]|注意\s*[:：])/;
  const found = boundary.exec(value);
  if (found) value = value.slice(0, found.index);
  if (!/^(?:坐|站|坐姿|站姿)[:：]/.test(value)) value = value.split(/[:：]/)[0];
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
  const lines = source.replace(/([^\n])([一二三四五六七八九十]+[、．]\s*[^\n：:]{1,30}(?:学习|矫正|练习|训练|动作|放松)\s*[:：])/g, '$1\n$2').split(/\r?\n/).filter(line => line.trim());
  const groups = []; let groupName = '', groupFrequency = '', globalFrequency = '', ignoreAdvice = false;
  lines.forEach(sourceLine => {
    const line = analysisText(sourceLine).trim();
    if (/^(?:[一二三四五六七八九十]+[、.．]\s*)?(?:注意事项|温馨提示|个人资料|病史|病历|病例)/.test(line)) { ignoreAdvice = true; result.unparsed.push(sourceLine); return; }
    const section = /^(?:[一二三四五六七八九十]+[、.．]\s*)([^：:（(]+?)(\s*[:：（(].*|\s*)$/.exec(line);
    if (section && /(?:学习|矫正|动作|练习|训练|放松)$/.test(section[1].trim())) {
      groupName = section[1].trim(); ignoreAdvice = false; groupFrequency = '';
      const context = { frequency: '', conflicts: {}, warnings: [] }; readFrequency(section[2], context); groupFrequency = context.conflicts.frequency ? null : context.frequency;
      result.unparsed.push(sourceLine);
      // A section may contain an explicit action after its colon.
      const inline = section[2].replace(/^\s*[:：]\s*/, '');
      const namedInline = /^(每天|每日)\s*(绘制[^。]+)/.exec(inline);
      if (namedInline) {
        const group = [namedInline[2]]; group.groupName = groupName; group.frequency = groupFrequency === null ? '' : groupFrequency || namedInline[1]; groups.push(group);
      }
      return;
    }
    if (ignoreAdvice || heading(line)) {
      if (!ignoreAdvice && /^(?:训练频次|训练要求)\s*[:：]/.test(line)) {
        const context = { frequency: '', conflicts: {}, warnings: [] }; readFrequency(line, context); globalFrequency = context.frequency;
      }
      result.unparsed.push(sourceLine); return;
    }
    // Global/group cadence is inherited only from an explicit instruction outside an action.
    if (/^(?:本组|该组|本阶段|所有动作|全部动作|训练频次)[:：\s]*(?:每天|每日|每周|隔天|隔日|每隔)/.test(line)
        || (!groups.length && /^(?:每天|每日|每周|隔天|隔日|每隔)/.test(line))) {
      const context = { frequency: '', conflicts: {}, warnings: [] }; readFrequency(line, context);
      if (groupName) { groupFrequency = context.conflicts.frequency ? null : context.frequency; groups.filter(group => group.groupName === groupName).forEach(group => { group.frequency = groupFrequency || ''; }); }
      else globalFrequency = context.frequency;
      result.unparsed.push(sourceLine); return;
    }
    const numbered = /^(?:(?:\d+|[一二三四五六七八九十]+)(?:[.、·)）:：]|\s+(?=[\u3400-\u9fffA-Z]))|[（(](?:\d+|[一二三四五六七八九十]+)[)）]|[-•·])/.test(line);
    if (!numbered && groups.length && groups[groups.length - 1].neckList && groups[groups.length - 1].groupName === groupName) {
      groups[groups.length - 1].push(sourceLine); return;
    }
    if (/颈椎矫正动作/.test(groupName) && /头顶画圆圈|鼻尖写|下巴画半圆|沉肩拉耳|抬头望月|双手压额|后仰拉伸/.test(line)) {
      const group = [sourceLine]; group.groupName = groupName; group.frequency = groupFrequency === null ? '' : groupFrequency || globalFrequency; group.neckList = true; groups.push(group); return;
    }
    if (!numbered && isContinuation(line)) {
      if (groups.length) groups[groups.length - 1].push(sourceLine);
      else result.unparsed.push(sourceLine);
      return;
    }
    const name = cleanName(line);
    if (/^(?:避免|不要|禁止|不得|建议|请|注意|定期|对照|核对|确认|观察|训练前|训练后)/.test(name)) { result.unparsed.push(sourceLine); return; }
    // A numbered item alone can be an instruction. Require an action-like name or explicit name label.
    const actionLike = /(?:练习|训练|呼吸|站姿|坐姿|卧姿|拉伸|支撑|伸展|抬腿|侧桥|平板|矫正|步行|行走|深蹲|站立|坐位|卧位|旋转|弯曲|屈伸|跪姿|爬行|放松|夹球|靠墙|猫式|桥式|蚌式|死虫|鸟狗|猫[-—－]+骆驼|强化运动|肌肉圆柱|卷腹|臀桥|前伸|悬吊|绘制脊柱曲线图|双手臂撑|Y[-—－]W[-—－]T)/.test(name);
    const namedRequirement = numbered && /(?:[0-9一二三四五六七八九十百两]+\s*组|每组|[0-9一二三四五六七八九十百两]+\s*(?:分钟|秒钟))/.test(line);
    const explicitlyNamed = /^(?:(?:\d+|[一二三四五六七八九十]+)[.、·)）:：]\s*)?动作(?:名称)?\s*[:：]/.test(line);
    if (!name || name.length > 60 || (!actionLike && !namedRequirement && !explicitlyNamed)) {
      if (groups.length && groups[groups.length - 1].groupName === groupName && !numbered && !/[？?]$/.test(line)) {
        groups[groups.length - 1].push(sourceLine); return;
      }
      result.unparsed.push(sourceLine); return;
    }
    const group = [sourceLine]; group.groupName = groupName; group.frequency = groupFrequency === null ? '' : groupFrequency || globalFrequency; groups.push(group);
  });
  groups.forEach((group, index) => {
    const sourceText = group.join('\n');
    const normalized = analysisText(sourceText);
    const name = cleanName(analysisText(group[0]).trim());
    const action = { id: 'text-action-' + (index + 1), name, groupName: group.groupName || '', sets: '', amount: '', mode: '', notes: '', frequency: '', sourceText, warnings: [],
      conflicts: { sets: false, amount: false, mode: false, frequency: false } };
    readDose(normalized, action); readFrequency(normalized, action);
    if (!action.frequency && !action.conflicts.frequency) action.frequency = group.frequency || '';
    const note = /(?:个人要点|动作要点|要点|方向|注意事项|注意)\s*[:：]\s*([^\n]+)/g;
    const explicitNotes = matchAll(normalized, note).map(match => match[1].trim());
    const directionNotes = normalized.split(/[\n，,；;。]/).map(item => item.trim()).filter(item =>
      /(?:向左|向右|左侧|右侧|双侧|左右|左腿|右腿|左手|右手|骨盆|肩膀|肩部|胸廓|保持|缓慢|呼气|吸气)/.test(item)
      && item.indexOf(name) < 0 && !/^(?:个人要点|动作要点|要点|方向|注意事项|注意)\s*[:：]/.test(item));
    const first = analysisText(group[0]).trim();
    const narrative = first.slice(first.indexOf(name) + name.length).replace(/^[:：，,；;\s]+/, '');
    const body = /[，,；;。]|(?:左臀|右臀|骨盆|肩部|躯干|下巴)/.test(narrative) ? [narrative].concat(group.slice(1).map(analysisText)).join('') : '';
    action.notes = unique(explicitNotes.concat(directionNotes).concat(body ? [body] : [])).join('；');
    if (group.neckList) {
      const full = normalized.replace(/\s/g, '');
      const names = ['头顶画圆圈', '鼻尖写“8”', '下巴画半圆', '沉肩拉耳', '抬头望月', '双手压额', '后仰拉伸'].filter(value => full.includes(value));
      names.forEach((value, offset) => result.actions.push(Object.assign({}, action, { id: action.id + '-' + offset, name: value,
        sets: '', amount: '', mode: '', totalOnly: false, notes: '原文整套动作约5分钟，单项训练量未注明。', sourceDoseText: '整套约5分钟，单项待补充' })));
    } else if (/^Y[-—－]W[-—－]T$/i.test(name) && /各/.test(normalized)) {
      ['Y', 'W', 'T'].forEach((value, offset) => result.actions.push(Object.assign({}, action, { id: action.id + '-' + offset, name: 'Y-W-T：' + value })));
    } else if (name === '跪位、坐位前伸' && /各/.test(normalized)) {
      ['跪位前伸', '坐位前伸'].forEach((value, offset) => result.actions.push(Object.assign({}, action, { id: action.id + '-' + offset, name: value })));
    } else result.actions.push(action);
  });
  return result;
}

module.exports = { KEY, load, save, remove, list, extract };
