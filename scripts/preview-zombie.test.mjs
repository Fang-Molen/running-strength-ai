import test from 'node:test';
import assert from 'node:assert/strict';
import { isZombieStat } from './preview.mjs';

test('preview restart does not count a terminated zombie as a port owner', () => {
  assert.equal(isZombieStat('123 (npm run preview) Z 1 123 0'), true);
  assert.equal(isZombieStat('123 (worker) X 1 123 0'), true);
  assert.equal(isZombieStat('123 (npm run preview) S 1 123 0'), false);
  assert.equal(isZombieStat('123 (name with ) brackets) R 1 123 0'), false);
});
