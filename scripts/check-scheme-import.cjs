const assert = require('node:assert/strict');
const documents = require('../miniprogram-demo/core/documents');
const training = require('../miniprogram-demo/core/training');
const importer = require('../miniprogram-demo/core/scheme-import');
const copy = value => JSON.parse(JSON.stringify(value));
const storage = {}; let writes = 0, rejectWrite = false;
global.wx = { getStorageSync: key => storage[key], setStorageSync(key, value) {
  if (rejectWrite) throw Error('storage full'); storage[key] = copy(value); writes++;
} };
const originalToday = training.today;
training.today = () => '2026-10-22';
const doc = { id: 'first-document', type: 'training', originalName: '康复师方案.pdf', recordingBatchId: 'visit-1', text: [
  '姓名：测试', '出生日期：2012-03-05', '就诊日期：2026-10-21', '训练频次：每天',
  '一、柔韧性练习', '1、靠墙站姿练习 30秒 X 2组', '要点：保持肩部放松', '2、猫---骆驼 2分钟',
  '二、核心稳定性训练（隔天练习）', '1、平板支撑 3分钟', '2、臀桥 100个 2组',
  '三、呼吸练习', '1、坐姿呼吸练习 三组 每组呼吸五次 每周一三五',
  '2、侧桥 3组 每组30秒 每周3次', '3、抬腿 2组 每组5次 每天2次', '4、动作名称：扶墙推压',
  '四、注意事项：', '1、避免负重，建议每周3次步行训练', '2、定期复查调整'
].join('\n') };
const result = importer.importDocument(doc);
assert.equal(writes, 1, 'new cards, schedules and marker have one atomic write even on first import');
assert.equal(result.cards.length, 8);
assert.equal(result.scheduledCount, 5);
assert.equal(result.pendingCount, 3);
assert.equal(result.draftCount, 1);
assert.equal(result.plans.length, 3);
assert.deepEqual(result.cards.find(card => card.name === '猫---骆驼').amount, 120);
assert.deepEqual(result.cards.find(card => card.name === '臀桥').amount, 100);
assert.equal(result.cards.find(card => card.name === '靠墙站姿练习').notes.includes('保持肩部放松'), true);
assert.equal(result.cards.some(card => /姓名|日期|建议|定期/.test(card.name)), false);
assert.equal(result.cards.find(card => card.name === '侧桥').scheduleStatus, 'pending');
assert.equal(result.cards.find(card => card.name === '抬腿').scheduleStatus, 'pending');
assert.equal(result.cards.find(card => card.name === '扶墙推压').confirmed, false);
const alternate = result.plans.find(plan => plan.schedule === 'alternate');
assert.equal(alternate.calendarInterval, true);
assert.equal(training.due(alternate, '2026-10-22', training.load()), true);
assert.equal(training.due(alternate, '2026-10-23', training.load()), false);
assert.equal(training.due(alternate, '2026-10-24', training.load()), true);
const committed = JSON.stringify(storage); const priorWrites = writes;
importer.importDocument(doc);
assert.equal(JSON.stringify(storage), committed, 'same document retry is fully idempotent');
assert.equal(writes, priorWrites);
training.today = () => '2026-10-23'; importer.importDocument(doc);
assert.equal(JSON.stringify(storage), committed, 'next-day refresh preserves original alternate anchor');
training.today = () => '2026-10-22';
const custom = training.saveCard({ name: '我的其他动作', sets: 2, amount: 8, mode: 'count' }, true);
const daily = result.plans.find(plan => plan.schedule === 'daily');
const session = training.session(daily.id, originalToday(), true);
training.saveSet(session.id, daily.cardIds[0], 0, 30);
const actualHistory = copy(training.load().sessions);
const card = training.load().cards.find(item => item.id === daily.cardIds[0]);
training.saveCard({ ...card, sets: 4, amount: 40, notes: '本人核对后的要点', video: '/private/confirmed.mp4' }, true);
const editedPlan = training.savePlan({ id: daily.id, name: '我修改后的日程', cardIds: [card.id], schedule: 'weekdays', weekdays: [1, 3],
  start: '2026-10-20', active: false, cycleDays: 7, cycleTimes: 2 });
