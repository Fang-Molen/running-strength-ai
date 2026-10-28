import test from 'node:test'
import assert from 'node:assert/strict'
import { firstWeekMemory } from './coach-first-week.fixtures'
import { setStoreBackend } from './storage'
import { currentAthleteId } from './events'
import { saveChatTraining, parseChatTraining } from './coach-chat-evidence'
import { readOfflineWorkspace } from './coach-offline-workspace'
import { saveOfflineReview, readOfflineHistory, offlineAthletePortrait, OFFLINE_REVIEW_PREFIX, type ReviewHistory } from './coach-offline-loop'
import { appendJournal, readJournal } from './storage-journal'
import * as corrections from './training-correction'
import { CLAIM_REVISION_PREFIX, readClaimRevisions } from './coach-p7-runtime'

test('B02 correction and pending review intent persist together; read-time invalidation survives failed audit and restart', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-14T08:00:00Z') })
  const box = firstWeekMemory(); setStoreBackend(box); t.after(() => setStoreBackend(null))
  const saved = saveChatTraining(parseChatTraining('今天200米×4，30/30/31/35秒，组间3分钟，整课RPE6'), '2026-10-13T08:00:00Z', true)
  assert.ok(saved.ok)
  t.mock.timers.tick(1000)
  const review = readOfflineWorkspace(null, currentAthleteId(), saved.record.confirmedImportId).review
  assert.ok(saveOfflineReview(review).ok)
  const write = box.setItem
  box.setItem = (key, value) => { if (key.startsWith(CLAIM_REVISION_PREFIX)) throw Error('AUDIT_QUOTA'); write(key, value) }
  t.mock.timers.tick(1000)
  const corrected = corrections.appendCorrection({ trainingOccurrenceId: saved.record.confirmedImportId, kind: 'FIELD', field: 'duration', setKey: 'chat-1-4', originalValue: '35', newValue: '32', reason: 'synthetic correction' })
  assert.ok(corrected)
  const raw = JSON.parse(box.getItem(corrections.TRAINING_CORRECTION_KEY)!).data
  assert.equal(raw.at(-1).reviewIntent?.state, 'PENDING', 'fact and retry intent share one persistent envelope')
  const reloaded = firstWeekMemory(); for (const [key, value] of box.data) reloaded.setItem(key, value)
  setStoreBackend(reloaded)
  assert.ok(readClaimRevisions(currentAthleteId()).some(r => r.result.updateAction === 'MARK_STALE'), 'current dependencies invalidate old claims even without audit receipt')
  assert.ok(offlineAthletePortrait(null, readOfflineHistory(currentAthleteId())).judgments[0].hypothesisStates.some(h => h.status === 'WITHDRAWN'))
  const retry = (corrections as typeof corrections & { retryPendingCorrectionReviews(): { pending: number; applied: number } }).retryPendingCorrectionReviews()
  assert.equal(retry.pending, 0); assert.equal(retry.applied, 1)
  assert.equal((corrections as typeof corrections & { retryPendingCorrectionReviews(): { pending: number; applied: number } }).retryPendingCorrectionReviews().applied, 0)
  assert.equal(JSON.parse(reloaded.getItem(corrections.TRAINING_CORRECTION_KEY)!).data.length, 1)
})

test('B02 dropped fact write cannot report a committed correction', () => {
  const box = firstWeekMemory(), write = box.setItem
  box.setItem = (key, value) => { if (key !== corrections.TRAINING_CORRECTION_KEY) write(key, value) }
  setStoreBackend(box)
  try { assert.equal(corrections.appendCorrection({ trainingOccurrenceId: 'synthetic-only', kind: 'VOID', reason: 'synthetic correction' }), null) }
  finally { setStoreBackend(null) }
})

test('B02 unreadable source removes a previously supported label until its evidence can be reviewed', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-14T08:00:00Z') })
  const box = firstWeekMemory(); setStoreBackend(box); t.after(() => setStoreBackend(null))
  const saved = saveChatTraining(parseChatTraining('今天200米×4，30/30/31/35秒，组间3分钟，整课RPE6'), '2026-10-13T08:00:00Z', true)
  assert.ok(saved.ok); t.mock.timers.tick(1000)
  const review = readOfflineWorkspace(null, currentAthleteId(), saved.record.confirmedImportId).review
  const receipt = saveOfflineReview(review); assert.ok(receipt.ok && receipt.id)
  const hypothesis = review.hypotheses[0]; assert.ok(hypothesis)
  const now = new Date().toISOString(), supportId = 'synthetic-linked-support'
  assert.ok(appendJournal<ReviewHistory>(OFFLINE_REVIEW_PREFIX, supportId, {
    id: supportId, kind: 'HYPOTHESIS_OBSERVATION', athleteId: currentAthleteId(), createdAt: now,
    observation: { hypothesisId: hypothesis.id, sourceReviewId: receipt.id, observedReviewId: 'synthetic-next-review', outcome: 'SUPPORT', sourceIds: hypothesis.sourceIds, reviewedAt: now, reviewer: 'synthetic', reason: 'synthetic linked evidence', confirmed: true, protocolKey: 'synthetic-protocol' },
    revision: { priorReviewId: receipt.id, hypothesisId: hypothesis.id, status: 'SUPPORTED', reason: 'synthetic linked evidence', evidenceIds: hypothesis.sourceIds, priorSourceSignatures: [], reviewedAt: now, manualObservation: true },
  }))
  assert.equal(offlineAthletePortrait(null, readOfflineHistory(currentAthleteId())).judgments[0].hypothesisStates[0].status, 'SUPPORTED')
  const read = box.getItem
  box.getItem = key => { if (key.includes('confirmed-training-imports')) throw Error('SYNTHETIC_SOURCE_UNREADABLE'); return read(key) }
  const revisions = readClaimRevisions(currentAthleteId())
  assert.ok(revisions.some(r => r.result.updateAction === 'REVIEW_REQUIRED'))
  const portrait = offlineAthletePortrait(null, readOfflineHistory(currentAthleteId()))
  assert.equal(portrait.judgments[0].hypothesisStates[0].status, 'REVIEW_REQUIRED')
  assert.equal(portrait.judgments[0].status, 'REVIEW_REQUIRED')
  assert.ok(revisions.filter(r => r.result.updateAction === 'REVIEW_REQUIRED').every(r => r.result.invalidatedCandidateIds.length > 0))
})

