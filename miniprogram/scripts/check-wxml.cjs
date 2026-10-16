const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Checks expression syntax without executing it. This catches invalid HTML escapes
// in bindings; it does not replace compilation in WeChat Developer Tools.
const root = path.resolve(__dirname, '../pages');
let files = 0;
let failures = 0;

function check(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) { check(filename); continue; }
    if (!entry.name.endsWith('.wxml')) continue;
    files++;
    const source = fs.readFileSync(filename, 'utf8');
    for (const match of source.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
      try {
        new vm.Script(`(${match[1]})`);
      } catch (error) {
        const line = source.slice(0, match.index).split('\n').length;
        console.error(`${path.relative(root, filename)}:${line}: ${error.message}`);
        failures++;
      }
    }
  }
}

check(root);
const app = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../app.json'), 'utf8'));
for (const bundle of app.subPackages || []) check(path.resolve(__dirname, '..', bundle.root));
console.log(`WXML expression syntax: ${files} files, ${failures} errors`);
if (failures) process.exitCode = 1;
