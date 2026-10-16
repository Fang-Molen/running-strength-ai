// 佳明中转（无状态）：只转发，不存储、不记录账号密码和数据。没有任何 console.log。
const REGIONS = { com: 'garmin.com', cn: 'garmin.cn' };
const IOS_CLIENT = 'GCM_IOS_DARK';
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const WEB_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const DI_CLIENT_IDS = ['GARMIN_CONNECT_MOBILE_ANDROID_DI_2025Q2', 'GARMIN_CONNECT_MOBILE_ANDROID_DI_2024Q4', 'GARMIN_CONNECT_MOBILE_ANDROID_DI', 'GARMIN_CONNECT_MOBILE_IOS_DI'];
const DI_GRANT = 'https://connectapi.garmin.com/di-oauth2-service/oauth/grant/service_ticket';
const API_PREFIXES = ['activitylist-service/', 'activity-service/activity/', 'download-service/files/activity/', 'userprofile-service/socialProfile', 'userprofile-service/userprofile/user-settings', 'wellness-service/wellness/', 'hrv-service/hrv/', 'metrics-service/metrics/', 'usersummary-service/usersummary/daily/', 'userstats-service/wellness/daily/', 'biometric-service/', 'device-service/deviceregistration/devices', 'personalrecord-service/personalrecord/prs/', 'trainingplan-service/trainingplan/plans', 'workout-service/workouts', 'calendar-service/year/'];  // 全部只读 GET

class GErr extends Error { constructor(code, status = 400) { super(code); this.code = code; this.status = status; } }

const MSG = {
  BAD_REQUEST: '请求不完整',
  BAD_CREDENTIALS: '账号或密码不对',
  ACCOUNT_LOCKED: '账号被佳明锁定，请先在佳明官网/App 登录解锁',
  MFA_FAILED: '验证码不对或已过期',
  MFA_EXPIRED: '验证步骤已超时，请重新登录',
  RATE_LIMITED: '佳明限制了登录频率（429）。请过几个小时再试，别反复点',
  BLOCKED: '佳明拦截了这次登录（人机验证/风控）。请稍后再试，或改用导入 FIT 文件',
  TOKEN_EXPIRED: '登录已过期，请重新登录',
  UPSTREAM: '佳明服务返回异常，可能接口有变化',
  NOT_ALLOWED: '不支持的接口',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}
function fail(code, status, extra = {}) { return json({ ok: false, error: code, message: MSG[code] || code, ...extra }, status); }

function nativeHeaders(extra = {}) {
  return {
    'User-Agent': 'GCM-Android-5.23',
    'X-Garmin-User-Agent': 'com.garmin.android.apps.connectmobile/5.23; ; Google/sdk_gphone64_arm64/google; Android/33; Dalvik/2.1.0',
    'X-Garmin-Paired-App-Version': '10861', 'X-Garmin-Client-Platform': 'Android', 'X-App-Ver': '10861',
    'X-Lang': 'en', 'X-GCExperience': 'GC5', 'Accept-Language': 'en-US,en;q=0.9', ...extra,
  };
}

// ---- 极简 cookie 罐（只活在这一次请求里，或加密后交给浏览器暂存） ----
function jarFrom(res, jar = {}) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const c of list) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (i > 0) jar[kv.slice(0, i).trim()] = kv.slice(i + 1).trim(); }
  return jar;
}
const jarHeader = jar => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

async function gfetch(url, opts, jar) {
  const headers = { ...(opts.headers || {}) };
  if (jar && Object.keys(jar).length) headers.Cookie = jarHeader(jar);
  const res = await fetch(url, { ...opts, headers, redirect: 'manual' });
  if (jar) jarFrom(res, jar);
  return res;
}

// ---- MFA 中间状态：AES-GCM 加密后交给浏览器，服务器不保存 ----
async function key(env) {
  const secret = env.STATE_KEY || 'garmin-tool-fallback-key-change-me';
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const b64 = u8 => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function seal(env, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env), new TextEncoder().encode(JSON.stringify({ ...obj, t: Date.now() }))));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return b64(out);
}
async function unseal(env, s) {
  try {
    const u = unb64(s);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, await key(env), u.slice(12));
    const obj = JSON.parse(new TextDecoder().decode(pt));
    if (!obj.session && Date.now() - obj.t > 10 * 60 * 1000) throw 0;
    return obj;
  } catch { throw new GErr('MFA_EXPIRED', 400); }
}

