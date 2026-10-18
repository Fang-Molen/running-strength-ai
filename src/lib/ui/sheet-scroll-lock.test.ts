import test from 'node:test';
import assert from 'node:assert/strict';
import { lockSheetScroll } from './sheet-scroll-lock';
test('closing nested sheets in either order restores background scrolling exactly once', () => {
  for (const reverse of [false, true]) {
    const body = { style: { overflow: 'auto' } }, outer = lockSheetScroll(body), inner = lockSheetScroll(body);
    const first = reverse ? inner : outer, last = reverse ? outer : inner;
    assert.equal(first(), false); assert.equal(body.style.overflow, 'hidden');
    assert.equal(first(), false); assert.equal(last(), true); assert.equal(body.style.overflow, 'auto'); assert.equal(last(), false);
  }
});
