/** Strava's official personal MCP connector. Server-only OAuth and capability discovery.
 * No activity tool is called and no Strava data is written into the training store.
 * Public discovery was verified on 2026-10-22; live DCR/PKCE/authorization remain unverified.
 * The access code is an independent personal gate: a client-supplied athlete ID is not authentication.
 * Replay/revocation sets are isolate-local. Cookie consumption plus the issuer's one-use code
 * protect the normal flow; globally atomic replay prevention needs a shared atomic store.
 */
export type StravaMcpDeps = {
  fetch: typeof fetch
  stateKey?: string
  personalUse?: string
  personalOwner?: string
  personalAccessKey?: string
  now?: () => number
  timeoutMs?: number
}

const BASE = '/api/strava-mcp'
const RESOURCE = 'https://mcp.strava.com/mcp'
const PRM = 'https://mcp.strava.com/.well-known/oauth-protected-resource'
const AUTHORITY = 'https://www.strava.com/mcp-issuer'
const ASM = 'https://www.strava.com/.well-known/oauth-authorization-server/mcp-issuer'
const OAUTH = 'https://www.strava.com/oauth/mcp/'
const SCOPE = 'read activity:read'
const NOTICE = '仅核验官方 MCP 工具列表，尚未导入方坤。'
const ACCESS = 'fk_smcp_access', PENDING = 'fk_smcp_pending', CLIENT = 'fk_smcp_client', TOKEN = 'fk_smcp_token'
const ACCESS_MS = 20 * 60_000, PENDING_MS = 10 * 60_000, SESSION_MS = 60 * 86400_000
const CHUNK = 3400, MAX_CHUNKS = 4, MAX_BODY = 1_048_576
const ENDPOINTS = new Set([PRM, ASM, RESOURCE, ...['authorize', 'token', 'register_client', 'revoke'].map(path => OAUTH + path)])
type AuthMethod = 'client_secret_basic' | 'client_secret_post' | 'none'
type Metadata = { resource: string; authorize: string; token: string; register: string; revoke: string | null; authMethods: string[] | null }
type RegisteredClient = { id: string; secret: string | null; method: AuthMethod; secretExpiresAt: number | null; redirect: string; owner: string; at: number }
type Access = { v: 1; owner: string; origin: string; nonce: string; at: number }
type Pending = { v: 1; state: string; verifier: string; accessNonce: string; generation: number; owner: string; origin: string; at: number; md: Metadata; client: RegisteredClient }
type Auth = { v: 1; id: string; accessNonce: string; generation: number; owner: string; origin: string; at: number; access: string; refresh: string | null; expiresAt: number; md: Metadata; client: RegisteredClient }
type Setup = { owner: string; stateKey: string; accessKey: string }
type Tool = { name: string; readOnlyHint: boolean | null }
class StravaError extends Error { constructor(readonly code: string, message: string, readonly status = 502) { super(message) } }
const fail = (code: string, message: string, status = 502): never => { throw new StravaError(code, message, status) }
const nowOf = (deps: StravaMcpDeps) => (deps.now ?? Date.now)()
const encoder = new TextEncoder(), decoder = new TextDecoder()
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const textValue = (value: unknown, max = 8192): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)
function setup(deps: StravaMcpDeps): Setup | null {
  const owner = deps.personalOwner?.trim()
  return deps.personalUse === 'true' && owner && owner !== '*' && owner.length <= 160 && deps.stateKey?.trim() && (deps.personalAccessKey?.length ?? 0) >= 32
    ? { owner, stateKey: deps.stateKey, accessKey: deps.personalAccessKey! } : null
}
const b64url = (bytes: Uint8Array) => { let value = ''; for (const byte of bytes) value += String.fromCharCode(byte); return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
const fromB64url = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0))
const random = (size = 24) => b64url(crypto.getRandomValues(new Uint8Array(size)))
const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
async function key(config: Setup) { return crypto.subtle.importKey('raw', await digest('fangkun-strava-mcp-v1:' + config.stateKey + ':' + config.accessKey), 'AES-GCM', false, ['encrypt', 'decrypt']) }
async function seal(config: Setup, value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12)), body = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(config), encoder.encode(JSON.stringify(value)))
  return b64url(iv) + '.' + b64url(new Uint8Array(body))
}
async function unseal<T>(config: Setup, value: string | null): Promise<T | null> {
  if (!value || value.length > CHUNK * MAX_CHUNKS) return null
  try { const pieces = value.split('.'); if (pieces.length !== 2) return null; return JSON.parse(decoder.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(pieces[0]) }, await key(config), fromB64url(pieces[1])))) as T } catch { return null }
}
const readCookie = (req: Request, name: string) => (req.headers.get('cookie') ?? '').split(';').map(part => part.trim()).find(part => part.startsWith(name + '='))?.slice(name.length + 1) ?? null
const cookie = (name: string, value: string, seconds: number) => `${name}=${value}; Path=${BASE}; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`
function tokenCookies(value: string | null) {
  const parts = value?.match(new RegExp(`.{1,${CHUNK}}`, 'g')) ?? []
  if (parts.length > MAX_CHUNKS) return fail('TOKEN_TOO_LARGE', 'Strava 返回的凭证过大，无法安全保存。')
  return Array.from({ length: MAX_CHUNKS }, (_, index) => cookie(TOKEN + index, parts[index] ?? '', parts[index] ? SESSION_MS / 1000 : 0))
}
function responseHeaders(cookies: string[]) {
  const headers = new Headers({ 'cache-control': 'no-store', pragma: 'no-cache', 'x-content-type-options': 'nosniff' })
  for (const value of cookies) headers.append('set-cookie', value)
  return headers
}
const json = (body: unknown, status = 200, cookies: string[] = []) => { const headers = responseHeaders(cookies); headers.set('content-type', 'application/json; charset=utf-8'); return new Response(JSON.stringify(body), { status, headers }) }
const redirect = (location: string, cookies: string[] = []) => { const headers = responseHeaders(cookies); headers.set('location', location); return new Response(null, { status: 302, headers }) }
const callbackResult = (code: string, cookies: string[] = [], clearPending = false) => redirect('/?watch_provider=strava&watch_auth=' + encodeURIComponent(code), [...(clearPending ? [cookie(PENDING, '', 0)] : []), ...cookies])
function sameOrigin(req: Request) {
  const origin = req.headers.get('origin'), site = req.headers.get('sec-fetch-site')
  if ((origin && origin !== new URL(req.url).origin) || site === 'cross-site') fail('CROSS_ORIGIN', '请从方坤窗口发起此操作。', 403)
}
async function constantEqual(a: string, b: string) { const [left, right] = await Promise.all([digest(a), digest(b)]); let difference = 0; for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index]; return difference === 0 }
function within(at: unknown, now: number, ttl: number): at is number { return typeof at === 'number' && Number.isFinite(at) && at <= now + 30_000 && now - at <= ttl }
async function readAccess(req: Request, config: Setup, now: number) {
  const access = await unseal<Access>(config, readCookie(req, ACCESS))
  return access?.v === 1 && access.owner === config.owner && access.origin === new URL(req.url).origin && textValue(access.nonce, 128) && within(access.at, now, ACCESS_MS) ? access : null
}
// Bounded isolate-local replay protection. Do not present this as a distributed nonce ledger.
const consumedStates = new Map<string, number>(), revokedSessions = new Map<string, number>()
const accessGenerations = new Map<string, { generation: number; until: number }>()
const latestPending = new Map<string, { state: string; until: number }>()
type GrantJob = { auth: Auth | null }
const callbackJobs = new Map<string, Set<GrantJob>>(), capabilityJobs = new Map<string, Set<GrantJob>>()
function clean(map: Map<string, number>, now: number) { for (const [id, until] of map) if (until < now) map.delete(id) }
function consume(state: string, now: number) { clean(consumedStates, now); if (consumedStates.has(state)) return false; if (consumedStates.size >= 10000) fail('BUSY', '连接请求较多，请稍后重试。', 429); consumedStates.set(state, now + PENDING_MS); return true }
function isRevoked(id: string, now: number) { clean(revokedSessions, now); return revokedSessions.has(id) }
function generation(nonce: string, now: number) {
  for (const [id, item] of accessGenerations) if (item.until < now) accessGenerations.delete(id)
  return accessGenerations.get(nonce)?.generation ?? 0
}
function activePending(nonce: string, now: number) {
  for (const [id, pending] of latestPending) if (pending.until < now) latestPending.delete(id)
  return latestPending.get(nonce)?.state ?? null
}
function rememberPending(nonce: string, state: string, now: number) {
  activePending(nonce, now)
  if (!latestPending.has(nonce) && latestPending.size >= 10000) fail('BUSY', '连接请求较多，请稍后重试。', 429)
  latestPending.set(nonce, { state, until: now + PENDING_MS })
}
function cancelGeneration(nonce: string, now: number) {
  const next = generation(nonce, now) + 1
  if (!accessGenerations.has(nonce) && accessGenerations.size >= 10000) fail('BUSY', '连接请求较多，请稍后重试。', 429)
  // Retain for the token-cookie lifetime so a delayed response cannot become valid
  // again after the much shorter personal-access cookie has expired.
  accessGenerations.set(nonce, { generation: next, until: now + SESSION_MS })
}
function inactive(auth: Auth, now: number) { return isRevoked(auth.id, now) || generation(auth.accessNonce, now) !== auth.generation }
function assertActive(auth: Auth, deps: StravaMcpDeps) { if (inactive(auth, nowOf(deps))) fail('NOT_CONNECTED', 'Strava 连接已断开。', 401) }
function track(map: Map<string, Set<GrantJob>>, id: string, job: GrantJob) {
  const jobs = map.get(id) ?? new Set<GrantJob>(); jobs.add(job); map.set(id, jobs)
  return () => { jobs.delete(job); if (!jobs.size) map.delete(id) }
}
async function readAuth(req: Request, config: Setup, now: number) {
  let value = ''; for (let index = 0; index < MAX_CHUNKS; index++) { const part = readCookie(req, TOKEN + index); if (!part) break; value += part }
  const auth = await unseal<Auth>(config, value || null)
  if (!auth || auth.v !== 1 || auth.owner !== config.owner || auth.origin !== new URL(req.url).origin || !within(auth.at, now, SESSION_MS) || !textValue(auth.id, 128) || !textValue(auth.accessNonce, 128) || !Number.isInteger(auth.generation) || inactive(auth, now) || !textValue(auth.access) || !Number.isFinite(auth.expiresAt) || auth.md?.resource !== RESOURCE || auth.md?.token !== OAUTH + 'token') return null
  return auth
}
async function limitedText(response: Pick<Response, 'body'>, limit = MAX_BODY, requestBody = false) {
  if (!response.body) return ''
  const reader = response.body.getReader(); let size = 0, output = ''
  const utf8 = new TextDecoder()
  try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > limit) { await reader.cancel(); fail(requestBody ? 'BAD_REQUEST' : 'BAD_RESPONSE', requestBody ? '接入码请求格式不正确。' : 'Strava 返回的内容过大，已停止。', requestBody ? 400 : 502) }; output += utf8.decode(part.value, { stream: true }) }; return output + utf8.decode() } finally { reader.releaseLock() }
}
async function http(deps: StravaMcpDeps, url: string, init: RequestInit = {}) {
  if (!ENDPOINTS.has(url)) return fail('HOST_NOT_ALLOWED', 'Strava 返回了未获准的服务地址，已停止。')
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 15000)
  try {
    const result = await deps.fetch(url, { ...init, redirect: 'manual', signal: controller.signal })
    if (result.status >= 300 && result.status < 400) { await result.body?.cancel(); return fail('UPSTREAM_REDIRECT', 'Strava 接口发生未预期的跳转，已停止。') }
    return { status: result.status, ok: result.ok, headers: result.headers, text: await limitedText(result) }
  } catch (error) {
    if (error instanceof StravaError) throw error
    if (controller.signal.aborted || (error instanceof Error && /AbortError|TimeoutError/.test(error.name))) return fail('TIMEOUT', 'Strava 请求超时，请稍后重试。', 504)
    return fail('UPSTREAM', '暂时无法连接 Strava，请稍后重试。')
  } finally { clearTimeout(timer) }
}
function parsed(text: string) { try { return record(JSON.parse(text)) } catch { return null } }
async function discover(deps: StravaMcpDeps): Promise<Metadata> {
  const prm = await http(deps, PRM, { headers: { accept: 'application/json' } }), resource = parsed(prm.text)
  if (!prm.ok || resource?.resource !== RESOURCE || !Array.isArray(resource.authorization_servers) || resource.authorization_servers.length !== 1 || resource.authorization_servers[0] !== AUTHORITY) return fail('BAD_METADATA', 'Strava 官方资源元数据无法确认。')
  const as = await http(deps, ASM, { headers: { accept: 'application/json' } }), metadata = parsed(as.text)
  // The publicly advertised issuer alias /mcp-issuer currently returns the canonical root issuer.
  if (!as.ok || !metadata || !['https://www.strava.com', AUTHORITY].includes(String(metadata.issuer))) return fail('ISSUER_MISMATCH', 'Strava 授权服务器信息不一致。')
  for (const [name, suffix] of [['authorization_endpoint', 'authorize'], ['token_endpoint', 'token'], ['registration_endpoint', 'register_client']] as const) if (metadata[name] !== OAUTH + suffix) return fail('HOST_NOT_ALLOWED', 'Strava 授权元数据中的地址尚未获准。')
  if (metadata.revocation_endpoint != null && metadata.revocation_endpoint !== OAUTH + 'revoke') return fail('HOST_NOT_ALLOWED', 'Strava 撤销授权地址尚未获准。')
  if (Array.isArray(metadata.code_challenge_methods_supported) && !metadata.code_challenge_methods_supported.includes('S256')) return fail('PKCE_UNSUPPORTED', 'Strava 暂未提供本连接所需的安全授权方式。')
  if (Array.isArray(metadata.response_types_supported) && !metadata.response_types_supported.includes('code')) return fail('BAD_METADATA', 'Strava 暂不支持授权码连接。')
  return { resource: RESOURCE, authorize: OAUTH + 'authorize', token: OAUTH + 'token', register: OAUTH + 'register_client', revoke: metadata.revocation_endpoint ? OAUTH + 'revoke' : null, authMethods: Array.isArray(metadata.token_endpoint_auth_methods_supported) ? metadata.token_endpoint_auth_methods_supported.filter((item): item is string => typeof item === 'string') : null }
}
async function register(deps: StravaMcpDeps, metadata: Metadata, redirectUri: string, owner: string): Promise<RegisteredClient> {
  const supported = metadata.authMethods
  const requested = (['client_secret_basic', 'client_secret_post', 'none'] as AuthMethod[]).find(method => !supported || supported.includes(method))
  if (!requested) return fail('CLIENT_AUTH_UNSUPPORTED', 'Strava 返回的客户端认证方式尚未支持。')
  const response = await http(deps, metadata.register, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ client_name: 'Fangkun Personal MCP', redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: requested, scope: SCOPE }) })
  const body = parsed(response.text), method = body?.token_endpoint_auth_method ?? 'client_secret_basic' // RFC 7591 default.
  if (!response.ok || !body || !textValue(body.client_id, 512)) return fail('REGISTER_FAILED', 'Strava 未接受本客户端注册，请检查个人 MCP 接入条件。')
  if (!['client_secret_basic', 'client_secret_post', 'none'].includes(String(method)) || (supported && !supported.includes(String(method)))) return fail('CLIENT_AUTH_UNSUPPORTED', 'Strava 返回的客户端认证方式尚未支持。')
  if (method !== 'none' && !textValue(body.client_secret, 1024)) return fail('CLIENT_SECRET_REQUIRED', 'Strava 未返回此认证方式所需的客户端凭证。')
  if (body.redirect_uris != null && (!Array.isArray(body.redirect_uris) || body.redirect_uris.length !== 1 || body.redirect_uris[0] !== redirectUri)) return fail('REDIRECT_MISMATCH', 'Strava 注册回跳地址与本应用不一致。')
  const expires = body.client_secret_expires_at
  if (expires != null && (typeof expires !== 'number' || !Number.isFinite(expires) || expires < 0 || (expires > 0 && expires * 1000 <= nowOf(deps)))) return fail('CLIENT_SECRET_REQUIRED', 'Strava 返回的客户端凭证已过期或到期时间无法确认。')
  return { id: body.client_id, secret: method === 'none' ? null : body.client_secret as string, method: method as AuthMethod, secretExpiresAt: typeof expires === 'number' && expires > 0 ? expires * 1000 : null, redirect: redirectUri, owner, at: nowOf(deps) }
}
function clientAuth(client: RegisteredClient, body: Record<string, string>) {
  const form = new URLSearchParams(body), headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }
  if (client.method === 'client_secret_basic' && client.secret) {
    const encoded = (value: string) => new URLSearchParams({ v: value }).toString().slice(2)
    headers.authorization = 'Basic ' + btoa(encoded(client.id) + ':' + encoded(client.secret))
  } else if (client.method === 'client_secret_post' && client.secret) { form.set('client_id', client.id); form.set('client_secret', client.secret) }
  else if (client.method === 'none') form.set('client_id', client.id)
  else return fail('CLIENT_AUTH_UNSUPPORTED', 'Strava 客户端认证信息已失效，请重新连接。', 401)
  return { headers, body: form }
}
async function exchange(deps: StravaMcpDeps, metadata: Metadata, client: RegisteredClient, form: Record<string, string>) {
  const response = await http(deps, metadata.token, { method: 'POST', ...clientAuth(client, { ...form, resource: metadata.resource }) }), body = parsed(response.text)
  if (!response.ok && body?.error === 'invalid_client') return fail('CLIENT_AUTH_EXPIRED', 'Strava 客户端凭证已失效，请重新连接。', 401)
  if (response.status === 400 || response.status === 401 || response.status === 403) return fail('REAUTHORIZE', 'Strava 授权已失效，请重新连接。', 401)
  if (!response.ok || !body || !textValue(body.access_token) || typeof body.token_type !== 'string' || body.token_type.toLowerCase() !== 'bearer') return fail('TOKEN_FAILED', 'Strava 未返回可验证的访问凭证。')
  const seconds = Number(body.expires_in)
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > SESSION_MS / 1000) return fail('TOKEN_FAILED', 'Strava 未返回有效的凭证到期时间。')
  return { access: body.access_token, refresh: textValue(body.refresh_token) ? body.refresh_token : null, expiresAt: nowOf(deps) + seconds * 1000 }
}
async function revokeGrant(deps: StravaMcpDeps, auth: Auth): Promise<boolean> {
  if (!auth.md.revoke) return false
  try { return (await http(deps, auth.md.revoke, { method: 'POST', ...clientAuth(auth.client, { token: auth.refresh ?? auth.access, token_type_hint: auth.refresh ? 'refresh_token' : 'access_token' }) })).ok } catch { return false }
}
async function discardLateGrant(deps: StravaMcpDeps, auth: Auth): Promise<never> {
  revokedSessions.set(auth.id, nowOf(deps) + SESSION_MS)
  const revoked = await revokeGrant(deps, auth)
  return fail('NOT_CONNECTED', revoked ? 'Strava 连接已断开，迟到的凭证已撤销。' : '本机连接已断开；请到 Strava 的 My Apps 确认并撤销授权。', 401)
}
async function refresh(deps: StravaMcpDeps, auth: Auth, force = false) {
  assertActive(auth, deps)
  if (!force && auth.expiresAt > nowOf(deps) + 60000) return false
  if (!auth.refresh) return fail('REAUTHORIZE', 'Strava 授权已过期，请重新连接。', 401)
  const next = await exchange(deps, auth.md, auth.client, { grant_type: 'refresh_token', refresh_token: auth.refresh })
  auth.access = next.access; auth.refresh = next.refresh ?? auth.refresh; auth.expiresAt = next.expiresAt
  if (inactive(auth, nowOf(deps))) return discardLateGrant(deps, auth)
  return true
}
async function capabilities(deps: StravaMcpDeps, auth: Auth) {
  let session: string | null = null, sequence = 0, protocol = '2025-06-18'
  let refreshed = await refresh(deps, auth)
  const post = async (message: unknown, retry = true): Promise<Awaited<ReturnType<typeof http>>> => {
    assertActive(auth, deps)
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + auth.access, 'mcp-protocol-version': protocol }
    if (session) headers['mcp-session-id'] = session
    const response = await http(deps, RESOURCE, { method: 'POST', headers, body: JSON.stringify(message) })
    assertActive(auth, deps)
    if (response.status === 401 && retry) { refreshed = await refresh(deps, auth, true) || refreshed; return post(message, false) }
    if (response.status === 401 || response.status === 403) return fail('REAUTHORIZE', 'Strava 授权或订阅状态需要重新核验。', 401)
    if (response.status === 429) return fail('RATE_LIMITED', 'Strava 请求过于频繁，请稍后重试。', 429)
    if (!response.ok) return fail('UPSTREAM', 'Strava MCP 暂时不可用。')
    const sessionId = response.headers.get('mcp-session-id')
    if (sessionId && textValue(sessionId, 512)) session = sessionId
    return response
  }
  const rpc = async (method: 'initialize' | 'tools/list', params: Record<string, unknown>) => {
    const id = ++sequence, response = await post({ jsonrpc: '2.0', id, method, params })
    const messages = response.headers.get('content-type')?.includes('event-stream')
      ? response.text.replace(/\r\n/g, '\n').split('\n\n').flatMap(event => { const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'); return data ? [parsed(data)] : [] })
      : [parsed(response.text)]
    const message = messages.find(value => value?.jsonrpc === '2.0' && value.id === id)
    if (!message) return fail('BAD_RESPONSE', 'Strava MCP 未返回匹配的响应。')
    if (message.error) return fail('MCP_ERROR', 'Strava MCP 未能完成能力核验。')
    return record(message.result) ?? fail('BAD_RESPONSE', 'Strava MCP 返回的能力信息无法确认。')
  }
  const initialized = await rpc('initialize', { protocolVersion: protocol, capabilities: {}, clientInfo: { name: 'fangkun-personal', version: '89.10.7' } })
  if (!['2025-06-18', '2025-03-26'].includes(String(initialized.protocolVersion))) return fail('PROTOCOL_UNSUPPORTED', 'Strava MCP 返回的协议版本尚未验证。')
  protocol = String(initialized.protocolVersion)
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' })
  const tools = new Map<string, Tool>(), seen = new Set<string>(); let cursor: string | undefined, truncated = false
  for (let page = 0; page < 5; page++) {
    const list = await rpc('tools/list', cursor ? { cursor } : {})
    if (!Array.isArray(list.tools)) return fail('BAD_RESPONSE', 'Strava MCP 没有返回可验证的工具列表。')
    for (const value of list.tools) {
      const tool = record(value), annotations = record(tool?.annotations)
      if (!tool || !textValue(tool.name, 256)) return fail('BAD_RESPONSE', 'Strava MCP 返回了无法确认的工具名称。')
      if (tools.size >= 500) { truncated = true; break }
      tools.set(tool.name, { name: tool.name, readOnlyHint: typeof annotations?.readOnlyHint === 'boolean' ? annotations.readOnlyHint : null })
    }
    if (list.nextCursor == null) break
    if (!textValue(list.nextCursor, 2048)) return fail('BAD_RESPONSE', 'Strava MCP 的分页信息无法确认。')
    cursor = list.nextCursor
    if (seen.has(cursor) || page === 4 || truncated) { truncated = true; break }
    seen.add(cursor)
  }
  return { tools: [...tools.values()], truncated, refreshed }
}

export async function handleStravaMcp(req: Request, path: string, deps: StravaMcpDeps): Promise<Response> {
  const url = new URL(req.url), now = nowOf(deps), config = setup(deps)
  let pendingIsCurrent = () => false
  try {
    const methods: Record<string, string> = { status: 'GET', unlock: 'POST', start: 'GET', callback: 'GET', capabilities: 'GET', disconnect: 'POST' }
    if (!methods[path]) return json({ ok: false, error: 'NOT_FOUND' }, 404)
    if (req.method !== methods[path]) return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405)
    if (!config) return path === 'status' ? json({ configured: false, connected: false, accountRef: null, reason: 'PERSONAL_SETUP_REQUIRED', dataImported: false, notice: NOTICE }) : path === 'callback' ? callbackResult('personal_setup_required') : json({ ok: false, error: 'PERSONAL_SETUP_REQUIRED', message: '尚未配置个人 Strava MCP 连接。' }, 503)
    if (path !== 'callback') sameOrigin(req)
    const owner = url.searchParams.get('athlete')
    if (path !== 'callback' && owner !== config.owner) return path === 'status' ? json({ configured: true, connected: false, accountRef: null, reason: 'OWNER_MISMATCH', dataImported: false }) : json({ ok: false, error: 'OWNER_MISMATCH', message: '此连接只允许部署时指定的个人档案。' }, 403)
    if (path === 'unlock') {
      if (!/^application\/json(?:;|$)/i.test(req.headers.get('content-type') ?? '')) return fail('BAD_REQUEST', '接入码请求格式不正确。', 415)
      if (Number(req.headers.get('content-length') ?? 0) > 5000) return fail('BAD_REQUEST', '接入码请求格式不正确。', 400)
      const raw = await limitedText(req, 5000, true)
      const accessKey = parsed(raw)?.accessKey
      if (typeof accessKey !== 'string' || accessKey.length > 4096 || !await constantEqual(accessKey, config.accessKey)) return fail('PERSONAL_ACCESS_REQUIRED', '个人接入码不正确。', 401)
      const access: Access = { v: 1, owner: config.owner, origin: url.origin, nonce: random(), at: now }
      return json({ ok: true, expiresIn: ACCESS_MS / 1000 }, 200, [cookie(ACCESS, await seal(config, access), ACCESS_MS / 1000)])
    }
    const access = await readAccess(req, config, now)
    const accessGeneration = access ? generation(access.nonce, nowOf(deps)) : 0
    if (path === 'callback') {
      const pending = await unseal<Pending>(config, readCookie(req, PENDING))
      if (!access || !pending || pending.v !== 1 || pending.owner !== config.owner || pending.origin !== url.origin || pending.accessNonce !== access.nonce || pending.generation !== generation(access.nonce, nowOf(deps)) || !within(pending.at, now, PENDING_MS) || pending.client.redirect !== url.origin + BASE + '/callback' || !textValue(pending.state, 128) || pending.state !== url.searchParams.get('state') || (activePending(access.nonce, nowOf(deps)) !== null && activePending(access.nonce, nowOf(deps)) !== pending.state) || !consume(pending.state, now)) return callbackResult('state')
      // A cold instance can establish this marker from its authenticated cookie;
      // this still is not a shared, distributed pending-state ledger.
      if (activePending(access.nonce, nowOf(deps)) === null) rememberPending(access.nonce, pending.state, nowOf(deps))
      pendingIsCurrent = () => generation(access.nonce, nowOf(deps)) === pending.generation && activePending(access.nonce, nowOf(deps)) === pending.state
      if (url.searchParams.has('error')) return callbackResult('denied', [], pendingIsCurrent())
      const code = url.searchParams.get('code'); if (!textValue(code, 4096)) return callbackResult('code', [], pendingIsCurrent())
      const job: GrantJob = { auth: null }, finish = track(callbackJobs, access.nonce, job)
      try {
        const token = await exchange(deps, pending.md, pending.client, { grant_type: 'authorization_code', code, code_verifier: pending.verifier, redirect_uri: pending.client.redirect })
        const auth: Auth = { v: 1, id: random(), accessNonce: access.nonce, generation: pending.generation, owner: config.owner, origin: url.origin, at: now, ...token, md: pending.md, client: pending.client }
        job.auth = auth
        if (inactive(auth, nowOf(deps)) || !pendingIsCurrent()) return await discardLateGrant(deps, auth)
        const sealed = await seal(config, auth)
        if (inactive(auth, nowOf(deps)) || !pendingIsCurrent()) return await discardLateGrant(deps, auth)
        return callbackResult('ok', tokenCookies(sealed), true)
      } finally { finish() }
    }
    if (!access) return path === 'status' ? json({ configured: true, connected: false, accountRef: null, reason: 'PERSONAL_ACCESS_REQUIRED', dataImported: false, notice: NOTICE }) : fail('PERSONAL_ACCESS_REQUIRED', '请先输入个人接入码。', 401)
    const auth = await readAuth(req, config, now)
    if (path === 'status') {
      const valid = !!auth && (auth.expiresAt > now || !!auth.refresh)
      return json({ configured: true, connected: valid, accountRef: null, ...(valid ? { connectionBasis: 'saved_authorization' } : { reason: auth ? 'REAUTHORIZE' : 'NOT_CONNECTED' }), dataImported: false, notice: NOTICE })
    }
    if (path === 'start') {
      const state = random()
      rememberPending(access.nonce, state, nowOf(deps))
      const metadata = await discover(deps), redirectUri = url.origin + BASE + '/callback'
      let client = await unseal<RegisteredClient>(config, readCookie(req, CLIENT))
      if (!client || client.owner !== config.owner || client.redirect !== redirectUri || !within(client.at, now, SESSION_MS) || (client.secretExpiresAt != null && client.secretExpiresAt <= now + 60_000) || (metadata.authMethods && !metadata.authMethods.includes(client.method))) client = await register(deps, metadata, redirectUri, config.owner)
      const verifier = random(48), pending: Pending = { v: 1, state, verifier, accessNonce: access.nonce, generation: accessGeneration, owner: config.owner, origin: url.origin, at: now, md: metadata, client }
      const clientValue = await seal(config, client); if (clientValue.length > CHUNK) return fail('CLIENT_TOO_LARGE', 'Strava 客户端凭证过大，无法安全保存。')
      const query = new URLSearchParams({ response_type: 'code', client_id: client.id, redirect_uri: redirectUri, scope: SCOPE, state, code_challenge: b64url(await digest(verifier)), code_challenge_method: 'S256', resource: RESOURCE })
      const pendingValue = await seal(config, pending)
      if (generation(access.nonce, nowOf(deps)) !== accessGeneration || activePending(access.nonce, nowOf(deps)) !== state) return fail('NOT_CONNECTED', '连接请求已取消，请重新发起。', 401)
      return redirect(metadata.authorize + '?' + query, [cookie(CLIENT, clientValue, SESSION_MS / 1000), cookie(PENDING, pendingValue, PENDING_MS / 1000)])
    }
    if (path === 'disconnect') {
      cancelGeneration(access.nonce, nowOf(deps))
      const callbacks = [...(callbackJobs.get(access.nonce) ?? [])], reads = auth ? [...(capabilityJobs.get(auth.id) ?? [])] : []
      const grants = new Map<string, Auth>()
      for (const grant of [auth, ...callbacks.map(job => job.auth), ...reads.map(job => job.auth)]) if (grant) {
        revokedSessions.set(grant.id, nowOf(deps) + SESSION_MS)
        grants.set(grant.id + ':' + (grant.refresh ?? grant.access), { ...grant })
      }
      // An exchange may still return a rotated credential. Its job will revoke it
      // before any RPC/cookie; until then this response must not claim final revocation.
      let revoked = !callbacks.length && !reads.length && !readCookie(req, PENDING)
      for (const grant of grants.values()) if (!await revokeGrant(deps, grant)) revoked = false
      return json({ ok: true, revoked, dataImported: false, message: revoked ? '已断开 Strava 个人 MCP。' : '本机连接凭证已删除；请到 Strava 的 My Apps 确认并撤销授权。' }, 200, [cookie(PENDING, '', 0), ...tokenCookies(null)])
    }
    if (!auth) return fail('NOT_CONNECTED', '请先连接 Strava 个人 MCP。', 401)
    const finish = track(capabilityJobs, auth.id, { auth })
    try {
      const result = await capabilities(deps, auth)
      assertActive(auth, deps)
      const sealed = result.refreshed ? await seal(config, auth) : null
      assertActive(auth, deps)
      return json({ ok: true, connected: true, accountRef: null, tools: result.tools, truncated: result.truncated, readOnly: true, dataImported: false, notice: NOTICE, fetchedAt: new Date(nowOf(deps)).toISOString() }, 200, sealed ? tokenCookies(sealed) : [])
    } finally { finish() }
  } catch (error) {
    const known = error instanceof StravaError ? error : new StravaError('INTERNAL', 'Strava 连接暂时无法完成。')
    const clearClient = known.code === 'CLIENT_AUTH_EXPIRED' ? [cookie(CLIENT, '', 0), ...tokenCookies(null)] : []
    if (path === 'callback') { const current = pendingIsCurrent(); return callbackResult(known.code.toLowerCase(), current ? clearClient : [], current) }
    return json({ ok: false, error: known.code, message: known.message, dataImported: false }, known.status, known.code === 'REAUTHORIZE' || known.code === 'NOT_CONNECTED' ? tokenCookies(null) : clearClient)
  }
}
