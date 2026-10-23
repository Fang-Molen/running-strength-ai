import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlatformSyncRuntime } from './platform-sync-runtime'

const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const connected = { provider: 'polar', configured: true, connected: true, accountRef: 'p1' }
const preview = { provider: 'polar', accountRef: 'p1', fetchedAt: '2026-10-22T00:00:00Z', activities: [{ key: 'x', sourceIdentity: 'polar:p1:x', source: 'Polar', sport: 'RUNNING', sportLabel: '跑步', startIso: '2026-10-22T00:00:00Z', durationSec: 28.1, distanceM: 200, avgHr: null, maxHr: null, calories: null, avgCadence: null, avgPower: null, verticalOscMm: null, groundContactMs: null, sets: [] }], health: [], issues: [], partial: false }

test('identical status/read calls share work and reopening observes the same precise preview', async () => {
  let reads = 0, statuses = 0; const gate = deferred<Response>()
  const rt = createPlatformSyncRuntime({ owner: () => 'a', fetch: async (url) => { if (String(url).includes('/status')) { statuses++; return json({ providers: [connected] }) }; reads++; return gate.promise } })
  await Promise.all([rt.refresh('polar'), rt.refresh('polar')]); assert.equal(statuses, 1)
  const a = rt.read('polar'), b = rt.read('polar'); assert.equal(reads, 1); assert.equal(rt.snapshot('polar').action, 'read')
  gate.resolve(json(preview)); await Promise.all([a, b])
  assert.equal(rt.snapshot('polar').preview?.activities[0].durationSec, 28.1)
  assert.equal(rt.snapshot('polar').preview?.activities[0].avgHr, null)
  await rt.refresh('polar'); assert.equal(statuses, 1); assert.equal(reads, 1)
})
test('late completion cannot enter another athlete preview', async () => {
  let owner = 'a'; const gate = deferred<Response>()
  const rt = createPlatformSyncRuntime({ owner: () => owner, fetch: async () => gate.promise })
  const read = rt.read('polar'); owner = 'b'; assert.equal(rt.snapshot('polar').preview, null)
  gate.resolve(json(preview)); await assert.rejects(read, /运动员|失效/)
  assert.equal(rt.snapshot('polar').owner, 'b'); assert.equal(rt.snapshot('polar').preview, null)
})
test('disconnect invalidates pending read and releases the connection without saving data', async () => {
  const gate = deferred<Response>(); const calls: string[] = []
  const rt = createPlatformSyncRuntime({ owner: () => 'a', fetch: async (url) => { calls.push(String(url)); return String(url).includes('/disconnect') ? json({ ok: true }) : gate.promise } })
  const reading = rt.read('polar'); const stale = assert.rejects(reading, /失效|取消/)
  await rt.disconnect('polar'); gate.resolve(json(preview)); await stale
  assert.equal(rt.snapshot('polar').preview, null); assert.equal(rt.snapshot('polar').status?.connected, false)
  assert.equal(calls.filter(x => x.includes('/disconnect')).length, 1)
})
test('provider identity mismatch is rejected and a later request can retry', async () => {
  let calls = 0
  const rt = createPlatformSyncRuntime({ owner: () => 'a', fetch: async () => json(++calls === 1 ? { ...preview, provider: 'suunto' } : preview) })
  await assert.rejects(rt.read('polar'), /来源|响应/)
  assert.equal(rt.snapshot('polar').action, null); assert.equal(rt.snapshot('polar').preview, null)
  await rt.read('polar'); assert.equal(rt.snapshot('polar').preview?.activities.length, 1)
})
test('Strava discovery stays metadata-only and unlock input never appears in the snapshot', async () => {
  const sent: Array<{ url: string; body?: unknown }> = []
  const rt = createPlatformSyncRuntime({ owner: () => 'a', fetch: async (url, init) => { sent.push({ url: String(url), body: init?.body }); if (String(url).includes('/status')) return json({ configured: true, connected: false, accountRef: null }); if (String(url).includes('/unlock')) return json({ ok: true }); return json({ ok: true, tools: [{ name: 'read_activity', readOnlyHint: true }], dataImported: false }) } })
  await rt.unlockStrava('private-test-access-code')
  await rt.read('strava')
  assert.equal(rt.snapshot('strava').preview, null); assert.equal(rt.snapshot('strava').tools?.length, 1)
  assert.equal(JSON.stringify(rt.snapshot('strava')).includes('private-test-access-code'), false)
  assert.ok(sent.some(c => c.url.includes('/unlock') && String(c.body).includes('private-test-access-code')))
})

