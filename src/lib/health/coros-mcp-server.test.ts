import test from 'node:test'
import assert from 'node:assert/strict'
import { handleCorosMcp, allowedUrl, pkceChallenge, type Deps } from './coros-mcp-server.ts'
import { parseSportRecords, parseDailyTool, parseLaps, parseStressSeries, parseRecovery, type McpDay } from './coros-mcp-parse.ts'

const KEY = 'test-state-key'
const txt = (t: string) => ({ content: [{ type: 'text', text: t }] })
type Call = { url: string; init: RequestInit }
function mockCoros(opts: { evilToken?: boolean; expired?: boolean; mcp401Once?: boolean } = {}) {
  const calls: Call[] = []; let mcp401 = !!opts.mcp401Once, access = 'AT-1'
  const f = (async (u: string, init: RequestInit = {}) => {
    calls.push({ url: u, init }); const j = (o: unknown, s = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json', ...h } })
    if (u.endsWith('/.well-known/oauth-protected-resource/mcp')) return j({ resource: 'https://mcpcn.coros.com/mcp', authorization_servers: ['https://mcpcn.coros.com'] })
    if (u.endsWith('/.well-known/oauth-authorization-server')) return j({ issuer: 'https://mcpcn.coros.com', authorization_endpoint: 'https://mcpcn.coros.com/oauth2/authorize', token_endpoint: opts.evilToken ? 'https://evil.example/token' : 'https://mcpcn.coros.com/oauth2/token', registration_endpoint: 'https://mcpcn.coros.com/connect/register', revocation_endpoint: 'https://mcpcn.coros.com/oauth2/revoke' })
    if (u.endsWith('/connect/register')) { const b = JSON.parse(String(init.body)); assert.equal(b.token_endpoint_auth_method, 'none'); return j({ client_id: 'cid-1' }, 201) }
    if (u.endsWith('/oauth2/token')) { const b = new URLSearchParams(String(init.body)); assert.equal(b.get('resource'), 'https://mcpcn.coros.com/mcp')
      if (b.get('grant_type') === 'authorization_code') { assert.equal(b.get('code_verifier')?.length, 64); return j({ access_token: 'AT-1', refresh_token: 'RT-1', expires_in: opts.expired ? 1 : 3600, id_token: 'x.' + btoa(JSON.stringify({ sub: 'user-42' })).replace(/=+$/, '') + '.y' }) }
      if (b.get('grant_type') === 'refresh_token') { assert.equal(b.get('refresh_token'), 'RT-1'); access = 'AT-2'; return j({ access_token: 'AT-2', expires_in: 3600 }) } }
    if (u.endsWith('/oauth2/revoke')) return new Response('', { status: 200 })
    if (u === 'https://mcpcn.coros.com/mcp') {
      const h = new Headers(init.headers as Record<string, string>)
      if (mcp401) { mcp401 = false; return new Response('', { status: 401 }) }
      assert.equal(h.get('authorization'), 'Bearer ' + access); assert.equal(h.get('mcp-protocol-version'), '2025-06-18')
      const m = JSON.parse(String(init.body)); if (!('id' in m)) return new Response('', { status: 202 })
      if (m.method === 'initialize') return j({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18' } }, 200, { 'mcp-session-id': 'S1' })
      assert.equal(h.get('mcp-session-id'), 'S1')
      const name = m.params.name, sse = (o: unknown) => new Response('event: message\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: m.id, result: o }) + '\n\n', { headers: { 'content-type': 'text/event-stream' } })
      if (name === 'querySportRecords') { assert.deepEqual(m.params.arguments.sportTypeCodes, [65535]); return sse(txt('Sport Records — 2026-10-14 to 2026-10-20 (1 records)\n\n1. Run(100) — 2026-10-20 07:05\n   Label ID: 4711abc | Sport Type: 100\n   Duration: 0:30:10 | Distance: 5.02 km\n   Average Heart Rate: 150 bpm')) }
      if (name === 'querySleepOverview') return sse(txt('Sleep Overview\n\n2026-10-20\nSleep Score: 91\nDaily Sleep: 7h 57min (incl. naps)\nMain Sleep Window: 2026-10-20 00:28 - 2026-10-20 08:30'))
      if (name === 'querySleepHrv') return sse(txt('Sleep HRV\n2026-10-20\nAverage HRV: 48 ms\nNormal range: 40-60 ms'))
      if (name === 'queryRestingHeartRate') return sse(txt('Resting Heart Rate\n2026-10-20: 52 bpm'))
      if (name === 'queryDailyHealthData') return sse(txt('something unexpected'))
      if (name === 'queryStressTimeSeries') return sse(txt('2026-10-20\n09:00 35\n09:15 42'))
      if (name === 'queryRecoveryStatus') return sse(txt('Recovery: 83% | Level: Good'))
    }
    return new Response('nope', { status: 404 })
  }) as unknown as typeof fetch
  return { calls, deps: { fetch: f, stateKey: KEY } as Deps }
}
const req = (path: string, cookies: string[] = [], method = 'GET') => new Request('https://fk.example/api/coros-mcp/' + path, { method, headers: { cookie: cookies.map(c => c.split(';')[0]).join('; ') } })
const setCookies = (r: Response) => r.headers.getSetCookie()
async function login(m: ReturnType<typeof mockCoros>) {
  const s = await handleCorosMcp(req('start?region=cn'), 'start', m.deps)
  assert.equal(s.status, 302); const loc = new URL(s.headers.get('location')!)
  assert.equal(loc.origin + loc.pathname, 'https://mcpcn.coros.com/oauth2/authorize'); assert.equal(loc.searchParams.get('code_challenge_method'), 'S256'); assert.equal(loc.searchParams.get('resource'), 'https://mcpcn.coros.com/mcp'); assert.equal(loc.searchParams.get('scope'), 'openid mcp.tools offline_access'); assert.equal(loc.searchParams.get('redirect_uri'), 'https://fk.example/api/coros-mcp/callback')
  const sc = setCookies(s); assert.ok(sc.every(c => /HttpOnly; Secure; SameSite=Lax/.test(c)))
  const cb = await handleCorosMcp(req('callback?code=C1&state=' + loc.searchParams.get('state'), sc), 'callback', m.deps)
  assert.equal(cb.headers.get('location'), '/?coros_auth=ok')
  return setCookies(cb).filter(c => /^fk_cmcp_t\d=[^;]+;/.test(c) && !/Max-Age=0/.test(c))
}
test('OAuth start → callback: DCR, PKCE S256, sealed HttpOnly token cookie (no plaintext token)', async () => {
  const m = mockCoros(), tok = await login(m)
  assert.ok(tok.length >= 1); assert.ok(tok.every(c => !c.includes('AT-1') && !c.includes('RT-1') && !c.includes('user-42')))
  const st = await (await handleCorosMcp(req('status', tok), 'status', m.deps)).json(); assert.equal(st.connected, true); assert.equal(st.refBasis, 'account'); assert.ok(!JSON.stringify(st).includes('AT-1'))
})
test('wrong state is rejected; no token exchange', async () => {
  const m = mockCoros(), s = await handleCorosMcp(req('start?region=cn'), 'start', m.deps)
  const cb = await handleCorosMcp(req('callback?code=C1&state=forged', setCookies(s)), 'callback', m.deps)
  assert.equal(cb.headers.get('location'), '/?coros_auth=state'); assert.ok(!m.calls.some(c => c.url.endsWith('/oauth2/token')))
})
test('metadata pointing outside *.coros.com is refused', async () => {
  const m = mockCoros({ evilToken: true }), s = await handleCorosMcp(req('start?region=cn'), 'start', m.deps)
  assert.equal(s.headers.get('location'), '/?coros_auth=host_not_allowed'); assert.equal(allowedUrl('https://mcp.coros.com.evil.io/x'), null); assert.equal(allowedUrl('http://mcp.coros.com'), null)
})
test('activities: expired token auto-refreshes, cookie re-sealed, text parsed', async () => {
  const m = mockCoros({ expired: true }), tok = await login(m)
  const r = await handleCorosMcp(req('activities?startDate=20261014', tok), 'activities', m.deps), b = await r.json()
  assert.equal(b.ok, true); assert.equal(b.activities[0].labelId, '4711abc'); assert.equal(b.activities[0].sportType, 100); assert.equal(b.activities[0].distanceM, 5020); assert.equal(b.activities[0].durationSec, 1810); assert.equal(b.activities[0].startLocal, '2026-10-20T07:05:00'); assert.equal(b.activities[0].startIso, null)
  assert.ok(setCookies(r).some(c => /^fk_cmcp_t0=[^;]+;/.test(c))); assert.ok(m.calls.some(c => String(c.init.body).includes('refresh_token')))
})
test('MCP 401 once → refresh and retry', async () => {
  const m = mockCoros({ mcp401Once: true }), tok = await login(m)
  const b = await (await handleCorosMcp(req('activities', tok), 'activities', m.deps)).json(); assert.equal(b.ok, true)
})
test('health: parsed where recognised, unknown → null + 待核, recovery is current only', async () => {
  const m = mockCoros(), tok = await login(m), b = await (await handleCorosMcp(req('health', tok), 'health', m.deps)).json()
  const d = b.days.find((x: McpDay) => x.date === '2026-10-20')
  assert.equal(d.sleepScore, 91); assert.equal(d.sleepMinutes, 477); assert.equal(d.hrvMs, 48); assert.equal(d.restingHr, 52); assert.equal(d.steps, undefined); assert.equal(d.sleepStart, '2026-10-20T00:28')
  assert.ok(b.issues.some((x: string) => x.includes('queryDailyHealthData') && x.includes('待核'))); assert.equal(b.stress.length, 2); assert.equal(b.recovery.percent, 83)
})
test('not connected → 401 reauthorize; disconnect clears all token cookies', async () => {
  const m = mockCoros(); const r = await handleCorosMcp(req('health'), 'health', m.deps); assert.equal(r.status, 401); assert.equal((await r.json()).reauthorize, true)
  const tok = await login(m), d = await handleCorosMcp(req('disconnect', tok, 'POST'), 'disconnect', m.deps)
  assert.ok(setCookies(d).filter(c => c.startsWith('fk_cmcp_t')).every(c => /Max-Age=0/.test(c)))
})
test('no STATE_KEY → refuses instead of using a fallback key', async () => {
  const m = mockCoros(); const r = await handleCorosMcp(req('status', ['fk_cmcp_t0=abc.def']), 'status', { ...m.deps, stateKey: undefined }); assert.equal(r.status, 500)
})
test('parsers on doc examples', async () => {
  const doc = parseSportRecords(txt('Sport Records — 2026-09-19 to 2026-10-18 (1 records)\n\n1. Sport(9807) — 2026-10-03\n   Duration: 2:12:38 | Distance: 12.03 km\n   Average Pace: 11:01 /km'))
  assert.equal(doc.value[0].labelId, null); assert.equal(doc.value[0].distanceM, 12030); assert.equal(doc.value[0].durationSec, 7958); assert.ok(doc.value[0].issues.some(x => x.includes('待核')))
  assert.equal(parseSportRecords(txt('Sport Records (0 records)')).value.length, 0)
  const laps = parseLaps(txt(JSON.stringify({ lapGroups: [{ laps: [{ lapIndex: 1, distance: 100000, time: 360.41, avgPace: 360.41, avgHr: 143, maxHr: 152, avgCadence: 155 }] }] })))
  assert.equal(laps.value[0].avgHr, 143); assert.equal(laps.value[0].distanceRaw, 100000)
  const days = new Map<string, McpDay>(); assert.ok(parseDailyTool('querySleepHrv', txt('???'), days)[0].includes('待核')); assert.equal(days.size, 0)
  assert.equal(parseStressSeries(txt('nothing')).value.length, 0); assert.equal(parseRecovery(txt('n/a')).value.percent, null)
  assert.equal((await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
})
