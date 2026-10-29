import test from 'node:test'
import assert from 'node:assert/strict'
import { currentAthleteId, setEventContext } from '../core/events'
import { setStoreBackend } from '../core/storage'
import { coachImports, effectiveImportedTraining } from '../core/coach-import-evidence'
import { confirmTrainingImport, createTrainingImportDraft, loadConfirmedTrainingImports } from '../core/training-import'
import { confirmImportLogCorrection, importCorrectionTargets } from '../core/import-log-correction'
import { onlineTrainingFacts } from '../coach/online-training-facts'
import { readCoachData } from '../health/coach-data'
import { garminViewKey } from '../health/garmin-view-scope'
import { saveGarminActivities } from '../../components/garmin-log'
import { saveDeviceRows } from './device-store'
import type { DeviceActivity } from './device-parse'
import { activityWeeks, loadRunMatch, loadTrainingActivities } from './training-read-model'
import { saveRunLink } from './run-link'
import { fmtDurationPrecise, fmtPace } from './activity-format'

const day = '2026-10-28', now = day + 'T20:00:00Z', owner = 'synthetic-1a'
function fixture(t: test.TestContext) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(now) })
  const previousOwner = currentAthleteId(), previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  let data = new Map<string, string>()
  const mount = () => {
    const disk = data, box = { getItem: (key: string) => disk.get(key) ?? null, setItem: (key: string, value: string) => { disk.set(key, value) }, removeItem: (key: string) => { disk.delete(key) }, keys: () => [...disk.keys()] }
    Object.defineProperty(globalThis, 'localStorage', { value: box, configurable: true })
    setStoreBackend(box)
    return box
  }
  Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true })
  setEventContext({ athleteId: owner })
  const box = mount()
  t.after(() => {
    setStoreBackend(null); setEventContext({ athleteId: previousOwner })
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage); else Reflect.deleteProperty(globalThis, 'localStorage')
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else Reflect.deleteProperty(globalThis, 'window')
  })
  return { box, restart: () => { data = new Map(JSON.parse(JSON.stringify([...data]))); return mount() } }
}
function device(id = 101, start = day + 'T08:00:00Z', distanceM = 6010, durationSec: number | null = 1611.94): DeviceActivity {
  return { key: String(id), sourceIdentity: `garmin:synthetic-account:${id}`, source: '合成手表', sport: 'RUNNING', sportLabel: '跑步', startIso: start,
    durationSec, distanceM, avgHr: null, maxHr: null, calories: null, avgCadence: null, avgPower: null, verticalOscMm: null, groundContactMs: null, sets: [] }
}
function saveWatch(a: DeviceActivity, id = 101) {
  saveGarminActivities([{ activityId: id, activityName: '合成跑步', activityType: { typeKey: 'running' }, fkStartIso: a.startIso,
    fkSourceIdentity: a.sourceIdentity, duration: a.durationSec, distance: a.distanceM }], 'synthetic-account')
}