test('cloud health rows must carry the same vendor account and a valid observation', async () => {
  const health = { key: 'polar:p1:daily:STEPS:2026-10-22', source: 'Polar', metric: 'STEPS', day: '2026-10-22', value: 0, observation: { key: 'polar:p1:daily:STEPS:2026-10-22', sourceId: 'polar:p1:daily', statistic: '每日步数', syncedAt: '2026-10-22T00:00:00Z' } }
  let body: unknown = { ...preview, health: [{ ...health, observation: { ...health.observation, sourceId: 'polar:another-account:daily' } }] }
  const rt = createPlatformSyncRuntime({ owner: () => 'a', fetch: async () => json(body) })
  await assert.rejects(rt.read('polar'), /健康|来源/)
  assert.equal(rt.snapshot('polar').preview, null)
  body = { ...preview, health: [{ ...health, day: '2026-02-31' }] }
  await assert.rejects(rt.read('polar'), /健康|来源/)
  body = { ...preview, health: [health] }; await rt.read('polar')
  assert.equal(rt.snapshot('polar').preview?.health[0].value, 0)
})
test('changed vendor account status invalidates an old preview under the same athlete', async () => {
  let accountRef = 'p1'
  const rt = createPlatformSyncRuntime({ owner: () => 'a', fetch: async url => json(String(url).includes('/status') ? { providers: [{ ...connected, accountRef }] } : preview) })
  await rt.refresh('polar'); await rt.read('polar'); accountRef = 'p2'; await rt.refresh('polar', true)
  assert.equal(rt.snapshot('polar').preview, null)
  await assert.rejects(rt.read('polar'), /账号|来源/)
})
test('disconnect retains a server revocation warning after local credentials are cleared', async () => {
  const message = '本机连接凭证已删除；请到 Strava 的 My Apps 确认并撤销授权。'
  const rt = createPlatformSyncRuntime({ owner: () => 'a', fetch: async () => json({ ok: true, revoked: false, message }) })
  await rt.disconnect('strava')
  assert.ok(rt.snapshot('strava').notice.includes(message)); assert.equal(rt.snapshot('strava').status?.connected, false)
})
test('canceling a read also interrupts a stalled response body', async () => {
  const body = deferred<unknown>()
  const rt = createPlatformSyncRuntime({ owner: () => 'a', fetch: async () => ({ ok: true, json: () => body.promise }) as Response })
  const reading = rt.read('polar'); const rejected = assert.rejects(reading, /失效|取消/)
  await new Promise(resolve => setTimeout(resolve, 0)); rt.invalidate('polar')
  const outcome = await Promise.race([rejected.then(() => 'canceled'), new Promise(resolve => setTimeout(() => resolve('pending'), 30))])
  body.resolve(preview); await rejected
  assert.equal(outcome, 'canceled')
})

test('expired cloud authorization clears temporary records and exposes reconnect state', async () => {
  let expired = false
  const rt = createPlatformSyncRuntime({ owner: () => 'a', fetch: async url => String(url).includes('/status') ? json({ providers: [connected] }) : expired ? json({ error: 'REAUTHORIZE', message: '授权已失效，请重新连接。' }, 401) : json(preview) })
  await rt.refresh('polar'); await rt.read('polar'); expired = true
  await assert.rejects(rt.read('polar'), /重新连接/)
  assert.equal(rt.snapshot('polar').status?.connected, false)
  assert.equal(rt.snapshot('polar').status?.reason, 'REAUTHORIZE')
  assert.equal(rt.snapshot('polar').preview, null)
  assert.equal(rt.snapshot('polar').action, null)
})
test('expired Strava personal access returns to the access-key gate', async () => {
  const rt = createPlatformSyncRuntime({ owner: () => 'a', fetch: async url => String(url).includes('/status') ? json({ configured: true, connected: true, accountRef: null }) : json({ error: 'PERSONAL_ACCESS_REQUIRED', message: '请重新验证个人接入。' }, 401) })
  await rt.refresh('strava'); await assert.rejects(rt.read('strava'), /个人接入/)
  assert.equal(rt.snapshot('strava').status?.reason, 'PERSONAL_ACCESS_REQUIRED')
  assert.equal(rt.snapshot('strava').status?.connected, false)
  assert.equal(rt.snapshot('strava').action, null)
})

test('an application error inside an HTTP 200 response is never accepted as a successful read', async () => {
  const rt = createPlatformSyncRuntime({ owner: () => 'a', fetch: async () => json({ ...preview, ok: false, error: 'REJECTED', message: '服务未能确认本次数据。' }) })
  await assert.rejects(rt.read('polar'), /未能确认/)
  assert.equal(rt.snapshot('polar').preview, null)
  assert.equal(rt.snapshot('polar').status, null)
})

test('A to B to A scope notifications invalidate old work even when the final owner string matches', async () => {
  const gate=deferred<Response>();let owner='a'
  const rt=createPlatformSyncRuntime({owner:()=>owner,fetch:async()=>gate.promise})
  const pending=rt.read('polar'), rejected=assert.rejects(pending,/失效|取消/)
  owner='b';rt.scopeChanged();owner='a';rt.scopeChanged()
  gate.resolve(json(preview));await rejected
  assert.equal(rt.snapshot('polar').owner,'a');assert.equal(rt.snapshot('polar').preview,null)
})
