/**
 * 佳明同步状态契约（v76，共享给 设置/个人与数据、健康页、日志页）。只读本机记录，不发网络请求。
 * 字段：连接状态 / 最近尝试 / 最后完整成功 / 部分失败 / 导入范围 + 详情。
 * 写入方：src/components/garmin-sync.tsx 的 runGarminSync（每次同步写 report / last-attempt / last-sync / last-full-ok）。
 * 订阅：window 事件 GARMIN_SYNC_STATUS_EVENT（'fk-garmin-synced'）和 'storage'；用 subscribeGarminSyncStatus。
 */
import type { GarminSyncReport } from './garmin-sync-runner'
import { garminStorageKey } from './garmin-sync-runner'
export const GARMIN_SYNC_STATUS_EVENT = 'fk-garmin-synced'
export const GARMIN_KEYS = { report: 'fk-garmin-sync-report', lastAttempt: 'fk-garmin-last-attempt', lastUseful: 'fk-garmin-last-sync', lastFullOk: 'fk-garmin-last-full-ok', autoFail: 'fk-garmin-auto-fail' } as const
export const AUTO_SYNC_RULE = '打开 App、回到前台或网络恢复时（距上次有效同步超过 5 分钟）自动同步；App 开着时每 2 小时一次；自动同步失败后 30 分钟内不重试。'
export type GarminConnection = 'connected' | 'expired' | 'not_connected'
export type GarminSyncStatus = {
  connection: GarminConnection; connectionLabel: string
  lastAttemptAt: string | null; lastAttemptResult: GarminSyncReport['status'] | null; lastAttemptLabel: string
  lastFullSuccessAt: string | null
  lastUsefulSyncAt: string | null
  partialFailure: { at: string; errors: string[]; saved: number; skipped: number } | null
  importRange: { healthFrom: string | null; healthTo: string | null; healthDaysRequested: number; healthDaysWithData: number; activityLimit: number; activityRows: number; completeHistory: boolean; label: string } | null
  autoSync: { rule: string; backoffUntil: string | null }
  details: string[]
}
type KV = { getItem(k: string): string | null }
const RESULT: Record<GarminSyncReport['status'], string> = { ok: '完整成功', partial: '部分成功', empty: '没取到可用记录', auth: '登录失效', fail: '失败', stale: '账号已切换，结果已丢弃' }
const hhmm = (iso: string | null) => { if (!iso) return '—'; const d = new Date(iso); return Number.isFinite(d.getTime()) ? `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : iso }
const latestTime = (...values: (string | null | undefined)[]): string | null => values
  .filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)))
  .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null
export function readGarminSyncStatus(subject: string, store: KV | null = typeof localStorage === 'undefined' ? null : localStorage, now = Date.now(), accountScope: string | null = null): GarminSyncStatus {
  const get = (k: string) => store?.getItem(garminStorageKey(k, subject)) ?? null
  let report: GarminSyncReport | null = null
  try { report = JSON.parse(get(GARMIN_KEYS.report) ?? 'null') } catch { report = null }
  // The verified report is authoritative. Timestamp caches may fail to update
  // without invalidating saved data, so use the newer valid report time too.
  const usefulReportAt = report && (report.status === 'ok' || report.status === 'partial' && report.saved + report.skipped > 0) ? report.at : null
  const lastAttemptAt = latestTime(get(GARMIN_KEYS.lastAttempt), report?.at)
  const lastUsefulSyncAt = latestTime(get(GARMIN_KEYS.lastUseful), usefulReportAt)
  const lastFullSuccessAt = latestTime(get(GARMIN_KEYS.lastFullOk), report?.status === 'ok' ? report.at : null)
  const connection: GarminConnection = report?.status === 'auth' ? 'expired' : (report?.accountScope || accountScope || lastUsefulSyncAt) ? 'connected' : 'not_connected'
  const failAt = Date.parse(get(GARMIN_KEYS.autoFail) ?? '') || 0
  const backoffUntil = failAt && now - failAt < 30 * 60e3 ? new Date(failAt + 30 * 60e3).toISOString() : null
  const days = [...(report?.coverageDays ?? [])].sort()
  const modeLabel = report?.mode === 'BACKFILL' ? '补齐历史' : report?.mode === 'INITIAL' ? '首次同步' : report?.mode === 'RECENT' ? '增量同步' : report?.mode === 'FULL' ? '完整复核' : ''
  const dateRange = report?.mode ? `${modeLabel} · 本次读取 ${report.healthDaysRequested} 个日期` : report && report.healthDaysRequested > 14 ? `最近 14 天 + 补更早历史 ${report.healthDaysRequested - 14} 天` : `最近 ${report?.healthDaysRequested ?? 0} 天`
  const importRange = report ? { healthFrom: days[0] ?? null, healthTo: days.at(-1) ?? null, healthDaysRequested: report.healthDaysRequested, healthDaysWithData: days.length, activityLimit: report.activityLimit, activityRows: report.activityRows, completeHistory: report.completeHistory,
    label: `健康数据：${dateRange}（${days.length} 天有数据${days.length ? `，${days[0].slice(5)}–${days.at(-1)!.slice(5)}` : ''}）；活动：最近 ${report.activityLimit} 条摘要（本次 ${report.activityRows} 条）${report.completeHistory ? '' : '，更早的历史不导入'}` } : null
  const partialFailure = report && report.status === 'partial' ? { at: report.at, errors: report.errors.slice(0, 10), saved: report.saved, skipped: report.skipped } : null
  const details = [
    `自动同步：${AUTO_SYNC_RULE}`,
    ...(backoffUntil ? [`上次自动同步失败，${hhmm(backoffUntil)} 前不再自动重试（可手动同步）`] : []),
    ...(report ? [`最近一次：${report.mode === 'INITIAL' ? '首次同步（近 90 天，中断后续补）' : report.mode === 'BACKFILL' ? '补齐历史（近期数据 + 未完成日期）' : report.mode === 'RECENT' ? '增量同步（近 3 天 + 新活动）' : report.mode === 'FULL' ? '完整复核（14 天 + 最近 200 条活动）' : '同步'}，请求 ${report.requests ?? '—'} 次；保存/更新 ${report.saved} 条，未变化 ${report.skipped} 条`] : []),
    ...(report?.errors.length ? report.errors.slice(0, 5).map(e => `问题：${e}`) : []),
  ]
  return {
    connection, connectionLabel: connection === 'connected' ? '已连接' : connection === 'expired' ? '登录已失效，请重新登录佳明' : '未连接',
    lastAttemptAt, lastAttemptResult: report?.status ?? null, lastAttemptLabel: lastAttemptAt ? `${hhmm(lastAttemptAt)} · ${report ? RESULT[report.status] : '未知'}` : '还没同步过',
    lastFullSuccessAt, lastUsefulSyncAt, partialFailure, importRange, autoSync: { rule: AUTO_SYNC_RULE, backoffUntil }, details,
  }
}
export function subscribeGarminSyncStatus(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const names = [GARMIN_SYNC_STATUS_EVENT, 'storage', 'fk-health-changed']
  for (const n of names) window.addEventListener(n, cb)
  return () => { for (const n of names) window.removeEventListener(n, cb) }
}
