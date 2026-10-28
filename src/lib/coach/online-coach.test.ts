import test from 'node:test'
import assert from 'node:assert/strict'
import { activityFacts, type GActivity } from './plain-coach.ts'
import { garminRpe } from '../ui/training-read-model.ts'
// @ts-ignore js function
import { onRequestPost } from '../../../functions/api/coach-chat.js'
const run: GActivity = { id: 99, sourceIdentity: 'garmin:abc:99', name: '杭州市 跑步', type: 'running', start: '2026-10-18T05:54:00Z', dist: 6010, dur: 1898, avgHr: 144, maxHr: 162, cad: 172, elev: 12, cal: 400, sets: null, reps: null, tl: 85, te: 2.9 }
test('facts are de-identified: no activity name/city, id or source identity', () => {
  const f = activityFacts(run, [{ i: 1, dist: 1000, dur: 316, avgHr: 140, maxHr: 150, cad: 170, elev: 2, speed: null }]).join('\n')
  assert.match(f, /跑步：6\.01 km/); assert.match(f, /第1段/)
  for (const bad of ['杭州', 'garmin:abc', '99']) assert.equal(f.includes(bad), false, bad)
})
test('garmin directWorkoutRpe 10-100 maps to RPE 1-10', () => {
  assert.equal(garminRpe(70), 7); assert.equal(garminRpe(null), null); assert.equal(garminRpe(5), 5); assert.equal(garminRpe(300), null)
})
const req = (body: unknown, ip = '1.1.1.1') => new Request('https://x/api/coach-chat', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: typeof body === 'string' ? body : JSON.stringify(body) })
test('public coach route requires trusted bindings even with an API key and client facts', async () => {
  const orig = globalThis.fetch; let calls = 0
  globalThis.fetch = (async () => { calls++; throw Error('must not dispatch') }) as any
  try {
    const disabled = await onRequestPost({ request: req({ question: 'q', facts: 'f' }), env: { DEEPSEEK_API_KEY: 'SYNTHETIC' } })
    assert.equal(disabled.status, 503); assert.equal((await disabled.json()).error, 'SERVICE_DISABLED')
    const unbound = await onRequestPost({ request: req({ question: 'q', facts: 'f', verifiedOwner: true }), env: { FANGKUN_DEEPSEEK_ENABLED: 'true', DEEPSEEK_API_KEY: 'SYNTHETIC' } })
    assert.equal(unbound.status, 503); assert.equal((await unbound.json()).error, 'TRUSTED_BINDINGS_MISSING'); assert.equal(calls, 0)
  } finally { globalThis.fetch = orig }
})
test('C03 merge: client question cap matches trusted server boundary (1000); over-limit or control chars never fetch', async () => {
  const { askOnlineCoach, ONLINE_QUESTION_MAX } = await import('./online-coach.ts')
  assert.equal(ONLINE_QUESTION_MAX, 1000)
  const orig = globalThis.fetch; let calls = 0
  globalThis.fetch = (async () => { calls++; return new Response(JSON.stringify({ text: 'ok', ok: true, planChanged: false })) }) as any
  try {
    const base = { facts: '', local: '', history: [], snapshotRef: {snapshotId: 'synthetic', consentId: 'synthetic', asOf: '2026-10-20T00:00:00.000Z'} }
    assert.ok('error' in await askOnlineCoach({ ...base, question: '问'.repeat(1001) })); assert.equal(calls, 0)
    assert.ok('error' in await askOnlineCoach({ ...base, question: 'a\u0001b' })); assert.equal(calls, 0)
    assert.deepEqual(await askOnlineCoach({ ...base, question: '问'.repeat(1000) }), { text: 'ok' }); assert.equal(calls, 1)
  } finally { globalThis.fetch = orig }
})
test('all online adapters share v2 assertions: fabricated personal numbers and writes fail', async () => {
  const { askOnlineCoach } = await import('./online-coach.ts')
  const orig = globalThis.fetch; let text = ''
  globalThis.fetch = (async () => new Response(JSON.stringify({ ok: true, text, planChanged: false }))) as any
  try {
    const base = { facts: '', local: '', history: [], question: '今天我跑的咋样', snapshotRef: {snapshotId: 'synthetic', consentId: 'synthetic', asOf: '2026-10-20T00:00:00.000Z'} } // S1 fusion: requests are snapshot-reference only
    text = '你今天跑了99999米。'
    assert.ok('error' in await askOnlineCoach(base))
    text = '可以先说明目前资料，缺少的数据仍保持未知。'
    assert.deepEqual(await askOnlineCoach(base), { text })
    text = '我已经替你修改了计划。'
    const r = await askOnlineCoach(base)
    assert.ok('error' in r); if ('error' in r) assert.match(r.error, /未授权修改或解除限制/)
  } finally { globalThis.fetch = orig }
})
