import { LOCAL_RECORDING_PREFIX, MAX_RECORDING_BYTES } from '../config/local-recordings';
import { getCurrentUser } from './session';

export interface LocalRecording {
  id: string; title: string; filePath: string; createdAt: string;
  duration: number; size: number; cardId: number | null;
  kind: 'demonstration' | 'practice';
}
export interface RecordingView extends LocalRecording { available: boolean }

function accountId(): number {
  const id = getCurrentUser()?.id;
  if (!id) throw new Error('请先登录，再管理本机录像。');
  return id;
}
function directory(owner: number): string { return `${wx.env.USER_DATA_PATH}/spine-recordings/${owner}`; }
function key(owner: number): string { return LOCAL_RECORDING_PREFIX + owner; }
function valid(value: unknown, owner: number): value is LocalRecording {
  if (!value || typeof value !== 'object') return false;
  const item = value as LocalRecording;
  return typeof item.id === 'string' && /^\d+-[a-f0-9]+$/.test(item.id)
    && typeof item.filePath === 'string'
    && ['mp4', 'mov', 'm4v'].some(ext => item.filePath === `${directory(owner)}/${item.id}.${ext}`)
    && typeof item.title === 'string' && typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt))
    && Number.isFinite(item.size) && item.size > 0 && Number.isFinite(item.duration) && item.duration >= 0
    && (item.kind === undefined || item.kind === 'demonstration' || item.kind === 'practice')
    && (item.cardId === null || (Number.isInteger(item.cardId) && item.cardId > 0));
}
function read(owner: number): LocalRecording[] {
  const stored = wx.getStorageSync(key(owner));
  if (!stored) return [];
  if (!Array.isArray(stored) || !stored.every(item => valid(item, owner))) {
    throw new Error('本机录像目录无法读取，请保留缓存并稍后重试。');
  }
  // Clips created before role separation remain demonstrations; their files are unchanged.
  return (stored as LocalRecording[]).map(item => ({ ...item, kind: item.kind || 'demonstration' }));
}
function assertAccount(owner: number): void {
  if (accountId() !== owner) throw new Error('登录账号已变化，请重新打开录像列表。');
}
function exists(filePath: string): Promise<boolean> {
  return new Promise(resolve => wx.getFileSystemManager().access({ path: filePath,
    success: () => resolve(true), fail: () => resolve(false) }));
}
function unlink(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => wx.getFileSystemManager().unlink({ filePath,
    success: () => resolve(), fail: () => reject(new Error('本机文件未能删除，请重试。')) }));
}

export async function listRecordings(cardId?: number): Promise<RecordingView[]> {
  const owner = accountId();
  const records = read(owner).filter(item => cardId === undefined || item.cardId === cardId);
  const result = await Promise.all(records.map(async item => ({ ...item, available: await exists(item.filePath) })));
  assertAccount(owner);
  return result;
}

export async function saveRecording(file: WxMediaFile, title: string,
  options: { kind?: LocalRecording['kind']; cardId?: number } = {}): Promise<LocalRecording> {
  const owner = accountId();
  const kind = options.kind || 'demonstration';
  if (kind !== 'demonstration' && kind !== 'practice') throw new Error('请选择有效的录像用途。');
  if (options.cardId !== undefined && (!Number.isInteger(options.cardId) || options.cardId <= 0)) throw new Error('请选择有效的动作卡片。');
  if (!file.tempFilePath || !Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_RECORDING_BYTES) {
    throw new Error('请选择有效录像，单段不能超过 50 MB。');
  }
  const fs = wx.getFileSystemManager();
  const folder = directory(owner);
  if (!await exists(folder)) {
    await new Promise<void>((resolve, reject) => fs.mkdir({ dirPath: folder, recursive: true,
      success: () => resolve(), fail: () => reject(new Error('无法建立本机录像目录，请检查可用空间。')) }));
  }
  const id = `${Date.now()}-${Math.random().toString(16).slice(2) || '0'}`;
  const ext = /\.(mp4|mov|m4v)(?:\?|$)/i.exec(file.tempFilePath)?.[1].toLowerCase() || 'mp4';
  const filePath = `${folder}/${id}.${ext}`;
  await new Promise<void>((resolve, reject) => fs.copyFile({ srcPath: file.tempFilePath, destPath: filePath,
    success: () => resolve(), fail: () => reject(new Error('录像未能保存，请检查本机可用空间后重试。')) }));
  try {
    assertAccount(owner);
    const createdAt = new Date().toISOString();
    const recording: LocalRecording = { id, filePath, createdAt, size: file.size,
      title: title.trim().slice(0, 80) || (kind === 'practice' ? '我的练习录像' : '未命名现场示范'), kind,
      duration: typeof file.duration === 'number' && Number.isFinite(file.duration) ? Math.max(0, file.duration) : 0,
      cardId: options.cardId ?? null };
    wx.setStorageSync(key(owner), [recording, ...read(owner)]);
    return recording;
  } catch (error) {
    await unlink(filePath).catch(() => undefined);
    throw error;
  }
}

export async function matchRecording(id: string, cardId: number | null): Promise<void> {
  const owner = accountId();
  if (cardId !== null && (!Number.isInteger(cardId) || cardId <= 0)) throw new Error('请选择有效的动作卡片。');
  const recording = read(owner).find(item => item.id === id);
  if (!recording) throw new Error('这段录像已移除，请重新加载。');
  if (cardId !== null && !await exists(recording.filePath)) throw new Error('录像文件已不在本机，请重新录制。');
  assertAccount(owner);
  // Read again after async work so changes to other clips are not overwritten.
  const records = read(owner);
  if (!records.some(item => item.id === id)) throw new Error('这段录像已移除，请重新加载。');
  wx.setStorageSync(key(owner), records.map(item => item.id === id ? { ...item, cardId } : item));
}

export async function removeRecording(id: string): Promise<void> {
  const owner = accountId();
  const item = read(owner).find(recording => recording.id === id);
  if (!item) return;
  if (await exists(item.filePath)) await unlink(item.filePath);
  assertAccount(owner);
  wx.setStorageSync(key(owner), read(owner).filter(recording => recording.id !== id));
}
