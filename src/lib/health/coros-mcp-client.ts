/** v89.10：浏览器端调用 /api/coros-mcp（官方 MCP 授权）。令牌只在服务端 HttpOnly cookie；这里只拿解析后的数据。 */
import type { DeviceActivity, DeviceParseResult } from '../ui/device-parse'
import type { McpActivity, McpDay, McpLap, Recovery, StressPoint } from './coros-mcp-parse'
import { CorosError, corosSport } from './coros-account-sync'
import { corosProvenance } from './brand-isolation'
import { ATHLETE_SCOPE_CHANGED, currentAthleteId } from '../core/events'
import { healthChanged } from './observation'
import { currentStore } from '../core/storage'
// @ts-ignore 研究模块（纯 JS）：日级标准化 + 同品牌基准
import { normalizeCorosDailyBatch } from './coros-mcp-daily-v1.mjs'
// @ts-ignore
import { projectDailyTrend } from './coros-crossbrand-trend.mjs'

export const COROS_CONTEXT_CHANGED = 'fk-coros-context-changed'
export type CorosContext = Readonly<{ athleteId: string; generation: number }>
// The server allows 25s per upstream request. Data reads also initialize MCP;
// health has three waves of two tools and may refresh/retry a rejected token.
export const COROS_REQUEST_TIMEOUT_MS = { status: 15_000, activities: 150_000, laps: 150_000, health: 180_000, disconnect: 35_000 } as const
type Reply = { ok?: boolean; message?: string; error?: string } & Record<string, unknown>
let generation = 0, contextAthlete = currentAthleteId(), scopeTarget: EventTarget | null = null
const pending = new Map<string, Promise<Reply>>(), controllers = new Set<AbortController>()
const statusCache = new Map<string, { body: Reply; until: number }>()
const healthPending = new Map<string, Promise<CorosHealthCache>>()
let disconnectPending: Promise<void> | null = null
let disconnectController: AbortController | null = null
let disconnected = false, authorizationRequired = false
const staleContext = () => new CorosError('运动员或高驰授权已改变，已忽略本次返回。', 'STALE_CONTEXT', 409)
const expiredAuthorization = () => new CorosError('高驰授权已失效，请重新授权。', 'TOKEN_EXPIRED', 401)
function watchScope() {
  const target = typeof window === 'undefined' ? null : window
  if (target === scopeTarget) return
  scopeTarget?.removeEventListener(ATHLETE_SCOPE_CHANGED, onAthleteScopeChanged)
  scopeTarget = target
  scopeTarget?.addEventListener(ATHLETE_SCOPE_CHANGED, onAthleteScopeChanged)
}
function resetCorosContext(disconnectBarrier: Promise<void> | null = null, preserveSession = false): void {
  watchScope(); generation++; contextAthlete = currentAthleteId()
  disconnectPending = disconnectBarrier
  if (!preserveSession) { disconnected = false; authorizationRequired = false }
  for (const controller of controllers) {
    if (preserveSession && controller === disconnectController) continue
    controller.abort(); controllers.delete(controller)
  }
  pending.clear(); statusCache.clear(); healthPending.clear()
  scopeTarget?.dispatchEvent(new Event(COROS_CONTEXT_CHANGED))
}
// Session cookies are shared across athlete views; switching views must not release an active revocation.
function onAthleteScopeChanged(): void { resetCorosContext(disconnectPending, true) }
/** Clear only ephemeral requests/status, never imported records or credentials. */
export function invalidateCorosContext(): void { resetCorosContext() }
export function captureCorosContext(): CorosContext {
  watchScope()
  if (contextAthlete !== currentAthleteId()) onAthleteScopeChanged()
  return Object.freeze({ athleteId: contextAthlete, generation })
}
export function isCurrentCorosContext(context: CorosContext): boolean {
  const current = captureCorosContext()
  return context.athleteId === current.athleteId && context.generation === current.generation
}
function requireContext(context: CorosContext) { if (!isCurrentCorosContext(context)) throw staleContext() }
function requireReadContext(context: CorosContext) { requireContext(context); if (authorizationRequired) throw expiredAuthorization() }
const requestKey = (context: CorosContext, path: string) => JSON.stringify([context.athleteId, context.generation, path])
function call(path: string, init?: RequestInit, options: { force?: boolean } = {}): Promise<Reply> {
  const context = captureCorosContext(), key = requestKey(context, path), read = !init?.method || init.method === 'GET'
  const barrier = path === 'disconnect' ? disconnectPending : null
  const requireRequestContext = () => { if (!barrier || disconnectPending !== barrier) requireContext(context) }
  if (read && authorizationRequired) return Promise.reject(expiredAuthorization())
  if (read && path !== 'status') {
    if (disconnectPending) return disconnectPending.then(() => { requireContext(context); return call(path, init, options) })
    if (disconnected) return Promise.reject(new CorosError('高驰连接已断开，请重新授权。', 'TOKEN_EXPIRED', 401))
  }
  const copy = (body: Reply) => { read ? requireReadContext(context) : requireRequestContext(); return structuredClone(body) }
  if (read && path === 'status') {
    if (options.force) statusCache.delete(key)
    const cached = statusCache.get(key)
    if (cached && cached.until > Date.now()) return Promise.resolve().then(() => copy(cached.body))
    statusCache.delete(key)
  }
  const shared = read ? pending.get(key) : null
  if (shared) return shared.then(copy)
  const controller = new AbortController()
  controllers.add(controller)
  if (barrier) disconnectController = controller
  let timedOut = false
  const endpoint = path.split('?')[0] as keyof typeof COROS_REQUEST_TIMEOUT_MS
  const timeout = setTimeout(() => { timedOut = true; controller.abort() }, COROS_REQUEST_TIMEOUT_MS[endpoint] ?? 150_000)
  const cancelled = new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(timedOut
    ? new CorosError('高驰读取超时，请稍后重试。已保存的记录不受影响。', 'TIMEOUT', 408)
    : staleContext()), { once: true }))
  const work = (async () => {
    const r = await fetch('/api/coros-mcp/' + path, { credentials: 'same-origin', ...init, signal: controller.signal })
    const body = await r.json().catch(() => null) as Reply | null
    requireRequestContext()
    if (!body) throw new CorosError('高驰中转没有返回有效数据', 'NO_BODY', r.status)
    if (!body.ok) throw new CorosError(body.message || '高驰请求失败', body.error === 'REAUTHORIZE' || body.error === 'NOT_CONNECTED' ? 'TOKEN_EXPIRED' : String(body.error ?? 'UNKNOWN'), r.status)
    return body
  })()
  const request = Promise.race([work, cancelled]).then(body => {
    read ? requireReadContext(context) : requireRequestContext()
    if (read && path === 'status') statusCache.set(key, { body, until: Date.now() + 5_000 })
    return body
  }).catch(error => {
    requireRequestContext()
    if (error instanceof CorosError) { if (error.code === 'TOKEN_EXPIRED') { authorizationRequired = true; statusCache.clear() } throw error }
    throw new CorosError('高驰请求未完成，请检查网络后重试。', 'NETWORK_ERROR', 0)
  }).finally(() => {
    clearTimeout(timeout); controllers.delete(controller)
    if (disconnectController === controller) disconnectController = null
    if (pending.get(key) === request) pending.delete(key)
  })
  if (read) pending.set(key, request)
  return request.then(copy)
}
export type McpStatus = { sessionScope?: string | null; accountRef?: string | null; ownership?: 'OAUTH_SESSION_ONLY'; athleteOwnershipVerified?: boolean; connected: boolean; region: 'auto' | 'cn' | null; host: string | null; refBasis: 'account' | 'unknown' | null; renewable: boolean; since: number | null }
export function corosMcpStatus(options: { force?: boolean } = {}): Promise<McpStatus> {
  const context = captureCorosContext()
  // Do not read the old cookie while a disconnect is still revoking it.
  const read = () => { requireContext(context); return call('status', undefined, options) as unknown as Promise<McpStatus> }
  return disconnectPending ? disconnectPending.then(read) : read()
}
export const corosMcpStartUrl = (region: 'auto' | 'cn') => `/api/coros-mcp/start?region=${region}`
export const corosMcpDisconnect = () => {
  const previous = captureCorosContext()
  setCorosMcpLinked(previous.athleteId, false, false)
  let settled!: () => void
  const barrier = new Promise<void>(resolve => { settled = resolve })
  // Install the barrier before notifying subscribers; a subscriber may read status immediately.
  resetCorosContext(barrier)
  const context = captureCorosContext()
  return call('disconnect', { method: 'POST' }).then(body => {
    if (disconnectPending !== barrier) throw staleContext()
    disconnected = true
    return body
  }).finally(() => {
    if (isCurrentCorosContext(context)) statusCache.clear()
    if (disconnectPending === barrier) disconnectPending = null
    settled()
  }) as unknown as Promise<{ revoked: boolean }>
}
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
export type CorosHealthCache = { athleteId?: string; sessionScope?: string; ownership?: 'OAUTH_SESSION_ONLY'; knownAtByDay?: Record<string,string>; accountRef?: string | null; dayUpdatedAt?: Record<string, Record<string, string>>; fetchedAt: string; days: McpDay[]; stress: StressPoint[]; recovery: (Recovery & { at: string }) | null; issues: string[]; raw: Record<string, string> }
const hKey = (athlete: string) => `fk-coros-mcp-health-v1:${athlete}`, linkKey = (athlete: string) => `fk-coros-mcp-linked-v1:${athlete}`
export const corosMcpLinked = (athlete: string) => { try { return localStorage.getItem(linkKey(athlete)) === '1' } catch { return false } }
export function setCorosMcpLinked(athlete: string, on: boolean, invalidate = true) { if (!on && invalidate && healthPending.size) invalidateCorosContext(); try { if ((localStorage.getItem(linkKey(athlete)) === '1') === on) return; on ? localStorage.setItem(linkKey(athlete), '1') : localStorage.removeItem(linkKey(athlete)) } catch { return } try { window.dispatchEvent(new Event('fk-coros-changed')) } catch { /* node */ } }
export function loadCorosHealth(athlete: string): CorosHealthCache | null { try { const v = JSON.parse(currentStore()?.getItem(hKey(athlete)) ?? 'null'); return v && Array.isArray(v.days) && (!v.athleteId || v.athleteId===athlete) ? v : null } catch { return null } }
export function mergeCorosHealth(old: CorosHealthCache | null, b: { accountRef?: string | null; fetchedAt: string; days: McpDay[]; stress: StressPoint[]; recovery: Recovery | null; issues: string[]; raw: Record<string, string> }): CorosHealthCache {
  // Never merge a different authenticated account into the previous account's cache.
  const accountRef = b.accountRef ?? null
  if (old && (old.accountRef ?? null) !== accountRef) old = null
  const dayUpdatedAt: Record<string, Record<string, string>> = {}
  for (const d of old?.days ?? []) dayUpdatedAt[d.date] = Object.fromEntries(
    Object.entries(d).filter(([k, v]) => k !== 'date' && v != null)
      .map(([k]) => [k, old?.dayUpdatedAt?.[d.date]?.[k] ?? old!.fetchedAt]))
  for (const d of b.days) for (const [k, v] of Object.entries(d)) if (k !== 'date' && v != null) {
    (dayUpdatedAt[d.date] ??= {})[k] = b.fetchedAt
  }
  const days = new Map((old?.days ?? []).map(d => [d.date, d]))
  for (const d of b.days) days.set(d.date, { ...days.get(d.date), ...Object.fromEntries(Object.entries(d).filter(([, v]) => v != null)) } as McpDay)
  const keyOf = (p: StressPoint) => p.iso ?? p.local ?? '', stress = new Map((old?.stress ?? []).map(p => [keyOf(p), p])); for (const p of b.stress) stress.set(keyOf(p), p)
  const cutoff = new Date(Date.parse(b.fetchedAt) - 8 * 86400e3).toISOString().slice(0, 10)
  return { knownAtByDay: {...old?.knownAtByDay,...Object.fromEntries(b.days.map(d=>[d.date,b.fetchedAt]))}, accountRef, dayUpdatedAt: Object.fromEntries(Object.entries(dayUpdatedAt).sort(([a], [b]) => a.localeCompare(b)).slice(-90)), fetchedAt: b.fetchedAt, days: [...days.values()].sort((x, y) => x.date.localeCompare(y.date)).slice(-90), stress: [...stress.values()].filter(p => keyOf(p).slice(0, 10) >= cutoff).sort((x, y) => keyOf(x).localeCompare(keyOf(y))),
    recovery: b.recovery && b.recovery.percent != null ? { ...b.recovery, at: b.fetchedAt } : old?.recovery ?? null, issues: b.issues, raw: b.raw }
}
export function refreshCorosHealth(athlete: string): Promise<CorosHealthCache> {
  const context = captureCorosContext()
  if (athlete !== context.athleteId) return Promise.reject(staleContext())
  const key = requestKey(context, 'health')
  const copy = (value: CorosHealthCache) => { requireReadContext(context); return structuredClone(value) }
  const shared = healthPending.get(key)
  if (shared) return shared.then(copy)
  const request = (async () => {
    if (disconnectPending) await disconnectPending
    requireReadContext(context)
    if (disconnected) throw expiredAuthorization()
    const before = await corosMcpStatus({force:true})
    requireReadContext(context)
    if (!before.connected || !before.sessionScope) throw new CorosError('授权范围未核对，未写入本地缓存','SCOPE_UNAVAILABLE',409)
    const b = await call('health') as unknown as Parameters<typeof mergeCorosHealth>[1] & {sessionScope?:string}
    const after = await corosMcpStatus({force:true})
    requireReadContext(context)
    if (!after.connected || b.sessionScope!==before.sessionScope || b.sessionScope!==after.sessionScope) throw new CorosError('账号已改变，丢弃迟到响应','STALE_SCOPE',409)
    requireReadContext(context)
    const old = loadCorosHealth(athlete)
    if (old && Date.parse(b.fetchedAt) < Date.parse(old.fetchedAt)) throw new CorosError('本次返回早于本机记录，已保留较新的高驰数据。', 'STALE_DATA', 409)
    const scopedOld = old?.sessionScope === b.sessionScope ? old : null
    const next = {...mergeCorosHealth(scopedOld, b), athleteId:athlete, sessionScope:b.sessionScope!, ownership:'OAUTH_SESSION_ONLY' as const}
    if(old && old.sessionScope!==next.sessionScope) {
      try {const box=currentStore(); if(!box) throw Error('NOSTORE'); box.setItem(hKey(athlete)+':archive:'+encodeURIComponent(old.sessionScope??'legacy'), JSON.stringify(old))}
      catch {throw new CorosError('旧账号缓存保存失败，未替换当前缓存','STORAGE_WRITE_FAILED',507)}
    }
    let saved = false
    try { const box = currentStore(); if (!box) throw Error('NOSTORE'); const raw = JSON.stringify(next); box.setItem(hKey(athlete), raw); saved = box.getItem(hKey(athlete)) === raw } catch { /* storage full */ }
    if (!saved) throw new CorosError('高驰数据已取得，但本机保存失败；保留上次数据，请检查存储空间后重试。', 'STORAGE_WRITE_FAILED', 507)
    healthChanged(); try { window.dispatchEvent(new Event('fk-coros-changed')) } catch { /* node */ }
    return next
  })().finally(() => { if (healthPending.get(key) === request) healthPending.delete(key) })
  healthPending.set(key, request)
  return request.then(copy)
}
/** Descriptive within-cache reference. No browser-created verifiedOwner or fabricated protocol. */
export function corosTrend(days: McpDay[], athlete: string, today: string) {
  const sorted=days.filter(d=>d.date<=today).sort((a,b)=>a.date.localeCompare(b.date))
  const med=(xs:(number|null|undefined)[])=>{const a=xs.filter((x):x is number=>typeof x==='number'&&Number.isFinite(x)).sort((a,b)=>a-b);return a.length===7?a[3]:null}
  return sorted.map((d,i)=>{const prev=sorted.slice(0,i).filter(x=>x.date<d.date).slice(-7);return {date:d.date,restingHr:d.restingHr??null,sleepMinutes:d.sleepMinutes??null,hrvMs:d.hrvMs??null,steps:d.steps??null,reference:{restingHr:med(prev.map(x=>x.restingHr)),sleepMinutes:med(prev.map(x=>x.sleepMinutes)),hrvMs:med(prev.map(x=>x.hrvMs))},sampleCount:prev.length,asOf:today,athleteId:athlete,protocol:'PROVIDER_UNSPECIFIED',ownership:'LOCAL_SCOPE_NOT_SERVER_ATHLETE_PROOF'}})
}
