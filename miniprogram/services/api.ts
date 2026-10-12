import type { Brace, ComfortEntry, ComfortFollowUp, User, WearRevision, WearSession, WearStatistics } from '../models/types';
import { request } from './request';

export const api = {
  login(username: string, password: string) {
    return request<{ token: string; user: User }>('POST', '/api/v1/auth/login/', { username, password });
  },
  me() { return request<User>('GET', '/api/v1/auth/me/'); },
  logout() { return request<null>('POST', '/api/v1/auth/logout/', {}); },
  braces() { return request<Brace[]>('GET', '/api/v1/braces/'); },
  saveBrace(data: Partial<Brace>, id?: number) {
    return request<Brace>(id ? 'PATCH' : 'POST', `/api/v1/braces/${id ? `${id}/` : ''}`, data as Record<string, unknown>);
  },
  wears() { return request<WearSession[]>('GET', '/api/v1/wear-sessions/'); },
  startWear(brace: number, requestId: string) {
    return request<WearSession>('POST', '/api/v1/wear-sessions/start/', { brace, request_id: requestId });
  },
  endWear(id: number) { return request<WearSession>('POST', `/api/v1/wear-sessions/${id}/end/`, {}); },
  backfill(data: Record<string, unknown>) { return request<WearSession>('POST', '/api/v1/wear-sessions/', data); },
  correctWear(id: number, data: Record<string, unknown>) {
    return request<WearSession>('PATCH', `/api/v1/wear-sessions/${id}/`, data);
  },
  revisions(id: number) { return request<WearRevision[]>('GET', `/api/v1/wear-sessions/${id}/revisions/`); },
  statistics(braceId?: number) {
    return request<WearStatistics>('GET', `/api/v1/wear-sessions/statistics/${braceId ? `?brace=${braceId}` : ''}`);
  },
  feelings() { return request<ComfortEntry[]>('GET', '/api/v1/comfort-entries/'); },
  saveFeeling(data: Record<string, unknown>, id?: number) {
    return request<ComfortEntry>(id ? 'PATCH' : 'POST', `/api/v1/comfort-entries/${id ? `${id}/` : ''}`, data);
  },
  followUps(entryId: number) { return request<ComfortFollowUp[]>('GET', `/api/v1/comfort-follow-ups/?entry=${entryId}`); },
  addFollowUp(data: Record<string, unknown>) { return request<ComfortFollowUp>('POST', '/api/v1/comfort-follow-ups/', data); },
};