test('1A repeated same-account saves retain A once, same-day B separately, after storage restart and athlete switch', t => {
  const f = fixture(t), a = device(), b = device(102, day + 'T18:00:00Z', 3000, 900)
  for (let i = 0; i < 3; i++) {
    saveWatch(a); saveWatch(b, 102)
    const result = saveDeviceRows([], [a, b])
    assert.equal(result.saved, i === 0 ? 2 : 0); assert.equal(result.skipped, i === 0 ? 0 : 2); assert.deepEqual(result.errors, [])
  }
  const raw = JSON.stringify(loadConfirmedTrainingImports()), watch = f.box.getItem(garminViewKey('fk-garmin-acts-v1'))
  const verify = () => {
    const rows = loadTrainingActivities()
    assert.equal(rows.length, 2); assert.equal(rows[0].durationSec, 1611.94); assert.equal(rows[0].distanceM, 6010)
    assert.equal(fmtDurationPrecise(rows[0].durationSec), '26:51.94'); assert.equal(fmtPace(rows[0].distanceM, rows[0].durationSec), `4'28"/km`)
    assert.equal(rows[1].durationSec, 900); assert.equal(rows[1].distanceM, 3000)
    assert.deepEqual(activityWeeks(rows, day, 1), [{ week: '2026-10-26', minutes: 42, unknownDuration: 0 }])
    assert.equal(readCoachData(day).imports.count, 2)
    const facts = onlineTrainingFacts(day, now)
    assert.match(facts.summary.join('\n'), /已确认导入2条/)
    assert.equal(facts.details.filter(line => line.includes('1611.94秒')).length, 1)
    assert.equal(facts.details.filter(line => line.includes('900秒')).length, 1)
    assert.equal(JSON.stringify(loadConfirmedTrainingImports()), raw)
  }
  verify(); const restarted = f.restart(); verify()
  assert.equal(restarted.getItem(garminViewKey('fk-garmin-acts-v1')), watch)
  setEventContext({ athleteId: 'synthetic-1a-other' })
  assert.deepEqual(loadTrainingActivities(), []); assert.equal(readCoachData(day).imports.count, 0)
  assert.deepEqual(onlineTrainingFacts(day, now).details, [])
})

test('1A explicit schedule link and unlink survive storage restart without changing A, B or raw watch values', t => {
  const f = fixture(t), a = device(), b = device(102, day + 'T18:00:00Z', 3000, 900)
  saveWatch(a); saveWatch(b, 102); assert.equal(saveDeviceRows([], [a, b]).saved, 2)
  f.box.setItem('fk-schedule-v1', JSON.stringify({ entries: [{ id: 'synthetic-course', athleteId: owner, date: day, kind: 'run', modality: 'run', title: '轻松跑', status: 'planned', source: 'custom' }] }))
  assert.equal(loadRunMatch().links.length, 0)
  assert.equal(loadRunMatch().suggestions[0].runs.length, 2)
  saveRunLink('synthetic-course', { garminId: a.sourceIdentity, by: 'user' })
  assert.equal(loadRunMatch().links[0].run.garminId, 101)
  f.restart(); assert.equal(loadRunMatch().links[0].run.garminId, 101)
  saveRunLink('synthetic-course', { rejected: [a.sourceIdentity!] })
  f.restart(); assert.equal(loadRunMatch().links.length, 0)
  assert.deepEqual(loadRunMatch().suggestions[0].runs.map(row => row.garminId), [102])
  assert.deepEqual(loadTrainingActivities().map(row => [row.distanceM, row.durationSec]), [[6010, 1611.94], [3000, 900]])
})

test('1A conflicting source time remains visible while missing time stays unknown after restart', t => {
  const f = fixture(t), a = device()
  assert.equal(saveDeviceRows([], [a]).saved, 1); saveWatch({ ...a, durationSec: 1800 })
  f.restart()
  const row = loadTrainingActivities()[0]
  assert.equal(row.durationSec, null); assert.match(row.measurementNote ?? '', /冲突/)
  assert.deepEqual(row.members?.map(member => member.durationSec), [1611.94, 1800])
  assert.deepEqual(activityWeeks([row], day, 1), [{ week: '2026-10-26', minutes: 0, unknownDuration: 1 }])
  const online = onlineTrainingFacts(day, now)
  assert.match(online.details[0], /总时长未知.*当前.*冲突/)
  assert.match(online.summary.join('\n'), /缓存录入时间未知.*不作为历史事实/)
  assert.doesNotMatch(online.details[0], /总时长 1611\.94秒|1800秒/)
  saveWatch(device(102, day + 'T18:00:00Z', 3000, null), 102)
  f.restart(); const missing = loadTrainingActivities().find(item => item.garminId === 102)!
  assert.equal(missing.durationSec, null); assert.equal(fmtPace(missing.distanceM, missing.durationSec), null)
})

