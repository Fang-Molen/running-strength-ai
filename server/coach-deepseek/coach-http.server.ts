import { assertCoachSameOrigin } from '../../src/lib/auth/coach-request.server.ts';
import { onRequestPost } from './coach-chat.controller.js';
import { boundedResponseJson } from './lib/coach-provider-boundary.ts';
import { parseCoachRequest } from './lib/coach-request-boundary.ts';
import { parseCoachDeclarations } from './lib/coach-declarations.ts';
import { coachConfigurationReason, getCoachRuntime } from './coach-runtime.server.ts';
import type { CoachRuntime } from './coach-services.server.ts';
import { restoreCoachProxyRequest } from './coach-proxy.server.ts';

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
const fail = (error: string, status = 503) => json({ ok: false, error, text: '联网解释当前不可用；保留本地训练分析与原计划。' }, status);
export async function handleCoachHttpRequest(request: Request, options: { env?: Record<string, string | undefined>; runtime?: CoachRuntime } = {}): Promise<Response> {
  const env = options.env ?? process.env;
  try { request = restoreCoachProxyRequest(request, env); } catch { return fail('PROXY_AUTH_FAILED', 403); }
  const path = new URL(request.url).pathname;
  if (path !== '/api/coach-chat' && path !== '/api/coach-snapshot') return fail('ROUTE_NOT_FOUND', 404);
  if (request.method === 'GET' && path === '/api/coach-chat') {
    const reason = coachConfigurationReason(env);
    return json({ service: 'fangkun-coach', configured: reason === null, reason, connectionVerified: false, authorizationVerified: false, billingVerified: false });
  }
  if (!['POST', 'DELETE'].includes(request.method) || (path === '/api/coach-chat' && request.method !== 'POST')) return fail('METHOD_NOT_ALLOWED', 405);
  try { assertCoachSameOrigin(request); } catch { return fail('CROSS_ORIGIN_REQUEST', 403); }
  let runtime: CoachRuntime;
  try { runtime = options.runtime ?? getCoachRuntime(env, request.method === 'DELETE'); }
  catch (error) { return fail(error instanceof Error ? error.message : 'TRUSTED_BINDINGS_MISSING'); }
  if (path === '/api/coach-chat') return onRequestPost({ request, env, data: { fangkunCoachServices: runtime.services } });
  let subject;
  try { subject = await runtime.services.authenticate(request); } catch { return fail('AUTH_UNAVAILABLE'); }
  if (!subject) return fail('AUTH_REQUIRED', 401);
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return fail('CONTENT_TYPE', 415);
  const limit = request.method === 'DELETE' ? 1024 : 16384;
  let body: unknown;
  try { body = await boundedResponseJson(new Response(request.body, { headers: request.headers }), limit); }
  catch { return fail('REQUEST_INVALID', 400); }
  if (request.method === 'DELETE') {
    try {
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 3 || Object.keys(body).some(k => !['snapshotId', 'consentId', 'asOf'].includes(k))) return fail('REQUEST_INVALID', 400);
      const refs = parseCoachRequest({ ...body, question: 'revoke', requestId: 'revoke_reference' });
      const revoked = await runtime.snapshots.revoke(subject, refs);
      return revoked ? json({ ok: true, revoked: true }) : fail('AUTHORIZED_CONTEXT_UNAVAILABLE', 403);
    } catch { return fail('SNAPSHOT_REVOCATION_UNAVAILABLE'); }
  }
  let input;
  try { input = parseCoachDeclarations(body, runtime.services.now?.() ?? Date.now()); }
  catch { return fail('DECLARATIONS_INVALID', 400); }
  try { return json(await runtime.snapshots.create(subject, input)); }
  catch { return fail('SNAPSHOT_PERSISTENCE_UNAVAILABLE'); }
}
