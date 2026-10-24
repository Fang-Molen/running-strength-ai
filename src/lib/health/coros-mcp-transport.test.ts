import test from 'node:test'
import assert from 'node:assert/strict'
import * as client from './coros-mcp-client'
import {setEventContext} from '../core/events'

function browser(t: {after(fn: () => void): void}, athlete = 'synthetic-coros-a') {
  const names = ['fetch', 'window', 'localStorage'] as const
  const originals = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const)
  const data = new Map<string, string>(), writes: string[] = []
  const win = new EventTarget()
  Object.defineProperty(globalThis, 'window', {configurable: true, value: win})
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, value: {getItem: (key: string) => data.get(key) ?? null, setItem(key: string, value: string) {data.set(key, value); writes.push(key)}, removeItem: (key: string) => data.delete(key)}})
  setEventContext({athleteId: athlete})
  client.captureCorosContext()
  t.after(() => { client.invalidateCorosContext(); for (const [name, original] of originals) original ? Object.defineProperty(globalThis, name, original) : Reflect.deleteProperty(globalThis, name) })
  return {data, writes, win}
}
function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify({ok: true, ...body}), {status, headers: {'content-type': 'application/json'}})
}
const statusBody = {sessionScope:'synthetic-session', accountRef:'synthetic-account', connected: true, region: 'cn', host: 'mcpcn.coros.com', refBasis: 'account', renewable: true, since: 1}
const healthBody = (fetchedAt = '2026-10-22T12:00:00Z', value = 48.125) => ({sessionScope:'synthetic-session',accountRef:'synthetic-account',fetchedAt, days: [{date: '2026-10-22', hrvMs: value}], stress: [{iso: '2026-10-22T09:00:00Z', local: null, value: 33.375}], recovery: {percent: 80.625, level: null, fullRecoveryText: null}, issues: [], raw: {querySleepHrv: 'synthetic source decimal 48.125'}})

const flush = () => new Promise<void>(resolve=>setImmediate(resolve))
function scopedHealthFetch(read: typeof fetch): typeof fetch { return ((url,init)=>String(url).endsWith('/status') ? Promise.resolve(response(statusBody)) : read(url,init)) as typeof fetch }

test('simultaneous status readers share one request and preserve returned status', async t => {
  browser(t, 'synthetic-status-readers')
  let calls = 0
  const replies: ((r: Response) => void)[] = []
  globalThis.fetch = (() => {calls++;return new Promise<Response>(resolve => replies.push(resolve))}) as typeof fetch
  const pending = [client.corosMcpStatus(), client.corosMcpStatus(), client.corosMcpStatus()]
  await Promise.resolve()
  replies.forEach(resolve => resolve(response(statusBody)))
  const values = await Promise.all(pending)
  assert.equal(calls, 1)
  assert.equal(values.length, 3); values.forEach(value => assert.equal(value.connected, true))
})

test('simultaneous health readers share request and commit while preserving decimals', async t => {
  const box = browser(t, 'synthetic-health-readers')
  let calls = 0, changes = 0
  box.win.addEventListener('fk-coros-changed', () => changes++)
  const replies: ((r: Response) => void)[] = []
  globalThis.fetch = scopedHealthFetch((() => {calls++;return new Promise<Response>(resolve => replies.push(resolve))}) as typeof fetch)
  const pending = [client.refreshCorosHealth('synthetic-health-readers'), client.refreshCorosHealth('synthetic-health-readers')]
  await flush()
  replies.forEach(resolve => resolve(response(healthBody())))
  const values = await Promise.all(pending)
  assert.equal(calls, 1); assert.equal(box.writes.length, 1); assert.equal(changes, 1)
  assert.equal(values[0].days[0].hrvMs, 48.125)
  assert.equal(values[0].stress[0].value, 33.375)
  assert.equal(values[0].recovery?.percent, 80.625)
  assert.deepEqual(values[0], values[1])
})

