import test from 'node:test';
import assert from 'node:assert/strict';
import type { MuscleAction } from '@/lib/body/muscle-actions';
import { initializeTrainingDraft, trainingTemplateDraftKey } from './training-draft-initialization';
import { newTrainingDraft, draftEntry, entryDraft, type TrainingDraft } from './training-editor';
import { readTrainingDraft, saveTrainingDraft, clearSavedTrainingDraft } from './training-draft-store';

const date = '2026-10-21';
const action: MuscleAction = { id: 'local:test-squat', name: '深蹲', source: 'local', catalogId: 'test-squat', primary: [], secondary: [], equipment: [], level: '', instructions: [], restSec: 90, unit: 'reps', sourceUrl: '', media3d: false };
const options = { date, id: 'custom:new-occurrence', createExerciseId: () => 'new-exercise' };
function runDraft(): TrainingDraft {
  const parsed = draftEntry({ ...newTrainingDraft(date, 'custom:saved-run'), type: 'run', name: '我的间歇', minutes: '40', distance: '200', target: '28', runMode: 'repeated', repeats: '4', rounds: '2', repeatRest: '', roundRest: '480' });
  assert.ok(parsed.ok);
  return entryDraft(parsed.entry);
}
function memory() {
  const rows = new Map<string, string>();
  return { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); }, removeItem: (key: string) => { rows.delete(key); } };
}

test('generic run/strength entrances preserve a saved mixed draft and all edited input', () => {
  const mixed = initializeTrainingDraft({ ...options, existing: runDraft(), seedAction: action });
  mixed.date = '2026-10-23'; mixed.name = '已改日期的组合课'; mixed.exercises[0].weight = '17.5';
  const snapshot = structuredClone(mixed);
  for (const initialType of ['run', 'strength'] as const) {
    const reopened = initializeTrainingDraft({ ...options, existing: mixed, initialType });
    assert.deepEqual(reopened, snapshot);
  }
  assert.deepEqual(mixed, snapshot);
});

test('type hints apply to new drafts only; another ordinary entrance does not convert saved running', () => {
  assert.equal(initializeTrainingDraft({ ...options, initialType: 'run' }).type, 'run');
  assert.equal(initializeTrainingDraft({ ...options, initialType: 'strength' }).type, 'strength');
  const saved = runDraft();
  assert.deepEqual(initializeTrainingDraft({ ...options, existing: saved, initialType: 'strength' }), saved);
});

test('explicit action addition preserves the running structure, IDs, unknown rests and existing input', () => {
  const saved = runDraft(), snapshot = structuredClone(saved);
  const next = initializeTrainingDraft({ ...options, existing: saved, seedAction: action });
  assert.equal(next.type, 'mixed'); assert.equal(next.id, saved.id);
  for (const key of ['distance', 'target', 'repeats', 'rounds', 'repeatRest', 'roundRest', 'runMode', 'name', 'minutes', 'date'] as const) assert.equal(next[key], saved[key]);
  assert.deepEqual(next.runTemplate, saved.runTemplate);
  assert.equal(next.exercises[0].weight, ''); assert.equal(next.exercises[0].sets, '');
  const parsed = draftEntry(next); assert.ok(parsed.ok);
  const running = parsed.entry.runComponents![0];
  assert.equal(running.modality, 'RUNNING');
  if (running.modality !== 'RUNNING' || running.structure.kind !== 'REPEATED') throw Error('running structure lost');
  assert.equal(running.structure.blocks[0].roundCount, 2);
  assert.equal(running.structure.blocks[0].steps[0].repeatCount, 4);
  assert.equal(running.structure.blocks[0].steps[0].recoveryAfterRepeatSeconds, null);
  assert.equal(running.componentId, saved.runTemplate?.componentId);
  assert.deepEqual(saved, snapshot);
});

test('opening the muscle picker retains running content and never downgrades a mixed draft', () => {
  const saved = runDraft();
  const opened = initializeTrainingDraft({ ...options, existing: saved, initialType: 'strength', openMuscleInitially: true });
  assert.equal(opened.type, 'mixed');
  assert.deepEqual({ ...opened, type: saved.type }, saved);
  const mixed = initializeTrainingDraft({ ...options, existing: saved, seedAction: action });
  assert.deepEqual(initializeTrainingDraft({ ...options, existing: mixed, initialType: 'strength', openMuscleInitially: true }), mixed);
});

