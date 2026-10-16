/** Text similarity only; no clinical inference or automatic pairing. */
export function recordingMatchReason(title: string, name: string, standardName: string | null): string {
  const clean = (text: string): string => text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  const recording = clean(title);
  const own = clean(name), standard = clean(standardName || '');
  if (own.length >= 2 && recording === own) return '录像名称与个人动作名称一致';
  if (own.length >= 2 && recording.includes(own)) return '录像名称包含个人动作名称';
  if (standard.length >= 2 && recording.includes(standard)) return '录像名称包含标准动作名称';
  return '';
}
