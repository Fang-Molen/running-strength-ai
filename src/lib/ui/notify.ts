/** 提醒投递。没有推送服务器时：App 打开期间（含画中画/后台标签页）用 Service Worker 本地通知按时弹出。
 * sw.js 已有 push/notificationclick 处理；将来接入服务器后可直接 Web Push（需 VAPID，iOS 16.4+ 且需“添加到主屏幕”）。 */
import { planReminders, type ReminderPrefs } from "./streak.ts"
export const SENT_KEY = "fk-notify-sent-v1"
export type Sent = { date: string; count: number }
export function sentToday(raw: string | null, date: string): number { try { const v = JSON.parse(raw ?? "null") as Sent | null; return v?.date === date ? v.count : 0 } catch { return 0 } }
/** 计算接下来要弹的本地提醒（已发数计入每天 2 条上限）。 */
export function pendingLocal(lastSessionIso: string | null, now: Date, todayLogged: boolean, prefs: ReminderPrefs, sent: number) {
  return planReminders(lastSessionIso, now, todayLogged, prefs, sent).map((r) => ({ ...r, delayMs: Math.max(0, Date.parse(r.at) - now.getTime()) }))
}
export type NotifySupport = { api: boolean; sw: boolean; push: boolean; standaloneIOS: boolean | null; note: string }
export function support(w: { Notification?: unknown; navigator?: { serviceWorker?: unknown; userAgent?: string; standalone?: boolean }; PushManager?: unknown; matchMedia?: (q: string) => { matches: boolean } } | undefined): NotifySupport {
  const ua = w?.navigator?.userAgent ?? "", ios = /iPhone|iPad|iPod/.test(ua)
  const standalone = ios ? !!(w?.navigator?.standalone || w?.matchMedia?.("(display-mode: standalone)").matches) : null
  const api = typeof w?.Notification !== "undefined", sw = !!w?.navigator?.serviceWorker, push = typeof w?.PushManager !== "undefined"
  const note = ios && !standalone ? "iPhone 需要先“分享 → 添加到主屏幕”，并从主屏幕打开（iOS 16.4 及以上）才能收到提醒。" : !api ? "这个浏览器不支持通知。" : "App 打开期间按时提醒；完全关闭后需要推送服务器（尚未接入）。"
  return { api, sw, push, standaloneIOS: standalone, note }
}
