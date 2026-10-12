import type { User } from '../models/types';
import { api } from './api';
import { ApiError, configureUnauthorizedHandler as setUnauthorizedHandler } from './request';

const TOKEN_KEY = 'spine.session.token';
let currentUser: User | null = null;
let restorePromise: Promise<'signedIn' | 'signedOut' | 'unavailable'> | null = null;

export function configureUnauthorizedHandler(handler: () => void): void {
  setUnauthorizedHandler(handler);
}

export function getCurrentUser(): User | null { return currentUser; }
export function clearSession(): void {
  wx.clearStorageSync();
  currentUser = null;
  restorePromise = Promise.resolve('signedOut');
}

export function initSession(force = false): Promise<'signedIn' | 'signedOut' | 'unavailable'> {
  if (restorePromise && !force) return restorePromise;
  restorePromise = (async () => {
    const token = wx.getStorageSync(TOKEN_KEY);
    if (typeof token !== 'string' || token.length === 0) { currentUser = null; return 'signedOut'; }
    try { currentUser = await api.me(); return 'signedIn'; }
    catch (error) {
      if (error instanceof ApiError && error.status === 401) { clearSession(); return 'signedOut'; }
      return 'unavailable';
    }
  })();
  return restorePromise;
}

/**
 * Local account/password adapter for development. A future WeChat adapter should
 * exchange wx.login's code with Django and consume the same token/user response;
 * AppSecret and session_key must remain on the server.
 */
export async function signIn(username: string, password: string): Promise<User> {
  const result = await api.login(username, password);
  wx.setStorageSync(TOKEN_KEY, result.token);
  currentUser = result.user;
  restorePromise = Promise.resolve('signedIn');
  return result.user;
}

export async function requireSession(): Promise<boolean> {
  const result = await initSession();
  if (result === 'signedIn') return true;
  if (result === 'signedOut') wx.reLaunch({ url: '/pages/login/index' });
  else wx.showToast({ title: '连接失败，请重试', icon: 'none' });
  return false;
}

export async function signOut(): Promise<boolean> {
  let revoked = true;
  try { await api.logout(); }
  catch (_) { revoked = false; }
  finally { clearSession(); wx.reLaunch({ url: '/pages/login/index' }); }
  return revoked;
}

export function isInvalidCredential(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 400 || error.status === 401);
}
