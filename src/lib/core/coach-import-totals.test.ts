import test from 'node:test'
import assert from 'node:assert/strict'
import { currentAthleteId, setEventContext } from './events'
import { setStoreBackend } from './storage'
import { createTrainingImportDraft, confirmTrainingImport } from './training-import'
import { importedCoachParts } from './coach-import-evidence'
import { appendCorrection } from './training-correction'
import { garminViewKey } from '../health/garmin-view-scope'

function fixture(t: test.TestContext) {
  const owner = 'synthetic-selected-import-review', previousOwner = currentAthleteId()
  const asOf = '2026-10-28T04:00:00.000Z'
  t.mock.timers.enable({ apis: ['Date'], now: new Date(asOf) })
  const data = new Map<string, string>()
  const store = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) }, keys: () => [...data.keys()] }
  setStoreBackend(store); setEventContext({ athleteId: owner })
  t.after(() => { setStoreBackend(null); setEventContext({ athleteId: previousOwner }) })
  const recorded = <T>(value: T) => ({ value, status: 'RECORDED' as const, sourceIds: ['user-confirmed'] })
  const draft = createTrainingImportDraft({ sport: 'RUNNING', occurredAt: recorded('2026-10-27T09:00:00.000Z'), durationSeconds: recorded(1800), totalDistanceMeters: recorded(5000),
    runningSegments: [{ id: 'review-segment', kind: 'REPETITION', distanceMeters: recorded(400), durationSeconds: recorded(70), completion: 'COMPLETED', sourceIds: ['user-confirmed'] }] }, 'TEXT', ['user-confirmed'])
  draft.sourceRecordIdentity = 'garmin:synthetic-selected-review:activity-A'
  const saved = confirmTrainingImport(draft); assert.ok(saved.ok)
  const cache = (dur: number, dist = 5000) => store.setItem(garminViewKey('fk-garmin-acts-v1'), JSON.stringify({ A: { athleteId: owner, sourceIdentity: draft.sourceRecordIdentity, dur, dist } }))
  return { record: saved.record, cache, asOf, data }
}

test('selected imported coach brief withdraws a conflicted total and keeps reliable segments', t => {
  const f = fixture(t); f.cache(1900)
  const before = JSON.stringify([...f.data]), parts = importedCoachParts(f.record, '这节怎么样')
  assert.equal(parts.durationSec, null)
  assert.ok(parts.sources?.some(s => /缓存.*冲突/.test(s.detail)))
  assert.ok(parts.sources?.some(s => /70 s/.test(s.detail)))
  assert.equal(JSON.stringify([...f.data]), before)
})

test('selected imported coach brief withdraws stale total only after a duration correction is visible', t => {
  const f = fixture(t); t.mock.timers.tick(1000)
  assert.ok(appendCorrection({ trainingOccurrenceId: f.record.confirmedImportId, kind: 'FIELD', field: 'duration', setKey: 'review-segment', originalValue: '70', newValue: '75', reason: '合成分段更正' }))
  const current = importedCoachParts(f.record, '这节怎么样')
  assert.equal(current.durationSec, null)
  assert.ok(current.sources?.some(s => /整课.*更正|更正.*整课/.test(s.detail)))
  assert.ok(current.sources?.some(s => /75 s/.test(s.detail)))
  assert.equal(importedCoachParts(f.record, '历史复盘', undefined, f.asOf).durationSec, 1800)
})

test('a distance-only cache conflict retains the independently consistent total duration', t => {
  const f = fixture(t); f.cache(1800, 5100)
  const parts = importedCoachParts(f.record, '这节怎么样')
  assert.equal(parts.durationSec, 1800)
  assert.ok(parts.sources?.some(s => /缓存.*冲突/.test(s.detail)))
})
