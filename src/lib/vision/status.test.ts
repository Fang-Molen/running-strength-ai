import test from 'node:test'
import assert from 'node:assert/strict'
import { visionInfo } from './client'

for (const [name, response, expected] of [
  ['explicit server configuration missing', () => Response.json({ configured: false, needs: ['DEEPSEEK_API_KEY'] }), 'UNCONFIGURED'],
  ['configuration present is not a successful paid inference', () => Response.json({ configured: true, provider: 'DeepSeek', model: 'fixture' }), 'READY'],
  ['SPA fallback is protocol failure', () => new Response('<html>app</html>', { headers: { 'content-type': 'text/html' } }), 'PROTOCOL'],
  ['blocked request is not a missing key', () => new Response('Forbidden', { status: 403 }), 'HTTP'],
  ['unrecognized JSON cannot prove a missing key', () => Response.json({ ok: true }), 'PROTOCOL'],
  ['network error cannot prove a missing key', () => { throw new TypeError('Failed to fetch') }, 'NETWORK'],
] as const) test(name, async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (url: RequestInfo | URL, init?: RequestInit) => { calls++; assert.equal(url, '/api/vision'); assert.equal(init?.method ?? 'GET', 'GET'); assert.equal(init?.body, undefined); return response() })
  const info = await visionInfo()
  assert.equal(info.state, expected)
  assert.equal(calls, 1)
})
test('offline status is local and never attempts a request', async t => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } })
  t.after(() => { if (old) Object.defineProperty(globalThis, 'navigator', old); else Reflect.deleteProperty(globalThis, 'navigator') })
  let calls = 0;t.mock.method(globalThis, 'fetch', async () => { calls++; throw Error('must not request') })
  assert.equal((await visionInfo()).state, 'OFFLINE');assert.equal(calls, 0)
})
