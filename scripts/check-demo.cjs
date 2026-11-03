const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const project = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
assert.equal(project.miniprogramRoot, 'miniprogram-demo/');
JSON.parse(fs.readFileSync(path.join(root, 'project.private.config.json'), 'utf8'));
let templateCount = 0;
function checkFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) { checkFiles(filename); continue; }
    const source = fs.readFileSync(filename, 'utf8');
    if (entry.name.endsWith('.json')) JSON.parse(source);
    if (entry.name.endsWith('.wxml')) {
      for (const match of source.matchAll(/{{([\s\S]*?)}}/g)) {
        new vm.Script(`(${match[1]})`, { filename: path.relative(root, filename) });
      }
      templateCount++;
    }
  }
}
checkFiles(path.join(root, project.miniprogramRoot, 'pages'));
JSON.parse(fs.readFileSync(path.join(root, project.miniprogramRoot, 'app.json'), 'utf8'));
console.log(`PASS: project/page JSON and ${templateCount} WXML template expressions parse successfully.`);

function checkMaterialExclusion(coreDirectory) {
  const SpineApp = require(path.join(root, coreDirectory, 'core', 'spine-app.js'));
  const app = new SpineApp({});
  let mats = app.renderVals().mats;

  assert.equal(mats[2].disabledAria, 'true', `${coreDirectory}: 有资料时“还没有”应不可选`);
  mats[2].toggle();
  assert.equal(app.state.matNone, false, `${coreDirectory}: 不可选项不应改变状态`);

  mats[0].toggle();
  mats = app.renderVals().mats;
  assert.equal(mats[2].disabledAria, 'true', `${coreDirectory}: 任一资料已选时“还没有”仍不可选`);
  mats[1].toggle();
  mats = app.renderVals().mats;
  assert.equal(mats[2].disabledAria, 'false', `${coreDirectory}: 两类资料都取消后“还没有”应恢复可选`);

  mats[2].toggle();
  mats = app.renderVals().mats;
  assert.equal(app.state.matNone, true, `${coreDirectory}: “还没有”应能单独选中`);
  assert.deepEqual(mats.slice(0, 2).map((m) => m.disabledAria), ['true', 'true'], `${coreDirectory}: 选中“还没有”后两类资料应不可选`);
  mats[0].toggle();
  assert.equal(app.state.matReport, false, `${coreDirectory}: 被禁用的资料项不应改变状态`);
}

checkMaterialExclusion('miniprogram-demo');
checkMaterialExclusion(path.join('miniprogram', 'prototype'));
console.log('PASS: hospital-material options are mutually exclusive in both demo copies.');
const design = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram-demo/design-version.json'), 'utf8'));
assert.equal(design.baseline, 'output/design/xiaoshu-merged-training.png');
require('./check-training-design.cjs');
require('./check-follow-flow.cjs');
require('./check-training-calendar.cjs');
require('./check-brace-visibility.cjs');
require('./check-community-compose.cjs');
require('./check-community-management.cjs');
require('./check-personal-info.cjs');
require('./check-capture-library.cjs');
console.log('PASS: active demo follows the merged training layout and six-step recording flow from output/design.');
