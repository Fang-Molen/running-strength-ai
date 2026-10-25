import test from 'node:test'
import assert from 'node:assert/strict'
import type { ScheduleEntry } from '@/lib/ui/day-schedule-rules'
import {
  applyChange, decide, emptySuggestionDocument, evaluateOutcome, generateSuggestions, mergeSuggestions,
  noteFor, recheckTarget, reviewNotes, sanitizeEdit, suggestionFacts, visibleSuggestions, type GenerationInput,
} from './suggestions'
import { resolveEffectiveProfile, describeEffectiveProfile } from './effective-profile'
import { composeUnifiedSupplement, MAX_FOLLOW_UPS, ONLINE_FACTS_LIMIT } from './unified-answer'
import { emptyProfile } from '@/lib/strength/profile'

const entry = (id: string, date: string, extra: Partial<ScheduleEntry> = {}): ScheduleEntry => ({
  athleteId: 'a', id, date, kind: 'strength', modality: 'strength', title: id, focus: [], minutes: 60, intensity: 'HARD',
  lowerHeavy: true, source: 'custom', refId: null, status: 'planned', ...extra,
})
const input = (over: Partial<GenerationInput> = {}): GenerationInput => ({
  athleteId: 'a', today: '2026-10-25', now: '2026-10-25T08:00:00.000Z', entries: [], safetyState: null, recovery: null,
  events: [], availableMinutes: null, startedIds: new Set(), basisVersion: 'v1', ...over,
})

test('suggestions: pain/safety hold proposes cancelling the next key session, never auto-applied', () => {
  const out = generateSuggestions(input({ safetyState: 'HOLD_ACTIVE', entries: [entry('legs', '2026-10-26')] }))
  assert.equal(out.length, 1)
  assert.equal(out[0].kind, 'CANCEL')
  assert.equal(out[0].status, 'PENDING')
  for (const k of ['reason', 'original', 'proposed', 'impact', 'uncertainty'] as const) assert.ok(out[0][k].length > 0, k)
  assert.ok(out[0].basis.items.length > 0)
})

test('suggestions: low recovery reduces today only, and never increases dose', () => {
  const out = generateSuggestions(input({ recovery: { readiness: null, hrvToday: 40, hrvBaseline: 60, sleepLast: null, sleepBaseline: null }, entries: [entry('today', '2026-10-25'), entry('later', '2026-10-27')] }))
  assert.deepEqual(out.map(s => s.target.entryId), ['today'])
  assert.equal(out[0].kind, 'REDUCE')
  assert.ok(out[0].change.minutes! < 60)
  assert.equal(typeof sanitizeEdit(out[0], { minutes: 90 }), 'string', 'longer than the original is refused')
  assert.equal(typeof sanitizeEdit(out[0], { intensity: 'HARD' }), 'object', 'same intensity is allowed')
  const easy = sanitizeEdit({ ...out[0], target: { ...out[0].target, intensity: 'EASY' } }, { intensity: 'HARD' })
  assert.equal(typeof easy, 'string', 'a higher intensity is refused')
  const applied = applyChange(entry('today', '2026-10-25'), out[0], { minutes: 999, intensity: 'MODERATE' })
  assert.equal(applied.minutes, 60, 'apply never exceeds the original minutes')
})

test('suggestions: back-to-back key sessions keep both run and strength, moving the strength one', () => {
  const run = entry('intervals', '2026-10-26', { modality: 'run', kind: 'run', lowerHeavy: false })
  const lift = entry('squat', '2026-10-27')
  const out = generateSuggestions(input({ entries: [run, lift] }))
  const move = out.find(s => s.rule === 'BACK_TO_BACK')!
  assert.equal(move.kind, 'MOVE')
  assert.equal(move.target.entryId, 'squat')
  assert.ok(move.change.toDate && move.change.toDate !== '2026-10-27' && move.change.toDate !== '2026-10-26')
})

