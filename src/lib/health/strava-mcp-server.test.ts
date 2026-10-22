import test from 'node:test'
import assert from 'node:assert/strict'
import { handleStravaMcp, type StravaMcpDeps } from './strava-mcp-server.ts'

const BASE = 'https://fangkun.example/api/strava-mcp/'
const KEY = 'synthetic-state-encryption-key-0123456789'
const ACCESS_KEY = 'synthetic-private-access-key-0123456789'
const RESOURCE = 'https://mcp.strava.com/mcp'
const PRM = 'https://mcp.strava.com/.well-known/oauth-protected-resource'
const ASM = 'https://www.strava.com/.well-known/oauth-authorization-server/mcp-issuer'
const OAUTH = 'https://www.strava.com/oauth/mcp/'
const NOW = 1_792_627_200_000
type AuthMethod = 'client_secret_basic' | 'client_secret_post' | 'none'
type Options = { method?: string; noSecret?: boolean; evilToken?: boolean; badPkce?: boolean; badIssuer?: boolean; redirect?: boolean; expired?: boolean; refreshError?: boolean; rpc401?: boolean; revokeFail?: boolean; badRpcId?: boolean; accessType?: string; dcrAbsentMethod?: boolean; secretExpiresIn?: number; invalidClient?: boolean }
function mockStrava(options: Options = {}) {
  const calls: { url: string; init: RequestInit }[] = []
  let now = NOW, token = 'synthetic-access-1', rpc401 = !!options.rpc401
  const fetcher = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
    if (url === PRM) return json({ resource: RESOURCE, authorization_servers: ['https://www.strava.com/mcp-issuer'], scopes_supported: ['read', 'activity:read'] })
    if (url === ASM) return options.redirect ? new Response(null, { status: 302, headers: { location: 'https://evil.example/metadata' } }) : json({ issuer: options.badIssuer ? 'https://evil.example' : 'https://www.strava.com', authorization_endpoint: OAUTH + 'authorize', token_endpoint: options.evilToken ? 'https://evil.example/token' : OAUTH + 'token', registration_endpoint: OAUTH + 'register_client', revocation_endpoint: OAUTH + 'revoke', response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'], scopes_supported: ['read', 'activity:read'], ...(options.badPkce ? { code_challenge_methods_supported: ['plain'] } : {}) })
    if (url === OAUTH + 'register_client') return json({ client_id: 'synthetic-client', ...(options.dcrAbsentMethod ? {} : { token_endpoint_auth_method: options.method ?? 'client_secret_basic' }), ...(options.noSecret || options.method === 'none' ? {} : { client_secret: 'synthetic-client-secret' }), ...(options.secretExpiresIn == null ? {} : { client_secret_expires_at: Math.floor(now / 1000) + options.secretExpiresIn }) }, 201)
    if (url === OAUTH + 'token') {
      if (options.invalidClient) return json({ error: 'invalid_client' }, 401)
      const form = new URLSearchParams(String(init.body))
      if (form.get('grant_type') === 'refresh_token') {
        if (options.refreshError) return json({ error: 'invalid_grant' }, 400)
        token = 'synthetic-access-2'
        return json({ access_token: token, token_type: 'Bearer', expires_in: 3600 })
      }
      return json({ access_token: token, refresh_token: 'synthetic-refresh-1', token_type: options.accessType ?? 'Bearer', expires_in: options.expired ? 1 : 3600 })
    }
    if (url === OAUTH + 'revoke') return json({}, options.revokeFail ? 503 : 200)
    if (url === RESOURCE) {
      if (rpc401) { rpc401 = false; return json({ error: 'expired' }, 401) }
      assert.equal(new Headers(init.headers).get('authorization'), 'Bearer ' + token)
      const rpc = JSON.parse(String(init.body))
      assert.notEqual(rpc.method, 'tools/call', 'this module must never read activity data or execute tools')
      if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 })
      const id = options.badRpcId ? 99999 : rpc.id
      if (rpc.method === 'initialize') return json({ jsonrpc: '2.0', id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } } }, 200, { 'mcp-session-id': 'synthetic-session' })
      assert.equal(rpc.method, 'tools/list')
      assert.equal(new Headers(init.headers).get('mcp-session-id'), 'synthetic-session')
      const result = rpc.params?.cursor ? { tools: [{ name: 'synthetic_unclassified_tool' }] } : { tools: [{ name: 'synthetic_read_tool', annotations: { readOnlyHint: true } }, { name: 'synthetic_write_tool', annotations: { readOnlyHint: false } }], nextCursor: 'synthetic-page-2' }
      return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result })}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
    }
    throw new Error('Unexpected synthetic upstream URL: ' + url)
  }) as unknown as typeof fetch
  const deps: StravaMcpDeps = { fetch: fetcher, stateKey: KEY, personalUse: 'true', personalOwner: 'local', personalAccessKey: ACCESS_KEY, now: () => now }
  return { deps, calls, setNow: (value: number) => { now = value } }
}
const cookies = (response: Response) => response.headers.getSetCookie().filter(value => !/Max-Age=0(?:;|$)/.test(value))
function request(path: string, jar: string[] = [], method = 'GET', body?: unknown, extra: Record<string, string> = {}) {
  return new Request(BASE + path, { method, headers: { cookie: jar.map(value => value.split(';')[0]).join('; '), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
async function unlock(mock: ReturnType<typeof mockStrava>) {
  const response = await handleStravaMcp(request('unlock?athlete=local', [], 'POST', { accessKey: ACCESS_KEY }), 'unlock', mock.deps)
  assert.equal(response.status, 200)
  return cookies(response)
}
async function begin(mock: ReturnType<typeof mockStrava>, access?: string[]) {
  const accessCookies = access ?? await unlock(mock)
  const response = await handleStravaMcp(request('start?athlete=local', accessCookies), 'start', mock.deps)
  assert.equal(response.status, 302)
  const location = new URL(response.headers.get('location')!)
  return { response, location, jar: [...accessCookies, ...cookies(response)] }
}
async function login(mock: ReturnType<typeof mockStrava>) {
  const start = await begin(mock)
  const callback = `callback?code=synthetic-code&state=${start.location.searchParams.get('state')}`
  const response = await handleStravaMcp(request(callback, start.jar), 'callback', mock.deps)
  assert.equal(response.headers.get('location'), '/?watch_provider=strava&watch_auth=ok')
  return { ...start, callback, response, jar: [...start.jar.filter(value => !value.startsWith('fk_smcp_pending=')), ...cookies(response)] }
}

test('personal setup is disabled unless all server-only configuration exists; status never contacts upstream', async () => {
  for (const missing of [{ personalUse: undefined }, { personalUse: 'false' }, { personalOwner: '' }, { stateKey: undefined }, { personalAccessKey: '' }, { personalAccessKey: 'too-short' }]) {
    const m = mockStrava()
    const response = await handleStravaMcp(request('status?athlete=local'), 'status', { ...m.deps, ...missing })
    assert.equal(response.status, 200)
    const data = await response.json()
    assert.deepEqual([data.configured, data.connected, data.accountRef, data.reason], [false, false, null, 'PERSONAL_SETUP_REQUIRED'])
    assert.equal(m.calls.length, 0)
    assert.ok(!JSON.stringify(data).includes(ACCESS_KEY))
  }
})

test('a client-supplied matching athlete ID cannot unlock the personal server without the private access key', async () => {
  const m = mockStrava()
  const status = await (await handleStravaMcp(request('status?athlete=local'), 'status', m.deps)).json()
  assert.equal(status.configured, true)
  assert.equal(status.reason, 'PERSONAL_ACCESS_REQUIRED')
  const wrong = await handleStravaMcp(request('unlock?athlete=local', [], 'POST', { accessKey: 'incorrect-key' }), 'unlock', m.deps)
  assert.equal(wrong.status, 401)
  assert.ok(!(await wrong.text()).includes('incorrect-key'))
  const denied = await handleStravaMcp(request('start?athlete=local'), 'start', m.deps)
  assert.equal(denied.status, 401)
  assert.equal(m.calls.length, 0)
})

test('unlock enforces POST JSON and same-origin requests, limits the owner, and issues an expiring sealed HttpOnly cookie', async () => {
  const m = mockStrava()
  assert.equal((await handleStravaMcp(request('unlock?athlete=local'), 'unlock', m.deps)).status, 405)
  assert.equal((await handleStravaMcp(request('unlock?athlete=local', [], 'POST', { accessKey: ACCESS_KEY }, { origin: 'https://evil.example' }), 'unlock', m.deps)).status, 403)
  assert.equal((await handleStravaMcp(request('unlock?athlete=other', [], 'POST', { accessKey: ACCESS_KEY }), 'unlock', m.deps)).status, 403)
  const jar = await unlock(m)
  assert.equal(jar.length, 1)
  assert.match(jar[0], /HttpOnly; Secure; SameSite=Lax/)
  assert.ok(!jar[0].includes(ACCESS_KEY))
  assert.equal((await (await handleStravaMcp(request('status?athlete=local', jar), 'status', m.deps)).json()).reason, 'NOT_CONNECTED')
  m.setNow(NOW + 21 * 60_000)
  assert.equal((await (await handleStravaMcp(request('status?athlete=local', jar), 'status', m.deps)).json()).reason, 'PERSONAL_ACCESS_REQUIRED')
})

test('explicit connect discovers only official endpoints, registers a client, and redirects in the same window with PKCE S256', async () => {
  const m = mockStrava(), started = await begin(m)
  assert.equal(started.location.origin + started.location.pathname, OAUTH + 'authorize')
  assert.equal(started.location.searchParams.get('resource'), RESOURCE)
  assert.equal(started.location.searchParams.get('redirect_uri'), BASE + 'callback')
  assert.equal(started.location.searchParams.get('code_challenge_method'), 'S256')
  assert.ok((started.location.searchParams.get('code_challenge')?.length ?? 0) >= 43)
  const registration = m.calls.find(call => call.url.endsWith('/register_client'))!
  const body = JSON.parse(String(registration.init.body))
  assert.deepEqual(body.redirect_uris, [BASE + 'callback'])
  assert.deepEqual(body.grant_types, ['authorization_code', 'refresh_token'])
  assert.ok(started.response.headers.getSetCookie().every(value => /HttpOnly; Secure; SameSite=Lax/.test(value)))
  assert.ok(m.calls.every(call => call.init.redirect === 'manual'))
})

test('callback exchanges only the matching pending state and exposes saved authorization separately from imported data', async () => {
  const m = mockStrava(), signedIn = await login(m)
  const statusResponse = await handleStravaMcp(request('status?athlete=local', signedIn.jar), 'status', m.deps)
  const status = await statusResponse.json()
  assert.equal(status.connected, true)
  assert.equal(status.accountRef, null)
  assert.equal(status.dataImported, false)
  assert.equal(status.connectionBasis, 'saved_authorization')
  const exposed = JSON.stringify(status) + signedIn.response.headers.getSetCookie().join(';')
  for (const secret of ['synthetic-access-1', 'synthetic-refresh-1', 'synthetic-client-secret', ACCESS_KEY]) assert.ok(!exposed.includes(secret))
  assert.match(signedIn.response.headers.getSetCookie().join(';'), /fk_smcp_pending=;.*Max-Age=0/)
})

test('wrong, expired, cross-unlock, and replayed state cannot exchange another token', async () => {
  const m = mockStrava(), begun = await begin(m)
  const wrong = await handleStravaMcp(request('callback?code=C&state=wrong', begun.jar), 'callback', m.deps)
  assert.match(wrong.headers.get('location')!, /watch_auth=state$/)
  const otherAccess = await unlock(m)
  const mixedJar = [...otherAccess, ...begun.jar.filter(value => !value.startsWith('fk_smcp_access='))]
  const callback = `callback?code=C&state=${begun.location.searchParams.get('state')}`
  assert.match((await handleStravaMcp(request(callback, mixedJar), 'callback', m.deps)).headers.get('location')!, /watch_auth=state$/)
  assert.equal(m.calls.filter(call => call.url.endsWith('/token')).length, 0)
  m.setNow(NOW + 11 * 60_000)
  assert.match((await handleStravaMcp(request(callback, begun.jar), 'callback', m.deps)).headers.get('location')!, /watch_auth=state$/)
  const fresh = mockStrava(), ready = await begin(fresh)
  const cb = `callback?code=C&state=${ready.location.searchParams.get('state')}`
  const results = await Promise.all([handleStravaMcp(request(cb, ready.jar), 'callback', fresh.deps), handleStravaMcp(request(cb, ready.jar), 'callback', fresh.deps)])
  assert.deepEqual(results.map(response => new URL(response.headers.get('location')!, BASE).searchParams.get('watch_auth')).sort(), ['ok', 'state'])
  assert.equal(fresh.calls.filter(call => call.url.endsWith('/token')).length, 1)
})

test('metadata cannot redirect credentials to an unapproved host, change issuer, or downgrade PKCE', async () => {
  for (const option of [{ evilToken: true }, { badIssuer: true }, { badPkce: true }, { redirect: true }]) {
    const m = mockStrava(option), access = await unlock(m)
    const response = await handleStravaMcp(request('start?athlete=local', access), 'start', m.deps)
    assert.ok(response.status >= 400)
    assert.equal(m.calls.filter(call => call.url.includes('/register_client')).length, 0)
    assert.ok(m.calls.every(call => !call.url.includes('evil.example')))
  }
})

for (const method of ['client_secret_basic', 'client_secret_post', 'none'] as AuthMethod[]) test(`registered ${method} is honored during token exchange`, async () => {
  const m = mockStrava({ method }); await login(m)
  const call = m.calls.find(value => value.url.endsWith('/token'))!, headers = new Headers(call.init.headers), form = new URLSearchParams(String(call.init.body))
  assert.equal(form.get('resource'), RESOURCE)
  assert.ok((form.get('code_verifier')?.length ?? 0) >= 43)
  if (method === 'client_secret_basic') { assert.equal(headers.get('authorization'), 'Basic ' + btoa('synthetic-client:synthetic-client-secret')); assert.equal(form.get('client_secret'), null) }
  else if (method === 'client_secret_post') { assert.equal(headers.get('authorization'), null); assert.equal(form.get('client_secret'), 'synthetic-client-secret') }
  else { assert.equal(headers.get('authorization'), null); assert.equal(form.get('client_secret'), null); assert.equal(form.get('client_id'), 'synthetic-client') }
})

test('unknown DCR auth methods and missing required client secrets fail closed', async () => {
  for (const options of [{ method: 'private_key_jwt' }, { noSecret: true }, { method: 'client_secret_post', noSecret: true }]) {
    const m = mockStrava(options), access = await unlock(m)
    const response = await handleStravaMcp(request('start?athlete=local', access), 'start', m.deps)
    assert.ok(response.status >= 400)
    assert.equal(m.calls.filter(call => call.url.endsWith('/token')).length, 0)
  }
})

test('MCP capabilities use only initialization and paginated tools/list, preserve unknown read-only hints, and never call a tool', async () => {
  const m = mockStrava(), session = await login(m)
  const response = await handleStravaMcp(request('capabilities?athlete=local', session.jar), 'capabilities', m.deps)
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.deepEqual(data.tools, [{ name: 'synthetic_read_tool', readOnlyHint: true }, { name: 'synthetic_write_tool', readOnlyHint: false }, { name: 'synthetic_unclassified_tool', readOnlyHint: null }])
  assert.equal(data.dataImported, false)
  assert.equal(data.readOnly, true)
  assert.match(data.notice, /尚未导入方坤/)
  const methods = m.calls.filter(call => call.url === RESOURCE).map(call => JSON.parse(String(call.init.body)).method)
  assert.deepEqual(methods, ['initialize', 'notifications/initialized', 'tools/list', 'tools/list'])
  assert.ok(!JSON.stringify(data).includes('synthetic-access'))
})

test('expired credentials refresh through the registered client; failed refresh clears authorization', async () => {
  for (const failed of [false, true]) {
    const m = mockStrava({ expired: true, refreshError: failed }), session = await login(m)
    const response = await handleStravaMcp(request('capabilities?athlete=local', session.jar), 'capabilities', m.deps)
    assert.equal(response.status, failed ? 401 : 200)
    assert.equal(m.calls.filter(call => call.url.endsWith('/token')).length, 2)
    if (failed) assert.match(response.headers.getSetCookie().join(';'), /Max-Age=0/)
    else assert.ok(cookies(response).some(value => value.startsWith('fk_smcp_token0=')))
  }
})

test('capability responses with mismatched JSON-RPC IDs are rejected rather than being shown as discovered tools', async () => {
  const m = mockStrava({ badRpcId: true }), session = await login(m)
  const response = await handleStravaMcp(request('capabilities?athlete=local', session.jar), 'capabilities', m.deps)
  assert.equal(response.status, 502)
  assert.equal((await response.json()).error, 'BAD_RESPONSE')
})

test('disconnect requires same-origin POST and removes local credentials even when official revocation is unavailable', async () => {
  const m = mockStrava({ revokeFail: true }), session = await login(m)
  assert.equal((await handleStravaMcp(request('disconnect?athlete=local', session.jar), 'disconnect', m.deps)).status, 405)
  assert.equal((await handleStravaMcp(request('disconnect?athlete=local', session.jar, 'POST', undefined, { origin: 'https://evil.example' }), 'disconnect', m.deps)).status, 403)
  const response = await handleStravaMcp(request('disconnect?athlete=local', session.jar, 'POST'), 'disconnect', m.deps)
  const data = await response.json()
  assert.equal(data.ok, true)
  assert.equal(data.revoked, false)
  assert.ok(response.headers.getSetCookie().some(value => /^fk_smcp_token0=;/.test(value) && /Max-Age=0/.test(value)))
  const after = await handleStravaMcp(request('capabilities?athlete=local', session.jar), 'capabilities', m.deps)
  assert.equal(after.status, 401)
})

test('tampered access cookies, a rotated access key, and an owner mismatch cannot use saved credentials', async () => {
  const m = mockStrava(), session = await login(m), before = m.calls.length
  const tampered = session.jar.map(value => value.startsWith('fk_smcp_access=') ? value.replace('fk_smcp_access=', 'fk_smcp_access=corrupted') : value)
  assert.equal((await handleStravaMcp(request('capabilities?athlete=local', tampered), 'capabilities', m.deps)).status, 401)
  assert.equal((await handleStravaMcp(request('capabilities?athlete=local', session.jar), 'capabilities', { ...m.deps, personalAccessKey: ACCESS_KEY + '-rotated' })).status, 401)
  assert.equal((await handleStravaMcp(request('capabilities?athlete=other', session.jar), 'capabilities', m.deps)).status, 403)
  assert.equal(m.calls.length, before)
})

test('unknown token types never create a connected session', async () => {
  const m = mockStrava({ accessType: 'DPoP' }), start = await begin(m)
  const callback = await handleStravaMcp(request(`callback?code=C&state=${start.location.searchParams.get('state')}`, start.jar), 'callback', m.deps)
  assert.match(callback.headers.get('location')!, /watch_auth=token_failed$/)
  assert.ok(!cookies(callback).some(value => value.startsWith('fk_smcp_token')))
})

test('slow discovery has a bounded timeout and does not attempt registration', async () => {
  const m = mockStrava(), jar = await unlock(m)
  const pendingFetch = (async (_url: string, init: RequestInit) => new Promise((_resolve, reject) => { init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }) })) as unknown as typeof fetch
  const response = await handleStravaMcp(request('start?athlete=local', jar), 'start', { ...m.deps, fetch: pendingFetch, timeoutMs: 5 })
  assert.equal(response.status, 504)
  assert.equal((await response.json()).error, 'TIMEOUT')
})

test('an oversized chunked unlock request is cancelled before reading its remaining body', async () => {
  const m = mockStrava(); let cancelled = false
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(6000))) }, pull() { throw new Error('The oversized request must not be read any further') }, cancel() { cancelled = true } }, { highWaterMark: 0 })
  const oversized = new Request(BASE + 'unlock?athlete=local', { method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit)
  const response = await handleStravaMcp(oversized, 'unlock', m.deps)
  assert.equal(response.status, 400)
  assert.equal(cancelled, true)
  assert.equal(m.calls.length, 0)
})

