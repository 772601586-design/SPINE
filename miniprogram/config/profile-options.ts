/** 档案可选项字典（规格 §3）。与后端 `profiles.models` 的 choices 保持一致。 */

export interface Option { value: string; label: string }

export const DIAGNOSIS_OPTIONS: Option[] = [
  { value: '', label: '暂不填写' },
  { value: 'diagnosed', label: '已诊断' },
  { value: 'under_investigation', label: '正在检查' },
  { value: 'unclear', label: '暂不清楚' },
];

export const DIAGNOSIS_LABELS: string[] = DIAGNOSIS_OPTIONS.map(item => item.label);

export const MANAGEMENT_OPTIONS: Option[] = [
  { value: 'observation', label: '观察随访' },
  { value: 'physiotherapy', label: '物理治疗/康复训练' },
  { value: 'brace', label: '支具' },
  { value: 'surgery', label: '手术' },
  { value: 'other', label: '其他' },
];

export function labelOf(options: Option[], value: string | null | undefined): string {
  return options.find(item => item.value === (value ?? ''))?.label ?? '';
}

export function labelsOf(options: Option[], values: string[]): string {
  const labels = values.map(value => labelOf(options, value)).filter(text => text.length > 0);
  return labels.length > 0 ? labels.join('、') : '';
}

/** 东八区"今天"的 YYYY-MM，用于日期选择上限，避免用户选到未来。 */
export function currentMonth(): string {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7);
}

/** 东八区"今天"的 YYYY-MM-DD。 */
export function todayDate(): string {
  return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
}
