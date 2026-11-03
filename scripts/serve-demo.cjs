#!/usr/bin/env node
'use strict';

// A dependency-free browser preview of the checked-in mini-program demo.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readDocumentRequest, recognizeDocument } = require('./demo-ocr.cjs');
const { readSchemeRequest, recognizeSchemeFile } = require('./scheme-file-recognition.cjs');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const DEMO_ROOT = path.join(REPOSITORY_ROOT, 'miniprogram-demo');
const PREVIEW_ROOT = path.join(DEMO_ROOT, 'preview');
const ASSET_ROOT = path.join(DEMO_ROOT, 'assets');
const HOST = '127.0.0.1';
const DEFAULT_PORT = 4180;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function safeFile(root, relative) {
  if (relative.includes('\\') || relative.includes('\0') || relative.split('/').some(part => part === '..' || part === '.')) {
    throw Object.assign(new Error('Invalid path.'), { statusCode: 403 });
  }
  const candidate = path.resolve(root, relative);
  if (!inside(root, candidate)) throw Object.assign(new Error('Invalid path.'), { statusCode: 403 });
  // Resolve symlinks/junctions too, so static paths cannot escape their root.
  if (fs.existsSync(candidate) && !inside(fs.realpathSync(root), fs.realpathSync(candidate))) {
    throw Object.assign(new Error('Invalid path.'), { statusCode: 403 });
  }
  return candidate;
}

function readText(relative, optional = false) {
  const filename = safeFile(DEMO_ROOT, relative);
  try {
    return fs.readFileSync(filename, 'utf8');
  } catch (error) {
    if (optional && error.code === 'ENOENT') return '';
    throw error;
  }
}

function readJson(relative, optional = false) {
  const source = readText(relative, optional).replace(/^\uFEFF/, '');
  return source ? JSON.parse(source) : {};
}

function listFiles(root, prefix = '') {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...listFiles(path.join(root, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

function readPageSource(relative, extension, ancestors = []) {
  if (ancestors.includes(relative)) throw new Error('Circular page include: ' + relative);
  const source = readText(relative, extension === '.wxss');
  const expand = (_, target) => {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relative), target));
    if (!resolved.endsWith(extension)) throw new Error('Invalid page include: ' + target);
    return readPageSource(resolved, extension, ancestors.concat(relative));
  };
  return extension === '.wxml'
    ? source.replace(/<include\s+src=["']([^"']+)["']\s*\/>/g, expand)
    : source.replace(/@import\s+["']([^"']+)["']\s*;/g, expand);
}

function buildDemoBundle() {
  const config = readJson('app.json');
  const registeredPages = [...(config.pages || [])];
  for (const subpackage of config.subPackages || config.subpackages || []) {
    for (const page of subpackage.pages || []) registeredPages.push(`${subpackage.root}/${page}`);
  }
  const pages = {};
  for (const page of registeredPages) {
    pages[page] = {
      js: readText(`${page}.js`),
      wxml: readPageSource(`${page}.wxml`, '.wxml'),
      wxss: readPageSource(`${page}.wxss`, '.wxss'),
      json: readJson(`${page}.json`, true),
    };
  }
  const modules = {};
  for (const filename of listFiles(path.join(DEMO_ROOT, 'core')).filter(name => name.endsWith('.js'))) {
    const moduleName = `core/${filename}`;
    modules[moduleName] = readText(moduleName);
  }
  const bundle = { config, globalStyle: readText('app.wxss'), pages, modules };
  const hash = crypto.createHash('sha256').update(JSON.stringify(bundle));
  // The preview shell itself also participates in live reload while being edited.
  for (const filename of listFiles(PREVIEW_ROOT)) {
    hash.update(`\0preview/${filename}\0`);
    hash.update(fs.readFileSync(safeFile(PREVIEW_ROOT, filename)));
  }
  return { ...bundle, version: hash.digest('hex') };
}

function loopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function localAuthority(authority) {
  try {
    const url = new URL(`http://${authority}`);
    return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function respond(request, response, status, contentType, body, extraHeaders = {}) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
  response.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
    ...extraHeaders,
  });
  response.end(request.method === 'HEAD' ? undefined : buffer);
}

function json(request, response, status, value, extraHeaders) {
  respond(request, response, status, MIME_TYPES['.json'], JSON.stringify(value), extraHeaders);
}

