import { API_BASE_URL, RUNTIME_TARGET } from '../config/environment';

/** 后端统一错误包（规格 v2.0 §14）：{error:{code,message,field_errors?,request_id}} */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly fieldErrors?: Record<string, string[]>,
    public readonly requestId?: string,
  ) {
    super(message);
  }
}

let unauthorized: (() => void) | null = null;
export function configureUnauthorizedHandler(handler: () => void): void { unauthorized = handler; }

interface ErrorEnvelope {
  error?: { code?: string; message?: string; field_errors?: Record<string, string[]>; request_id?: string };
}

function parseError(statusCode: number, payload: unknown): ApiError {
  const envelope = (payload ?? {}) as ErrorEnvelope;
  const error = envelope.error;
  if (error && typeof error.message === 'string') {
    return new ApiError(statusCode, error.message, error.code, error.field_errors, error.request_id);
  }
  // 兼容尚未迁移到信封契约的响应（如部分基础设施端点）。
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (typeof record.detail === 'string') return new ApiError(statusCode, record.detail);
  }
  return new ApiError(statusCode, '服务暂时无法完成请求。');
}

/** 成功响应解包 {data, meta?}；meta 暂不参与业务，保留在返回值外侧以免丢失分页信息。 */
function unwrap<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    if ('data' in record && !('error' in record)) return record.data as T;
  }
  return payload as T;
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
        if (response.statusCode >= 200 && response.statusCode < 300) { resolve(unwrap<T>(response.data)); return; }
        if (response.statusCode === 401) unauthorized?.();
        reject(parseError(response.statusCode, response.data));
      },
      fail(error) { reject(new Error(error.errMsg || '网络连接失败，请检查 API 地址和网络后重试。')); },
    });
  });
}
