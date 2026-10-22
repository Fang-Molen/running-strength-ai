import { useSyncExternalStore } from 'react'
import { ATHLETE_SCOPE_CHANGED } from '../core/events'
import { CorosError, corosNeedsLogin, saveCorosMeta } from '../health/coros-account-sync'
import {
  COROS_CONTEXT_CHANGED, captureCorosContext, isCurrentCorosContext,
  corosMcpLinked, corosMcpRecent, loadCorosHealth, refreshCorosHealth, setCorosMcpLinked,
  type CorosContext, type CorosHealthCache,
} from '../health/coros-mcp-client'

type ActivityResult = Awaited<ReturnType<typeof corosMcpRecent>>
type ReadMode = 'auto' | 'manual'
type ReadJob<T> = Readonly<{ running: boolean; mode: ReadMode | null; result: T | null; error: unknown; attemptedAt: number; token: number }>
export type CorosSyncLive = Readonly<{ context: CorosContext; activities: ReadJob<ActivityResult>; health: ReadJob<CorosHealthCache> }>
const idle = <T>(): ReadJob<T> => Object.freeze({ running: false, mode: null, result: null, error: null, attemptedAt: 0, token: 0 })
const same = (a: CorosContext, b: CorosContext) => a.athleteId === b.athleteId && a.generation === b.generation
const listeners = new Set<() => void>()
let state: CorosSyncLive | null = null, empty: CorosSyncLive | null = null, nextToken = 0
let activityPending: Promise<ActivityResult | null> | null = null, healthPending: Promise<CorosHealthCache | null> | null = null
let eventTarget: Window | null = null

function notify() { for (const listener of listeners) listener() }
function publish(next: CorosSyncLive) { state = Object.freeze(next); notify() }
/** Only ephemeral jobs/previews are cleared. Saved activities and health history stay in their existing stores. */
export function clearCorosSyncLive() {
  state = null; empty = null; activityPending = null; healthPending = null; notify()
}
function listenForContext() {
  const target = typeof window === 'undefined' ? null : window
  if (target === eventTarget) return
  eventTarget?.removeEventListener(ATHLETE_SCOPE_CHANGED, clearCorosSyncLive)
  eventTarget?.removeEventListener(COROS_CONTEXT_CHANGED, clearCorosSyncLive)
  eventTarget = target
  target?.addEventListener(ATHLETE_SCOPE_CHANGED, clearCorosSyncLive)
  target?.addEventListener(COROS_CONTEXT_CHANGED, clearCorosSyncLive)
}
export function readCorosSyncLive(): CorosSyncLive {
  listenForContext()
  const context = captureCorosContext()
  if (state && same(state.context, context)) return state
  if (!empty || !same(empty.context, context)) empty = Object.freeze({ context, activities: idle<ActivityResult>(), health: idle<CorosHealthCache>() })
  return empty
}
export function subscribeCorosSyncLive(listener: () => void) {
  listenForContext(); listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function useCorosSyncLive() { return useSyncExternalStore(subscribeCorosSyncLive, readCorosSyncLive, readCorosSyncLive) }
const stale = () => new CorosError('账号或运动员已切换，本次读取已取消。', 'STALE_CONTEXT', 0)
function current(context: CorosContext, kind: 'activities' | 'health', token: number) {
  return isCurrentCorosContext(context) && state != null && same(state.context, context) && state[kind].token === token
}

/** Automatic reads share one job across page mounts; manual reads retain the existing 28-day range. */
export function runCorosActivitySync(mode: ReadMode): Promise<ActivityResult | null> {
  const snapshot = readCorosSyncLive(), context = snapshot.context, job = snapshot.activities
  if (mode === 'auto' && !corosMcpLinked(context.athleteId)) return Promise.resolve(null)
  if (job.running && activityPending) {
    // A requested full review must never silently become a seven-day automatic check.
    if (mode === 'manual' && job.mode === 'auto') return activityPending.then(() => {
      if (!isCurrentCorosContext(context)) throw stale()
      return runCorosActivitySync('manual')
    })
    return activityPending
  }
  if (mode === 'auto' && job.attemptedAt && Date.now() - job.attemptedAt < 10 * 60e3) return Promise.resolve(job.result)
  const token = ++nextToken, attemptedAt = Date.now()
  const pending = Promise.resolve().then(async () => {
    try {
      if (!current(context, 'activities', token)) throw stale()
      const result = await corosMcpRecent(mode === 'manual' ? 28 : 7)
      if (!current(context, 'activities', token)) throw stale()
      saveCorosMeta(context.athleteId, { at: new Date().toISOString(), read: result.rows.length })
      publish({ ...state!, activities: { running: false, mode, result, error: null, attemptedAt, token } })
      return result
    } catch (error) {
      if (current(context, 'activities', token)) {
        publish({ ...state!, activities: { ...state!.activities, running: false, error } })
        if (corosNeedsLogin(error)) setCorosMcpLinked(context.athleteId, false)
      }
      throw error
    } finally { if (activityPending === pending) activityPending = null }
  })
  activityPending = pending
  publish({ ...snapshot, activities: { ...job, running: true, mode, error: null, attemptedAt, token } })
  return pending
}

/** Health reads keep the existing 30-minute freshness rule and remain visible after a page change. */
export function runCorosHealthSync(mode: ReadMode): Promise<CorosHealthCache | null> {
  const snapshot = readCorosSyncLive(), context = snapshot.context, job = snapshot.health
  if (job.running && healthPending) return healthPending
  if (mode === 'auto') {
    if (!corosMcpLinked(context.athleteId)) return Promise.resolve(null)
    const cached = loadCorosHealth(context.athleteId)
    if (cached && Date.now() - Date.parse(cached.fetchedAt) < 30 * 60e3) return Promise.resolve(cached)
    if (job.attemptedAt && Date.now() - job.attemptedAt < 60e3) return Promise.resolve(job.result)
  }
  const token = ++nextToken, attemptedAt = Date.now()
  const pending = Promise.resolve().then(async () => {
    try {
      if (!current(context, 'health', token)) throw stale()
      const result = await refreshCorosHealth(context.athleteId)
      if (!current(context, 'health', token)) throw stale()
      publish({ ...state!, health: { running: false, mode, result, error: null, attemptedAt, token } })
      return result
    } catch (error) {
      if (current(context, 'health', token)) {
        publish({ ...state!, health: { ...state!.health, running: false, error } })
        if (corosNeedsLogin(error)) setCorosMcpLinked(context.athleteId, false)
      }
      throw error
    } finally { if (healthPending === pending) healthPending = null }
  })
  healthPending = pending
  publish({ ...snapshot, health: { ...job, running: true, mode, error: null, attemptedAt, token } })
  return pending
}

export function dismissCorosActivityPreview() {
  const snapshot = readCorosSyncLive()
  publish({ ...snapshot, activities: { ...snapshot.activities, result: null } })
}