test('suggestions: started, finished, past and other athletes\' sessions are never targeted', () => {
  const out = generateSuggestions(input({
    safetyState: 'HOLD_ACTIVE',
    startedIds: new Set(['started']),
    entries: [entry('started', '2026-10-25'), entry('past', '2026-10-24'), entry('done', '2026-10-26', { status: 'done' }), entry('other', '2026-10-26', { athleteId: 'b' })],
  }))
  assert.equal(out.length, 0)
})

test('suggestions: decisions, expiry, de-duplication and recheck before writing', () => {
  const first = generateSuggestions(input({ safetyState: 'HOLD_ACTIVE', entries: [entry('legs', '2026-10-26')] }))
  let doc = mergeSuggestions(emptySuggestionDocument('a'), first, '2026-10-25T08:00:00.000Z')
  doc = mergeSuggestions(doc, first, '2026-10-25T09:00:00.000Z')
  assert.equal(doc.suggestions.length, 1, 'the same suggestion is not added twice')
  const s = doc.suggestions[0]
  const deferred = decide(s, { action: 'DEFER', until: '2026-10-26T00:00:00.000Z' }, '2026-10-25T10:00:00.000Z')
  assert.equal(visibleSuggestions({ ...doc, suggestions: [deferred] }, '2026-10-25T12:00:00.000Z').length, 0)
  assert.equal(visibleSuggestions({ ...doc, suggestions: [deferred] }, '2026-10-26T01:00:00.000Z').length, 1)
  const later = mergeSuggestions(doc, [], '2026-10-28T00:00:00.000Z')
  assert.equal(later.suggestions[0].status, 'EXPIRED', 'no response means no execution, and it expires')
  const changedBasis = generateSuggestions(input({ safetyState: 'HOLD_ACTIVE', basisVersion: 'v2', entries: [entry('legs', '2026-10-26')] }))
  const rebased = mergeSuggestions(doc, changedBasis, '2026-10-25T11:00:00.000Z')
  assert.equal(rebased.suggestions.find(x => x.id === s.id)!.status, 'EXPIRED')
  assert.equal(visibleSuggestions(rebased, '2026-10-25T11:00:00.000Z')[0].basis.version, 'v2', 'a changed basis gives a fresh preview')
  assert.equal(typeof recheckTarget(s, [entry('legs', '2026-10-26', { minutes: 45 })], input()), 'string', 'an edited session needs a new preview')
  assert.equal(typeof recheckTarget(s, [entry('legs', '2026-10-26')], input()), 'object')
})

test('feedback loop: outcomes support, weaken or withdraw; notes follow and keep history', () => {
  const s = { ...generateSuggestions(input({ recovery: { readiness: null, hrvToday: 40, hrvBaseline: 60, sleepLast: null, sleepBaseline: null }, entries: [entry('today', '2026-10-25')] }))[0] }
  const accepted = decide(s, { action: 'ACCEPT' }, '2026-10-25T09:00:00.000Z')
  const done = entry('today', '2026-10-25', { minutes: 42, actual: { outcome: 'as_planned', minutes: 42, rpe: 6, intensity: 'MODERATE', note: '', reasons: [] } as never })
  assert.equal(evaluateOutcome(accepted, [done], null, 'v1', '2026-10-26T08:00:00.000Z').outcome!.state, 'SUPPORTED')
  const pain = entry('today', '2026-10-25', { actual: { outcome: 'different', minutes: 20, rpe: 7, intensity: 'EASY', note: '', reasons: ['pain'] } as never })
  const withdrawn = evaluateOutcome(accepted, [pain], null, 'v1', '2026-10-26T08:00:00.000Z')
  assert.equal(withdrawn.outcome!.state, 'WITHDRAWN')
  const note = noteFor(accepted, '2026-10-25T09:00:00.000Z', accepted.change)
  assert.match(note.text, /^方坤：/)
  const reviewed = reviewNotes([note], [withdrawn], 'v1', '2026-10-26T08:00:00.000Z')
  assert.equal(reviewed[0].status, 'WITHDRAWN')
  assert.equal(reviewed[0].history.length, 2, 'history is kept')
  const corrected = reviewNotes([note], [accepted], 'v2', '2026-10-26T08:00:00.000Z')
  assert.equal(corrected[0].status, 'NEEDS_REVIEW', 'a corrected input marks dependent notes for review')
  const rejected = decide(s, { action: 'REJECT' }, '2026-10-25T09:00:00.000Z')
  const fine = entry('today', '2026-10-25', { actual: { outcome: 'as_planned', minutes: 60, rpe: 6, intensity: 'HARD', note: '', reasons: [] } as never })
  assert.equal(evaluateOutcome(rejected, [fine], null, 'v1', '2026-10-26T08:00:00.000Z').outcome!.state, 'WEAKENED')
  assert.ok(suggestionFacts({ ...emptySuggestionDocument('a'), suggestions: [withdrawn] }, '2026-10-26T08:00:00.000Z').some(l => /跟踪/.test(l)))
})

