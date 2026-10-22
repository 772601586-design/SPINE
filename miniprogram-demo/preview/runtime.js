/* Browser host for the actual mini-program sources; no duplicated page implementation. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const content = $('app-content');
  const PREFIX = 'xiaoshu.browser-demo:';
  let bundle, stack = [], version = '', pending = false, definition = null, navigating = 0, composing = false;
  let moduleCache = new Map(), templateCache = new Map(), expressionCache = new Map();
  const mediaFiles = new Map(), temporaryFiles = new Map();
  let database;
  const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const normal = value => {
    const parts = [];
    value.split('/').forEach(part => { if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part); });
    return parts.join('/');
  };
  const current = () => stack[stack.length - 1];
  const rpx = value => String(value).replace(/(-?\d+(?:\.\d+)?)rpx\b/g, (_, n) => `calc(${n} * var(--rpx))`);
  const tabIconPaths = {
    'pages/planning/index': '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 7h8M8 12h8M8 17h5"/>',
    'pages/train/index': '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    'pages/growth/index': '<path d="M4 3v17h17M7 15l4-5 4 3 5-7"/>',
    'pages/community/index': '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 13a5 5 0 0 1 3 5v3"/>',
    'pages/me/index': '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  };
  function createTabIcon(tab, selected) {
    if (tabIconPaths[tab.pagePath]) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', width: '23', height: '23', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(name, value);
      svg.innerHTML = tabIconPaths[tab.pagePath];
      return svg;
    }
    const img = document.createElement('img');
    img.src = '/' + (selected ? tab.selectedIconPath : tab.iconPath); img.alt = '';
    return img;
  }
  const css = source => rpx(source.replace(/\/\*[\s\S]*?\*\//g, '')).replace(/(^|})([^{}]+){/g, (_, prefix, selectors) => prefix + selectors.split(',').map(selector => {
    const converted = selector.trim().replace(/(^|[\s>+~])(page|view|text)(?![\w-])/g, (_, lead, tag) => lead + ({ page: '.miniapp', view: '.wx-view', text: '.wx-text' })[tag]);
    return converted.startsWith('.miniapp') ? converted : '.miniapp ' + converted;
  }).join(',') + '{');
  function report(error) {
    console.error(error);
    $('runtime-error').hidden = false;
    $('runtime-error').textContent = '预览遇到问题：' + error.message;
  }
  function notify(message) {
    $('toast').textContent = message;
    $('toast').classList.add('visible');
    clearTimeout(notify.timer);
    notify.timer = setTimeout(() => $('toast').classList.remove('visible'), 2400);
  }
  function value(expression, scope) {
    try {
      if (!expressionCache.has(expression)) expressionCache.set(expression, new Function('scope', `with(scope){return (${expression});}`));
      return expressionCache.get(expression)(scope);
    } catch { return undefined; }
  }
  function interpolate(raw, scope) {
    if (raw === null || raw === undefined) return '';
    const exact = raw.match(/^\s*{{([\s\S]*?)}}\s*$/);
    if (exact && !exact[1].includes('{{') && !exact[1].includes('}}')) return value(exact[1], scope);
    return raw.replace(/{{([\s\S]*?)}}/g, (_, expression) => {
      const result = value(expression, scope);
      return result == null ? '' : String(result);
    });
  }
  function requireModule(filename) {
    filename = normal(filename);
    if (!filename.endsWith('.js')) filename += '.js';
    if (moduleCache.has(filename)) return moduleCache.get(filename).exports;
    const source = bundle.modules[filename];
    if (source === undefined) throw Error('无法载入模块 ' + filename);
    const module = { exports: {} };
    moduleCache.set(filename, module);
    execute(source, filename, module);
    return module.exports;
  }
  function execute(source, filename, module = { exports: {} }) {
    const base = filename.slice(0, filename.lastIndexOf('/') + 1);
    const localRequire = name => requireModule(name.startsWith('.') ? base + name : name);
    new Function('require', 'module', 'exports', 'Page', 'App', 'wx', 'getCurrentPages', source + '\n//# sourceURL=demo-source/' + filename)(
      localRequire, module, module.exports, item => { definition = item; }, () => {}, wx, () => stack);
  }
  function queueRender(page) {
    if (page !== current() || pending || composing) return;
    pending = true;
    queueMicrotask(() => { pending = false; try { render(); } catch (error) { report(error); } });
  }
  function dispatch(page, handler, dataset, event, type, detail) {
    if (!handler || typeof page[handler] !== 'function') return;
    try {
      page[handler]({ type, detail: detail || { value: event.target.value }, currentTarget: { dataset },
        target: { dataset, value: event.target.value } });
    } catch (error) { report(error); }
  }
  function template(route) {
    if (templateCache.has(route)) return templateCache.get(route);
    const raw = bundle.pages[route].wxml
      .replace(/<(view|text|block|image|picker|textarea|video|wxs)(\b[^>]*?)\/>/g, '<$1$2></$1>');
    const el = document.createElement('template');
    el.innerHTML = raw;
    templateCache.set(route, el.content);
    return el.content;
  }
  function children(nodes, scope, parent, key, page) {
    let branch = false, chain = false;
    Array.from(nodes).forEach((node, i) => {
      if (node.nodeType === 8) return;
      if (node.nodeType === 3) {
        if (node.textContent.trim()) { chain = false; parent.append(document.createTextNode(interpolate(node.textContent, scope) ?? '')); }
        return;
      }
      if (node.nodeType !== 1) return;
      if (node.hasAttribute('wx:if')) {
        branch = !!interpolate(node.getAttribute('wx:if'), scope); chain = true;
        if (!branch) return;
      } else if (node.hasAttribute('wx:elif')) {
        const show = chain && !branch && !!interpolate(node.getAttribute('wx:elif'), scope);
        branch = branch || show;
        if (!show) return;
      } else if (node.hasAttribute('wx:else')) {
        const show = chain && !branch; branch = true;
        if (!show) return;
      } else chain = false;
      append(node, scope, parent, key + '.' + i, page);
    });
  }
  function append(node, scope, parent, key, page, looped = false) {
    if (node.hasAttribute('wx:for') && !looped) {
      const list = interpolate(node.getAttribute('wx:for'), scope) || [];
      const entries = Array.isArray(list) ? list.map((v, i) => [i, v]) : Object.entries(list);
      entries.forEach(([index, item]) => {
        const nested = Object.create(scope);
        nested[node.getAttribute('wx:for-item') || 'item'] = item;
        nested[node.getAttribute('wx:for-index') || 'index'] = index;
        append(node, nested, parent, key + ':' + index, page, true);
      });
      return;
    }
    const tag = node.tagName.toLowerCase();
    if (tag === 'wxs') return;
    if (tag === 'block') { children(node.childNodes, scope, parent, key, page); return; }
    const el = document.createElement(({ view: 'div', text: 'span', image: 'img', picker: 'div' })[tag] || tag);
    el.className = 'wx-' + tag;
    el.dataset.previewKey = key;
    const dataset = {};
    for (const attr of node.attributes) {
      const name = attr.name;
      if (name.startsWith('wx:') || name.startsWith('bind') || name.startsWith('catch') || ['range', 'range-key', 'mode', 'placeholder-style'].includes(name)) continue;
      const v = interpolate(attr.value, scope);
      if (name === 'class') { if (v) el.className += ' ' + v; }
      else if (name === 'style') el.setAttribute(name, rpx(v || ''));
      else if (name.startsWith('data-')) {
        const field = name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
        dataset[field] = v; el.dataset[field] = v ?? '';
      } else if (['disabled', 'controls', 'autoplay', 'loop', 'muted', 'readonly'].includes(name)) {
        if (v !== false && v !== null && v !== undefined && v !== 'false') el.setAttribute(name, '');
      } else if (name === 'src') el.src = mediaFiles.get(v)?.url || v || '';
      else if (name === 'value') { if (tag !== 'picker') el.value = v ?? ''; }
      else if (name !== 'loading' && name !== 'hover-class') el.setAttribute(name, v ?? '');
    }
    const tap = interpolate(node.getAttribute('bindtap') || node.getAttribute('catchtap'), scope);
    if (tap) {
      el.onclick = event => { event.stopPropagation(); dispatch(page, tap, dataset, event, 'tap'); };
      if (!['button','input','textarea','select'].includes(tag)) {
        el.role = node.getAttribute('aria-role') || 'button'; el.tabIndex = 0;
        el.onkeydown = event => { if (event.target === event.currentTarget && ['Enter',' '].includes(event.key)) { event.preventDefault(); event.currentTarget.click(); } };
      }
    }
    if (tag === 'input' || tag === 'textarea') {
      const label = el.placeholder || node.previousElementSibling?.textContent || dataset.field || '填写内容';
      el.setAttribute('aria-label', interpolate(label, scope));
      el.oninput = event => dispatch(page, interpolate(node.getAttribute('bindinput'), scope), dataset, event, 'input');
      el.onchange = event => dispatch(page, interpolate(node.getAttribute('bindchange'), scope), dataset, event, 'change');
    }
    if (tag !== 'image' && tag !== 'input') children(node.childNodes, scope, el, key, page);
    if (tag === 'picker') {
      const mode = node.getAttribute('mode'), picker = document.createElement(mode === 'date' ? 'input' : 'select');
      picker.className = 'preview-picker';
      picker.dataset.previewKey = key + '.picker';
      picker.setAttribute('aria-label', el.textContent.trim() || '选择');
      if (mode === 'date') { picker.type = 'date'; picker.value = interpolate(node.getAttribute('value'), scope) || ''; }
      else {
        const range = interpolate(node.getAttribute('range'), scope) || [], field = node.getAttribute('range-key');
        range.forEach((item, index) => { const option = document.createElement('option'); option.value = index; option.textContent = field ? item[field] : item; picker.append(option); });
        picker.value = interpolate(node.getAttribute('value'), scope) ?? 0;
      }
      picker.onchange = event => dispatch(page, interpolate(node.getAttribute('bindchange'), scope), dataset, event, 'change');
      el.append(picker);
    }
    if (tag === 'video') el.playsInline = true;
    parent.append(el);
  }
  function patchChildren(parent, incoming) {
    const wanted = Array.from(incoming);
    wanted.forEach((next, index) => {
      let old = parent.childNodes[index];
      const key = next.nodeType === 1 ? next.dataset.previewKey : null;
      if (key && old?.dataset?.previewKey !== key) {
        const match = Array.from(parent.children).find(child => child.dataset.previewKey === key);
        if (match) { parent.insertBefore(match, old || null); old = match; }
      }
      if (!old) { parent.append(next); return; }
      if (old.nodeType !== next.nodeType || old.nodeName !== next.nodeName || (key && old.dataset.previewKey !== key)) {
        parent.replaceChild(next, old); return;
      }
      if (next.nodeType === 3) { if (old.textContent !== next.textContent) old.textContent = next.textContent; return; }
      const formValue = next.value;
      Array.from(old.attributes).forEach(attr => { if (!next.hasAttribute(attr.name)) old.removeAttribute(attr.name); });
      Array.from(next.attributes).forEach(attr => { if (old.getAttribute(attr.name) !== attr.value) old.setAttribute(attr.name, attr.value); });
      for (const event of ['onclick','onkeydown','oninput','onchange']) old[event] = next[event];
      if (['INPUT','TEXTAREA'].includes(next.nodeName) && old.value !== next.value) old.value = next.value;
      patchChildren(old, next.childNodes);
      if (next.nodeName === 'SELECT') old.value = formValue;
    });
    while (parent.childNodes.length > wanted.length) parent.lastChild.remove();
  }
  function render() {
    const page = current(); if (!page) return;
    const active = document.activeElement;
    const focused = content.contains(active) ? { key: active.dataset.previewKey, start: active.selectionStart, end: active.selectionEnd } : null;
    const scroll = content.scrollTop, fragment = document.createDocumentFragment();
    children(template(page.route).childNodes, page.data, fragment, page.route, page);
    patchChildren(content, fragment.childNodes);
    content.scrollTop = scroll;
    if (focused) {
      const replacement = content.querySelector(`[data-preview-key="${CSS.escape(focused.key)}"]`);
      if (replacement) { replacement.focus({ preventScroll: true }); try { replacement.setSelectionRange(focused.start, focused.end); } catch {} }
    }
    const info = bundle.pages[page.route].json || {};
    $('native-nav').style.backgroundColor = info.navigationBarBackgroundColor || bundle.config.window.navigationBarBackgroundColor;
    $('nav-title').textContent = info.navigationBarTitleText || '小树';
    $('nav-back').hidden = stack.length < 2;
    $('preview-route').textContent = 'miniprogram-demo/' + page.route + '.wxml';
    $('global-style').textContent = css(bundle.globalStyle);
    $('page-style').textContent = css(bundle.pages[page.route].wxss || '');
    document.querySelectorAll('[data-route]').forEach(item => {
      const selected = item.dataset.route.split('?')[0].replace(/^\//,'') === page.route;
      item.classList.remove('is-active'); item.classList.toggle('active', selected);
      if (selected) item.setAttribute('aria-current', 'page'); else item.removeAttribute('aria-current');
    });
    const tabs = bundle.config.tabBar.list;
    $('tabbar').hidden = !tabs.some(tab => tab.pagePath === page.route);
    $('tabbar').replaceChildren(...tabs.map(tab => {
      const button = document.createElement('button'), selected = tab.pagePath === page.route;
      button.className = selected ? 'active' : '';
      button.setAttribute('aria-label', tab.text);
      button.setAttribute('aria-current', selected ? 'page' : 'false');
      const label = document.createElement('span'); label.textContent = tab.text;
      button.append(createTabIcon(tab, selected),label); button.addEventListener('click', () => navigate('/' + tab.pagePath, 'tab')); return button;
    }));
    document.title = '小树 Demo · ' + $('nav-title').textContent;
  }
  function leave(page, unload = false) {
    if (!page) return;
    page.onHide?.();
    if (unload) page.onUnload?.();
  }
  function navigate(url, mode = 'push') {
    try {
      const parsed = new URL(url, location.origin), route = normal(parsed.pathname);
      if (!bundle.pages[route]) throw Error('未注册的页面：' + route);
      const token = ++navigating;
      const previous = current(); if (previous) previous.scroll = content.scrollTop;
      if (mode === 'tab' || mode === 'reset') { stack.forEach(page => leave(page, true)); stack = []; }
      else { leave(previous, mode === 'replace'); if (mode === 'replace') stack.pop(); }
      definition = null;
      execute(bundle.pages[route].js, route + '.js');
      if (!definition) throw Error('页面未调用 Page：' + route);
      const page = Object.assign({}, definition, { route, data: copy(definition.data || {}), options: Object.fromEntries(parsed.searchParams), scroll: 0 });
      page.setData = (patch, callback) => { Object.assign(page.data, patch); queueRender(page); if (callback) queueMicrotask(callback); };
      stack.push(page);
      $('runtime-error').hidden = true;
      location.hash = '/' + route + parsed.search;
      page.onLoad?.(page.options);
      if (token !== navigating) return;
      page.onShow?.();
      render(); content.scrollTop = 0;
      page.onReady?.();
    } catch (error) { report(error); }
  }
  function back(delta = 1) {
    if (stack.length < 2) { navigate('/pages/planning/index','tab'); return; }
    ++navigating;
    while (delta-- > 0 && stack.length > 1) leave(stack.pop(), true);
    const page = current(); page.onShow?.(); render(); content.scrollTop = page.scroll || 0;
    const query = new URLSearchParams(page.options).toString(); location.hash = '/' + page.route + (query ? '?' + query : '');
  }
  async function openFiles() {
    try {
      database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('xiaoshu-browser-demo-media',1);
        request.onupgradeneeded = () => request.result.createObjectStore('files');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const transaction = database.transaction('files'), request = transaction.objectStore('files').openCursor();
        request.onsuccess = () => { const cursor = request.result; if (cursor) { mediaFiles.set(cursor.key,{ blob:cursor.value,url:URL.createObjectURL(cursor.value) }); cursor.continue(); } else resolve(); };
        request.onerror = () => reject(request.error);
      });
    } catch (error) { notify('浏览器媒体存储不可用，请在开发者工具中录制。'); console.warn(error); }
  }
  function chooseMedia(options) {
    const input = document.createElement('input'); input.type = 'file'; input.accept = options.mediaType?.includes('video') ? 'video/*' : 'image/*';
    if (options.sourceType?.length === 1 && options.sourceType[0] === 'camera') input.setAttribute('capture','environment');
    input.onchange = () => {
      const file = input.files[0]; if (!file) return;
      const path = URL.createObjectURL(file); temporaryFiles.set(path,file);
      options.success?.({ tempFiles:[{ tempFilePath:path,size:file.size,fileType:file.type.startsWith('video')?'video':'image' }] });
      input.remove();
    };
    input.addEventListener('cancel', () => { options.fail?.({errMsg:'chooseMedia:fail cancel'}); input.remove(); });
    input.hidden = true; document.body.append(input); input.click();
  }
  const wx = {
    getStorageSync:key=>copy(JSON.parse(localStorage.getItem(PREFIX+key)||'null')),
    setStorageSync:(key,data)=>localStorage.setItem(PREFIX+key,JSON.stringify(data)),
    removeStorageSync:key=>localStorage.removeItem(PREFIX+key),
    nextTick:fn=>queueMicrotask(fn),
    navigateTo:o=>navigate(o.url), redirectTo:o=>navigate(o.url,'replace'), switchTab:o=>navigate(o.url,'tab'), reLaunch:o=>navigate(o.url,'reset'),
    navigateBack:(o={})=>back(o.delta||1), showToast:o=>notify(o.title),
    showModal(options) {
      const dialog = document.createElement('dialog'), heading = document.createElement('h2'), body = document.createElement('p'), cancel = document.createElement('button'), confirm = document.createElement('button');
      heading.textContent = options.title || '提示'; body.textContent = options.content || ''; cancel.textContent = options.cancelText || '取消'; confirm.textContent = options.confirmText || '确定';
      const finish = result => { options.success?.({confirm:result,cancel:!result}); dialog.close(); dialog.remove(); };
      cancel.onclick = () => finish(false); confirm.onclick = () => finish(true); dialog.oncancel = event => { event.preventDefault(); finish(false); };
      dialog.append(heading,body,cancel,confirm); document.body.append(dialog); dialog.showModal();
    },
    setClipboardData: async o=>{ try { await navigator.clipboard.writeText(o.data); notify('汇总已复制'); o.success?.({}); } catch { notify('复制失败，可直接选择汇总文字复制'); o.fail?.({}); } },
    async recognizeDocument(options) {
      try {
        const blob = mediaFiles.get(options.path)?.blob || temporaryFiles.get(options.path);
        if (!blob) throw Error('原件无法读取，请重新选择图片。');
        if (blob.size > 8 * 1024 * 1024) throw Error('图片超过8MB，请压缩或分成单页后重试。');
        const image = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
        const response = await fetch('/api/recognize-document', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }), signal: AbortSignal.timeout(50000) });
        const result = await response.json();
        if (!response.ok) throw Error(result.error || '识别未完成，请重试或手动校对。');
        options.success?.(result);
      } catch (error) { options.fail?.({ message: error.name === 'TimeoutError' ? '识别用时较长，请重试或手动校对。' : error.message }); }
    },
    async recognizeSchemeFile(options) {
      try {
        const blob = mediaFiles.get(options.path)?.blob || temporaryFiles.get(options.path);
        if (!blob) throw Error('方案原件无法读取，请重新选择文件。');
        if (blob.size > 20 * 1024 * 1024) throw Error('方案文件需小于 20 MB，请压缩或分成多个文件。');
        const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
        const fileBase64 = String(dataUrl).slice(String(dataUrl).indexOf(',') + 1);
        const response = await fetch('/api/recognize-scheme', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileBase64, name: options.name, extension: options.extension }), signal: AbortSignal.timeout(180000) });
        const result = await response.json();
        if (!response.ok) throw Error(result.error || '方案识别未完成，请重试。');
        options.success?.(result);
      } catch (error) { options.fail?.({ message: error.name === 'TimeoutError' ? '方案识别用时较长，请重试。' : error.message }); }
    },
    chooseMessageFile(options) {
      const input = document.createElement('input'); input.type = 'file';
      if (Array.isArray(options.extension)) input.accept = options.extension.map(extension => '.' + String(extension).replace(/^\./, '')).join(',');
      input.onchange = () => {
        const file = input.files[0];
        if (!file) { options.fail?.({ errMsg: 'chooseMessageFile:fail cancel' }); input.remove(); return; }
        const path = URL.createObjectURL(file); temporaryFiles.set(path, file);
        options.success?.({ tempFiles: [{ path, name: file.name, size: file.size, type: file.type }] }); input.remove();
      };
      input.addEventListener('cancel', () => { options.fail?.({ errMsg: 'chooseMessageFile:fail cancel' }); input.remove(); });
      input.hidden = true; document.body.append(input); input.click();
    },
    chooseMedia,
    previewImage:o=>{ const dialog=document.createElement('dialog'),img=document.createElement('img'),close=document.createElement('button');img.src=mediaFiles.get(o.current)?.url||o.current;img.style.maxWidth='80vw';close.textContent='关闭';close.onclick=()=>{dialog.close();dialog.remove();};dialog.append(img,close);document.body.append(dialog);dialog.showModal(); },
    env:{USER_DATA_PATH:'/__demo_files__'},
    getFileSystemManager:()=>({readFile(options) {
      const blob=temporaryFiles.get(options.filePath)||mediaFiles.get(options.filePath)?.blob;
      if (!blob) { options.fail?.({errMsg:'原件无法读取'}); return; }
      const reader=new FileReader();reader.onerror=()=>options.fail?.({errMsg:'原件无法读取'});
      reader.onload=()=>options.success?.({data:options.encoding==='base64'?String(reader.result).split(',')[1]:reader.result});
      if (options.encoding==='base64') reader.readAsDataURL(blob); else if (options.encoding) reader.readAsText(blob,options.encoding); else reader.readAsArrayBuffer(blob);
    },copyFile(options) {
      const blob=temporaryFiles.get(options.srcPath)||mediaFiles.get(options.srcPath)?.blob;
      if (!blob||!database) { options.fail?.({errMsg:'无法保存媒体文件'}); return; }
      const tx=database.transaction('files','readwrite');tx.objectStore('files').put(blob,options.destPath);
      tx.oncomplete=()=>{mediaFiles.set(options.destPath,{blob,url:URL.createObjectURL(blob)});options.success?.({});};tx.onerror=()=>options.fail?.({errMsg:'媒体存储失败'});
    }}),
    createInnerAudioContext() {
      const audio=new Audio();return {get src(){return audio.src;},set src(v){audio.src=v;},play(){audio.play().catch(()=>notify('请点击页面后再开启语音'));},stop(){audio.pause();audio.currentTime=0;},destroy(){audio.pause();audio.removeAttribute('src');audio.load();},onEnded(fn){audio.onended=fn;},onError(fn){audio.onerror=fn;}};
    }
  };
  content.addEventListener('compositionstart', () => { composing = true; });
  content.addEventListener('compositionend', () => { composing = false; queueRender(current()); });
  document.addEventListener('click',event=>{
    const link=event.target.closest('[data-route]');if(link){const tab=bundle?.config.tabBar.list.some(t=>'/'+t.pagePath===link.dataset.route);navigate(link.dataset.route,tab?'tab':'push');}
    const width=event.target.closest('[data-width]');if(width){$('phone').style.setProperty('--phone-width',width.dataset.width+'px');document.querySelectorAll('[data-width]').forEach(b=>{b.classList.remove('is-active');b.classList.toggle('active',b===width);b.setAttribute('aria-pressed',String(b===width));});}
  });
  new ResizeObserver(() => content.style.setProperty('--rpx', (content.clientWidth / 750) + 'px')).observe(content);
  $('nav-back').onclick=()=>back();$('reload-demo').onclick=()=>location.reload();
  async function boot() {
    try {
      const response=await fetch('/api/demo');if(!response.ok)throw Error('页面源文件加载失败');bundle=await response.json();
      await openFiles();version=(await (await fetch('/api/version')).json()).version;
      navigate(location.hash.slice(1)||'/pages/planning/index','reset');
      setInterval(async()=>{try{const next=await(await fetch('/api/version')).json();if(next.version!==version){notify('源文件已更新，正在刷新');setTimeout(()=>location.reload(),250);}}catch{}},1500);
    } catch(error){report(error);}
  }
  window.addEventListener('beforeunload',()=>stack.forEach(page=>leave(page,true)));
  window.addEventListener('hashchange',()=>{const route=location.hash.slice(1);if(route&&normal(route.split('?')[0])!==current()?.route)navigate(route,'tab');});
  boot();
})();