test('expired registered client secrets are registered again instead of reusing a known expired client', async () => {
  const m = mockStrava({ secretExpiresIn: 120 }), first = await begin(m)
  m.setNow(NOW + 121_000)
  await begin(m, first.jar)
  assert.equal(m.calls.filter(call => call.url.endsWith('/register_client')).length, 2)
})

test('an invalid OAuth client removes its cached credentials so the next user attempt can register again', async () => {
  const m = mockStrava({ invalidClient: true }), first = await begin(m)
  const response = await handleStravaMcp(request(`callback?code=C&state=${first.location.searchParams.get('state')}`, first.jar), 'callback', m.deps)
  assert.match(response.headers.get('location')!, /watch_auth=client_auth_expired$/)
  assert.ok(response.headers.getSetCookie().some(value => value.startsWith('fk_smcp_client=;') && /Max-Age=0/.test(value)))
})

// Independent review regressions: only synthetic upstream responses and gates.
test('disconnect during callback exchange must not recreate a connected session', async () => {
  const m = mockStrava(), started = await begin(m), originalFetch = m.deps.fetch
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { entered = resolve })
  m.deps.fetch = (async (input, init) => {
    if (String(input) === OAUTH + 'token' && new URLSearchParams(String(init?.body)).get('grant_type') === 'authorization_code') { entered(); await gate }
    return originalFetch(input, init)
  }) as typeof fetch
  const pending = handleStravaMcp(request(`callback?code=synthetic-race-code&state=${started.location.searchParams.get('state')}`, started.jar), 'callback', m.deps)
  await ready
  const disconnected = await handleStravaMcp(request('disconnect?athlete=local', started.jar, 'POST'), 'disconnect', m.deps)
  assert.equal(disconnected.status, 200)
  const disconnectBody = await disconnected.json()
  assert.equal(disconnectBody.revoked, false, 'an unfinished token exchange cannot be reported as fully revoked')
  release()
  const late = await pending, lateTokens = cookies(late).filter(value => value.startsWith('fk_smcp_token'))
  const jar = [...started.jar.filter(value => !value.startsWith('fk_smcp_pending=')), ...cookies(late)]
  const status = await (await handleStravaMcp(request('status?athlete=local', jar), 'status', m.deps)).json()
  const evidence = { disconnectBody, lateCallback: late.headers.get('location'), activeTokenCookies: lateTokens.length, statusAfterLateCallback: status.connected, revokeCalls: m.calls.filter(value => value.url === OAUTH + 'revoke').length }
  assert.equal(lateTokens.length, 0, JSON.stringify(evidence))
  assert.equal(status.connected, false)
  assert.ok(evidence.revokeCalls >= 1, 'the late-issued grant is revoked')
})

