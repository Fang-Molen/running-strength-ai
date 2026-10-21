import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesImportedPlanPane, matchesScheduledPlanPane } from './plan-training-filter';
import { draftEntry, newTrainingDraft } from './training-editor';
import type { V4Day } from './plan400-view';

function mixedEntry() {
  const parsed = draftEntry({
    ...newTrainingDraft('2026-10-22', 'custom:mixed-filter'),
    type: 'mixed', name: '间歇与深蹲', minutes: '40', distance: '200',
    runMode: 'repeated', repeats: '4', rounds: '2',
    exercises: [{ id: 'move:1', name: '深蹲', sets: '3', reps: '8', weight: '20.5', rpe: '', restSec: null }],
  });
  assert.ok(parsed.ok);
  return parsed.entry;
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}

function day(title: string, strength: string[], date = '2026-10-22'): V4Day {
  return { orig: date, date, weekday: '周四', week: 'W1', title, main: ['200米 × 4次 × 2轮'], aux: [], strength };
}

test('scheduled pure running and strength stay separate for planned and completed entries, including older entries', () => {
  for (const status of ['planned', 'done']) {
    for (const modality of ['run', 'strength'] as const) {
      const entry = { id: `custom:${modality}:${status}`, modality, status };
      assert.equal(matchesScheduledPlanPane(entry, modality), true);
      assert.equal(matchesScheduledPlanPane(entry, modality === 'run' ? 'strength' : 'run'), false);
      assert.equal(matchesScheduledPlanPane({ ...entry, trainingType: modality }, modality), true);
    }
  }
});

test('a real mixed draft is visible once in each pane with the same entry identity', () => {
  const entry = mixedEntry();
  const entries = [entry];
  for (const pane of ['run', 'strength'] as const) {
    const visible = entries.filter(item => matchesScheduledPlanPane(item, pane));
    assert.equal(visible.length, 1);
    assert.strictEqual(visible[0], entry);
    assert.equal(visible[0].id, 'custom:mixed-filter');
  }
  assert.equal(entry.modality, 'strength');
  assert.equal(entry.trainingType, 'mixed');
  assert.equal(entry.status, 'planned');
});

test('proposals, cancelled entries, unplanned records and imported occurrences never enter the custom plan panes', () => {
  const entry = mixedEntry();
  const excluded = [
    ...['proposed', 'skipped', 'rejected', 'cancelled'].map(status => ({ ...entry, status })),
    { ...entry, unplanned: true },
    { ...entry, id: 'plan400:2026-10-22' },
    { ...entry, id: 'plan400:2026-10-22:strength', status: 'done' },
  ];
  for (const item of excluded) {
    for (const pane of ['run', 'strength'] as const) assert.equal(matchesScheduledPlanPane(item, pane), false, `${item.id}/${item.status}/${pane}`);
  }
  assert.equal(matchesScheduledPlanPane({ ...entry, id: 'custom:plan400:reference' }, 'run'), true);
});

test('pane filtering preserves mixed running rounds, strength doses, unknown values and actual status', () => {
  const entry = freezeDeep(mixedEntry()), snapshot = structuredClone(entry);
  const running = entry.runComponents, exercises = entry.exercises;
  for (const pane of ['run', 'strength'] as const) assert.equal(matchesScheduledPlanPane(entry, pane), true);
  assert.deepEqual(entry, snapshot);
  assert.strictEqual(entry.runComponents, running);
  assert.strictEqual(entry.exercises, exercises);
  assert.equal(entry.actual, undefined);
  assert.equal(entry.betweenRestSec, null);
  assert.equal(entry.exercises![0].rpe, '');
  assert.equal(entry.exercises![0].restSec, null);
  const component = entry.runComponents![0];
  assert.equal(component.modality, 'RUNNING');
  if (component.modality !== 'RUNNING' || component.structure.kind !== 'REPEATED') throw Error('running interval structure lost');
  const block = component.structure.blocks[0], step = block.steps[0];
  assert.equal(block.roundCount, 2);
  assert.equal(step.repeatCount, 4);
  assert.equal(step.plannedDistanceMeters, 200);
  assert.equal(step.plannedDurationSeconds, null);
  assert.equal(step.recoveryAfterRepeatSeconds, null);
  assert.equal(block.recoveryAfterRoundSeconds, null);
});

test('other training retains its existing stored running modality', () => {
  const parsed = draftEntry({ ...newTrainingDraft('2026-10-22', 'custom:other'), type: 'other', name: '其他训练', minutes: '20' });
  assert.ok(parsed.ok);
  assert.equal(matchesScheduledPlanPane(parsed.entry, 'run'), true);
  assert.equal(matchesScheduledPlanPane(parsed.entry, 'strength'), false);
});

test('imported pure run, strength, mixed, rest, recovery and test days follow the existing component classification', () => {
  const cases = [
    { value: day('速度训练', ['无']), run: true, strength: false },
    { value: day('力量训练', ['深蹲 3组 × 8次']), run: false, strength: true },
    { value: day('速度与力量', ['深蹲 3组 × 8次']), run: true, strength: true },
    { value: day('休息日', ['可选力量文本保留']), run: false, strength: false },
    { value: day('恢复跑', ['仅活动度练习']), run: true, strength: false },
    { value: day('400米测试 TEST', ['无']), run: true, strength: false },
  ];
  for (const row of cases) {
    const snapshot = structuredClone(row.value);
    freezeDeep(row.value);
    assert.equal(matchesImportedPlanPane(row.value, 'run'), row.run, row.value.title);
    assert.equal(matchesImportedPlanPane(row.value, 'strength'), row.strength, row.value.title);
    assert.deepEqual(row.value, snapshot);
  }
});

test('optional strength wording is not promoted to a formal strength part', () => {
  for (const strength of [[], ['无'], ['可做轻量辅助'], ['仅活动度练习']]) {
    const value = day('轻松跑', strength);
    assert.equal(matchesImportedPlanPane(value, 'run'), true);
    assert.equal(matchesImportedPlanPane(value, 'strength'), false);
  }
});

test('imported mixed days stay the same source object in both panes and rest days remain in the source list', () => {
  const mixed = day('跑步与力量', ['深蹲 3组 × 8次']);
  const rest = day('休息日', ['无'], '2026-10-23');
  const days = freezeDeep([mixed, rest]), snapshot = structuredClone(days);
  for (const pane of ['run', 'strength'] as const) {
    const visible = days.filter(value => matchesImportedPlanPane(value, pane));
    assert.equal(visible.length, 1);
    assert.strictEqual(visible[0], mixed);
  }
  assert.equal(days.length, 2);
  assert.strictEqual(days[1], rest);
  assert.deepEqual(days, snapshot);
});
