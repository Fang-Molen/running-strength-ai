import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { setStoreBackend } from '../core/storage'
import { setEventContext } from '../core/events'
import { loadVitals } from '../nutrition/vitals'
import { mergeResults, type DeviceHealthRow } from '../ui/device-parse'
import { saveDeviceRows } from '../ui/device-store'
import { appleHealthFacts, parseUnifiedExport } from './unified-import'
import { readUnifiedFacts, saveReviewedFacts } from './unified-fact-store'
import { factId, type UnifiedFact } from './unified-facts'
import { loadHealthSnapshot } from './snapshot'
import { editReviewedHealthRow } from './reviewed-correction'

const owner = 'synthetic-reviewed-correction'
const day = '2026-10-20'
const sourceAt = '2026-10-20T12:00:00Z'
const fact = (patch: Partial<UnifiedFact> = {}): UnifiedFact => ({
  athleteId: owner, provider: 'GARMIN', accountRef: 'synthetic-account', deviceId: 'synthetic-device',
  recordId: 'synthetic-record', metric: 'HRV', value: 60, unit: 'ms', protocol: 'NIGHT_RMSSD',
  start: '2026-10-19T22:00:00Z', end: '2026-10-20T06:00:00Z', receivedAt: sourceAt,
  day, utcOffsetMinutes: 0, quality: 'VALID', revision: 1, ...patch,
})
let data: Map<string, string>
beforeEach(() => {
  data = new Map()
  setStoreBackend({ getItem: key => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value), keys: () => [...data.keys()] })
  setEventContext({ athleteId: owner })
})
afterEach(() => { setStoreBackend(null); setEventContext({ athleteId: 'local' }) })
const rows = (facts: UnifiedFact[]) => mergeResults([parseUnifiedExport(JSON.stringify({ schema: 'fangkun-device-facts-v1', facts }), owner)!]).health
function edited(row: DeviceHealthRow, patch: Partial<Pick<DeviceHealthRow, 'day' | 'value'>>) {
  const result = editReviewedHealthRow(row, patch)
  assert.equal(result.ok, true, result.ok ? undefined : result.reason)
  if (!result.ok) throw new Error(result.reason)
  return result.row
}
function save(row: DeviceHealthRow) {
  const evidence = saveReviewedFacts(row.observation?.facts ?? [])
  const legacy = saveDeviceRows([row], [])
  assert.deepEqual(evidence.errors, [])
  assert.deepEqual(legacy.errors, [])
  return { evidence, legacy }
}

test('editing a saved fact appends an explicit manual revision and changes the shared snapshot', () => {
  const original = rows([fact()])[0], before = structuredClone(original)
  save(original)
  const savedBeforeEdit = [...data]
  const correction = edited(original, { value: 70 })
  assert.deepEqual([...data], savedBeforeEdit, 'editing remains a preview until the save action')
  save(correction)
  assert.deepEqual(original, before, 'the uploaded evidence is immutable')
  assert.equal(loadVitals().records[0].value, 70)
  const view = loadHealthSnapshot(day).metrics.find(v => v.metric === 'HRV')!
  assert.equal(view.current?.value, 70)
  assert.match(view.current?.source ?? '', /人工更正/)
  const projection = readUnifiedFacts()
  assert.equal(projection.evidence.length, 2)
  assert.equal(projection.evidence.find(f => f.revision === 1)?.value, 60)
  assert.equal(projection.facts[0].manualCorrection?.previousRevision, 1)
})

test('a correction before the first save retains the original fact alongside its revision', () => {
  const original = rows([fact()])[0]
  save(edited(original, { value: 75 }))
  const projection = readUnifiedFacts()
  assert.equal(projection.evidence.length, 2)
  assert.equal(projection.evidence.find(f => f.revision === 1)?.value, 60)
  assert.equal(projection.facts[0].value, 75)
})

test('repeated edits and a repeated reviewed import reuse the current correction without conflict', () => {
  const original = rows([fact()])[0]
  save(original)
  const first = edited(original, { value: 70 })
  const second = edited(first, { value: 80 })
  save(second)
  assert.equal(readUnifiedFacts().facts[0].revision, 3)
  const again = edited(rows([fact()])[0], { value: 80 })
  const result = save(again)
  assert.equal(result.evidence.saved, 0)
  assert.equal(result.legacy.skipped, 1)
  assert.equal(readUnifiedFacts().evidence.length, 3)
  assert.deepEqual(readUnifiedFacts().conflicts, [])
  assert.equal(loadHealthSnapshot(day).metrics.find(v => v.metric === 'HRV')?.current?.value, 80)
})

test('a stale preview edits above the newest stored revision and cannot return to an older value', () => {
  const original = rows([fact()])[0]
  save(original)
  saveReviewedFacts([fact({ revision: 9, value: 65 })])
  const correction = edited(original, { value: 70 })
  save(correction)
  assert.equal(readUnifiedFacts().facts[0].revision, 10)
  assert.equal(readUnifiedFacts().facts[0].manualCorrection?.previousRevision, 9)
  saveReviewedFacts(original.observation!.facts!)
  const oldSave = saveDeviceRows([original], [])
  assert.equal(oldSave.saved, 0)
  assert.equal(loadVitals().records[0].value, 70)
  assert.equal(readUnifiedFacts().facts[0].value, 70)
  assert.deepEqual(readUnifiedFacts().conflicts, [])
})