test('status reads during disconnect wait for revocation without changing the completion context', async t => {
  const box = browser(t, 'synthetic-disconnect-status')
  let connected = true, changes = 0
  box.win.addEventListener(client.COROS_CONTEXT_CHANGED, () => changes++)
  const requests: {url: string; connected: boolean; resolve: (value: Response) => void}[] = []
  globalThis.fetch = ((input: RequestInfo | URL) => new Promise<Response>(resolve => requests.push({url: String(input), connected, resolve}))) as typeof fetch
  const disconnect = client.corosMcpDisconnect()
  const context = client.captureCorosContext()
  const status = client.corosMcpStatus()
  const statusBeforeRevocation = requests.filter(request => request.url.endsWith('/status')).length
  connected = false
  requests.find(request => request.url.endsWith('/disconnect'))!.resolve(response({revoked: true}))
  await disconnect
  await Promise.resolve()
  for (const request of requests.filter(request => request.url.endsWith('/status'))) request.resolve(response({...statusBody, connected: request.connected}))
  const value = await status
  assert.equal(statusBeforeRevocation, 0)
  assert.equal(value.connected, false)
  assert.equal((await client.corosMcpStatus()).connected, false)
  assert.equal(client.isCurrentCorosContext(context), true)
  assert.equal(changes, 1)
})

test('disconnect stops new health, activity and lap reads before they can use the old session', async t => {
  const athlete = 'synthetic-disconnect-data', box = browser(t, athlete)
  client.setCorosMcpLinked(athlete, true)
  const urls: string[] = []
  let revoke!: (r: Response) => void
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = String(input); urls.push(url)
    if (url.endsWith('/disconnect')) return new Promise<Response>(resolve => { revoke = resolve })
    if (url.endsWith('/health')) return Promise.resolve(response(healthBody()))
    if (url.includes('/activities?')) return Promise.resolve(response({activities: [], accountRef: 'test', fetchedAt: '2026-10-22T12:00:00Z', issues: [], possiblyTruncated: false}))
    return Promise.resolve(response({laps: [], issues: []}))
  }) as typeof fetch
  const disconnect = client.corosMcpDisconnect()
  const linkedImmediately = client.corosMcpLinked(athlete)
  const reads = Promise.allSettled([client.refreshCorosHealth(athlete), client.corosMcpRecent(7), client.corosMcpLaps('synthetic-lap', 100)])
  revoke(response({revoked: true}))
  await disconnect
  const outcomes = await reads
  const later = await Promise.allSettled([client.refreshCorosHealth(athlete), client.corosMcpRecent(28), client.corosMcpLaps('synthetic-lap', 100)])
  assert.equal(linkedImmediately, false)
  assert.equal(urls.filter(url => !url.endsWith('/disconnect')).length, 0)
  assert.equal(box.writes.filter(key => key.includes('health')).length, 0)
  for (const outcome of [...outcomes, ...later]) {
    assert.equal(outcome.status, 'rejected')
    if (outcome.status === 'rejected') assert.equal(outcome.reason.code, 'TOKEN_EXPIRED')
  }
})

test('an older status cannot restore authorization after a newer data read reports TOKEN_EXPIRED', async t => {
  browser(t, 'synthetic-expired-auth')
  const context = client.captureCorosContext()
  let resolveStatus!: (r: Response) => void
  let calls = 0
  globalThis.fetch = ((input: RequestInfo | URL) => {
    calls++
    return String(input).endsWith('/status') ? new Promise<Response>(resolve => {resolveStatus = resolve}) : Promise.resolve(response({ok: false, error: 'REAUTHORIZE'}, 401))
  }) as typeof fetch
  const status = Promise.allSettled([client.corosMcpStatus()])
  await assert.rejects(client.corosMcpRecent(7), {code: 'TOKEN_EXPIRED'})
  resolveStatus(response(statusBody))
  const [outcome] = await status
  assert.equal(outcome.status, 'rejected')
  if (outcome.status === 'rejected') assert.equal(outcome.reason.code, 'TOKEN_EXPIRED')
  assert.equal(client.isCurrentCorosContext(context), true)
  await assert.rejects(client.corosMcpStatus({force: true}), {code: 'TOKEN_EXPIRED'})
  await assert.rejects(client.corosMcpLaps('expired-session', 100), {code: 'TOKEN_EXPIRED'})
  assert.equal(calls, 2)
  client.invalidateCorosContext()
  globalThis.fetch = (() => Promise.resolve(response(statusBody))) as typeof fetch
  assert.equal((await client.corosMcpStatus({force: true})).connected, true)
})

