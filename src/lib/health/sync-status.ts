/**
 * 同步状态契约（R1 FK-SET-001）：只读聚合，供「设备连接与同步」及各入口共用。
 * 不写任何存储、不改同步采集逻辑。另一条线发布共享同步模块后，只需让它产出同一 SyncDisplay 结构即可替换本适配层。
 *
 * 口径：
 *  - lastAttemptAt      = fk-garmin-last-attempt:<athlete>（每次账号同步尝试都写）
 *  - lastCompleteSuccessAt = 共享契约 readGarminSyncStatus().lastFullSuccessAt（fk-garmin-last-full-ok，仅完整成功才写）
 *  - lastUsefulSyncAt    = 共享契约 lastUsefulSyncAt（fk-garmin-last-sync，v76 起「部分成功但取得数据」也写，不能当完整成功）
 *  - status / 数量 / 覆盖范围 / 错误 = fk-garmin-sync-report:<athlete>（最近一次尝试的报告）
 *  - 本机设备文件导入 = 已确认健康记录里 observation.sourceId 以 "import:" 开头者；
 *    佳明账号同步写入的健康记录 sourceId 以 "garmin:" 开头。两者不互相顶替时间。
 */
import { readGarminSyncStatus } from './garmin-sync-status.ts'
export type SyncProvider = 'garmin_account' | 'device_file_import'
export type SyncStatus = 'never' | 'running' | 'ok' | 'partial' | 'failed' | 'auth' | 'unknown'
export type SyncDisplay = {
  provider: SyncProvider
  label: string
  /** true 已连接 / false 未连接 / null 无法确认（服务不可达或未查询） */
  connected: boolean | null
  lastAttemptAt: string | null
  lastCompleteSuccessAt: string | null
  /** 最近一次取得可用数据（含部分成功）；只用于说明，不等于完整成功 */
  lastUsefulSyncAt: string | null
  /** 共享契约推断的连接状态（无网络探测时使用） */
  contractConnection: 'connected' | 'expired' | 'not_connected' | null
  /** 最近一次尝试为部分成功时的时间；否则 null */
  lastPartialAt: string | null
  status: SyncStatus
  activityRows: number | null
  healthRows: number | null
  saved: number | null
  skipped: number | null
  coveredFrom: string | null
  coveredTo: string | null
  healthDaysRequested: number | null
  activityLimit: number | null
  errors: { message: string }[]
}
type KV = { getItem(k: string): string | null }
const enc = (key: string, subject: string) => `${key}:${encodeURIComponent(subject)}`
const iso = (v: string | null) => (v && Number.isFinite(Date.parse(v)) ? v : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)

export function readGarminSyncDisplay(storage: KV, subject: string, connected: boolean | null, running = false): SyncDisplay {
  const attempt = iso(storage.getItem(enc('fk-garmin-last-attempt', subject)))
  const shared = readGarminSyncStatus(subject, storage)
  const success = iso(shared.lastFullSuccessAt)
  let report: Record<string, unknown> | null = null, unreadable = false
  const raw = storage.getItem(enc('fk-garmin-sync-report', subject))
  if (raw) { try { const v = JSON.parse(raw); report = v && typeof v === 'object' ? v : null; if (!report) unreadable = true } catch { unreadable = true } }
  const rs = typeof report?.status === 'string' ? report.status : null
  const status: SyncStatus = running ? 'running' : unreadable ? 'unknown' : !report && !attempt ? 'never'
    : rs === 'ok' ? 'ok' : rs === 'partial' ? 'partial' : rs === 'auth' ? 'auth' : rs === 'fail' || rs === 'empty' || rs === 'stale' ? 'failed' : 'unknown'
  const days = Array.isArray(report?.coverageDays) ? (report!.coverageDays as unknown[]).filter((d): d is string => typeof d === 'string').sort() : []
  const errors = Array.isArray(report?.errors) ? (report!.errors as unknown[]).filter((e): e is string => typeof e === 'string').map(message => ({ message })) : []
  if (unreadable) errors.unshift({ message: '同步报告无法读取（已保留原记录，未覆盖）' })
  if (rs === 'empty') errors.unshift({ message: '本次未取得可用记录' })
  return {
    provider: 'garmin_account', label: '佳明账号', connected,
    lastAttemptAt: attempt ?? iso(typeof report?.at === 'string' ? report.at : null), lastCompleteSuccessAt: success, lastUsefulSyncAt: iso(shared.lastUsefulSyncAt), contractConnection: unreadable ? null : shared.connection,
    lastPartialAt: rs === 'partial' ? attempt : null, status,
    activityRows: num(report?.activityRows), healthRows: num(report?.healthRows), saved: num(report?.saved), skipped: num(report?.skipped),
    coveredFrom: days[0] ?? null, coveredTo: days.at(-1) ?? null, healthDaysRequested: num(report?.healthDaysRequested), activityLimit: num(report?.activityLimit), errors,
  }
}
export type ObservationLike = { sourceId?: string; syncedAt?: string; day?: string }
/** 本机文件导入：从已确认记录统计，不读佳明账号同步写入的行。 */
export function readDeviceImportDisplay(obs: ObservationLike[]): SyncDisplay {
  const mine = obs.filter(o => typeof o.sourceId === 'string' && o.sourceId.startsWith('import:'))
  const at = mine.map(o => iso(o.syncedAt ?? null)).filter((x): x is string => Boolean(x)).sort().at(-1) ?? null
  const days = mine.map(o => o.day).filter((d): d is string => typeof d === 'string' && /^\d{4}-\d\d-\d\d$/.test(d)).sort()
  return { provider: 'device_file_import', label: '本机设备文件导入', connected: null, lastAttemptAt: null, lastCompleteSuccessAt: at, lastUsefulSyncAt: at, contractConnection: null, lastPartialAt: null,
    status: at ? 'ok' : 'never', activityRows: null, healthRows: mine.length || null, saved: null, skipped: null, coveredFrom: days[0] ?? null, coveredTo: days.at(-1) ?? null, healthDaysRequested: null, activityLimit: null, errors: [] }
}
export function latestGarminReceipt(obs: ObservationLike[]): string | null {
  return obs.filter(o => o.sourceId?.startsWith('garmin:')).map(o => iso(o.syncedAt ?? null)).filter((x): x is string => Boolean(x)).sort().at(-1) ?? null
}
export const STATUS_TEXT: Record<SyncStatus, string> = { never: '从未尝试', running: '正在同步', ok: '成功', partial: '部分成功', failed: '失败', auth: '需要重新登录', unknown: '状态无法确认' }
export function fmtTime(v: string | null, now = new Date()): string {
  if (!v) return '暂无记录'
  const d = new Date(v), same = d.toDateString() === now.toDateString()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return same ? `今天 ${hm}` : `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
}
/** 一行摘要：用于一级菜单。 */
export function syncSummary(g: SyncDisplay, now = new Date()): string {
  if (g.connected === false && g.status === 'never') return '佳明账号未连接'
  const head = g.connected === true ? '佳明账号 · 已连接' : g.connected === false ? '佳明账号 · 未登录' : g.contractConnection === 'expired' ? '佳明账号 · 登录已失效' : '佳明账号 · 连接状态待确认'
  if (g.status === 'never') return `${head} · 尚未同步`
  return `${head} · 最近尝试 ${fmtTime(g.lastAttemptAt, now)}（${STATUS_TEXT[g.status]}）`
}
