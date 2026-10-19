import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { newTrainingDraft, draftEntry, entryDraft, validDate } from './training-editor';
import { resolveScheduledCourse, scheduledChoices, scheduleExecutionId } from './scheduled-execution';
import { loadSchedule, saveSchedule, saveScheduledEntry } from './day-schedule';
import { syncScheduleProgress } from './schedule-progress';
import { startScheduledRun, activeTrainingBlock } from './scheduled-start';
import { mergeActivities, garminRows, loadTrainingActivities, completedPlanIds, type ActivityRow } from './training-read-model';
import { assess } from './coach-assessment';
import { weekSummary, weekOf, type ScheduleEntry } from './day-schedule-rules';
import { setStoreBackend, type MemoryStore } from '@/lib/core/storage';
import { listTrainingOccurrences, bindTrainingStart } from '@/lib/core/occurrence';
import { loadEvents, dispatchEvent } from '@/lib/core/events';
import { projectRunningExecution } from '@/lib/core/running-execution';
import { commitTrackContinuous, finishTrackSession } from './running-workouts';
import { emptySets, recordSet } from '@/lib/core/execution';
import { completeFromRunner } from '@/components/training-runner';
import type { Plan } from '@/lib/strength/model';
import type { Session } from '@/lib/strength/model';
import { runnerDraftKey } from './runner-draft-key';
import { collectLocalBackup, inspectLocalBackup } from '@/lib/core/trial';
import { migrateKv } from '@/lib/vault';

function recordStrengthPart(e: ScheduleEntry, s: Session, partial = false) {
  const start = dispatchEvent('TRAINING_STARTED', { sessionId: s.id, decisionId: 'test-decision', selectedAction: 'ORIGINAL_PLAN' }); assert.ok(start);
  assert.ok(bindTrainingStart({ startEventId: start.event_id, startedAt: start.timestamp, sessionId: s.id, planSlotId: e.id, plan: s }));
  const set = { ...emptySets(s)[0], actualAmount: s.moves[0].amount, actualWeight: s.moves[0].weightKg, completed: true, source: 'user_entered' as const, timestamp: new Date().toISOString() };
  assert.ok(recordSet(s.id, 'test-decision', set));
  assert.ok(completeFromRunner({ decisionId: 'test-decision', sessionId: s.id, planned: null, actualSets: 1, actualAmount: set.actualAmount, actualWeightKg: set.actualWeight, rpe: 6, pain: false, modified: false, interrupted: false, partial }));
  return start.event_id;
}

const TODAY = '2026-10-17';
const plan: Plan = { name: '课程库', sessions: [{ id: 'old-template', name: '跑步·推进', moves: [{ id: 'old-move', catalogId: 'back-squat', customName: '', sets: 1, mode: 'reps', amount: 8, restSec: 90, weightKg: 60 }] }] };
function memory() {
  const map = new Map<string, string>(); return { keys: () => [...map.keys()], getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } };
}
beforeEach(() => {
  const store = memory(); setStoreBackend(store as MemoryStore);
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: { locks: { request: async (_: string, callback: () => unknown) => callback() } }, configurable: true });
});
function runEntry(id = 'calendar-run', distance = '8000') {
  const result = draftEntry({ ...newTrainingDraft(TODAY, id), type: 'run', name: '跑步8公里', minutes: '40', distance });
  assert.ok(result.ok); return result.entry;
}
function strengthEntry(id = 'calendar-strength') {
  const result = draftEntry({ ...newTrainingDraft(TODAY, id), name: '下肢力量', minutes: '40', exercises: [{ id: 'my-squat', catalogId: 'back-squat', name: '杠铃深蹲', sets: '1', reps: '8', weight: '60', rpe: '', unit: 'reps', restSec: 90 }] });
  assert.ok(result.ok); return result.entry;
}

