/** v89.10：高驰官方 MCP OAuth（服务端，Cloudflare Pages Functions 调用；也可在 Node 测试里注入 fetch）。
 * - 动态客户端注册（/connect/register，token_endpoint_auth_method=none）+ PKCE S256 + resource=issuer/mcp。
 * - 先读 .well-known 元数据（mcp.coros.com 会按地区跳到 mcpus/mcpeu 等），只允许 *.coros.com 白名单主机。
 * - state+verifier、令牌（access/refresh）都用 STATE_KEY 派生的 AES-GCM 密钥加密后放 HttpOnly Secure SameSite=Lax cookie；令牌从不回传给前端 JS。
 * - 只调用只读工具；返回解析结果 + 原文片段，认不出的标“待核”。 */
import { parseDailyTool, parseLaps, parseRecovery, parseSportRecords, parseStressSeries, type HealthTool, type McpDay, type McpToolResult } from './coros-mcp-parse'

export const ALLOWED_HOSTS = new Set(['mcp.coros.com', 'mcpcn.coros.com', 'mcpeu.coros.com', 'mcpus.coros.com'])
export const ENTRY: Record<Region, string> = { auto: 'https://mcp.coros.com', cn: 'https://mcpcn.coros.com' }
export type Region = 'auto' | 'cn'
const SCOPE = 'openid mcp.tools offline_access', BASE = '/api/coros-mcp', PROTOCOL = '2025-06-18'
const READ_TOOLS = new Set(['querySportRecords', 'queryActivityLapData', 'getActivityDetail', 'querySleepOverview', 'querySleepHrv', 'queryRestingHeartRate', 'queryDailyHealthData', 'queryStressTimeSeries', 'queryRecoveryStatus'])
export type Meta = { issuer: string; resource: string; authorize: string; token: string; register: string; revoke: string | null }
export type Auth = { v: 1; md: Meta; cid: string; region: Region; access: string; refresh: string | null; expiresAt: number; ref: string | null; at: number }
export type Deps = { fetch: typeof fetch; now?: () => number; stateKey: string | undefined }
export class McpError extends Error { constructor(readonly code: string, message: string, readonly status = 502) { super(message) } }