test('a callback prepared before disconnect must not authorize afterwards with old pending cookies', async () => {
  const m = mockStrava(), started = await begin(m)
  await handleStravaMcp(request('disconnect?athlete=local', started.jar, 'POST'), 'disconnect', m.deps)
  const response = await handleStravaMcp(request(`callback?code=synthetic-delayed-code&state=${started.location.searchParams.get('state')}`, started.jar), 'callback', m.deps)
  assert.equal(cookies(response).filter(value => value.startsWith('fk_smcp_token')).length, 0, `late callback result: ${response.headers.get('location')}`)
  assert.equal(m.calls.filter(value => value.url === OAUTH + 'token').length, 0)
})

test('disconnect during refresh must revoke the rotated grant and stop MCP requests', async () => {
  const m = mockStrava({ expired: true }), signedIn = await login(m), originalFetch = m.deps.fetch
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { entered = resolve })
  m.deps.fetch = (async (input, init) => {
    if (String(input) === OAUTH + 'token' && new URLSearchParams(String(init?.body)).get('grant_type') === 'refresh_token') {
      entered(); await gate
      const originalResponse = await originalFetch(input, init)
      return Response.json({ ...await originalResponse.json(), refresh_token: 'synthetic-refresh-2' })
    }
    return originalFetch(input, init)
  }) as typeof fetch
  const reading = handleStravaMcp(request('capabilities?athlete=local', signedIn.jar), 'capabilities', m.deps)
  await ready
  const disconnected = await handleStravaMcp(request('disconnect?athlete=local', signedIn.jar, 'POST'), 'disconnect', m.deps)
  const disconnectBody = await disconnected.json()
  assert.equal(disconnectBody.revoked, false, 'a pending rotated grant remains unconfirmed when disconnect returns')
  const beforeRelease = m.calls.length
  release()
  const late = await reading
  const revokedTokens = m.calls.filter(value => value.url === OAUTH + 'revoke').map(value => new URLSearchParams(String(value.init.body)).get('token'))
  const evidence = { disconnectBody, lateStatus: late.status, revokedTokens, mcpCallsAfterDisconnect: m.calls.slice(beforeRelease).filter(value => value.url === RESOURCE).length, activeTokenCookies: cookies(late).filter(value => value.startsWith('fk_smcp_token')).length }
  assert.ok(revokedTokens.includes('synthetic-refresh-2'), JSON.stringify(evidence))
  assert.equal(evidence.mcpCallsAfterDisconnect, 0)
  assert.equal(late.status, 401)
  assert.equal(evidence.activeTokenCookies, 0)
})

