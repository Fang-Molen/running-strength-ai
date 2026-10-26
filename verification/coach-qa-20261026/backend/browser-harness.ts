/** Local synthetic browser harness. Never imported by application or production routes.
 * Start: node --import ./scripts/test-register.mjs verification/coach-qa-20261026/backend/browser-harness.ts
 * Optional: FANGKUN_TEST_PUBLIC_ORIGIN=http://127.0.0.1:8080
 * Only localhost HTTP is served; ALL outbound native network access is blocked.
 */
import '../../../evaluation/deepseek-development/no-network.mjs';
import { createServer, type IncomingMessage } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { authenticateCoachRequest } from '../../../src/lib/auth/coach-request.server.ts';
import { createPgliteTransactionAdapter } from '../../../src/lib/coach/deepseek-ledger.server.ts';
import { createCoachServices } from '../../../server/coach-deepseek/coach-services.server.ts';
import { handleCoachHttpRequest } from '../../../server/coach-deepseek/coach-http.server.ts';
import type { VerifiedDeepSeekPolicy } from '../../../server/coach-deepseek/lib/coach-service-contract.ts';

const publicOrigin = process.env.FANGKUN_TEST_PUBLIC_ORIGIN ?? 'http://127.0.0.1:8080';
if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(publicOrigin)) throw Error('SYNTHETIC_LOCAL_ORIGIN_REQUIRED');
Object.assign(process.env, { VITE_AUTH_ENABLED: 'true', GROK_GATE_ORIGIN: 'https://synthetic-browser-gate.test', GROK_PROJECT_ID: 'browser-harness' });
const directory = await mkdtemp(join(tmpdir(), 'fangkun-browser-harness-'));
const db = new PGlite(directory);
for (const file of ['001_deepseek_budget.sql', '002_coach_snapshots.sql']) await db.exec(await readFile(new URL(`../../../migrations/coach/${file}`, import.meta.url), 'utf8'));
const { privateKey, publicKey } = await generateKeyPair('EdDSA');
const jwk = { ...await exportJWK(publicKey), kid: 'synthetic-browser-key' };
const issueToken = (subject: string) => new SignJWT({}).setProtectedHeader({ alg: 'EdDSA', kid: jwk.kid }).setSubject(subject).setIssuedAt().setExpirationTime('5m').setIssuer('https://synthetic-browser-gate.test').setAudience('app:browser-harness').sign(privateKey);
const now = Date.now();
const policy: VerifiedDeepSeekPolicy = {
  enabled: true, approvalId: 'synthetic-browser-approval', approvalExpiresAt: new Date(now + 86400000).toISOString(),
  campaignId: 'synthetic-browser-campaign', phase: 'evaluation', model: 'synthetic-model', acceptedResponseModels: ['synthetic-model'], modelVersion: 'synthetic-test-only',
  modelVerified: true, samplingVerified: true, temperature: 0.4, jsonObjectModeVerified: true, tokenUpperBoundVerified: true, tokenOverheadUpperBound: 32,
  reasoningIncludedInCompletionVerified: true, usageCacheAccountingVerified: true, priceVersion: 'synthetic-prices', pricesVerified: true, currency: 'CNY',
  inputMicrosPerMillion: 1000000, cachedInputMicrosPerMillion: 100000, outputMicrosPerMillion: 2000000, timeoutMs: 30000,
  caps: { campaignCalls: 120, pilotCalls: 8, campaignCostMicros: '10000000', ownerCalls: 120, ownerCostMicros: '10000000', concurrency: 1, globalDailyCalls: 120, globalDailyCostMicros: '10000000', ownerDailyCalls: 120, ownerDailyCostMicros: '10000000', perCallCostMicros: '20000' },
};
const env = {
  FANGKUN_DEEPSEEK_ENABLED: 'true', DEEPSEEK_API_KEY: 'SYNTHETIC_NOT_A_KEY', DATABASE_URL: 'synthetic-config-only-not-used',
  BETTER_AUTH_SECRET: 'SYNTHETIC_NOT_A_SECRET', VITE_AUTH_ENABLED: 'true', FANGKUN_COACH_SCHEMA_READY: 'true',
  FANGKUN_COACH_LEDGER_RECONCILED: 'true', FANGKUN_DEEPSEEK_POLICY_JSON: JSON.stringify(policy),
};
type Mode = 'normal' | 'wrong-unit' | 'invalid-output' | 'delayed';
let mode: Mode = 'normal', providerCalls = 0;
const pending = new Set<() => void>();
const runtime = createCoachServices({
  db: createPgliteTransactionAdapter(db), policy: () => policy,
  authenticate: request => authenticateCoachRequest(request, { jwksFetch: async () => ({ keys: [jwk] }) }),
  fetch: async (_url, init) => {
    providerCalls++;
    const currentMode = mode;
    if (currentMode === 'delayed') await new Promise<void>((resolve, reject) => {
      const release = () => { pending.delete(release); init?.signal?.removeEventListener('abort', abort); resolve(); };
      const abort = () => { pending.delete(release); reject(Error('SYNTHETIC_ABORT')); };
      pending.add(release); init?.signal?.addEventListener('abort', abort, { once: true });
    });
    const packet = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
    const fact = packet.facts?.[0] as { id: string; detail: string } | undefined;
    const quote = fact?.detail;
    const displayed = currentMode === 'wrong-unit' && quote ? quote.replace(/小时|秒|\/10/, unit => unit === '秒' ? '小时' : '秒') : quote;
    const content = currentMode === 'invalid-output' ? 'not-json' : JSON.stringify({
      mode: 'answer', text: [displayed, '可先核对这条记录与当前感受是否一致；单项资料不足以确认恢复或批准加量。'].filter(Boolean).join('\n'),
      citations: fact ? [fact.id] : [], evidenceQuotes: fact ? [{ sourceId: fact.id, quote }] : [],
      nextStep: null, medicalReferral: false, compareIds: null, seriesIds: null, planChanged: false,
    });
    return Response.json({ model: 'synthetic-model', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 80, completion_tokens_details: { reasoning_tokens: 10 } } });
  },
});

