// 高驰（COROS）中转（无状态）：只转发，不存储、不记录账号密码和数据。没有任何 console.log。
// 依据开源项目使用的非官方 Training Hub 接口（未获高驰官方文档；可能随时变化）：
//   POST {teamapi}/account/login {account, accountType:2, pwd:MD5(密码)} → data.accessToken / userId / regionId
//   GET  {teamapi}/activity/query?size&pageNumber&startDay&endDay  （请求头 accesstoken）
//   regionId → 1 teamapi.coros.com，2 teamcnapi.coros.com，3 teameuapi.coros.com
// 参考：github.com/cygnusb/coros-mcp、github.com/XiaoSiHwang/garmin-sync-coros（region_config.py）、gist quiver/1dc414da3f32f7a6b68d0723a912c956
const LOGIN_HOST = 'https://teamapi.coros.com';
const REGION_HOSTS = { 1: 'https://teamapi.coros.com', 2: 'https://teamcnapi.coros.com', 3: 'https://teameuapi.coros.com' };
const COOKIE = 'fk_csess';
const MSG = {
  BAD_REQUEST: '请求不完整', BAD_CREDENTIALS: '高驰账号或密码不对', TOKEN_EXPIRED: '高驰登录已过期（约 24 小时），请重新登录',
  NOT_LOGGED_IN: '还没有登录高驰账号', UPSTREAM: '高驰服务返回异常，可能接口有变化', NOT_ALLOWED: '不支持的接口',
};
const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });
const fail = (code, status, extra = {}) => json({ ok: false, error: code, message: MSG[code] || code }, status, extra);

async function key(env) {
  const secret = env.STATE_KEY || 'garmin-tool-fallback-key-change-me';
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('coros:' + secret));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const b64 = u8 => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function seal(env, obj) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env), new TextEncoder().encode(JSON.stringify(obj)))); return b64(iv) + '.' + b64(ct); }
async function unseal(env, s) { const [iv, ct] = s.split('.'); return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await key(env), unb64(ct)))); }
const cookieHeader = (v, maxAge) => `${COOKIE}=${encodeURIComponent(v)}; Path=/api/coros; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
async function getSession(env, request) { const m = (request.headers.get('cookie') || '').match(/(?:^|;\s*)fk_csess=([^;]+)/); if (!m) return null; try { const s = await unseal(env, decodeURIComponent(m[1])); return s && s.at && Date.now() - s.at < 23 * 3600e3 ? s : null; } catch { return null; } }
async function md5Hex(text) { const d = await crypto.subtle.digest('MD5', new TextEncoder().encode(text)); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join(''); }
const day8 = v => typeof v === 'string' && /^\d{8}$/.test(v) ? v : null;

export async function onRequest({ request, env, params }) {
  const path = [].concat(params.path || []).join('/');
  try {
    if (path === 'status') { const s = await getSession(env, request); return json({ ok: true, loggedIn: !!s, region: s ? s.region : null }); }
    if (path === 'logout') return json({ ok: true }, 200, { 'set-cookie': cookieHeader('', 0) });
    if (path === 'login' && request.method === 'POST') {
      let body; try { body = await request.json(); } catch { return fail('BAD_REQUEST', 400); }
      const account = typeof body?.account === 'string' ? body.account.trim() : '', password = typeof body?.password === 'string' ? body.password : '';
      if (!account || !password || account.length > 200 || password.length > 200) return fail('BAD_REQUEST', 400);
      const res = await fetch(LOGIN_HOST + '/account/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account, accountType: 2, pwd: await md5Hex(password) }) });
      const out = await res.json().catch(() => null);
      if (!out || typeof out.result !== 'string') return fail('UPSTREAM', 502);
      if (out.result !== '0000') return fail(out.result === '1030' ? 'BAD_CREDENTIALS' : 'UPSTREAM', out.result === '1030' ? 401 : 502, {});
      const d = out.data || {}, region = Number(d.regionId) in REGION_HOSTS ? Number(d.regionId) : 1;
      if (typeof d.accessToken !== 'string' || !d.userId) return fail('UPSTREAM', 502);
      const c = cookieHeader(await seal(env, { token: d.accessToken, userId: String(d.userId), region, at: Date.now() }), 23 * 3600);
      return json({ ok: true, region }, 200, { 'set-cookie': c });
    }
    if (path === 'activities' && request.method === 'GET') {
      const s = await getSession(env, request); if (!s) return fail('NOT_LOGGED_IN', 401);
      const u = new URL(request.url), startDay = day8(u.searchParams.get('startDay')), endDay = day8(u.searchParams.get('endDay'));
      const page = Math.max(1, Math.min(20, Number(u.searchParams.get('page')) || 1));
      if (!startDay || !endDay) return fail('BAD_REQUEST', 400);
      const q = new URLSearchParams({ size: '50', pageNumber: String(page), startDay, endDay, modeList: '' });
      const res = await fetch(`${REGION_HOSTS[s.region]}/activity/query?${q}`, { headers: { accesstoken: s.token, 'content-type': 'application/json', yfheader: JSON.stringify({ userId: s.userId }) } });
      const out = await res.json().catch(() => null);
      if (!out || typeof out.result !== 'string') return fail('UPSTREAM', 502);
      if (out.result === '1019') return fail('TOKEN_EXPIRED', 401, { 'set-cookie': cookieHeader('', 0) });
      if (out.result !== '0000') return fail('UPSTREAM', 502);
      const list = Array.isArray(out.data?.dataList) ? out.data.dataList : [];
      // 只回传摘要字段；userId 只作不可逆的账号引用（不回传令牌）。
      const ref = (await md5Hex('fk-coros-ref:' + s.userId)).slice(0, 16);
      return json({ ok: true, accountRef: ref, totalPage: Number(out.data?.totalPage) || 1, activities: list.map(a => ({
        labelId: String(a.labelId ?? ''), name: typeof a.name === 'string' ? a.name.slice(0, 80) : '', sportType: Number(a.sportType) || null, date: day8(String(a.date ?? '')),
        startTime: Number(a.startTime) || null, endTime: Number(a.endTime) || null, totalTime: Number(a.totalTime) || null, distance: Number(a.distance) || null,
        avgHr: Number(a.avgHr) || null, maxHr: Number(a.maxHr) || null, calorie: Number(a.calorie) || null, trainingLoad: Number(a.trainingLoad) || null,
      })).filter(a => a.labelId) });
    }
    return fail('NOT_ALLOWED', 404);
  } catch { return fail('UPSTREAM', 502); }
}
