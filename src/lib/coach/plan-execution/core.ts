/** Host-owned execution revisions. Research drafts never acquire write authority here.
 * This local executor leaves original plans/Training Facts untouched. Cross-device and
 * authenticated server execution require a separately bound host implementation.
 */
export const PLAN_EXECUTION_EVENT = 'fangkun:plan-execution-changed'
export const PLAN_EXECUTION_LOCK = 'fangkun-plan-execution-v1'
export type PlanActor = { subjectId: string; athleteId: string; deviceId: string; profileVersion: string; scope: 'LOCAL_DEVICE_ONLY' }
export type PlanTarget = {
  scheduleId: string; componentId: string; athleteId: string; originalDate: string
  sourceVersion: string; state: 'NOT_STARTED' | 'STARTED' | 'COMPLETED' | 'UNKNOWN'
  /** Stable target identity is resolved by the host, never a course label/selectionKey. */
  identityResolved: boolean
}
export type PlanHostContext = {
  actor: PlanActor | null
  authorization: 'LOCAL_DEVICE_OWNER' | 'UNVERIFIED' | 'REVOKED'
  /** All relevant host writers must participate in PLAN_EXECUTION_LOCK; a mirror is insufficient. */
  persistenceBoundary: 'COORDINATED_LOCAL' | 'UNCOORDINATED'
  calendarVersion: string; factsVersion: string; safetyVersion: string
  calendarCoverage: 'COMPLETE' | 'UNKNOWN'; readState: 'AVAILABLE' | 'FAILED'
  safety: 'ALLOW_DATE_MOVE' | 'REVIEW_REQUIRED' | 'UNKNOWN'
  today: string; targets: PlanTarget[]
}
export type PlanMove = { scheduleId: string; componentId: string; fromDate: string; toDate: string; originalDate: string }
export type PlanProposal = {
  id: string; actor: PlanActor; kind: 'MOVE_UNSTARTED_COMPONENT'; move: PlanMove
  diffHash: string; contextSignature: string; targetVersion: number; dayVersions: Record<string, number>
  createdAt: string; expiresAt: string; state: 'PENDING' | 'APPLIED' | 'INVALIDATED'
  executionEligibility: 'READY_LOCAL' | 'BLOCKED_UNCOORDINATED'
  /** A proposal is a requested schedule change, not training/medical permission. */
  canApplyAutomatically: false
}
export type PlanExecutionReceipt = {
  id: string; proposalId: string; actor: PlanActor; move: PlanMove; diffHash: string
  targetVersion: number; appliedAt: string
  kind: 'MOVE' | 'UNDO'; undoOf?: string; persistence: 'LOCAL_ONLY'; cloudSynchronized: false
}
export type PlanExecutionDocument = {
  schemaVersion: 1; revision: number; athleteId: string
  proposals: Record<string, PlanProposal>; receipts: Record<string, PlanExecutionReceipt>
  overlays: Record<string, { date: string; version: number; receiptId: string; sourceVersion: string }>
  dayVersions: Record<string, number>
}
export type ExecutionResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string }
export interface PlanExecutionRepository {
  read(athleteId: string): Promise<PlanExecutionDocument>
  /** work is synchronous; durable implementations resolve only after transaction completion. */
  transact<T>(athleteId: string, work: (draft: PlanExecutionDocument) => T): Promise<T>
}
export const emptyPlanExecution = (athleteId: string): PlanExecutionDocument => ({ schemaVersion: 1, revision: 0, athleteId, proposals: {}, receipts: {}, overlays: {}, dayVersions: {} })
export const planTargetKey = (scheduleId: string, componentId: string) => JSON.stringify([scheduleId, componentId])
const canonical = (value: unknown): string => JSON.stringify(value, (_key, row) => row && typeof row === 'object' && !Array.isArray(row) ? Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b))) : row)
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const validId = (value: string) => typeof value === 'string' && value.trim().length > 0 && value.length <= 200
const validDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
const sameActor = (a: PlanActor | null, b: PlanActor | null) => !!a && !!b && canonical(a) === canonical(b)
function fail(code: string, message: string): ExecutionResult<never> { return { ok: false, code, message } }
function contextFailure(host: PlanHostContext, requireCoordinated = true): ExecutionResult<never> | null {
  if (!host.actor || host.authorization !== 'LOCAL_DEVICE_OWNER' || host.actor.scope !== 'LOCAL_DEVICE_ONLY' || !Object.values(host.actor).every(validId)) return fail('BLOCKED_AUTHORIZATION', '本机账户或运动员归属尚未核定，尚未修改。')
  if (requireCoordinated && host.persistenceBoundary !== 'COORDINATED_LOCAL') return fail('BLOCKED_UNCOORDINATED', '相关数据写入尚未进入同一并发协调边界，尚未修改。')
  if (host.readState !== 'AVAILABLE' || host.calendarCoverage !== 'COMPLETE' || ![host.calendarVersion, host.factsVersion, host.safetyVersion].every(validId)) return fail('BLOCKED_INCOMPLETE_CONTEXT', '当前日程、事实或版本读取不完整，尚未修改。')
  if (host.safety !== 'ALLOW_DATE_MOVE') return fail('BLOCKED_SAFETY', '该安排仍需安全复核；确认不能解除医疗限制。')
  if (!validDay(host.today)) return fail('BLOCKED_CLOCK', '无法核定本机日期，尚未修改。')
  return null
}
function target(host: PlanHostContext, scheduleId: string, componentId: string): PlanTarget | null {
  const found = host.targets.filter(row => row.scheduleId === scheduleId && row.componentId === componentId)
  if (found.length !== 1) return null
  const row = found[0]!
  return row.athleteId === host.actor?.athleteId && row.identityResolved && validDay(row.originalDate) && validId(row.sourceVersion) ? row : null
}
function contextSignature(host: PlanHostContext, row: PlanTarget): string {
  return canonical({ actor: host.actor, calendarVersion: host.calendarVersion, factsVersion: host.factsVersion, safetyVersion: host.safetyVersion, today: host.today, target: row })
}
async function diffDigest(value: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('CRYPTO_UNAVAILABLE')
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)))
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('')
}
/** State changes on successful application; all intent/authority fields remain bound. */
function proposalDigestPayload(proposal: PlanProposal) {
  return { id: proposal.id, actor: proposal.actor, kind: proposal.kind, move: proposal.move, contextSignature: proposal.contextSignature, targetVersion: proposal.targetVersion, dayVersions: proposal.dayVersions, createdAt: proposal.createdAt, expiresAt: proposal.expiresAt, executionEligibility: proposal.executionEligibility, canApplyAutomatically: proposal.canApplyAutomatically }
}
const makeId = () => { if (!globalThis.crypto?.randomUUID) throw new Error('CRYPTO_UNAVAILABLE'); return crypto.randomUUID() }
export function effectivePlanDate(doc: PlanExecutionDocument, scheduleId: string, componentId: string, originalDate: string): string {
  return doc.overlays[planTargetKey(scheduleId, componentId)]?.date ?? originalDate
}
/** All participating source writes and confirmations take this lock. Without Web Locks,
 * execution is blocked (rather than claiming a localStorage write is atomic).
 */
