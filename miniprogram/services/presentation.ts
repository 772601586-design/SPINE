import type { PersonalActionCard } from '../models/types';

export function shanghaiDate(): string {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}
export function durationText(seconds: number): string {
  const minutes = Math.max(0, Math.floor(seconds / 60));
  return `${Math.floor(minutes / 60)}小时${minutes % 60}分`;
}
export function doseText(card: Pick<PersonalActionCard, 'reps_per_set' | 'breaths_per_set' | 'hold_seconds' | 'sets'>): string {
  const parts = [card.reps_per_set ? `${card.reps_per_set} 次` : '',
    card.breaths_per_set ? `${card.breaths_per_set} 次呼吸` : '',
    card.hold_seconds ? `${card.hold_seconds} 秒` : ''].filter(Boolean);
  return parts.length ? `${parts.join(' · ')} × ${card.sets ?? '待设置'} 组` : '先核对动作参数';
}
