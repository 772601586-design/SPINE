const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'spine1/demo/miniprogram');
const destination = path.join(root, 'miniprogram-demo');
const entries = ['app.js', 'app.json', 'app.wxss', 'sitemap.json', 'core', 'pages', 'assets'];
for (const entry of entries) {
  fs.cpSync(path.join(source, entry), path.join(destination, entry), { recursive: true });
}
const configuration = JSON.parse(fs.readFileSync(path.join(destination, 'app.json'), 'utf8'));
console.log(`Copied ${configuration.pages.length} source demo pages with original styles, native tabs and business logic to miniprogram-demo/.`);
