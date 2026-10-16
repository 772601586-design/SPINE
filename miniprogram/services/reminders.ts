import { life } from './life';
import { getCurrentIdentity } from './session';

let timer = 0;
let foregroundSince = Date.now();
export function stopReminders(): void { clearInterval(timer); timer = 0; }
export async function startReminders(): Promise<void> {
  stopReminders();
  const identity = getCurrentIdentity();
  if (!identity) return;
  const owner = identity.id;
  try {
    const preferences = await life.preferences();
    if (!preferences.sedentary_minutes || getCurrentIdentity()?.id !== owner) return;
    foregroundSince = Date.now();
    timer = setInterval(() => {
      if (getCurrentIdentity()?.id !== owner) { stopReminders(); return; }
      const pages = getCurrentPages();
      if (pages.some(page => page.route.startsWith('prototype/'))) return;
      if (Date.now() - foregroundSince >= preferences.sedentary_minutes * 60000) {
        foregroundSince = Date.now();
        wx.showModal({ title: '坐了一会儿了', content: '按自己的安排，换个姿势或稍微活动一下吧。', showCancel: false });
      }
    }, 15000);
  } catch (_) { /* Optional reminders never block the personal records. */ }
}