// ---- 登录 ----
function hosts(region) {
  const d = REGIONS[region]; if (!d) throw new GErr('BAD_REQUEST');
  return { d, sso: `https://sso.${d}`, api: `https://connectapi.${d}`, di: `https://diauth.${d}/di-oauth2-service/oauth/token`, ios: `https://mobile.integration.${d}/gcm/ios` };
}

async function readJson(res) { const t = await res.text(); try { return JSON.parse(t); } catch { return { __html: t }; } }

async function mobileLogin(h, username, password, env) {
  const params = new URLSearchParams({ clientId: IOS_CLIENT, locale: 'en-US', service: h.ios });
  const headers = { 'User-Agent': IOS_UA, Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json', Origin: h.sso };
  const jar = {};
  const r = await gfetch(`${h.sso}/mobile/api/login?${params}`, { method: 'POST', headers, body: JSON.stringify({ username, password, rememberMe: true, captchaToken: '' }) }, jar);
  if (r.status === 429) throw new GErr('RATE_LIMITED', 429);
  if (r.status === 403) throw new GErr('BLOCKED', 403);
  const res = await readJson(r);
  if (res.error && String(res.error['status-code']) === '429') throw new GErr('RATE_LIMITED', 429);
  const type = res.responseStatus && res.responseStatus.type;
  if (type === 'SUCCESSFUL') return { ticket: res.serviceTicketId, service: h.ios };
  if (type === 'INVALID_USERNAME_PASSWORD') throw new GErr('BAD_CREDENTIALS', 401);
  if (type && /LOCK/i.test(type)) throw new GErr('ACCOUNT_LOCKED', 403);
  if (type === 'MFA_REQUIRED') {
    const method = (res.customerMfaInfo && res.customerMfaInfo.mfaLastMethodUsed) || 'email';
    return { mfa: { flow: 'ios', jar, method, params: params.toString() }, method };
  }
  if (type === 'CAPTCHA_REQUIRED') throw new GErr('BLOCKED', 403);
  throw new GErr('UPSTREAM', 502);
}

const CSRF_RE = /name="_csrf"\s+value="(.+?)"/;
const TITLE_RE = /<title>(.+?)<\/title>/;
async function widgetLogin(h, username, password) {
  const base = `${h.sso}/sso`, embed = `${base}/embed`;
  const jar = {};
  const ep = new URLSearchParams({ id: 'gauth-widget', embedWidget: 'true', gauthHost: base });
  const sp = new URLSearchParams({ id: 'gauth-widget', embedWidget: 'true', gauthHost: embed, service: embed, source: embed, redirectAfterAccountLoginUrl: embed, redirectAfterAccountCreationUrl: embed });
  let r = await gfetch(`${embed}?${ep}`, { headers: { 'User-Agent': WEB_UA } }, jar);
  if (r.status === 429) throw new GErr('RATE_LIMITED', 429);
  if (r.status === 403) throw new GErr('BLOCKED', 403);
  await r.arrayBuffer();
  const signinUrl = `${base}/signin?${sp}`;
  r = await gfetch(signinUrl, { headers: { 'User-Agent': WEB_UA, Referer: embed } }, jar);
  if (r.status === 429) throw new GErr('RATE_LIMITED', 429);
  const m = CSRF_RE.exec(await r.text());
  if (!m) throw new GErr('BLOCKED', 403);
  await new Promise(ok => setTimeout(ok, 3000 + Math.random() * 2000));
  r = await gfetch(signinUrl, { method: 'POST', headers: { 'User-Agent': WEB_UA, Referer: signinUrl, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username, password, embed: 'true', _csrf: m[1] }) }, jar);
  if (r.status === 429) throw new GErr('RATE_LIMITED', 429);
  const html = await r.text();
  const title = (TITLE_RE.exec(html) || [])[1] || '';
  const tl = title.toLowerCase();
  if (/cloudflare|bad gateway|unavailable|502|503/.test(tl) || r.status === 403) throw new GErr('BLOCKED', 403);
  if (/locked/.test(tl)) throw new GErr('ACCOUNT_LOCKED', 403);
  if (/invalid|incorrect|account error/.test(tl)) throw new GErr('BAD_CREDENTIALS', 401);
  const vars = {}; for (const mm of html.matchAll(/var\s+(customerGuid|mfaMethod|locale|clientId|codeSentTo)\s*=\s*"([^"]*)"\s*;/g)) vars[mm[1]] = mm[2];
  if (tl.includes('mfa') || (tl.includes('authentication application') && vars.mfaMethod)) {
    const meth = (vars.mfaMethod || '').toLowerCase();
    if ((meth === 'email' || meth === 'sms') && !vars.codeSentTo) {
      await gfetch(`${h.sso}/sso/verifyMFA/mfaCode?clientId=${encodeURIComponent(vars.clientId || '')}`, { method: 'POST', headers: { 'User-Agent': WEB_UA, 'Content-Type': 'application/json', Referer: r.url || signinUrl }, body: JSON.stringify({ customerGuid: vars.customerGuid || '', mfaMethod: vars.mfaMethod || '', locale: vars.locale || '' }) }, jar);
    }
    const csrf = (CSRF_RE.exec(html) || [])[1];
    return { mfa: { flow: 'widget', jar, csrf, params: sp.toString(), referer: signinUrl }, method: vars.mfaMethod || '' };
  }
  if (title !== 'Success') throw new GErr('UPSTREAM', 502);
  const t = /\?ticket=(ST-[^"&\s]+)/.exec(html);
  if (!t) throw new GErr('UPSTREAM', 502);
  return { ticket: t[1], service: embed };
}

async function completeMfa(h, st, code) {
  if (st.flow === 'widget') {
    const r = await gfetch(`${h.sso}/sso/verifyMFA/loginEnterMfaCode?${st.params}`, { method: 'POST', headers: { 'User-Agent': WEB_UA, Referer: st.referer, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ 'mfa-code': code, embed: 'true', _csrf: st.csrf || '', fromPage: 'setupEnterMfaCode' }) }, st.jar);
    if (r.status === 429) throw new GErr('RATE_LIMITED', 429);
    const html = await r.text();
    const title = (TITLE_RE.exec(html) || [])[1] || '';
    const t = /\?ticket=(ST-[^"&\s]+)/.exec(html);
    if (title !== 'Success' || !t) throw new GErr('MFA_FAILED', 401);
    return { ticket: t[1], service: `${h.sso}/sso/embed` };
  }
  const headers = { 'User-Agent': IOS_UA, Accept: 'application/json, text/plain, */*', 'Content-Type': 'application/json', Origin: h.sso };
  const body = JSON.stringify({ mfaMethod: st.method || 'email', mfaVerificationCode: code, rememberMyBrowser: true, reconsentList: [], mfaSetup: false });
  const r = await gfetch(`${h.sso}/mobile/api/mfa/verifyCode?${st.params}`, { method: 'POST', headers, body }, st.jar);
  if (r.status === 429) throw new GErr('RATE_LIMITED', 429);
  if (r.status === 403) throw new GErr('BLOCKED', 403);
  const res = await readJson(r);
  if (res.responseStatus && res.responseStatus.type === 'SUCCESSFUL') return { ticket: res.serviceTicketId, service: h.ios };
  throw new GErr('MFA_FAILED', 401);
}

function jwtClientId(tok) {
  try { return JSON.parse(new TextDecoder().decode(unb64(tok.split('.')[1]))).client_id || null; } catch { return null; }
}
async function exchange(h, ticket, service) {
  for (const cid of DI_CLIENT_IDS) {
    const r = await fetch(h.di, { method: 'POST', headers: nativeHeaders({ Authorization: 'Basic ' + btoa(cid + ':'), Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' }), body: new URLSearchParams({ client_id: cid, service_ticket: ticket, grant_type: DI_GRANT, service_url: service }) });
    if (r.status === 429) throw new GErr('RATE_LIMITED', 429);
    if (!r.ok) { await r.arrayBuffer(); continue; }
    const d = await readJson(r);
    if (d.access_token) return { access: d.access_token, refresh: d.refresh_token || null, clientId: jwtClientId(d.access_token) || cid, expiresAt: Date.now() + (d.expires_in || 3600) * 1000 };
  }
  throw new GErr('UPSTREAM', 502);
}
async function profile(h, access) {
  try {
    const r = await fetch(`${h.api}/userprofile-service/socialProfile`, { headers: nativeHeaders({ Authorization: `Bearer ${access}`, Accept: 'application/json' }) });
    if (r.status === 401 || r.status === 403) throw new GErr('TOKEN_EXPIRED', 401);
    if (!r.ok) return null;
    const p = await r.json(); return { displayName: p.displayName, fullName: p.fullName };
  } catch (e) { if (e instanceof GErr) throw e; return null; }
}

async function finish(h, region, tk) {
  const tokens = await exchange(h, tk.ticket, tk.service);
  const who = await profile(h, tokens.access);
  return json({ ok: true, region, tokens, profile: who });
}

async function handle(request, env, path) {
  if (path === 'health') return json({ ok: true, service: 'garmin-proxy', stores: 'nothing' });
  if (path === 'probe') { // 不带任何账号：只检查中转能否打开佳明登录页
    const h = hosts(new URL(request.url).searchParams.get('region') || 'com');
    const out = {};
    const r1 = await fetch(`${h.sso}/sso/embed?id=gauth-widget&embedWidget=true&gauthHost=${encodeURIComponent(h.sso + '/sso')}`, { headers: { 'User-Agent': WEB_UA }, redirect: 'manual' });
    out.embed = r1.status; await r1.arrayBuffer();
    const r2 = await fetch(`${h.sso}/sso/signin?id=gauth-widget&embedWidget=true&gauthHost=${encodeURIComponent(h.sso + '/sso/embed')}&service=${encodeURIComponent(h.sso + '/sso/embed')}`, { headers: { 'User-Agent': WEB_UA }, redirect: 'manual' });
    out.signin = r2.status; out.csrf = CSRF_RE.test(await r2.text());
    const r3 = await fetch(`${h.api}/userprofile-service/socialProfile`, { headers: nativeHeaders({ Accept: 'application/json' }) });
    out.api = r3.status; await r3.arrayBuffer();
    return json({ ok: true, region: h.d, ...out });
  }
  if (path === 'login' && request.method === 'POST') {
    const { region, username, password } = await request.json().catch(() => ({}));
    if (!username || !password) throw new GErr('BAD_REQUEST');
    const h = hosts(region);
    let out, first;
    try { out = await mobileLogin(h, username, password, env); }
    catch (e) { if (!(e instanceof GErr) || ['BAD_CREDENTIALS', 'ACCOUNT_LOCKED'].includes(e.code)) throw e; first = e; }
    if (!out) {
      try { out = await widgetLogin(h, username, password); }
      catch (e) { if (e instanceof GErr && ['BAD_CREDENTIALS', 'ACCOUNT_LOCKED'].includes(e.code)) throw e; throw first.code === 'RATE_LIMITED' ? first : e; }
    }
    if (out.mfa) return json({ ok: false, mfa: true, method: out.method, state: await seal(env, { ...out.mfa, region }) }, 200);
    return finish(h, region, out);
  }
  if (path === 'mfa' && request.method === 'POST') {
    const { state, code } = await request.json().catch(() => ({}));
    if (!state || !code) throw new GErr('BAD_REQUEST');
    const st = await unseal(env, state);
    const h = hosts(st.region);
    return finish(h, st.region, await completeMfa(h, st, String(code).trim()));
  }
  if (path === 'refresh' && request.method === 'POST') {
    const { region, refresh, clientId } = await request.json().catch(() => ({}));
    if (!refresh || !clientId) throw new GErr('BAD_REQUEST');
    const h = hosts(region);
    const r = await fetch(h.di, { method: 'POST', headers: nativeHeaders({ Authorization: 'Basic ' + btoa(clientId + ':'), Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' }), body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refresh }) });
    if (r.status === 429) throw new GErr('RATE_LIMITED', 429);
    if (!r.ok) throw new GErr('TOKEN_EXPIRED', 401);
    const d = await r.json();
    return json({ ok: true, tokens: { access: d.access_token, refresh: d.refresh_token || refresh, clientId: jwtClientId(d.access_token) || clientId, expiresAt: Date.now() + (d.expires_in || 3600) * 1000 } });
  }
  if (path.startsWith('g/') && request.method === 'GET') {
    const sub = path.slice(2);
    if (!API_PREFIXES.some(p => sub.startsWith(p)) || sub.includes('..')) throw new GErr('NOT_ALLOWED', 403);
    const url = new URL(request.url);
    const h = hosts(url.searchParams.get('region') || 'com');
    url.searchParams.delete('region');
    const auth = request.headers.get('authorization');
    if (!auth || !/^Bearer [\w.\-~+/=]+$/.test(auth)) throw new GErr('TOKEN_EXPIRED', 401);
    const r = await fetch(`${h.api}/${sub}${url.search}`, { headers: nativeHeaders({ Authorization: auth, Accept: 'application/json, */*' }) });
    if (r.status === 401 || r.status === 403) return fail('TOKEN_EXPIRED', 401);
    if (r.status === 429) return fail('RATE_LIMITED', 429);
    const headers = { 'content-type': r.headers.get('content-type') || 'application/octet-stream', 'cache-control': 'no-store' };
    return new Response(r.body, { status: r.status, headers });
  }
  return fail('NOT_ALLOWED', 404);
}

async function innerOnRequest({ request, env, params }) {
  const path = (params.path || []).join('/');
  try { return await handle(request, env, path); }
  catch (e) {
    if (e instanceof GErr) return fail(e.code, e.status);
    return fail('UPSTREAM', 502);
  }
}

// ---- 方坤：服务端会话（令牌只存在 HttpOnly 加密 cookie 中，前端 JS 读不到；不记录日志） ----
const COOKIE = 'fk_gsess';
function readCookie(request) { const m = (request.headers.get('cookie') || '').match(/(?:^|;\s*)fk_gsess=([^;]+)/); return m ? decodeURIComponent(m[1]) : null; }
function cookieHeader(v, maxAge) { return `${COOKIE}=${encodeURIComponent(v)}; Path=/api/garmin; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`; }
async function sessionCookie(env, region, tokens, profile) { return cookieHeader(await seal(env, { session: 1, region: region || 'com', tokens, profile: profile || null }), 60 * 60 * 24 * 180); }
async function getSession(env, request) { const c = readCookie(request); if (!c) return null; try { return await unseal(env, c); } catch { return null; } }
async function refreshTokens(region, tk) {
  const h = hosts(region);
  const r = await fetch(h.di, { method: 'POST', headers: nativeHeaders({ Authorization: 'Basic ' + btoa(tk.clientId + ':'), Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' }), body: new URLSearchParams({ grant_type: 'refresh_token', client_id: tk.clientId, refresh_token: tk.refresh }) });
  if (!r.ok) return null;
  const d = await r.json();
  return { access: d.access_token, refresh: d.refresh_token || tk.refresh, clientId: jwtClientId(d.access_token) || tk.clientId, expiresAt: Date.now() + (d.expires_in || 3600) * 1000 };
}
export async function onRequest(ctx) {
  const { request, env, params } = ctx;
  const path = (params.path || []).join('/');
  if (path === 'refresh') return fail('NOT_ALLOWED', 404);
  if (path === 'logout') return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json', 'set-cookie': cookieHeader('', 0), 'cache-control': 'no-store' } });
  if (path === 'status') { const s = await getSession(env, request); return json({ ok: true, loggedIn: !!s, region: s ? s.region : null, profile: s ? s.profile || null : null }); }
  if (path.startsWith('g/')) {
    const s = await getSession(env, request);
    if (!s || !s.tokens) return fail('TOKEN_EXPIRED', 401);
    let tk = s.tokens, setC = null;
    if (tk.expiresAt && tk.expiresAt < Date.now() + 60000 && tk.refresh) {
      const n = await refreshTokens(s.region, tk); if (!n) return new Response(JSON.stringify({ ok: false, error: 'TOKEN_EXPIRED', message: MSG.TOKEN_EXPIRED }), { status: 401, headers: { 'content-type': 'application/json', 'set-cookie': cookieHeader('', 0) } });
      tk = n; setC = await sessionCookie(env, s.region, tk, s.profile);
    }
    const url = new URL(request.url); url.searchParams.set('region', s.region);
    const h = new Headers(request.headers); h.set('authorization', 'Bearer ' + tk.access); h.delete('cookie');
    const res = await innerOnRequest({ request: new Request(url, { method: 'GET', headers: h }), env, params });
    if (!setC) return res;
    const out = new Response(res.body, res); out.headers.append('set-cookie', setC); return out;
  }
  const res = await innerOnRequest(ctx);
  if ((path === 'login' || path === 'mfa') && res.ok) {
    const body = await res.json();
    if (body.ok && body.tokens) {
      const setC = await sessionCookie(env, body.region, body.tokens, body.profile);
      const cookieRes = new Response(JSON.stringify({ ok: true, region: body.region, profile: body.profile }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': setC } });
      return cookieRes;
    }
    return json(body, res.status);
  }
  return res;
}
