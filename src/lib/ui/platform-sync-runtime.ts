import { currentAthleteId, ATHLETE_SCOPE_CHANGED } from '../core/events'
import { getNativeHealthStatus, readNativeHealth, requestNativeHealthPermissions, type NativeHealthStatus } from '../health/native-health'
import { METRIC_LABELS, type DeviceParseResult } from './device-parse'
import { validDay, validObservation, type Observation } from '../health/observation'
import type { SyncPlatform } from './device-sync-navigation'

export type RemotePlatform = Exclude<SyncPlatform, 'garmin' | 'coros'>
export type PlatformStatus = { configured: boolean; connected: boolean; accountRef: string | null; reason?: string; native?: NativeHealthStatus }
export type PlatformPreview = DeviceParseResult & { fetchedAt: string }
export type PlatformSnapshot = Readonly<{
  owner: string; status: PlatformStatus | null; checking: boolean;
  action: 'read' | 'disconnect' | 'permission' | 'unlock' | null;
  preview: PlatformPreview | null; tools: { name: string; readOnlyHint: boolean | null }[] | null;
  error: string; notice: string; lastRead: string | null;
}>
type RuntimeDeps = { owner: () => string; fetch: typeof fetch; now?: () => number }
const isNative = (p: RemotePlatform): p is 'apple_health' | 'health_connect' => p === 'apple_health' || p === 'health_connect'
const label = { polar: '博能', suunto: '颂拓', huawei: '华为运动健康', strava: 'Strava', apple_health: '苹果健康', health_connect: 'Health Connect' }
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v))
const stale = () => new Error('运动员或连接已变化，本次请求已失效。')
class PlatformRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}
const AUTH_FAILURES = new Set(['REAUTHORIZE', 'NOT_CONNECTED', 'PERSONAL_ACCESS_REQUIRED', 'PERSONAL_SETUP_REQUIRED', 'OWNER_MISMATCH', 'SCOPE_REQUIRED', 'CLIENT_AUTH_EXPIRED'])