test('status cache lasts five seconds, supports an explicit refresh and returns independent values', async t => {
  browser(t, 'synthetic-status-cache')
  let calls = 0, now = 10_000
  const originalNow = Date.now
  Date.now = () => now
  t.after(() => { Date.now = originalNow })
  globalThis.fetch = (() => Promise.resolve(response({...statusBody, since: ++calls}))) as typeof fetch
  const first = await client.corosMcpStatus()
  first.connected = false
  now += 4999
  assert.equal((await client.corosMcpStatus()).connected, true)
  assert.equal(calls, 1)
  now++
  assert.equal((await client.corosMcpStatus()).since, 2)
  assert.equal((await client.corosMcpStatus({force: true})).since, 3)
  client.invalidateCorosContext()
  assert.equal((await client.corosMcpStatus()).since, 4)
})

test('only identical pending activity and lap paths share work, preserving source identity and decimal values', async t => {
  browser(t, 'synthetic-paths')
  const requests: {url: string; resolve: (r: Response) => void}[] = []
  globalThis.fetch = ((input: RequestInfo | URL) => new Promise<Response>(resolve => requests.push({url: String(input), resolve}))) as typeof fetch
  const activity = {labelId: 'precise-run', sportType: 100, sportName: 'Run', date: '2026-10-20', startIso: '2026-10-20T07:05:00.000Z', startLocal: null, durationSec: 1810.125, distanceM: 5020.75, avgHr: 150.5, maxHr: null, calories: null, issues: ['source note']}
  const activities = {activities: [activity], accountRef: 'synthetic-account', fetchedAt: '2026-10-22T12:00:00Z', issues: ['partial source'], possiblyTruncated: true}
  const laps = {laps: [{index: 1, timeSec: 301.125, distanceRaw: 1000.25, avgHr: null}], issues: ['lap note']}
  const now = new Date('2026-10-22T12:00:00Z')
  const recent = [client.corosMcpRecent(7, now), client.corosMcpRecent(7, now), client.corosMcpRecent(7, now), client.corosMcpRecent(28, now)]
  const split = [client.corosMcpLaps('precise-run', 100), client.corosMcpLaps('precise-run', 100), client.corosMcpLaps('precise-run', 100), client.corosMcpLaps('precise-run', 200)]
  for (const request of requests) request.resolve(response(request.url.includes('/activities?') ? activities : laps))
  const rows = await Promise.all(recent), splitRows = await Promise.all(split)
  assert.equal(requests.length, 4)
  assert.equal(new Set(requests.map(request => request.url)).size, 4)
  assert.equal(rows[0].rows[0].durationSec, 1810.125)
  assert.equal(rows[0].rows[0].distanceM, 5020.75)
  assert.equal(rows[0].rows[0].avgHr, 150.5)
  assert.equal(rows[0].rows[0].maxHr, null)
  assert.equal(rows[0].rows[0].sourceIdentity, 'coros:synthetic-account:precise-run')
  assert.equal(rows[0].rows[0].provenance?.recordId, 'precise-run')
  assert.deepEqual(rows[0].issues, ['partial source']); assert.equal(rows[0].truncated, true)
  assert.equal(splitRows[0].laps[0].timeSec, 301.125)
  rows[0].rows[0].distanceM = 1; splitRows[0].laps[0].timeSec = 1
  assert.equal(rows[1].rows[0].distanceM, 5020.75); assert.equal(splitRows[1].laps[0].timeSec, 301.125)
  const again = client.corosMcpRecent(7, now)
  requests.at(-1)!.resolve(response(activities)); await again
  const lapAgain = client.corosMcpLaps('precise-run', 100)
  requests.at(-1)!.resolve(response(laps)); await lapAgain
  assert.equal(requests.length, 6, 'completed activities/laps are not cached')
})