test('race control: simultaneous state callbacks exchange exactly once; wrong owner and expired gate cannot read capabilities', async () => {
  const m = mockStrava(), started = await begin(m)
  const path = `callback?code=synthetic-parallel&state=${started.location.searchParams.get('state')}`
  const callbacks = await Promise.all([handleStravaMcp(request(path, started.jar), 'callback', m.deps), handleStravaMcp(request(path, started.jar), 'callback', m.deps)])
  assert.equal(m.calls.filter(value => value.url === OAUTH + 'token').length, 1)
  assert.deepEqual(callbacks.map(value => new URL(value.headers.get('location')!, BASE).searchParams.get('watch_auth')).sort(), ['ok', 'state'])
  const good = callbacks.find(value => value.headers.get('location')?.endsWith('watch_auth=ok'))!
  const jar = [...started.jar, ...cookies(good)]
  const before = m.calls.length
  assert.equal((await handleStravaMcp(request('capabilities?athlete=other', jar), 'capabilities', m.deps)).status, 403)
  m.setNow(NOW + 21 * 60_000)
  assert.equal((await handleStravaMcp(request('capabilities?athlete=local', jar), 'capabilities', m.deps)).status, 401)
  assert.equal(m.calls.length, before)
})

test('disconnect while the refreshed cookie is being sealed must prevent its late Set-Cookie', async () => {
  const m = mockStrava({ expired: true }), signedIn = await login(m)
  const subtle = crypto.subtle, originalEncrypt = subtle.encrypt.bind(subtle)
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { entered = resolve })
  subtle.encrypt = (async (algorithm, key, data) => {
    let isRefreshedAuth = false
    try { isRefreshedAuth = JSON.parse(new TextDecoder().decode(data as Uint8Array)).access === 'synthetic-access-2' } catch {}
    if (isRefreshedAuth) { entered(); await gate }
    return originalEncrypt(algorithm, key, data)
  }) as SubtleCrypto['encrypt']
  try {
    const reading = handleStravaMcp(request('capabilities?athlete=local', signedIn.jar), 'capabilities', m.deps)
    await ready
    const disconnected = await handleStravaMcp(request('disconnect?athlete=local', signedIn.jar, 'POST'), 'disconnect', m.deps)
    release()
    const late = await reading
    const activeCookies = cookies(late).filter(value => value.startsWith('fk_smcp_token'))
    assert.equal(activeCookies.length, 0, JSON.stringify({ disconnectStatus: disconnected.status, lateStatus: late.status, activeTokenCookies: activeCookies.length, lateBody: await late.json() }))
  } finally { subtle.encrypt = originalEncrypt; release() }
})

