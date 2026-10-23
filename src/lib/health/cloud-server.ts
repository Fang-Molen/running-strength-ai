/** Independent watch-cloud HTTP boundary. Does not modify Grok authentication or existing Garmin/COROS.
 * The local athlete is a session-selection scope, not an authenticated server identity.
 * Possession of the host-only, encrypted HttpOnly cookie is the account credential.
 * Production multi-instance OAuth must inject a shared atomic consumeState implementation;
 * the fallback below guarantees one-time state consumption only inside this running instance.
 */
import { CLOUD_PROVIDERS, type CloudProvider, type CloudStatus, type CloudPreview } from './cloud-types.ts'
import { authorizationUrl, CloudFault, exchangeGrant, providerConfigured, readProviderPreview, refreshGrant, revokeGrant, type ActiveCloudProvider, type CloudGrant } from './cloud-providers.ts'

export type CloudServerDeps = { /** Production adapters stay closed until shared identity, atomic state, refresh lock and revocation ports are implemented. */ requireTrustedHost?: boolean; env: Record<string, string | undefined>; fetch: typeof fetch; now?: () => number; consumeState?: (nonce: string, expiresAt: number) => Promise<boolean> }
type Pending = { v: 1; provider: ActiveCloudProvider; owner: string; origin: string; state: string; callback: string; issuedAt: number; expiresAt: number }
type Session = { v: 1; provider: ActiveCloudProvider; owner: string; origin: string; sid: string; generation: string; issuedAt: number; expiresAt: number; grant: CloudGrant }
type Config = { origin: string; key: string }
const BASE = '/api/watch-cloud', PENDING_MS = 10 * 60_000, SESSION_MS = 60 * 86400_000, CHUNK = 3500, MAX_CHUNKS = 4
const encoder = new TextEncoder(), decoder = new TextDecoder()
const usedStates = new Map<string, number>(), revokedSessions = new Map<string, number>(), cancelledAuthorizations = new Map<string, number>()
type SyncResult = { preview: CloudPreview; session: Session; refreshed: boolean }
const syncJobs = new Map<string, { task: Promise<SyncResult>; current: { session: Session } }>()
const clock = (deps: CloudServerDeps) => (deps.now ?? Date.now)()
const authorizationKey = (provider: ActiveCloudProvider, origin: string, generation: string) => `${origin}:${provider}:${generation}`
const pendingCancelled = (p: Pending) => cancelledAuthorizations.has(authorizationKey(p.provider, p.origin, p.state))
const sessionRevoked = (s: Session) => revokedSessions.has(s.sid) || cancelledAuthorizations.has(authorizationKey(s.provider, s.origin, s.generation))
function cancelPending(p: Pending, now: number) { cancelledAuthorizations.set(authorizationKey(p.provider, p.origin, p.state), now + SESSION_MS) }
const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64u = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
const random = () => b64u(crypto.getRandomValues(new Uint8Array(32)))
const ownerOf = (value: string | null): string | null => value && /^[A-Za-z0-9_.:@-]{1,160}$/.test(value) ? value : null
function config(env: CloudServerDeps['env']): Config | null {
  const key = env.WATCH_CLOUD_STATE_KEY || env.STATE_KEY, configured = env.WATCH_CLOUD_PUBLIC_ORIGIN
  if (!key || key.length < 32 || !configured) return null
  try { const url = new URL(configured); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' ? { key, origin: url.origin } : null } catch { return null }
}
function cookie(name: string, value: string, age: number): string {
  return `${name}=${value}; Path=${BASE}; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(age))}`
}
const pendingName = (provider: CloudProvider) => `fk_wc_p_${provider}`
const pendingCookie = (provider: CloudProvider, value = '', age = 0) => cookie(pendingName(provider), value, age)
function tokenCookies(provider: CloudProvider, value: string | null, age = SESSION_MS / 1000): string[] {
  const chunks = value?.match(new RegExp(`.{1,${CHUNK}}`, 'g')) ?? []
  if (chunks.length > MAX_CHUNKS) throw new CloudFault('TOKEN_TOO_LARGE')
  return Array.from({ length: MAX_CHUNKS }, (_, i) => cookie(`fk_wc_t_${provider}_${i}`, chunks[i] ?? '', chunks[i] ? age : 0))
}
const clearProvider = (provider: CloudProvider) => [pendingCookie(provider), ...tokenCookies(provider, null)]
function readCookie(req: Request, name: string): string | null {
  const values = (req.headers.get('cookie') ?? '').split(';').map(x => x.trim()).filter(x => x.startsWith(name + '='))
  if (values.length !== 1) return null
  const value = values[0].slice(name.length + 1)
  return value && value.length <= CHUNK && /^[A-Za-z0-9_.-]+$/.test(value) ? value : null
}
async function aesKey(key: string) {
  const raw = await crypto.subtle.digest('SHA-256', encoder.encode('fangkun-watch-cloud-v1:' + key))
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}
async function seal(config: Config, purpose: string, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12)), encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(purpose + ':' + config.origin) }, await aesKey(config.key), encoder.encode(JSON.stringify(value)))
  return b64u(iv) + '.' + b64u(new Uint8Array(encrypted))
}
async function unseal<T>(config: Config, purpose: string, value: string | null): Promise<T | null> {
  if (!value || value.length > CHUNK * MAX_CHUNKS) return null
  try {
    const parts = value.split('.'); if (parts.length !== 2) return null
    const iv = fromB64u(parts[0]); if (iv.length !== 12) return null
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(purpose + ':' + config.origin) }, await aesKey(config.key), fromB64u(parts[1]))
    return JSON.parse(decoder.decode(decrypted)) as T
  } catch { return null }
}
async function pendingOf(request: Request, provider: ActiveCloudProvider, settings: Config, now: number): Promise<Pending | null> {
  const p = await unseal<Pending>(settings, `${provider}:pending`, readCookie(request, pendingName(provider)))
  return p && p.v === 1 && p.provider === provider && p.origin === settings.origin && ownerOf(p.owner) && p.callback === `${settings.origin}${BASE}/${provider}/callback` && typeof p.state === 'string' && /^[A-Za-z0-9_-]{43}$/.test(p.state) && Number.isFinite(p.issuedAt) && p.issuedAt <= now + 60_000 && Number.isFinite(p.expiresAt) && p.expiresAt > now && p.expiresAt - p.issuedAt <= PENDING_MS ? p : null
}
async function discardLateGrant(deps: CloudServerDeps, provider: ActiveCloudProvider, grant: CloudGrant) {
  // A completed exchange can use the ordinary budget. Reserve a bounded cleanup attempt.
  try { await revokeGrant({ ...deps, deadlineAt: clock(deps) + 10000 }, provider, grant) } catch { /* No token is installed; disconnect reports unconfirmed revocation. */ }
}
async function sessionOf(request: Request, provider: ActiveCloudProvider, settings: Config, now: number): Promise<Session | null> {
  let encoded = ''
  for (let i = 0; i < MAX_CHUNKS; i++) { const part = readCookie(request, `fk_wc_t_${provider}_${i}`); if (!part) break; encoded += part }
  const s = await unseal<Session>(settings, `${provider}:session`, encoded)
  if (!s || s.v !== 1 || s.provider !== provider || s.origin !== settings.origin || !ownerOf(s.owner) || typeof s.sid !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(s.sid) || typeof s.generation !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(s.generation) || !Number.isFinite(s.issuedAt) || s.issuedAt > now + 60_000 || !Number.isFinite(s.expiresAt) || s.expiresAt <= now || s.expiresAt - s.issuedAt > SESSION_MS || sessionRevoked(s)) return null
  const g = s.grant
  if (!g || typeof g.access !== 'string' || !g.access || g.access.length > 12000 || typeof g.vendorId !== 'string' || !g.vendorId || typeof g.accountRef !== 'string' || !/^[a-f0-9]{32}$/.test(g.accountRef) || !(g.refresh === null || typeof g.refresh === 'string') || !(g.expiresAt === null || typeof g.expiresAt === 'number' && Number.isFinite(g.expiresAt))) return null
  return s
}
function headers(cookies: string[] = [], extra: Record<string, string> = {}): Headers {
  const h = new Headers({ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', ...extra })
  for (const c of cookies) h.append('set-cookie', c)
  return h
}
const json = (body: unknown, status = 200, cookies: string[] = []) => new Response(JSON.stringify(body), { status, headers: headers(cookies, { 'content-type': 'application/json; charset=utf-8' }) })
const redirect = (location: string, cookies: string[] = []) => new Response(null, { status: 302, headers: headers(cookies, { location }) })
const back = (provider: CloudProvider, result: string, cookies: string[] = []) => redirect(`/?watch_provider=${provider}&watch_auth=${result}`, cookies)
function sameOrigin(request: Request, origin: string, mutation: boolean) {
  if (new URL(request.url).origin !== origin) throw new CloudFault('ORIGIN_MISMATCH', 403)
  const provided = request.headers.get('origin')
  if (provided && provided !== origin) throw new CloudFault('CSRF_REJECTED', 403)
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new CloudFault('CSRF_REJECTED', 403)
  if (mutation && provided !== origin) throw new CloudFault('CSRF_REJECTED', 403)
}
function equals(a: string, b: string): boolean {
  if (a.length > 128 || b.length > 128) return false
  let difference = a.length ^ b.length
  for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return difference === 0
}
async function stateKey(pending: Pending): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${pending.origin}:${pending.provider}:${pending.state}`))
  return Array.from(new Uint8Array(digest)).map(x => x.toString(16).padStart(2, '0')).join('')
}
function prune(map: Map<string, number>, now: number) { for (const [key, expires] of map) if (expires <= now) map.delete(key) }
async function consume(pending: Pending, deps: CloudServerDeps): Promise<boolean> {
  const now = clock(deps), key = await stateKey(pending)
  prune(usedStates, now)
  if (usedStates.has(key)) return false
  if (usedStates.size >= 20000) throw new CloudFault('SERVER_BUSY', 503)
  usedStates.set(key, pending.expiresAt)
  // Reserved before awaiting the injected atomic hook, so parallel callbacks in this instance cannot race.
  if (deps.consumeState) { try { return await deps.consumeState(key, pending.expiresAt) } catch { throw new CloudFault('SERVER_BUSY', 503) } }
  return true
}
async function status(request: Request, settings: Config | null, owner: string | null, deps: CloudServerDeps): Promise<CloudStatus[]> {
  const now = clock(deps), values: CloudStatus[] = []
  for (const provider of CLOUD_PROVIDERS) {
    const configured = !!settings && providerConfigured(provider, deps.env), base = { provider, configured, connected: false, accountRef: null }
    if (provider === 'huawei') { values.push({ ...base, reason: 'APPROVAL_REQUIRED' }); continue }
    if (!configured || !settings) { values.push({ ...base, reason: 'NOT_CONFIGURED' }); continue }
    if (!owner) { values.push({ ...base, reason: 'OWNER_REQUIRED' }); continue }
    const session = await sessionOf(request, provider, settings, now)
    if (!session) { values.push({ ...base, reason: 'NOT_CONNECTED' }); continue }
    if (session.owner !== owner) { values.push({ ...base, reason: 'OWNER_MISMATCH' }); continue }
    if (session.grant.expiresAt !== null && session.grant.expiresAt <= now && !session.grant.refresh) { values.push({ ...base, reason: 'REAUTHORIZE' }); continue }
    values.push({ provider, configured: true, connected: true, accountRef: session.grant.accountRef })
  }
  return values
}
async function syncSession(s: Session, deps: CloudServerDeps): Promise<{ preview: CloudPreview; session: Session; refreshed: boolean }> {
  const existing = syncJobs.get(s.sid)
  if (existing) return existing.task
  const current = { session: s }
  const work = (async () => {
    let session = s, refreshed = false
    const refresh = async () => {
      session = { ...session, grant: await refreshGrant(deps, s.provider, session.grant) }
      current.session = session
      refreshed = true
      if (sessionRevoked(s)) throw new CloudFault('NOT_CONNECTED', 401)
    }
    if (session.grant.expiresAt !== null && session.grant.expiresAt <= clock(deps) + 30_000) await refresh()
    let preview: CloudPreview
    try { preview = await readProviderPreview(deps, s.provider, session.grant) }
    catch (error) { if (error instanceof CloudFault && error.code === 'REAUTHORIZE' && !refreshed && s.provider === 'suunto' && session.grant.refresh) { await refresh(); preview = await readProviderPreview(deps, s.provider, session.grant) } else throw error }
    if (sessionRevoked(s)) throw new CloudFault('NOT_CONNECTED', 401)
    return { preview, session, refreshed }
  })()
  syncJobs.set(s.sid, { task: work, current })
  try { return await work } finally { if (syncJobs.get(s.sid)?.task === work) syncJobs.delete(s.sid) }
}
const MESSAGES: Record<string, string> = {
  NOT_CONFIGURED: '该平台尚未配置官方应用凭据和授权回调。', APPROVAL_REQUIRED: '华为运动健康需要完成平台接入审核并核实数据权限，当前未开放云同步。',
  OWNER_REQUIRED: '请先选择当前运动员后再连接。', OWNER_MISMATCH: '该授权属于另一个运动员；请为当前运动员单独授权。',
  NOT_CONNECTED: '尚未连接该平台。', REAUTHORIZE: '平台授权已失效，请重新授权。', SCOPE_REQUIRED: '平台未授予所需数据权限，请核对官方授权。',
  RATE_LIMITED: '平台读取额度暂时用完，请稍后再试。', ACCOUNT_UNVERIFIED: '未能核实授权账号，连接未保存。',
  CSRF_REJECTED: '请求来源无法核实，请回到方坤重新操作。', ORIGIN_MISMATCH: '当前站点与配置的官方回调地址不一致。',
  UPSTREAM_FORMAT: '平台返回格式无法核实，未导入数据。', UPSTREAM_REDIRECT: '平台接口发生意外跳转，已停止读取。',
  UPSTREAM_TOO_LARGE: '平台返回数据超过本次读取上限。', TOKEN_TOO_LARGE: '平台凭据过大，无法安全保存。',
  UPSTREAM_TIMEOUT: '平台读取超过本次等待时限，请稍后重试。',
  SERVER_BUSY: '授权服务暂时繁忙，请重新开始连接。', UPSTREAM_UNAVAILABLE: '平台暂时无法读取，请稍后重试。',
  METHOD_NOT_ALLOWED: '该请求方法不受支持。', NOT_FOUND: '没有找到这个平台接口。', DATA_UNAVAILABLE: '该平台数据暂时不可用。',
}
function errorResponse(error: unknown, cookies: string[] = []): Response {
  const code = error instanceof CloudFault ? error.code : 'UPSTREAM_UNAVAILABLE', status = error instanceof CloudFault ? error.status : 502
  return json({ ok: false, error: code, message: MESSAGES[code] ?? MESSAGES.UPSTREAM_UNAVAILABLE, ...(code === 'REAUTHORIZE' ? { reauthorize: true } : {}) }, status, cookies)
}

export async function handleWatchCloudRequest(request: Request, path: string, dependencies: CloudServerDeps): Promise<Response> {
  // The standalone handler below is suitable for synthetic contract tests. Browser
  // athlete labels and process-local maps are insufficient production authority.
  if (dependencies.requireTrustedHost) {
    if (path.replace(/^\/+|\/+$/g,'') === 'status') return json({providers:CLOUD_PROVIDERS.map(provider=>({provider,configured:false,connected:false,accountRef:null,reason:'TRUSTED_BINDINGS_MISSING'}))})
    return json({ok:false,error:'TRUSTED_BINDINGS_MISSING',message:'平台服务端账号归属与共享授权存储尚未接通；当前可使用文件导入。'},503)
  }
  const deps = { ...dependencies, deadlineAt: clock(dependencies) + 45000 }
  const url = new URL(request.url), segments = path.replace(/^\/+|\/+$/g, '').split('/'), provider = CLOUD_PROVIDERS.includes(segments[0] as CloudProvider) ? segments[0] as CloudProvider : null
  const action = segments[1], settings = config(deps.env), now = clock(deps)
  const athleteValues = url.searchParams.getAll('athlete'), owner = athleteValues.length === 1 ? ownerOf(athleteValues[0]) : null
  let callbackPending: Pending | null = null
  prune(revokedSessions, now)
  prune(cancelledAuthorizations, now)
  try {
    if (segments.length === 1 && segments[0] === 'status') {
      if (request.method !== 'GET') throw new CloudFault('METHOD_NOT_ALLOWED', 405)
      // Status without configuration is still a useful safe response; no credentials or remote calls.
      if (settings) sameOrigin(request, settings.origin, false)
      return json({ providers: await status(request, settings, owner, deps) })
    }
    if (!provider || segments.length !== 2 || !['start', 'callback', 'sync', 'disconnect'].includes(action)) throw new CloudFault('NOT_FOUND', 404)
    const requiredMethod = action === 'start' || action === 'callback' ? 'GET' : 'POST'
    if (request.method !== requiredMethod) throw new CloudFault('METHOD_NOT_ALLOWED', 405)
    if (settings && url.origin !== settings.origin) throw new CloudFault('ORIGIN_MISMATCH', 403)
    if (provider === 'huawei') throw new CloudFault('APPROVAL_REQUIRED', 503)
    if (!settings || !providerConfigured(provider, deps.env)) throw new CloudFault('NOT_CONFIGURED', 503)
    const callback = `${settings.origin}${BASE}/${provider}/callback`
    if (action === 'callback') {
      const pending = callbackPending = await pendingOf(request, provider, settings, now)
      const states = url.searchParams.getAll('state'), codes = url.searchParams.getAll('code'), errors = url.searchParams.getAll('error')
      // An invalid/duplicate callback must not erase a live pending cookie that disconnect needs.
      if (!pending || states.length !== 1 || !equals(pending.state, states[0]) || pendingCancelled(pending) || !(await consume(pending, deps)) || pendingCancelled(pending) || pending.expiresAt <= clock(deps)) return back(provider, 'state')
      if (errors.length) return back(provider, errors.length === 1 && errors[0] === 'access_denied' ? 'denied' : 'error', [pendingCookie(provider)])
      if (codes.length !== 1 || !codes[0] || codes[0].length > 2048) return back(provider, 'error', [pendingCookie(provider)])
      const grant = await exchangeGrant(deps, provider, codes[0], callback)
      try {
        if (pendingCancelled(pending) || pending.expiresAt <= clock(deps)) throw new CloudFault('NOT_CONNECTED', 401)
        const session: Session = { v: 1, provider, owner: pending.owner, origin: settings.origin, sid: random(), generation: pending.state, issuedAt: now, expiresAt: now + SESSION_MS, grant }
        const encoded = await seal(settings, `${provider}:session`, session)
        if (pendingCancelled(pending) || pending.expiresAt <= clock(deps)) throw new CloudFault('NOT_CONNECTED', 401)
        return back(provider, 'ok', [pendingCookie(provider), ...tokenCookies(provider, encoded)])
      } catch (error) { await discardLateGrant(deps, provider, grant); throw error }
    }
    sameOrigin(request, settings.origin, action === 'sync' || action === 'disconnect')
    if (!owner) throw new CloudFault('OWNER_REQUIRED', 400)
    if (action === 'start') {
      const previous = await pendingOf(request, provider, settings, now)
      if (previous) { cancelPending(previous, now); await consume(previous, deps) }
      const pending: Pending = { v: 1, provider, owner, origin: settings.origin, state: random(), callback, issuedAt: now, expiresAt: now + PENDING_MS }
      return redirect(authorizationUrl(provider, deps.env, callback, pending.state), [pendingCookie(provider, await seal(settings, `${provider}:pending`, pending), PENDING_MS / 1000)])
    }
    const session = await sessionOf(request, provider, settings, now)
    if (session && session.owner !== owner) throw new CloudFault('OWNER_MISMATCH', 403)
    if (action === 'disconnect') {
      const pending = await pendingOf(request, provider, settings, now)
      if (pending && pending.owner !== owner) throw new CloudFault('OWNER_MISMATCH', 403)
      if (pending) { cancelPending(pending, now); try { await consume(pending, deps) } catch { /* Local cancellation remains effective even if the shared consumer is unavailable. */ } }
      if (!session) return json({ ok: true, revoked: false, ...(pending ? { message: '本机已取消连接；如平台凭据仍在返回中，将尝试撤销，平台侧结果暂未确认。' } : {}) }, 200, clearProvider(provider))
      revokedSessions.set(session.sid, session.expiresAt)
      cancelledAuthorizations.set(authorizationKey(provider, settings.origin, session.generation), session.expiresAt)
      // A refresh in flight may have rotated access/refresh credentials. Revoke its latest grant.
      const pendingJob = syncJobs.get(session.sid)
      if (pendingJob) { try { await pendingJob.task } catch { /* The cancelled read is expected to reject. */ } }
      const grant = pendingJob?.current.session.grant ?? session.grant
      let revoked = false
      try { revoked = await revokeGrant(deps, provider, grant) && !pending } catch { /* Local credentials are still removed on an upstream outage. */ }
      return json({ ok: true, revoked, ...(!revoked ? { message: '本机已断开；平台侧撤销暂未确认，可在官方账号设置中检查。' } : {}) }, 200, clearProvider(provider))
    }
    if (!session) throw new CloudFault('NOT_CONNECTED', 401)
    const result = await syncSession(session, deps)
    if (sessionRevoked(session)) throw new CloudFault('NOT_CONNECTED', 401)
    const cookies = result.refreshed ? tokenCookies(provider, await seal(settings, `${provider}:session`, result.session), (session.expiresAt - now) / 1000) : []
    if (sessionRevoked(session)) throw new CloudFault('NOT_CONNECTED', 401)
    return json({ ok: true, ...result.preview }, 200, cookies)
  } catch (error) {
    const code = error instanceof CloudFault ? error.code : 'UPSTREAM_UNAVAILABLE'
    // Host/origin rejection never redirects a request back through an attacker-controlled host.
    const cancelledCallback = action === 'callback' && callbackPending !== null && pendingCancelled(callbackPending)
    if (provider && (action === 'start' || action === 'callback') && !['ORIGIN_MISMATCH', 'CSRF_REJECTED', 'METHOD_NOT_ALLOWED'].includes(code)) return back(provider, code.toLowerCase(), action === 'callback' && code !== 'NOT_CONNECTED' && !cancelledCallback ? [pendingCookie(provider)] : [])
    return errorResponse(error, provider && code === 'REAUTHORIZE' ? clearProvider(provider) : [])
  }
}