function createDemoServer() {
  return http.createServer(async (request, response) => {
    try {
      if (!loopback(request.socket.remoteAddress) || !localAuthority(request.headers.host || '')) {
        return json(request, response, 403, { error: 'This preview is available on loopback only.' });
      }
      // Inspect the original path before URL normalization can remove traversal.
      let pathname;
      try {
        pathname = decodeURIComponent(request.url.split('?')[0]);
      } catch {
        return json(request, response, 400, { error: 'Malformed URL encoding.' });
      }
      if (!pathname.startsWith('/') || pathname.startsWith('//') || pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(part => part === '..' || part === '.')) {
        return json(request, response, 403, { error: 'Invalid path.' });
      }
      if (pathname === '/api/recognize-document') {
        if (request.method !== 'POST') {
          return json(request, response, 405, { error: '请使用 POST 提交待识别图片。' }, { Allow: 'POST' });
        }
        if ((request.headers.origin && request.headers.origin !== `http://${request.headers.host}`)
          || request.headers['sec-fetch-site'] === 'cross-site') {
          request.resume();
          return json(request, response, 403, { error: '请在当前本地 Demo 中选择图片进行识别。', code: 'INVALID_ORIGIN' });
        }
        try {
          const body = await readDocumentRequest(request);
          const result = await recognizeDocument(body.image);
          return json(request, response, 200, result);
        } catch (error) {
          return json(request, response, error.statusCode || 503, {
            error: error.statusCode ? error.message : '本机 OCR 暂不可用，请手动补充并核对原件。',
            code: error.statusCode ? error.code : 'OCR_UNAVAILABLE',
          });
        }
      }
      if (pathname === '/api/recognize-scheme') {
        if (request.method !== 'POST') {
          return json(request, response, 405, { error: '请使用 POST 提交方案文件。' }, { Allow: 'POST' });
        }
        if ((request.headers.origin && request.headers.origin !== `http://${request.headers.host}`)
          || request.headers['sec-fetch-site'] === 'cross-site') {
          request.resume();
          return json(request, response, 403, { error: '请在当前本地 Demo 中选择方案进行识别。', code: 'INVALID_ORIGIN' });
        }
        try {
          const body = await readSchemeRequest(request);
          const result = await recognizeSchemeFile(body);
          return json(request, response, 200, result);
        } catch (error) {
          return json(request, response, error.statusCode || 503, {
            error: error.statusCode ? error.message : '本机文件识别暂不可用，请重试。',
            code: error.statusCode ? error.code : 'RECOGNITION_UNAVAILABLE',
          });
        }
      }
      if (!['GET', 'HEAD'].includes(request.method)) {
        return json(request, response, 405, { error: 'Use GET or HEAD.' }, { Allow: 'GET, HEAD' });
      }
      if (pathname === '/api/demo' || pathname === '/api/version') {
        const bundle = buildDemoBundle();
        return json(request, response, 200, pathname === '/api/demo' ? bundle : { version: bundle.version });
      }
      let root;
      let relative;
      if (pathname === '/') {
        root = PREVIEW_ROOT;
        relative = 'index.html';
      } else if (pathname.startsWith('/preview/')) {
        root = PREVIEW_ROOT;
        relative = pathname.slice('/preview/'.length);
      } else if (pathname.startsWith('/assets/')) {
        root = ASSET_ROOT;
        relative = pathname.slice('/assets/'.length);
      } else {
        return json(request, response, 404, { error: 'Not found.' });
      }
      const filename = safeFile(root, relative);
      if (!fs.statSync(filename).isFile()) return json(request, response, 404, { error: 'Not found.' });
      return respond(request, response, 200, MIME_TYPES[path.extname(filename).toLowerCase()] || 'application/octet-stream', fs.readFileSync(filename));
    } catch (error) {
      const status = error.statusCode || (['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 500);
      return json(request, response, status, { error: status === 500 ? `Could not read demo: ${error.message}` : status === 403 ? 'Invalid path.' : 'Not found.' });
    }
  });
}

function requestedPort(args = process.argv.slice(2)) {
  let value = process.env.PORT || DEFAULT_PORT;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--port') value = args[++i];
    else if (args[i].startsWith('--port=')) value = args[i].slice('--port='.length);
    else throw new Error(`Unknown option: ${args[i]}`);
  }
  const port = Number(value);
  if (!/^\d+$/.test(String(value)) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Port must be an integer from 1 to 65535.');
  }
  return port;
}

if (require.main === module) {
  try {
    const port = requestedPort();
    const server = createDemoServer();
    server.on('error', error => {
      console.error(error.code === 'EADDRINUSE'
        ? `Port ${port} is already in use. Try: node scripts/serve-demo.cjs --port ${port + 1}`
        : `Could not start demo preview: ${error.message}`);
      process.exitCode = 1;
    });
    server.listen(port, HOST, () => {
      console.log(`Demo preview ready: http://${HOST}:${port}/`);
      console.log('Source: miniprogram-demo (reads current files on every request). Press Ctrl+C to stop.');
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { buildDemoBundle, createDemoServer, requestedPort };
