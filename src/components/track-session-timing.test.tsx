import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadEvents } from '@/lib/core/events';
import { projectRunningExecution } from '@/lib/core/running-execution';
import { setStoreBackend } from '@/lib/core/storage';
import { commitTrackRecovery, commitTrackSlot, saveCustomTrackPlan, startTrackSession } from '@/lib/ui/running-workouts';
import { TrackRunner, TrackStructureList } from './track-session';

function fixture(targetSeconds: number | null, repRestSeconds: number | null, repeatCount = 2) {
  const values = new Map<string, string>();
  setStoreBackend({ keys: () => [...values.keys()], getItem: key => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value) });
  assert.equal(saveCustomTrackPlan('qa-timing-display', 1, null, [{ distanceMeters: 200, targetSeconds, repeatCount, repRestSeconds, stepRestSeconds: null }]).ok, true);
  const start = startTrackSession('qa-timing-display');
  assert.ok(start.ok);
  return { occurrenceId: start.trainingOccurrenceId, values };
}

const visibleText = (html: string) => html.replace(/<[^>]*>/g, '');

test('running display shows precise target, completed and recovery seconds without rewriting facts', () => {
  const { occurrenceId, values } = fixture(45.123, 20.234);
  const initial = projectRunningExecution(occurrenceId, loadEvents());
  assert.equal(commitTrackSlot(initial.repetitions[0], 'complete', '44.567', '200').ok, true);
  assert.equal(commitTrackRecovery(initial.recoveries[0], '19.876').ok, true);
  const before = [...values];
  const text = visibleText(renderToStaticMarkup(createElement(TrackStructureList, { occurrenceId })));
  assert.match(text, /目标 45\.12 秒/);
  assert.match(text, /实际 200 米 · 44\.57 秒/);
  assert.match(text, /组间休息 · 计划 20\.23 秒 · 实际 19\.88 秒/);
  assert.deepEqual([...values], before, 'rendering must not write or round stored records');
  const after = projectRunningExecution(occurrenceId, loadEvents());
  assert.equal(after.repetitions[0].actualDurationSeconds, 44.567);
  assert.equal(after.recoveries[0].actualRecoverySeconds, 19.876);
  assert.equal(after.repetitions[0].plannedDurationSeconds, 45.123);
  assert.equal(after.recoveries[0].plannedRecoverySeconds, 20.234);
});

test('remaining time retains fractional seconds instead of rounding up to whole minutes', () => {
  const short = fixture(20.05, 4.1);
  const shortText = visibleText(renderToStaticMarkup(createElement(TrackRunner, { occurrenceId: short.occurrenceId, onClose() {} })));
  assert.match(shortText, /预计剩余：44\.2 秒/);
  const longer = fixture(35.05, 0.1);
  const longerText = visibleText(renderToStaticMarkup(createElement(TrackRunner, { occurrenceId: longer.occurrenceId, onClose() {} })));
  assert.match(longerText, /预计剩余：1分10\.2秒/);
  const hour = fixture(3599.995, null, 1);
  const hourText = visibleText(renderToStaticMarkup(createElement(TrackRunner, { occurrenceId: hour.occurrenceId, onClose() {} })));
  assert.match(hourText, /预计剩余：1小时0分0秒/);
});

test('unknown target and actual duration remain unknown while explicit zero rest stays zero', () => {
  const { occurrenceId, values } = fixture(null, 0);
  const before = [...values];
  const text = visibleText(renderToStaticMarkup(createElement(TrackStructureList, { occurrenceId })));
  assert.match(text, /目标 未设置/);
  assert.match(text, /实际 未记录 米 · 未记录/);
  assert.match(text, /组间休息 · 计划 0 秒 · 实际 未记录/);
  assert.doesNotMatch(text, /目标 0 秒|实际 0 秒/);
  assert.deepEqual([...values], before);
});
