/** v89.10：浏览器端调用 /api/coros-mcp（官方 MCP 授权）。令牌只在服务端 HttpOnly cookie；这里只拿解析后的数据。 */
import type { DeviceActivity, DeviceParseResult } from '../ui/device-parse'
import type { McpActivity, McpDay, McpLap, Recovery, StressPoint } from './coros-mcp-parse'
import { CorosError, corosSport } from './coros-account-sync'
import { corosProvenance } from './brand-isolation'
// @ts-ignore 研究模块（纯 JS）：日级标准化 + 同品牌基准
import { normalizeCorosDailyBatch } from './coros-mcp-daily-v1.mjs'
// @ts-ignore
import { projectDailyTrend } from './coros-crossbrand-trend.mjs'

async function call(path: string, init?: RequestInit) {
  const r = await fetch('/api/coros-mcp/' + path, { credentials: 'same-origin', ...init })
  const body = await r.json().catch(() => null) as ({ ok?: boolean; message?: string; error?: string } & Record<string, unknown>) | null
  if (!body) throw new CorosError('高驰中转没有返回有效数据', 'NO_BODY', r.status)
  if (!body.ok) throw new CorosError(body.message || '高驰请求失败', body.error === 'REAUTHORIZE' || body.error === 'NOT_CONNECTED' ? 'TOKEN_EXPIRED' : String(body.error ?? 'UNKNOWN'), r.status)
  return body
}
export type McpStatus = { connected: boolean; region: 'auto' | 'cn' | null; host: string | null; refBasis: 'account' | 'unknown' | null; renewable: boolean; since: number | null }
export const corosMcpStatus = () => call('status') as unknown as Promise<McpStatus>
export const corosMcpStartUrl = (region: 'auto' | 'cn') => `/api/coros-mcp/start?region=${region}`
export const corosMcpDisconnect = () => call('disconnect', { method: 'POST' }) as unknown as Promise<{ revoked: boolean }>
/** 旧账号密码登录（已停用）的 cookie 是否还在：只用来提示“重新授权一次”。 */
export async function legacyCorosLoggedIn(): Promise<boolean> { try { const r = await fetch('/api/coros/status', { credentials: 'same-origin' }); const b = await r.json(); return !!b?.loggedIn } catch { return false } }
export async function legacyCorosLogout() { try { await fetch('/api/coros/logout', { method: 'POST', credentials: 'same-origin' }) } catch { /* ignore */ } }

const sportOf = (a: McpActivity): DeviceActivity['sport'] => { const s = corosSport(a.sportType); if (s !== 'UNKNOWN') return s; return /run|跑/i.test(a.sportName ?? '') ? 'RUNNING' : /strength|力量/i.test(a.sportName ?? '') ? 'STRENGTH' : 'UNKNOWN' }
/** “yyyy-MM-ddTHH:mm:ss”（高驰账号时区，文档未给偏移）按本机时区解读 → 带时区 ISO；标记 assumed。 */
const localToIso = (s: string | null) => { if (!s) return null; const t = new Date(s); return Number.isFinite(t.getTime()) ? t.toISOString() : null }
export type McpPreview = DeviceActivity & { labelId: string; sportType: number | null; timeAssumed: boolean; issues: string[] }
export function mcpToDevice(list: McpActivity[], ref: string | null, receivedAt: string): { rows: McpPreview[]; unusable: McpActivity[]; other: number } {
  const rows: McpPreview[] = [], unusable: McpActivity[] = []; let other = 0
  for (const a of list) {
    const sport = sportOf(a); if (sport === 'UNKNOWN') { other++; continue }
    const startIso = a.startIso ?? localToIso(a.startLocal)
    if (!a.labelId || !/^[0-9A-Za-z_-]{1,40}$/.test(a.labelId) || !startIso) { unusable.push(a); continue }
    const id = `coros:${ref ?? 'mcp'}:${a.labelId}`
    rows.push({ key: id, sourceIdentity: id, source: '高驰官方授权', sport, sportLabel: sport === 'RUNNING' ? '跑步' : '力量', startIso, durationSec: a.durationSec, distanceM: a.distanceM, avgHr: a.avgHr, maxHr: a.maxHr,
      calories: null, avgCadence: null, avgPower: null, verticalOscMm: null, groundContactMs: null, sets: [], provenance: corosProvenance(ref ?? '', a.labelId, startIso, receivedAt),
      labelId: a.labelId, sportType: a.sportType, timeAssumed: !a.startIso, issues: a.issues })
  }
  return { rows, unusable, other }
}
const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
export async function corosMcpRecent(days = 28, now = new Date()) {
  const b = await call(`activities?startDate=${ymd(new Date(now.getTime() - (days - 1) * 86400e3))}`) as unknown as { accountRef: string | null; fetchedAt: string; activities: McpActivity[]; issues: string[]; possiblyTruncated: boolean }
  const m = mcpToDevice(b.activities, b.accountRef, b.fetchedAt)
  const result: DeviceParseResult = { kind: '高驰官方授权', brand: 'COROS', activities: m.rows, health: [], notes: [] }
  return { ...m, result, issues: b.issues, truncated: b.possiblyTruncated, total: b.activities.length }
}
export async function corosMcpLaps(labelId: string, sportType: number) { return call(`laps?labelId=${encodeURIComponent(labelId)}&sportType=${sportType}`) as unknown as Promise<{ laps: McpLap[]; issues: string[] }> }

