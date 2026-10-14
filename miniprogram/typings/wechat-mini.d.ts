interface WxRequestResponse<T = unknown> {
  statusCode: number;
  data: T;
  header: Record<string, string>;
}
interface WxRequestOptions {
  url: string;
  method?: 'OPTIONS' | 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'TRACE' | 'CONNECT' | 'PATCH';
  data?: string | Record<string, unknown> | ArrayBuffer;
  header?: Record<string, string>;
  timeout?: number;
  success?: (response: WxRequestResponse) => void;
  fail?: (error: { errMsg: string }) => void;
}
interface WxUploadResponse { statusCode: number; data: string }
interface WxUploadOptions {
  url: string;
  filePath: string;
  name: string;
  header?: Record<string, string>;
  formData?: Record<string, unknown>;
  timeout?: number;
  success?: (response: WxUploadResponse) => void;
  fail?: (error: { errMsg: string }) => void;
}
interface WxMediaFile { tempFilePath: string; size: number; fileType?: string }
interface WxChosenFile { path: string; name: string; size: number; type?: string }
interface WxInnerAudioContext { src: string; play(): void; stop(): void; destroy(): void; onEnded(callback: () => void): void; onError(callback: (error: { errMsg: string }) => void): void }
interface WxApi {
  request(options: WxRequestOptions): { abort(): void };
  uploadFile(options: WxUploadOptions): { abort(): void };
  login(options: { success?: (result: { code: string; errMsg: string }) => void; fail?: (error: { errMsg: string }) => void }): void;
  getStorageSync(key: string): unknown;
  setStorageSync(key: string, value: unknown): void;
  removeStorageSync(key: string): void;
  clearStorageSync(): void;
  navigateTo(options: { url: string; success?: () => void; fail?: (error: { errMsg: string }) => void }): void;
  navigateBack(options?: { delta?: number }): void;
  switchTab(options: { url: string }): void;
  reLaunch(options: { url: string }): void;
  showToast(options: { title: string; icon?: 'success' | 'loading' | 'none'; duration?: number }): void;
  showLoading(options: { title: string; mask?: boolean }): void;
  hideLoading(): void;
  showModal(options: { title: string; content: string; showCancel?: boolean; confirmText?: string; cancelText?: string;
    success?: (result: { confirm: boolean; cancel: boolean }) => void; fail?: (error: { errMsg: string }) => void }): void;
  stopPullDownRefresh(): void;
  chooseMedia(options: {
    count?: number; mediaType?: Array<'image' | 'video' | 'mix'>; sizeType?: string[];
    sourceType?: string[]; success?: (result: { tempFiles: WxMediaFile[] }) => void;
    fail?: (error: { errMsg: string }) => void;
  }): void;
  chooseMessageFile(options: {
    count?: number; type?: 'all' | 'video' | 'image' | 'file'; extension?: string[];
    success?: (result: { tempFiles: WxChosenFile[] }) => void;
    fail?: (error: { errMsg: string }) => void;
  }): void;
  previewImage(options: { urls: string[]; current?: string }): void;
  setClipboardData(options: { data: string }): void;
  createInnerAudioContext(): WxInnerAudioContext;
}
declare const wx: WxApi;

interface MiniPageContext<T = Record<string, unknown>> {
  data: T;
  setData(value: Partial<T>): void;
  route: string;
  [key: string]: any;
}
interface MiniPageOptions<T = Record<string, unknown>> {
  data: T;
  onLoad?: (this: MiniPageContext<T>, query?: any) => void;
  onShow?: (this: MiniPageContext<T>) => void;
  [key: string]: unknown;
}
/**
 * `ThisType` 让对象字面量里的每个方法都把 `this` 认成 `MiniPageContext<T>`。
 * 少了它，未在接口里声明过的方法（页面自定义方法）的 `this` 会退化成 `any`，
 * `this.data` 的类型约束就全部失效了。
 */
declare function Page<T>(options: { data: T; [key: string]: unknown } & ThisType<MiniPageContext<T>>): void;
declare function App(options: { onLaunch?: () => void; globalData?: Record<string, unknown> }): void;
declare function setInterval(handler: () => void, timeout?: number): number;
declare function clearInterval(handle?: number): void;
