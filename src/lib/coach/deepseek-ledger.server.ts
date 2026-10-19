/**
 * Server-only, opt-in persistent budget ledger. No env access, network, schema
 * bootstrap or getSql() fallback. The host must explicitly supply a transactional
 * connection to the SAME app database after reviewing the opt-in migration.
 * Monetary values are decimal integer strings in ONE campaign-approved currency
 * unit (microcurrency); never float/rounded client-supplied estimates.
 */
import { createHash } from 'node:crypto'
import type { Pool } from 'pg'
import type { PGlite } from '@electric-sql/pglite'

export type LedgerState = 'RESERVED' | 'DISPATCHED' | 'SETTLED' | 'UNKNOWN' | 'CANCELLED'
export type LedgerCaps = {
  campaignCalls: number | null
  pilotCalls: number | null
  campaignCostMicros: string | null
  ownerCalls: number | null
  ownerCostMicros: string | null
  concurrency: number | null
  globalDailyCalls: number | null
  globalDailyCostMicros: string | null
  ownerDailyCalls: number | null
  ownerDailyCostMicros: string | null
  perCallCostMicros: string | null
}
export type ReservationBinding = {
  requestId: string; ownerId: string; contextHash: string; modelHash: string; configHash: string
}
export type ReserveInput = ReservationBinding & {
  campaignId: string; phase: 'pilot' | 'evaluation'; day: string
  worstCostMicros: string; caps: LedgerCaps
}
export type SettleInput = ReservationBinding & {
  outcome: 'SUCCESS' | 'NOT_SENT' | 'UNKNOWN'
  actualCostMicros: string | null
  usageHash: string | null
}
export type ReconcileInput = ReservationBinding & {
  // Must come from the trusted host's separately authorised review workflow.
  // The ledger does not authenticate reviewers itself.
  reviewId: string; reviewerId: string
  outcome: 'CHARGED' | 'PROVEN_NOT_SENT'
  actualCostMicros: string; usageHash: string
}
export type LedgerReservation = {
  status: 'RESERVED' | 'DUPLICATE'; reservationId: string; state: LedgerState
}
export type LedgerResult = { reservationId: string; state: LedgerState; overrun?: boolean }
export interface LedgerTransaction {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
}
export interface LedgerDatabase {
  transaction<T>(work: (tx: LedgerTransaction) => Promise<T>): Promise<T>
}
export class LedgerError extends Error {
  constructor(public code: string) { super(code); this.name = 'LedgerError' }
}
const fail = (code: string): never => { throw new LedgerError(code) }
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const HASH = /^[a-f0-9]{64}$/
function positiveInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return fail('UNKNOWN_OR_INVALID_CAP')
  return value
}
function money(value: unknown, zero = false): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,28})$/.test(value)) return fail('UNKNOWN_OR_INVALID_MONEY')
  const n = BigInt(value)
  if (!zero && n === 0n) return fail('UNKNOWN_OR_INVALID_MONEY')
  return n
}
function identifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /[\x00-\x1f]/.test(value)) fail('INVALID_ID')
}
function validateBinding(b: ReservationBinding): void {
  identifier(b.requestId); identifier(b.ownerId)
  if (![b.contextHash, b.modelHash, b.configHash].every(h => typeof h === 'string' && HASH.test(h))) fail('INVALID_BINDING_HASH')
}
/** Pure preflight only. Actual global enforcement occurs inside SQL transactions. */
export function validateLedgerReservation(input: ReserveInput): void {
  validateBinding(input); identifier(input.campaignId)
  const day = new Date(input.day + 'T00:00:00Z')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day) || !Number.isFinite(day.valueOf()) || day.toISOString().slice(0, 10) !== input.day) fail('INVALID_DAY')
  if (!['pilot', 'evaluation'].includes(input.phase)) fail('INVALID_PHASE')
  const c = input.caps
  if (!c || typeof c !== 'object') fail('UNKNOWN_OR_INVALID_CAP')
  for (const key of ['campaignCalls', 'pilotCalls', 'ownerCalls', 'concurrency', 'globalDailyCalls', 'ownerDailyCalls'] as const) positiveInt(c[key])
  for (const key of ['campaignCostMicros', 'ownerCostMicros', 'globalDailyCostMicros', 'ownerDailyCostMicros', 'perCallCostMicros'] as const) money(c[key])
  if (c.pilotCalls! > c.campaignCalls!) fail('PILOT_CAP_EXCEEDS_CAMPAIGN')
  if (money(input.worstCostMicros) > money(c.perCallCostMicros)) fail('PER_CALL_BUDGET_EXCEEDED')
}
type AccountSpec = { key: string; calls: number; micros: string; concurrent: number }
type Account = { account_key: string; cap_calls: number; cap_micros: string; cap_concurrent: number; calls: number; charged_micros: string; active: number; blocked: boolean }
type Row = { request_id: string; owner_id: string; campaign_id: string; binding_hash: string; context_hash: string; model_hash: string; config_hash: string; state: LedgerState; worst_micros: string; booked_micros: string; receipt_hash: string | null; usage_hash: string | null; actual_micros: string | null; reconciliation_hash: string | null }
// JSON tuples avoid delimiter collisions in user/campaign identifiers.
function accountSpecs(i: ReserveInput): AccountSpec[] {
  const c = i.caps
  const make = (scope: string[], calls: number | null, micros: string | null): AccountSpec => ({key: JSON.stringify(scope), calls: calls!, micros: micros!, concurrent: c.concurrency!})
  const specs = [
    make(['campaign', i.campaignId], c.campaignCalls, c.campaignCostMicros),
    make(['owner', i.campaignId, i.ownerId], c.ownerCalls, c.ownerCostMicros),
    make(['global-day', i.day], c.globalDailyCalls, c.globalDailyCostMicros),
    make(['owner-day', i.day, i.ownerId], c.ownerDailyCalls, c.ownerDailyCostMicros),
  ]
  if (i.phase === 'pilot') specs.push(make(['pilot', i.campaignId], c.pilotCalls, c.campaignCostMicros))
  return specs.sort((a,b) => a.key.localeCompare(b.key))
}
const rowSelect = `SELECT request_id, owner_id, campaign_id, binding_hash, context_hash, model_hash, config_hash, state,
 worst_micros::text, booked_micros::text, receipt_hash, usage_hash, actual_micros::text, reconciliation_hash
 FROM coach_model_reservation WHERE request_id=$1 FOR UPDATE`
