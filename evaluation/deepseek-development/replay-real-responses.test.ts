import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildOfflineReplay, buildReplayPacket, canonicalControlReply, parseSavedAnswer } from './replay-real-responses'
import { validateCoachAnalysisReply } from '../../src/lib/health/analysis-packet'
import { modelFixtures } from './model-fixtures'

const saved = JSON.parse(readFileSync(new URL('./replay-fixtures/20261023/provider-receipts-26.json', import.meta.url), 'utf8'))

test('replays all 26 byte-preserved saved replies with the original 900-token truncation', () => {
 const report = buildOfflineReplay()
 assert.equal(report.samples.length, 26)
 assert.equal(report.execution.newModelCalls, 0)
 assert.equal(report.execution.budgetLedgerOpened, false)
 for (const receipt of saved) assert.equal(report.samples.find(s => s.sampleId === receipt.sampleId)?.rawAnswer, receipt.rawAnswer)
 const truncated = report.samples.find(s => s.sampleId === '5220be82-7315-4ff6-97d9-fe9220e7b5a9')!
 assert.equal(truncated.provider.maxOutputTokens, 900)
 assert.equal(truncated.provider.finishReason, 'length')
 assert.equal(truncated.parse.ok, false)
 assert.equal(truncated.transportTruncated, true)
})

test('JSON scalar, array and incomplete output are parse failures, never repaired', () => {
 for (const text of ['null', '4', '"answer"', '[]', '{"answer":']) assert.equal(parseSavedAnswer(text).ok, false)
 assert.equal(parseSavedAnswer('{"facts":[]}').ok, true)
})

test('old chronological F aliases bind E01 154 seconds to s3 expected 144', () => {
 const report = buildOfflineReplay(), row = report.samples.find(s => s.caseId === 'E01' && s.arm === 'B')!
 assert.equal(row.suppliedAliasProvenance.factAliases.F1, 's3')
 assert.ok(row.content.diagnostics.numericContradictions.some(d => d.metric === 'RUN_WORK_SECONDS' && d.actual === 154 && d.expected.includes(144)))
 const event = report.criticalEvents.find(e => e.id === 'E01B_WRONG_WORK_SECONDS')!
 assert.equal(event.result, 'DETECTED')
 assert.equal(event.detectionEvidence?.kind, 'NUMERIC_CONTRADICTION')
 assert.ok(report.criticalEvents.some(e => e.id === 'D05A_PLAN_TARGET_SUFFICIENCY' && e.result === 'MISSED'))
})

test('schema rejection alone is excluded from the preregistered event denominator', () => {
 const report = buildOfflineReplay()
 assert.equal(report.summary.schemaRejected, 26)
 assert.ok(report.criticalEvents.every(e => e.detectionEvidence?.kind !== 'SCHEMA_REJECTION'))
 assert.equal(report.summary.criticalEventDenominator, 14)
 assert.equal(report.summary.criticalEventsDetected, 13)
 assert.equal(report.summary.criticalEventsMissed, 1)
 assert.equal(report.summary.criticalEventDenominator, report.criticalEvents.length)
 assert.ok(report.summary.criticalEventDenominator !== report.samples.length)
 const aliasControl = report.negativeControls.find(c => c.id === 'D01B_SUPPLIED_OLD_ALIAS')!
 assert.equal(aliasControl.result, 'PASS')
 assert.equal(report.negativeControls.find(c => c.id === 'D04A_RHR_CHANGE_PRESENT')!.result, 'PASS')
 assert.match(JSON.stringify(report.samples.find(s => s.caseId === 'D01' && s.arm === 'B')!.suppliedAliasProvenance), /S6/)
 assert.equal(report.inputVersionDefects.length, 2)
})

test('supplemental diagnostic false positives stay separate from frozen error detection', () => {
 const report = buildOfflineReplay()
 assert.ok(report.summary.adjudicatedNumericFalsePositives >= 0)
 const row = report.samples.find(s => s.caseId === 'E01' && s.arm === 'B')!
 assert.equal(row.realNumericError.status, 'CONFIRMED_FROZEN_ERROR')
 assert.ok(row.realNumericError.findings.every(d => d.actual === 154))
 assert.ok(row.knownDiagnosticFalsePositives.every(d => d.check !== 'NUMBER_CONTRADICTION' || d.actual !== 154))
 assert.equal(report.samples.find(s => s.caseId === 'C03' && s.arm === 'B')!.realNumericError.status, 'NO_CONFIRMED_FROZEN_NUMERIC_ERROR')
 assert.equal(report.samples.find(s => s.caseId === 'D04' && s.arm === 'A')!.falseMissingReview?.status, 'NO_CONFIRMED_FALSE_MISSING')
 assert.equal(report.samples.find(s => s.caseId === 'E01' && s.arm === 'B')!.falseMissingReview?.status, 'NO_CONFIRMED_FALSE_MISSING')
})

test('canonical synthetic positive controls including revision zero pass strict validation', () => {
 const fixture = modelFixtures().find(f => f.caseId === 'A03')!
 for (const revision of [1, 0]) {
  const copy = structuredClone(fixture)
  copy.facts = copy.facts.map(f => ({ ...f, revision }))
  const packet = buildReplayPacket(copy, '同一节混合训练有跑步与深蹲，复盘力量负重与跑步各自实际完成，总量与同次计数。')
  const reply = canonicalControlReply(packet)
  assert.equal(validateCoachAnalysisReply(reply, packet).status, 'ACCEPTED_STRUCTURALLY')
  const mutated = structuredClone(reply)
  const claim = mutated.factualClaims.find(c => c.text.includes('320 kg·reps'))!
  assert.ok(claim)
  const text = claim.text
  claim.text = text.replace('320 kg·reps', '321 kg·reps')
  mutated.answer = mutated.answer.replace(text, claim.text)
  assert.equal(validateCoachAnalysisReply(mutated, packet).status, 'REJECTED')
  const relabelled = structuredClone(reply), unitClaim = relabelled.factualClaims.find(c => c.text.includes('320 kg·reps'))!
  const unitText = unitClaim.text
  unitClaim.text = unitText.replace('kg·reps', 'kg')
  relabelled.answer = relabelled.answer.replace(unitText, unitClaim.text)
  assert.equal(validateCoachAnalysisReply(relabelled, packet).status, 'REJECTED')
  const stale = structuredClone(reply)
  stale.factualClaims[0].refs[0].revision += 1
  assert.equal(validateCoachAnalysisReply(stale, packet).status, 'REJECTED')
 }
})
