import test from 'node:test'
import assert from 'node:assert/strict'
import { currentAthleteId, setEventContext } from '../core/events'
import { invalidateCorosContext, loadCorosHealth, setCorosMcpLinked } from '../health/coros-mcp-client'
import { loadCorosMeta } from '../health/coros-account-sync'
import { clearCorosSyncLive, dismissCorosActivityPreview, readCorosSyncLive, runCorosActivitySync, runCorosHealthSync, subscribeCorosSyncLive } from './coros-sync-live'

const activityBody = () => ({ ok: true, accountRef: 'synthetic-account', fetchedAt: new Date().toISOString(), activities: [{ labelId: 'synthetic-lap', sportType: 100, sportName: '跑步', startIso: '2026-10-22T08:00:00Z', startLocal: null, durationSec: 26.125, distanceM: 200, avgHr: 160, maxHr: 181, issues: [] }], issues: [], possiblyTruncated: false })
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const flush = () => new Promise<void>(resolve => setImmediate(resolve))
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
async function isolated(f: (store: Map<string, string>) => Promise<void>) {
  const descriptors = ['window', 'localStorage', 'fetch'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const), athlete = currentAthleteId()
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) } })
  setEventContext({ athleteId: 'synthetic-a' }); invalidateCorosContext(); clearCorosSyncLive()
  setCorosMcpLinked('synthetic-a', true)
  try { await f(store) } finally {
    invalidateCorosContext(); clearCorosSyncLive(); setEventContext({ athleteId: athlete })
    for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key) }
  }
}

test('automatic activity job survives view remount, shares one request, and never saves a training record', async () => isolated(async store => {
  const gate = deferred<Response>(); let requests = 0
  globalThis.fetch = async () => { requests++; return gate.promise }
  const first = runCorosActivitySync('auto'); await flush()
  assert.equal(readCorosSyncLive().activities.running, true)
  let updates = 0; const stop = subscribeCorosSyncLive(() => { updates++ }); stop()
  const again = runCorosActivitySync('auto'); assert.equal(first, again)
  const stopRemounted = subscribeCorosSyncLive(() => { updates++ })
  gate.resolve(reply(activityBody())); await first
  assert.equal(requests, 1); assert.equal(readCorosSyncLive().activities.running, false); assert.equal(updates, 1)
  assert.equal(readCorosSyncLive().activities.result?.rows[0].durationSec, 26.125)
  assert.equal(loadCorosMeta('synthetic-a')?.read, 1)
  assert.deepEqual([...store.keys()].filter(key => !key.startsWith('fk-coros-mcp-linked')), ['fk-coros-last-read-v1:synthetic-a'], 'reading is preview-only')
  stopRemounted()
}))

test('foreground automatic checks honor cadence while explicit manual review keeps its28-day request', async () => isolated(async () => {
  const paths: string[] = []; globalThis.fetch = async input => { paths.push(String(input)); return reply(activityBody()) }
  await runCorosActivitySync('auto'); await runCorosActivitySync('auto'); assert.equal(paths.length, 1)
  await runCorosActivitySync('manual'); assert.equal(paths.length, 2)
  const start = (path: string) => new URL(path, 'https://local.test').searchParams.get('startDate')
  assert.notEqual(start(paths[0]), start(paths[1])); assert.equal(readCorosSyncLive().activities.mode, 'manual')
  dismissCorosActivityPreview(); assert.equal(readCorosSyncLive().activities.result, null)
  await runCorosActivitySync('auto'); assert.equal(paths.length, 2); assert.equal(readCorosSyncLive().activities.result, null)
}))

test('a scope switch invalidates late activity preview and read metadata without touching either athlete', async () => isolated(async store => {
  const gate = deferred<Response>(); globalThis.fetch = async () => gate.promise
  const pending = runCorosActivitySync('auto'), rejected = assert.rejects(pending, (e: any) => e.code === 'STALE_CONTEXT'); await flush()
  setEventContext({ athleteId: 'synthetic-b' })
  assert.equal(readCorosSyncLive().context.athleteId, 'synthetic-b'); assert.equal(readCorosSyncLive().activities.running, false)
  gate.resolve(reply(activityBody())); await rejected; await flush()
  assert.equal(loadCorosMeta('synthetic-a'), null); assert.equal(loadCorosMeta('synthetic-b'), null); assert.equal(store.size, 1)
}))

