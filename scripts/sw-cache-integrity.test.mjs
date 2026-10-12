import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
test('downloads are excluded from service worker interception', () => {
  assert.match(source, /zip\|tar\|gz\|7z\|pdf\|csv/);
});
test('HTML responses cannot be cached as JavaScript assets', () => {
  assert.match(source, /validScript = !isScript \|\| \/\(\?:javascript\|ecmascript\)\//);
  assert.match(source, /if \(validScript &&/);
});
test('no-store resources are not cached', () => {
  assert.match(source, /cache-control/);
  assert.match(source, /no-store/);
});
test('offline missing resources return 503 rather than fake success', () => {
  assert.match(source, /status: 503/);
});