export async function withPlanExecutionLock<T>(work: () => T | Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks?.request) throw new Error('COORDINATION_UNAVAILABLE')
  return navigator.locks.request(PLAN_EXECUTION_LOCK, work)
}
export function createLocalPlanExecutor(options: {
  repository: PlanExecutionRepository; readHostContext: () => PlanHostContext
  now?: () => Date; lock?: <T>(work: () => T | Promise<T>) => Promise<T>
}) {
  const now = options.now ?? (() => new Date()), lock = options.lock ?? withPlanExecutionLock
  const readHost = () => clone(options.readHostContext())
  function actorStillAuthorized(expected: PlanActor): boolean {
    const host = readHost()
    return host.authorization === 'LOCAL_DEVICE_OWNER' && sameActor(host.actor, expected)
  }
  async function guarded<T>(work: () => Promise<ExecutionResult<T>>): Promise<ExecutionResult<T>> {
    try { return await lock(work) } catch (error) {
      return fail(error instanceof Error && error.message === 'COORDINATION_UNAVAILABLE' ? 'BLOCKED_UNCOORDINATED' : 'PERSISTENCE_FAILED', '本机保存状态尚未核实，请重新读取回执；不要盲目重复提交。')
    }
  }
  return {
    async read(): Promise<ExecutionResult<PlanExecutionDocument>> {
      try {
        const host = readHost(), owner = host.actor; if (!owner || host.authorization !== 'LOCAL_DEVICE_OWNER') return fail('BLOCKED_AUTHORIZATION', '未核定运动员归属。')
        const doc = await options.repository.read(owner.athleteId)
        if (!actorStillAuthorized(owner)) return fail('AUTHORIZATION_CHANGED', '账户或授权已变化，已取消上一账户的数据返回。')
        return { ok: true, value: doc }
      } catch { return fail('READ_FAILED', '本机执行安排读取失败，不能当成空日程。') }
    },
    async previewMove(input: { scheduleId: string; componentId: string; toDate: string; validForMs?: number }): Promise<ExecutionResult<PlanProposal>> {
      return guarded(async () => {
        const host = readHost(), bad = contextFailure(host, false); if (bad) return bad
        if (!validId(input.scheduleId) || !validId(input.componentId) || !validDay(input.toDate)) return fail('INVALID_TARGET', '目标日程、组成或日期无效。')
        const row = target(host, input.scheduleId, input.componentId)
        if (!row || row.state !== 'NOT_STARTED') return fail('BLOCKED_TARGET_STATE', '只能移动归属明确且尚未开始的一个分项。')
        const doc = await options.repository.read(host.actor!.athleteId), key = planTargetKey(row.scheduleId, row.componentId)
        const fromDate = effectivePlanDate(doc, row.scheduleId, row.componentId, row.originalDate)
        if (input.toDate < host.today || input.toDate === fromDate) return fail('INVALID_DATE_MOVE', '目标日期须为今天或之后的不同日期。')
        const overlay = doc.overlays[key]
        if (overlay && overlay.sourceVersion !== row.sourceVersion) return fail('STALE_SOURCE', '原计划已另行修改，请先复核现有执行安排。')
        const ttl = input.validForMs ?? 15 * 60_000
        if (!Number.isFinite(ttl) || ttl < 1 || ttl > 15 * 60_000) return fail('INVALID_EXPIRY', '提案有效期无效。')
        const move: PlanMove = { scheduleId: row.scheduleId, componentId: row.componentId, originalDate: row.originalDate, fromDate, toDate: input.toDate }
        const proposal: PlanProposal = { id: makeId(), actor: clone(host.actor!), kind: 'MOVE_UNSTARTED_COMPONENT', move, diffHash: '', contextSignature: contextSignature(host, row), targetVersion: overlay?.version ?? 0, dayVersions: { [fromDate]: doc.dayVersions[fromDate] ?? 0, [input.toDate]: doc.dayVersions[input.toDate] ?? 0 }, createdAt: now().toISOString(), expiresAt: new Date(now().getTime() + ttl).toISOString(), state: 'PENDING', executionEligibility: host.persistenceBoundary === 'COORDINATED_LOCAL' ? 'READY_LOCAL' : 'BLOCKED_UNCOORDINATED', canApplyAutomatically: false }
        proposal.diffHash = await diffDigest(proposalDigestPayload(proposal))
        const result = await options.repository.transact(host.actor!.athleteId, draft => {
          const fresh = readHost(), current = target(fresh, input.scheduleId, input.componentId)
          if (contextFailure(fresh, false) || !current || contextSignature(fresh, current) !== proposal.contextSignature || (draft.overlays[key]?.version ?? 0) !== proposal.targetVersion || Object.entries(proposal.dayVersions).some(([day, version]) => (draft.dayVersions[day] ?? 0) !== version)) return fail('STALE_CONTEXT', '生成提案时日程或证据已变化，请重新查看差异。')
          draft.proposals[proposal.id] = clone(proposal)
          return { ok: true as const, value: proposal }
        })
        if (result.ok && !actorStillAuthorized(host.actor!)) return fail('AUTHORIZATION_CHANGED', '账户或授权已变化，已取消上一账户的提案返回。')
        return result
      })
    },
    async confirm(input: { proposalId: string; diffHash: string; confirmation: 'CONFIRM_THIS_CHANGE' }): Promise<ExecutionResult<PlanExecutionReceipt>> {
      return guarded(async () => {
        const host = readHost(), bad = contextFailure(host); if (bad) return bad
        if (input.confirmation !== 'CONFIRM_THIS_CHANGE') return fail('CONFIRMATION_REQUIRED', '需要明确确认这一份前后差异。')
        const snapshot = await options.repository.read(host.actor!.athleteId), reviewed = snapshot.proposals[input.proposalId]
        if (!reviewed || !sameActor(reviewed.actor, host.actor) || reviewed.diffHash !== input.diffHash) return fail('PROPOSAL_MISMATCH', '确认与当前运动员或提案差异不一致。')
        const reviewedPayload = canonical(proposalDigestPayload(reviewed)), computedHash = await diffDigest(proposalDigestPayload(reviewed))
        if (computedHash !== input.diffHash) return fail('PROPOSAL_INTEGRITY_FAILED', '已保存提案的实际内容与确认差异不一致，请重新预览。')
        const result = await options.repository.transact(host.actor!.athleteId, draft => {
          const fresh = readHost()
          if (contextFailure(fresh) || !sameActor(fresh.actor, host.actor)) return fail('AUTHORIZATION_CHANGED', '账户、授权或执行条件已变化，尚未修改。')
          const proposal = draft.proposals[input.proposalId]
          if (!proposal || !sameActor(proposal.actor, host.actor) || proposal.diffHash !== input.diffHash) return fail('PROPOSAL_MISMATCH', '确认与当前运动员或提案差异不一致。')
          if (canonical(proposalDigestPayload(proposal)) !== reviewedPayload) return fail('PROPOSAL_INTEGRITY_FAILED', '提案在确认期间发生变化，尚未修改。')
          const existing = Object.values(draft.receipts).find(r => r.proposalId === proposal.id && r.kind === 'MOVE')
          if (existing) {
            if (existing.diffHash !== computedHash || canonical(existing.move) !== canonical(proposal.move) || !sameActor(existing.actor, proposal.actor) || existing.targetVersion !== proposal.targetVersion + 1) return fail('RECEIPT_INTEGRITY_FAILED', '原回执与已确认内容不一致，请核对，不能重复执行。')
            return { ok: true as const, value: clone(existing) }
          }
          if (proposal.executionEligibility !== 'READY_LOCAL') return fail('BLOCKED_UNCOORDINATED', '原提案形成时尚未具备协调写入条件，请重新预览。')
          if (proposal.state !== 'PENDING' || Date.parse(proposal.expiresAt) <= now().getTime()) return fail('EXPIRED_PROPOSAL', '提案已失效，请重新读取差异。')
          const row = target(fresh, proposal.move.scheduleId, proposal.move.componentId)
          if (contextFailure(fresh) || !row || row.state !== 'NOT_STARTED' || contextSignature(fresh, row) !== proposal.contextSignature) return fail('STALE_CONTEXT', '日程、训练开始状态或相关事实已变化，尚未修改。')
          const key = planTargetKey(row.scheduleId, row.componentId)
          if ((draft.overlays[key]?.version ?? 0) !== proposal.targetVersion || Object.entries(proposal.dayVersions).some(([day, version]) => (draft.dayVersions[day] ?? 0) !== version)) return fail('VERSION_CONFLICT', '源日、目标日或该组成已发生变化，尚未修改。')
          const receipt: PlanExecutionReceipt = { id: makeId(), proposalId: proposal.id, actor: clone(host.actor!), move: clone(proposal.move), diffHash: proposal.diffHash, targetVersion: proposal.targetVersion + 1, appliedAt: now().toISOString(), kind: 'MOVE', persistence: 'LOCAL_ONLY', cloudSynchronized: false }
          draft.overlays[key] = { date: receipt.move.toDate, version: receipt.targetVersion, receiptId: receipt.id, sourceVersion: row.sourceVersion }
          for (const day of Object.keys(proposal.dayVersions)) draft.dayVersions[day] = (draft.dayVersions[day] ?? 0) + 1
          draft.proposals[proposal.id] = { ...proposal, state: 'APPLIED' }
          draft.receipts[receipt.id] = receipt; draft.revision += 1
          return { ok: true as const, value: receipt }
        })
        if (!result.ok) return result
        const verified = await options.repository.read(host.actor!.athleteId)
        if (!actorStillAuthorized(host.actor!)) return fail('AUTHORIZATION_CHANGED', '账户或授权已变化；回执留在原账户，请切回原账户核对。')
        if (canonical(verified.receipts[result.value.id]) !== canonical(result.value)) return fail('READBACK_FAILED', '事务回执尚未核实，请刷新核对；不能再次盲目提交。')
        if (typeof window !== 'undefined') window.dispatchEvent(new Event(PLAN_EXECUTION_EVENT))
        return result
      })
    },
    async undo(input: { receiptId: string; confirmation: 'UNDO_THIS_CHANGE' }): Promise<ExecutionResult<PlanExecutionReceipt>> {
      return guarded(async () => {
        const host = readHost(), bad = contextFailure(host); if (bad) return bad
        if (input.confirmation !== 'UNDO_THIS_CHANGE') return fail('CONFIRMATION_REQUIRED', '需要明确撤销这一份已保存的调整。')
        const snapshot = await options.repository.read(host.actor!.athleteId), reviewedReceipt = snapshot.receipts[input.receiptId], reviewedProposal = reviewedReceipt && snapshot.proposals[reviewedReceipt.proposalId]
        if (!reviewedReceipt || reviewedReceipt.kind !== 'MOVE' || !reviewedProposal || !sameActor(reviewedReceipt.actor, host.actor)) return fail('RECEIPT_MISMATCH', '找不到当前运动员的原调整回执。')
        const reviewedPayload = canonical(proposalDigestPayload(reviewedProposal)), reviewedReceiptSignature = canonical(reviewedReceipt), computedHash = await diffDigest(proposalDigestPayload(reviewedProposal))
        if (computedHash !== reviewedProposal.diffHash || computedHash !== reviewedReceipt.diffHash || canonical(reviewedReceipt.move) !== canonical(reviewedProposal.move) || reviewedReceipt.targetVersion !== reviewedProposal.targetVersion + 1 || !sameActor(reviewedReceipt.actor, reviewedProposal.actor)) return fail('PROPOSAL_INTEGRITY_FAILED', '原提案或回执的内容已不一致，撤销不能覆盖当前安排。')
        const result = await options.repository.transact(host.actor!.athleteId, draft => {
          const fresh = readHost()
          if (contextFailure(fresh) || !sameActor(fresh.actor, host.actor)) return fail('AUTHORIZATION_CHANGED', '账户、授权或执行条件已变化，尚未撤销。')
          const old = draft.receipts[input.receiptId]
          if (!old || old.kind !== 'MOVE' || !sameActor(old.actor, host.actor)) return fail('RECEIPT_MISMATCH', '找不到当前运动员的原调整回执。')
          const storedProposal = draft.proposals[old.proposalId]
          if (!storedProposal || canonical(proposalDigestPayload(storedProposal)) !== reviewedPayload || canonical(old) !== reviewedReceiptSignature) return fail('PROPOSAL_INTEGRITY_FAILED', '原提案或回执在撤销期间发生变化，尚未撤销。')
          const priorUndo = Object.values(draft.receipts).find(r => r.kind === 'UNDO' && r.undoOf === old.id)
          if (priorUndo) return { ok: true as const, value: clone(priorUndo) }
          const row = target(fresh, old.move.scheduleId, old.move.componentId), key = planTargetKey(old.move.scheduleId, old.move.componentId), current = draft.overlays[key]
          const proposal = draft.proposals[old.proposalId]
          if (!row || row.state !== 'NOT_STARTED' || !proposal || current?.receiptId !== old.id || current.version !== old.targetVersion || row.sourceVersion !== current.sourceVersion || contextSignature(fresh, row) !== proposal.contextSignature || Object.entries(proposal.dayVersions).some(([day, version]) => (draft.dayVersions[day] ?? 0) !== version + 1)) return fail('UNDO_CONFLICT', '已经开始、后续手改或相关日程/证据有变化，撤销不能覆盖新状态。')
          const undo: PlanExecutionReceipt = { id: makeId(), proposalId: old.proposalId, actor: clone(host.actor!), move: { ...old.move, fromDate: old.move.toDate, toDate: old.move.fromDate }, diffHash: old.diffHash, targetVersion: old.targetVersion + 1, appliedAt: now().toISOString(), kind: 'UNDO', undoOf: old.id, persistence: 'LOCAL_ONLY', cloudSynchronized: false }
          draft.overlays[key] = { date: undo.move.toDate, version: undo.targetVersion, receiptId: undo.id, sourceVersion: row.sourceVersion }
          for (const day of [undo.move.fromDate, undo.move.toDate]) draft.dayVersions[day] = (draft.dayVersions[day] ?? 0) + 1
          // The original receipt remains byte-preserved; revocation is another receipt.
          draft.receipts[undo.id] = undo; draft.revision += 1
          return { ok: true as const, value: undo }
        })
        if (!result.ok) return result
        const verified = await options.repository.read(host.actor!.athleteId)
        if (!actorStillAuthorized(host.actor!)) return fail('AUTHORIZATION_CHANGED', '账户或授权已变化；撤销回执留在原账户，请切回原账户核对。')
        if (canonical(verified.receipts[result.value.id]) !== canonical(result.value)) return fail('READBACK_FAILED', '撤销事务回执尚未核实，请刷新核对。')
        if (typeof window !== 'undefined') window.dispatchEvent(new Event(PLAN_EXECUTION_EVENT))
        return result
      })
    },
  }
}
