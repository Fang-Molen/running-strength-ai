import test from 'node:test'
import assert from 'node:assert/strict'
// @ts-ignore JS Pages Function
import { onRequestPost } from '../../../functions/api/food-estimate.js'
const req = (body: unknown, origin = 'https://molen-fangkun.pages.dev', ip = String(Math.random())) => new Request('https://molen-fangkun.pages.dev/api/food-estimate', { method: 'POST', headers: { 'content-type': 'application/json', origin, 'cf-connecting-ip': ip }, body: JSON.stringify(body) })
const reply = (o: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }] }))
test('未配置 503；跨站 403；没名字 400；都不调用上游', async () => {
  let calls = 0; const f = globalThis.fetch; globalThis.fetch = (async () => { calls++; return reply({}) }) as never
  try {
    assert.equal((await onRequestPost({ request: req({ name: '灌汤包' }), env: {} })).status, 503)
    assert.equal((await onRequestPost({ request: req({ name: '灌汤包' }, 'https://evil.example'), env: { DEEPSEEK_API_KEY: 'k' } })).status, 403)
    assert.equal((await onRequestPost({ request: req({ name: '' }), env: { DEEPSEEK_API_KEY: 'k' } })).status, 400)
    assert.equal(calls, 0)
  } finally { globalThis.fetch = f }
})
test('只发名称+份量文字给 DeepSeek；未知营养保留 null；密钥不回传', async () => {
  const f = globalThis.fetch; let sent = ''
  globalThis.fetch = (async (_u: unknown, init: RequestInit) => { sent = String(init.body); return reply({ name: '灌汤小笼包', unit: '笼', grams: 240, kcal: 520, protein: 20, carb: 55, fat: 24, fiber: null, note: '一笼8个' }) }) as never
  try {
    const r = await onRequestPost({ request: req({ name: '妈妈做的灌汤小笼包', amount: '1笼' }), env: { DEEPSEEK_API_KEY: 'secret-k' } }), b = await r.json()
    assert.equal(r.status, 200); assert.equal(b.result.kcal, 520); assert.equal(b.result.fiber, null); assert.ok(!JSON.stringify(b).includes('secret-k'))
    assert.match(sent, /妈妈做的灌汤小笼包/); assert.ok(!/image|base64/.test(sent))
    globalThis.fetch = (async () => reply({ name: 'x', kcal: null })) as never
    assert.equal((await onRequestPost({ request: req({ name: 'x' }), env: { DEEPSEEK_API_KEY: 'k' } })).status, 502)
  } finally { globalThis.fetch = f }
})
