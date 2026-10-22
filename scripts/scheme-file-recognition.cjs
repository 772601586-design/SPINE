'use strict';

// Private local file recognition. File names are metadata, never file-system paths.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { decodeImage, recognizeDocument } = require('./demo-ocr.cjs');
const execute = promisify(execFile);
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_REQUEST_BYTES = Math.ceil(MAX_FILE_BYTES / 3) * 4 + 4096;
const MAX_TEXT_CHARACTERS = 200000;
const FILE_TIMEOUT_MS = 180000;
const EXTRACT_SCRIPT = path.join(__dirname, 'scheme-file-extract.py');
const WORD_SCRIPT = path.join(__dirname, 'scheme-word-extract.ps1');
let activeJobs = 0;

function failure(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

function decodeFile(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.name !== 'string' || !body.name.trim()) {
    throw failure(400, 'FILE_REQUIRED', '请选择需要识别的训练方案文件。');
  }
  if (body.name.length > 255 || /[\\/\0\r\n]/.test(body.name) || body.name === '.' || body.name === '..') {
    throw failure(400, 'INVALID_FILE_NAME', '文件名称无效，请重新选择方案文件。');
  }
  const extension = path.extname(body.name).slice(1).toLowerCase();
  if (body.extension !== undefined && typeof body.extension !== 'string') {
    throw failure(400, 'INVALID_FILE', '文件格式声明无效，请重新选择方案文件。');
  }
  if (typeof body.extension === 'string' && body.extension.replace(/^\./, '').toLowerCase() !== extension) {
    throw failure(400, 'FILE_TYPE_MISMATCH', '文件后缀与声明格式不一致，请重新选择文件。');
  }
  if (!['txt', 'pdf', 'docx', 'doc', 'png', 'jpg', 'jpeg'].includes(extension)) {
    throw failure(415, 'UNSUPPORTED_FILE', '支持 PDF、Word、TXT、JPG 和 PNG 方案文件。');
  }
  const encoded = body.fileBase64;
  if (typeof encoded !== 'string' || !encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw failure(400, 'INVALID_FILE', '文件内容无效，请重新上传。');
  }
  if (encoded.length > Math.ceil(MAX_FILE_BYTES / 3) * 4) {
    throw failure(413, 'FILE_TOO_LARGE', '方案文件需小于 20 MB，请压缩或分成多个文件。');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > MAX_FILE_BYTES) throw failure(413, 'FILE_TOO_LARGE', '方案文件需小于 20 MB，请压缩或分成多个文件。');
  if (!bytes.length || bytes.toString('base64') !== encoded) throw failure(400, 'INVALID_FILE', '文件内容无效，请重新上传。');
  if (extension === 'pdf' && !bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) {
    throw failure(400, 'INVALID_PDF', 'PDF 内容无效，请重新选择完整文件。');
  }
  if (extension === 'docx' && !bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    throw failure(400, 'INVALID_DOCX', 'Word 内容无效，请重新选择 DOCX 文件。');
  }
  if (extension === 'doc' && !bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) {
    throw failure(400, 'INVALID_DOC', '旧版 Word 内容无效，请另存为 DOCX 后上传。');
  }
  if (['png', 'jpg', 'jpeg'].includes(extension)) {
    decodeImage(`data:image/${extension === 'png' ? 'png' : 'jpeg'};base64,${encoded}`);
  }
  return { bytes, extension };
}

async function pythonRuntime() {
  const candidates = [
    process.env.XIAOSHU_PYTHON,
    path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3'),
  ].filter(Boolean);
  for (const filename of candidates) {
    try { await fs.access(filename); return filename; } catch {}
  }
  throw failure(503, 'EXTRACTOR_UNAVAILABLE', '本机文件识别引擎未安装，请启动带 Python 依赖的本地识别服务后重试。');
}

async function extractFile(kind, filename, directory, dependencies) {
  const python = dependencies.python || await pythonRuntime();
  let stdout;
  try {
    ({ stdout } = await execute(python, [EXTRACT_SCRIPT, kind, filename, directory], {
      timeout: 60000, maxBuffer: 6 * 1024 * 1024, encoding: 'utf8', windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    }));
  } catch (error) {
    // Only the extractor's structured error is user-visible; process output may contain private text.
    try {
      const result = JSON.parse(String(error.stdout || '').trim());
      if (typeof result.error === 'string' && typeof result.code === 'string') throw failure(400, result.code, result.error);
    } catch (parsed) { if (parsed.statusCode) throw parsed; }
    if (error.killed) throw failure(504, 'EXTRACTION_TIMEOUT', '文件识别超时，请分成较小文件后重试。');
    throw failure(503, 'EXTRACTOR_UNAVAILABLE', '本机文件识别引擎暂不可用，请确认文件完整后重试。');
  }
  try { return JSON.parse(stdout.replace(/^\uFEFF/, '').trim()); }
  catch { throw failure(503, 'INVALID_EXTRACTION_RESULT', '本机文件识别结果无效，请重试。'); }
}

