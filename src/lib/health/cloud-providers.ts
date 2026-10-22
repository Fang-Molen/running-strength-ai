/** Server-only fixed-host integrations. Credentials never leave the caller's encrypted session. */
import type { CloudProvider, CloudPreview } from './cloud-types'
import { parsePolarExercises, parsePolarDaily, parsePolarNights, parsePolarRecharge, parseSuuntoWorkouts, parseSuuntoSteps, parseSuuntoSleep, type ParsedCloudData } from './cloud-parse.ts'

export type ActiveCloudProvider = Exclude<CloudProvider, 'huawei'>
export type CloudGrant = { access: string; refresh: string | null; expiresAt: number | null; vendorId: string; accountRef: string }
export type ProviderDeps = { fetch: typeof fetch; env: Record<string, string | undefined>; now?: () => number; deadlineAt?: number }
export class CloudFault extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, status = 502) { super(code); this.name = 'CloudFault'; this.code = code; this.status = status }
}
const POLAR_API = 'https://www.polaraccesslink.com', SUUNTO_API = 'https://cloudapi.suunto.com', SUUNTO_AUTH = 'https://cloudapi-oauth.suunto.com'
const ALLOWED_HOSTS = new Set(['www.polaraccesslink.com', 'polarremote.com', 'cloudapi.suunto.com', 'cloudapi-oauth.suunto.com'])
const MAX_BODY_BYTES = 2 * 1024 * 1024
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const now = (deps: ProviderDeps) => (deps.now ?? Date.now)()
const secret = (v: unknown, max = 12000): string | null => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\r\n\0]/.test(v) ? v : null
const base64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))
function creds(provider: ActiveCloudProvider, env: ProviderDeps['env']) {
  const prefix = provider.toUpperCase(), clientId = secret(env[`${prefix}_CLIENT_ID`]), clientSecret = secret(env[`${prefix}_CLIENT_SECRET`])
  if (!clientId || !clientSecret) throw new CloudFault('NOT_CONFIGURED', 503)
  return { clientId, clientSecret }
}
export function providerConfigured(provider: CloudProvider, env: ProviderDeps['env']): boolean {
  if (provider === 'huawei') return false
  try { creds(provider, env); return provider !== 'suunto' || !!secret(env.SUUNTO_SUBSCRIPTION_KEY) } catch { return false }
}
export function authorizationUrl(provider: ActiveCloudProvider, env: ProviderDeps['env'], callback: string, state: string): string {
  const { clientId } = creds(provider, env)
  const query = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: callback, state })
  if (provider === 'polar') query.set('scope', 'accesslink.read_all')
  // Neither provider's published confidential-client flow documents PKCE support; no invented claim is made.
  return (provider === 'polar' ? 'https://flow.polar.com/oauth2/authorization' : `${SUUNTO_AUTH}/oauth/authorize`) + '?' + query
}
async function boundedBody(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) throw new CloudFault('UPSTREAM_TOO_LARGE')
  if (!response.body) return ''
  const reader = response.body.getReader(), decoder = new TextDecoder(); let bytes = 0, text = ''
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > MAX_BODY_BYTES) { await reader.cancel(); throw new CloudFault('UPSTREAM_TOO_LARGE') }; text += decoder.decode(value, { stream: true }) }
    return text + decoder.decode()
  } finally { reader.releaseLock() }
}
async function upstream(deps: ProviderDeps, address: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(address)
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname) || url.port || url.username || url.password) throw new CloudFault('UPSTREAM_HOST', 500)
  const remaining = (deps.deadlineAt ?? Infinity) - now(deps)
  if (remaining <= 0) throw new CloudFault('UPSTREAM_TIMEOUT', 504)
  let response: Response
  const signal = AbortSignal.timeout(Math.max(1, Math.min(15000, Math.floor(remaining))))
  try { response = await deps.fetch(url.toString(), { ...init, redirect: 'manual', signal }) }
  catch { throw new CloudFault(signal.aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE', signal.aborted ? 504 : 502) }
  if (response.status >= 300 && response.status < 400) throw new CloudFault('UPSTREAM_REDIRECT')
  return response
}
function checkResponse(response: Response) {
  if (response.ok) return
  if (response.status === 401) throw new CloudFault('REAUTHORIZE', 401)
  if (response.status === 403) throw new CloudFault('SCOPE_REQUIRED', 403)
  if (response.status === 404) throw new CloudFault('DATA_UNAVAILABLE', 404)
  if (response.status === 429) throw new CloudFault('RATE_LIMITED', 429)
  throw new CloudFault('UPSTREAM_UNAVAILABLE')
}
async function jsonBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null
  const body = await boundedBody(response)
  try { return JSON.parse(body) } catch { throw new CloudFault('UPSTREAM_FORMAT') }
}
async function getData(deps: ProviderDeps, provider: ActiveCloudProvider, grant: CloudGrant, path: string): Promise<unknown> {
  const headers: Record<string, string> = { accept: 'application/json', authorization: `Bearer ${grant.access}` }
  if (provider === 'suunto') headers['Ocp-Apim-Subscription-Key'] = deps.env.SUUNTO_SUBSCRIPTION_KEY!
  const response = await upstream(deps, (provider === 'polar' ? POLAR_API : SUUNTO_API) + path, { headers })
  checkResponse(response)
  return jsonBody(response)
}
async function accountReference(provider: ActiveCloudProvider, id: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`fangkun-watch-cloud-account-v1:${provider}:${id}`))
  return Array.from(new Uint8Array(bytes)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32)
}
function jwtClaims(token: string): Record<string, unknown> {
  try { const payload = token.split('.')[1]; if (!payload || payload.length > 10000) return {}; return object(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))))) } catch { return {} }
}
async function tokenRequest(deps: ProviderDeps, provider: ActiveCloudProvider, fields: Record<string, string>): Promise<Record<string, unknown>> {
  const { clientId, clientSecret } = creds(provider, deps.env)
  const response = await upstream(deps, provider === 'polar' ? 'https://polarremote.com/v2/oauth2/token' : `${SUUNTO_AUTH}/oauth/token`, {
    method: 'POST', headers: { authorization: `Basic ${base64(`${clientId}:${clientSecret}`)}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams(fields).toString(),
  })
  if (response.status === 400 || response.status === 401) throw new CloudFault('REAUTHORIZE', 401)
  checkResponse(response)
  const data = object(await jsonBody(response))
  if (!secret(data.access_token) || (data.token_type !== undefined && String(data.token_type).toLowerCase() !== 'bearer')) throw new CloudFault('UPSTREAM_FORMAT')
  return data
}
async function suuntoGrant(token: Record<string, unknown>, deps: ProviderDeps, previous?: CloudGrant): Promise<CloudGrant> {
  const access = secret(token.access_token)!, claims = jwtClaims(access)
  // Claims are read only from the authenticated TLS token endpoint response, never from client input.
  const vendorId = secret(claims.user, 256)
  if (!vendorId) throw new CloudFault('ACCOUNT_UNVERIFIED')
  const accountRef = await accountReference('suunto', vendorId)
  if (previous && accountRef !== previous.accountRef) throw new CloudFault('ACCOUNT_UNVERIFIED')
  const duration = typeof token.expires_in === 'number' && Number.isFinite(token.expires_in) && token.expires_in > 0 ? token.expires_in : null
  const expiresAt = duration !== null ? now(deps) + Math.min(duration, 366 * 86400) * 1000 : typeof claims.exp === 'number' && Number.isFinite(claims.exp) ? claims.exp * 1000 : null
  if (expiresAt === null || expiresAt <= now(deps)) throw new CloudFault('UPSTREAM_FORMAT')
  return { access, refresh: secret(token.refresh_token) ?? previous?.refresh ?? null, expiresAt, vendorId, accountRef }
}
export async function exchangeGrant(deps: ProviderDeps, provider: ActiveCloudProvider, code: string, callback: string): Promise<CloudGrant> {
  const token = await tokenRequest(deps, provider, { grant_type: 'authorization_code', code, redirect_uri: callback })
  if (provider === 'suunto') return suuntoGrant(token, deps)
  const uid = token.x_user_id
  const vendorId = typeof uid === 'number' && Number.isSafeInteger(uid) && uid > 0 ? String(uid) : typeof uid === 'string' && /^[1-9]\d{0,19}$/.test(uid) ? uid : null
  if (!vendorId) throw new CloudFault('ACCOUNT_UNVERIFIED')
  const access = secret(token.access_token)!, accountRef = await accountReference('polar', vendorId)
  const headers = { authorization: `Bearer ${access}`, accept: 'application/json', 'content-type': 'application/json' }
  let response = await upstream(deps, `${POLAR_API}/v3/users`, { method: 'POST', headers, body: JSON.stringify({ 'member-id': `fangkun-${accountRef}` }) })
  // A repeated member-id is not proof of ownership. Verify the token's user endpoint on 409.
  if (response.status === 409) response = await upstream(deps, `${POLAR_API}/v3/users/${vendorId}`, { headers })
  checkResponse(response)
  const profile = object(await jsonBody(response))
  if (String(profile['polar-user-id'] ?? '') !== vendorId) throw new CloudFault('ACCOUNT_UNVERIFIED')
  // AccessLink states access tokens do not expire until revoked, despite its sample expires_in field.
  return { access, refresh: null, expiresAt: null, vendorId, accountRef }
}
export async function refreshGrant(deps: ProviderDeps, provider: ActiveCloudProvider, grant: CloudGrant): Promise<CloudGrant> {
  if (provider !== 'suunto' || !grant.refresh) throw new CloudFault('REAUTHORIZE', 401)
  const token = await tokenRequest(deps, provider, { grant_type: 'refresh_token', refresh_token: grant.refresh })
  return suuntoGrant(token, deps, grant)
}
export async function revokeGrant(deps: ProviderDeps, provider: ActiveCloudProvider, grant: CloudGrant): Promise<boolean> {
  const address = provider === 'polar' ? `${POLAR_API}/v3/users/${encodeURIComponent(grant.vendorId)}` : `${SUUNTO_AUTH}/oauth/deauthorize?client_id=${encodeURIComponent(creds(provider, deps.env).clientId)}`
  const response = await upstream(deps, address, { method: provider === 'polar' ? 'DELETE' : 'GET', headers: { authorization: `Bearer ${grant.access}`, accept: 'application/json' } })
  return response.ok || response.status === 401 || response.status === 404
}

type Part = { parsed: ParsedCloudData; problem?: string }
async function optionalPart(deps: ProviderDeps, provider: ActiveCloudProvider, grant: CloudGrant, path: string, label: string, parser: (value: unknown, account: string, at: string) => ParsedCloudData, at: string): Promise<Part> {
  try { const value = await getData(deps, provider, grant, path); return { parsed: parser(value ?? (provider === 'polar' && path.includes('sleep') ? { nights: [] } : provider === 'polar' && path.includes('nightly') ? { recharges: [] } : []), grant.accountRef, at) } }
  catch (error) { if (error instanceof CloudFault && error.code === 'REAUTHORIZE') throw error; const code = error instanceof CloudFault ? error.code : 'UPSTREAM_UNAVAILABLE'; return { parsed: { activities: [], health: [], issues: [] }, problem: `${label}本次未读取（${code}），其他已核实数据仍可核对。` } }
}
async function suuntoWorkouts(deps: ProviderDeps, grant: CloudGrant, at: string, from: number, until: number): Promise<ParsedCloudData> {
  const result: ParsedCloudData = { activities: [], health: [], issues: [] }, seen = new Set<string>()
  for (let page = 0; page < 5; page++) {
    const query = new URLSearchParams({ since: String(from), until: String(until), limit: '100', offset: String(page * 100), 'filter-by-modification-time': 'false' })
    let body: unknown
    try { body = await getData(deps, 'suunto', grant, `/v3/workouts?${query}`) }
    catch (error) {
      if (page === 0 || error instanceof CloudFault && error.code === 'REAUTHORIZE') throw error
      result.issues.push(`Suunto 后续训练分页未完成（${error instanceof CloudFault ? error.code : 'UPSTREAM_UNAVAILABLE'}），已读取记录仍可核对。`)
      break
    }
    const payload = object(body).payload
    if (Array.isArray(payload) && payload.length > 100) result.issues.push('Suunto 返回超过请求的分页大小，本页只保留前100条。')
    const parsed = parseSuuntoWorkouts(Array.isArray(payload) && payload.length > 100 ? { ...object(body), payload: payload.slice(0, 100) } : body, grant.accountRef, at)
    result.issues.push(...parsed.issues)
    for (const a of parsed.activities) if (!seen.has(a.key)) { seen.add(a.key); result.activities.push(a) }
    if (!Array.isArray(payload) || payload.length < 100) break
    if (page === 4) result.issues.push('近28天训练超过500条，已达到本次分页上限。')
  }
  return result
}
export async function readProviderPreview(deps: ProviderDeps, provider: ActiveCloudProvider, grant: CloudGrant): Promise<CloudPreview> {
  const until = now(deps), from = until - 28 * 86400_000, at = new Date(until).toISOString()
  const result: CloudPreview = { provider, accountRef: grant.accountRef, fetchedAt: at, activities: [], health: [], issues: [], partial: false }
  let mandatory: Promise<ParsedCloudData>, optional: Promise<Part>[]
  if (provider === 'polar') {
    mandatory = getData(deps, provider, grant, '/v3/exercises').then(data => parsePolarExercises(data ?? [], grant.accountRef, at))
    const fromDay = new Date(until - 27 * 86400_000).toISOString().slice(0, 10), toDay = at.slice(0, 10)
    optional = [
      optionalPart(deps, provider, grant, `/v3/users/activities?from=${fromDay}&to=${toDay}`, 'Polar 每日步数', parsePolarDaily, at),
      optionalPart(deps, provider, grant, '/v3/users/sleep', 'Polar 睡眠', parsePolarNights, at),
      optionalPart(deps, provider, grant, '/v3/users/nightly-recharge', 'Polar Nightly Recharge', parsePolarRecharge, at),
    ]
  } else {
    mandatory = suuntoWorkouts(deps, grant, at, from, until)
    const dates = new URLSearchParams({ startdate: new Date(from).toISOString(), enddate: at }), milliseconds = new URLSearchParams({ from: String(from), to: String(until) })
    optional = [
      optionalPart(deps, provider, grant, `/247/daily-activity-statistics?${dates}`, 'Suunto 每日步数', parseSuuntoSteps, at),
      optionalPart(deps, provider, grant, `/247samples/sleep?${milliseconds}`, 'Suunto 睡眠', parseSuuntoSleep, at),
    ]
  }
  // All branches settle before a response; no discarded rejection or background user-data read.
  const settled = await Promise.allSettled([mandatory, ...optional])
  for (const part of settled) if (part.status === 'rejected' && part.reason instanceof CloudFault && part.reason.code === 'REAUTHORIZE') throw part.reason
  if (settled[0].status === 'rejected') throw settled[0].reason
  const core = settled[0].value as ParsedCloudData
  result.activities = core.activities.filter(a => a.startIso === null || Date.parse(a.startIso) >= from && Date.parse(a.startIso) <= until)
  result.issues.push(...core.issues)
  for (const entry of settled.slice(1)) {
    if (entry.status === 'rejected') { result.issues.push('部分健康数据本次无法读取。'); continue }
    const part = entry.value as Part
    result.health.push(...part.parsed.health)
    result.issues.push(...part.parsed.issues, ...(part.problem ? [part.problem] : []))
  }
  result.issues = [...new Set(result.issues)]
  result.partial = result.issues.length > 0
  if (provider === 'polar') result.issues.push('Polar 训练仅提供与本应用完成注册后上传、且上传距今不超过30天的记录；本次筛选近28天训练。')
  return result
}
