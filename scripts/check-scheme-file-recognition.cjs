'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createDemoServer } = require('./serve-demo.cjs');
const { MAX_FILE_BYTES, MAX_REQUEST_BYTES, decodeFile, recognizeSchemeFile } = require('./scheme-file-recognition.cjs');
const execute = promisify(execFile);
const toPayload = (name, bytes) => ({ name, extension: name.split('.').pop().toLowerCase(), fileBase64: bytes.toString('base64') });

async function fixtures() {
  const python = process.env.XIAOSHU_PYTHON || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
  const code = [
    'import io,json,base64,zipfile',
    'from pypdf import PdfWriter',
    'from pypdf.generic import DictionaryObject,NameObject,DecodedStreamObject',
    'writer=PdfWriter(); page=writer.add_blank_page(width=400,height=400)',
    'font=DictionaryObject({NameObject("/Type"):NameObject("/Font"),NameObject("/Subtype"):NameObject("/Type1"),NameObject("/BaseFont"):NameObject("/Helvetica")})',
    'page[NameObject("/Resources")]=DictionaryObject({NameObject("/Font"):DictionaryObject({NameObject("/F1"):font})})',
    'stream=DecodedStreamObject(); stream.set_data(b"BT /F1 12 Tf 20 320 Td (1. Wall breathing exercise 3 sets of 12 repetitions every day) Tj ET")',
    'page[NameObject("/Contents")]=writer._add_object(stream)',
    'out=io.BytesIO(); writer.write(out)',
    'blank=PdfWriter(); blank.add_blank_page(width=200,height=200); scan=io.BytesIO(); blank.write(scan)',
    'many=PdfWriter(); [many.add_blank_page(width=200,height=200) for _ in range(25)]; manyout=io.BytesIO(); many.write(manyout)',
    'encrypted=PdfWriter(); encrypted.add_blank_page(width=200,height=200); encrypted.encrypt("secret"); crypt=io.BytesIO(); encrypted.write(crypt)',
    'docx=io.BytesIO()',
    `with zipfile.ZipFile(docx,"w",zipfile.ZIP_DEFLATED) as z: z.writestr("word/document.xml", """<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>1. 呼吸练习 每天 3组 每组12次</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>靠墙站立</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>每组30秒</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>""")`,
    'print(json.dumps({"pdf":base64.b64encode(out.getvalue()).decode(),"scanned":base64.b64encode(scan.getvalue()).decode(),"many":base64.b64encode(manyout.getvalue()).decode(),"encrypted":base64.b64encode(crypt.getvalue()).decode(),"docx":base64.b64encode(docx.getvalue()).decode(),"gb":base64.b64encode("1. 呼吸练习 3组 每组12次".encode("gb18030")).decode()}))',
  ].join('\n');
  const result = await execute(python, ['-c', code], { maxBuffer: 2 * 1024 * 1024, windowsHide: true, encoding: 'utf8' });
  return JSON.parse(result.stdout);
}

async function nativeClientChecks() {
  const source = await fs.readFile(path.join(__dirname, '../miniprogram-demo/core/document-recognition.js'), 'utf8');
  let read, request;
  const context = { module: { exports: {} }, wx: {
    getFileSystemManager: () => ({ readFile(options) { read = options; options.success({ data: 'YWJj' }); } }),
    request(options) { request = options; options.success({ statusCode: 200, data: { text: 'example', engine: 'local-test' } }); },
  } };
  vm.runInNewContext(source, context);
  const result = await context.module.exports.recognizeFile({ path: 'wxfile://saved/doc.pdf', originalName: '方案.pdf', extension: 'pdf' });
  assert.equal(result.text, 'example');
  assert.equal(read.encoding, 'base64');
  assert.equal(read.filePath, 'wxfile://saved/doc.pdf');
  assert.equal(request.url, 'http://127.0.0.1:4180/api/recognize-scheme');
  assert.equal(request.data.name, '方案.pdf');
  assert.equal(request.data.extension, 'pdf');
  assert.equal(request.data.fileBase64, 'YWJj');
  assert.equal(typeof request.data.fileBase64, 'string');
  await assert.rejects(context.module.exports.recognizeFile({ path: 'file', name: 'large.pdf', size: MAX_FILE_BYTES + 1 }), /20 MB/);
  await assert.rejects(context.module.exports.recognizeFile(null), /选择/);
  context.wx.request = options => options.success({ statusCode: 503, data: { error: 'visible extraction failure' } });
  await assert.rejects(context.module.exports.recognizeFile({ path: 'file', name: 'plan.docx' }), /visible extraction failure/);
  let hook;
  context.wx.recognizeSchemeFile = options => { hook = options; options.success({ text: 'hook', engine: 'preview' }); };
  assert.equal((await context.module.exports.recognizeFile({ filePath: 'saved', name: 'plan.txt' })).text, 'hook');
  assert.equal(hook.name, 'plan.txt');
  assert.equal(hook.extension, 'txt');
  assert.equal(typeof context.module.exports.recognize, 'function', 'Existing image OCR API stays available.');
}