// ---------- 健康缓存（本机，按运动员分开；只存高驰返回并解析成功的值） ----------
export type CorosHealthCache = { fetchedAt: string; days: McpDay[]; stress: StressPoint[]; recovery: (Recovery & { at: string }) | null; issues: string[]; raw: Record<string, string> }
const hKey = (athlete: string) => `fk-coros-mcp-health-v1:${athlete}`, linkKey = (athlete: string) => `fk-coros-mcp-linked-v1:${athlete}`
export const corosMcpLinked = (athlete: string) => { try { return localStorage.getItem(linkKey(athlete)) === '1' } catch { return false } }
export function setCorosMcpLinked(athlete: string, on: boolean) { try { on ? localStorage.setItem(linkKey(athlete), '1') : localStorage.removeItem(linkKey(athlete)) } catch { /* ignore */ } try { window.dispatchEvent(new Event('fk-coros-changed')) } catch { /* node */ } }
export function loadCorosHealth(athlete: string): CorosHealthCache | null { try { const v = JSON.parse(localStorage.getItem(hKey(athlete)) ?? 'null'); return v && Array.isArray(v.days) ? v : null } catch { return null } }
export function mergeCorosHealth(old: CorosHealthCache | null, b: { fetchedAt: string; days: McpDay[]; stress: StressPoint[]; recovery: Recovery | null; issues: string[]; raw: Record<string, string> }): CorosHealthCache {
  const days = new Map((old?.days ?? []).map(d => [d.date, d]))
  for (const d of b.days) days.set(d.date, { ...days.get(d.date), ...Object.fromEntries(Object.entries(d).filter(([, v]) => v != null)) } as McpDay)
  const keyOf = (p: StressPoint) => p.iso ?? p.local ?? '', stress = new Map((old?.stress ?? []).map(p => [keyOf(p), p])); for (const p of b.stress) stress.set(keyOf(p), p)
  const cutoff = new Date(Date.parse(b.fetchedAt) - 8 * 86400e3).toISOString().slice(0, 10)
  return { fetchedAt: b.fetchedAt, days: [...days.values()].sort((x, y) => x.date.localeCompare(y.date)).slice(-90), stress: [...stress.values()].filter(p => keyOf(p).slice(0, 10) >= cutoff).sort((x, y) => keyOf(x).localeCompare(keyOf(y))),
    recovery: b.recovery && b.recovery.percent != null ? { ...b.recovery, at: b.fetchedAt } : old?.recovery ?? null, issues: b.issues, raw: b.raw }
}
export async function refreshCorosHealth(athlete: string): Promise<CorosHealthCache> {
  const b = await call('health') as unknown as Parameters<typeof mergeCorosHealth>[1]
  const next = mergeCorosHealth(loadCorosHealth(athlete), b)
  try { localStorage.setItem(hKey(athlete), JSON.stringify(next)) } catch { /* storage full */ }
  return next
}
/** 同品牌（只高驰）、同指标、同协议的个人基准：至少 7 个此前完整日，否则 null（研究模块 coros-crossbrand-trend）。 */
export function corosTrend(days: McpDay[], athlete: string, today: string) {
  const batch = { provider: 'COROS_MCP', verifiedOwner: true, athleteId: athlete, accountRef: 'session', days: days.map(d => ({ date: d.date, recordId: 'd-' + d.date, steps: d.steps ?? null, activeEnergyKcal: d.activeKcal ?? null, sleepMinutes: d.sleepMinutes ?? null, restingHr: d.restingHr ?? null, sleepHrvMs: d.hrvMs ?? null, final: d.date < today })) }
  const { facts } = normalizeCorosDailyBatch(batch, athlete)
  return projectDailyTrend(facts, { provider: 'COROS', referenceDays: 7 }) as { date: string; restingHr: number | null; sleepMinutes: number | null; hrvMs: number | null; steps: number | null; reference: { restingHr: number | null; sleepMinutes: number | null; hrvMs: number | null } }[]
}
