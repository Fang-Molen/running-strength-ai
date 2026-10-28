import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createPgliteTransactionAdapter } from '../../src/lib/coach/deepseek-ledger.server.ts';
import { authenticateCoachRequest } from '../../src/lib/auth/coach-request.server.ts';
import { createCoachServices } from './coach-services.server.ts';
import { handleCoachHttpRequest } from './coach-http.server.ts';
import { coachConfigurationReason } from './coach-runtime.server.ts';
import { parseCoachDeclarations, declarationCoachInput } from './lib/coach-declarations.ts';
import type { VerifiedDeepSeekPolicy } from './lib/coach-service-contract.ts';
import { declarationQuote, type CoachSnapshotCreated, type CoachSnapshotCreate } from './lib/coach-declaration-contract.ts';

const now = Date.now();
const policy: VerifiedDeepSeekPolicy = { enabled: true, approvalId: 'synthetic-approval', approvalExpiresAt: new Date(now + 86400000).toISOString(), campaignId: 'synthetic-campaign', phase: 'evaluation', model: 'synthetic-model', acceptedResponseModels: ['synthetic-model'], modelVersion: 'test', modelVerified: true, samplingVerified: true, temperature: 0.4, jsonObjectModeVerified: true, tokenUpperBoundVerified: true, tokenOverheadUpperBound: 32, reasoningIncludedInCompletionVerified: true, usageCacheAccountingVerified: true, priceVersion: 'synthetic-prices', pricesVerified: true, currency: 'CNY', inputMicrosPerMillion: 1000000, cachedInputMicrosPerMillion: 100000, outputMicrosPerMillion: 2000000, timeoutMs: 1000, caps: { campaignCalls: 120, pilotCalls: 8, campaignCostMicros: '10000000', ownerCalls: 120, ownerCostMicros: '10000000', concurrency: 1, globalDailyCalls: 120, globalDailyCostMicros: '10000000', ownerDailyCalls: 120, ownerDailyCostMicros: '10000000', perCallCostMicros: '20000' } };
const env = { FANGKUN_DEEPSEEK_ENABLED: 'true', DEEPSEEK_API_KEY: 'SYNTHETIC_NOT_A_KEY' };
const input: CoachSnapshotCreate = { question: '解释训练反应的可能原因', declarations: [{ recordId: 'local-record', revision: 'v1', occurredAt: new Date(now - 3600000).toISOString(), kind: 'actual', metric: 'session_rpe', value: 5, unit: '/10' }], consent: { purpose: 'coach_explanation', disclosureVersion: 'coach-self-report-v1' } };
const provider = (text = '用户申报资料支持提出待核对的解释；尚不能确认长期能力变化。') => Response.json({ model: 'synthetic-model', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ mode: 'answer', text, citations: [], nextStep: null, medicalReferral: false, compareIds: null, seriesIds: null, planChanged: false }) } }], usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 80, completion_tokens_details: { reasoning_tokens: 10 } } });

test('strict declaration boundary rejects plans, derived fields, bad units, duplicate revisions and forged authority', () => {
  assert.equal(parseCoachDeclarations(input, now).declarations.length, 1);
  for (const change of [
    { ...input, subjectId: 'other' }, { ...input, consent: { ...input.consent, disclosureVersion: 'old' } },
    ...[{ kind: 'planned' }, { unit: 'ms' }, { value: NaN }, { metric: 'derived_load' }, { occurredAt: new Date(now + 1).toISOString() }, { trusted: true }].map(change => ({ ...input, declarations: [{ ...input.declarations[0], ...change }] })),
    { ...input, declarations: [input.declarations[0], { ...input.declarations[0], revision: 'v2' }] },
  ]) assert.throws(() => parseCoachDeclarations(change, now));
  const brief = declarationCoachInput(input).brief;
  assert.equal(brief.sessionRpe, null);
  assert.equal(brief.occurrenceId, null);
  assert.equal(brief.durationSec, null);
  assert.equal(brief.plannedSetCount, null);
  assert.deepEqual(brief.sources!.map(s => s.detail), input.declarations.map(declarationQuote));
});

