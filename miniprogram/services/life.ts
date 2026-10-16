import { request } from './request';

export interface LifePreferences {
  review_enabled: boolean; review_date: string | null; sedentary_minutes: number;
  swim_weekdays: number[]; brace_target_hours: string | null;
}
export interface LifeRecord { id: number; request_id: string; kind: string; date: string; minutes: number | null; pain: number | null; notes: string; attachment: string | null }
export interface LifeArticle { id: number; title: string; category: string; topic: string; body: string; reviewer: string; question: string; options: string[]; explanation: string }
export interface LifePost { id: number; group: string; body: string; status: string; moderation_note: string; mine: boolean; author: string; like_count: number; liked: boolean; created_at: string }
export interface LifeRewards { balance: number; rules: string; medals: Array<{ key: string; label: string; earned: boolean }>; ledger: Array<{ id: number; label: string; points: number; created_at: string }> }
export interface LifeSummary {
  date: string; review: { date: string; days: number; checklist: string[] } | null;
  swim_today: boolean; swim_week_count: number; training_count: number; brace_record_days: number;
  record_days: number | null; summary_text: string; measurement_note: string;
  curves: Array<{ id: string; date: string | null; month: string; region: string; direction: string; angle: string | null; end_vertebrae: string }>;
}
export function requestId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const value = Math.random() * 16 | 0;
    return (char === 'x' ? value : (value & 3 | 8)).toString(16);
  });
}
export const life = {
  preferences: () => request<LifePreferences>('GET', '/api/v1/life/preferences/'),
  savePreferences: (values: Record<string, unknown>) => request<LifePreferences>('PATCH', '/api/v1/life/preferences/', values),
  records: (kind = '') => request<LifeRecord[]>('GET', `/api/v1/life/records/${kind ? `?kind=${encodeURIComponent(kind)}` : ''}`),
  record: (values: Record<string, unknown>) => request<LifeRecord>('POST', '/api/v1/life/records/', values),
  articles: () => request<LifeArticle[]>('GET', '/api/v1/life/articles/'),
  read: (id: number) => request<{ read: boolean; passed: boolean }>('POST', `/api/v1/life/articles/${id}/read/`, {}),
  answer: (id: number, option: number) => request<{ correct: boolean; explanation: string }>('POST', `/api/v1/life/articles/${id}/answer/`, { option }),
  rewards: () => request<LifeRewards>('GET', '/api/v1/life/rewards/'),
  summary: () => request<LifeSummary>('GET', '/api/v1/life/summary/'),
  posts: (group = '', mine = false) => request<LifePost[]>('GET', `/api/v1/life/posts/?group=${encodeURIComponent(group)}&mine=${mine ? 1 : 0}`),
  post: (values: Record<string, unknown>) => request<LifePost>('POST', '/api/v1/life/posts/', values),
  removePost: (id: number) => request<null>('DELETE', `/api/v1/life/posts/${id}/`),
  like: (id: number, liked: boolean) => request<{ liked: boolean; like_count: number }>('POST', `/api/v1/life/posts/${id}/like/`, { liked }),
  report: (id: number, reason: string) => request<{ reported: boolean }>('POST', `/api/v1/life/posts/${id}/report/`, { reason }),
};