test('B02 failed VOID audit remains withdrawn through same-millisecond RESTORE, restart and retry', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-14T08:00:00Z') })
  const box = firstWeekMemory(); setStoreBackend(box); t.after(() => setStoreBackend(null))
  const saved = saveChatTraining(parseChatTraining('今天200米×4，30/30/31/35秒，组间3分钟，整课RPE6'), '2026-10-13T08:00:00Z', true)
  assert.ok(saved.ok); t.mock.timers.tick(1000)
  assert.ok(saveOfflineReview(readOfflineWorkspace(null, currentAthleteId(), saved.record.confirmedImportId).review).ok)
  const write = box.setItem
  box.setItem = (key, value) => { if (key.startsWith(CLAIM_REVISION_PREFIX)) throw Error('SYNTHETIC_AUDIT_QUOTA'); write(key, value) }
  t.mock.timers.tick(1000)
  const removed = corrections.appendCorrection({ trainingOccurrenceId: saved.record.confirmedImportId, kind: 'VOID', reason: 'synthetic void' })
  const restored = corrections.appendCorrection({ trainingOccurrenceId: saved.record.confirmedImportId, kind: 'RESTORE', reason: 'synthetic restore' })
  assert.ok(removed && restored); assert.equal(removed.recordedAt, restored.recordedAt)
  assert.equal(readJournal(CLAIM_REVISION_PREFIX).length, 0)
  const reloaded = firstWeekMemory(); for (const [key, value] of box.data) reloaded.setItem(key, value)
  setStoreBackend(reloaded)
  assert.equal(corrections.occurrenceVoided(saved.record.confirmedImportId), false, 'fact is restored')
  assert.ok(readClaimRevisions(currentAthleteId()).some(r => r.result.updateAction === 'MARK_STALE'), 'durable VOID invalidates the old explanation before any retry')
  assert.ok(offlineAthletePortrait(null, readOfflineHistory(currentAthleteId())).judgments[0].hypothesisStates.every(h => h.status === 'WITHDRAWN'))
  const retry = corrections.retryPendingCorrectionReviews()
  assert.equal(retry.pending, 0); assert.equal(retry.applied, 1)
  assert.ok(readJournal<{ correctionId: string; result: { updateAction: string } }>(CLAIM_REVISION_PREFIX).some(r => r.data.correctionId === removed.correctionId && r.data.result.updateAction === 'MARK_STALE'), 'retry must persist the VOID audit despite the later RESTORE sharing its timestamp')
  assert.equal(corrections.retryPendingCorrectionReviews().applied, 0)
  assert.ok(readClaimRevisions(currentAthleteId()).some(r => r.result.updateAction === 'MARK_STALE'))
})

test('B02 a new conflicting source is quarantined instead of retaining the original dependency as current',async t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-14T08:00:00Z')})
 const box=firstWeekMemory();setStoreBackend(box);t.after(()=>setStoreBackend(null))
 const saved=saveChatTraining(parseChatTraining('今天200米×4，30/30/31/35秒，组间3分钟，整课RPE6'),'2026-10-13T08:00:00Z',true)
 assert.ok(saved.ok);t.mock.timers.tick(1000)
 const {readFormalEvidenceRows}=await import('./coach-v4-formal-rows-store')
 const {selectCurrentClaimEvidence}=await import('./coach-p7-runtime')
 const rows=readFormalEvidenceRows(currentAthleteId()).rows
 const original=rows.find(row=>row.metric==='SPLIT_SECONDS')!
 assert.ok(original)
 const current=selectCurrentClaimEvidence(rows,currentAthleteId(),new Date().toISOString())
 assert.ok(current.some(row=>row.sourceId===original.sourceEventId))
 const conflict={...original,recordId:original.recordId+':conflict',value:(original.value??30)+10}
 const contested=selectCurrentClaimEvidence([...rows,conflict],currentAthleteId(),new Date().toISOString())
 assert.equal(contested.some(row=>row.sourceId===original.sourceEventId),false)
})
