import { timingSafeEqual } from 'node:crypto';

/** Restore the public URL only for the explicitly configured trusted Pages proxy. */
export function restoreCoachProxyRequest(request: Request, env: Record<string, string | undefined> = process.env): Request {
  const supplied = request.headers.get('x-fangkun-coach-proxy');
  if (supplied === null) return request;
  const expected = env.FANGKUN_COACH_PROXY_SECRET;
  if (!expected || expected.length < 32 || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw Error('PROXY_AUTH_FAILED');
  const configured = new URL(env.FANGKUN_COACH_PUBLIC_ORIGIN ?? '');
  if (configured.protocol !== 'https:' || configured.username || configured.password || configured.pathname !== '/' || configured.search || configured.hash) throw Error('PROXY_ORIGIN_UNAVAILABLE');
  const incoming = new URL(request.url), headers = new Headers(request.headers);
  headers.delete('x-fangkun-coach-proxy');
  headers.set('host', configured.host);
  headers.set('x-forwarded-host', configured.host);
  headers.set('x-forwarded-proto', 'https');
  return new Request(`${configured.origin}${incoming.pathname}${incoming.search}`, new Request(request, { headers }));
}