test('sleep, pain and duration scalars never manufacture a workout or running structure', () => {
  const declarations: CoachSnapshotCreate['declarations'] = ['sleep', 'duration', 'pain'].map((metric, i) => ({ ...input.declarations[0], recordId: `scalar-${i}`, metric: metric as 'sleep' | 'duration' | 'pain', value: 3, unit: metric === 'sleep' ? 'h' : metric === 'duration' ? 's' : '/10' }));
  const projected = declarationCoachInput(parseCoachDeclarations({ ...input, declarations }, now));
  assert.equal(projected.brief.occurrenceId, null); assert.equal(projected.brief.runningStructure, 'UNAVAILABLE');
  assert.deepEqual(projected.brief.running, []); assert.equal(projected.brief.durationSec, null); assert.equal(projected.brief.completedSetCount, null);
  assert.equal(projected.compare, undefined); assert.equal(projected.series, undefined); assert.equal(projected.brief.constraints.medicalReferral, true);
  assert.deepEqual(projected.brief.sources!.map(s => s.detail), declarations.map(declarationQuote));
});

test('runtime config never guesses credentials, policy, persistence or prior spend', () => {
  assert.equal(coachConfigurationReason({}), 'SERVICE_DISABLED');
  assert.equal(coachConfigurationReason(env), 'PERSISTENCE_UNAVAILABLE');
  const config = { ...env, DATABASE_URL: 'not-opened', BETTER_AUTH_SECRET: 'synthetic', FANGKUN_COACH_SCHEMA_READY: 'true', VITE_AUTH_ENABLED: 'true' };
  assert.equal(coachConfigurationReason(config), 'BUDGET_HISTORY_UNVERIFIED');
  assert.equal(coachConfigurationReason({ ...config, FANGKUN_COACH_LEDGER_RECONCILED: 'true' }), 'POLICY_UNVERIFIED');
  assert.equal(coachConfigurationReason({ ...config, FANGKUN_COACH_LEDGER_RECONCILED: 'true', FANGKUN_DEEPSEEK_POLICY_JSON: JSON.stringify(policy) }), null);
});

