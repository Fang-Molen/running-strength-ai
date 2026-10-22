import test from 'node:test'
import assert from 'node:assert/strict'
import { readProviderPreview, CloudFault, type CloudGrant } from './cloud-providers.ts'

const NOW = Date.parse('2026-10-22T12:00:00Z')
const GRANT: CloudGrant = { access: 'SYNTHETIC_ACCESS', refresh: null, expiresAt: null, vendorId: 'synthetic-account', accountRef: 'a'.repeat(32) }
const workout = (id: number) => ({ workoutKey: String(id), activityId: 1, startTime: NOW - 3600_000, totalTime: 0.1, totalDistance: 1.25 })

test('a spent operation budget starts no upstream request', async () => {
  let requests = 0
  const deps = { env: {}, now: () => NOW, deadlineAt: NOW - 1, fetch: (async () => { requests++; return Response.json([]) }) as typeof fetch }
  await assert.rejects(readProviderPreview(deps, 'polar', GRANT), (error: unknown) => error instanceof CloudFault && error.code === 'UPSTREAM_TIMEOUT')
  assert.equal(requests, 0)
})

test('a pagination time budget preserves verified pages and explicitly marks partial data', async () => {
  let now = NOW, requests = 0
  const deps = { env: { SUUNTO_SUBSCRIPTION_KEY: 'synthetic-key' }, now: () => now, deadlineAt: NOW + 45000, fetch: (async () => {
    requests++
    assert.equal(requests, 1)
    now += 46000
    return Response.json({ error: null, payload: Array.from({ length: 100 }, (_, i) => workout(i)) })
  }) as typeof fetch }
  const result = await readProviderPreview(deps, 'suunto', GRANT)
  assert.equal(result.activities.length, 100)
  assert.equal(result.activities[0].durationSec, 0.1)
  assert.equal(result.partial, true)
  assert.ok(result.issues.some(x => x.includes('UPSTREAM_TIMEOUT')))
  assert.equal(requests, 1)
})

test('Suunto pagination stops at 500 records and reports its cap', async () => {
  const offsets: string[] = []
  const deps = { env: { SUUNTO_SUBSCRIPTION_KEY: 'synthetic-key' }, now: () => NOW, fetch: (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (url.pathname !== '/v3/workouts') return Response.json([])
    const offset = url.searchParams.get('offset')!; offsets.push(offset)
    return Response.json({ error: null, payload: Array.from({ length: 100 }, (_, i) => workout(Number(offset) + i)) })
  }) as typeof fetch }
  const result = await readProviderPreview(deps, 'suunto', GRANT)
  assert.deepEqual(offsets, ['0', '100', '200', '300', '400'])
  assert.equal(result.activities.length, 500)
  assert.equal(result.partial, true)
  assert.ok(result.issues.some(x => x.includes('500')))
})

test('the 500-record cap also holds when an upstream response ignores its requested page size', async () => {
  const deps = { env: { SUUNTO_SUBSCRIPTION_KEY: 'synthetic-key' }, now: () => NOW, fetch: (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (url.pathname !== '/v3/workouts') return Response.json([])
    const offset = Number(url.searchParams.get('offset'))
    return Response.json({ error: null, payload: Array.from({ length: 150 }, (_, i) => workout(offset * 10 + i)) })
  }) as typeof fetch }
  const result = await readProviderPreview(deps, 'suunto', GRANT)
  assert.equal(result.activities.length, 500)
  assert.equal(result.partial, true)
  assert.ok(result.issues.some(x => x.includes('100')))
})