test('athlete switch aborts old health work and prevents any old-owner commit or return', async t => {
  const box = browser(t, 'synthetic-owner-a')
  const context = client.captureCorosContext()
  let changes = 0
  box.win.addEventListener(client.COROS_CONTEXT_CHANGED, () => changes++)
  const requests: {signal: AbortSignal; resolve: (r: Response) => void}[] = []
  globalThis.fetch = scopedHealthFetch(((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>(resolve => requests.push({signal: init!.signal!, resolve}))) as typeof fetch)
  const old = Promise.allSettled([client.refreshCorosHealth('synthetic-owner-a')])
  await flush()
  setEventContext({athleteId: 'synthetic-owner-b'})
  assert.equal(requests[0].signal.aborted, true)
  assert.equal(client.isCurrentCorosContext(context), false)
  assert.equal(changes, 1)
  const next = client.refreshCorosHealth('synthetic-owner-b')
  await flush()
  requests[0].resolve(response(healthBody('2026-10-22T11:00:00Z', 40.375)))
  requests[1].resolve(response(healthBody('2026-10-22T12:00:00Z', 60.125)))
  const [outcome] = await old
  assert.equal(outcome.status, 'rejected')
  if (outcome.status === 'rejected') assert.equal(outcome.reason.code, 'STALE_CONTEXT')
  assert.equal((await next).days[0].hrvMs, 60.125)
  assert.deepEqual(box.writes, ['fk-coros-mcp-health-v1:synthetic-owner-b'])
  await assert.rejects(client.refreshCorosHealth('synthetic-owner-a'), {code: 'STALE_CONTEXT'})
  assert.equal(requests.length, 2)
})

test('new authorization releases an old disconnect lane without invalidating the new context', async t => {
  browser(t, 'synthetic-new-authorization')
  let resolveDisconnect!: (r: Response) => void, statusCalls = 0
  globalThis.fetch = ((input: RequestInfo | URL) => String(input).endsWith('/disconnect')
    ? new Promise<Response>(resolve => { resolveDisconnect = resolve })
    : (statusCalls++, Promise.resolve(response(statusBody)))) as typeof fetch
  const disconnect = Promise.allSettled([client.corosMcpDisconnect()])
  const waiting = Promise.allSettled([client.corosMcpStatus(), client.refreshCorosHealth('synthetic-new-authorization')])
  client.invalidateCorosContext()
  const context = client.captureCorosContext()
  assert.equal((await client.corosMcpStatus()).connected, true)
  resolveDisconnect(response({revoked: true}))
  for (const outcome of [...await disconnect, ...await waiting]) {
    assert.equal(outcome.status, 'rejected')
    if (outcome.status === 'rejected') assert.equal(outcome.reason.code, 'STALE_CONTEXT')
  }
  assert.equal(client.isCurrentCorosContext(context), true)
  assert.equal((await client.corosMcpStatus()).connected, true)
  assert.equal(statusCalls, 1, 'old disconnect completion must not clear the new status cache')
})

test('athlete changes keep the shared-cookie revocation barrier until disconnect settles', async t => {
  const box = browser(t, 'synthetic-revoke-owner-a')
  let connected = true, resolveDisconnect!: (r: Response) => void, disconnectSignal!: AbortSignal
  const urls: string[] = []
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); urls.push(url)
    if (url.endsWith('/disconnect')) {
      disconnectSignal = init!.signal!
      return new Promise<Response>(resolve => {resolveDisconnect = resolve})
    }
    return Promise.resolve(response(url.endsWith('/status') ? {...statusBody, connected} : healthBody()))
  }) as typeof fetch
  const disconnect = Promise.allSettled([client.corosMcpDisconnect()])
  const oldContext = client.captureCorosContext()
  setEventContext({athleteId: 'synthetic-revoke-owner-b'})
  const wasAborted = disconnectSignal.aborted
  const health = Promise.allSettled([client.refreshCorosHealth('synthetic-revoke-owner-b')])
  const status = client.corosMcpStatus()
  const callsBeforeRevocation = urls.length
  connected = false
  resolveDisconnect(response({revoked: true}))
  await disconnect
  const [outcome] = await health
  assert.equal((await status).connected, false)
  assert.equal(wasAborted, false)
  assert.equal(callsBeforeRevocation, 1)
  assert.equal(urls.some(url => url.endsWith('/health')), false)
  assert.equal(outcome.status, 'rejected')
  if (outcome.status === 'rejected') assert.equal(outcome.reason.code, 'TOKEN_EXPIRED')
  assert.equal(client.isCurrentCorosContext(oldContext), false)
  assert.equal(box.writes.filter(key => key.includes('health')).length, 0)
})