async function convertLegacyWord(filename, directory) {
  if (process.platform !== 'win32') throw failure(503, 'WORD_UNAVAILABLE', '旧版 DOC 需要本机 Microsoft Word，请另存为 DOCX 后上传。');
  const output = path.join(directory, 'converted.txt');
  const shell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  try {
    await execute(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', WORD_SCRIPT, '-InputPath', filename, '-OutputPath', output], {
      timeout: 45000, maxBuffer: 1024 * 1024, windowsHide: true,
    });
    const stat = await fs.stat(output);
    if (stat.size > MAX_FILE_BYTES) throw failure(413, 'DOCUMENT_TOO_LARGE', 'Word 正文过大，请分成多个文件上传。');
    return output;
  } catch (error) {
    if (error.statusCode) throw error;
    throw failure(503, 'WORD_UNAVAILABLE', '本机 Word 暂时无法读取此 DOC，请另存为 DOCX 后重新上传。');
  }
}

function recognizedResult(text, engine) {
  if (typeof text !== 'string' || !text.trim()) throw failure(422, 'NO_TEXT', '未识别到方案文字，请上传清晰原件后重试。');
  if (text.length > MAX_TEXT_CHARACTERS) throw failure(413, 'TEXT_TOO_LONG', '方案文字超过 20 万字，请分成多个文件上传。');
  return { text: text.trim(), engine, requires_confirmation: true,
    note: '已在本机读取方案；动作名称、组数、次数、时长与安排仍需对照原件核对。' };
}

async function recognizeSchemeFile(body, dependencies = {}) {
  const decoded = decodeFile(body);
  if (activeJobs >= 2) throw failure(429, 'RECOGNITION_BUSY', '正在识别其他方案，请稍后重试。');
  activeJobs += 1;
  let directory;
  try {
    const ocr = dependencies.recognizeDocument || recognizeDocument;
    if (['png', 'jpg', 'jpeg'].includes(decoded.extension)) {
      const result = await ocr(`data:image/${decoded.extension === 'png' ? 'png' : 'jpeg'};base64,${body.fileBase64}`);
      return recognizedResult(result.text, result.engine);
    }
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoshu-scheme-file-'));
    const filename = path.join(directory, `source.${decoded.extension}`);
    await fs.writeFile(filename, decoded.bytes, { flag: 'wx', mode: 0o600 });
    const converted = decoded.extension === 'doc' ? await convertLegacyWord(filename, directory) : filename;
    const extraction = await extractFile(decoded.extension === 'doc' ? 'txt' : decoded.extension, converted, directory, dependencies);
    if (decoded.extension !== 'pdf') return recognizedResult(extraction.text, decoded.extension === 'doc' ? 'local-word' : extraction.engine);
    if (!Array.isArray(extraction.pages) || extraction.pages.length > 24) throw failure(503, 'INVALID_EXTRACTION_RESULT', 'PDF 识别结果无效，请重试。');
    const pages = [];
    let usedOcr = false;
    for (const [index, page] of extraction.pages.entries()) {
      if (page.needsOcr) {
        const expected = `page-${index + 1}.png`;
        if (page.image !== expected) throw failure(503, 'INVALID_EXTRACTION_RESULT', 'PDF 页面识别结果无效，请重试。');
        const image = await fs.readFile(path.join(directory, expected));
        const result = await ocr(`data:image/png;base64,${image.toString('base64')}`);
        pages.push(result.text || '');
        usedOcr = true;
      } else pages.push(page.text || '');
      if (pages.reduce((sum, text) => sum + text.length, 0) > MAX_TEXT_CHARACTERS) throw failure(413, 'TEXT_TOO_LONG', '方案文字超过 20 万字，请分成多个文件上传。');
    }
    return recognizedResult(pages.join('\n\n'), usedOcr ? 'local-pdf-windows-ocr' : extraction.engine);
  } finally {
    // The path comes only from mkdtemp; uploaded names never enter this cleanup path.
    if (directory && path.dirname(path.resolve(directory)) === path.resolve(os.tmpdir())
      && path.basename(directory).startsWith('xiaoshu-scheme-file-')) await fs.rm(directory, { recursive: true, force: true });
    activeJobs -= 1;
  }
}

function readSchemeRequest(request) {
  const contentType = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    request.resume();
    return Promise.reject(failure(415, 'INVALID_CONTENT_TYPE', '请使用 JSON 提交方案文件。'));
  }
  if (Number(request.headers['content-length']) > MAX_REQUEST_BYTES) {
    request.resume();
    return Promise.reject(failure(413, 'REQUEST_TOO_LARGE', '方案文件需小于 20 MB。'));
  }
  return new Promise((resolve, reject) => {
    let length = 0, settled = false;
    const chunks = [];
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timeout); chunks.length = 0;
      if (error) reject(error); else resolve(value);
    };
    const timeout = setTimeout(() => { finish(failure(408, 'UPLOAD_TIMEOUT', '方案上传超时，请重试。')); request.resume(); }, 30000);
    request.on('data', chunk => {
      if (settled) return;
      length += chunk.length;
      if (length > MAX_REQUEST_BYTES) { finish(failure(413, 'REQUEST_TOO_LARGE', '方案文件需小于 20 MB。')); request.resume(); return; }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid object');
        finish(null, value);
      } catch { finish(failure(400, 'INVALID_JSON', '方案提交内容无效，请重新上传。')); }
    });
    request.on('aborted', () => finish(failure(400, 'UPLOAD_ABORTED', '方案上传已中断，请重试。')));
    request.on('error', () => finish(failure(400, 'UPLOAD_FAILED', '方案上传失败，请重试。')));
  });
}

module.exports = { MAX_FILE_BYTES, MAX_REQUEST_BYTES, FILE_TIMEOUT_MS, decodeFile, readSchemeRequest, recognizeSchemeFile };
