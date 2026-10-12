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
interface WxApi {
  request(options: WxRequestOptions): { abort(): void };
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
  showModal(options: { title: string; content: string; showCancel?: boolean; success?: (result: { confirm: boolean; cancel: boolean }) => void }): void;
  stopPullDownRefresh(): void;
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
declare function Page<T>(options: MiniPageOptions<T>): void;
declare function App(options: { onLaunch?: () => void; globalData?: Record<string, unknown> }): void;
declare function setInterval(handler: () => void, timeout?: number): number;
declare function clearInterval(handle?: number): void;