test('an older fetchedAt cannot overwrite or return in place of newer locally saved health', async t => {
  const athlete = 'synthetic-freshness', box = browser(t, athlete)
  const key = 'fk-coros-mcp-health-v1:' + athlete
  let resolveHealth!: (r: Response) => void
  globalThis.fetch = scopedHealthFetch((() => new Promise<Response>(resolve => {resolveHealth = resolve})) as typeof fetch)
  const old = client.refreshCorosHealth(athlete)
  const newer = {...client.mergeCorosHealth(null, healthBody('2026-10-22T12:10:00Z', 60.125)),sessionScope:'synthetic-session'}
  box.data.set(key, JSON.stringify(newer))
  await flush()
  resolveHealth(response(healthBody('2026-10-22T12:00:00Z', 40.375)))
  await assert.rejects(old, {code: 'STALE_DATA'})
  assert.equal(box.data.get(key), JSON.stringify(newer)); assert.equal(box.writes.length, 0)
  const next = client.refreshCorosHealth(athlete)
  await flush()
  resolveHealth(response(healthBody('2026-10-22T12:20:00Z', 61.875)))
  assert.equal((await next).days[0].hrvMs, 61.875)
  assert.equal(box.writes.length, 1)
})

test('quota failure preserves the saved cache and never emits a successful health-write notification', async t => {
  const athlete = 'synthetic-quota', box = browser(t, athlete), key = 'fk-coros-mcp-health-v1:' + athlete
  const old = {...client.mergeCorosHealth(null, healthBody('2026-10-22T11:00:00Z', 40.375)),sessionScope:'synthetic-session'}
  box.data.set(key, JSON.stringify(old))
  let changes = 0
  box.win.addEventListener('fk-coros-changed', () => changes++)
  localStorage.setItem = () => { throw new Error('synthetic quota full') }
  globalThis.fetch = scopedHealthFetch((() => Promise.resolve(response(healthBody()))) as typeof fetch)
  await assert.rejects(client.refreshCorosHealth(athlete), /保存失败/)
  assert.equal(box.data.get(key), JSON.stringify(old))
  assert.equal(changes, 0)
})

test('linked metadata emits only when its persisted state changes', t => {
  const athlete = 'synthetic-linked', box = browser(t, athlete)
  let changes = 0
  box.win.addEventListener('fk-coros-changed', () => changes++)
  client.setCorosMcpLinked(athlete, false)
  client.setCorosMcpLinked(athlete, true)
  client.setCorosMcpLinked(athlete, true)
  client.setCorosMcpLinked(athlete, false)
  client.setCorosMcpLinked(athlete, false)
  assert.equal(changes, 2)
  assert.equal(client.corosMcpLinked(athlete), false)
})

