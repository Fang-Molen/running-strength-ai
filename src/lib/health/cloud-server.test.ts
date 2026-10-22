import test from 'node:test'
import assert from 'node:assert/strict'
import { handleWatchCloudRequest, type CloudServerDeps } from './cloud-server.ts'

const NOW = Date.parse('2026-10-22T12:00:00Z'), ORIGIN = 'https://synthetic.fangkun.example'
const ENV = { WATCH_CLOUD_PUBLIC_ORIGIN: ORIGIN, WATCH_CLOUD_STATE_KEY: 'synthetic-only-state-key-more-than-32-characters', POLAR_CLIENT_ID: 'synthetic-polar-client', POLAR_CLIENT_SECRET: 'synthetic-polar-secret', SUUNTO_CLIENT_ID: 'synthetic-suunto-client', SUUNTO_CLIENT_SECRET: 'synthetic-suunto-secret', SUUNTO_SUBSCRIPTION_KEY: 'synthetic-subscription-key' }
const jwt = (user: string) => 'e30.' + Buffer.from(JSON.stringify({ user, exp: NOW / 1000 + 3600 })).toString('base64url') + '.synthetic'
type MockOptions = { partial?: boolean; expired?: boolean; mismatchedPolarId?: boolean; malformed?: boolean; tokenUserMissing?: boolean; sync401?: boolean }
function mock(options: MockOptions = {}) {
  const calls: { url: string; init: RequestInit }[] = []
  const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input); calls.push({ url, init }); const u = new URL(url)
    const j = (value: unknown, status = 200) => Response.json(value, { status })
    if (u.origin === 'https://polarremote.com') return j({ access_token: 'POLAR_ACCESS_SYNTHETIC', token_type: 'bearer', x_user_id: 42, expires_in: 31535999 })
    if (u.hostname === 'www.polaraccesslink.com') {
      if (u.pathname === '/v3/users' && init.method === 'POST') return j({ 'polar-user-id': options.mismatchedPolarId ? 43 : 42 })
      if (u.pathname === '/v3/users/42' && init.method === 'DELETE') return new Response(null, { status: 204 })
      if (options.sync401) return j({}, 401)
      if (u.pathname === '/v3/exercises') return j(options.malformed ? { surprise: true } : [{ id: 'polar-run', start_time: '2026-10-21T08:00:00', start_time_utc_offset: 480, duration: 'PT6M0.1S', distance: 1500.125, sport: 'RUNNING' }])
      if (options.partial && u.pathname.includes('/sleep')) return j({}, 503)
      if (u.pathname === '/v3/users/activities') return j([{ start_time: '2026-10-21T00:00:00', steps: 0 }])
      if (u.pathname === '/v3/users/sleep') return j({ nights: [] })
      if (u.pathname === '/v3/users/nightly-recharge') return j({ recharges: [] })
    }
    if (u.hostname === 'cloudapi-oauth.suunto.com') {
      if (u.pathname === '/oauth/deauthorize') return new Response(null, { status: 200 })
      if (u.pathname === '/oauth/token') return j({ access_token: options.tokenUserMissing ? 'e30.e30.synthetic' : jwt('synthetic-suunto-account'), refresh_token: 'SUUNTO_REFRESH_SYNTHETIC', token_type: 'bearer', expires_in: options.expired && !String(init.body).includes('grant_type=refresh_token') ? 1 : 86400 })
    }
    if (u.hostname === 'cloudapi.suunto.com') {
      if (u.pathname.replace(/\/$/, '') === '/v3/workouts') return j({ error: null, payload: [{ workoutKey: 'suunto-run', activityId: 1, startTime: NOW - 86400_000, totalTime: 360.1, totalDistance: 1500.125 }] })
      if (u.pathname === '/247/daily-activity-statistics') return j([])
      if (u.pathname === '/247samples/sleep') return j([])
    }
    throw new Error('Unexpected synthetic upstream path: ' + url)
  }) as typeof fetch
  const deps: CloudServerDeps = { env: { ...ENV }, fetch: fetcher, now: () => NOW }
  return { deps, calls }
}