async function bodyBytes(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 65536) throw Error('BODY_LIMIT'); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks);
}
const server = createServer(async (incoming, outgoing) => {
  try {
    const address = new URL(incoming.url ?? '/', 'http://127.0.0.1:8092');
    const bytes = await bodyBytes(incoming);
    const body = () => JSON.parse(bytes.toString() || '{}');
    let response: Response;
    if (address.pathname === '/__test/session' && incoming.method === 'POST') {
      const subject = body().subject;
      if (!['alice', 'bob'].includes(subject)) throw Error('SYNTHETIC_SUBJECT_REQUIRED');
      response = Response.json({ subject, token: await issueToken(subject) });
    } else if (address.pathname === '/__test/provider' && incoming.method === 'POST') {
      const requested = body().mode;
      if (!['normal', 'wrong-unit', 'invalid-output', 'delayed'].includes(requested)) throw Error('SYNTHETIC_MODE_REQUIRED');
      mode = requested; response = Response.json({ ok: true, mode });
    } else if (address.pathname === '/__test/release' && incoming.method === 'POST') {
      const released = pending.size; for (const release of [...pending]) release();
      response = Response.json({ ok: true, released });
    } else if (address.pathname === '/__test/status') {
      const reservations = await db.query<{ state: string; count: number }>('SELECT state,count(*)::int AS count FROM coach_model_reservation GROUP BY state ORDER BY state');
      response = Response.json({ ready: true, synthetic: true, publicOrigin, mode, providerCalls, pending: pending.size, reservations: reservations.rows });
    } else {
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(',') : value);
      const request = new Request(`${publicOrigin}${address.pathname}${address.search}`, { method: incoming.method, headers, ...(bytes.length ? { body: bytes } : {}) });
      response = await handleCoachHttpRequest(request, { env, runtime });
    }
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(new Uint8Array(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    outgoing.end(JSON.stringify({ ok: false, error: 'SYNTHETIC_HARNESS_REQUEST_INVALID' }));
  }
});
server.listen(8092, '127.0.0.1', () => process.stdout.write(`Synthetic coach harness ready on 127.0.0.1:8092; public origin ${publicOrigin}; outbound I/O blocked.\n`));
const shutdown = async () => { for (const release of [...pending]) release(); server.close(); await db.close(); await rm(directory, { recursive: true, force: true }); process.exit(0); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