test('adding and choosing a course preserves the selected date, title and exercise parameters', async () => {
  const e = strengthEntry(); assert.ok((await saveScheduledEntry(e)).ok);
  const choices = scheduledChoices(loadSchedule().entries, TODAY); assert.deepEqual(choices.map(e => e.title), ['下肢力量']);
  assert.equal(scheduledChoices(loadSchedule().entries, '2026-10-18').length, 0);
  const resolved = resolveScheduledCourse(choices[0], plan, []); assert.deepEqual(resolved.errors, []);
  assert.equal(resolved.strength?.name, '下肢力量'); assert.equal(resolved.strength?.moves[0].weightKg, 60); assert.equal(resolved.strength?.moves[0].restSec, 90);
  assert.notEqual(resolved.strength?.id, 'old-template');
});
test('same template on separate calendar days has independent execution identity', () => {
  const e = { ...strengthEntry(), exercises: undefined, refId: 'old-template' };
  const a = resolveScheduledCourse(e, plan, []), b = resolveScheduledCourse({ ...e, id: 'next-day', date: '2026-10-18' }, plan, []);
  assert.notEqual(a.strength?.id, b.strength?.id); assert.equal(a.strength?.name, e.title); assert.equal(plan.sessions[0].id, 'old-template');
});
test('unknown doses remain blank and cannot enter strength execution as zero or template defaults', () => {
  const e = strengthEntry(); e.exercises![0].weight = ''; e.exercises![0].restSec = null;
  const resolved = resolveScheduledCourse(e, plan, []); assert.ok(resolved.errors.length); assert.equal(resolved.strength, null);
  assert.equal(e.exercises![0].weight, ''); assert.equal(e.exercises![0].restSec, null);
});
test('external actions require explicit unit and side conventions', () => {
  const e = strengthEntry(); e.exercises![0].sourceId = 'external:Unknown'; e.exercises![0].unit = undefined;
  assert.match(resolveScheduledCourse(e, plan, []).errors.join(' '), /计量单位与侧别/);
  e.exercises![0].unit = 'reps'; e.exercises![0].counting = 'bilateral'; assert.deepEqual(resolveScheduledCourse(e, plan, []).errors, []);
});
test('an old run title is not parsed into a made-up distance or target', () => {
  const e = runEntry(); delete e.runComponents; delete e.km;
  const resolved = resolveScheduledCourse(e, plan, []); assert.equal(resolved.run, null); assert.ok(resolved.errors.length > 0);
});
test('200 x 4 x 2 retains rounds, stable step IDs, and unknown rests', () => {
  const result = draftEntry({ ...newTrainingDraft(TODAY, 'two-rounds'), type: 'run', minutes: '40', runMode: 'repeated', distance: '200', repeats: '4', rounds: '2' }); assert.ok(result.ok);
  const c = result.entry.runComponents![0]; assert.equal(c.modality, 'RUNNING'); if (c.modality !== 'RUNNING' || c.structure.kind !== 'REPEATED') throw Error('structure');
  assert.equal(c.structure.blocks[0].roundCount, 2); assert.equal(c.structure.blocks[0].steps[0].repeatCount, 4); assert.equal(c.structure.blocks[0].steps[0].recoveryAfterRepeatSeconds, null);
});
test('invalid dates and nonexistent single-round rests fail before saving', () => {
  assert.equal(validDate('2026-02-30'), false);
  assert.equal(draftEntry({ ...newTrainingDraft('2026-02-30', 'bad'), minutes: '40' }).ok, false);
  assert.equal(draftEntry({ ...newTrainingDraft(TODAY, 'bad'), type: 'run', minutes: '40', runMode: 'repeated', distance: '200', repeats: '4', rounds: '1', roundRest: '60' }).ok, false);
});
test('saving is idempotent, merges another new course, and detects conflicting edits', async () => {
  const a = strengthEntry(), b = runEntry(); assert.ok((await saveScheduledEntry(a)).ok); assert.ok((await saveScheduledEntry(a)).ok); assert.ok((await saveScheduledEntry(b)).ok);
  assert.equal(loadSchedule().entries.length, 2);
  const changed = { ...a, title: '已由另一窗口修改' }; assert.ok((await saveScheduledEntry(changed, a)).ok);
  assert.equal((await saveScheduledEntry({ ...a, title: '过期修改' }, a)).ok, false); assert.equal(loadSchedule().entries[0].title, changed.title);
});
test('a populated schedule is not silently truncated to 400 entries', () => {
  const entries = Array.from({ length: 405 }, (_, i) => ({ ...runEntry(), id: `old-${i}` })); assert.equal(saveSchedule({ entries, acks: [] }), true); assert.equal(loadSchedule().entries.length, 405);
});
test('run execution resumes the same occurrence and closes only its calendar slot', async () => {
  const e = runEntry(), other = strengthEntry(); await saveScheduledEntry(e); await saveScheduledEntry(other);
  const c = resolveScheduledCourse(e, plan, []); assert.ok(c.run);
  const a = await startScheduledRun(c.run), b = await startScheduledRun(c.run); assert.ok(a.ok && b.ok); if (!a.ok || !b.ok) return;
  assert.equal(a.trainingOccurrenceId, b.trainingOccurrenceId); assert.equal(listTrainingOccurrences().length, 1); assert.equal(loadSchedule().entries[0].actual, undefined);
  assert.equal(commitTrackContinuous(a.trainingOccurrenceId, 'run', '2400', '8000').ok, true);
  assert.equal(finishTrackSession(a.trainingOccurrenceId, 'COMPLETED', 4, null).ok, true); assert.equal(syncScheduleProgress(), true);
  const stored = loadSchedule().entries; assert.equal(stored[0].status, 'done'); assert.equal(stored[0].actual?.minutes, 40); assert.equal(stored[0].actual?.km, 8); assert.equal(stored[0].actual?.executionState, 'COMPLETED'); assert.equal(stored[1].actual, undefined);
  const executionRows = loadTrainingActivities().filter(r => r.source === 'execution');
  assert.equal(executionRows.length, 1); assert.equal(executionRows[0].sessionId, e.id);
  assert.deepEqual(completedPlanIds(executionRows, executionRows[0].date), [e.id]);
});
test('starting another course is blocked while one part is in progress', async () => {
  const a = resolveScheduledCourse(runEntry(), plan, []).run!, b = resolveScheduledCourse(runEntry('second'), plan, []).run!;
  assert.ok((await startScheduledRun(a)).ok); assert.match(activeTrainingBlock(b.planId) ?? '', /进行中/); assert.equal((await startScheduledRun(b)).ok, false); assert.equal(listTrainingOccurrences().length, 1);
});
test('an edited running plan applies to a new occurrence and keeps the earlier snapshot', async () => {
  const e = runEntry(), a = resolveScheduledCourse(e, plan, []).run!; const started = await startScheduledRun(a); assert.ok(started.ok); if (!started.ok) return;
  assert.ok(commitTrackContinuous(started.trainingOccurrenceId, 'run', '2400', '8000').ok); assert.ok(finishTrackSession(started.trainingOccurrenceId, 'COMPLETED', null, null).ok);
  const b = resolveScheduledCourse(runEntry(e.id, '5000'), plan, []).run!, next = await startScheduledRun(b); assert.ok(next.ok); if (!next.ok) return;
  assert.equal(projectRunningExecution(next.trainingOccurrenceId, loadEvents()).continuous[0].plannedDistanceMeters, 5000);
  assert.equal(projectRunningExecution(started.trainingOccurrenceId, loadEvents()).continuous[0].plannedDistanceMeters, 8000);
});
test('actual strength sets close the original calendar slot without using estimated minutes', async () => {
  const e = strengthEntry(); await saveScheduledEntry(e); const s = resolveScheduledCourse(e, plan, []).strength!;
  const start = dispatchEvent('TRAINING_STARTED', { sessionId: s.id, decisionId: 'test-decision' }); assert.ok(start);
  const bound = bindTrainingStart({ startEventId: start.event_id, startedAt: start.timestamp, sessionId: s.id, planSlotId: e.id, plan: s }); assert.ok(bound);
  const set = { ...emptySets(s)[0], actualAmount: 8, actualWeight: 60, completed: true, source: 'user_entered' as const, timestamp: new Date().toISOString() }; assert.ok(recordSet(s.id, 'test-decision', set));
  assert.ok(completeFromRunner({ decisionId: 'test-decision', sessionId: s.id, planned: null, actualSets: 1, actualAmount: 8, actualWeightKg: 60, rpe: 6, pain: false, modified: false, interrupted: false, partial: false }));
  assert.ok(syncScheduleProgress()); const a = loadSchedule().entries[0].actual; assert.equal(a?.executionState, 'COMPLETED'); assert.notEqual(a?.minutes, 40); assert.deepEqual(a?.occurrenceIds, [start.event_id]);
  assert.equal(loadTrainingActivities()[0]?.sets, 1);
});
test('no report is not a missed session in either the week summary or coach assessment', () => {
  const entries = [runEntry('a'), { ...runEntry('b'), date: '2026-10-16' }, { ...runEntry('c'), date: '2026-10-15' }];
  const result = weekSummary(entries, weekOf(TODAY), TODAY); assert.equal(result.missed, 0); assert.equal(result.open, 1); assert.equal(result.unrecorded, 2);
  const a = assess({ today: TODAY, entries, logs: [{ id: 'real', date: TODAY, sport: 'RUNNING', distanceM: 5000, durationSec: 1500, strengthVolumeKg: null, sets: null, rpe: null }], recovery: null, feedback: [] }); assert.doesNotMatch(a.verdict, /偏满|没完成/); assert.match(a.evidence.join(' '), /未登记结果/);
});
test('Garmin cache contributes actual dates and conservative cross-source deduplication', () => {
  const g = garminRows({ 1: { id: 1, start: '2026-10-14T20:31:01+08:00', type: 'running', dist: 5010, dur: 1332 } }); assert.equal(g.length, 1); assert.equal(g[0].strengthVolumeKg, null);
  const imported: ActivityRow = { ...g[0], id: 'imported', source: 'import', originIds: ['imported'] };
  assert.equal(mergeActivities([g[0], imported]).length, 2); // Same timestamp is not verified identity.
  assert.equal(mergeActivities([g[0], {...imported,originIds:[g[0].id]}]).length,1);
  assert.equal(mergeActivities([g[0], { ...imported, startedAt: '2026-10-14T20:31:11+08:00' }]).length, 2);
  localStorage.setItem('fk-garmin-acts-v1', JSON.stringify({ 1: { id: 1, start: '2026-10-14T20:31:01+08:00', type: 'running', dist: 5010, dur: 1332 } })); assert.equal(loadTrainingActivities().length, 1);
});
test('a mixed course waits for both parts before closing the calendar entry', async () => {
  const e = { ...strengthEntry('mixed'), trainingType: 'mixed' as const, runComponents: runEntry().runComponents };
  await saveScheduledEntry(e); const c = resolveScheduledCourse(e, plan, []); assert.deepEqual(c.errors, []);
  const run = await startScheduledRun(c.run!); assert.ok(run.ok); if (!run.ok) return;
  assert.ok(commitTrackContinuous(run.trainingOccurrenceId, 'run', '2400', '8000').ok); assert.ok(finishTrackSession(run.trainingOccurrenceId, 'COMPLETED', null, null).ok);
  assert.ok(syncScheduleProgress()); assert.equal(loadSchedule().entries[0].actual, undefined); assert.equal(loadSchedule().entries[0].status, 'planned');
  recordStrengthPart(e, c.strength!); assert.ok(syncScheduleProgress());
  const stored = loadSchedule().entries[0]; assert.equal(stored.status, 'done'); assert.equal(stored.actual?.executionState, 'COMPLETED'); assert.equal(stored.actual?.occurrenceIds?.length, 2); assert.equal(stored.actual?.km, 8);
});
test('partial strength remains partial and a reduced prescription is not reported as the original plan', async () => {
  const e = strengthEntry(); e.exercises![0].sets = '2'; await saveScheduledEntry(e);
  const s = resolveScheduledCourse(e, plan, []).strength!; recordStrengthPart(e, s, true); assert.ok(syncScheduleProgress());
  assert.equal(loadSchedule().entries[0].actual?.executionState, 'PARTIAL'); assert.equal(loadSchedule().entries[0].status, 'planned');
  const reduced = { ...s, moves: [{ ...s.moves[0], sets: 1 }] }; recordStrengthPart(e, reduced); assert.ok(syncScheduleProgress());
  const actual = loadSchedule().entries[0].actual; assert.equal(actual?.executionState, 'COMPLETED'); assert.equal(actual?.outcome, 'different'); assert.equal(loadSchedule().entries[0].exercises![0].sets, '2');
});
test('calendar projection preserves an explicitly entered actual result', async () => {
  const e = strengthEntry(); e.actual = { outcome: 'different', minutes: 33, km: null, intensity: 'MODERATE', reasons: [], at: '2026-10-17T10:00:00Z', note: '用户核实的记录' };
  await saveScheduledEntry(e); recordStrengthPart(e, resolveScheduledCourse(e, plan, []).strength!); assert.ok(syncScheduleProgress());
  assert.deepEqual(loadSchedule().entries[0].actual, e.actual);
});
test('editing a repeated run preserves purpose and component/block/step identity', () => {
  const made = draftEntry({ ...newTrainingDraft(TODAY, 'preserve'), type: 'run', minutes: '40', runMode: 'repeated', distance: '200', repeats: '4', rounds: '2', repeatRest: '120', roundRest: '300' }); assert.ok(made.ok);
  const component = made.entry.runComponents![0]; assert.equal(component.modality, 'RUNNING'); if (component.modality !== 'RUNNING' || component.structure.kind !== 'REPEATED') return;
  component.componentId = 'warm-up-technique'; component.purpose = 'WARMUP'; component.structure.blocks[0].blockId = 'block-original'; component.structure.blocks[0].steps[0].stepId = 'step-original';
  const edited = draftEntry({ ...entryDraft(made.entry), name: '只改名称' }); assert.ok(edited.ok); assert.deepEqual(edited.entry.runComponents, made.entry.runComponents);
});
test('calendar input drafts survive full-vault migration and cannot poison the legacy core export', () => {
  const id = scheduleExecutionId('custom:' + 'a'.repeat(36), 'strength');
  const key = runnerDraftKey('d'.repeat(36), id, 'm'.repeat(36) + ':2'), value = JSON.stringify({ weight: '', amount: '8' });
  assert.match(key, /^fk-runner-draft-v71:/); assert.equal(runnerDraftKey('d','old-session','move:1'), 'fr255-runner-draft-v1:d:old-session:move:1');
  const data = new Map([[key, value], ['fr255-profile-v1', '{"age":25}']]); assert.equal(migrateKv(new Map(data), 1).get(key), value);
  const store = { length: data.size, key: (i: number) => [...data.keys()][i] ?? null, getItem: (k: string) => data.get(k) ?? null };
  assert.equal(inspectLocalBackup(collectLocalBackup(store), store).ok, true);
});