test('effective profile: most recent dated value wins, conflicts are reported, missing stays unknown', () => {
  const profile = { ...emptyProfile(), weightKg: '70', age: '30', sex: 'female' as const, heightCm: '165', aim: 'lose' as const }
  const checks = [{ id: 'c1', date: '2026-10-24', weight: 66, recordedAt: '2026-10-24T07:00:00.000Z' }]
  const p = resolveEffectiveProfile({ profile, profileSavedAt: '2026-10-20T07:00:00.000Z', checks, personal: null })
  assert.equal(p.weightKg?.value, 66)
  assert.equal(p.weightKg?.source, 'BODY_MEASUREMENT')
  assert.ok(p.conflicts.some(c => c.field === 'weightKg'), '70 vs 66 within two weeks is a conflict to check')
  const newer = resolveEffectiveProfile({ profile, profileSavedAt: '2026-10-25T07:00:00.000Z', checks, personal: null })
  assert.equal(newer.weightKg?.value, 70, 'a value typed after the measurement is current')
  const empty = resolveEffectiveProfile({ profile: emptyProfile(), checks: [], personal: null })
  assert.equal(empty.weightKg, null)
  assert.ok(empty.missing.includes('weightKg'))
  assert.ok(describeEffectiveProfile(empty).some(l => /体重：未知/.test(l)))
  const goals = resolveEffectiveProfile({ profile, profileSavedAt: null, checks: [], personal: { profile: { schema: 1, athleteId: 'a', revision: 2, goal: 'HYPERTROPHY', services: ['STRENGTH'], age: 30, sex: 'female', heightCm: 165, weightKg: 70, activity: null, screen: 'CLEAR', experience: 'BEGINNER', days: [1], minutes: 40, equipment: 'NONE', diet: 'OMNIVORE' }, profileSavedAt: '2026-10-22T00:00:00.000Z' } })
  assert.ok(goals.conflicts.some(c => c.field === 'goal'), 'fat loss vs muscle gain is reported, not silently merged')
})

test('unified answer: at most two follow-up questions, assumptions labelled, facts stay under the online limit', () => {
  const p = resolveEffectiveProfile({ profile: emptyProfile(), checks: [], personal: null })
  const u = composeUnifiedSupplement({
    question: '增肌怎么吃',
    r4: { text: '下一步请核对：专项、训练阶段。这些条件会改变知识或课程的选择。\n已记录 2 条食物', day: '2026-10-25', conditions: { population: 'unknown' } },
    personalText: '先按已有资料给出一般方案（尚未在“私人教练”里确认条件，以下不是你的确认事实）：\n草案',
    effective: p,
  })
  const count = (u.followUps.match(/^\d\./gm) ?? []).length
  assert.ok(count <= MAX_FOLLOW_UPS)
  assert.ok(u.assumptions.length > 0)
  assert.match(u.localSection ?? '', /假设：/)
  const big = 'x'.repeat(7900)
  assert.ok(u.appendToFacts(big).length <= ONLINE_FACTS_LIMIT)
})
