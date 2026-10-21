'use strict';

// Run against a short, non-private printed-text fixture. Default: the existing
// local Chinese OCR fixture. No image content or OCR text is logged.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createDemoServer } = require('./serve-demo.cjs');
const { MAX_REQUEST_BYTES, MAX_IMAGE_BYTES } = require('./demo-ocr.cjs');

async function main() {
  const fixture = path.resolve(process.argv[2] || path.join(__dirname, '../.tmp/ocr-chinese-fixture.png'));
  const bytes = await fs.readFile(fixture);
  const image = `data:image/png;base64,${bytes.toString('base64')}`;
  const before = new Set((await fs.readdir(os.tmpdir())).filter(name => name.startsWith('xiaoshu-demo-ocr-')));
  const server = createDemoServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const url = `${origin}/api/recognize-document`;
  const post = (value, headers = {}) => fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...headers }, body: JSON.stringify(value),
  });
  try {
    const version = await fetch(`${origin}/api/version`);
    assert.equal(version.status, 200);
    assert.equal(typeof (await version.json()).version, 'string');

    const method = await fetch(url);
    assert.equal(method.status, 405);
    assert.equal(method.headers.get('allow'), 'POST');

    for (const [value, expectedCode] of [
      [{}, 'IMAGE_REQUIRED'],
      [{ image: null }, 'IMAGE_REQUIRED'],
      [{ image: 'invalid' }, 'INVALID_IMAGE'],
      [{ image: 'data:image/png;base64,ZmFrZQ==' }, 'INVALID_IMAGE'],
      [{ image: image.replace('image/png', 'image/jpeg') }, 'INVALID_IMAGE'],
      [{ image: 'data:image/gif;base64,ZmFrZQ==' }, 'INVALID_IMAGE'],
    ]) {
      const response = await post(value);
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.equal(body.code, expectedCode);
      assert.equal(typeof body.error, 'string');
      assert.equal('text' in body, false);
    }

    const invalidJson = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(invalidJson.status, 400);
    assert.equal((await invalidJson.json()).code, 'INVALID_JSON');

    const textForm = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
    assert.equal(textForm.status, 415);

    const foreignOrigin = await post({ image }, { Origin: 'https://example.com' });
    assert.equal(foreignOrigin.status, 403);
    assert.equal((await foreignOrigin.json()).code, 'INVALID_ORIGIN');

    const crossSite = await post({ image }, { 'Sec-Fetch-Site': 'cross-site' });
    assert.equal(crossSite.status, 403);

    const oversizedImage = await post({ image: `data:image/png;base64,${'A'.repeat(Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 68)}` });
    assert.equal(oversizedImage.status, 413);
    assert.equal((await oversizedImage.json()).code, 'IMAGE_TOO_LARGE');

    // Content-Length is rejected before allocating or waiting for the body.
    const oversizedRequest = await new Promise((resolve, reject) => {
      const request = http.request(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': MAX_REQUEST_BYTES + 1 },
      }, response => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject);
      request.end();
    });
    assert.equal(oversizedRequest, 413);

    // A truncated image still has a valid signature/header: the real decoder
    // must fail honestly and remove its temporary input even on that path.
    const damaged = await post({ image: `data:image/png;base64,${bytes.subarray(0, 33).toString('base64')}` });
    assert.equal(damaged.status, 503);
    const damagedResult = await damaged.json();
    assert.equal(damagedResult.code, 'OCR_UNAVAILABLE');
    assert.equal('text' in damagedResult, false);

    const real = await post({ image });
    const recognized = await real.json();
    assert.equal(real.status, 200, `Local OCR must actually run; status ${real.status}, code ${recognized.code || 'none'}.`);
    assert.equal(recognized.engine, 'windows-ocr');
    assert.equal(recognized.requires_confirmation, true);
    assert.equal(Array.isArray(recognized.lines), true);
    assert.equal(Boolean(recognized.text.trim()), true, 'Fixture must produce real recognized text.');
    if (path.basename(fixture) === 'ocr-chinese-fixture.png') {
      const compact = recognized.text.replace(/\s/g, '');
      assert.equal(/3组/.test(compact) && /12次/.test(compact), true, 'Chinese fixture dose fields must be recognized.');
    }

    const after = (await fs.readdir(os.tmpdir())).filter(name => name.startsWith('xiaoshu-demo-ocr-') && !before.has(name));
    assert.equal(after.length, 0, 'OCR temporary images and directories must be removed.');
    console.log('PASS: local Windows OCR, API validation, origin protection, upload limits, and temporary-file cleanup.');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
