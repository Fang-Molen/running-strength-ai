import test from 'node:test'
import assert from 'node:assert/strict'
import { handleCorosMcp, McpSession, seal, type Auth, type Deps } from './coros-mcp-server'

const NOW = Date.parse('2026-10-22T12:00:00Z'), KEY = 'synthetic-coros-performance'
const md = { issuer: 'https://mcpcn.coros.com', resource: 'https://mcpcn.coros.com/mcp', authorize: 'https://mcpcn.coros.com/oauth2/authorize', token: 'https://mcpcn.coros.com/oauth2/token', register: 'https://mcpcn.coros.com/connect/register', revoke: null }
const auth = (): Auth => ({ v: 1, md, cid: 'synthetic-client', region: 'cn', access: 'synthetic-A1', refresh: 'synthetic-R1', expiresAt: NOW + 3600000, ref: '0123456789abcdef', at: NOW })
const healthNames = ['querySleepOverview', 'querySleepHrv', 'queryRestingHeartRate', 'queryDailyHealthData', 'queryStressTimeSeries', 'queryRecoveryStatus']
const text: Record<string, string> = {
  querySleepOverview: 'Sleep Overview\n2026-10-20\nSleep Score: 91\nDaily Sleep: 7h 57min\nMain Sleep Window: 2026-10-20 00:28 - 2026-10-20 08:30',
  querySleepHrv: 'Sleep HRV\n2026-10-20\nAverage HRV: 48.125 ms',
  queryRestingHeartRate: 'Resting Heart Rate\n2026-10-20: 52 bpm',
  queryDailyHealthData: JSON.stringify([{ date: '2026-10-20', steps: 0, activeKcal: 321.25, avgStress: 0 }]),
  queryStressTimeSeries: '2026-10-20\n09:00 35\n09:15 42',
  queryRecoveryStatus: 'Recovery: 83% | Level: Good',
}
type Options = { statuses?: Record<string, number>; delays?: Record<string, number>; expireTools?: boolean; late401?: boolean; rejectRefresh?: boolean }

/** Real request handler and session, with an in-memory upstream; no real accounts or network. */
function service(opts: Options = {}) {
  let active = 0, peak = 0, refreshes = 0, accessNumber = 1, notifyRefresh = () => {}
  const refreshed = new Promise<void>(resolve => { notifyRefresh = resolve })
  const calls: { method: string; name?: string; args?: unknown; id?: number }[] = [], usedRefresh = new Set<string>()
  const fetch = (async (url: string, init: RequestInit = {}) => {
    active++; peak = Math.max(peak, active)
    const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } })
    try {
      if (url === md.token) {
        calls.push({ method: 'refresh' }); refreshes++
        await new Promise(resolve => setTimeout(resolve, 2))
        const token = new URLSearchParams(String(init.body)).get('refresh_token')!
        if (opts.rejectRefresh || usedRefresh.has(token)) return json({ error: 'invalid_grant' }, 400)
        usedRefresh.add(token); accessNumber++
        notifyRefresh()
        return json({ access_token: `synthetic-A${accessNumber}`, refresh_token: `synthetic-R${accessNumber}`, expires_in: 3600 })
      }
      assert.equal(url, md.resource)
      const rpc = JSON.parse(String(init.body)), headers = new Headers(init.headers)
      calls.push({ method: rpc.method, name: rpc.params?.name, args: rpc.params?.arguments, id: rpc.id })
      await Promise.resolve()
      if (rpc.method === 'initialize') return json({ jsonrpc: '2.0', id: rpc.id, result: { protocolVersion: '2025-06-18' } }, 200, { 'mcp-session-id': 'synthetic-session' })
      assert.equal(headers.get('mcp-session-id'), 'synthetic-session')
      if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 })
      if (opts.expireTools && headers.get('authorization') === 'Bearer synthetic-A1') {
        if (opts.late401 && rpc.params.name === 'querySleepHrv') { await refreshed; await new Promise(resolve => setTimeout(resolve, 5)) }
        return new Response(null, { status: 401 })
      }
      if (opts.delays?.[rpc.params.name]) await new Promise(resolve => setTimeout(resolve, opts.delays![rpc.params.name]))
      const status = opts.statuses?.[rpc.params.name] ?? 200
      if (status !== 200) return new Response(null, { status })
      return json({ jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text: text[rpc.params.name] ?? 'Sport Records (0 records)' }] } })
    } finally { active-- }
  }) as unknown as typeof globalThis.fetch
  return { deps: { fetch, stateKey: KEY, now: () => NOW } as Deps, calls, peak: () => peak, active: () => active, refreshes: () => refreshes }
}
async function health(s: ReturnType<typeof service>) {
  const token = await seal(KEY, auth())
  const response = await handleCorosMcp(new Request('https://synthetic.example/api/coros-mcp/health', { headers: { cookie: 'fk_cmcp_t0=' + token } }), 'health', s.deps)
  return { response, body: await response.json() }
}
const tools = (s: ReturnType<typeof service>) => s.calls.filter(c => c.method === 'tools/call')