for (const correctedDay of ['2026-10-19', '2026-10-21']) {
  test(`sleep date correction to ${correctedDay} is not reset by the old wake timestamp`, () => {
    const original = rows([fact({ metric: 'SLEEP', value: 8, unit: 'h', protocol: 'NIGHT_SLEEP' })])[0]
    save(original)
    const correction = edited(original, { day: correctedDay })
    save(correction)
    const projection = readUnifiedFacts()
    assert.equal(projection.facts[0].day, correctedDay)
    assert.equal(projection.facts[0].start, null)
    assert.equal(projection.facts[0].end, null)
    assert.equal(projection.evidence.find(f => f.revision === 1)?.end, '2026-10-20T06:00:00Z')
    const view = loadHealthSnapshot('2026-10-21').metrics.find(v => v.metric === 'SLEEP')!
    assert.equal(view.current?.day, correctedDay)
    assert.equal(view.current?.value, 8)
  })
}

test('an Apple aggregate correction leaves all original sleep stages unchanged', () => {
  const record = (stage: string, start: string, end: string) => `<Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="Synthetic Apple Watch" sourceVersion="1" device="synthetic" value="${stage}" unit="h" startDate="${start}" endDate="${end}"/>`
  const parsed = appleHealthFacts(record('AsleepCore', '2026-10-19 23:00:00 +0800', '2026-10-20 07:00:00 +0800') + record('AsleepDeep', '2026-10-20 01:00:00 +0800', '2026-10-20 03:00:00 +0800'), '2026-10-01', owner, sourceAt)
  const stages = parsed.facts.filter(f => !f.recordId.startsWith('daily:'))
  const original = parsed.health[0]
  save(original)
  save(edited(original, { value: 7.5 }))
  const projection = readUnifiedFacts()
  assert.deepEqual(projection.evidence.filter(f => !f.recordId.startsWith('daily:')), stages)
  assert.equal(projection.evidence.filter(f => f.manualCorrection).length, 1)
  assert.ok(projection.evidence.find(f => f.manualCorrection)?.recordId.startsWith('daily:'))
  assert.equal(loadHealthSnapshot(day).metrics.find(v => v.metric === 'SLEEP')?.current?.value, 7.5)
})

test('editing separate same-day samples keeps independent checkbox identities', () => {
  const samples = rows([fact(), fact({ recordId: 'synthetic-second-record', value: 65 })])
  const a = edited(samples[0], { value: 70 }), b = edited(samples[1], { value: 75 })
  assert.notEqual(a.key, b.key)
  assert.notEqual(factId(a.observation!.facts!.at(-1)!), factId(b.observation!.facts!.at(-1)!))
})

test('value then date then value edits stay on one fact across successive saves', () => {
  const original = rows([fact({ metric: 'SLEEP', value: 8, unit: 'h', protocol: 'NIGHT_SLEEP' })])[0]
  save(original)
  let correction = edited(original, { value: 7.5 })
  correction = edited(correction, { day: '2026-10-19' })
  save(correction)
  correction = edited(correction, { value: 7 })
  save(correction)
  const projection = readUnifiedFacts()
  assert.equal(projection.facts.length, 1)
  assert.equal(projection.facts[0].revision, 4)
  assert.equal(projection.facts[0].day, '2026-10-19')
  assert.equal(projection.facts[0].value, 7)
  assert.deepEqual(projection.conflicts, [])
  assert.equal(projection.evidence.length, 4)
  assert.equal(loadHealthSnapshot(day).metrics.find(v => v.metric === 'SLEEP')?.current?.value, 7)
})

test('a real zero correction remains zero and preserves the original numeric evidence', () => {
  const original = rows([fact({ metric: 'STEPS', value: 100, unit: 'steps', protocol: 'DAILY_STEPS' })])[0]
  save(edited(original, { value: 0 }))
  const projection = readUnifiedFacts()
  assert.equal(projection.evidence.find(f => f.revision === 1)?.value, 100)
  assert.equal(projection.facts[0].value, 0)
  const view = loadHealthSnapshot(day).metrics.find(v => v.metric === 'STEPS')!
  assert.equal(view.state, 'AVAILABLE')
  assert.equal(view.current?.value, 0)
})

test('a normalized-unit correction retains the source raw value and unit', () => {
  const original = rows([fact({ value: 0.06, unit: 's' })])[0]
  save(edited(original, { value: 70 }))
  const projection = readUnifiedFacts()
  assert.equal(projection.facts[0].value, 70)
  assert.equal(projection.facts[0].unit, 'ms')
  assert.equal(projection.facts[0].rawValue, 0.06)
  assert.equal(projection.facts[0].rawUnit, 's')
  assert.equal(projection.evidence.find(f => f.revision === 1)?.value, 60)
})

test('ordinary rows retain the existing edit path without inventing unified facts', () => {
  const original: DeviceHealthRow = { key: 'plain', source: '截图核对', metric: 'STEPS', day, value: 100 }
  const result = edited(original, { value: 0 })
  assert.equal(result.value, 0)
  assert.match(result.source, /人工更正/)
  assert.equal(result.observation?.facts, undefined)
  save(result)
  assert.equal(readUnifiedFacts().evidence.length, 0)
  assert.equal(loadHealthSnapshot(day).metrics.find(v => v.metric === 'STEPS')?.current?.value, 0)
})

test('unchanged values do not create manual revisions', () => {
  const original = rows([fact()])[0]
  assert.deepEqual(edited(original, { value: original.value }), original)
  assert.equal(data.size, 0)
})

test('cross-athlete facts and invalid corrections are rejected before any write', () => {
  const original = rows([fact()])[0]
  assert.equal(editReviewedHealthRow(original, { value: 0 }).ok, false, 'zero HRV is invalid')
  assert.equal(editReviewedHealthRow(original, { day: '2026-02-30' }).ok, false)
  setEventContext({ athleteId: 'synthetic-another-athlete' })
  assert.equal(editReviewedHealthRow(original, { value: 70 }).ok, false)
  assert.equal(data.size, 0)
})
