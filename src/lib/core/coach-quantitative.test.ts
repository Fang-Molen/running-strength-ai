/** Prepared synthetic checks. Do not infer execution/PASS from the presence of this file. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { calculateQuantitativeRule, quantitativeDefinitions, type QuantInput } from './coach-quantitative.ts'
import { calculateEwmaSeries, savedSessionAu } from './coach-load-metrics.ts'

type Fixture = { id: string; ruleId: string; input: QuantInput; expected: { value: number; unit: string; metrics?: Record<string, number | null> }; reference: string }
const fixtures = JSON.parse(readFileSync(new URL('./__fixtures__/r173-quantitative.json', import.meta.url), 'utf8')) as Fixture[]
const close = (actual: number | null | undefined, expected: number) => {
  assert.equal(typeof actual, 'number')
  assert.ok(Number.isFinite(actual), 'result must be finite')
  assert.ok(Math.abs(actual! - expected) <= Math.max(1, Math.abs(expected)) * 1e-9, `${actual} != ${expected}`)
}
const fixture = (ruleId: string) => structuredClone(fixtures.find(f => f.ruleId === ruleId)!)
const unavailable = (ruleId: string, mutate: (input: QuantInput) => void, expectedReason: RegExp) => {
  const f = fixture(ruleId); mutate(f.input)
  const result = calculateQuantitativeRule(ruleId, f.input)
  assert.equal(result.status, 'UNAVAILABLE'); assert.equal(result.value, null)
  assert.match(result.missing.join(' '), expectedReason)
  assert.equal(result.planWrite, false); assert.equal(result.medicalClearance, false)
}

test('every implemented rule has an independently specified synthetic reference vector', () => {
  assert.deepEqual(fixtures.map(f => f.ruleId).sort(), Object.keys(quantitativeDefinitions).sort())
  assert.equal(new Set(fixtures.map(f => f.id)).size, fixtures.length)
})
test('constant measured lnRMSSD has zero CV; missing or zero mean is not treated as zero',()=>{
 const f=fixture('FAT_HRV_CV')
 for(const d of f.input.series!)d.value=Math.E
 const valid=calculateQuantitativeRule(f.ruleId,f.input)
 assert.equal(valid.status,'AVAILABLE');close(valid.value,0);assert.equal(valid.validSamples,7)
 for(const d of f.input.series!)d.value=1
 const zeroMean=calculateQuantitativeRule(f.ruleId,f.input)
 assert.equal(zeroMean.status,'UNAVAILABLE');assert.equal(zeroMean.value,null)
 assert.match(zeroMean.missing.join(' '),/ZERO_OR_NEGATIVE_DENOMINATOR/)
})
for (const f of fixtures) test(`${f.id}: ${f.ruleId} — ${f.reference}`, () => {
  const before = JSON.stringify(f.input), result = calculateQuantitativeRule(f.ruleId, f.input)
  assert.equal(result.status, 'AVAILABLE', result.missing.join(','))
  close(result.value, f.expected.value); assert.equal(result.unit, f.expected.unit)
  for (const [key, expected] of Object.entries(f.expected.metrics ?? {})) {
    if (expected === null) assert.equal(result.metrics[key], null)
    else close(result.metrics[key], expected)
  }
  assert.ok(result.sourceRefs.length > 0); assert.ok(result.formula.length > 0)
  assert.equal(result.planWrite, false); assert.equal(result.decisionAuthorized, false); assert.equal(result.medicalClearance, false)
  assert.equal(JSON.stringify(f.input), before, 'calculation must not mutate facts, plans or input metadata')
  assert.deepEqual(calculateQuantitativeRule(f.ruleId, f.input), result)
  assert.deepEqual(calculateQuantitativeRule(f.ruleId, f.input), result)
})

test('Q-EDGE-01 missing RPE is unknown, never zero', () => unavailable('LOAD_SRPE', i => { i.values!.rpe!.value = null }, /VALUE_UNKNOWN/))
test('Q-EDGE-02 a planned RPE cannot masquerade as actual', () => unavailable('LOAD_SRPE', i => { i.values!.rpe!.kind = 'PLAN' }, /NOT_ACTUAL/))
test('Q-EDGE-03 explicitly reported RPE zero is a valid zero load', () => {
  const f = fixture('LOAD_SRPE'); f.input.values!.rpe!.value = 0
  close(calculateQuantitativeRule(f.ruleId, f.input).value, 0)
  assert.equal(savedSessionAu({ id:'synthetic-zero', athleteId:'synthetic-athlete', day:'2026-10-10', sessionRpe:0, minutes:50, sourceIds:['synthetic-rpe-zero'], revision:'v1' }), 0)
})
test('Q-EDGE-04 reference zero never creates Infinity or a safe-zone label', () => unavailable('LOAD_WEEK_CHANGE', i => { i.values!.reference!.value = 0 }, /DENOMINATOR/))
test('Q-EDGE-05 incomplete calendar windows do not become complete by supplying totals', () => unavailable('LOAD_WEEK_CHANGE', i => { i.window!.complete = false }, /COMPLETE_WINDOW/))
test('Q-EDGE-06 unrelated units do not silently convert', () => unavailable('SESS_TARGET_HIT', i => { i.values!.current!.unit = 'min' }, /UNIT_OR_RANGE/))
test('Q-EDGE-07 different timing protocols prohibit comparison', () => unavailable('TEST_TIMING', i => { i.values!.reference!.protocol = 'synthetic-hand-timing' }, /PROTOCOL/))
test('Q-EDGE-08 two rounds are not flattened into a single CV group', () => unavailable('SESS_CV', i => { i.series![2].structure!.round = 2 }, /SAME_ROUND/))
test('Q-EDGE-09 null last split does not become a faster last recorded split', () => unavailable('SESS_FADE', i => { i.series![3].value = null }, /VALUE_UNKNOWN/))
test('Q-EDGE-10 a single split cannot yield a CV', () => unavailable('SESS_CV', i => { i.series = i.series!.slice(0, 1) }, /STRUCTURE/))
test('Q-EDGE-11 flat seven-day load has unavailable monotony, not zero strain', () => unavailable('LOAD_MONOTONY', i => { i.series!.forEach(d => { d.value = 100 }) }, /DENOMINATOR/))
test('Q-EDGE-12 an omitted EWMA day cannot be padded with zero', () => unavailable('LOAD_ACWR', i => { i.series = i.series!.slice(1) }, /DAILY_DATA_INCOMPLETE/))
test('Q-EDGE-13 duplicate dates cannot masquerade as consecutive complete days', () => unavailable('LOAD_ATL_CTL', i => { i.series![1].at = i.series![0].at }, /DAILY_DATA_INCOMPLETE/))
test('Q-EDGE-14 an actual source from another athlete cannot enter a calculation', () => unavailable('STR_E1RM', i => { i.values!.kg!.athleteId = 'synthetic-other' }, /PROVENANCE/))
test('Q-EDGE-15 future facts are not visible as of an earlier analysis', () => unavailable('STR_E1RM', i => { i.values!.kg!.recordedAt = '2026-10-14T00:00:00Z' }, /PROVENANCE/))
test('Q-EDGE-16 absent professional permission cannot enable return-speed calculation', () => unavailable('RTR_SPEED', i => { i.conditions = [] }, /CLINICAL_PERMISSION/))
test('Q-EDGE-17 an age-estimated HR threshold cannot replace measured LT1', () => unavailable('ABIL_HR_ZONES', i => { i.values!.lt1!.kind = 'ESTIMATE' }, /ESTIMATED_INPUT|MEASURED_THRESHOLDS/))
test('Q-EDGE-18 historical spike denominator excludes current session', () => unavailable('LOAD_SPIKE_SESSION', i => { i.series = [...i.series!, i.values!.current!] }, /PRIOR_30/))
test('Q-EDGE-19 zero FFM blocks energy division', () => unavailable('SEX_EA', i => { i.values!.ffm!.value = 0 }, /UNIT_OR_RANGE/))
test('Q-EDGE-20 different nutrition days cannot be combined as daily energy availability', () => unavailable('SEX_EA', i => { i.values!.exerciseEnergy!.at = '2026-10-09T10:00:00Z' }, /ENERGY_DAYS/))
test('Q-EDGE-21 e1RM high-repetition data fail the documented R171 screening limit', () => unavailable('STR_E1RM', i => { i.values!.reps!.value = 11 }, /UNIT_OR_RANGE/))
test('Q-EDGE-22 CS requires three distinct durations, not duplicate tests', () => unavailable('ABIL_CS', i => { i.series![1].value = i.series![0].value }, /DISTINCT_DURATION/))
test('Q-EDGE-23 HR recovery at 45s is not relabelled as 60s', () => unavailable('SESS_HR_RECOVERY', i => { i.values!.after60!.at = '2026-10-10T10:00:45Z' }, /60_SECOND/))
test('Q-EDGE-24 MDC cannot be calculated from SEM without a justified error model', () => unavailable('TEST_SWC', i => { i.conditions = i.conditions!.filter(c => c !== 'VALID_SEM_ERROR_MODEL') }, /ERROR_MODEL/))
test('Q-EDGE-25 unknown rules and safety routes cannot acquire training authorization', () => {
  for (const id of ['READY', 'SAFE_CHEST', 'ABIL_400_PRED', '__proto__']) {
    const result = calculateQuantitativeRule(id, fixture('LOAD_SRPE').input)
    assert.equal(result.status, 'UNAVAILABLE'); assert.equal(result.value, null)
    assert.equal(result.medicalClearance, false); assert.equal(result.planWrite, false)
  }
})
test('Q-EDGE-26 EWMA has a first-observation seed and no pre-window padding', () => {
  const values = [100, 0, 0]
  assert.deepEqual(calculateEwmaSeries(values, 7), [100, 75, 56.25])
  assert.deepEqual(values, [100, 0, 0])
})
test('Q-EDGE-27 data completeness is local to the question, never a readiness score', () => {
  const f = fixture('READY_MISSING'), result = calculateQuantitativeRule(f.ruleId, f.input)
  close(result.value, 0.5); assert.deepEqual(result.missing, ['FIELD_UNKNOWN:duration'])
  assert.match(result.limitations.join(' '), /不是医学或训练能力评分/)
})
test('Q-EDGE-28 same-rule correction changes calculated result and retains new source revision', () => {
  const f = fixture('LOAD_SRPE'), oldInput = structuredClone(f.input)
  const old = calculateQuantitativeRule(f.ruleId, oldInput)
  f.input.values!.rpe!.value = 6; f.input.values!.rpe!.revision = 'corrected-v2'
  const revised = calculateQuantitativeRule(f.ruleId, f.input)
  close(old.value, 350); close(revised.value, 300)
  assert.ok(revised.sourceRefs.some(s => s.revision === 'corrected-v2'))
  assert.equal(oldInput.values!.rpe!.value, 7)
})
test('Q-EDGE-29 a missing upper band is not treated as an unlimited speed-endurance band', () => unavailable('SPR_SPEEDEND_VOL', i => { i.values = { ...i.values, upperFraction: null } }, /FIELD_MISSING:upperFraction/))
test('Q-EDGE-30 an absent session list is not zero sessions', () => unavailable('REC_HARD_PER_WEEK', i => { i.series = undefined }, /EXPLICIT_SESSION_LIST/))
test('Q-EDGE-31 complete classified records can explicitly confirm zero sessions', () => {
  const f = fixture('REC_HARD_PER_WEEK'); f.input.series = []
  const result = calculateQuantitativeRule(f.ruleId, f.input)
  assert.equal(result.status, 'AVAILABLE'); close(result.value, 0)
})
test('Q-EDGE-32 missing classification is not evidence that all sessions were easy', () => unavailable('TA_NOVICE', i => { i.conditions = [] }, /SESSION_CLASSIFICATION/))
test('Q-EDGE-33 warmup duration remains usable when sprint count is unknown', () => {
  const f = fixture('SPR_WARMUP'); f.input.series = undefined
  const result = calculateQuantitativeRule(f.ruleId, f.input)
  assert.equal(result.status, 'AVAILABLE'); close(result.value, 15)
  assert.equal(result.metrics.progressiveSprints, null)
  assert.ok(result.missing.includes('PROGRESSIVE_SPRINT_RECORDS_UNKNOWN'))
})
test('Q-EDGE-34 fractional booleans cannot be counted as warmup records', () => unavailable('SPR_WARMUP', i => { i.series![0].value = 0.5 }, /BOOLEAN_REQUIRED/))
test('Q-EDGE-35 missing structural identity blocks split calculation', () => unavailable('SESS_CV', i => { i.series![0].structure!.blockId = '' }, /STRUCTURE/))
test('Q-EDGE-36 split results retain each original round and structural position', () => {
  const f = fixture('SESS_CV'), result = calculateQuantitativeRule(f.ruleId, f.input)
  assert.deepEqual(result.series.map(d => d.structure), f.input.series!.map(d => d.structure))
})
test('Q-EDGE-37 estimated session RPE is never saved as actual load by this calculator', () => unavailable('LOAD_SRPE', i => { i.values!.rpe!.kind = 'ESTIMATE' }, /ESTIMATED_INPUT/))
test('Q-EDGE-38 future-recording errors are not silently accepted as actual evidence', () => unavailable('LOAD_SRPE', i => { i.values!.minutes!.recordedAt = '2026-10-09T10:00:00Z' }, /RECORDED_BEFORE_EVENT/))
test('Q-EDGE-39 an out-of-scale Hooper item blocks the total', () => unavailable('FAT_HOOPER', i => { i.series![0].value = 8 }, /SCALE_RANGE/))
test('Q-EDGE-40 one missing Hooper baseline does not fabricate a zero change', () => {
  const f = fixture('FAT_HOOPER'), name = f.input.requiredFields![0]
  f.input.values = { ...f.input.values, [name]: undefined }
  const result = calculateQuantitativeRule(f.ruleId, f.input)
  assert.equal(result.status, 'AVAILABLE')
  assert.equal(result.series.find(d => d.id === name)!.value, null)
  assert.ok(result.missing.includes('HOOPER_BASELINE_UNKNOWN:' + name))
})
test('Q-EDGE-41 a repetition cannot be compared against later observations', () => unavailable('SPR_DROP_STOP', i => { i.values = { ...i.values, current: i.series![0] } }, /LATER_REPS/))
