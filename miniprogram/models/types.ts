export interface User { id: number; username: string }
export interface Brace {
  id: number; name: string; brace_type: string; notes: string;
  started_on: string | null; institution: string; is_active: boolean;
  created_at: string;
}
export interface WearSession {
  id: number; brace: number; started_at: string; ended_at: string | null;
  original_timezone: string; source: string; request_id: string; notes: string;
  version: number; created_at: string; updated_at: string;
}
export interface ComfortEntry {
  id: number; brace: number; wear_session: number | null; comfort_level: number | null;
  pain: number | null; pain_note: string; positions: string[]; tags: string[];
  occurred_at: string; notes: string; request_id: string;
}
export interface DayTotal { date: string; seconds: number; minutes: number }
export interface WeekTotal { week_start: string; seconds: number; minutes: number }
export interface WearStatistics { timezone: 'Asia/Shanghai'; days: DayTotal[]; weeks: WeekTotal[] }
export interface WearRevision {
  id: number; before: Record<string, unknown>; after: Record<string, unknown>;
  reason: string; created_at: string;
}
export interface ComfortFollowUp {
  id: number; entry: number; status: 'improved' | 'persisting' | 'worsened';
  occurred_at: string; notes: string; request_id: string; created_at: string;
}