const refreshed = importer.importDocument(doc);
const preserved = refreshed.cards.find(item => item.id === card.id);
assert.equal(preserved.sets, 4); assert.equal(preserved.amount, 40);
assert.equal(preserved.notes, '本人核对后的要点'); assert.equal(preserved.video, '/private/confirmed.mp4');
assert.deepEqual(training.load().sessions, actualHistory, 'source refresh never rewrites actual session snapshots');
assert.deepEqual(training.load().cards.find(item => item.id === custom.id), custom);
const planAfterRefresh = training.load().plans.find(item => item.id === daily.id);
['name', 'cardIds', 'schedule', 'weekdays', 'start', 'active', 'cycleTimes'].forEach(field => assert.deepEqual(planAfterRefresh[field], editedPlan[field], 'manual plan API preserves ' + field));
const unrelatedState = JSON.stringify(storage), newDocument = { id: 'second-document', type: 'training', text: '1、右侧桥 2组 每组15秒 每天' };
rejectWrite = true;
assert.throws(() => importer.importDocument(newDocument), /storage full/);
assert.equal(JSON.stringify(storage), unrelatedState, 'failed import cannot leak cards, plans or marker'); rejectWrite = false;
const second = importer.importDocument(newDocument);
assert.equal(second.importedCount, 1); assert.equal(second.scheduledCount, 1);
assert.deepEqual(training.load().sessions, actualHistory);
const recording = training.saveCard({ name: '右侧桥', notes: '录像要点', video: '/private/clip.mp4', sets: '', amount: '', mode: '' }, false);
assert.equal(importer.reconcileVideos().linkedCount, 1, 'recording added after document is associated by exact name');
const linked = training.load().cards.find(item => item.id === second.cards[0].id);
assert.equal(linked.sourceVideoCardId, recording.id);
assert.equal(training.load().cards.find(item => item.id === recording.id).linkedToActionId, linked.id);
const moreVideo = training.saveCard({ name: '另一个录段', notes: '保留录段', video: '/private/other.mp4', sets: '', amount: '', mode: '' }, false);
const manuallyLinked = importer.linkVideo(linked.id, moreVideo.id);
assert.equal(manuallyLinked.video, moreVideo.video); assert.equal(manuallyLinked.name, linked.name);
assert.deepEqual([manuallyLinked.sets, manuallyLinked.amount, manuallyLinked.mode], [linked.sets, linked.amount, linked.mode]);
assert.equal(training.load().cards.find(item => item.id === recording.id).linkedToActionId, undefined);
assert.throws(() => importer.linkVideo(card.id, moreVideo.id), /其他动作/);
importer.linkVideo(linked.id, ''); importer.reconcileVideos(); importer.importDocument(newDocument);
assert.equal(training.load().cards.find(item => item.id === linked.id).video, '', 'manual unlink remains unlinked after automatic refresh');
const unclear = importer.importDocument({ id: 'unknown-frequency', type: 'training', text: '1、站姿练习 3组 每组20秒' });
assert.equal(unclear.cards[0].confirmed, true); assert.equal(unclear.scheduledCount, 0); assert.equal(unclear.plans.length, 0);
const duplicates = importer.importDocument({ id: 'repeated-names', type: 'training', text: '训练频次：每天\n1、抬腿 2组 每组5次\n2、抬腿 3组 每组10次' });
assert.equal(duplicates.cards.length, 2); assert.equal(new Set(duplicates.cards.map(item => item.id)).size, 2);
assert.deepEqual(duplicates.cards.map(item => item.sets), [2, 3]);
assert.equal(importer.parseSchedule('每周三次').executable, false);
assert.equal(importer.parseSchedule('每天2次').executable, false);
assert.equal(importer.parseSchedule('训练日期：2026年10月24日').onlyDate, '2026-10-24');
assert.equal(importer.parseSchedule('2026-02-30').executable, false);
assert.equal(documents.extract('1、站姿练习 30秒×2组 训练日期：2026-10-24', 'training').actions[0].frequency, '训练日期：2026-10-24');
assert.equal(documents.extract('训练频次：每天\n一、核心训练（每天或隔天）\n1、平板支撑30秒×2组', 'training').actions[0].frequency, '', 'conflicting group cadence cannot fall back to global daily cadence');
assert.equal(documents.extract('1、避免平板支撑练习3分钟\n2、定期复查调整', 'training').actions.length, 0, 'numbered cautions are not exercises');
assert.throws(() => importer.importDocument({ id: 'case', type: 'medical', text: doc.text }), /训练方案/);
const fixture = [
  '一、认知能力学习：每天绘制脊柱曲线图10张。', '二、姿势矫正', '1 坐：双手臂撑课桌，骨盆固定不动', '2 站：撑杆站立3分钟',
  '三、柔韧性练习', '1. 猫---骆驼2分钟', '2. 右弓箭步拉伸左髂腰肌30秒 X 2组',
  '四、3D矫正练习', '1、强化运动：左臀下垫沙包，降低右髋。5分', '钟', '2、肌肉圆柱5分钟',
  '五、核心/肩胛带稳定性训练（隔天练习）', '1、卷腹仰卧自行车50次2组', '2、平板支撑各3分钟', '3、右侧桥3分钟', '4、臀桥100个2组', '5、Y-W-T各30个3组',
  '六、颈椎矫正动作', '头顶画圆圈、鼻尖写“8”，下巴画半圆、沉肩拉耳、抬头望月、双手压额、后', '仰拉伸（默念4个8拍，整套动作约5分钟）',
  '七、拉伸-整理放松', '1、跪位、坐位前伸各2分钟', '2、悬吊配合呼吸3分钟', '八、注意事项', '1、日常生活中注重自我姿势矫正练习'
].join('\n');
const attachment = importer.importDocument({ id: 'attachment', type: 'training', text: fixture });
assert.equal(attachment.cards.length, 24); assert.equal(new Set(attachment.cards.map(item => item.groupName)).size, 7);
assert.equal(attachment.draftCount, 9); assert.equal(attachment.scheduledCount, 7, 'only explicitly alternate core items enter a repeated plan');
assert.ok(attachment.cards.filter(item => item.groupName === '颈椎矫正动作').every(item => !item.confirmed && !item.amount), 'whole-routine time is never divided into invented individual doses');
training.today = originalToday;
console.log('PASS: automatic source-derived cards, inherited schedules, explicit minutes/counts, pending frequency/dose, atomic writes, retry/day stability, manual edits, history, safe video matching/unlink, and 24-item attachment extraction.');