test('health keeps all six tool inputs and original parsed output with at most two concurrent reads', async () => {
  const s = service({ delays: { querySleepOverview: 3 } }), { response, body } = await health(s)
  assert.equal(response.status, 200); assert.equal(s.calls.length, 8); assert.equal(s.peak(), 2); assert.equal(s.active(), 0)
  assert.deepEqual(s.calls.slice(0, 2).map(c => c.method), ['initialize', 'notifications/initialized'])
  assert.deepEqual(tools(s).map(c => c.name).sort(), [...healthNames].sort())
  const ids = s.calls.filter(c => c.id != null).map(c => c.id); assert.equal(new Set(ids).size, ids.length)
  assert.deepEqual(tools(s).find(c => c.name === 'querySleepOverview')!.args, { days: 7 })
  assert.deepEqual(tools(s).find(c => c.name === 'querySleepHrv')!.args, { startDate: '', endDate: '', days: 7 })
  assert.deepEqual(tools(s).find(c => c.name === 'queryStressTimeSeries')!.args, { startDate: '', endDate: '', days: 2 })
  assert.deepEqual(body, {
    ok: true, accountRef: '0123456789abcdef', fetchedAt: new Date(NOW).toISOString(),
    days: [{ date: '2026-10-20', sleepScore: 91, sleepMinutes: 477, sleepStart: '2026-10-20T00:28', sleepEnd: '2026-10-20T08:30', hrvMs: 48.125, restingHr: 52, steps: 0, activeKcal: 321.25, avgStress: 0 }],
    stress: [{ iso: null, local: '2026-10-20T09:00:00', value: 35 }, { iso: null, local: '2026-10-20T09:15:00', value: 42 }],
    recovery: { percent: 83, level: 'Good', fullRecoveryText: null }, issues: [], raw: text,
  })
})

test('simultaneous 401s share a single refresh and preserve the rotated session', async () => {
  const s = service({ expireTools: true }), session = new McpSession(s.deps, auth())
  await session.init()
  const results = await Promise.allSettled([session.tool('querySleepOverview', { days: 7 }), session.tool('querySleepHrv', { days: 7 })])
  assert.deepEqual(results.map(r => r.status), ['fulfilled', 'fulfilled']); assert.equal(s.refreshes(), 1)
  assert.equal(session.refreshed, true); assert.equal(s.active(), 0)
})

test('late 401 for a superseded access token retries without another forced refresh', async () => {
  const s = service({ expireTools: true, late401: true }), session = new McpSession(s.deps, auth())
  await session.init()
  const results = await Promise.allSettled([session.tool('querySleepOverview', { days: 7 }), session.tool('querySleepHrv', { days: 7 })])
  assert.deepEqual(results.map(r => r.status), ['fulfilled', 'fulfilled']); assert.equal(s.refreshes(), 1)
  assert.equal(session.refreshed, true)
})

