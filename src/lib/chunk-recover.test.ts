import test from 'node:test';
import assert from 'node:assert/strict';

test('vite:preloadError reloads only for stale-chunk errors, not for other import failures (3D/WebGL fallback)', async () => {
  const handlers: Record<string, (e: any) => void> = {};
  let reloads = 0; const store = new Map<string, string>();
  (globalThis as any).window = { addEventListener: (n: string, f: (e: any) => void) => { handlers[n] = f; } };
  (globalThis as any).sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) };
  (globalThis as any).location = { reload: () => { reloads++; } };
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
  const { installChunkRecovery } = await import('./chunk-recover.ts');
  installChunkRecovery();
  let prevented = 0; const ev = (payload: unknown) => ({ payload, preventDefault: () => { prevented++; } });
  handlers['vite:preloadError'](ev(new Error('injected load failure')));
  handlers['vite:preloadError'](ev(new Error('THREE.WebGLRenderer: Error creating WebGL context.')));
  await new Promise(r => setTimeout(r, 10));
  assert.equal(prevented, 0); assert.equal(reloads, 0);
  handlers['vite:preloadError'](ev(new TypeError('Failed to fetch dynamically imported module: /assets/x.js')));
  await new Promise(r => setTimeout(r, 10));
  assert.equal(prevented, 1); assert.equal(reloads, 1);
});