test('a new explicit connection after disconnect can use the current personal gate while the old pending state stays invalid', async () => {
  const m = mockStrava(), first = await begin(m)
  const disconnected = await handleStravaMcp(request('disconnect?athlete=local', first.jar, 'POST'), 'disconnect', m.deps)
  assert.equal((await disconnected.json()).revoked, false)
  const gateAndClient = first.jar.filter(value => !value.startsWith('fk_smcp_pending='))
  const second = await begin(m, gateAndClient)
  const response = await handleStravaMcp(request(`callback?code=new-explicit-code&state=${second.location.searchParams.get('state')}`, second.jar), 'callback', m.deps)
  assert.match(response.headers.get('location')!, /watch_auth=ok$/)
  const jar = [...gateAndClient, ...cookies(response)]
  assert.equal((await (await handleStravaMcp(request('status?athlete=local', jar), 'status', m.deps)).json()).connected, true)
  const old = await handleStravaMcp(request(`callback?code=old-code&state=${first.location.searchParams.get('state')}`, first.jar), 'callback', m.deps)
  assert.match(old.headers.get('location')!, /watch_auth=state$/)
})

test('a failed revocation of a late rotated credential preserves the My Apps warning and never resumes MCP', async () => {
  const m = mockStrava({ expired: true, revokeFail: true }), signedIn = await login(m), originalFetch = m.deps.fetch
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { entered = resolve })
  m.deps.fetch = (async (input, init) => {
    if (String(input) === OAUTH + 'token' && new URLSearchParams(String(init?.body)).get('grant_type') === 'refresh_token') { entered(); await gate; return Response.json({ ...await (await originalFetch(input, init)).json(), refresh_token: 'synthetic-refresh-revoke-unavailable' }) }
    return originalFetch(input, init)
  }) as typeof fetch
  const reading = handleStravaMcp(request('capabilities?athlete=local', signedIn.jar), 'capabilities', m.deps)
  await ready
  const disconnected = await (await handleStravaMcp(request('disconnect?athlete=local', signedIn.jar, 'POST'), 'disconnect', m.deps)).json()
  assert.equal(disconnected.revoked, false)
  assert.match(disconnected.message, /My Apps/)
  release()
  const late = await reading
  assert.equal(late.status, 401)
  assert.match((await late.json()).message, /My Apps/)
  assert.equal(cookies(late).filter(value => value.startsWith('fk_smcp_token')).length, 0)
  assert.equal(m.calls.filter(value => value.url === RESOURCE).length, 0)
  assert.ok(m.calls.some(value => value.url === OAUTH + 'revoke' && new URLSearchParams(String(value.init.body)).get('token') === 'synthetic-refresh-revoke-unavailable'))
})

