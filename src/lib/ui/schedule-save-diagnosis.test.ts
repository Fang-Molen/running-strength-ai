import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { saveScheduledEntry, loadSchedule, SCHEDULE_KEY } from './day-schedule'
import { lastScheduleFailure, describeScheduleFailure } from './schedule-writer'
import { setStoreBackend } from '../core/storage'
import { setEventContext } from '../core/events'

const ex = (i: number) => ({ id: `ex${i}`, catalogId: `c${i}`, name: i === 0 ? '坐姿哑铃推举' : `动作${i}`, sets: '3', reps: '10', weight: '', restSec: 75, rpe: '', unit: 'reps' as const })
const strength = (id = 'custom:abc'): any => ({ id, date: '2026-10-27', title: '力量 · 5个动作', kind: 'strength', modality: 'strength', trainingType: 'strength', focus: [], minutes: 40, intensity: 'MODERATE', lowerHeavy: false, source: 'custom', refId: null, status: 'planned', slot: 'pm', exercises: [0, 1, 2, 3, 4].map(ex) })
const old = (n: number): any => ({ ...strength(`old${n}`), date: '2026-09-01', status: 'done', title: 'x'.repeat(200), athleteId: 'local' })
/** 浏览器式配额：键+值总字符数超限就抛 QuotaExceededError（与 Safari/Chrome 行为一致）。 */
function quotaBox(limit: number) {
  const d = new Map<string, string>(); const used = () => [...d].reduce((n, [k, v]) => n + k.length + v.length, 0)
  const box = { getItem: (k: string) => d.get(k) ?? null, keys: () => [...d.keys()], setItem: (k: string, v: string) => {
    const prev = d.get(k); if (used() - (prev === undefined ? 0 : k.length + prev.length) + k.length + v.length > limit) { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e }
    d.set(k, v) } }
  return { d, box }
}
let m: ReturnType<typeof quotaBox>
beforeEach(() => { m = quotaBox(5_000_000); setStoreBackend(m.box); setEventContext({ athleteId: 'local' }) })
afterEach(() => { setStoreBackend(null) })

test('a normal 5-exercise 40-minute strength entry is small and saves', async () => {
  const e = strength(); assert.ok(JSON.stringify(e).length < 2000)
  assert.deepEqual(await saveScheduledEntry(e), { ok: true })
  assert.equal(loadSchedule().entries.length, 1)
})
test('E-QUOTA: full browser storage is named, with the biggest keys; the draft is not lost', async () => {
  m.d.set('fk-big-chat', 'y'.repeat(4_999_000))
  const r = await saveScheduledEntry(strength())
  assert.equal(r.ok, false); assert.match(r.reason!, /^本机保存失败，草稿保留。/); assert.match(r.reason!, /E-QUOTA/); assert.match(r.reason!, /fk-big-chat/)
  assert.equal(lastScheduleFailure()?.code, 'E-QUOTA'); assert.equal(m.d.has(SCHEDULE_KEY), false)
  m.d.delete('fk-big-chat'); assert.deepEqual(await saveScheduledEntry(strength()), { ok: true }, 'frees space -> same entry saves')
})
test('v89.11.13 no quota amplification: pending-write holds hashes only, so a ~1.5M-char calendar now saves in a 5M-char store (it failed before)', async () => {
  m.d.set(SCHEDULE_KEY, JSON.stringify({ entries: Array.from({ length: 1500 }, (_, i) => old(i)), acks: [] }))
  const r = await saveScheduledEntry(strength()); assert.deepEqual(r, { ok: true })
  assert.equal(m.d.get('fk-schedule-v1-pending-write'), 'null')
})
test('E-DOC: corrupt calendar is named and left untouched', async () => {
  m.d.set(SCHEDULE_KEY, '{broken'); const r = await saveScheduledEntry(strength())
  assert.match(r.reason!, /E-DOC/); assert.equal(m.d.get(SCHEDULE_KEY), '{broken')
})
test('E-PENDING-DOC / E-PENDING-BAD: leftover pending-write is named (and stays: no silent overwrite)', async () => {
  m.d.set(SCHEDULE_KEY, '{"entries":[],"acks":[]}')
  m.d.set('fk-schedule-v1-pending-write', JSON.stringify({ schema: 1, before: '{"entries":[1]}', after: '{"entries":[2]}', previousRevision: null, revision: '{"rev":1}' }))
  assert.match((await saveScheduledEntry(strength())).reason!, /E-PENDING-DOC/)
  m.d.set('fk-schedule-v1-pending-write', '{bad'); assert.match((await saveScheduledEntry(strength())).reason!, /E-PENDING-BAD/)
})
test('E-REV-BAD: corrupt revision key is named', async () => {
  m.d.set('fk-schedule-v1-rev', '{bad'); assert.match((await saveScheduledEntry(strength())).reason!, /E-REV-BAD/)
})
test('E-VERIFY: storage that silently drops writes is named with the key', async () => {
  setStoreBackend({ getItem: k => m.d.get(k) ?? null, setItem: () => {}, keys: () => [...m.d.keys()] })
  assert.match((await saveScheduledEntry(strength())).reason!, /E-VERIFY.*fk-schedule-v1-pending-write/)
})
test('E-NOSTORE and E-OWNER codes', async () => {
  setStoreBackend(null); const g = globalThis as any; assert.equal(g.localStorage, undefined)
  assert.match((await saveScheduledEntry(strength())).reason!, /E-NOSTORE/)
  setStoreBackend(m.box)
  m.d.set(SCHEDULE_KEY, JSON.stringify({ entries: [{ ...old(1), id: 'custom:abc', athleteId: 'someone-else' }], acks: [] }))
  assert.match((await saveScheduledEntry(strength())).reason!, /E-OWNER/)
})
test('describeScheduleFailure without a failure is explicit, not silent', () => { assert.match(describeScheduleFailure(null), /E-UNKNOWN/) })
