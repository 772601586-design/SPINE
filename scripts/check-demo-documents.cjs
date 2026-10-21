const assert = require('node:assert/strict');
const documents = require('../miniprogram-demo/core/documents');
const storage = {};
let rejectWrite = false;
global.wx = {
  getStorageSync: key => storage[key],
  setStorageSync(key, value) {
    if (rejectWrite) throw Error('Storage unavailable');
    storage[key] = value;
  }
};

assert.deepEqual(documents.load(), []);
const original = documents.save({ type: 'training', path: '/temporary/plan.jpg', recordingBatchId: 'visit-1' });
assert.equal(original.status, 'pending');
assert.ok(original.id && original.createdAt);
const updated = documents.save({ id: original.id, text: '坐姿呼吸练习', status: 'recognized' });
assert.equal(updated.path, original.path);
assert.equal(updated.recordingBatchId, 'visit-1');
assert.equal(documents.load().length, 1);
assert.equal(documents.list('training')[0].text, '坐姿呼吸练习');
const stateBeforeFailure = JSON.stringify(storage);
rejectWrite = true;
assert.throws(() => documents.save({ id: original.id, text: 'failed change' }), /Storage unavailable/);
assert.equal(JSON.stringify(storage), stateBeforeFailure);
assert.throws(() => documents.remove(original.id), /Storage unavailable/);
assert.equal(JSON.stringify(storage), stateBeforeFailure);
rejectWrite = false;
const external = documents.load(); external[0].text = 'outside change';
assert.equal(documents.load()[0].text, '坐姿呼吸练习');
documents.save({ type: 'medical', path: '/temporary/case.jpg' });
assert.equal(documents.list('medical').length, 1);
assert.equal(documents.remove(original.id).length, 1);
assert.throws(() => documents.save({ type: 'unknown' }), /病例单/);

const source = '训练方案\n1. 坐姿呼吸练习 3组 每组5次呼吸 每天\n2. 靠墙站姿练习 3组 每组30秒 每周一三五';
const extracted = documents.extract(source, 'training');
assert.equal(extracted.actions.length, 2);
assert.deepEqual(extracted.actions.map(({ name, sets, amount, mode, frequency }) => ({ name, sets, amount, mode, frequency })), [
  { name: '坐姿呼吸练习', sets: '3', amount: '5', mode: 'breath', frequency: '每天' },
  { name: '靠墙站姿练习', sets: '3', amount: '30', mode: 'timer', frequency: '每周一三五' }
]);
assert.equal(extracted.actions[0].sourceText, source.split('\n')[1]);
assert.deepEqual(extracted.actions.map(item => item.id), documents.extract(source, 'training').actions.map(item => item.id));
const incomplete = documents.extract('1. 靠墙站姿练习\n方向：向右伸展，保持肩部放松', 'training').actions[0];
assert.equal(incomplete.sets, ''); assert.equal(incomplete.amount, ''); assert.equal(incomplete.mode, '');
assert.equal(incomplete.frequency, ''); assert.match(incomplete.notes, /向右伸展/);
assert.deepEqual(incomplete.conflicts, { sets: false, amount: false, mode: false, frequency: false });
const conflicting = documents.extract('1. 靠墙站姿练习 3组 4组 每组30秒 每组20秒 每天 隔天', 'training').actions[0];
assert.equal(conflicting.sets, ''); assert.equal(conflicting.amount, ''); assert.equal(conflicting.mode, ''); assert.equal(conflicting.frequency, '');
assert.ok(conflicting.warnings.length >= 3);
assert.deepEqual(conflicting.conflicts, { sets: true, amount: true, mode: true, frequency: true });
const ranged = documents.extract('1. 靠墙站姿练习 3～5组 每组20～30秒', 'training').actions[0];
assert.equal(ranged.sets, ''); assert.equal(ranged.amount, ''); assert.ok(ranged.warnings.length);
assert.deepEqual(ranged.conflicts, { sets: true, amount: true, mode: true, frequency: false });
const ambiguous = documents.extract('1. 站姿练习 3组 每组5次或10次', 'training').actions[0];
assert.equal(ambiguous.amount, ''); assert.ok(ambiguous.warnings.length);
assert.equal(ambiguous.conflicts.amount, true); assert.equal(ambiguous.conflicts.sets, false);
const frequencies = documents.extract('1. 坐姿呼吸练习 每天2次 每次3组 每组5次\n2. 靠墙站姿练习 每7天3次', 'training').actions;
assert.equal(frequencies[0].sets, '3'); assert.equal(frequencies[0].amount, '5'); assert.equal(frequencies[0].frequency, '每天2次');
assert.equal(frequencies[1].amount, ''); assert.equal(frequencies[1].frequency, '每7天3次');
const chinese = documents.extract('1. 坐姿呼吸练习 三组 每组呼吸五次', 'training').actions[0];
assert.equal(chinese.sets, '3'); assert.equal(chinese.amount, '5'); assert.equal(chinese.mode, 'breath');
assert.equal(documents.extract('1. 坐姿呼吸练习 每周三次', 'training').actions[0].frequency, '每周三次');
assert.equal(documents.extract('1. 扶墙推压 3组 每组5次', 'training').actions[0].name, '扶墙推压');
const spacedSource = '  1. 坐 姿 呼 吸 练 习 3 组 每 组 5 次 呼 吸 每 天  \n个 人 要 点：\n保 持 肩 部 放 松';
const spaced = documents.extract(spacedSource, 'training');
assert.equal(spaced.actions.length, 1);
assert.equal(spaced.actions[0].name, '坐姿呼吸练习');
assert.equal(spaced.actions[0].sets, '3'); assert.equal(spaced.actions[0].amount, '5');
assert.equal(spaced.actions[0].mode, 'breath'); assert.equal(spaced.actions[0].frequency, '每天');
assert.match(spaced.actions[0].notes, /保持肩部放松/);
assert.equal(spaced.actions[0].sourceText, spacedSource);
assert.equal(documents.extract('1. 靠墙站姿练习\n个人要点：保持肩部放松', 'training').actions.length, 1);
const middleDotText = '1·坐 姿 呼 吸 练 习 3 组 每 组 5 次 呼 吸';
const middleDot = documents.extract(middleDotText, 'training').actions[0];
assert.equal(middleDot.name, '坐姿呼吸练习'); assert.equal(middleDot.sourceText, middleDotText);
assert.deepEqual(middleDot.conflicts, { sets: false, amount: false, mode: false, frequency: false });
assert.equal(documents.extract('2·扶墙推压 3组 每组5次', 'training').actions[0].name, '扶墙推压');
const medical = documents.extract(source + '\n诊断：侧弯。'.repeat(100), 'medical');
assert.deepEqual(medical.actions, []); assert.equal(medical.context.length, 500);
assert.deepEqual(documents.extract('   ', 'training'), { actions: [], context: '', unparsed: [] });
assert.deepEqual(documents.extract('诊断：脊柱侧弯', 'training').actions, []);
console.log('PASS: document storage is isolated and atomic; extraction keeps explicit source requirements and never turns a medical record into a prescription.');
