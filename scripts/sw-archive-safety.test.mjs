import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const handlers = new Map();
const sandbox = { URL, Response, self: { location: { origin: 'https://example.test' }, addEventListener: (name, fn) => handlers.set(name, fn) } };
vm.runInNewContext(source, sandbox);

test('archives and exported user data bypass service worker', () => {
  for (const path of ['/baseline.zip', '/assets/backup.ZIP', '/records.csv', '/records.json', '/report.pdf']) {
    let intercepted = false;
    handlers.get('fetch')({ request: { url: `https://example.test${path}`, method: 'GET', destination: 'document', mode: 'navigate', headers: { get: () => null } }, respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false, path);
  }
});

test('normal navigation cache behavior is retained', () => {
  assert.match(source, /request\.mode === "navigate"/);
  assert.match(source, /event\.respondWith\(networkFirst\(event\.request\)\)/);
});
