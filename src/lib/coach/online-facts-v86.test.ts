// v86（R1.1）：联网请求只带用户自己的数据；内置课表/目标不再当事实；关闭联网后 askOnlineCoach 自己拒绝发请求。
process.env.TZ = 'Asia/Shanghai'
import assert from 'node:assert/strict'
import test, { beforeEach } from 'node:test'
import { setStoreBackend } from '../core/storage.ts'
import { buildFacts, askOnlineCoach, setOnline } from './online-coach.ts'
// This suite explicitly covers an unconfigured user before its own imported-plan fixture.
Reflect.deleteProperty(globalThis, '__FK_TEST_PLAN_DOC__')
import { intervalRestAnswer } from './plain-coach.ts'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore js function
import { onRequestPost } from '../../../functions/api/coach-chat.js'
let data: Map<string, string>
beforeEach(() => { data = new Map(); setStoreBackend({ getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, removeItem: (k: string) => { data.delete(k) }, keys: () => [...data.keys()] } as never) })
const HARDCODED = /53秒|12\/28|12月28|200×3|400米53/
test('no user plan / goal → facts say goal unknown and carry no bundled plan', () => {
  const f = buildFacts('2026-10-20', null, null)
  assert.match(f, /目标：未知/); assert.doesNotMatch(f, HARDCODED); assert.doesNotMatch(f, /今天计划|下一节计划|用户在用的计划/)
})
test('goal comes from the user: profile target or explicitly stated chat goal', () => {
  data.set('fr255-profile-v1', JSON.stringify({ marks: [{ meters: 800, goal: '2:15', recent: '2:21', deadline: '2026-12-01' }, { meters: 400, goal: '', recent: '', deadline: '' }] }))
  const f = buildFacts('2026-10-20', null, null)
  assert.match(f, /目标：800米 2:15/); assert.match(f, /800米 最近成绩 2:21/); assert.doesNotMatch(f, /目标：未知/); assert.doesNotMatch(f, HARDCODED)
  data.clear(); assert.match(buildFacts('2026-10-20', null, null, { goalTarget: { meters: 1500, toSeconds: 300 } }), /目标：1500米 5分00秒（用户在聊天中明确说过）/)
})
test('plan lines require an actual imported plan, not just an old log, and are labelled as plan', () => {
  data.set('fk-plan400-v4-log', JSON.stringify({ '2026-10-19': { done: 'done', rpe: '7' } }))
  assert.doesNotMatch(buildFacts('2026-10-20', null, null), /用户在用的计划·下一节/)
  data.set('fk-plan-doc-v1', JSON.stringify({schema:'fangkun-plan-v1',plan:{name:'合成测试计划',shiftDays:0,weeks:[],days:[{date:'2026-10-22',orig:'2026-10-22',weekday:'四',week:'1',title:'轻松跑',main:['轻松跑20分钟'],aux:[],strength:[]}]}}))
  const f = buildFacts('2026-10-20', null, null)
  assert.match(f, /轻松跑20分钟/); assert.match(f, /用户在用的计划·下一节（计划，不是实际）/); assert.match(f, /目标：未知/)
})
test('G04: askOnlineCoach honours setOnline(false) itself — no fetch', async () => {
  const orig = globalThis.fetch; let calls = 0
  globalThis.fetch = (async () => { calls++; return new Response(JSON.stringify({ text: 'ok', ok: true, planChanged: false })) }) as never
  try {
    setOnline(false); const r = await askOnlineCoach({ question: '复盘', facts: '', local: '', history: [] })
    assert.ok('error' in r); assert.equal(calls, 0)
    setOnline(true); assert.ok('error' in await askOnlineCoach({ question: '复盘', facts: '', local: '', history: [] })); assert.equal(calls, 0)
    assert.deepEqual(await askOnlineCoach({ question: '复盘', facts: '', local: '', history: [], snapshotRef: {snapshotId: 'synthetic', consentId: 'synthetic', asOf: '2026-10-20T00:00:00.000Z'} }), { text: 'ok' }); assert.equal(calls, 1)
  } finally { globalThis.fetch = orig }
})
test('server does not treat a client fact snapshot or API key as authority', async () => {
  const orig = globalThis.fetch; let calls = 0
  globalThis.fetch = (async () => { calls++; throw Error('must not dispatch') }) as never
  try {
    const req = new Request('https://x/api/coach-chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'q', facts: 'f', local: 'l' }) })
    assert.equal((await onRequestPost({ request: req, env: { FANGKUN_DEEPSEEK_ENABLED: 'true', DEEPSEEK_API_KEY: 'SYNTHETIC' } })).status, 503)
    assert.equal(calls, 0)
  } finally { globalThis.fetch = orig }
})
test('local interval-rest explainer no longer assumes the 400m/53s goal', () => {
  const a = intervalRestAnswer('间歇休息1分钟和8分钟有什么区别？') ?? ''
  assert.ok(a.length > 0); assert.doesNotMatch(a, HARDCODED); assert.doesNotMatch(a, /11 月中/)
})