test('wrong, superseded and replayed callbacks cannot clear the newest pending cookie, while its own valid callback clears it', async () => {
  const m = mockStrava(), first = await begin(m), second = await begin(m, first.jar.filter(value => !value.startsWith('fk_smcp_pending=')))
  const oldPath = `callback?code=old&state=${first.location.searchParams.get('state')}`
  for (const [path, jar] of [['callback?code=C&state=wrong', second.jar], [oldPath, first.jar], [oldPath, second.jar]] as const) {
    const response = await handleStravaMcp(request(path, jar), 'callback', m.deps)
    assert.ok(!response.headers.getSetCookie().some(value => value.startsWith('fk_smcp_pending=')), 'an unrelated callback must leave the active pending cookie alone')
    assert.equal(cookies(response).filter(value => value.startsWith('fk_smcp_token')).length, 0)
  }
  assert.equal(m.calls.filter(value => value.url === OAUTH + 'token').length, 0)
  const path = `callback?code=current&state=${second.location.searchParams.get('state')}`
  const current = await handleStravaMcp(request(path, second.jar), 'callback', m.deps)
  assert.match(current.headers.get('location')!, /watch_auth=ok$/)
  assert.ok(current.headers.getSetCookie().some(value => value.startsWith('fk_smcp_pending=;') && value.includes('Max-Age=0')))
  const replay = await handleStravaMcp(request(path, second.jar), 'callback', m.deps)
  assert.ok(!replay.headers.getSetCookie().some(value => value.startsWith('fk_smcp_pending=')))
})

