'use strict';

// Local OCR adapter for the browser demo. Reports never leave this computer.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execute = promisify(execFile);
const MAX_REQUEST_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const OCR_TIMEOUT_MS = 45000;
const MAX_TEXT_CHARACTERS = 20000;
const OCR_SCRIPT = path.resolve(__dirname, '../backend/life/windows_ocr.ps1');
let activeJobs = 0;

function failure(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

function jpegDimensions(bytes) {
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda || offset + 1 >= bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return length >= 8 ? { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) } : null;
    }
    offset += length;
  }
  return null;
}

function decodeImage(image) {
  if (typeof image !== 'string' || !image) {
    throw failure(400, 'IMAGE_REQUIRED', '请先选择病例单或训练方案单图片，也可以直接手动补充。');
  }
  if (image.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64) {
    throw failure(413, 'IMAGE_TOO_LARGE', '图片需小于 8 MB，请压缩后重试或手动补充。');
  }
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
  if (!match || match[2].length % 4 !== 0) {
    throw failure(400, 'INVALID_IMAGE', '请使用有效的 JPG 或 PNG 图片，也可以手动补充。');
  }
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length > MAX_IMAGE_BYTES) {
    throw failure(413, 'IMAGE_TOO_LARGE', '图片需小于 8 MB，请压缩后重试或手动补充。');
  }
  const png = match[1] === 'png' && bytes.length >= 33
    && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && bytes.subarray(12, 16).toString('ascii') === 'IHDR';
  const jpeg = match[1] === 'jpeg' && bytes.length >= 4
    && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if ((!png && !jpeg) || bytes.toString('base64') !== match[2]) {
    throw failure(400, 'INVALID_IMAGE', '图片内容或格式无效，请重新选择 JPG / PNG，或手动补充。');
  }
  const dimensions = png
    ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
    : jpegDimensions(bytes);
  if (!dimensions || !dimensions.width || !dimensions.height
    || dimensions.width > 10000 || dimensions.height > 10000
    || dimensions.width * dimensions.height > 40000000) {
    throw failure(400, 'IMAGE_DIMENSIONS', '图片分辨率过大或无效，请缩小图片后重试，也可以手动补充。');
  }
  return { bytes, extension: png ? '.png' : '.jpg' };
}

async function recognizeDocument(image) {
  const decoded = decodeImage(image);
  if (process.platform !== 'win32') {
    throw failure(503, 'OCR_UNAVAILABLE', '本机 OCR 引擎暂不可用，请手动录入并对照原件核对。');
  }
  if (activeJobs >= 2) {
    throw failure(429, 'OCR_BUSY', '正在识别其他资料，请稍后重试，也可以先手动补充。');
  }
  activeJobs += 1;
  let directory;
  let filename;
  try {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaoshu-demo-ocr-'));
    filename = path.join(directory, `document${decoded.extension}`);
    await fs.writeFile(filename, decoded.bytes, { flag: 'wx', mode: 0o600 });
    const shell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const { stdout } = await execute(shell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-File', OCR_SCRIPT, '-ImagePath', filename,
    ], { timeout: OCR_TIMEOUT_MS, maxBuffer: 1024 * 1024, encoding: 'utf8', windowsHide: true });
    const result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
    if (typeof result.text !== 'string') throw new Error('Invalid OCR response.');
    const text = result.text.slice(0, MAX_TEXT_CHARACTERS);
    return {
      text,
      lines: text.split(/\r?\n/).filter(Boolean),
      engine: 'windows-ocr',
      requires_confirmation: true,
      note: text.trim()
        ? '已在本机识别，请逐项对照原件核对；未写明的训练要求请手动补充。'
        : '未识别到清晰文字，请重新拍摄，或根据原件手动补充。',
    };
  } catch (error) {
    if (error.statusCode) throw error;
    if (error.killed || error.code === 'ETIMEDOUT') {
      throw failure(504, 'OCR_TIMEOUT', '识别超时，请重试或根据原件手动补充。');
    }
    // Do not expose PowerShell output: it may contain private report text.
    throw failure(503, 'OCR_UNAVAILABLE', '本机 OCR 暂时无法识别这张图片，请重试或手动录入并核对。');
  } finally {
    try {
      if (filename) await fs.unlink(filename);
    } finally {
      try {
        if (directory) await fs.rmdir(directory);
      } finally {
        activeJobs -= 1;
      }
    }
  }
}

function readDocumentRequest(request) {
  const contentType = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    request.resume();
    return Promise.reject(failure(415, 'INVALID_CONTENT_TYPE', '请使用 JSON 提交 JPG / PNG 图片。'));
  }
  const contentLength = Number(request.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    request.resume();
    return Promise.reject(failure(413, 'REQUEST_TOO_LARGE', '上传内容过大，请使用小于 8 MB 的图片，或手动补充。'));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    let settled = false;
    const finish = (error, body) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      chunks.length = 0;
      if (error) reject(error);
      else resolve(body);
    };
    const timeout = setTimeout(() => {
      finish(failure(408, 'UPLOAD_TIMEOUT', '上传超时，请重试或手动补充。'));
      request.resume();
    }, 15000);
    request.on('data', chunk => {
      if (settled) return;
      length += chunk.length;
      if (length > MAX_REQUEST_BYTES) {
        finish(failure(413, 'REQUEST_TOO_LARGE', '上传内容过大，请使用小于 8 MB 的图片，或手动补充。'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid JSON object.');
        finish(null, value);
      } catch {
        finish(failure(400, 'INVALID_JSON', '图片提交内容无效，请重新选择图片或手动补充。'));
      }
    });
    request.on('aborted', () => finish(failure(400, 'UPLOAD_ABORTED', '图片上传已中断，请重新选择或手动补充。')));
    request.on('error', () => finish(failure(400, 'UPLOAD_FAILED', '图片上传失败，请重试或手动补充。')));
  });
}

module.exports = { MAX_REQUEST_BYTES, MAX_IMAGE_BYTES, OCR_TIMEOUT_MS, decodeImage, readDocumentRequest, recognizeDocument };