function request(path: string, cookies: string[] = [], method = 'GET', extraHeaders: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/watch-cloud/${path}`, { method, headers: { cookie: cookies.map(c => c.split(';', 1)[0]).join('; '), ...(method === 'POST' ? { origin: ORIGIN } : {}), ...extraHeaders } })
}
const cookiesOf = (r: Response) => r.headers.getSetCookie().filter(c => !/Max-Age=0(?:;|$)/.test(c))
async function begin(m: ReturnType<typeof mock>, provider = 'polar', athlete = 'athlete-a') {
  const response = await handleWatchCloudRequest(request(`${provider}/start?athlete=${athlete}`), `${provider}/start`, m.deps)
  assert.equal(response.status, 302)
  return { response, location: new URL(response.headers.get('location')!), cookies: cookiesOf(response) }
}
async function login(m: ReturnType<typeof mock>, provider = 'polar', athlete = 'athlete-a') {
  const s = await begin(m, provider, athlete)
  const callbackPath = `${provider}/callback?code=synthetic-code&state=${s.location.searchParams.get('state')}`
  const response = await handleWatchCloudRequest(request(callbackPath, s.cookies), `${provider}/callback`, m.deps)
  assert.equal(response.headers.get('location'), `/?watch_provider=${provider}&watch_auth=ok`)
  return { cookies: cookiesOf(response), start: s, callbackPath, response }
}

test('unconfigured status is informative, does not read upstream, and Huawei never claims readiness', async () => {
  const m = mock(); const response = await handleWatchCloudRequest(request('status?athlete=athlete-a'), 'status', { ...m.deps, env: {} })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.deepEqual(body.providers.map((x: { configured: boolean; connected: boolean; accountRef: string | null }) => [x.configured, x.connected, x.accountRef]), [[false, false, null], [false, false, null], [false, false, null]])
  assert.equal(body.providers[0].reason, 'NOT_CONFIGURED')
  assert.equal(body.providers[2].reason, 'APPROVAL_REQUIRED')
  assert.equal(m.calls.length, 0)
})

test('Polar OAuth uses an exact registered callback, state, confidential exchange, and sealed HttpOnly cookies', async () => {
  const m = mock(), s = await login(m)
  assert.equal(s.start.location.origin, 'https://flow.polar.com')
  assert.equal(s.start.location.searchParams.get('redirect_uri'), `${ORIGIN}/api/watch-cloud/polar/callback`)
  assert.equal(s.start.location.searchParams.get('scope'), 'accesslink.read_all')
  assert.ok((s.start.location.searchParams.get('state')?.length ?? 0) >= 32)
  assert.ok(s.cookies.every(c => /HttpOnly; Secure; SameSite=Lax/.test(c)))
  const status = await (await handleWatchCloudRequest(request('status?athlete=athlete-a', s.cookies), 'status', m.deps)).json()
  assert.equal(status.providers[0].connected, true)
  assert.match(status.providers[0].accountRef, /^[a-f0-9]{32}$/)
  assert.ok(!JSON.stringify(status).includes('SYNTHETIC'))
  assert.ok(!s.cookies.join('').includes('POLAR_ACCESS_SYNTHETIC'))
  const token = m.calls.find(c => c.url === 'https://polarremote.com/v2/oauth2/token')!
  assert.equal(new Headers(token.init.headers).get('authorization'), 'Basic ' + btoa(`${ENV.POLAR_CLIENT_ID}:${ENV.POLAR_CLIENT_SECRET}`))
  assert.equal(new URLSearchParams(String(token.init.body)).get('redirect_uri'), `${ORIGIN}/api/watch-cloud/polar/callback`)
})

test('an authorization belongs to the captured local athlete scope and cannot reveal account details in another scope', async () => {
  const m = mock(), s = await login(m), count = m.calls.length
  const status = await (await handleWatchCloudRequest(request('status?athlete=athlete-b', s.cookies), 'status', m.deps)).json()
  assert.equal(status.providers[0].connected, false)
  assert.equal(status.providers[0].accountRef, null)
  assert.equal(status.providers[0].reason, 'OWNER_MISMATCH')
  for (const action of ['sync', 'disconnect']) {
    const result = await handleWatchCloudRequest(request(`polar/${action}?athlete=athlete-b`, s.cookies, 'POST'), `polar/${action}`, m.deps)
    assert.equal(result.status, 403)
    assert.equal((await result.json()).error, 'OWNER_MISMATCH')
  }
  assert.equal(m.calls.length, count)
})

test('wrong, expired, tampered, or already-consumed state never performs a second token exchange', async () => {
  const m = mock(), s = await begin(m)
  const bad = await handleWatchCloudRequest(request('polar/callback?code=x&state=bad', s.cookies), 'polar/callback', m.deps)
  assert.equal(bad.headers.get('location'), '/?watch_provider=polar&watch_auth=state')
  const late = await handleWatchCloudRequest(request('polar/callback?code=x&state=' + s.location.searchParams.get('state'), s.cookies), 'polar/callback', { ...m.deps, now: () => NOW + 601_000 })
  assert.equal(late.headers.get('location'), '/?watch_provider=polar&watch_auth=state')
  assert.equal(m.calls.length, 0)
  const authed = await login(m)
  const before = m.calls.length
  const replay = await handleWatchCloudRequest(request(authed.callbackPath, authed.start.cookies), 'polar/callback', m.deps)
  assert.equal(replay.headers.get('location'), '/?watch_provider=polar&watch_auth=state')
  assert.equal(m.calls.length, before)
})

test('OAuth denial clears pending state and returns only a fixed same-origin result', async () => {
  const m = mock(), s = await begin(m)
  const response = await handleWatchCloudRequest(request('polar/callback?error=access_denied&error_description=SECRET&returnTo=https://evil.example&state=' + s.location.searchParams.get('state'), s.cookies), 'polar/callback', m.deps)
  assert.equal(response.headers.get('location'), '/?watch_provider=polar&watch_auth=denied')
  assert.ok(response.headers.getSetCookie().some(c => /Max-Age=0/.test(c)))
  assert.equal(m.calls.length, 0)
})

test('cross-origin mutations and a hostile host are rejected before any upstream request', async () => {
  const m = mock(), s = await login(m), count = m.calls.length
  const cross = await handleWatchCloudRequest(request('polar/sync?athlete=athlete-a', s.cookies, 'POST', { origin: 'https://evil.example' }), 'polar/sync', m.deps)
  assert.equal(cross.status, 403)
  const hostile = await handleWatchCloudRequest(new Request('https://evil.example/api/watch-cloud/polar/start?athlete=athlete-a'), 'polar/start', m.deps)
  assert.equal(hostile.status, 403)
  assert.equal(m.calls.length, count)
})

test('Polar partial health failure keeps verified activities, precision and explicit issues without exposing upstream errors', async () => {
  const m = mock({ partial: true }), s = await login(m)
  const response = await handleWatchCloudRequest(request('polar/sync?athlete=athlete-a', s.cookies, 'POST'), 'polar/sync', m.deps)
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.activities[0].durationSec, 360.1)
  assert.equal(result.activities[0].distanceM, 1500.125)
  assert.equal(result.activities[0].maxHr, null)
  assert.equal(result.health[0].value, 0)
  assert.equal(result.partial, true)
  assert.ok(result.issues.length > 0)
  assert.ok(!JSON.stringify(result).includes('POLAR_ACCESS_SYNTHETIC'))
})

test('unverifiable vendor account identity is refused, never replaced by a local athlete ID', async () => {
  for (const [provider, options] of [['polar', { mismatchedPolarId: true }], ['suunto', { tokenUserMissing: true }]] as const) {
    const m = mock(options), s = await begin(m, provider)
    const r = await handleWatchCloudRequest(request(`${provider}/callback?code=x&state=${s.location.searchParams.get('state')}`, s.cookies), `${provider}/callback`, m.deps)
    assert.equal(r.headers.get('location'), `/?watch_provider=${provider}&watch_auth=account_unverified`)
    assert.ok(!cookiesOf(r).some(c => c.startsWith('fk_wc_t_')))
  }
})

test('Suunto requests v3 with an explicit start-time window and subscription header; expired access refreshes once', async () => {
  const m = mock({ expired: true }), s = await login(m, 'suunto')
  const response = await handleWatchCloudRequest(request('suunto/sync?athlete=athlete-a', s.cookies, 'POST'), 'suunto/sync', { ...m.deps, now: () => NOW + 60_000 })
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.activities[0].durationSec, 360.1)
  const read = m.calls.find(c => c.url.startsWith('https://cloudapi.suunto.com/v3/workouts'))!
  const url = new URL(read.url)
  assert.equal(url.searchParams.get('filter-by-modification-time'), 'false')
  assert.equal(Number(url.searchParams.get('until')) - Number(url.searchParams.get('since')), 28 * 86400_000)
  assert.equal(new Headers(read.init.headers).get('Ocp-Apim-Subscription-Key'), ENV.SUUNTO_SUBSCRIPTION_KEY)
  assert.equal(m.calls.filter(c => String(c.init.body).includes('grant_type=refresh_token')).length, 1)
  assert.ok(response.headers.getSetCookie().some(c => c.startsWith('fk_wc_t_suunto_')))
})

test('disconnect revokes only the selected provider and clears its encrypted cookies', async () => {
  const m = mock(), s = await login(m)
  const result = await handleWatchCloudRequest(request('polar/disconnect?athlete=athlete-a', s.cookies, 'POST'), 'polar/disconnect', m.deps)
  assert.equal(result.status, 200)
  assert.ok((await result.json()).ok)
  assert.ok(m.calls.some(c => c.url === 'https://www.polaraccesslink.com/v3/users/42' && c.init.method === 'DELETE'))
  assert.ok(result.headers.getSetCookie().every(c => c.includes('_polar') && /Max-Age=0/.test(c)))
  const status = await (await handleWatchCloudRequest(request('status?athlete=athlete-a', s.cookies), 'status', m.deps)).json()
  assert.equal(status.providers[0].connected, false)
})

test('replayed callbacks can use the injected atomic nonce consumer, and failure stays closed', async () => {
  const m = mock(), s = await begin(m); let attempted = 0
  const result = await handleWatchCloudRequest(request('polar/callback?code=x&state=' + s.location.searchParams.get('state'), s.cookies), 'polar/callback', { ...m.deps, consumeState: async () => { attempted++; return false } })
  assert.equal(result.headers.get('location'), '/?watch_provider=polar&watch_auth=state')
  assert.equal(attempted, 1)
  assert.equal(m.calls.length, 0)
})

test('upstream redirects are not followed with credentials, and diagnostic text is never returned verbatim', async () => {
  const m = mock(), s = await begin(m)
  const r = await handleWatchCloudRequest(request('polar/callback?code=x&state=' + s.location.searchParams.get('state'), s.cookies), 'polar/callback', { ...m.deps, fetch: (async (_u, init) => { assert.equal(init?.redirect, 'manual'); return new Response('secret from upstream', { status: 302, headers: { location: 'https://evil.example' } }) }) as typeof fetch })
  assert.equal(r.headers.get('location'), '/?watch_provider=polar&watch_auth=upstream_redirect')
  assert.ok(!(await r.text()).includes('secret'))
})

test('concurrent sync requests for the same encrypted session share one upstream read', async () => {
  const m = mock(), s = await login(m), original = m.deps.fetch
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), started = new Promise<void>(resolve => { entered = resolve })
  m.deps.fetch = (async (u, init) => { if (String(u).endsWith('/v3/exercises')) { entered(); await gate }; return original(u, init) }) as typeof fetch
  const one = handleWatchCloudRequest(request('polar/sync?athlete=athlete-a', s.cookies, 'POST'), 'polar/sync', m.deps)
  await started
  const two = handleWatchCloudRequest(request('polar/sync?athlete=athlete-a', s.cookies, 'POST'), 'polar/sync', m.deps)
  await new Promise(resolve => setTimeout(resolve, 10))
  release()
  const results = await Promise.all([one, two])
  assert.ok(results.every(x => x.status === 200))
  assert.equal(m.calls.filter(x => x.url.endsWith('/v3/exercises')).length, 1)
})

test('disconnect during a refresh-and-sync revokes the refreshed grant and prevents late cookies or data', async () => {
  const m = mock({ expired: true }), s = await login(m, 'suunto'), original = m.deps.fetch
  const refreshedAccess = 'e30.' + Buffer.from(JSON.stringify({ user: 'synthetic-suunto-account', exp: NOW / 1000 + 86400, jti: 'new' })).toString('base64url') + '.synthetic'
  let release!: () => void, entered!: () => void, deauthorizeHeader: string | null = null
  const gate = new Promise<void>(resolve => { release = resolve }), started = new Promise<void>(resolve => { entered = resolve })
  m.deps.fetch = (async (u, init) => {
    if (String(init?.body).includes('grant_type=refresh_token')) return Response.json({ access_token: refreshedAccess, refresh_token: 'NEW_REFRESH_SYNTHETIC', expires_in: 86400, token_type: 'bearer' })
    if (String(u).includes('/v3/workouts')) { entered(); await gate }
    if (String(u).includes('/oauth/deauthorize')) deauthorizeHeader = new Headers(init?.headers).get('authorization')
    return original(u, init)
  }) as typeof fetch
  const deps = { ...m.deps, now: () => NOW + 60_000 }
  const syncing = handleWatchCloudRequest(request('suunto/sync?athlete=athlete-a', s.cookies, 'POST'), 'suunto/sync', deps)
  await started
  const disconnecting = handleWatchCloudRequest(request('suunto/disconnect?athlete=athlete-a', s.cookies, 'POST'), 'suunto/disconnect', deps)
  await new Promise(resolve => setTimeout(resolve, 10))
  release()
  const [sync, disconnected] = await Promise.all([syncing, disconnecting])
  assert.equal(disconnected.status, 200)
  assert.equal(sync.status, 401)
  assert.ok(!cookiesOf(sync).some(c => c.startsWith('fk_wc_t_')))
  assert.equal(deauthorizeHeader, 'Bearer ' + refreshedAccess)
})

test('tampered session cookies, duplicate state and wrong methods are rejected without upstream activity', async () => {
  const m = mock(), s = await login(m), before = m.calls.length
  const corrupted = s.cookies.map(c => c.replace(/=./, '=!'))
  const out = await handleWatchCloudRequest(request('polar/sync?athlete=athlete-a', corrupted, 'POST'), 'polar/sync', m.deps)
  assert.equal(out.status, 401)
  const wrongMethod = await handleWatchCloudRequest(request('polar/sync?athlete=athlete-a', s.cookies), 'polar/sync', m.deps)
  assert.equal(wrongMethod.status, 405)
  const pending = await begin(m)
  const duplicate = await handleWatchCloudRequest(request('polar/callback?code=x&state=' + pending.location.searchParams.get('state') + '&state=second', pending.cookies), 'polar/callback', m.deps)
  assert.equal(duplicate.headers.get('location'), '/?watch_provider=polar&watch_auth=state')
  assert.equal(m.calls.length, before)
})

for (const provider of ['polar', 'suunto']) test(`${provider}: disconnect during callback exchange cancels the authorization and revokes a late grant`, async () => {
  const m = mock(), started = await begin(m, provider), original = m.deps.fetch
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { entered = resolve })
  m.deps.fetch = (async (input, init) => {
    if (String(input).endsWith('/token') && new URLSearchParams(String(init?.body)).get('grant_type') === 'authorization_code') { entered(); await gate }
    return original(input, init)
  }) as typeof fetch
  const callback = `${provider}/callback?code=synthetic-code&state=${started.location.searchParams.get('state')}`
  const waiting = handleWatchCloudRequest(request(callback, started.cookies), `${provider}/callback`, m.deps)
  await ready
  const disconnected = await handleWatchCloudRequest(request(`${provider}/disconnect?athlete=athlete-a`, started.cookies, 'POST'), `${provider}/disconnect`, m.deps)
  assert.equal(disconnected.status, 200)
  release()
  const late = await waiting
  assert.ok(!late.headers.get('location')?.endsWith('watch_auth=ok'))
  assert.ok(!cookiesOf(late).some(c => c.startsWith('fk_wc_t_')))
  assert.ok(m.calls.some(c => provider === 'polar' ? c.url.endsWith('/v3/users/42') && c.init.method === 'DELETE' : c.url.includes('/oauth/deauthorize')))
  const status = await (await handleWatchCloudRequest(request('status?athlete=athlete-a', cookiesOf(late)), 'status', m.deps)).json()
  assert.equal(status.providers.find((p: { provider: string }) => p.provider === provider).connected, false)
  // The cancelled generation must not prevent an explicit fresh authorization.
  m.deps.fetch = original
  const fresh = await login(m, provider)
  const after = await (await handleWatchCloudRequest(request('status?athlete=athlete-a', fresh.cookies), 'status', m.deps)).json()
  assert.equal(after.providers.find((p: { provider: string }) => p.provider === provider).connected, true)
})

for (const provider of ['polar', 'suunto']) test(`${provider}: disconnect during callback cookie sealing prevents late Set-Cookie and revokes its grant`, async () => {
  const m = mock(), started = await begin(m, provider), subtle = crypto.subtle, originalEncrypt = subtle.encrypt.bind(subtle)
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { entered = resolve })
  subtle.encrypt = (async (algorithm, key, data) => {
    let session = false
    try { const value = JSON.parse(new TextDecoder().decode(data as Uint8Array)); session = value.provider === provider && typeof value.sid === 'string' } catch {}
    if (session) { entered(); await gate }
    return originalEncrypt(algorithm, key, data)
  }) as SubtleCrypto['encrypt']
  try {
    const callback = `${provider}/callback?code=synthetic-code&state=${started.location.searchParams.get('state')}`
    const waiting = handleWatchCloudRequest(request(callback, started.cookies), `${provider}/callback`, m.deps)
    await ready
    const disconnected = await handleWatchCloudRequest(request(`${provider}/disconnect?athlete=athlete-a`, started.cookies, 'POST'), `${provider}/disconnect`, m.deps)
    assert.equal(disconnected.status, 200)
    release()
    const late = await waiting
    assert.ok(!late.headers.get('location')?.endsWith('watch_auth=ok'))
    assert.ok(!cookiesOf(late).some(c => c.startsWith('fk_wc_t_')))
    assert.ok(m.calls.some(c => provider === 'polar' ? c.url.endsWith('/v3/users/42') && c.init.method === 'DELETE' : c.url.includes('/oauth/deauthorize')))
  } finally { subtle.encrypt = originalEncrypt; release() }
})

test('a rejected duplicate callback does not delete the still-running authorization cookie needed for cancellation', async () => {
  const m = mock(), started = await begin(m), original = m.deps.fetch
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { entered = resolve })
  m.deps.fetch = (async (input, init) => { if (String(input).endsWith('/token')) { entered(); await gate }; return original(input, init) }) as typeof fetch
  const path = `polar/callback?code=synthetic-code&state=${started.location.searchParams.get('state')}`
  const first = handleWatchCloudRequest(request(path, started.cookies), 'polar/callback', m.deps)
  await ready
  const duplicate = await handleWatchCloudRequest(request(path, started.cookies), 'polar/callback', m.deps)
  release()
  await first
  assert.equal(duplicate.headers.get('location'), '/?watch_provider=polar&watch_auth=state')
  assert.equal(duplicate.headers.getSetCookie().length, 0)
})

test('starting a fresh authorization cancels the old callback without clearing the new pending cookie', async () => {
  const m = mock(), started = await begin(m), original = m.deps.fetch
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { entered = resolve })
  m.deps.fetch = (async (input, init) => { if (String(input).endsWith('/token')) { entered(); await gate }; return original(input, init) }) as typeof fetch
  const waiting = handleWatchCloudRequest(request(`polar/callback?code=old&state=${started.location.searchParams.get('state')}`, started.cookies), 'polar/callback', m.deps)
  await ready
  const fresh = await handleWatchCloudRequest(request('polar/start?athlete=athlete-a', started.cookies), 'polar/start', m.deps)
  const state = new URL(fresh.headers.get('location')!).searchParams.get('state')
  release()
  const late = await waiting
  assert.equal(late.headers.get('location'), '/?watch_provider=polar&watch_auth=not_connected')
  assert.equal(late.headers.getSetCookie().length, 0)
  m.deps.fetch = original
  const current = await handleWatchCloudRequest(request(`polar/callback?code=new&state=${state}`, cookiesOf(fresh)), 'polar/callback', m.deps)
  assert.equal(current.headers.get('location'), '/?watch_provider=polar&watch_auth=ok')
})

test('another athlete cannot cancel a pending authorization that has no token cookie yet', async () => {
  const m = mock(), started = await begin(m)
  const denied = await handleWatchCloudRequest(request('polar/disconnect?athlete=athlete-b', started.cookies, 'POST'), 'polar/disconnect', m.deps)
  assert.equal(denied.status, 403)
  assert.equal((await denied.json()).error, 'OWNER_MISMATCH')
  const callback = await handleWatchCloudRequest(request(`polar/callback?code=original&state=${started.location.searchParams.get('state')}`, started.cookies), 'polar/callback', m.deps)
  assert.equal(callback.headers.get('location'), '/?watch_provider=polar&watch_auth=ok')
})

test('a failed old callback exchange cannot clear the pending cookie of a fresh authorization', async () => {
  const m = mock(), started = await begin(m), original = m.deps.fetch
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), ready = new Promise<void>(resolve => { entered = resolve })
  m.deps.fetch = (async (input, init) => {
    if (String(input).endsWith('/token')) { entered(); await gate; throw new Error('synthetic upstream failure') }
    return original(input, init)
  }) as typeof fetch
  const waiting = handleWatchCloudRequest(request(`polar/callback?code=old&state=${started.location.searchParams.get('state')}`, started.cookies), 'polar/callback', m.deps)
  await ready
  const fresh = await handleWatchCloudRequest(request('polar/start?athlete=athlete-a', started.cookies), 'polar/start', m.deps)
  const state = new URL(fresh.headers.get('location')!).searchParams.get('state')
  release()
  const failed = await waiting
  assert.ok(!failed.headers.get('location')?.endsWith('watch_auth=ok'))
  assert.equal(failed.headers.getSetCookie().length, 0)
  m.deps.fetch = original
  const current = await handleWatchCloudRequest(request(`polar/callback?code=new&state=${state}`, cookiesOf(fresh)), 'polar/callback', m.deps)
  assert.equal(current.headers.get('location'), '/?watch_provider=polar&watch_auth=ok')
})