function assertBinding(row: Row, b: ReservationBinding): void {
  if (row.owner_id !== b.ownerId || row.context_hash !== b.contextHash || row.model_hash !== b.modelHash || row.config_hash !== b.configHash) fail('REQUEST_BINDING_CONFLICT')
}
async function lockAccounts(tx: LedgerTransaction, requestId: string): Promise<Account[]> {
  return tx.query<Account>(`SELECT a.account_key, a.cap_calls, a.cap_micros::text, a.cap_concurrent,
    a.calls, a.charged_micros::text, a.active, a.blocked FROM coach_model_budget_account a
    JOIN coach_model_reservation_account r ON r.account_key=a.account_key
    WHERE r.request_id=$1 ORDER BY a.account_key FOR UPDATE OF a`, [requestId])
}
async function replaceCharge(tx: LedgerTransaction, accounts: Account[], previous: string, next: string, releaseActive: boolean, releaseCall: boolean, block: boolean): Promise<void> {
  for (const a of accounts) {
    await tx.query(`UPDATE coach_model_budget_account SET charged_micros=charged_micros-$2::numeric+$3::numeric,
      active=active-$4, calls=calls-$5, blocked=blocked OR $6 WHERE account_key=$1`,
      [a.account_key, previous, next, releaseActive ? 1 : 0, releaseCall ? 1 : 0, block])
  }
}