async function main() {
  await nativeClientChecks();
  const sample = await fixtures();
  const tempBefore = new Set((await fs.readdir(os.tmpdir())).filter(name => name.startsWith('xiaoshu-scheme-file-')));
  const utf8 = Buffer.from('1. 呼吸练习 每天 3组 每组12次\n2. 靠墙站立 2组 每组30秒');
  const values = [
    ['plan.txt', utf8, '呼吸练习'],
    ['utf16.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('呼吸练习 3组 每组12次', 'utf16le')]), '呼吸练习'],
    ['gb18030.txt', Buffer.from(sample.gb, 'base64'), '呼吸练习'],
    ['plan.docx', Buffer.from(sample.docx, 'base64'), '靠墙站立\t每组30秒'],
    ['plan.pdf', Buffer.from(sample.pdf, 'base64'), 'Wall breathing'],
  ];
  for (const [name, bytes, expected] of values) {
    const result = await recognizeSchemeFile(toPayload(name, bytes));
    assert.equal(result.text.includes(expected), true, `${name} text must be extracted.`);
    assert.equal(result.requires_confirmation, true);
    assert.equal(result.engine.startsWith('local-'), true);
  }
  let ocrCalls = 0;
  const scanned = await recognizeSchemeFile(toPayload('scanned.pdf', Buffer.from(sample.scanned, 'base64')), {
    recognizeDocument: async image => { assert.equal(image.startsWith('data:image/png;base64,'), true); ocrCalls += 1; return { text: '1. 扫描方案 呼吸练习 3组 每组12次', engine: 'test-local-ocr' }; },
  });
  assert.equal(ocrCalls, 1);
  assert.equal(scanned.engine, 'local-pdf-windows-ocr');
  assert.equal(scanned.text.includes('扫描方案'), true);
  await assert.rejects(recognizeSchemeFile(toPayload('many.pdf', Buffer.from(sample.many, 'base64'))), error => error.code === 'TOO_MANY_PAGES');
  await assert.rejects(recognizeSchemeFile(toPayload('locked.pdf', Buffer.from(sample.encrypted, 'base64'))), error => error.code === 'PASSWORD_REQUIRED');
  await assert.rejects(recognizeSchemeFile(toPayload('broken.docx', Buffer.from('PK\x03\x04invalid'))), error => error.code === 'INVALID_DOCX');
  await assert.rejects(recognizeSchemeFile(toPayload('empty.txt', Buffer.from(' \n '))), error => error.code === 'NO_TEXT');
  for (const [payload, code] of [
    [{}, 'FILE_REQUIRED'], [{ name: 1 }, 'FILE_REQUIRED'],
    [{ ...toPayload('../escaped.txt', utf8) }, 'INVALID_FILE_NAME'],
    [{ ...toPayload('C:\\escaped.txt', utf8) }, 'INVALID_FILE_NAME'],
    [{ ...toPayload('ok.txt', utf8), extension: [] }, 'INVALID_FILE'],
    [{ ...toPayload('ok.txt', utf8), extension: 'pdf' }, 'FILE_TYPE_MISMATCH'],
    [{ ...toPayload('plan.txt', utf8), fileBase64: {} }, 'INVALID_FILE'],
    [{ ...toPayload('plan.txt', utf8), fileBase64: 'YWJj=' }, 'INVALID_FILE'],
    [toPayload('plan.exe', utf8), 'UNSUPPORTED_FILE'],
    [toPayload('plan.pdf', utf8), 'INVALID_PDF'],
    [{ name: 'large.txt', fileBase64: 'A'.repeat(Math.ceil(MAX_FILE_BYTES / 3) * 4 + 4) }, 'FILE_TOO_LARGE'],
  ]) assert.throws(() => decodeFile(payload), error => error.code === code, code);
  // Uploaded path/URL fields are never used: only uploaded bytes enter the extractor.
  const noExternal = await recognizeSchemeFile({ ...toPayload('plan.txt', utf8), path: 'https://example.com/private', filePath: '../secret' });
  assert.equal(noExternal.text.includes('呼吸练习'), true);
  const server = createDemoServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const url = origin + '/api/recognize-scheme';
  const post = (value, headers = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', Origin: origin, ...headers }, body: JSON.stringify(value) });
  try {
    const response = await post(toPayload('plan.txt', utf8));
    assert.equal(response.status, 200); assert.equal((await response.json()).text.includes('呼吸练习'), true);
    assert.equal((await fetch(url)).status, 405);
    assert.equal((await post(toPayload('plan.txt', utf8), { Origin: 'https://example.com' })).status, 403);
    assert.equal((await post(toPayload('plan.txt', utf8), { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    const foreignHost = await new Promise((resolve, reject) => {
      const request = http.request(url, { method: 'POST', headers: { Host: 'example.com', 'content-type': 'application/json' } }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      }); request.on('error', reject); request.end('{}');
    });
    assert.equal(foreignHost, 403);
    assert.equal((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status, 400);
    assert.equal((await fetch(url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415);
    const escaped = await post(toPayload('../private.txt', utf8));
    assert.equal(escaped.status, 400); assert.equal((await escaped.json()).code, 'INVALID_FILE_NAME');
    const oversized = await new Promise((resolve, reject) => {
      const request = http.request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': MAX_REQUEST_BYTES + 1 } }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      }); request.on('error', reject); request.end();
    });
    assert.equal(oversized, 413);
    const traversal = await fetch(origin + '/api/%2e%2e%2frecognize-scheme', { method: 'POST' });
    assert.equal(traversal.status, 403);
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
  const leaked = (await fs.readdir(os.tmpdir())).filter(name => name.startsWith('xiaoshu-scheme-file-') && !tempBefore.has(name));
  assert.equal(leaked.length, 0, 'Temporary source files and rendered PDF pages must be removed, including on failure.');
  console.log('PASS: private local TXT/PDF/DOCX extraction, scanned-PDF OCR fallback, native payloads, validation, limits, loopback/origin protection and temporary-file cleanup.');
}

main().catch(error => { console.error(`FAIL: ${error.message}`); process.exitCode = 1; });
