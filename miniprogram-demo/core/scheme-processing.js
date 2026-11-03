const documents = require('./documents');
const recognition = require('./document-recognition');
const importer = require('./scheme-import');
const active = new Map(), listeners = new Set();
function activeIds() { return Array.from(active.keys()); }
function emit() { listeners.forEach(listener => { try { listener(activeIds()); } catch (_) {} }); }
function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }
async function perform(document) {
  try {
    const current = documents.load().find(item => item.id === document.id);
    if (!current) throw Error('文件已移除，请重新上传。');
    const result = current.text ? { text: current.text, engine: current.engine || 'saved-text' }
      : await recognition.recognizeFile(Object.assign({}, current, { name: current.originalName }));
    const latest = documents.load().find(item => item.id === current.id);
    if (!latest) throw Error('文件已移除，请重新上传。');
    const text = latest.text && latest.text !== current.text ? latest.text : String(result.text || '').trim();
    if (!text) throw Error('文件中没有识别到动作文字，请查看原件后重试。');
    const saved = documents.save(Object.assign({}, latest, { text, engine: result.engine || '', status: 'recognized', error: '' }));
    const canonicalText = value => String(value || '').replace(/\r\n?/g, '\n').trim();
    const duplicate = documents.list('training').find(doc => doc.id !== saved.id && !doc.duplicateOf && doc.autoImportVersion
      && doc.originalName === saved.originalName && (doc.trainingStartDate || '') === (saved.trainingStartDate || '')
      && canonicalText(doc.text) === canonicalText(saved.text));
    const imported = importer.importDocument(duplicate || saved);
    if (!imported.importedCount) throw Error('未提取到明确动作，可核对文件文字后重新整理。');
    const planDraftRows = imported.cards.map(card => ({ id: card.sourceSchemeRow, name: card.name, groupName: card.groupName,
      sets: card.sets || '', amount: card.amount || '', mode: card.mode, notes: card.notes, frequency: card.frequencyText,
      sourceText: card.sourceText, sourceDoseText: card.sourceDoseText, warnings: card.warnings || [] }));
    const freshest = documents.load().find(item => item.id === saved.id);
    if (!freshest) throw Error('文件已移除，请重新上传。');
    documents.save(Object.assign({}, freshest, { autoImportVersion: 1, duplicateOf: duplicate ? duplicate.id : '', planDraftRows,
      importedCardCount: imported.importedCount, scheduledCount: imported.scheduledCount, pendingCount: imported.pendingCount,
      importedAt: new Date().toISOString() }));
    importer.reconcileVideos();
    return imported;
  } catch (error) {
    const latest = documents.load().find(item => item.id === document.id);
    if (latest) { try { documents.save(Object.assign({}, latest, { status: 'failed', error: error.message || '文件识别未完成' })); } catch (_) {} }
    throw error;
  }
}
function process(document) {
  if (!document || !document.id) return Promise.reject(Error('请选择有效文件'));
  const key = document.duplicateOf || document.id;
  if (active.has(key)) return active.get(key);
  const promise = Promise.resolve().then(() => perform(document)).finally(() => { active.delete(key); emit(); });
  active.set(key, promise); emit();
  return promise;
}
module.exports = { process, activeIds, subscribe };
