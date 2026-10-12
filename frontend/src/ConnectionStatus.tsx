import { useEffect, useState } from 'react';
import { fetchHealth } from './api';
import type { HealthResponse } from './api';

const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

export function ConnectionStatus() {
  const [attempt, setAttempt] = useState(0);
  const [health, setHealth] = useState<HealthResponse>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setHealth(undefined);
    fetchHealth(baseUrl, controller.signal)
      .then((data) => { if (!controller.signal.aborted) setHealth(data); })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '请求失败');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);

  return <section className="connection" aria-label="服务连接" aria-live="polite">
    <span className={`status-dot ${health ? 'online' : ''}`} />
    <div>
      <strong>{loading ? '正在连接服务…' : health ? '后端已连接' : '暂时无法连接后端'}</strong>
      <p>{health ? `最近检查 ${new Date(health.timestamp).toLocaleTimeString('zh-CN')} · 数据库状态请查看就绪检查`
        : error ? `${error}。请确认后端已启动。` : '正在检查连接状态'}</p>
    </div>
    <button className="secondary" disabled={loading} onClick={() => setAttempt((value) => value + 1)}>重新检查</button>
  </section>;
}