test('old authorization completion cannot replace the new pending job', async () => isolated(async () => {
  const old = deferred<Response>(), fresh = deferred<Response>(); let calls = 0
  globalThis.fetch = async () => ++calls === 1 ? old.promise : fresh.promise
  const prior = runCorosActivitySync('auto'), rejected = assert.rejects(prior, (e: any) => e.code === 'STALE_CONTEXT'); await flush()
  invalidateCorosContext(); const next = runCorosActivitySync('manual'); await flush()
  old.resolve(reply(activityBody())); await rejected; await flush()
  assert.equal(readCorosSyncLive().activities.running, true); assert.equal(readCorosSyncLive().activities.mode, 'manual')
  fresh.resolve(reply(activityBody())); await next; assert.equal(readCorosSyncLive().activities.running, false)
}))

test('shared health job preserves partial existing values and releases busy state after completion', async () => isolated(async store => {
  store.set('fk-coros-mcp-health-v1:synthetic-a', JSON.stringify({sessionScope:'synthetic-session',accountRef:'synthetic-account', fetchedAt: '2026-10-20T00:00:00Z', days: [{ date: '2026-10-20', hrvMs: 48.125, sleepMinutes: 450, steps: 0 }], stress: [], recovery: null, issues: [], raw: {} }))
  const gate = deferred<Response>(); let requests = 0; globalThis.fetch = async input => String(input).endsWith('/status') ? reply({ok:true,connected:true,sessionScope:'synthetic-session',accountRef:'synthetic-account'}) : (requests++,gate.promise)
  const first = runCorosHealthSync('manual'); await flush(); const again = runCorosHealthSync('manual')
  assert.equal(first, again); assert.equal(readCorosSyncLive().health.running, true)
  gate.resolve(reply({ ok: true, sessionScope:'synthetic-session',accountRef:'synthetic-account', fetchedAt: new Date().toISOString(), days: [{ date: '2026-10-20', hrvMs: null, restingHr: 52.25 }], stress: [], recovery: null, issues: ['sleep tool deferred'], raw: {} }))
  await first; assert.equal(requests, 1); assert.equal(readCorosSyncLive().health.running, false)
  const day = loadCorosHealth('synthetic-a')!.days[0]
  assert.equal(day.hrvMs, 48.125); assert.equal(day.restingHr, 52.25); assert.equal(day.steps, 0); assert.equal(day.sleepMinutes, 450)
  await runCorosHealthSync('auto'); assert.equal(requests, 1)
}))

test('authorization errors stay visible, retain saved health and allow retry after reauthorization', async () => isolated(async store => {
  const saved = JSON.stringify({ fetchedAt: '2026-10-20T00:00:00Z', days: [{ date: '2026-10-20', hrvMs: 48.125 }], stress: [], recovery: null, issues: [], raw: {} })
  store.set('fk-coros-mcp-health-v1:synthetic-a', saved); setCorosMcpLinked('synthetic-a', true)
  globalThis.fetch = async () => reply({ ok: false, error: 'REAUTHORIZE', message: '授权已过期' }, 401)
  await assert.rejects(runCorosActivitySync('manual'), (e: any) => e.code === 'TOKEN_EXPIRED')
  assert.equal(readCorosSyncLive().activities.running, false); assert.ok(readCorosSyncLive().activities.error)
  assert.equal(store.get('fk-coros-mcp-health-v1:synthetic-a'), saved); assert.equal(store.has('fk-coros-mcp-linked-v1:synthetic-a'), false)
  invalidateCorosContext(); setCorosMcpLinked('synthetic-a', true)
  globalThis.fetch = async () => reply(activityBody()); await runCorosActivitySync('manual')
  assert.equal(readCorosSyncLive().activities.error, null); assert.equal(readCorosSyncLive().activities.result?.rows.length, 1)
}))
