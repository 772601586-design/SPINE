export interface User { id: number; username: string }

export interface TaxonomyTerm { code: string; name: string; description: string }
export interface ExerciseTaxonomy { regions: TaxonomyTerm[]; muscles: TaxonomyTerm[]; goals: TaxonomyTerm[]; postures: TaxonomyTerm[]; equipment: string[] }
export interface ExerciseVersion {
  id: number; version: number; name: string; summary: string; category_label: string;
  requires_individual_setup: boolean; already_added: boolean; regions: TaxonomyTerm[]; primary_muscles: TaxonomyTerm[];
  secondary_muscles: TaxonomyTerm[]; goals: TaxonomyTerm[]; region_names: string; primary_muscle_names: string;
  secondary_muscle_names: string; goal_names: string; starting_position: string;
  equipment: string[]; preparation: string; steps: string[]; hold_and_return: string; breathing: string;
  common_compensations: string; cautions: string; side_notes: string; media: { type: string; url?: string; caption?: string }[];
  source_url: string; author: string; reviewer: string; reviewed_at: string | null;
}

export type CardReadiness = 'needs_setup' | 'needs_check' | 'ready';
export interface PersonalActionCard {
  id: number; plan: number; source_version: number | null; source_type: 'library' | 'prescription' | 'custom';
  source_title: string | null; source_summary: string | null; source_steps: string[] | null;
  source_precautions: string | null; source_media: { type: string; url?: string; caption?: string }[] | null;
  source_url: string | null; source_category: string | null; name: string; order: number; revision: number;
  active: boolean; verification_status: CardReadiness; sets: number | null; reps_per_set: number | null;
  breaths_per_set: number | null; hold_seconds: number | null; side: string; rest_seconds: number | null;
  equipment: string[]; focus_points: string[]; personal_notes: string; completed_sets: number;
}
export interface PlanVersion { version_no: number; snapshot: { cards: unknown[] }; reason: string; created_at: string }
export interface TrainingPlan {
  id: number; title: string; start_date: string | null; end_date: string | null; timezone: string; status: string;
  current_version_no: number; current_version: PlanVersion | null; cards: PersonalActionCard[]; completed_sets: number;
}
export interface TrainingAttempt {
  id: number; plan: number; plan_version: number; card: number; card_name: string; card_revision: number;
  planned_dose: { sets: number; reps_per_set: number | null; breaths_per_set: number | null; hold_seconds: number | null; side: string; rest_seconds: number | null };
  voice_media: { type: string; url: string; caption?: string }[];
  status: 'in_progress' | 'paused' | 'completed' | 'partial' | 'aborted';
  started_at: string; ended_at: string | null; completed_sets: number;
}

/** 身份与建档状态（GET /api/v1/me/）。不含 openid 等私有标识。 */
export interface Identity {
  id: number; username: string; has_profile: boolean;
  onboarding_status: 'draft' | 'complete' | 'needs_update' | null;
  nickname: string | null; created_at: string;
}

export interface Attachment {
  id: string; purpose: string; status: string; original_filename: string;
  mime_type: string; size_bytes: number; created_at: string;
  access_url: string | null; access_expires_at: string | null;
}

export interface Profile {
  id: string; nickname: string; avatar: Attachment | null;
  birth_month: string; diagnosis_status: string | null;
  first_diagnosed_date: string | null;
  management_methods: string[]; notes: string;
  onboarding_status: 'draft' | 'complete' | 'needs_update';
  completed_at: string | null; completed_revision: number | null;
  revision: number; created_at: string; updated_at: string;
  latest_measurement: LatestMeasurement | null;
}
export interface LatestMeasurement {
  measured_at: string; height_cm: string | null; weight_kg: string | null; source: string;
}
export interface BodyMeasurement {
  id: string; measured_at: string; height_cm: string | null; weight_kg: string | null;
  source: string; notes: string; revision: number; created_at: string; updated_at: string;
}
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
export interface WearEndResponse extends WearSession {
  training_prompt?: { eligible: boolean; reason: string; session_id: number | null; prompt_id?: number };
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

export type DatePrecision = 'day' | 'month' | 'unknown';

/** 就诊（规格 §4）。日期三态互斥：只有年月时 `date_precision` 必须是 month。 */
export interface Visit {
  id: string;
  visit_date: string | null;
  visit_month: string;
  date_precision: DatePrecision;
  institution: string; department: string; title: string;
  diagnosis_excerpt: string; advice_excerpt: string; notes: string;
  next_review_date: string | null;
  attachment_count: number; curve_count: number;
  revision: number; created_at: string; updated_at: string;
}

export type MedicalCategory = 'xray_image' | 'imaging_report' | 'diagnosis_record' | 'other';

export interface MedicalAttachmentBinding {
  id: string; attachment: Attachment; category: MedicalCategory;
  caption: string; created_at: string; updated_at: string;
}

export type CurveRegion = 'cervical' | 'thoracic' | 'thoracolumbar' | 'lumbar' | 'unknown';
export type CurveDirection = 'left' | 'right' | 'unknown';

export interface CurveMeasurement {
  id: string; region: CurveRegion; direction: CurveDirection;
  cobb_angle: string | null; end_vertebrae: string;
  source_attachment: string | null; source_text: string;
  entry_source: string; revision: number; created_at: string; updated_at: string;
}

export interface VisitDetail extends Visit {
  attachments: MedicalAttachmentBinding[];
  curves: CurveMeasurement[];
}
