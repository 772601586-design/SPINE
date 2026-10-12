import { API_BASE_URL, RUNTIME_TARGET } from '../config/environment';

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

let unauthorized: (() => void) | null = null;
export function configureUnauthorizedHandler(handler: () => void): void { unauthorized = handler; }

function messageFrom(data: unknown): string {
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if (typeof record.detail === 'string') return record.detail;
    for (const value of Object.values(record)) if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  }
  return '服务暂时无法完成请求。';
}

export function request<T>(method: WxRequestOptions['method'], path: string, data?: Record<string, unknown>): Promise<T> {
  if (!API_BASE_URL) return Promise.reject(new Error('尚未配置此运行环境的 API 地址。'));
  const parsed = /^https?:\/\//.test(API_BASE_URL);
  if (!parsed || (RUNTIME_TARGET !== 'developerTool' && !API_BASE_URL.startsWith('https://'))) {
    return Promise.reject(new Error('真机和发布环境必须配置可访问的 HTTPS API 地址。'));
  }
  const token = wx.getStorageSync('spine.session.token');
  const header: Record<string, string> = { Accept: 'application/json' };
  if (data) header['Content-Type'] = 'application/json';
  if (typeof token === 'string' && token.length > 0) header.Authorization = `Token ${token}`;
  return new Promise<T>((resolve, reject) => {
    wx.request({
      url: `${API_BASE_URL.replace(/\/$/, '')}${path}`,
      method: method ?? 'GET',
      data,
      header,
      timeout: 12000,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) { resolve(response.data as T); return; }
        if (response.statusCode === 401) unauthorized?.();
        reject(new ApiError(response.statusCode, messageFrom(response.data)));
      },
      fail(error) { reject(new Error(error.errMsg || '网络连接失败，请检查 API 地址和网络后重试。')); },
    });
  });
}
