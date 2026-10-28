import { assertCoachSameOrigin } from '../../src/lib/auth/coach-request.server.ts';
import { onRequestPost } from './coach-chat.controller.js';
import { boundedResponseJson } from './lib/coach-provider-boundary.ts';
import { parseCoachRequest } from './lib/coach-request-boundary.ts';
import { parseCoachDeclarations } from './lib/coach-declarations.ts';
import { coachConfigurationReason, getCoachRuntime } from './coach-runtime.server.ts';
import type { CoachRuntime } from './coach-services.server.ts';
import { restoreCoachProxyRequest } from './coach-proxy.server.ts';
import { COACH_DISCLOSURE_VERSION } from './lib/coach-declaration-contract.ts';

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
const fail = (error: string, status = 503) => json({ ok: false, error, text: '联网解释当前不可用；保留本地训练分析与原计划。' }, status);
export async function handleCoachHttpRequest(request: Request, options: { env?: Record<string, string | undefined>; runtime?: CoachRuntime } = {}): Promise<Response> {
  const env = options.env ?? process.env;
  try { request = restoreCoachProxyRequest(request, env); } catch { return fail('PROXY_AUTH_FAILED', 403); }
  const path = new URL(request.url).pathname;
  if (path !== '/api/coach-chat' && path !== '/api/coach-snapshot') return fail('ROUTE_NOT_FOUND', 404);
  if (request.method === 'GET' && path === '/api/coach-chat') {
    let reason = coachConfigurationReason(env),schemaVerified=false;
    if(reason===null){
      try{const runtime=options.runtime??getCoachRuntime(env),schema=await runtime.snapshots.schemaStatus();schemaVerified=schema.ready;if(!schema.ready)reason='SCHEMA_MIGRATION_REQUIRED'}
      catch{reason='PERSISTENCE_UNAVAILABLE'}
    }
    return json({ service: 'fangkun-coach', configured: reason === null, reason, schemaVerified,requiredSchemaVersion:3,
      capabilities:{persistentConsent:schemaVerified,contextVersion:schemaVerified?'coach-context-v2':null,assertionPolicy:'coach-assertions-v2',retrieval:'NOT_CONFIGURED'},connectionVerified: false, authorizationVerified: false, billingVerified: false });
  }
  if (!['POST', 'DELETE'].includes(request.method) || (path === '/api/coach-chat' && request.method !== 'POST')) return fail('METHOD_NOT_ALLOWED', 405);
  try { assertCoachSameOrigin(request); } catch { return fail('CROSS_ORIGIN_REQUEST', 403); }
  let runtime: CoachRuntime;
  // Consent/snapshot management never dispatches a provider request. Keep opt-out
  // available when the model key, spending policy, or model switch is disabled.
  try { runtime = options.runtime ?? getCoachRuntime(env, path === '/api/coach-snapshot'); }
  catch (error) { return fail(error instanceof Error ? error.message : 'TRUSTED_BINDINGS_MISSING'); }
  if (path === '/api/coach-chat') return onRequestPost({ request, env, data: { fangkunCoachServices: runtime.services } });
  let subject;
  try { subject = await runtime.services.authenticate(request); } catch { return fail('AUTH_UNAVAILABLE'); }
  if (!subject) return fail('AUTH_REQUIRED', 401);
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) return fail('CONTENT_TYPE', 415);
  const limit = request.method === 'DELETE' ? 1024 : 65536;
  let body: unknown;
  try { body = await boundedResponseJson(new Response(request.body, { headers: request.headers }), limit); }
  catch { return fail('REQUEST_INVALID', 400); }
  if (request.method === 'DELETE') {
    try {
      if(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).length===2&&'revokeConsent'in body&&body.revokeConsent===true&&'consentId'in body&&typeof body.consentId==='string'&&/^[A-Za-z0-9_.:/-]{1,120}$/.test(body.consentId)){
        return await runtime.snapshots.revokeConsent(subject,body.consentId)?json({ok:true,consentRevoked:true}):fail('AUTHORIZED_CONTEXT_UNAVAILABLE',403);
      }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 3 || Object.keys(body).some(k => !['snapshotId', 'consentId', 'asOf'].includes(k))) return fail('REQUEST_INVALID', 400);
      const refs = parseCoachRequest({ ...body, question: 'revoke', requestId: 'revoke_reference' });
      const revoked = await runtime.snapshots.revoke(subject, refs);
      return revoked ? json({ ok: true, revoked: true }) : fail('AUTHORIZED_CONTEXT_UNAVAILABLE', 403);
    } catch { return fail('SNAPSHOT_REVOCATION_UNAVAILABLE'); }
  }
  if(body&&typeof body==='object'&&!Array.isArray(body)&&Object.keys(body).length===1&&'onlineConsent'in body){
    const setting=body.onlineConsent;
    if(!setting||typeof setting!=='object'||Array.isArray(setting)||Object.keys(setting).length!==2||!('enabled'in setting)||typeof setting.enabled!=='boolean'||!('disclosureVersion'in setting)||setting.disclosureVersion!==COACH_DISCLOSURE_VERSION)return fail('REQUEST_INVALID',400);
    try{return json(await (setting.enabled?runtime.snapshots.enableConsent(subject):runtime.snapshots.disableConsent(subject)))}catch{return fail('CONSENT_PERSISTENCE_UNAVAILABLE')}
  }
  let input;
  try { input = parseCoachDeclarations(body, runtime.services.now?.() ?? Date.now()); }
  catch { return fail('DECLARATIONS_INVALID', 400); }
  try { return json(await runtime.snapshots.create(subject, input)); }
  catch(error) { return fail(error instanceof Error&&error.message==='CONSENT_REVOKED'?'CONSENT_REVOKED':'SNAPSHOT_PERSISTENCE_UNAVAILABLE',error instanceof Error&&error.message==='CONSENT_REVOKED'?403:503); }
}
