import { GATE_IDENTITY_HEADER, gateIdentityFromHeaders, type JwksFetch } from './gate-identity.server.ts';

/** Fetch routes cannot use the function middleware's shared development fallback. */
export function assertCoachSameOrigin(request: Request): void {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') throw Error('CROSS_ORIGIN_REQUEST');
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw Error('CROSS_ORIGIN_REQUEST');
}

export async function authenticateCoachRequest(request: Request, options: { jwksFetch?: JwksFetch } = {}): Promise<string | null> {
  assertCoachSameOrigin(request);
  if (process.env.VITE_AUTH_ENABLED === 'false') return null;
  if (request.headers.has(GATE_IDENTITY_HEADER)) {
    const identity = await gateIdentityFromHeaders(request.headers, options.jwksFetch);
    // A bad identity header never falls back to an older browser session.
    return identity ? `gate:${identity.sub}` : null;
  }
  // Production services require durable auth storage and a stable signing secret.
  if (!process.env.DATABASE_URL?.trim() || !process.env.BETTER_AUTH_SECRET?.trim()) return null;
  const { auth } = await import('./server.ts');
  const session = await auth.api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
  if (!session?.user || !session.session || new Date(session.session.expiresAt).valueOf() <= Date.now() || session.user.id === 'dev-user') return null;
  return session.user.id;
}