export function allowedUrl(u: unknown): string | null {
  if (typeof u !== 'string') return null
  try { const x = new URL(u); return x.protocol === 'https:' && ALLOWED_HOSTS.has(x.hostname) && !x.port && !x.username && !x.password ? x.origin + (x.pathname === '/' ? '' : x.pathname) + x.search : null } catch { return null }
}
// ---------- crypto / cookies ----------
const enc = new TextEncoder(), dec = new TextDecoder()
const b64u = (u8: Uint8Array) => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
export const randomB64 = (n: number) => b64u(crypto.getRandomValues(new Uint8Array(n)))
export async function pkceChallenge(verifier: string) { return b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(verifier)))) }
async function aesKey(secret: string | undefined) {
  if (!secret) throw new McpError('SERVER_NOT_CONFIGURED', '服务器未配置加密密钥', 500)
  const raw = await crypto.subtle.digest('SHA-256', enc.encode('coros-mcp-v1:' + secret))
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}
export async function seal(secret: string | undefined, obj: unknown) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), enc.encode(JSON.stringify(obj)))); return b64u(iv) + '.' + b64u(ct) }
export async function unseal<T>(secret: string | undefined, s: string | null): Promise<T | null> {
  if (!s) return null
  try { const [iv, ct] = s.split('.'); return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(iv) }, await aesKey(secret), unb64u(ct)))) as T } catch (e) { if (e instanceof McpError) throw e; return null }
}
const C_PEND = 'fk_cmcp_p', C_CLIENT = 'fk_cmcp_c', C_TOK = 'fk_cmcp_t', CHUNK = 3500, MAX_CHUNKS = 4
export const cookie = (name: string, value: string, maxAge: number) => `${name}=${value}; Path=${BASE}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`
export function readCookie(req: Request, name: string) { const m = (req.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)')); return m ? m[1] : null }
function tokenCookies(sealed: string | null): string[] {
  const out: string[] = [], parts = sealed ? sealed.match(new RegExp(`.{1,${CHUNK}}`, 'g')) ?? [] : []
  if (parts.length > MAX_CHUNKS) throw new McpError('TOKEN_TOO_LARGE', '高驰返回的凭证过大，无法安全保存', 502)
  for (let i = 0; i < MAX_CHUNKS; i++) out.push(parts[i] ? cookie(C_TOK + i, parts[i], 60 * 86400) : cookie(C_TOK + i, '', 0))
  return out
}
async function readAuth(req: Request, secret: string | undefined): Promise<Auth | null> {
  let s = ''; for (let i = 0; i < MAX_CHUNKS; i++) { const v = readCookie(req, C_TOK + i); if (!v) break; s += v }
  const a = await unseal<Auth>(secret, s || null)
  return a && a.v === 1 && allowedUrl(a.md?.resource) && allowedUrl(a.md?.token) ? a : null
}
// ---------- HTTP helpers ----------
const json = (obj: unknown, status = 200, cookies: string[] = []) => { const h = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); for (const c of cookies) h.append('set-cookie', c); return new Response(JSON.stringify(obj), { status, headers: h }) }
const redirect = (to: string, cookies: string[] = []) => { const h = new Headers({ location: to, 'cache-control': 'no-store' }); for (const c of cookies) h.append('set-cookie', c); return new Response(null, { status: 302, headers: h }) }
async function safeFetch(deps: Deps, url: string, init: RequestInit = {}) {
  const u = allowedUrl(url); if (!u) throw new McpError('HOST_NOT_ALLOWED', '高驰地址不在白名单内')
  const r = await deps.fetch(u, { ...init, redirect: 'manual', signal: AbortSignal.timeout(25000) })
  if (r.status >= 300 && r.status < 400) throw new McpError('UPSTREAM_REDIRECT', '高驰接口发生跳转，已停止')
  return r
}
async function getJson(deps: Deps, url: string) { const r = await safeFetch(deps, url, { headers: { accept: 'application/json' } }); if (!r.ok) return null; try { return await r.json() as Record<string, unknown> } catch { return null } }
// ---------- discovery / registration ----------
export async function discover(deps: Deps, region: Region): Promise<Meta> {
  const entry = ENTRY[region]
  const prm = await getJson(deps, entry + '/.well-known/oauth-protected-resource/mcp').catch(() => null)
  const resource = allowedUrl(prm?.resource) ?? entry + '/mcp'
  const issuer = allowedUrl(Array.isArray(prm?.authorization_servers) ? prm!.authorization_servers[0] : null) ?? new URL(resource).origin
  const as = await getJson(deps, issuer + '/.well-known/oauth-authorization-server').catch(() => null)
  if (as && allowedUrl(as.issuer) !== allowedUrl(issuer)) throw new McpError('ISSUER_MISMATCH', '高驰授权服务器信息不一致')
  const pickUrl = (v: unknown, fallback: string) => v == null ? fallback : allowedUrl(v) ?? (() => { throw new McpError('HOST_NOT_ALLOWED', '高驰元数据里出现白名单外地址') })()
  return { issuer, resource, authorize: pickUrl(as?.authorization_endpoint, issuer + '/oauth2/authorize'), token: pickUrl(as?.token_endpoint, issuer + '/oauth2/token'),
    register: pickUrl(as?.registration_endpoint, issuer + '/connect/register'), revoke: as?.revocation_endpoint == null ? null : pickUrl(as.revocation_endpoint, '') }
}
export async function registerClient(deps: Deps, md: Meta, redirectUri: string): Promise<string> {
  const r = await safeFetch(deps, md.register, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_name: '方坤 Fangkun', redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: SCOPE }) })
  const d = await r.json().catch(() => null) as { client_id?: unknown } | null
  if (!r.ok || !d || typeof d.client_id !== 'string' || !d.client_id) throw new McpError('REGISTER_FAILED', `高驰客户端注册失败（${r.status}）`)
  return d.client_id
}
async function tokenRequest(deps: Deps, md: Meta, form: Record<string, string>) {
  const r = await safeFetch(deps, md.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams({ ...form, resource: md.resource }) })
  const d = await r.json().catch(() => null) as Record<string, unknown> | null
  if (!r.ok || !d || typeof d.access_token !== 'string') throw new McpError([400, 401].includes(r.status) ? 'REAUTHORIZE' : 'TOKEN_FAILED', [400, 401].includes(r.status) ? '高驰授权已失效，请重新授权' : `高驰换取凭证失败（${r.status}）`, [400, 401].includes(r.status) ? 401 : 502)
  const exp = Number(d.expires_in)
  return { access: d.access_token, refresh: typeof d.refresh_token === 'string' ? d.refresh_token : null, expiresIn: Number.isFinite(exp) && exp > 0 ? exp : 3600, idToken: typeof d.id_token === 'string' ? d.id_token : null }
}
/** 账号引用：id_token 的 sub（只取哈希前 16 位，不保存 sub 原文）。没有 id_token 就是 null（待核）。 */
async function accountRef(issuer: string, idToken: string | null): Promise<string | null> {
  if (!idToken) return null
  try { const p = JSON.parse(dec.decode(unb64u(idToken.split('.')[1]))); if (typeof p.sub !== 'string' || !p.sub) return null
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode('fk-coros-mcp-ref:' + new URL(issuer).host + ':' + p.sub))); return [...h.slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join('') } catch { return null }
}
async function ensureFresh(deps: Deps, a: Auth, force = false): Promise<boolean> {
  const now = (deps.now ?? Date.now)()
  if (!force && a.expiresAt > now + 60_000) return false
  if (!a.refresh) throw new McpError('REAUTHORIZE', '高驰授权已过期，请重新授权', 401)
  const t = await tokenRequest(deps, a.md, { grant_type: 'refresh_token', refresh_token: a.refresh, client_id: a.cid })
  a.access = t.access; a.refresh = t.refresh ?? a.refresh; a.expiresAt = now + t.expiresIn * 1000
  return true
}
// ---------- MCP streamable HTTP ----------
export class McpSession {
  private id = 0; private session: string | null = null; refreshed = false
  constructor(private deps: Deps, private auth: Auth) {}
  private async post(body: unknown, retry = true): Promise<Response> {
    if (await ensureFresh(this.deps, this.auth)) this.refreshed = true
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': PROTOCOL, authorization: 'Bearer ' + this.auth.access }
    if (this.session) headers['mcp-session-id'] = this.session
    const r = await safeFetch(this.deps, this.auth.md.resource, { method: 'POST', headers, body: JSON.stringify(body) })
    if (r.status === 401 && retry) { await r.arrayBuffer().catch(() => null); await ensureFresh(this.deps, this.auth, true); this.refreshed = true; return this.post(body, false) }
    if (r.status === 401 || r.status === 403) throw new McpError('REAUTHORIZE', '高驰授权已失效，请重新授权', 401)
    if (r.status === 429) throw new McpError('RATE_LIMITED', '高驰请求太频繁，请稍后再试', 429)
    if (!r.ok) throw new McpError('UPSTREAM', `高驰数据服务返回 ${r.status}`)
    this.session = r.headers.get('mcp-session-id') || this.session
    return r
  }
  async rpc(method: string, params: unknown): Promise<unknown> {
    const r = await this.post({ jsonrpc: '2.0', id: ++this.id, method, params }), text = await r.text()
    let msg: { result?: unknown; error?: { message?: string } } | null = null
    if ((r.headers.get('content-type') || '').includes('event-stream')) {
      for (const ev of text.replace(/\r\n/g, '\n').split('\n\n')) { const data = ev.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n'); if (!data) continue; try { const m = JSON.parse(data); if (m && ('result' in m || 'error' in m)) msg = m } catch { /* skip */ } }
    } else { try { msg = JSON.parse(text) } catch { msg = null } }
    if (!msg) throw new McpError('BAD_RESPONSE', '高驰没有返回有效结果')
    if (msg.error) throw new McpError('TOOL_ERROR', '高驰：' + String(msg.error.message ?? '请求失败').slice(0, 160))
    return msg.result
  }
  async init() {
    await this.rpc('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'fangkun', version: '89.10' } })
    const r = await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }); await r.arrayBuffer().catch(() => null)
  }
  async tool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    if (!READ_TOOLS.has(name)) throw new McpError('NOT_ALLOWED', '只允许只读工具', 400)
    const res = await this.rpc('tools/call', { name, arguments: args }) as McpToolResult
    if (res?.isError) throw new McpError('TOOL_ERROR', '高驰工具出错：' + (res.content ?? []).map(c => c.text ?? '').join(' ').slice(0, 160))
    return res
  }
}
// ---------- request handler ----------
const ymd8 = (s: string | null) => s && /^\d{8}$/.test(s) ? s : null
function errorResponse(e: unknown, cookies: string[] = []) {
  const err = e instanceof McpError ? e : new McpError('UPSTREAM', '高驰请求失败')
  const clear = err.code === 'REAUTHORIZE' ? tokenCookies(null) : []
  return json({ ok: false, error: err.code, message: err.message, reauthorize: err.code === 'REAUTHORIZE' }, err.status, [...cookies, ...clear])
}
export async function handleCorosMcp(req: Request, path: string, deps: Deps): Promise<Response> {
  const url = new URL(req.url), now = (deps.now ?? Date.now)(), redirectUri = url.origin + BASE + '/callback'
  try {
    if (path === 'start' && req.method === 'GET') {
      const region: Region = url.searchParams.get('region') === 'auto' ? 'auto' : 'cn'
      const md = await discover(deps, region), cookies: string[] = []
      const known = await unseal<{ iss: string; redirect: string; cid: string }>(deps.stateKey, readCookie(req, C_CLIENT + (region === 'cn' ? 'cn' : 'au')))
      let cid = known && known.iss === md.issuer && known.redirect === redirectUri ? known.cid : null
      if (!cid) { cid = await registerClient(deps, md, redirectUri); cookies.push(cookie(C_CLIENT + (region === 'cn' ? 'cn' : 'au'), await seal(deps.stateKey, { iss: md.issuer, redirect: redirectUri, cid }), 365 * 86400)) }
      const verifier = randomB64(48), state = randomB64(24)
      cookies.push(cookie(C_PEND, await seal(deps.stateKey, { state, verifier, md, cid, region, redirect: redirectUri, at: now }), 600))
      const q = new URLSearchParams({ response_type: 'code', client_id: cid, redirect_uri: redirectUri, scope: SCOPE, state, code_challenge: await pkceChallenge(verifier), code_challenge_method: 'S256', resource: md.resource })
      return redirect(md.authorize + '?' + q, cookies)
    }
    if (path === 'callback' && req.method === 'GET') {
      const back = (r: string) => redirect('/?coros_auth=' + r, [cookie(C_PEND, '', 0)])
      const p = await unseal<{ state: string; verifier: string; md: Meta; cid: string; region: Region; redirect: string; at: number }>(deps.stateKey, readCookie(req, C_PEND))
      if (url.searchParams.get('error')) return back('denied')
      if (!p || !url.searchParams.get('state') || p.state !== url.searchParams.get('state') || now - p.at > 600_000 || p.redirect !== redirectUri) return back('state')
      const code = url.searchParams.get('code'); if (!code || code.length > 2048) return back('code')
      const t = await tokenRequest(deps, p.md, { grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: p.cid, code_verifier: p.verifier })
      const auth: Auth = { v: 1, md: p.md, cid: p.cid, region: p.region, access: t.access, refresh: t.refresh, expiresAt: now + t.expiresIn * 1000, ref: await accountRef(p.md.issuer, t.idToken), at: now }
      return redirect('/?coros_auth=ok', [cookie(C_PEND, '', 0), ...tokenCookies(await seal(deps.stateKey, auth))])
    }
    if (path === 'status') {
      const a = await readAuth(req, deps.stateKey)
      return json({ ok: true, connected: !!a, region: a?.region ?? null, host: a ? new URL(a.md.resource).host : null, refBasis: a ? (a.ref ? 'account' : 'unknown') : null, renewable: !!a?.refresh, since: a?.at ?? null })
    }
    if (path === 'disconnect' && req.method === 'POST') {
      const a = await readAuth(req, deps.stateKey); let revoked = false
      if (a?.md.revoke) { try { const r = await safeFetch(deps, a.md.revoke, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: a.refresh ?? a.access, token_type_hint: a.refresh ? 'refresh_token' : 'access_token', client_id: a.cid }) }); revoked = r.ok } catch { revoked = false } }
      return json({ ok: true, revoked }, 200, tokenCookies(null))
    }
    if (req.method !== 'GET' || !['activities', 'laps', 'health'].includes(path)) return json({ ok: false, error: 'NOT_ALLOWED', message: '不支持的接口' }, 404)
    const a = await readAuth(req, deps.stateKey); if (!a) return json({ ok: false, error: 'NOT_CONNECTED', message: '还没有用高驰授权登录', reauthorize: true }, 401)
    const s = new McpSession(deps, a)
    const finish = async (body: Record<string, unknown>) => json({ ok: true, accountRef: a.ref, fetchedAt: new Date(now).toISOString(), ...body }, 200, s.refreshed ? tokenCookies(await seal(deps.stateKey, a)) : [])
    try {
      await s.init()
      if (path === 'activities') {
        const end = ymd8(url.searchParams.get('endDate')) ?? '' /* 空 = 高驰账号时区的今天（官方文档） */, start = ymd8(url.searchParams.get('startDate')) ?? ''
        const res = await s.tool('querySportRecords', { startDate: start, endDate: end, sportTypeCodes: [65535], minDistanceKm: 0, maxDistanceKm: 0, minDurationMinutes: 0, maxDurationMinutes: 0, maxAveragePace: '', locationKeyword: '', limit: 100 })
        const p = parseSportRecords(res)
        return finish({ activities: p.value, issues: p.issues, raw: p.raw, possiblyTruncated: p.value.length >= 100 })
      }
      if (path === 'laps') {
        const labelId = url.searchParams.get('labelId') ?? '', sportType = Number(url.searchParams.get('sportType'))
        if (!/^[0-9A-Za-z_-]{1,40}$/.test(labelId) || !Number.isInteger(sportType)) return json({ ok: false, error: 'BAD_REQUEST', message: '活动标识无效' }, 400)
        const p = parseLaps(await s.tool('queryActivityLapData', { labelId, sportType }))
        return finish({ laps: p.value, issues: p.issues, raw: p.raw })
      }
      // health：逐个工具调用，单个失败不影响其他；失败如实写进 issues。
      const days = new Map<string, McpDay>(), issues: string[] = [], raw: Record<string, string> = {}
      const daily: [HealthTool, Record<string, unknown>][] = [['querySleepOverview', { days: 7 }], ['querySleepHrv', { startDate: '', endDate: '', days: 7 }], ['queryRestingHeartRate', { days: 7 }], ['queryDailyHealthData', { days: 7 }]]
      for (const [name, args] of daily) { try { const r = await s.tool(name, args); raw[name] = (r.content ?? []).map(c => c.text ?? '').join('\n').slice(0, 6000); issues.push(...parseDailyTool(name, r, days)) } catch (e) { if (e instanceof McpError && e.code === 'REAUTHORIZE') throw e; issues.push(`${name}：${e instanceof Error ? e.message : '失败'}`) } }
      let stress: unknown[] = [], recovery: unknown = null
      try { const p = parseStressSeries(await s.tool('queryStressTimeSeries', { startDate: '', endDate: '', days: 2 })); stress = p.value; raw.queryStressTimeSeries = p.raw; issues.push(...p.issues) } catch (e) { if (e instanceof McpError && e.code === 'REAUTHORIZE') throw e; issues.push(`queryStressTimeSeries：${e instanceof Error ? e.message : '失败'}`) }
      try { const p = parseRecovery(await s.tool('queryRecoveryStatus', {})); recovery = p.value; raw.queryRecoveryStatus = p.raw; issues.push(...p.issues) } catch (e) { if (e instanceof McpError && e.code === 'REAUTHORIZE') throw e; issues.push(`queryRecoveryStatus：${e instanceof Error ? e.message : '失败'}`) }
      return finish({ days: [...days.values()].sort((x, y) => x.date.localeCompare(y.date)), stress, recovery, issues, raw })
    } catch (e) { return errorResponse(e, s.refreshed && !(e instanceof McpError && e.code === 'REAUTHORIZE') ? tokenCookies(await seal(deps.stateKey, a)) : []) }
  } catch (e) {
    if (path === 'callback') return redirect('/?coros_auth=' + (e instanceof McpError ? e.code.toLowerCase() : 'error'), [cookie(C_PEND, '', 0)])
    if (path === 'start') return redirect('/?coros_auth=' + (e instanceof McpError ? e.code.toLowerCase() : 'error'))
    return errorResponse(e)
  }
}
