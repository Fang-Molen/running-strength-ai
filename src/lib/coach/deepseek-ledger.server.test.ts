import test, { before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import {
  createDeepSeekLedger, createPgliteTransactionAdapter, createPgTransactionAdapter,
  validateLedgerReservation, LedgerError,
  type ReserveInput, type LedgerCaps, type ReservationBinding, type LedgerDatabase,
} from './deepseek-ledger.server.ts'

// Real embedded PostgreSQL SQL + transactions, synthetic identities only. This
// is NOT a production DB migration / durability / multi-process lock acceptance.
const pg = new PGlite()
const db = createPgliteTransactionAdapter(pg)
const ledger = createDeepSeekLedger(db)
const hash = 'a'.repeat(64)
const baseCaps: LedgerCaps = {
  campaignCalls:120,pilotCalls:8,campaignCostMicros:'100000',
  ownerCalls:120,ownerCostMicros:'100000',concurrency:10,
  globalDailyCalls:240,globalDailyCostMicros:'200000',
  ownerDailyCalls:120,ownerDailyCostMicros:'100000',perCallCostMicros:'1000',
}
function input(id: string, overrides: Partial<ReserveInput> = {}, caps: Partial<LedgerCaps> = {}): ReserveInput {
  return {requestId:id,ownerId:'synthetic-owner',campaignId:'public-dev-60',phase:'evaluation',
    day:'2026-10-19',contextHash:hash,modelHash:'b'.repeat(64),configHash:'c'.repeat(64),
    worstCostMicros:'100',...overrides,caps:{...baseCaps,...caps}}
}
function binding(i: ReserveInput): ReservationBinding {
  const {requestId,ownerId,contextHash,modelHash,configHash} = i
  return {requestId,ownerId,contextHash,modelHash,configHash}
}
const isCode = (code: string) => (err: unknown) => err instanceof LedgerError && err.code === code
async function charge(i: ReserveInput, actual = '60') {
  await ledger.reserve(i); await ledger.markDispatched(binding(i))
  return ledger.settle({...binding(i),outcome:'SUCCESS',actualCostMicros:actual,usageHash:'d'.repeat(64)})
}
async function account(scope: string[]) {
  const r = await pg.query<{calls:number;micros:string;active:number;blocked:boolean}>(
    'SELECT calls,charged_micros::text AS micros,active,blocked FROM coach_model_budget_account WHERE account_key=$1',[JSON.stringify(scope)])
  return r.rows[0]
}
before(async () => { await pg.exec(await readFile(new URL('../../../migrations/coach/001_deepseek_budget.sql',import.meta.url),'utf8')) })
beforeEach(async () => { await pg.exec('TRUNCATE coach_model_reservation_account,coach_model_reservation,coach_model_budget_account') })
after(async () => { await pg.close() })

for (const key of Object.keys(baseCaps) as (keyof LedgerCaps)[]) {
  test(`unknown cap ${key} fails closed before SQL`, () => {
    assert.throws(() => validateLedgerReservation(input('unknown',{}, {[key]:null})),LedgerError)
  })
}
test('money uses exact integer strings; invalid values and per-call overflow refuse', () => {
  for (const value of ['0','-1','1.5','01','NaN','9007199254740992.5','1e9']) {
    assert.throws(() => validateLedgerReservation(input('bad',{worstCostMicros:value})),LedgerError)
  }
  assert.throws(() => validateLedgerReservation(input('too-much',{worstCostMicros:'1001'})),isCode('PER_CALL_BUDGET_EXCEEDED'))
  assert.throws(() => validateLedgerReservation(input('bad-day',{day:'2026-02-30'})),isCode('INVALID_DAY'))
})
test('reserve charges worst case, verified settlement replaces cost but keeps the call', async () => {
  const i=input('one'); assert.equal((await ledger.reserve(i)).status,'RESERVED')
  assert.deepEqual(await account(['campaign',i.campaignId]),{calls:1,micros:'100',active:1,blocked:false})
  await ledger.markDispatched(binding(i))
  assert.equal((await ledger.settle({...binding(i),outcome:'SUCCESS',actualCostMicros:'60',usageHash:hash})).state,'SETTLED')
  assert.deepEqual(await account(['campaign',i.campaignId]),{calls:1,micros:'60',active:0,blocked:false})
})
test('twenty concurrent duplicate requests reserve once across ledger instances', async () => {
  const i=input('same'), other=createDeepSeekLedger(db)
  const results=await Promise.all(Array.from({length:20},(_,n)=>(n%2?other:ledger).reserve(i)))
  assert.equal(results.filter(r=>r.status==='RESERVED').length,1)
  assert.equal(results.filter(r=>r.status==='DUPLICATE').length,19)
  assert.deepEqual(await account(['campaign',i.campaignId]),{calls:1,micros:'100',active:1,blocked:false})
})
test('one request ID cannot change owner, context, model, config, day, worst price or phase', async () => {
  const i=input('bound');await ledger.reserve(i)
  const variants:Partial<ReserveInput>[]=[{ownerId:'other'},{contextHash:'d'.repeat(64)},{modelHash:'d'.repeat(64)},
    {configHash:'d'.repeat(64)},{day:'2026-10-20'},{worstCostMicros:'101'},{phase:'pilot'},{campaignId:'other-campaign'}]
  for(const change of variants) await assert.rejects(ledger.reserve({...i,...change}),isCode('REQUEST_BINDING_CONFLICT'))
  assert.deepEqual(await account(['campaign',i.campaignId]),{calls:1,micros:'100',active:1,blocked:false})
})
test('cap policy cannot be raised for an existing account', async () => {
  await ledger.reserve(input('policy-1'))
  await assert.rejects(ledger.reserve(input('policy-2',{}, {campaignCalls:121})),isCode('ACCOUNT_POLICY_CONFLICT'))
})
test('concurrent budget competition rejects overspend and rolls back rejected request rows', async () => {
  const caps={campaignCostMicros:'300',ownerCostMicros:'300'}
  const results=await Promise.allSettled(Array.from({length:20},(_,n)=>createDeepSeekLedger(db).reserve(input(`race-${n}`,{},caps))))
  assert.equal(results.filter(r=>r.status==='fulfilled').length,3)
  for(const r of results) if(r.status==='rejected') assert.equal(r.reason.code,'MONEY_BUDGET_EXCEEDED')
  assert.deepEqual(await account(['campaign','public-dev-60']),{calls:3,micros:'300',active:3,blocked:false})
  assert.equal((await pg.query<{n:number}>('SELECT count(*)::int AS n FROM coach_model_reservation')).rows[0].n,3)
})
test('concurrency cap applies across instances and is released only by verified completion', async () => {
  const caps={concurrency:2}
  const results=await Promise.allSettled(Array.from({length:8},(_,n)=>ledger.reserve(input(`parallel-${n}`,{},caps))))
  assert.equal(results.filter(r=>r.status==='fulfilled').length,2)
  for(const r of results) if(r.status==='rejected') assert.equal(r.reason.code,'CONCURRENCY_EXCEEDED')
  const i=input('parallel-0',{},caps);await ledger.markDispatched(binding(i))
  await ledger.settle({...binding(i),outcome:'SUCCESS',actualCostMicros:'40',usageHash:hash})
  await ledger.reserve(input('parallel-next',{},caps))
  assert.deepEqual(await account(['campaign','public-dev-60']),{calls:3,micros:'240',active:2,blocked:false})
})
test('pilot eight counts inside campaign 120; evaluation cannot reset the campaign budget', async () => {
  const caps={concurrency:200,ownerCalls:200,ownerDailyCalls:200}
  for(let n=0;n<8;n++) await ledger.reserve(input(`pilot-${n}`,{phase:'pilot'},caps))
  await assert.rejects(ledger.reserve(input('pilot-ninth',{phase:'pilot'},caps)),isCode('CALL_BUDGET_EXCEEDED'))
  for(let n=0;n<112;n++) await ledger.reserve(input(`eval-${n}`,{},caps))
  await assert.rejects(ledger.reserve(input('eval-121',{},caps)),isCode('CALL_BUDGET_EXCEEDED'))
  assert.equal((await account(['campaign','public-dev-60'])).calls,120)
  assert.equal((await account(['pilot','public-dev-60'])).calls,8)
})
test('daily global cap is shared by different campaigns and owners', async () => {
  const caps={campaignCalls:8,pilotCalls:8,globalDailyCalls:2}
  await ledger.reserve(input('global-1',{},caps))
  await ledger.reserve(input('global-2',{ownerId:'synthetic-other',campaignId:'another-campaign'},caps))
  await assert.rejects(ledger.reserve(input('global-3',{ownerId:'third',campaignId:'third-campaign'},caps)),isCode('CALL_BUDGET_EXCEEDED'))
  assert.equal((await account(['global-day','2026-10-19'])).calls,2)
})
test('different owners share one campaign call cap', async () => {
  const caps={campaignCalls:8,pilotCalls:8}
  for(let n=0;n<8;n++)await ledger.reserve(input(`shared-${n}`,{ownerId:`synthetic-owner-${n}`},caps))
  await assert.rejects(ledger.reserve(input('shared-ninth',{ownerId:'synthetic-owner-9'},caps)),isCode('CALL_BUDGET_EXCEEDED'))
  assert.equal((await account(['campaign','public-dev-60'])).calls,8)
})
test('one owner daily cap survives a campaign change', async () => {
  const caps={ownerDailyCalls:1}
  await charge(input('daily-owner-first',{},caps))
  await assert.rejects(ledger.reserve(input('daily-owner-next',{campaignId:'second-campaign'},caps)),isCode('CALL_BUDGET_EXCEEDED'))
})
test('per-owner budget is independent and cannot borrow other owners allowance', async () => {
  const caps={ownerCalls:1}
  await charge(input('owner-first',{},caps))
  await assert.rejects(ledger.reserve(input('owner-second',{},caps)),isCode('CALL_BUDGET_EXCEEDED'))
  await ledger.reserve(input('owner-other',{ownerId:'synthetic-other'},caps))
})
test('new ledger object reads same database; no in-memory counters survive outside SQL', async () => {
  const i=input('refresh');await charge(i)
  const refreshed=createDeepSeekLedger(createPgliteTransactionAdapter(pg))
  assert.equal((await refreshed.reserve(i)).state,'SETTLED')
  await refreshed.reserve(input('refresh-next'))
  assert.deepEqual(await account(['campaign',i.campaignId]),{calls:2,micros:'160',active:1,blocked:false})
})
test('markDispatched is one-shot; duplicate cannot send and sent requests cannot be refunded', async () => {
  const i=input('dispatch');await ledger.reserve(i);await ledger.markDispatched(binding(i))
  await assert.rejects(ledger.markDispatched(binding(i)),isCode('ALREADY_DISPATCHED_OR_TERMINAL'))
  await assert.rejects(ledger.settle({...binding(i),outcome:'NOT_SENT',actualCostMicros:null,usageHash:null}),isCode('CANNOT_REFUND_DISPATCHED_REQUEST'))
})
test('proven pre-dispatch cancellation returns reservation only and remains idempotent', async () => {
  const i=input('cancel');await ledger.reserve(i)
  const receipt={...binding(i),outcome:'NOT_SENT' as const,actualCostMicros:null,usageHash:null}
  assert.equal((await ledger.settle(receipt)).state,'CANCELLED');await ledger.settle(receipt)
  assert.deepEqual(await account(['campaign',i.campaignId]),{calls:0,micros:'0',active:0,blocked:false})
  assert.equal((await ledger.reserve(i)).state,'CANCELLED')
})
test('verified settlement is idempotent; changed usage or owner cannot overwrite it', async () => {
  const i=input('settled');await ledger.reserve(i);await ledger.markDispatched(binding(i))
  const receipt={...binding(i),outcome:'SUCCESS' as const,actualCostMicros:'60',usageHash:hash}
  await ledger.settle(receipt);await ledger.settle(receipt)
  await assert.rejects(ledger.settle({...receipt,actualCostMicros:'50'}),isCode('SETTLEMENT_CONFLICT'))
  await assert.rejects(ledger.settle({...receipt,ownerId:'another'}),isCode('REQUEST_BINDING_CONFLICT'))
  assert.equal((await account(['campaign',i.campaignId])).micros,'60')
})
test('SUCCESS requires complete verified usage hash and actual money, never guessed zero', async () => {
  const i=input('usage');await ledger.reserve(i);await ledger.markDispatched(binding(i))
  await assert.rejects(ledger.settle({...binding(i),outcome:'SUCCESS',actualCostMicros:null,usageHash:null}),LedgerError)
  await assert.rejects(ledger.settle({...binding(i),outcome:'SUCCESS',actualCostMicros:'0',usageHash:null}),isCode('VERIFIED_USAGE_REQUIRED'))
  assert.equal((await account(['campaign',i.campaignId])).micros,'100')
})
test('timeout/unknown retains worst cost and active call, freezes even next day campaign', async () => {
  const i=input('timeout');await ledger.reserve(i);await ledger.markDispatched(binding(i))
  const receipt={...binding(i),outcome:'UNKNOWN' as const,actualCostMicros:null,usageHash:null}
  await ledger.settle(receipt);await ledger.settle(receipt)
  assert.deepEqual(await account(['campaign',i.campaignId]),{calls:1,micros:'100',active:1,blocked:true})
  await assert.rejects(ledger.reserve(input('after-timeout',{day:'2026-10-20'})),isCode('UNRECONCILED_USAGE'))
  await assert.rejects(ledger.settle({...binding(i),outcome:'SUCCESS',actualCostMicros:'30',usageHash:hash}),isCode('SETTLEMENT_CONFLICT'))
})
test('unknown usage also prevents dispatch of a previously reserved second call', async () => {
  const a=input('unknown-a'), b=input('reserved-b')
  await ledger.reserve(a);await ledger.reserve(b);await ledger.markDispatched(binding(a))
  await ledger.settle({...binding(a),outcome:'UNKNOWN',actualCostMicros:null,usageHash:null})
  await assert.rejects(ledger.markDispatched(binding(b)),isCode('UNRECONCILED_USAGE'))
})
test('review reconciliation replaces unknown worst cost, releases active and preserves call', async () => {
  const i=input('review');await ledger.reserve(i);await ledger.markDispatched(binding(i))
  await ledger.settle({...binding(i),outcome:'UNKNOWN',actualCostMicros:null,usageHash:null})
  const review={...binding(i),reviewId:'synthetic-review-1',reviewerId:'trusted-reviewer',outcome:'CHARGED' as const,actualCostMicros:'45',usageHash:hash}
  await ledger.reconcile(review);await ledger.reconcile(review)
  assert.deepEqual(await account(['campaign',i.campaignId]),{calls:1,micros:'45',active:0,blocked:false})
  await assert.rejects(ledger.reconcile({...review,actualCostMicros:'30'}),isCode('RECONCILIATION_CONFLICT'))
  await ledger.reserve(input('after-review'))
})
test('several unknowns keep account frozen until ALL are independently reconciled', async () => {
  const a=input('unknown-1'),b=input('unknown-2')
  for(const i of[a,b]){await ledger.reserve(i);await ledger.markDispatched(binding(i))}
  for(const i of[a,b])await ledger.settle({...binding(i),outcome:'UNKNOWN',actualCostMicros:null,usageHash:null})
  const review=(i:ReserveInput)=>({...binding(i),reviewId:i.requestId,reviewerId:'reviewer',outcome:'CHARGED' as const,actualCostMicros:'40',usageHash:hash})
  await ledger.reconcile(review(a));assert.equal((await account(['campaign',a.campaignId])).blocked,true)
  await ledger.reconcile(review(b));assert.equal((await account(['campaign',a.campaignId])).blocked,false)
})
test('independent proof of non-dispatch can reconcile unknown with zero cost and zero calls', async () => {
  const i=input('proven-no-send');await ledger.reserve(i)
  await ledger.settle({...binding(i),outcome:'UNKNOWN',actualCostMicros:null,usageHash:null})
  await assert.rejects(ledger.reconcile({...binding(i),reviewId:'review',reviewerId:'reviewer',
    outcome:'PROVEN_NOT_SENT',actualCostMicros:'1',usageHash:hash}),isCode('INVALID_RECONCILIATION'))
  await ledger.reconcile({...binding(i),reviewId:'review',reviewerId:'reviewer',outcome:'PROVEN_NOT_SENT',actualCostMicros:'0',usageHash:hash})
  assert.deepEqual(await account(['campaign',i.campaignId]),{calls:0,micros:'0',active:0,blocked:false})
})
test('actual cost greater than reserve records truth and freezes instead of silent overspend', async () => {
  const i=input('overrun');await ledger.reserve(i);await ledger.markDispatched(binding(i))
  const result=await ledger.settle({...binding(i),outcome:'SUCCESS',actualCostMicros:'125',usageHash:hash})
  assert.equal(result.state,'UNKNOWN');assert.equal(result.overrun,true)
  assert.deepEqual(await account(['campaign',i.campaignId]),{calls:1,micros:'125',active:1,blocked:true})
})
test('integers beyond JS safe-number range remain exact in SQL accounting', async () => {
  const n='9007199254740993', caps={campaignCostMicros:'99999999999999999',ownerCostMicros:'99999999999999999',
    globalDailyCostMicros:'99999999999999999',ownerDailyCostMicros:'99999999999999999',perCallCostMicros:n}
  const i=input('exact',{worstCostMicros:n},caps);await ledger.reserve(i)
  assert.equal((await account(['campaign',i.campaignId])).micros,n)
})
test('SQL failure halfway through reserve rolls back request, all accounts and counters', async () => {
  let queries=0
  const failing:LedgerDatabase={transaction:work=>db.transaction(tx=>work({query:async<R>(text:string,params?:unknown[])=>{
    queries++;if(queries===8)throw new Error('synthetic injected SQL interruption')
    return tx.query<R>(text,params)
  }}))}
  await assert.rejects(createDeepSeekLedger(failing).reserve(input('interrupted')),/synthetic injected SQL interruption/)
  assert.equal((await pg.query<{n:number}>('SELECT count(*)::int AS n FROM coach_model_reservation')).rows[0].n,0)
  assert.equal((await pg.query<{n:number}>('SELECT count(*)::int AS n FROM coach_model_budget_account')).rows[0].n,0)
})
test('pg adapter pins one client, commits on success, rolls back error and always releases', async () => {
  const events:string[]=[]
  const client={query:async(sql:string)=>{events.push(sql);return {rows:[{ok:true}]}},release:()=>events.push('release')}
  const pool={connect:async()=>{events.push('connect');return client}}
  const adapted=createPgTransactionAdapter(pool as unknown as Parameters<typeof createPgTransactionAdapter>[0])
  await adapted.transaction(async tx=>{await tx.query('SELECT synthetic')})
  assert.deepEqual(events,['connect','BEGIN','SELECT synthetic','COMMIT','release'])
  events.length=0
  await assert.rejects(adapted.transaction(async()=>{throw new Error('fail')}),/fail/)
  assert.deepEqual(events,['connect','BEGIN','ROLLBACK','release'])
})
