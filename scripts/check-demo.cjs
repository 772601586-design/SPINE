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
const design = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram-demo/design-version.json'), 'utf8'));
assert.equal(design.baseline, 'output/design/xiaoshu-merged-training.png');
require('./check-training-design.cjs');
console.log('PASS: active demo follows the merged training layout and six-step recording flow from output/design.');
