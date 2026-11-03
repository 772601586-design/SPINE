const base = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const tokenKey = 'spine.knowledge.token';
export const knowledgeToken = () => sessionStorage.getItem(tokenKey) || '';
export const saveKnowledgeToken = (token: string) => token ? sessionStorage.setItem(tokenKey, token) : sessionStorage.removeItem(tokenKey);

export async function knowledgeApi<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const token = knowledgeToken();
  const form = body instanceof FormData;
  const response = await fetch(base + '/api/v1/' + path, {
    method, signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Token ${token}` } : {}), ...(!form && body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const payload = await response.json();
  if (!response.ok) {
    if (response.status === 401) saveKnowledgeToken('');
    const fields = payload.error?.field_errors;
    throw new Error((payload.error?.message || `请求失败 (${response.status})`) + (fields ? ' ' + JSON.stringify(fields) : ''));
  }
  return (Array.isArray(payload.data) && payload.meta ? { ...payload.meta, results: payload.data } : payload.data) as T;
}
