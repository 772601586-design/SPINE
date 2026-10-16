import type { Identity, User } from '../models/types';
import { api } from './api';
import { ApiError, configureUnauthorizedHandler as setUnauthorizedHandler } from './request';
import { LOCAL_RECORDING_PREFIX } from '../config/local-recordings';

const TOKEN_KEY = 'spine.session.token';
let currentUser: User | null = null;
let currentIdentity: Identity | null = null;
let restorePromise: Promise<'signedIn' | 'signedOut' | 'unavailable'> | null = null;

export function configureUnauthorizedHandler(handler: () => void): void {
  setUnauthorizedHandler(handler);
}

export function getCurrentUser(): User | null { return currentUser; }

/** 建档状态由服务端判定（规格 §3）：客户端不缓存 `has_profile`，每次会话恢复都重取。 */
export function getCurrentIdentity(): Identity | null { return currentIdentity; }

export function clearSession(): void {
  // Recordings belong to a local account-specific library and survive sign-out.
  // Tokens, pending submissions and other cached private data are still removed.
  wx.removeStorageSync(TOKEN_KEY);
  for (const key of wx.getStorageInfoSync().keys) {
    if (!key.startsWith(LOCAL_RECORDING_PREFIX)) wx.removeStorageSync(key);
  }
  currentUser = null;
  currentIdentity = null;
  restorePromise = Promise.resolve('signedOut');
}

export function initSession(force = false): Promise<'signedIn' | 'signedOut' | 'unavailable'> {
  if (restorePromise && !force) return restorePromise;
  restorePromise = (async () => {
    const token = wx.getStorageSync(TOKEN_KEY);
    if (typeof token !== 'string' || token.length === 0) { currentUser = null; currentIdentity = null; return 'signedOut'; }
    try { return await loadIdentity(); }
    catch (error) {
      if (error instanceof ApiError && error.status === 401) { clearSession(); return 'signedOut'; }
      return 'unavailable';
    }
  })();
  return restorePromise;
}

/** 拉取身份并同步本地缓存。401 由请求层统一处理。 */
async function loadIdentity(): Promise<'signedIn'> {
  const identity = await api.me();
  currentIdentity = identity;
  currentUser = { id: identity.id, username: identity.username };
  return 'signedIn';
}

/** 建档成功后刷新身份，避免下一次进首页又被弹回建档页。 */
export async function refreshIdentity(): Promise<Identity> {
  await loadIdentity();
  restorePromise = Promise.resolve('signedIn');
  return currentIdentity as Identity;
}

/**
 * 开发期账号密码适配器，保留给后端联调脚本。界面已切换为微信登录；
 * AppSecret 与 session_key 必须始终留在服务端。
 */
export async function signIn(username: string, password: string): Promise<User> {
  const result = await api.login(username, password);
  wx.setStorageSync(TOKEN_KEY, result.token);
  currentUser = result.user;
  await loadIdentity();
  restorePromise = Promise.resolve('signedIn');
  return result.user;
}

function requestWechatCode(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    wx.login({
      success(result) {
        if (typeof result.code === 'string' && result.code.length > 0) { resolve(result.code); return; }
        reject(new Error('未能获取微信登录凭证，请重试。'));
      },
      fail(error) { reject(new Error(error.errMsg || '未能获取微信登录凭证，请重试。')); },
    });
  });
}

/**
 * 微信登录：wx.login 取一次性 code，交由服务端换 openid 并签发本项目 Token。
 * 客户端只持有 Token，openid / session_key / AppSecret 都不落到端上。
 */
export async function signInWithWechat(): Promise<{ user: User; isNew: boolean; hasProfile: boolean }> {
  const code = await requestWechatCode();
  const result = await api.wechatLogin(code);
  wx.setStorageSync(TOKEN_KEY, result.token);
  currentUser = result.user;
  await loadIdentity();
  restorePromise = Promise.resolve('signedIn');
  return { user: result.user, isNew: result.is_new === true, hasProfile: currentIdentity?.has_profile === true };
}

/** 未建档的已登录用户，按规格 §2「首次使用」流程进建档页。 */
export function goToOnboarding(): void {
  wx.reLaunch({ url: '/pages/onboarding/profile/index' });
}

/** 已建档则落在康复首页；未建档先去建档，避免「先看到空首页再被弹回」。 */
export async function requireOnboarded(): Promise<boolean> {
  const result = await initSession();
  if (result === 'signedIn') {
    if (currentIdentity?.has_profile) return true;
    goToOnboarding();
    return false;
  }
  if (result === 'signedOut') wx.reLaunch({ url: '/pages/login/index' });
  else wx.showToast({ title: '连接失败，请重试', icon: 'none' });
  return false;
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
