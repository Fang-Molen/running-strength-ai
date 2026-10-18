import test, { afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { setStoreBackend, type MemoryStore } from './storage.ts'
import { parseChatTraining, saveChatTraining } from './coach-chat-evidence.ts'
import { confirmImportLogCorrection, importCorrectionTargets } from './import-log-correction.ts'
import { appendCorrection, listCorrections } from './training-correction.ts'
import { loadConfirmedTrainingImports, createTrainingImportDraft, confirmTrainingImport } from './training-import.ts'
import { readOfflineWorkspace } from './coach-offline-workspace.ts'
import { saveOfflineReview, readOfflineHistory } from './coach-offline-loop.ts'
import { blankPlan } from '../strength/model.ts'

let data: Map<string, string>
let box: MemoryStore
beforeEach(() => {
  data = new Map()
  box = {keys: () => [...data.keys()], getItem: key => data.get(key) ?? null, setItem: (key, value) => {data.set(key, value)}}
  setStoreBackend(box)
})
afterEach(() => setStoreBackend(null))
function training() {
  const result = saveChatTraining(parseChatTraining('今天实际完成200米×2，39/38秒，组间3分钟，整课40分钟，整课RPE6'), '2026-01-01T10:00:00Z', true)
  assert.ok(result.ok)
  return result.record
}
function correction(record = training(), raw = '38.5') {
  const target = importCorrectionTargets(record).find(row => row.label === '第1段用时')!
  assert.ok(target)
  return {record, target, input: {occurrenceId: record.confirmedImportId, targetId: target.id, expectedSourceId: target.sourceId, value: raw, reason: '重新核对原始计时', confirmed: true}}
}
test('a bound decimal correction changes the coach facts without mutating or duplicating the import', () => {
  const {record, input} = correction()
  const before = JSON.stringify(loadConfirmedTrainingImports())
  assert.ok(confirmImportLogCorrection(input).ok)
  assert.equal(JSON.stringify(loadConfirmedTrainingImports()), before)
  const targets = importCorrectionTargets(record)
  assert.equal(targets.find(row => row.label === '第1段用时')?.value, 38.5)
  assert.equal(targets.find(row => row.label === '第1段用时')?.originalValue, 39)
  assert.equal(targets.find(row => row.label === '第2段用时')?.value, 38)
  const {review} = readOfflineWorkspace(blankPlan(), 'local', record.confirmedImportId)
  assert.deepEqual(review.metrics.points.map(row => row.seconds), [38.5, 38])
  assert.equal(listCorrections(record.confirmedImportId).length, 1)
})
test('a stale editor cannot replace a later correction or create a second correction on repeated submit', () => {
  const {record, input} = correction()
  assert.ok(confirmImportLogCorrection(input).ok)
  assert.equal(confirmImportLogCorrection({...input, value: '37.2'}).ok, false)
  assert.equal(listCorrections(record.confirmedImportId).length, 1)
  const current = correction(record, '37.2')
  assert.ok(confirmImportLogCorrection(current.input).ok)
  assert.equal(importCorrectionTargets(record).find(row => row.label === '第1段用时')?.value, 37.2)
})
test('invalid, blank, zero duration, unchanged and unconfirmed values never commit', () => {
  const {record, input} = correction()
  for (const value of ['', ' ', '0', '-1', 'NaN', 'Infinity', '1e6', '39']) assert.equal(confirmImportLogCorrection({...input, value}).ok, false)
  assert.equal(confirmImportLogCorrection({...input, confirmed: false}).ok, false)
  assert.equal(confirmImportLogCorrection({...input, reason: ''}).ok, false)
  assert.equal(listCorrections(record.confirmedImportId).length, 0)
  assert.ok(confirmImportLogCorrection({...input, value: '38,5'}).ok)
})
test('voided, deleted and different-athlete imports cannot be edited from a stale screen', () => {
  const {record, input} = correction()
  assert.deepEqual(importCorrectionTargets({...record, athleteId: 'other'}), [])
  assert.ok(appendCorrection({trainingOccurrenceId: record.confirmedImportId, kind: 'VOID', reason: '测试作废'}))
  assert.equal(confirmImportLogCorrection(input).ok, false)
  assert.deepEqual(importCorrectionTargets(record), [])
  data.clear()
  assert.equal(confirmImportLogCorrection(input).ok, false)
})
test('distance correction retains seconds and rest while using the effective distance', () => {
  const record = training()
  const target = importCorrectionTargets(record).find(row => row.label === '第1段距离')!
  assert.ok(confirmImportLogCorrection({occurrenceId: record.confirmedImportId, targetId: target.id, expectedSourceId: target.sourceId, value: '198.5', reason: '核对场地', confirmed: true}).ok)
  const targets = importCorrectionTargets(record)
  assert.equal(targets.find(row => row.label === '第1段距离')?.value, 198.5)
  assert.equal(targets.find(row => row.label === '第1段用时')?.value, 39)
  assert.equal(loadConfirmedTrainingImports()[0].runningSegments[0].recoverySeconds.value, 180)
})
test('a failed storage write is reported and the existing effective record is preserved', () => {
  const {record, input} = correction()
  setStoreBackend({...box, setItem: () => {throw new Error('quota')}})
  assert.equal(confirmImportLogCorrection(input).ok, false)
  assert.equal(importCorrectionTargets(record).find(row => row.label === '第1段用时')?.value, 39)
})
test('a changed source withdraws the old dependent judgment while retaining its original metrics', () => {
  const {record, input} = correction()
  const first = readOfflineWorkspace(blankPlan(), 'local', record.confirmedImportId).review
  assert.ok(saveOfflineReview(first).ok)
  assert.ok(confirmImportLogCorrection(input).ok)
  const second = readOfflineWorkspace(blankPlan(), 'local', record.confirmedImportId).review
  assert.ok(saveOfflineReview(second).ok)
  const history = readOfflineHistory('local').filter(row => row.kind === 'ANALYSIS')
  assert.equal(history.length, 2)
  assert.equal(history[0].review.metrics.points[0].seconds, 39)
  assert.equal(history[1].review.metrics.points[0].seconds, 38.5)
  assert.ok(history[1].revisions.some(row => row.status === 'WITHDRAWN'))
})

test('strength edits accept fractional weight but reject fractional repetitions', () => {
  const f = <T>(value: T) => ({value, status: 'RECORDED' as const, sourceIds: ['user-confirmed']})
  const saved = confirmTrainingImport(createTrainingImportDraft({sport: 'STRENGTH', occurredAt: f('2026-01-02T10:00:00Z'), strengthSets: [
    {id: 'squat-a', exerciseName: f('深蹲'), setOrdinal: f(1), weightKg: f(40), repetitions: f(8), completion: 'COMPLETED', sourceIds: ['user-confirmed']},
  ]}, 'TEXT', ['user-confirmed']))
  assert.ok(saved.ok)
  const record = saved.record
  const weight = importCorrectionTargets(record).find(row => row.field === 'weight')!
  assert.ok(confirmImportLogCorrection({occurrenceId: record.confirmedImportId, targetId: weight.id, expectedSourceId: weight.sourceId, value: '42.5', reason: '核对两侧杠铃片', confirmed: true}).ok)
  const reps = importCorrectionTargets(record).find(row => row.field === 'reps')!
  const input = {occurrenceId: record.confirmedImportId, targetId: reps.id, expectedSourceId: reps.sourceId, value: '7.5', reason: '核对次数', confirmed: true}
  assert.equal(confirmImportLogCorrection(input).ok, false)
  assert.ok(confirmImportLogCorrection({...input, value: '7'}).ok)
  assert.equal(importCorrectionTargets(record).find(row => row.field === 'weight')?.value, 42.5)
  assert.equal(importCorrectionTargets(record).find(row => row.field === 'reps')?.value, 7)
  assert.equal(loadConfirmedTrainingImports()[0].strengthSets[0].weightKg.value, 40)
})

test('colliding segment aliases do not offer a guessed correction target', () => {
  const record = training()
  const colliding = {...record, runningSegments: record.runningSegments.map((row, i) => ({...row, id: `run-${2 - i}`}))}
  assert.deepEqual(importCorrectionTargets(colliding), [])
})