export function createDeepSeekLedger(db: LedgerDatabase) {
  if (!db || typeof db.transaction !== 'function') fail('TRANSACTION_ADAPTER_REQUIRED')
  return {
    async reserve(input: ReserveInput): Promise<LedgerReservation> {
      validateLedgerReservation(input)
      const caps = Object.keys(input.caps).sort().map(key => [key,input.caps[key as keyof LedgerCaps]])
      const bindingHash = digest([input.ownerId,input.campaignId,input.phase,input.day,input.contextHash,input.modelHash,input.configHash,input.worstCostMicros,caps])
      return db.transaction(async tx => {
        // Request first, then account locks: reserve/settle/reconcile all acquire
        // locks in the same order and a concurrent duplicate cannot be sent twice.
        const inserted = await tx.query<Row>(`INSERT INTO coach_model_reservation
          (request_id,owner_id,campaign_id,binding_hash,context_hash,model_hash,config_hash,state,worst_micros,booked_micros)
          VALUES($1,$2,$3,$4,$5,$6,$7,'RESERVED',$8::numeric,$8::numeric)
          ON CONFLICT(request_id) DO NOTHING RETURNING request_id`,
          [input.requestId,input.ownerId,input.campaignId,bindingHash,input.contextHash,input.modelHash,input.configHash,input.worstCostMicros])
        if (!inserted.length) {
          const [existing] = await tx.query<Row>(rowSelect, [input.requestId])
          assertBinding(existing,input)
          if (existing.binding_hash !== bindingHash) fail('REQUEST_BINDING_CONFLICT')
          return {status:'DUPLICATE',reservationId:input.requestId,state:existing.state}
        }
        // First create/lock accounts in a stable order. Postgres locks are held on
        // a pinned transaction connection, so separate processes cannot overspend.
        const accounts: Account[] = []
        for (const spec of accountSpecs(input)) {
          await tx.query(`INSERT INTO coach_model_budget_account(account_key,cap_calls,cap_micros,cap_concurrent)
            VALUES($1,$2,$3::numeric,$4) ON CONFLICT(account_key) DO NOTHING`, [spec.key,spec.calls,spec.micros,spec.concurrent])
          const [a] = await tx.query<Account>(`SELECT account_key,cap_calls,cap_micros::text,cap_concurrent,calls,charged_micros::text,active,blocked
            FROM coach_model_budget_account WHERE account_key=$1 FOR UPDATE`, [spec.key])
          if (!a || a.cap_calls !== spec.calls || a.cap_micros !== spec.micros || a.cap_concurrent !== spec.concurrent) fail('ACCOUNT_POLICY_CONFLICT')
          accounts.push(a)
        }
        for (const a of accounts) {
          if (a.blocked) fail('UNRECONCILED_USAGE')
          if (a.calls + 1 > a.cap_calls) fail('CALL_BUDGET_EXCEEDED')
          if (BigInt(a.charged_micros) + BigInt(input.worstCostMicros) > BigInt(a.cap_micros)) fail('MONEY_BUDGET_EXCEEDED')
          if (a.active + 1 > a.cap_concurrent) fail('CONCURRENCY_EXCEEDED')
        }
        for (const a of accounts) {
          await tx.query(`UPDATE coach_model_budget_account SET calls=calls+1,
            charged_micros=charged_micros+$2::numeric,active=active+1 WHERE account_key=$1`, [a.account_key,input.worstCostMicros])
          await tx.query(`INSERT INTO coach_model_reservation_account(request_id,account_key) VALUES($1,$2)`, [input.requestId,a.account_key])
        }
        return {status:'RESERVED',reservationId:input.requestId,state:'RESERVED'}
      })
    },
    async markDispatched(binding: ReservationBinding): Promise<LedgerResult> {
      validateBinding(binding)
      return db.transaction(async tx => {
        const [row] = await tx.query<Row>(rowSelect,[binding.requestId])
        if (!row) fail('RESERVATION_NOT_FOUND')
        assertBinding(row,binding)
        if (row.state !== 'RESERVED') fail('ALREADY_DISPATCHED_OR_TERMINAL')
        const accounts = await lockAccounts(tx,binding.requestId)
        if (accounts.some(a => a.blocked)) fail('UNRECONCILED_USAGE')
        await tx.query(`UPDATE coach_model_reservation SET state='DISPATCHED',updated_at=now() WHERE request_id=$1`, [binding.requestId])
        return {reservationId:binding.requestId,state:'DISPATCHED'}
      })
    },
    async settle(input: SettleInput): Promise<LedgerResult> {
      validateBinding(input)
      if (!['SUCCESS','NOT_SENT','UNKNOWN'].includes(input.outcome)) fail('INVALID_SETTLEMENT')
      if (input.outcome === 'SUCCESS') {
        money(input.actualCostMicros,true)
        if (!input.usageHash || !HASH.test(input.usageHash)) fail('VERIFIED_USAGE_REQUIRED')
      } else if (input.actualCostMicros !== null || input.usageHash !== null) fail('INVALID_SETTLEMENT')
      const receiptHash = digest([input.outcome,input.actualCostMicros,input.usageHash])
      return db.transaction(async tx => {
        const [row] = await tx.query<Row>(rowSelect,[input.requestId])
        if (!row) fail('RESERVATION_NOT_FOUND')
        assertBinding(row,input)
        if (['SETTLED','CANCELLED','UNKNOWN'].includes(row.state)) {
          if (row.receipt_hash !== receiptHash) fail('SETTLEMENT_CONFLICT')
          return {reservationId:input.requestId,state:row.state}
        }
        if (input.outcome === 'NOT_SENT' && row.state !== 'RESERVED') fail('CANNOT_REFUND_DISPATCHED_REQUEST')
        if (input.outcome === 'SUCCESS' && row.state !== 'DISPATCHED') fail('REQUEST_NOT_DISPATCHED')
        const accounts = await lockAccounts(tx,input.requestId)
        const overrun = input.outcome === 'SUCCESS' && money(input.actualCostMicros,true) > BigInt(row.worst_micros)
        const unknown = input.outcome === 'UNKNOWN' || overrun
        const state: LedgerState = unknown ? 'UNKNOWN' : input.outcome === 'NOT_SENT' ? 'CANCELLED' : 'SETTLED'
        const booked = input.outcome === 'NOT_SENT' ? '0' : input.outcome === 'SUCCESS' ? input.actualCostMicros! : row.booked_micros
        await replaceCharge(tx,accounts,row.booked_micros,booked,!unknown,input.outcome === 'NOT_SENT',unknown)
        await tx.query(`UPDATE coach_model_reservation SET state=$2,booked_micros=$3::numeric,
          receipt_hash=$4,usage_hash=$5,actual_micros=$6::numeric,updated_at=now() WHERE request_id=$1`,
          [input.requestId,state,booked,receiptHash,input.usageHash,input.actualCostMicros])
        return {reservationId:input.requestId,state,...(overrun ? {overrun:true} : {})}
      })
    },
    async reconcile(input: ReconcileInput): Promise<LedgerResult> {
      validateBinding(input); identifier(input.reviewId); identifier(input.reviewerId)
      money(input.actualCostMicros,true)
      if (!HASH.test(input.usageHash) || !['CHARGED','PROVEN_NOT_SENT'].includes(input.outcome)) fail('RECONCILIATION_EVIDENCE_REQUIRED')
      if (input.outcome === 'PROVEN_NOT_SENT' && input.actualCostMicros !== '0') fail('INVALID_RECONCILIATION')
      const reviewHash = digest([input.reviewId,input.reviewerId,input.outcome,input.actualCostMicros,input.usageHash])
      return db.transaction(async tx => {
        const [row] = await tx.query<Row>(rowSelect,[input.requestId])
        if (!row) fail('RESERVATION_NOT_FOUND')
        assertBinding(row,input)
        if (row.reconciliation_hash) {
          if (row.reconciliation_hash !== reviewHash) fail('RECONCILIATION_CONFLICT')
          return {reservationId:input.requestId,state:row.state}
        }
        if (row.state !== 'UNKNOWN') fail('RECONCILIATION_REQUIRES_UNKNOWN')
        const accounts = await lockAccounts(tx,input.requestId)
        const cancelled = input.outcome === 'PROVEN_NOT_SENT'
        await replaceCharge(tx,accounts,row.booked_micros,input.actualCostMicros,true,cancelled,false)
        const state: LedgerState = cancelled ? 'CANCELLED' : 'SETTLED'
        await tx.query(`UPDATE coach_model_reservation SET state=$2,booked_micros=$3::numeric,
          usage_hash=$4,actual_micros=$3::numeric,reconciliation_hash=$5,updated_at=now() WHERE request_id=$1`,
          [input.requestId,state,input.actualCostMicros,input.usageHash,reviewHash])
        for (const a of accounts) {
          await tx.query(`UPDATE coach_model_budget_account SET blocked=EXISTS(
            SELECT 1 FROM coach_model_reservation_account m JOIN coach_model_reservation r ON r.request_id=m.request_id
            WHERE m.account_key=$1 AND r.state='UNKNOWN') WHERE account_key=$1`,[a.account_key])
        }
        return {reservationId:input.requestId,state}
      })
    },
  }
}

/** A Pool.query BEGIN / later Pool.query COMMIT is UNSAFE (different clients).
 * This adapter pins ONE client through the entire transaction, then releases it.
 */
export function createPgTransactionAdapter(pool: Pick<Pool,'connect'>): LedgerDatabase {
  return {async transaction<T>(work: (tx: LedgerTransaction) => Promise<T>): Promise<T> {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await work({query: async <R>(text: string, params: unknown[] = []) => (await client.query(text,params)).rows as R[]})
      await client.query('COMMIT')
      return result
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw err
    } finally { client.release() }
  }}
}
/** Embedded tests / explicitly configured host only. In-memory PGlite does NOT
 * prove production durability, restart recovery, or multi-process Postgres locks.
 */
export function createPgliteTransactionAdapter(pg: Pick<PGlite,'transaction'>): LedgerDatabase {
  return {transaction: work => pg.transaction(tx => work({query: async <R>(text: string, params: unknown[] = []) => (await tx.query<R>(text,params)).rows}))}
}