for (const rejected of [false, true]) test(`a superseded callback exchange ${rejected ? 'rejection' : 'success'} cannot clear or replace a newer pending authorization`, async () => {
  const m = mockStrava(), first = await begin(m), originalFetch = m.deps.fetch
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { entered = resolve })
  m.deps.fetch = (async (input, init) => {
    if (String(input) === OAUTH + 'token' && new URLSearchParams(String(init?.body)).get('code') === 'superseded-code') {
      entered(); await gate
      if (rejected) return Response.json({ error: 'invalid_client' }, { status: 401 })
    }
    return originalFetch(input, init)
  }) as typeof fetch
  const older = handleStravaMcp(request(`callback?code=superseded-code&state=${first.location.searchParams.get('state')}`, first.jar), 'callback', m.deps)
  await ready
  const second = await begin(m, first.jar.filter(value => !value.startsWith('fk_smcp_pending=')))
  release()
  const late = await older
  assert.equal(late.headers.getSetCookie().length, 0, 'the older response must not clear new pending/client cookies or restore an old token')
  const current = await handleStravaMcp(request(`callback?code=current&state=${second.location.searchParams.get('state')}`, second.jar), 'callback', m.deps)
  assert.match(current.headers.get('location')!, /watch_auth=ok$/)
})