test('rate limiting stops queued tools and explicitly reports deferred fields while keeping completed values', async () => {
  const s = service({ statuses: { querySleepOverview: 429 }, delays: { querySleepHrv: 5 } }), { response, body } = await health(s)
  assert.equal(response.status, 200); assert.equal(body.ok, true); assert.equal(s.active(), 0)
  assert.deepEqual(tools(s).map(c => c.name), ['querySleepOverview', 'querySleepHrv'])
  assert.equal(body.days[0].hrvMs, 48.125); assert.equal(body.days[0].sleepMinutes, undefined)
  assert.deepEqual(body.stress, []); assert.equal(body.recovery, null)
  assert.equal(body.issues.length, 5); assert.match(body.issues[0], /querySleepOverview.*太频繁/)
  for (const name of healthNames.slice(2)) assert.ok(body.issues.some((issue: string) => issue.startsWith(name + '：') && /未读取.*重试/.test(issue)), name)
  assert.deepEqual(Object.keys(body.raw), ['querySleepHrv'])
  assert.ok(!response.headers.getSetCookie().some(c => /Max-Age=0/.test(c)), '429 does not clear account credentials')
})

test('auth failure stops the queue, settles active work, clears cookies and returns no success data', async () => {
  const s = service({ statuses: { querySleepOverview: 403 }, delays: { querySleepHrv: 5 } }), { response, body } = await health(s)
  assert.equal(response.status, 401); assert.equal(body.ok, false); assert.equal(body.error, 'REAUTHORIZE')
  assert.equal(s.active(), 0); assert.ok(tools(s).length <= 2); assert.equal(body.days, undefined); assert.equal(body.accountRef, undefined)
  assert.equal(response.headers.getSetCookie().filter(c => /^fk_cmcp_t/.test(c) && /Max-Age=0/.test(c)).length, 4)
})

test('ordinary tool failure still fetches other tools and preserves issue order', async () => {
  const s = service({ statuses: { querySleepOverview: 500, querySleepHrv: 500 }, delays: { querySleepOverview: 5 } }), { response, body } = await health(s)
  assert.equal(response.status, 200); assert.equal(tools(s).length, 6); assert.equal(s.active(), 0)
  assert.match(body.issues[0], /^querySleepOverview：/); assert.match(body.issues[1], /^querySleepHrv：/)
  assert.equal(body.days[0].restingHr, 52); assert.equal(body.days[0].steps, 0); assert.equal(body.days[0].activeKcal, 321.25)
  assert.equal(body.recovery.percent, 83)
})

test('an in-flight auth failure takes precedence over an earlier rate limit', async () => {
  const s = service({ statuses: { querySleepOverview: 429, querySleepHrv: 403 }, delays: { querySleepHrv: 5 } }), { response, body } = await health(s)
  assert.equal(response.status, 401); assert.equal(body.error, 'REAUTHORIZE'); assert.equal(body.ok, false)
  assert.equal(body.days, undefined); assert.equal(s.active(), 0); assert.equal(tools(s).length, 2)
  assert.equal(response.headers.getSetCookie().filter(c => /^fk_cmcp_t/.test(c) && /Max-Age=0/.test(c)).length, 4)
})

test('refresh rejection remains reauthorization and never produces partial success', async () => {
  const s = service({ expireTools: true, rejectRefresh: true }), { response, body } = await health(s)
  assert.equal(response.status, 401); assert.equal(body.error, 'REAUTHORIZE'); assert.equal(body.ok, false)
  assert.equal(body.days, undefined); assert.equal(s.active(), 0); assert.equal(s.refreshes(), 1)
  assert.equal(response.headers.getSetCookie().filter(c => /^fk_cmcp_t/.test(c) && /Max-Age=0/.test(c)).length, 4)
})