test('1A a confirmed lap correction withdraws old totals consistently from log, week and coach after restart', t => {
  const f = fixture(t), a = device(), b = device(102, day + 'T18:00:00Z', 3000, 900)
  const field = <T,>(value: T) => ({ value, status: 'RECORDED', sourceIds: ['user-confirmed'] })
  const draft = createTrainingImportDraft({ sport: 'RUNNING', occurredAt: field(a.startIso), title: field('合成分圈跑步'), durationSeconds: field(1611.94), totalDistanceMeters: field(6010),
    runningStructure: 'CONTINUOUS', runningSegments: [{ id: 'lap-1', kind: 'CONTINUOUS', distanceMeters: field(6010), durationSeconds: field(1611.94), completion: 'COMPLETED', sourceIds: ['user-confirmed'] }] }, 'TEXT', ['user-confirmed'])
  draft.sourceRecordIdentity = a.sourceIdentity
  const saved = confirmTrainingImport(draft); assert.ok(saved.ok)
  saveWatch(a); saveWatch(b, 102); assert.equal(saveDeviceRows([], [b]).saved, 1)
  const raw = JSON.stringify(loadConfirmedTrainingImports()), watch = f.box.getItem(garminViewKey('fk-garmin-acts-v1'))
  const target = importCorrectionTargets(saved.record).find(row => row.label === '第1段用时')!
  assert.ok(target)
  assert.ok(confirmImportLogCorrection({ occurrenceId: saved.record.confirmedImportId, targetId: target.id, expectedSourceId: target.sourceId, value: '1600', reason: '合成分圈复核', confirmed: true }).ok)
  const verify = () => {
    const rows = loadTrainingActivities(), row = rows.find(item => item.importId === saved.record.confirmedImportId)!
    assert.equal(row.durationSec, null, 'a corrected segment does not establish a replacement whole-session time')
    assert.equal(row.distanceM, 6010); assert.match(row.measurementNote ?? '', /更正/)
    assert.deepEqual(activityWeeks(rows, day, 1), [{ week: '2026-10-26', minutes: 15, unknownDuration: 1 }])
    assert.equal(readCoachData(day).imports.latest.find(item => item.id === saved.record.confirmedImportId)?.durationSec, null)
    const facts = onlineTrainingFacts(day, now, { selectedOccurrenceId: saved.record.confirmedImportId })
    assert.match(facts.details[0], /总时长未知/); assert.match(facts.details[0], /1600秒/)
    assert.equal(effectiveImportedTraining(coachImports().find(item => item.confirmedImportId === saved.record.confirmedImportId)!).record.runningSegments[0].durationSeconds.value, 1600)
    assert.equal(rows.find(item => item.garminId === 102)?.durationSec, 900)
    assert.equal(JSON.stringify(loadConfirmedTrainingImports()), raw)
  }
  verify(); const restarted = f.restart(); verify()
  assert.equal(restarted.getItem(garminViewKey('fk-garmin-acts-v1')), watch)
  const distance = importCorrectionTargets(saved.record).find(item => item.label === '第1段距离')!
  assert.ok(distance)
  assert.ok(confirmImportLogCorrection({ occurrenceId: saved.record.confirmedImportId, targetId: distance.id, expectedSourceId: distance.sourceId, value: '6000', reason: '合成距离复核', confirmed: true }).ok)
  f.restart()
  const corrected = loadTrainingActivities().find(item => item.importId === saved.record.confirmedImportId)!
  assert.equal(corrected.distanceM, null); assert.equal(corrected.durationSec, null)
  assert.equal(fmtPace(corrected.distanceM, corrected.durationSec), null)
  assert.equal(readCoachData(day).imports.latest.find(item => item.id === saved.record.confirmedImportId)?.distanceM, null)
  assert.match(onlineTrainingFacts(day, now, { selectedOccurrenceId: saved.record.confirmedImportId }).details[0], /总距离未知/)
  assert.equal(JSON.stringify(loadConfirmedTrainingImports()), raw)
})