test('reopening the same selected action does not duplicate it or overwrite its dose', () => {
  const first = initializeTrainingDraft({ ...options, existing: runDraft(), seedAction: action });
  first.exercises[0].sets = '3'; first.exercises[0].reps = '5'; first.exercises[0].weight = '30';
  const reopened = initializeTrainingDraft({ ...options, existing: first, seedAction: action, createExerciseId: () => { throw Error('duplicate action requested a new ID'); } });
  assert.deepEqual(reopened, first); assert.equal(reopened.exercises.length, 1);
});

test('action-library entry matches an existing action by catalog, source or name without treating absent IDs as matches', () => {
  const first = initializeTrainingDraft({ ...options, seedAction: action });
  first.exercises[0].sets = '4'; first.exercises[0].weight = '20.5';
  const identities = [
    { catalogId: action.catalogId, sourceId: undefined, name: '修改过的显示名' },
    { catalogId: 'another-catalog', sourceId: action.id, name: '来源动作别名' },
    { catalogId: undefined, sourceId: undefined, name: action.name },
  ];
  for (const identity of identities) {
    const saved = { ...first, exercises: [{ ...first.exercises[0], ...identity }] };
    const reopened = initializeTrainingDraft({ ...options, existing: saved, seedAction: action, createExerciseId: () => { throw Error('matching action requested a new ID'); } });
    assert.deepEqual(reopened, saved);
  }
  const distinct = { ...first, exercises: [{ ...first.exercises[0], catalogId: undefined, sourceId: undefined, name: '另一个动作' }] };
  const appended = initializeTrainingDraft({ ...options, existing: distinct, seedAction: { ...action, catalogId: null } });
  assert.equal(appended.exercises.length, 2);
  assert.deepEqual(appended.exercises[0], distinct.exercises[0]);
});

test('the same course resumes and clears its draft across fresh random entry IDs', () => {
  const store = memory();
  const firstTemplate = { id: 'random-calendar-a', modality: 'run' as const, refId: 'course-a' };
  const nextTemplate = { ...firstTemplate, id: 'random-calendar-b' };
  const key = trainingTemplateDraftKey(firstTemplate), reopenedKey = trainingTemplateDraftKey(nextTemplate);
  assert.equal(key, reopenedKey);
  const saved = { ...runDraft(), name: '课程草稿已改名', date: '2026-10-24' };
  assert.ok(saveTrainingDraft(store, date, saved, key));
  const storedSnapshot = JSON.parse(JSON.stringify(saved));
  const resumed = readTrainingDraft(store, date, reopenedKey); assert.deepEqual(resumed, storedSnapshot);
  const next = initializeTrainingDraft({ ...options, existing: resumed, initialType: 'strength' });
  assert.equal(next.id, saved.id); assert.notEqual(next.id, firstTemplate.refId);
  assert.deepEqual(next, storedSnapshot);
  clearSavedTrainingDraft(store, date, next.id, reopenedKey);
  assert.equal(readTrainingDraft(store, date, key), null);
});

test('template drafts stay separate by course, modality and date; entries without a reference keep their ID scope', () => {
  const store = memory(), saved = runDraft();
  const runKey = trainingTemplateDraftKey({ id: 'a', modality: 'run', refId: 'shared' });
  const strengthKey = trainingTemplateDraftKey({ id: 'b', modality: 'strength', refId: 'shared' });
  const anotherKey = trainingTemplateDraftKey({ id: 'c', modality: 'run', refId: 'another' });
  assert.notEqual(runKey, strengthKey); assert.notEqual(runKey, anotherKey);
  saveTrainingDraft(store, date, saved, runKey);
  assert.equal(readTrainingDraft(store, date, strengthKey), null);
  assert.equal(readTrainingDraft(store, date, anotherKey), null);
  assert.equal(readTrainingDraft(store, '2026-10-22', runKey), null);
  assert.equal(readTrainingDraft(store, date), null);
  assert.equal(trainingTemplateDraftKey({ id: 'no-reference', modality: 'run', refId: null }), 'no-reference');
  assert.equal(trainingTemplateDraftKey(undefined), undefined);
});

test('adding strength preserves a multi-component running plan instead of flattening it', () => {
  const single = draftEntry(runDraft()); assert.ok(single.ok);
  const main = single.entry.runComponents![0];
  const original = entryDraft({ ...single.entry, runComponents: [{ ...main, componentId: 'first' }, { ...main, componentId: 'second' }] });
  assert.ok(original.preservedRun);
  const next = initializeTrainingDraft({ ...options, existing: original, seedAction: action });
  const parsed = draftEntry(next); assert.ok(parsed.ok);
  assert.equal(next.type, 'mixed'); assert.deepEqual(parsed.entry.runComponents, original.preservedRun);
});