test('network, malformed-body and rate-limit failures release pending reads for a manual retry', async t => {
  browser(t, 'synthetic-retry')
  const failures = [
    {code: 'NETWORK_ERROR', fetch: () => Promise.reject(new TypeError('synthetic offline'))},
    {code: 'NO_BODY', fetch: () => Promise.resolve(new Response('not-json'))},
    {code: 'RATE_LIMIT', fetch: () => Promise.resolve(response({ok: false, error: 'RATE_LIMIT', message: 'synthetic limit'}, 429))},
  ]
  for (const failure of failures) {
    client.invalidateCorosContext()
    let calls = 0
    globalThis.fetch = (() => {calls++;return failure.fetch()}) as typeof fetch
    const outcomes = await Promise.allSettled([client.corosMcpLaps('retry', 100), client.corosMcpLaps('retry', 100)])
    assert.equal(calls, 1)
    for (const outcome of outcomes) {
      assert.equal(outcome.status, 'rejected')
      if (outcome.status === 'rejected') assert.equal(outcome.reason.code, failure.code)
    }
    globalThis.fetch = (() => {calls++;return Promise.resolve(response({laps: [], issues: []}))}) as typeof fetch
    assert.deepEqual((await client.corosMcpLaps('retry', 100)).laps, [])
    assert.equal(calls, 2)
  }
})

test('each endpoint has a bounded deadline, aborts its fetch and permits retry after timeout', async t => {
  browser(t, 'synthetic-timeouts')
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout
  const timers = new Map<number, {callback: () => void; ms: number}>()
  let serial = 0
  globalThis.setTimeout = ((callback: () => void, ms: number) => {const id = ++serial;timers.set(id, {callback, ms});return id}) as unknown as typeof setTimeout
  globalThis.clearTimeout = ((id: number) => { timers.delete(id) }) as unknown as typeof clearTimeout
  t.after(() => {globalThis.setTimeout = originalSet;globalThis.clearTimeout = originalClear})
  const cases = [
    {read: () => client.corosMcpStatus(), ms: 15_000, body: statusBody},
    {read: () => client.corosMcpRecent(7), ms: 150_000, body: {activities: [], issues: [], fetchedAt: '2026-10-22T12:00:00Z'}},
    {read: () => client.corosMcpLaps('timeout', 100), ms: 150_000, body: {laps: [], issues: []}},
    {read: () => client.refreshCorosHealth('synthetic-timeouts'), ms: 180_000, body: healthBody()},
    {read: () => client.corosMcpDisconnect(), ms: 35_000, body: {revoked: true}},
  ]
  for (const item of cases) {
    client.invalidateCorosContext()
    let signal!: AbortSignal
    globalThis.fetch = (item.ms===180_000 ? scopedHealthFetch : (fn:typeof fetch)=>fn)(((_input: RequestInfo | URL, init?: RequestInit) => {signal = init!.signal!;return new Promise<Response>(() => {})}) as typeof fetch)
    const result = item.read()
    await flush()
    const timer = [...timers.values()].at(-1)!
    assert.equal(timer.ms, item.ms)
    timer.callback()
    await assert.rejects(result, {code: 'TIMEOUT', status: 408})
    assert.equal(signal.aborted, true)
    assert.equal(timers.size, 0)
    let retryCalls = 0
    globalThis.fetch = (item.ms===180_000 ? scopedHealthFetch : (fn:typeof fetch)=>fn)((() => {retryCalls++;return Promise.resolve(response(item.body))}) as typeof fetch)
    await item.read()
    assert.equal(retryCalls, 1)
    assert.equal(timers.size, 0)
  }
})
