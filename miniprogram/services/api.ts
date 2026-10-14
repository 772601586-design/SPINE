import type {
  Brace, BodyMeasurement, ComfortEntry, ComfortFollowUp, CurveMeasurement, Identity,
  Profile, User, Visit, VisitDetail, WearRevision, WearSession, WearStatistics,
  ExerciseTaxonomy, ExerciseVersion,
  PersonalActionCard, TrainingPlan, TrainingAttempt, WearEndResponse,
} from '../models/types';
import { request } from './request';

export const api = {
  /** 开发期账号密码入口，保留给后端联调脚本使用；界面已改用微信登录。 */
  login(username: string, password: string) {
    return request<{ token: string; user: User }>('POST', '/api/v1/auth/login/', { username, password });
  },
  /** 只上送 wx.login 的 code，openid 与 AppSecret 全部留在服务端。 */
  wechatLogin(code: string) {
    return request<{ token: string; user: User; is_new: boolean }>('POST', '/api/v1/auth/wechat/', { code });
  },
  /** 身份与建档状态（规格 §14）。`has_profile` 决定是否进首次建档。 */
  me() { return request<Identity>('GET', '/api/v1/me/'); },
  logout() { return request<null>('POST', '/api/v1/auth/logout/', {}); },
  /** 未建档时返回 404，用 `me().has_profile` 判断即可，不要靠捕获 404 当分支。 */
  profile() { return request<Profile>('GET', '/api/v1/me/profile/'); },
  saveProfile(data: Record<string, unknown>) {
    return request<Profile>('PATCH', '/api/v1/me/profile/', data);
  },
  completeProfile() { return request<Profile>('POST', '/api/v1/me/profile/complete/', {}); },
  bodyMeasurements() { return request<BodyMeasurement[]>('GET', '/api/v1/body-measurements/?limit=20'); },
  addBodyMeasurement(data: Record<string, unknown>) {
    return request<BodyMeasurement>('POST', '/api/v1/body-measurements/', data);
  },
  braces() { return request<Brace[]>('GET', '/api/v1/braces/'); },
  saveBrace(data: Partial<Brace>, id?: number) {
    return request<Brace>(id ? 'PATCH' : 'POST', `/api/v1/braces/${id ? `${id}/` : ''}`, data as Record<string, unknown>);
  },
  wears() { return request<WearSession[]>('GET', '/api/v1/wear-sessions/'); },
  startWear(brace: number, requestId: string) {
    return request<WearSession>('POST', '/api/v1/wear-sessions/start/', { brace, request_id: requestId });
  },
  endWear(id: number) { return request<WearEndResponse>('POST', `/api/v1/wear-sessions/${id}/end/`, {}); },
  backfill(data: Record<string, unknown>) { return request<WearSession>('POST', '/api/v1/wear-sessions/', data); },
  correctWear(id: number, data: Record<string, unknown>) {
    return request<WearSession>('PATCH', `/api/v1/wear-sessions/${id}/`, data);
  },
  revisions(id: number) { return request<WearRevision[]>('GET', `/api/v1/wear-sessions/${id}/revisions/`); },
  statistics(braceId?: number) {
    const query = braceId ? `?brace=${braceId}` : '';
    return request<WearStatistics>('GET', `/api/v1/wear-sessions/statistics/${query}`);
  },  feelings() { return request<ComfortEntry[]>('GET', '/api/v1/comfort-entries/'); },
  saveFeeling(data: Record<string, unknown>, id?: number) {
    return request<ComfortEntry>(id ? 'PATCH' : 'POST', `/api/v1/comfort-entries/${id ? `${id}/` : ''}`, data);
  },
  followUps(entryId: number) { return request<ComfortFollowUp[]>('GET', `/api/v1/comfort-follow-ups/?entry=${entryId}`); },
  addFollowUp(data: Record<string, unknown>) { return request<ComfortFollowUp>('POST', '/api/v1/comfort-follow-ups/', data); },

  exerciseTaxonomy() { return request<ExerciseTaxonomy>('GET', '/api/v1/exercise-taxonomy/'); },
  exercises(filters: { region?: string; muscle?: string; goal?: string; category?: string; posture?: string; equipment?: string } = {}) {
    const query = Object.entries(filters).filter(([, value]) => !!value)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value!)}`).join('&');
    return request<ExerciseVersion[]>('GET', `/api/v1/exercises/${query ? `?${query}` : ''}`);
  },
  trainingPlan() { return request<TrainingPlan | null>('GET', '/api/v1/training/plan/'); },
  actionCard(id: number) { return request<PersonalActionCard>('GET', `/api/v1/training/cards/${id}/`); },
  addActionCard(exerciseVersionId: number) {
    return request<PersonalActionCard>('POST', '/api/v1/training/cards/from-exercise/', { exercise_version_id: exerciseVersionId });
  },
  updateActionCard(id: number, data: Record<string, unknown>) {
    return request<PersonalActionCard>('PATCH', `/api/v1/training/cards/${id}/`, data);
  },
  removeActionCard(id: number) { return request<null>('DELETE', `/api/v1/training/cards/${id}/`); },
  reorderActionCards(cardIds: number[]) { return request<TrainingPlan>('POST', '/api/v1/training/cards/reorder/', { card_ids: cardIds }); },
  startAttempt(cardId: number) { return request<TrainingAttempt>('POST', '/api/v1/training/attempts/start/', { card_id: cardId }); },
  attempt(id: number) { return request<TrainingAttempt>('GET', `/api/v1/training/attempts/${id}/`); },
  completeSet(id: number, data: Record<string, unknown>) {
    return request<Record<string, unknown>>('POST', `/api/v1/training/attempts/${id}/complete-set/`, data);
  },
  finishAttempt(id: number) { return request<TrainingAttempt>('POST', `/api/v1/training/attempts/${id}/finish/`, {}); },
  pauseAttempt(id: number) { return request<TrainingAttempt>('POST', `/api/v1/training/attempts/${id}/pause/`, {}); },
  resumeAttempt(id: number) { return request<TrainingAttempt>('POST', `/api/v1/training/attempts/${id}/resume/`, {}); },
  braceTrainingPromptChoice(id: number, choice: 'continue' | 'skip') {
    return request<Record<string, unknown>>('POST', `/api/v1/wear-sessions/${id}/training-prompt-choice/`, { choice });
  },

  // ---- 医疗资料（规格 §4）----
  visits() { return request<Visit[]>('GET', '/api/v1/visits/?limit=50'); },
  visit(id: string) { return request<VisitDetail>('GET', `/api/v1/visits/${id}/`); },
  createVisit(data: Record<string, unknown>) { return request<VisitDetail>('POST', '/api/v1/visits/', data); },
  updateVisit(id: string, data: Record<string, unknown>) {
    return request<VisitDetail>('PATCH', `/api/v1/visits/${id}/`, data);
  },
  deleteVisit(id: string) { return request<null>('DELETE', `/api/v1/visits/${id}/`); },
  /** 把已完成的 medical 用途附件挂到就诊上；一张附件只能属于一次就诊。 */
  bindMedicalAttachment(visitId: string, data: Record<string, unknown>) {
    return request<Record<string, unknown>>('POST', `/api/v1/visits/${visitId}/attachments/`, data);
  },
  updateMedicalAttachment(visitId: string, attachmentId: string, data: Record<string, unknown>) {
    return request<Record<string, unknown>>('PATCH', `/api/v1/visits/${visitId}/attachments/${attachmentId}/`, data);
  },
  /** 解绑只断开关联，不删原件。 */
  unbindMedicalAttachment(visitId: string, attachmentId: string) {
    return request<null>('DELETE', `/api/v1/visits/${visitId}/attachments/${attachmentId}/`);
  },
  addCurve(visitId: string, data: Record<string, unknown>) {
    return request<CurveMeasurement>('POST', `/api/v1/visits/${visitId}/curves/`, data);
  },
  deleteCurve(id: string) { return request<null>('DELETE', `/api/v1/curve-measurements/${id}/`); },

  // ---- 附件（规格 §15）----
  attachmentAccess(id: string) { return request<{ access_url: string | null }>('GET', `/api/v1/attachments/${id}/access/`); },
  deleteAttachment(id: string) { return request<null>('DELETE', `/api/v1/attachments/${id}/`); },
};