test('signed identity + actual disk SQL + snapshot HTTP + controller + persistent budget; provider mocked only', async t => {
  const oldEnv = { VITE_AUTH_ENABLED: process.env.VITE_AUTH_ENABLED, GROK_GATE_ORIGIN: process.env.GROK_GATE_ORIGIN, GROK_PROJECT_ID: process.env.GROK_PROJECT_ID };
  Object.assign(process.env, { VITE_AUTH_ENABLED: 'true', GROK_GATE_ORIGIN: 'https://synthetic-gate.test', GROK_PROJECT_ID: 'runtime-test' });
  const directory = await mkdtemp(join(tmpdir(), 'coach-runtime-'));
  let db = new PGlite(directory);
  const { privateKey, publicKey } = await generateKeyPair('EdDSA');
  const jwk = await exportJWK(publicKey);
  const token = (sub: string) => new SignJWT({}).setProtectedHeader({ alg: 'EdDSA', kid: 'runtime-test-key' }).setSubject(sub).setIssuedAt().setExpirationTime('5m').setIssuer('https://synthetic-gate.test').setAudience('app:runtime-test').sign(privateKey);
  const alice = await token('alice'), bob = await token('bob');
  const authenticate = (req: Request) => authenticateCoachRequest(req, { jwksFetch: async () => ({ keys: [{ ...jwk, kid: 'runtime-test-key' }] }) });
  let calls = 0, currentTime = now;
  let transport: typeof fetch = async (_url, init) => { calls++; assert.match(String(init?.body), /用户申报/); return provider(); };
  const runtimeFactory = () => createCoachServices({ db: createPgliteTransactionAdapter(db), authenticate, policy: () => policy, now: () => currentTime, fetch: (...args) => transport(...args) });
  let runtime = runtimeFactory();
  const request = (path: string, body: unknown, identity = alice, method = 'POST', headers: Record<string, string> = {}) => new Request(`https://coach.test/api/${path}`, { method, headers: { 'content-type': 'application/json', 'x-grok-identity': identity, origin: 'https://coach.test', ...headers }, body: JSON.stringify(body) });
  const examples:unknown[]=[];
  const invoke = async(path: string, body: unknown, identity = alice, method = 'POST') => {
    const response=await handleCoachHttpRequest(request(path, body, identity, method), { env, runtime });
    const req=body as {requestId?:string;question?:string};
    if(process.env.FK_CAPTURE_ONLINE_EXAMPLES==='1'&&req.requestId?.startsWith('modern_'))examples.push({caseId:req.requestId,question:req.question,status:response.status,response:await response.clone().json(),evaluation:'SYNTHETIC_PROVIDER_AND_SIGNED_TEST_IDENTITY_NOT_REAL_MODEL_OR_PROFESSIONAL_REVIEW'});
    return response;
  };
  const snapshot = async (body = input) => { const res = await invoke('coach-snapshot', body); const result = await res.json(); assert.equal(res.status, 200, JSON.stringify(result)); return result as CoachSnapshotCreated; };
  const ask = (s: CoachSnapshotCreated, requestId: string, identity = alice) => invoke('coach-chat', { ...s.snapshotRef, question: input.question, requestId }, identity);
  try {
    for (const file of ['001_deepseek_budget.sql', '002_coach_snapshots.sql', '003_persistent_online.sql']) await db.exec(await readFile(new URL(`../../migrations/coach/${file}`, import.meta.url), 'utf8'));
    await t.test('no identity, unsigned identity and sibling origins cannot create authorization', async () => {
      for (const id of ['', 'forged-alice']) assert.equal((await invoke('coach-snapshot', input, id)).status, 401);
      const cross = request('coach-snapshot', input, alice, 'POST', { origin: 'https://sibling.test', 'sec-fetch-site': 'same-site' });
      assert.equal((await handleCoachHttpRequest(cross, { env, runtime })).status, 403);
      assert.equal(calls, 0);
    });
    let persisted: CoachSnapshotCreated;
    await t.test('server ownership and explicit consent; owner switch cannot read or revoke', async () => {
      persisted = await snapshot();
      assert.deepEqual(persisted.factQuotes, input.declarations.map(declarationQuote));
      assert.equal((await ask(persisted, 'foreign_0001', bob)).status, 503);
      assert.equal((await invoke('coach-snapshot', persisted.snapshotRef, bob, 'DELETE')).status, 403);
      assert.equal(calls, 0);
      const first = await ask(persisted, 'request_0001');
      assert.equal(first.status, 200, JSON.stringify(await first.clone().json()));
      const answer = await first.json(); assert.equal(answer.planChanged, false);
      assert.match(answer.text, /^本次资料为用户申报，未核验设备或实验室原始记录。/);
      assert.equal(calls, 1);
    });
    await t.test('close/reopen persists refs, ownership and exact duplicate charge prevention', async () => {
      await db.close(); db = new PGlite(directory); runtime = runtimeFactory();
      assert.equal((await ask(persisted!, 'request_0001')).status, 409);
      assert.equal(calls, 1);
      const rows = await db.query<{ state: string; cost: string }>('SELECT state,actual_micros::text AS cost FROM coach_model_reservation WHERE request_id=$1', ['request_0001']);
      assert.deepEqual(rows.rows, [{ state: 'SETTLED', cost: '182' }]);
    });
    await t.test('new declaration revision invalidates old ref and binds question', async () => {
      const next = await snapshot({ ...input, declarations: [{ ...input.declarations[0], revision: 'v2', value: 6 }] });
      assert.equal((await ask(persisted!, 'request_0002')).status, 503);
      assert.equal((await invoke('coach-chat', { ...next.snapshotRef, question: '换一个问题', requestId: 'request_0003' })).status, 503);
      persisted = next;
    });
    await t.test('two simultaneous requests honor real persistent concurrency cap', async () => {
      let arrived!: () => void, release!: () => void;
      const atProvider = new Promise<void>(resolve => { arrived = resolve; });
      const wait = new Promise<void>(resolve => { release = resolve; });
      transport = async () => { calls++; arrived(); await wait; return provider(); };
      const first = ask(persisted!, 'request_0004'); await atProvider;
      assert.equal((await ask(persisted!, 'request_0005')).status, 429);
      release(); assert.equal((await first).status, 200);
    });
    await t.test('revoked while provider runs: billed once, result never released', async () => {
      const s = await snapshot();
      transport = async () => { calls++; assert.equal((await invoke('coach-snapshot', s.snapshotRef, alice, 'DELETE')).status, 200); return provider(); };
      const res = await ask(s, 'request_0006'); assert.equal(res.status, 502); assert.equal((await res.json()).error, 'OUTPUT_REJECTED');
      assert.equal((await ask(s, 'request_0007')).status, 503);
    });
    await t.test('corrected while provider runs: stale result never released', async () => {
      const s = await snapshot();
      transport = async () => { calls++; await snapshot({ ...input, declarations: [{ ...input.declarations[0], revision: 'v3', value: 7 }] }); return provider(); };
      assert.equal((await ask(s, 'request_0008')).status, 502);
    });
    await t.test('revoked after reserve but before dispatch releases the unsent reservation', async () => {
      const s = await snapshot(), reserve = runtime.services.ledger.reserve;
      const before = calls;
      runtime.services.ledger.reserve = async value => { const result = await reserve(value); await invoke('coach-snapshot', s.snapshotRef, alice, 'DELETE'); return result; };
      try { assert.equal((await ask(s, 'request_predispatch')).status, 403); }
      finally { runtime.services.ledger.reserve = reserve; }
      assert.equal(calls, before);
      const row = await db.query<{ state: string; cost: string }>('SELECT state,booked_micros::text AS cost FROM coach_model_reservation WHERE request_id=$1', ['request_predispatch']);
      assert.deepEqual(row.rows, [{ state: 'CANCELLED', cost: '0' }]);
    });
    await t.test('disclosed pain on an older record still blocks model dispatch', async () => {
      const before = calls;
      const s = await snapshot({ ...input, declarations: [...input.declarations, { ...input.declarations[0], recordId: 'older-pain', occurredAt: new Date(now - 7200000).toISOString(), metric: 'pain', value: 4 }] });
      const res = await ask(s, 'request_pain_local');
      assert.equal(res.status, 200); assert.equal((await res.json()).route, 'LOCAL'); assert.equal(calls, before);
    });
    await t.test('empty declarations remain unknown and do not fabricate completed history', async () => {
      const s = await snapshot({ ...input, declarations: [] });
      const subject = await runtime.services.authenticate(request('coach-chat', {}));
      const loaded = await runtime.snapshots.load(subject!, { ...s.snapshotRef, question: input.question });
      assert.equal(loaded!.rawInput.brief.occurrenceId, null); assert.equal(loaded!.rawInput.brief.durationSec, null);
      assert.deepEqual(loaded!.rawInput.brief.sources, []);
      transport = async () => { calls++; return provider(); };
      const res = await ask(s, 'request_empty_records'); assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    });
    await t.test('model cannot promote self reports to verified device evidence', async () => {
      const s = await snapshot();
      transport = async () => { calls++; return provider('实验室来源未核验，但是设备已验证训练来源。'); };
      const res = await ask(s, 'request_source_claim'); assert.equal(res.status, 502); assert.equal((await res.json()).error, 'OUTPUT_REJECTED');
    });
    await t.test('exact scalar quotes survive server validation without invented workout binding; modified units fail', async () => {
      const s = await snapshot();
      const makeReply = async (badUnit: boolean) => {
        const response = provider(); const value = await response.json();
        const quote = s.factQuotes[0];
        value.choices[0].message.content = JSON.stringify({ mode: 'answer', text: (badUnit ? quote.replace('/10', '小时') : quote) + '可先核对这条记录与当前感受是否一致；单项资料不足以确认恢复或批准加量。', citations: ['ref1'], evidenceQuotes: [{ sourceId: 'ref1', quote }], nextStep: null, medicalReferral: false, compareIds: null, seriesIds: null, planChanged: false });
        return Response.json(value);
      };
      transport = async (_url, init) => { calls++; const message = JSON.parse(String(init?.body)).messages[1].content; assert.doesNotMatch(message, /CONTINUOUS|continuousCount|repetitionSlots|completedSetCount/); assert.match(message, /活动|运动项目/); return makeReply(false); };
      const valid = await ask(s, 'request_valid_quote');
      assert.equal(valid.status, 200, JSON.stringify(await valid.clone().json())); const validBody=await valid.json();assert.ok(validBody.text.includes(s.factQuotes[0]));assert.match(validBody.text,/可先核对这条记录与当前感受是否一致/);assert.doesNotMatch(validBody.text,/请先选择一条有训练开始事件/);
      transport = async () => { calls++; return makeReply(true); };
      assert.equal((await ask(s, 'request_bad_unit')).status, 502);
    });
    await t.test('automatic persistent questions share grant; general education and causality survive actual controller checks', async () => {
      const modern={...input,question:'我没有腿疼，解释一下RPE',declarations:[],consent:{...input.consent,mode:'PERSISTENT' as const}};
      const a=await snapshot(modern),b=await snapshot({...modern,question:'力量训练为何引起肌肉适应'});
      assert.equal(a.snapshotRef.consentId,b.snapshotRef.consentId);
      transport=async()=>{calls++;return provider('一般科普：RPE通常用0到10表示主观用力程度。力量训练会引起肌肉适应，但速度因人而异。')};
      for(const [ref,question,id]of [[a,modern.question,'modern_general_1'],[b,'力量训练为何引起肌肉适应','modern_general_2']] as const){
        const res=await invoke('coach-chat',{...ref.snapshotRef,question,requestId:id});
        assert.equal(res.status,200,JSON.stringify(await res.clone().json()));
        const body=await res.json();assert.equal(body.source,'MODEL');assert.equal(body.dispatchState,'RETURNED');assert.equal(body.ledgerState,'SETTLED');assert.equal(body.validation.professionalValidation,'NOT_PROVEN');assert.equal(body.retrieval.state,'NOT_REQUESTED');
      }
      await invoke('coach-snapshot',a.snapshotRef,alice,'DELETE');
      assert.equal((await invoke('coach-chat',{...b.snapshotRef,question:'力量训练为何引起肌肉适应',requestId:'modern_after_cleanup'})).status,200);
    });
    await t.test('structured history survives as declared facts; false personal units and writes are rejected after settlement',async()=>{
      const modern={...input,question:'解释历史训练分段',declarations:[],consent:{...input.consent,mode:'PERSISTENT' as const},context:{version:'coach-context-v2' as const,dependencyVersions:[{key:'old-training',revision:'1'}],records:[{recordId:'old-record',revision:'1',occurredAt:'2026-01-01T00:00:00Z',knownAt:'2026-01-01T01:00:00Z',category:'TRAINING' as const,state:'ACTUAL' as const,source:'USER_DECLARED:APP',fields:[{name:'distance',value:400,unit:'m'},{name:'rest',value:120,unit:'s'}]}],coverage:{selected:1,omitted:2,unknowns:['LT2']}}};
      const s=await snapshot(modern);
      transport=async(_url,init)=>{
        calls++;const packet=JSON.parse(JSON.parse(String(init?.body)).messages[1].content);assert.equal(packet.coverage.omitted,2);assert.match(packet.facts[0].detail,/2026-01-01/);assert.doesNotMatch(String(init?.body),/synthetic-owner|alice|x-grok-identity/);
        const response=await provider().json();response.choices[0].message.content=JSON.stringify({mode:'answer',text:s.contextQuotes![0]+'这条历史分段可作为比较起点，仍需核对协议是否一致。',citations:['ref1'],evidenceQuotes:[{sourceId:'ref1',quote:s.contextQuotes![0]}],nextStep:null,medicalReferral:false,compareIds:null,seriesIds:null,planChanged:false});return Response.json(response);
      };
      const good=await invoke('coach-chat',{...s.snapshotRef,question:modern.question,requestId:'modern_context_good'});assert.equal(good.status,200,JSON.stringify(await good.clone().json()));
      for(const [index,text]of ['你昨天跑了5公里。','已为你修改课表。','你的休息是120公里。','根据最新网页，已经查到你的训练方法。'].entries()){
        transport=async()=>{calls++;return provider(text)};
        const res=await invoke('coach-chat',{...s.snapshotRef,question:modern.question,requestId:`modern_context_bad_${index}`});const body=await res.json();assert.equal(res.status,502);assert.equal(body.error,'OUTPUT_REJECTED');assert.equal(body.dispatchState,'RETURNED');assert.equal(body.ledgerState,'SETTLED');
      }
      transport=async()=>{calls++;return provider('你昨天跑了5公里。一般力量训练会引起肌肉适应，个体差异仍需观察。')};
      const partial=await invoke('coach-chat',{...s.snapshotRef,question:modern.question,requestId:'modern_partial'}),partialBody=await partial.json();
      assert.equal(partial.status,200);assert.doesNotMatch(partialBody.text,/5公里/);assert.match(partialBody.text,/肌肉适应/);assert.match(partialBody.text,/已省略/);assert.equal(partialBody.validation.status,'PARTIALLY_ACCEPTED');
    });
    await t.test('two independent modern requests complete concurrently within an isolated verified synthetic cap',async()=>{
      const isolated=new PGlite();let release=()=>{};let timeout:ReturnType<typeof setTimeout>|undefined;
      try{
        for(const f of ['001_deepseek_budget.sql','002_coach_snapshots.sql','003_persistent_online.sql'])await isolated.exec(await readFile(new URL(`../../migrations/coach/${f}`,import.meta.url),'utf8'));
        const modern={...input,declarations:[],consent:{...input.consent,mode:'PERSISTENT' as const}};
        let arrivals=0,ready!:()=>void;
        const reached=new Promise<void>(r=>{ready=r}),gate=new Promise<void>(r=>{release=r});
        const parallel=createCoachServices({db:createPgliteTransactionAdapter(isolated),authenticate,now:()=>currentTime,policy:()=>({...policy,caps:{...policy.caps,concurrency:2}}),fetch:async()=>{calls++;if(++arrivals===2)ready();await gate;return provider('一般力量训练会引起适应，个体变化还需观察。')}});
        const send=(path:string,body:unknown)=>handleCoachHttpRequest(request(path,body),{env,runtime:parallel});
        const a=await (await send('coach-snapshot',modern)).json(),b=await(await send('coach-snapshot',{...modern,question:'解释一般力量适应'})).json();
        const pending=[send('coach-chat',{...a.snapshotRef,question:modern.question,requestId:'modern_parallel_a'}),send('coach-chat',{...b.snapshotRef,question:'解释一般力量适应',requestId:'modern_parallel_b'})];
        await Promise.race([reached,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('parallel provider arrivals timed out')),3000)})]);release();
        assert.deepEqual((await Promise.all(pending)).map(r=>r.status),[200,200]);assert.equal(arrivals,2);
      }finally{release();clearTimeout(timeout);await isolated.close()}
    });
    await t.test('settings revocation persists and ordinary requests cannot silently reenable; explicit enable resumes',async()=>{
      const modern={...input,consent:{...input.consent,mode:'PERSISTENT' as const}};
      const s=await snapshot(modern);
      const off=await invoke('coach-snapshot',{onlineConsent:{enabled:false,disclosureVersion:'coach-self-report-v1'}});assert.equal(off.status,200);
      assert.equal((await invoke('coach-snapshot',modern)).status,403);
      assert.equal((await ask(s,'modern_after_off')).status,503);
      assert.equal((await invoke('coach-snapshot',{onlineConsent:{enabled:true,disclosureVersion:'coach-self-report-v1'}})).status,200);
      const resumed=await snapshot(modern);assert.notEqual(resumed.snapshotRef.consentId,s.snapshotRef.consentId);
    });
    await t.test('expired refs fail before dispatch and status does not authenticate or charge', async () => {
      const s = await snapshot(); currentTime += 11 * 60000;
      const before = calls; assert.equal((await ask(s, 'request_0009')).status, 503);
      runtime.services.authenticate = async () => { throw Error('status must never authenticate'); };
      const res = await handleCoachHttpRequest(new Request('https://coach.test/api/coach-chat'), { env, runtime });
      const body = await res.json(); assert.equal(res.status, 200); assert.equal(body.connectionVerified, false); assert.equal(calls, before);
    });
  } finally {
    if(process.env.FK_CAPTURE_ONLINE_EXAMPLES==='1'){
      const out=new URL('../../verification/implementation-20261028/online-backend/',import.meta.url);await mkdir(out,{recursive:true});await writeFile(new URL('controller-output-examples.json',out),JSON.stringify({synthetic:true,paidCalls:0,examples},null,2)+'\n');
    }
    await db.close(); await rm(directory, { recursive: true, force: true });
    for (const [key, value] of Object.entries(oldEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
