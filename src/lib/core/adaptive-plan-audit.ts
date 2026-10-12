import { arbitratePlanChange, type PlanChangeRequest } from './adaptive-plan-permissions.ts'

export const PLAN_AUDIT_KEY = 'rs-ai-plan-amendment-audit-v1'
export type PlanAuditEvent = Readonly<{
  id: string; at: string; candidateId: string; kind: 'USER_CONFIRMED' | 'USER_DECLINED' | 'USER_NOTIFIED' | 'SAFETY_ESCALATED' | 'REPLAN_REQUESTED';
  decision: ReturnType<typeof arbitratePlanChange>['status']; request: PlanChangeRequest;
  note: string; applied: false
}>
export type AuditStorage = Pick<Storage, 'getItem' | 'setItem'>

export function readPlanAudit(storage: AuditStorage): PlanAuditEvent[] {
  try {
    const raw = storage.getItem(PLAN_AUDIT_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is PlanAuditEvent => Boolean(v && typeof v === 'object' && typeof v.id === 'string' && typeof v.at === 'string' && typeof v.candidateId === 'string' && v.applied === false && typeof v.kind === 'string'))
  } catch { return [] }
}

/** Records a user choice without touching the actual training plan or existing storage keys. */
export function recordPlanAudit(storage: AuditStorage, input: {
  candidateId: string; request: PlanChangeRequest; choice: 'CONFIRM' | 'DECLINE' | 'ACKNOWLEDGE';
  note?: string; now?: string; id?: string
}): PlanAuditEvent {
  if (!input.candidateId.trim()) throw new Error('missing candidate identity')
  const decision = arbitratePlanChange(input.request)
  if (decision.status === 'REJECT_CONFLICT') throw new Error('stale plan revision')
  if (input.choice === 'CONFIRM' && decision.status !== 'REQUIRE_CONFIRMATION') throw new Error('confirmation not permitted for this status')
  if (input.choice === 'ACKNOWLEDGE' && decision.status === 'REQUIRE_CONFIRMATION') throw new Error('daily changes need explicit confirmation')
  if (input.choice === 'ACKNOWLEDGE' && decision.status === 'SAFETY_REVIEW') throw new Error('safety cannot be acknowledged away')
  const kind: PlanAuditEvent['kind'] = input.choice === 'DECLINE' ? 'USER_DECLINED' : input.choice === 'CONFIRM' ? 'USER_CONFIRMED' : decision.status === 'NOTIFY_BEFORE_CHANGE' ? 'USER_NOTIFIED' : 'REPLAN_REQUESTED'
  const event: PlanAuditEvent = {
    id: input.id ?? crypto.randomUUID(), at: input.now ?? new Date().toISOString(),
    candidateId: input.candidateId, kind, decision: decision.status,
    request: { ...input.request, evidenceIds: [...input.request.evidenceIds], discomfort: input.request.discomfort ? { ...input.request.discomfort } : undefined },
    note: (input.note ?? '').slice(0, 500), applied: false,
  }
  const existing = readPlanAudit(storage)
  if (existing.some(e => e.id === event.id)) throw new Error('duplicate event identity')
  storage.setItem(PLAN_AUDIT_KEY, JSON.stringify([...existing, event]))
  return event
}
