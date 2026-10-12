export interface HealthResponse {
  status: 'ok';
  service: 'spine-backend';
  api_version: 'v1';
  timestamp: string;
}

export async function fetchHealth(baseUrl: string, signal?: AbortSignal): Promise<HealthResponse> {
  const url = new URL(`${baseUrl.replace(/\/$/, '')}/api/v1/health/`);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('服务地址必须使用 HTTP 或 HTTPS');
  const response = await fetch(url, {
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`服务返回 HTTP ${response.status}`);
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !('status' in data) || data.status !== 'ok'
    || !('service' in data) || data.service !== 'spine-backend'
    || !('api_version' in data) || data.api_version !== 'v1'
    || !('timestamp' in data) || typeof data.timestamp !== 'string'
    || !Number.isFinite(Date.parse(data.timestamp))) {
    throw new Error('服务返回了不符合约定的数据');
  }
  return data as HealthResponse;
}
