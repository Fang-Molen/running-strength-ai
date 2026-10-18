import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WARMUP_PRESETS, WARMUP_BUDGETS, WARMUP_RECORDS_KEY, warmupPreset, warmupError, warmupMainError, beginWarmup, latestWarmup, loadWarmups, recordWarmupStep, finishWarmup, skipWarmup, warmupForPart, warmupGate, readWarmupClock, toggleWarmupClock, clockElapsed, readWarmupInput, saveWarmupInput, warmupInputKey } from './warmup';
import { scheduledWarmupBlock, linkScheduledWarmup } from './warmup-execution';
import { draftEntry, newTrainingDraft, entryDraft } from './training-editor';
import { resolveScheduledCourse, scheduleExecutionId } from './scheduled-execution';
import { startScheduledRun } from './scheduled-start';
import { commitTrackContinuous, finishTrackSession } from './running-workouts';
import { listTrainingOccurrences, bindTrainingStart } from '@/lib/core/occurrence';
import { loadEvents, dispatchEvent } from '@/lib/core/events';
import { setStoreBackend } from '@/lib/core/storage';
import { migrateKv } from '@/lib/vault';
const date = '2026-10-17';
function memory() { const m = new Map<string, string>(); return { keys: () => [...m.keys()], getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } }; }
beforeEach(() => { const store = memory(); setStoreBackend(store); Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true }); Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true }); Object.defineProperty(globalThis, 'navigator', { value: { locks: { request: async (_: string, work: () => unknown) => work() } }, configurable: true }); });
const shortPlan = () => warmupPreset('easy-run', 5);
test('all sport/time combinations have editable doses, unique IDs and an exact inclusive budget', () => {
  for (const { id } of WARMUP_PRESETS) for (const budget of WARMUP_BUDGETS) { const p = warmupPreset(id, budget); assert.equal(warmupError(p), null); assert.equal(new Set(p.steps.map(s => s.id)).size, p.steps.length); assert.equal(p.steps.reduce((n, s) => n + (s.windowSeconds ?? 0), 0), budget * 60); }
});
test('quick and full preparation differ in task content rather than playback speed', () => {
  assert.notDeepEqual(warmupPreset('quality-run', 5).steps.map(s => s.actionId), warmupPreset('quality-run', 40).steps.map(s => s.actionId));
  assert.ok(warmupPreset('quality-run', 15).steps.some(s => s.actionId === 'stride'));
  assert.ok(!warmupPreset('strength-lower', 15).steps.some(s => s.actionId === 'stride'));
  assert.notDeepEqual(warmupPreset('strength-upper', 15).steps.map(s => s.actionId), warmupPreset('strength-lower', 15).steps.map(s => s.actionId));
});
test('strength pre-sets need an actual main exercise and an explicit load; working weight is never guessed', () => {
  const p = warmupPreset('strength', 15); assert.match(warmupError(p, true)!, /主项/);
  const s = p.steps.at(-1)!; assert.equal(s.weightKg, null); s.name = '深蹲 · 预备组'; s.catalogId = 'back-squat'; s.weightKg = 0; assert.equal(warmupError(p, true), null);
});
test('malformed or duplicate preparation is rejected without throwing', () => {
  assert.ok(warmupError({} as never)); const p = shortPlan(); p.steps[0].name = undefined as never; assert.ok(warmupError(p)); p.steps[0] = p.steps[1]; assert.ok(warmupError(p));
});
test('removing or replacing a strength main exercise requires reconfirming its preparation', () => {
  const main = { name: '深蹲', catalogId: 'back-squat' }, p = warmupPreset('strength-lower',15,main);
  assert.equal(warmupMainError(p,[main]),null); assert.ok(warmupMainError(p,[{name:'卧推',catalogId:'bb-bench'}]));
});
test('old calendar entries stay without preparation; configured lists survive editing with independent snapshots', () => {
  const result = draftEntry({ ...newTrainingDraft(date, 'run'), type: 'run', minutes: '40', distance: '8000' }); assert.ok(result.ok); assert.ok(!('warmup' in result.entry));
  const p = shortPlan(), next = draftEntry({ ...entryDraft(result.entry), warmup: p }); assert.ok(next.ok); assert.deepEqual(entryDraft(next.entry).warmup, p); p.steps[0].amount = 1; assert.notEqual(next.entry.warmup!.steps[0].amount, 1);
});
test('reopening preparation resumes the same record and the frozen dose', async () => {
  const p = shortPlan(), first = await beginWarmup('a', date, p); p.steps[0].amount = 1;
  const again = await beginWarmup('a', date, p); assert.equal(first.id, again.id); assert.notEqual(again.plan.steps[0].amount, 1); assert.equal(loadWarmups().length, 1);
});
test('only one preparation can be active and a fresh pre-start block is honoured', async () => {
  await beginWarmup('a', date, shortPlan()); await assert.rejects(beginWarmup('b', date, shortPlan()), /另一节/);
  assert.match(scheduledWarmupBlock('b', 'scheduled:b:run')!, /另一节/);
  await finishWarmup(latestWarmup('a')!, true); await assert.rejects(beginWarmup('b', date, shortPlan(), () => '已有主课'), /主课/);
});
test('a timer does not create completed sets, session starts or calendar facts', async () => {
  const before = loadEvents().length, r = await beginWarmup('a', date, shortPlan()); toggleWarmupClock(r.id, r.plan.steps[0].id, 1000);
  assert.equal(clockElapsed(readWarmupClock(r.id, r.plan.steps[0].id), 61000), 60000); assert.equal(latestWarmup('a')!.steps.length, 0); assert.equal(listTrainingOccurrences().length, 0); assert.equal(loadEvents().length, before); assert.ok(warmupGate(r.plan, r));
});
test('work/rest clocks are mutually exclusive and reconstruct pause/refresh elapsed time', () => {
  toggleWarmupClock('r', 's', 1000); toggleWarmupClock('r', 's:rest', 4000);
  assert.equal(clockElapsed(readWarmupClock('r', 's'), 9000), 3000); assert.equal(clockElapsed(readWarmupClock('r', 's:rest'), 9000), 5000);
  toggleWarmupClock('r', 's:rest', 10000); toggleWarmupClock('r', 's', 12000);
  assert.equal(clockElapsed(readWarmupClock('r', 's'), 14000), 5000); assert.equal(clockElapsed(readWarmupClock('r', 's:rest'), 14000), 6000);
});
test('unfinished actual input including blanks survives closing and is not turned into facts', async () => {
  const r = await beginWarmup('a', date, shortPlan()), s = r.plan.steps[0], input = { different: true, sets: '1', amount: '120', weight: '', rest: '' };
  saveWarmupInput(r.id, s.id, input); assert.deepEqual(readWarmupInput(r.id, s), input); assert.ok(localStorage.getItem(warmupInputKey(r.id, s.id))); assert.equal(latestWarmup('a')!.steps.length, 0);
});
test('unknown elapsed/load/rest stay null; actual quantities are explicit and duplicate clicks cannot duplicate', async () => {
  const r = await beginWarmup('a', date, shortPlan()), s = r.plan.steps[0]; const next = await recordWarmupStep(r, s.id, 'COMPLETED', null, { sets: 1, amount: 100, weightKg: null });
  assert.deepEqual([next.steps[0].elapsedSeconds, next.steps[0].weightKg, next.steps[0].restSeconds], [null, null, null]); assert.equal(next.steps[0].amount, 100);
  await assert.rejects(recordWarmupStep(r, s.id, 'COMPLETED', 10), /另一处/); await assert.rejects(recordWarmupStep(next, s.id, 'COMPLETED', 10), /已处理/);
});
test('partly done and skipped actions remain different from full completion', async () => {
  let r = await beginWarmup('a', date, shortPlan()); r = await recordWarmupStep(r, r.plan.steps[0].id, 'COMPLETED', 20); r = await recordWarmupStep(r, r.plan.steps[1].id, 'SKIPPED', null);
  assert.equal(r.steps[1].amount, null); await assert.rejects(finishWarmup(r), /还有/); r = await finishWarmup(r, true); assert.equal(r.status, 'PARTIAL'); assert.equal(r.steps.length, 2); assert.equal(warmupGate(r.plan, r), null);
});
test('all explicitly completed actions produce a full preparation record', async () => {
  let r = await beginWarmup('a', date, shortPlan()); for (const s of r.plan.steps) r = await recordWarmupStep(r, s.id, 'COMPLETED', null); assert.equal((await finishWarmup(r)).status, 'COMPLETED');
});
test('skip this time does not disable the future plan or create zero-valued completion', async () => {
  const p = shortPlan(), a = await skipWarmup('a', date, p), b = await skipWarmup('a', date, p); assert.equal(a.id, b.id); assert.equal(a.startedAt, null); assert.equal(a.steps.length, 0); assert.equal(p.enabled, true); assert.equal(a.status, 'SKIPPED');
});
test('closed preparation binds by exact main occurrence, not a similar name/date', async () => {
  const p = shortPlan(); const entry = draftEntry({ ...newTrainingDraft(date, 'a'), type: 'run', minutes: '40', distance: '8000', warmup: p }); assert.ok(entry.ok);
  const run = resolveScheduledCourse(entry.entry, { sessions: [] }, []).run!; assert.ok(scheduledWarmupBlock('a', run.planId, p));
  await skipWarmup('a', date, p); assert.equal(scheduledWarmupBlock('a', run.planId, p), null);
  const started = await startScheduledRun(run); assert.ok(started.ok, JSON.stringify(started)); await linkScheduledWarmup('a', started.trainingOccurrenceId); assert.equal(latestWarmup('a')!.mainOccurrenceIds[0], started.trainingOccurrenceId);
  assert.equal(scheduledWarmupBlock('a', run.planId, p), null, 'resume bypasses used preparation');
  await assert.rejects(linkScheduledWarmup('b', started.trainingOccurrenceId), /编号不一致/);
  assert.ok(commitTrackContinuous(started.trainingOccurrenceId, 'run', '2400', '8000').ok); assert.ok(finishTrackSession(started.trainingOccurrenceId, 'COMPLETED', null, null).ok);
  assert.ok(scheduledWarmupBlock('a', run.planId, p), 'a new main occurrence asks for a new preparation decision');
});
test('one preparation may serve the two parts of a mixed course once each', async () => {
  const p = shortPlan(); await skipWarmup('mixed', date, p);
  for (const part of ['run', 'strength'] as const) {
    const sessionId = scheduleExecutionId('mixed', part), event = dispatchEvent('TRAINING_STARTED', { sessionId, decisionId: part, selectedAction: 'ORIGINAL_PLAN' }); assert.ok(event);
    const bound = bindTrainingStart({ startEventId: event.event_id, startedAt: event.timestamp, sessionId, planSlotId: 'mixed', plan: { id: sessionId, name: part, moves: [{ id: 'm', catalogId: 'back-squat', customName: '', sets: 1, mode: 'reps', amount: 1, weightKg: 0, restSec: null }] } }); assert.ok(bound);
    assert.ok(warmupForPart('mixed', sessionId, listTrainingOccurrences())); await linkScheduledWarmup('mixed', bound.trainingOccurrenceId); assert.equal(warmupForPart('mixed', sessionId, listTrainingOccurrences()), null);
  }
  assert.equal(latestWarmup('mixed')!.mainOccurrenceIds.length, 2);
});
test('storage errors do not report success or overwrite corrupt previous records', async () => {
  const r = await beginWarmup('a', date, shortPlan()), raw = localStorage.getItem(WARMUP_RECORDS_KEY); const original = localStorage.setItem;
  localStorage.setItem = () => {}; await assert.rejects(recordWarmupStep(r, r.plan.steps[0].id, 'COMPLETED', 5), /未核实保存/); assert.equal(localStorage.getItem(WARMUP_RECORDS_KEY), raw);
  localStorage.setItem = original; localStorage.setItem(WARMUP_RECORDS_KEY, 'broken'); await assert.rejects(beginWarmup('b', date, shortPlan()), /JSON|Unexpected/); assert.equal(localStorage.getItem(WARMUP_RECORDS_KEY), 'broken');
  assert.match(scheduledWarmupBlock('b','scheduled:b:run')!, /无法读取/);
});
test('full-vault upgrade preserves preparation records, running clocks, input drafts and avatar channels byte-for-byte', () => {
  const f = JSON.parse(readFileSync(new URL('../__fixtures__/vault-beta1-snapshot.json', import.meta.url), 'utf8')), before = new Map<string, string>(Object.entries(f.data)), after = migrateKv(new Map(before), f.schema);
  for (const key of ['fk-warmup-records-v1', 'fk-warmup-clock-v1:fixture-warmup:step-a', 'fk-warmup-input-v1:fixture-warmup:step-a', 'fk-personal-avatar-v72']) { assert.ok(before.has(key)); assert.equal(after.get(key), before.get(key)); }
});
