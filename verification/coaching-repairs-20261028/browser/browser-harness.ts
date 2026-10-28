/** Local synthetic browser harness. Never imported by application or production routes.
 * Start: node --import ./scripts/test-register.mjs verification/coaching-repairs-20261028/browser/browser-harness.ts
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
for (const file of ['001_deepseek_budget.sql', '002_coach_snapshots.sql', '003_persistent_online.sql']) await db.exec(await readFile(new URL(`../../../migrations/coach/${file}`, import.meta.url), 'utf8'));
const { privateKey, publicKey } = await generateKeyPair('EdDSA');
const jwk = { ...await exportJWK(publicKey), kid: 'synthetic-browser-key' };
const issueToken = (subject: string) => new SignJWT({}).setProtectedHeader({ alg: 'EdDSA', kid: jwk.kid }).setSubject(subject).setIssuedAt().setExpirationTime('30m').setIssuer('https://synthetic-browser-gate.test').setAudience('app:browser-harness').sign(privateKey);
const now = Date.now();
const policy: VerifiedDeepSeekPolicy = {
  enabled: true, approvalId: 'synthetic-browser-approval', approvalExpiresAt: new Date(now + 86400000).toISOString(),
  campaignId: 'synthetic-browser-campaign', phase: 'evaluation', model: 'synthetic-model', acceptedResponseModels: ['synthetic-model'], modelVersion: 'synthetic-test-only',
  modelVerified: true, samplingVerified: true, temperature: 0.4, jsonObjectModeVerified: true, tokenUpperBoundVerified: true, tokenOverheadUpperBound: 32,
  reasoningIncludedInCompletionVerified: true, usageCacheAccountingVerified: true, priceVersion: 'synthetic-prices', pricesVerified: true, currency: 'CNY',
  inputMicrosPerMillion: 1000000, cachedInputMicrosPerMillion: 100000, outputMicrosPerMillion: 2000000, timeoutMs: 30000,
  caps: { campaignCalls: 120, pilotCalls: 8, campaignCostMicros: '10000000', ownerCalls: 120, ownerCostMicros: '10000000', concurrency: 4, globalDailyCalls: 120, globalDailyCostMicros: '10000000', ownerDailyCalls: 120, ownerDailyCostMicros: '10000000', perCallCostMicros: '20000' },
};
const env = {
  FANGKUN_DEEPSEEK_ENABLED: 'true', DEEPSEEK_API_KEY: 'SYNTHETIC_NOT_A_KEY', DATABASE_URL: 'synthetic-config-only-not-used',
  BETTER_AUTH_SECRET: 'SYNTHETIC_NOT_A_SECRET', VITE_AUTH_ENABLED: 'true', FANGKUN_COACH_SCHEMA_READY: 'true',
  FANGKUN_COACH_LEDGER_RECONCILED: 'true', FANGKUN_DEEPSEEK_POLICY_JSON: JSON.stringify(policy),
};
type Mode = 'normal' | 'wrong-unit' | 'invalid-output' | 'delayed';
let mode: Mode = 'normal', providerCalls = 0, activeProvider = 0, maxActiveProvider = 0;
const dispatches: { question: string; mode: Mode; facts: unknown[]; startedAt: string; returnedAt?: string }[] = [];
const pending = new Set<() => void>();
const runtime = createCoachServices({
  db: createPgliteTransactionAdapter(db), policy: () => policy,
  authenticate: request => authenticateCoachRequest(request, { jwksFetch: async () => ({ keys: [jwk] }) }),
  fetch: async (_url, init) => {
    providerCalls++;
    const currentMode = mode;
    const packet = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
    const dispatch = { question: String(packet.question), mode: currentMode, facts: packet.facts ?? [], startedAt: new Date().toISOString(), returnedAt: undefined as string | undefined };
    dispatches.push(dispatch); activeProvider++; maxActiveProvider = Math.max(maxActiveProvider, activeProvider);
    if (currentMode === 'delayed') await new Promise<void>((resolve, reject) => {
      const release = () => { pending.delete(release); init?.signal?.removeEventListener('abort', abort); resolve(); };
      const abort = () => { pending.delete(release); reject(Error('SYNTHETIC_ABORT')); };
      pending.add(release); init?.signal?.addEventListener('abort', abort, { once: true });
    });
    const fact = packet.facts?.find((r:{kind:string})=>r.kind==='FACT') as { id: string; detail: string } | undefined;
    const quote = fact?.detail;
    const displayed = currentMode === 'wrong-unit' && quote ? quote.replace(/\bh\b|\bs\b|小时|秒|\/10|0-10|1-10/, unit => /h|小时/.test(unit) ? 'kg' : '小时') : quote;
    const education = /RPE/i.test(packet.question) ? 'RPE是主观用力程度量表。常用CR10量表范围为0–10，数值越大通常表示主观努力越高。它描述用力感，不能单独确定恢复或医学安全。' : /上肢/.test(packet.question) ? '上肢练习可以围绕肩带控制和动作质量组织，选择稳定支撑的姿势并观察不适变化。历史腿部限制仍需按原记录处理，不能据此解除限制。' : '一般力量训练通过反复机械张力和恢复，引起神经与肌肉适应。动作练习会改善协调，肌肉变化也受负荷、恢复和营养影响。个体变化需要持续观察，单次酸痛不能证明训练效果。';
    const content = currentMode === 'invalid-output' ? 'not-json' : JSON.stringify({
      mode: 'answer', text: [displayed, education].filter(Boolean).join('\n'),
      citations: fact ? [fact.id] : [], evidenceQuotes: fact ? [{ sourceId: fact.id, quote }] : [],
      nextStep: null, medicalReferral: false, compareIds: null, seriesIds: null, planChanged: false,
    });
    activeProvider--; dispatch.returnedAt = new Date().toISOString();
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
    const address = new URL(incoming.url ?? '/', 'http://127.0.0.1:8095');
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
      response = Response.json({ ready: true, synthetic: true, publicOrigin, mode, providerCalls, activeProvider, maxActiveProvider, dispatches, pending: pending.size, reservations: reservations.rows, grantRows: (await db.query('SELECT subject_id,enabled FROM coach_online_preference')).rows });
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
server.listen(8095, '127.0.0.1', () => process.stdout.write(`Synthetic coach harness ready on 127.0.0.1:8095; public origin ${publicOrigin}; outbound I/O blocked.\n`));
const shutdown = async () => { for (const release of [...pending]) release(); server.close(); await db.close(); await rm(directory, { recursive: true, force: true }); process.exit(0); };
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
