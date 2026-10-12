export type RuntimeTarget = 'developerTool' | 'device' | 'release';

// Development points to the developer-tool host. For a phone, use the computer's
// reachable LAN address; release requires the HTTPS API domain approved by WeChat.
// No production domain has been configured for this project yet.
export const RUNTIME_TARGET: RuntimeTarget = 'developerTool';
const API_BASES: Record<RuntimeTarget, string> = {
  developerTool: 'http://127.0.0.1:8000',
  device: '',
  release: '',
};
export const API_BASE_URL = API_BASES[RUNTIME_TARGET];
