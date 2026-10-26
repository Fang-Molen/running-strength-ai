/** Cloudflare Pages adapter: the binding is installed by deployment, never JSON. */
/** @param {{request: Request, env?: {FANGKUN_COACH_BACKEND?: {fetch(request: Request): Promise<Response>}, FANGKUN_COACH_BACKEND_ORIGIN?:string, FANGKUN_COACH_PROXY_SECRET?:string, GROK_AUTH_ISSUER?:string}}} context */
export async function proxyCoachBackend({ request, env = {} }) {
  const binding = env.FANGKUN_COACH_BACKEND;
  let backend;
  if (!binding && env.FANGKUN_COACH_BACKEND_ORIGIN && typeof env.FANGKUN_COACH_PROXY_SECRET === 'string' && env.FANGKUN_COACH_PROXY_SECRET.length >= 32) {
    try {
      const url = new URL(env.FANGKUN_COACH_BACKEND_ORIGIN);
      if (url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) backend = url.origin;
    } catch { /* A malformed server configuration cannot choose another destination. */ }
  }
  if ((!binding || typeof binding.fetch !== 'function') && !backend) {
    return Response.json({ ok: false, error: 'TRUSTED_BINDINGS_MISSING', text: '尚未配置教练后端服务连接；保留本地回答。' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  try {
    // Preserve the public URL, Origin and cookies for the backend's origin/auth checks.
    // Backend redirects are never followed with the viewer's credentials.
    let response;
    if (binding) response = await binding.fetch(new Request(request, { redirect: 'manual' }));
    else {
      const original = new URL(request.url);
      const headers = new Headers(request.headers);
      headers.delete('host'); headers.delete('x-forwarded-host'); headers.delete('x-forwarded-proto');
      headers.set('x-fangkun-coach-proxy', env.FANGKUN_COACH_PROXY_SECRET ?? '');
      // Only the fixed server configuration chooses the destination origin.
      response = await fetch(new Request(`${backend}${original.pathname}${original.search}`, new Request(request, { headers, redirect: 'manual' })));
    }
    if (response.status >= 300 && response.status < 400) {
      // OAuth returns its session cookie together with a browser redirect. Never
      // follow it here or discard the cookie as if this were a coach JSON reply.
      const publicUrl = new URL(request.url), location = response.headers.get('location');
      if (!publicUrl.pathname.startsWith('/api/auth/') || !location) throw Error('BACKEND_REDIRECT');
      const target = new URL(location, publicUrl);
      const allowed = new Set([publicUrl.origin]);
      if (env.GROK_AUTH_ISSUER) {
        const issuer = new URL(env.GROK_AUTH_ISSUER);
        if (issuer.protocol === 'https:' && !issuer.username && !issuer.password) allowed.add(issuer.origin);
      }
      if (target.protocol !== 'https:' || target.username || target.password || !allowed.has(target.origin)) throw Error('BACKEND_REDIRECT');
    }
    return response;
  } catch {
    return Response.json({ ok: false, error: 'BACKEND_UNAVAILABLE', text: '教练后端暂时无法连接；保留本地回答。' }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
