import test from 'node:test';
import assert from 'node:assert/strict';
import { niceTicks } from './trend-chart';

function assertCovered(lo: number, hi: number) {
  const ticks = niceTicks(lo, hi);
  assert.ok(ticks.length >= 2, 'a usable scale needs at least two ticks');
  assert.ok(ticks.every(Number.isFinite), 'every tick must be finite');
  assert.ok(ticks[0] <= lo, `first tick ${ticks[0]} must include minimum ${lo}`);
  assert.ok(ticks[ticks.length - 1] >= hi, `last tick ${ticks[ticks.length - 1]} must include maximum ${hi}`);
  for (let i = 1; i < ticks.length; i++) assert.ok(ticks[i] > ticks[i - 1], 'ticks must be strictly increasing');
  return ticks;
}

test('display ticks include irregular positive upper values instead of clipping the highest point', () => {
  for (const [lo, hi] of [[6.7, 7.5], [0.1, 0.31], [52, 57.3]]) assertCovered(lo, hi);
});

test('display ticks cover negative and zero-crossing data ranges', () => {
  for (const [lo, hi] of [[-7.5, -6.7], [-0.08, -0.015], [-0.2, 0.31]]) assertCovered(lo, hi);
});

test('constant values keep a finite ordered scale with room on both sides', () => {
  for (const value of [0, 7.5, -3]) {
    const ticks = assertCovered(value, value);
    assert.ok(ticks[0] < value);
    assert.ok(ticks[ticks.length - 1] > value);
  }
});
