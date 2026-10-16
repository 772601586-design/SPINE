/** 档案可选项字典（规格 §3）。与后端 `profiles.models` 的 choices 保持一致。 */

export interface Option { value: string; label: string }

export const TREATMENT_STAGES = [
  { value: 'check', label: '刚发现侧弯，还在检查', desc: '先整理检查资料，慢慢了解自己的情况。',
    title: '还在检查，也可以先用起来', encouragement: '先保存已有资料和想问医生的问题。检查结果与治疗安排，以就诊时的建议为准。' },
  { value: 'new', label: '刚开始戴支具', desc: '正在适应支具，通常是刚开始的前两周。',
    title: '刚开始，不必一下子做到完美', encouragement: '适应需要一点时间。按医生给你的计划逐步来，也记下佩戴时的感受，方便复诊沟通。' },
  { value: 'brace', label: '支具与运动训练', desc: '佩戴支具，也按处方安排练习。',
    title: '把坚持，放进日常里', encouragement: '记录佩戴，跟着核对好的动作练习。今天做了多少，都可以如实记下来。' },
  { value: 'maintenance', label: '已脱支具，以运动为主', desc: '继续按个人计划训练和复查。',
    title: '新的阶段，继续照顾自己', encouragement: '按医生或康复师确认的计划安排运动，也别忘了把每次复查的变化留下来。' },
  { value: 'adult', label: '成年后自我管理', desc: '在工作和生活中，找到照顾身体的节奏。',
    title: '照顾身体，从自己的节奏开始', encouragement: '继续按个人处方练习。这里可以保存动作、测量和复查记录，方便你随时回看。' },
  { value: '', label: '暂不选择', desc: '以后随时可以在「我的」里修改。',
    title: '准备好了，慢慢开始', encouragement: '先记录你想留下的资料，再逐步整理适合自己的练习和复查安排。' },
];

export const GENDER_OPTIONS: Option[] = [
  { value: 'female', label: '女' }, { value: 'male', label: '男' },
  { value: 'custom', label: '自定义' }, { value: '', label: '暂不填写' },
];
export const MENARCHE_OPTIONS: Option[] = [
  { value: 'not_yet', label: '还没有' }, { value: 'started', label: '已经来了' },
  { value: 'prefer_not', label: '不想填' }, { value: '', label: '暂不填写' },
];

export function treatmentStage(value: string) {
  return TREATMENT_STAGES.find(item => item.value === value) || TREATMENT_STAGES[TREATMENT_STAGES.length - 1];
}

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