/** Shared transient jobs. No tokens, access keys, previews or account credentials are persisted. */
export function createPlatformSyncRuntime(deps: RuntimeDeps) {
  let owner = deps.owner(), scope = 0
  const states = new Map<RemotePlatform, PlatformSnapshot>(), generations = new Map<RemotePlatform, number>()
  const jobs = new Map<string, { promise: Promise<void>; controller: AbortController }>()
  const statusAt = new Map<RemotePlatform, number>(), listeners = new Set<() => void>(), revoking = new Set<RemotePlatform>()
  const now = deps.now ?? Date.now
  const emit = () => listeners.forEach(f => f())
  function checkScope() {
    const next = deps.owner()
    if (next === owner) return
    scope++; owner = next
    for (const job of jobs.values()) job.controller.abort()
    jobs.clear(); states.clear(); generations.clear(); statusAt.clear()
  }
  function snapshot(p: RemotePlatform): PlatformSnapshot {
    checkScope()
    if (!states.has(p)) states.set(p, { owner, status: null, checking: false, action: revoking.has(p) ? 'disconnect' : null, preview: null, tools: null, error: '', notice: '', lastRead: null })
    return states.get(p)!
  }
  function patch(p: RemotePlatform, value: Partial<PlatformSnapshot>) { states.set(p, { ...snapshot(p), ...value }); emit() }
  const base = (p: RemotePlatform) => p === 'strava' ? '/api/strava-mcp' : `/api/watch-cloud/${p}`
  const route = (p: RemotePlatform, action: string, capturedOwner: string) => `${action === 'status' && p !== 'strava' ? '/api/watch-cloud' : base(p)}/${action}?athlete=${encodeURIComponent(capturedOwner)}`
  async function request(url: string, init: RequestInit, controller: AbortController, timeout = 150_000): Promise<Record<string, unknown>> {
    let timer: ReturnType<typeof setTimeout> | undefined, abort!: () => void
    const interrupted = new Promise<never>((_, reject) => {
      abort = () => reject(new Error('请求已取消或连接已失效。'))
      controller.signal.addEventListener('abort', abort, { once: true })
      timer = setTimeout(() => { reject(new Error('读取等待超时，请重试。')); controller.abort() }, timeout)
    })
    try {
      const received = (async () => { const response = await deps.fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init, signal: controller.signal }); const body: unknown = await response.json().catch(() => null); return { response, body } })()
      const { response, body } = await Promise.race([received, interrupted])
      if (!object(body)) throw new Error('同步服务返回格式异常，请重试。')
      if (!response.ok || body.ok === false) throw new PlatformRequestError(response.status, typeof body.error === 'string' ? body.error.slice(0, 160) : '', typeof body.message === 'string' ? body.message.slice(0, 500) : typeof body.error === 'string' ? body.error.slice(0, 160) : `连接请求失败（${response.status}）`)
      return body
    } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', abort) }
  }
  function launch(p: RemotePlatform, kind: 'status' | NonNullable<PlatformSnapshot['action']>, work: (ctx: { owner: string; signal: AbortController; current: () => boolean }) => Promise<Partial<PlatformSnapshot>>): Promise<void> {
    checkScope()
    const key = `${p}:${kind}`, old = jobs.get(key)
    if (old) return old.promise
    if (revoking.has(p) && kind !== 'disconnect') return Promise.reject(new Error('正在断开连接，请稍后重试。'))
    const capturedOwner = owner, capturedScope = scope, generation = generations.get(p) ?? 0, controller = new AbortController()
    const current = () => { checkScope(); return owner === capturedOwner && scope === capturedScope && (generations.get(p) ?? 0) === generation }
    patch(p, kind === 'status' ? { checking: true } : { action: kind, error: '', notice: '' })
    const promise = (async () => {
      try { const result = await work({ owner: capturedOwner, signal: controller, current }); if (!current()) throw stale(); patch(p, result); if (kind === 'status') statusAt.set(p, now()) }
      catch (error) {
        if (current()) {
          if (error instanceof PlatformRequestError && AUTH_FAILURES.has(error.code)) {
            const configured = error.code !== 'PERSONAL_SETUP_REQUIRED' && snapshot(p).status?.configured !== false
            invalidate(p)
            patch(p, { status: { configured, connected: false, accountRef: null, reason: error.code }, error: error.message })
          } else patch(p, { error: error instanceof Error ? error.message : '读取失败，请重试。' })
        }
        throw error
      }
      finally {
        if (current()) patch(p, kind === 'status' ? { checking: false } : { action: null })
        if (jobs.get(key)?.controller === controller) jobs.delete(key)
      }
    })()
    jobs.set(key, { promise, controller }); return promise
  }
  function invalidate(p: RemotePlatform) {
    checkScope(); generations.set(p, (generations.get(p) ?? 0) + 1); statusAt.delete(p)
    for (const [key, job] of jobs) if (key.startsWith(`${p}:`)) { job.controller.abort(); jobs.delete(key) }
    patch(p, { preview: null, tools: null, checking: false, action: null, error: '', notice: '' })
  }
  function refresh(p: RemotePlatform, force = false): Promise<void> {
    const state = snapshot(p)
    if (!force && state.status && (state.action === 'read' || now() - (statusAt.get(p) ?? 0) < 5000)) return Promise.resolve()
    return launch(p, 'status', async ctx => {
      if (isNative(p)) { const native = await getNativeHealthStatus(p); return { status: { configured: native.available, connected: false, accountRef: null, native }, error: '' } }
      const body = await request(route(p, 'status', ctx.owner), {}, ctx.signal, 15_000)
      const raw = p === 'strava' ? body : Array.isArray(body.providers) ? body.providers.find(x => object(x) && x.provider === p) : null
      if (!object(raw) || typeof raw.configured !== 'boolean' || typeof raw.connected !== 'boolean') throw new Error('连接状态响应不完整，请重试。')
      const accountRef = typeof raw.accountRef === 'string' ? raw.accountRef : null
      if (p !== 'strava' && raw.connected && !accountRef) throw new Error('连接状态缺少来源账号，请重新连接。')
      const changed = Boolean(state.status && (state.status.accountRef !== accountRef || state.status.connected && !raw.connected))
      if (changed) jobs.get(`${p}:read`)?.controller.abort()
      return { status: { configured: raw.configured, connected: raw.connected, accountRef, ...(typeof raw.reason === 'string' ? { reason: raw.reason } : {}) }, ...(changed ? { preview: null, tools: null, action: null } : {}), error: '' }
    })
  }
  function read(p: RemotePlatform): Promise<void> {
    return launch(p, 'read', async ctx => {
      const fetchedAt = new Date(now()).toISOString()
      if (isNative(p)) {
        const parsed = await readNativeHealth(p, { from: new Date(now() - 28 * 86_400_000).toISOString(), to: fetchedAt })
        return { preview: { ...parsed, fetchedAt }, lastRead: fetchedAt, error: '', notice: parsed.activities.length || parsed.health.length ? '读取完成，请核对后保存。' : '没有读到记录，请核对日期和系统读取权限。' }
      }
      if (p === 'strava') {
        const body = await request(route(p, 'capabilities', ctx.owner), {}, ctx.signal)
        if (body.ok !== true || !Array.isArray(body.tools) || body.dataImported !== false) throw new Error('个人 MCP 能力响应异常，未导入数据。')
        const tools = body.tools.filter(object).filter(t => typeof t.name === 'string').slice(0, 200).map(t => ({ name: String(t.name).slice(0, 200), readOnlyHint: typeof t.readOnlyHint === 'boolean' ? t.readOnlyHint : null }))
        return { tools, preview: null, lastRead: fetchedAt, notice: '已核验个人 MCP 工具列表，尚未导入方坤。', error: '' }
      }
      const body = await request(route(p, 'sync', ctx.owner), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, ctx.signal)
      if (ctx.signal.signal.aborted) throw stale()
      if (body.provider !== p || typeof body.accountRef !== 'string' || !body.accountRef || body.accountRef.length > 120 || !Array.isArray(body.activities) || !Array.isArray(body.health) || body.activities.length > 10000 || body.health.length > 10000 || typeof body.fetchedAt !== 'string' || !Number.isFinite(Date.parse(body.fetchedAt))) throw new Error('同步响应来源或格式不匹配，未导入。')
      const expectedAccount = snapshot(p).status?.accountRef
      if (expectedAccount && expectedAccount !== body.accountRef) throw new Error('来源账号已变化，请重新确认连接后读取。')
      const prefix = `${p}:${body.accountRef}:`, numeric = (v: unknown) => v === null || typeof v === 'number' && Number.isFinite(v) && v >= 0
      if (body.activities.some(a => !object(a) || typeof a.key !== 'string' || !a.key || typeof a.source !== 'string' || typeof a.sportLabel !== 'string' || typeof a.sourceIdentity !== 'string' || !a.sourceIdentity.startsWith(prefix) || !Array.isArray(a.sets) || !['RUNNING', 'STRENGTH', 'MIXED', 'UNKNOWN'].includes(String(a.sport)) || !(a.startIso === null || typeof a.startIso === 'string' && Number.isFinite(Date.parse(a.startIso))) || [a.durationSec, a.distanceM, a.avgHr, a.maxHr, a.calories, a.avgCadence, a.avgPower, a.verticalOscMm, a.groundContactMs].some(v => !numeric(v)) || a.sets.some(s => !object(s) || typeof s.name !== 'string' || [s.reps, s.weightKg, s.durationSec].some(v => !numeric(v))) || a.provenance != null && (!object(a.provenance) || a.provenance.accountRef !== body.accountRef || a.provenance.provider !== p.toUpperCase()))) throw new Error('训练记录来源或数值无效，未导入。')
      if (body.health.some(h => !object(h) || typeof h.key !== 'string' || !h.key.startsWith(prefix) || typeof h.source !== 'string' || typeof h.metric !== 'string' || !Object.hasOwn(METRIC_LABELS, h.metric) || typeof h.day !== 'string' || !validDay(h.day) || typeof h.value !== 'number' || !Number.isFinite(h.value) || h.value < 0 || !object(h.observation) || typeof h.observation.sourceId !== 'string' || !h.observation.sourceId.startsWith(prefix) || h.observation.key !== h.key || !validObservation(h.observation as Observation) || h.hrvMethod != null && !['RMSSD', 'SDNN', 'UNKNOWN'].includes(String(h.hrvMethod)))) throw new Error('健康记录来源或数值无效，未导入。')
      const notes = Array.isArray(body.issues) ? body.issues.filter((x): x is string => typeof x === 'string').slice(0, 50) : []
      const preview = { kind: '官方账号', brand: label[p], activities: body.activities, health: body.health, notes, fetchedAt: body.fetchedAt } as PlatformPreview
      return { preview, status: { configured: true, connected: true, accountRef: body.accountRef }, lastRead: body.fetchedAt, error: '', notice: body.partial === true ? '部分数据已读到，请核对后保存。' : preview.activities.length || preview.health.length ? '读取完成，请核对后保存。' : '近 28 天没有读到可用记录。' }
    })
  }
  async function disconnect(p: RemotePlatform): Promise<void> {
    const existing = jobs.get(`${p}:disconnect`); if (existing) return existing.promise
    invalidate(p); revoking.add(p)
    try { await launch(p, 'disconnect', async ctx => { const result = await request(route(p, 'disconnect', ctx.owner), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }, ctx.signal, 65_000); if (result.ok !== true) throw new Error('断开结果未确认，请刷新连接状态后重试。'); return { status: { configured: true, connected: false, accountRef: null }, preview: null, tools: null, notice: typeof result.message === 'string' ? `${result.message.slice(0, 500)} 已保存的记录保留。` : '已断开连接，已保存的记录保留。' } }) }
    finally { revoking.delete(p); if (snapshot(p).action === 'disconnect') patch(p, { action: null }) }
  }
  function permission(p: 'apple_health' | 'health_connect') {
    return launch(p, 'permission', async () => { const native = await requestNativeHealthPermissions(p); return { status: { configured: native.available, connected: false, accountRef: null, native }, notice: native.message } })
  }
  async function unlockStrava(accessKey: string) {
    await launch('strava', 'unlock', async ctx => { const result = await request(route('strava', 'unlock', ctx.owner), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessKey }) }, ctx.signal, 15_000); if (result.ok !== true) throw new Error('个人接入验证结果未确认，请重试。'); return { error: '', notice: '个人接入验证通过。' } })
    return refresh('strava', true)
  }
  function startUrl(p: Exclude<RemotePlatform, 'apple_health' | 'health_connect'>): string { return route(p, 'start', snapshot(p).owner) }
  return { snapshot, refresh, read, disconnect, permission, unlockStrava, startUrl, invalidate,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } },
    scopeChanged: () => { checkScope(); emit() },
    saved: (p: RemotePlatform, message: string, clear: boolean) => patch(p, { ...(clear ? { preview: null } : {}), notice: message, error: '' }),
  }
}

export const platformSync = createPlatformSyncRuntime({ owner: currentAthleteId, fetch: (...args) => fetch(...args) })
if (typeof window !== 'undefined') window.addEventListener(ATHLETE_SCOPE_CHANGED, platformSync.scopeChanged)
