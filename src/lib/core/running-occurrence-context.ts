/** BUILD 45F: explicit occurrence-bound sequence evidence, read-only. */
import { observeRunningSessionContext, type SessionContext, type SessionPurpose } from './running-session-context.ts';
import type { RepEvidence } from './running-sequence-observation.ts';
export type BoundRep = RepEvidence & {trainingOccurrenceId:string; restAfterSeconds?:number|null};
export type OccurrenceContextInput = {trainingOccurrenceId:string; purpose:SessionPurpose; reps:BoundRep[]; preSessionRecovery?:number|null; postSessionRpe?:number|null; recovery24h?:number|null; recovery48h?:number|null};
export function observeOccurrenceContext(input:OccurrenceContextInput) {
  if (!input.trainingOccurrenceId) throw new Error('MISSING_OCCURRENCE_ID');
  const rejected = input.reps.filter(r=>r.trainingOccurrenceId!==input.trainingOccurrenceId);
  const accepted = input.reps.filter(r=>r.trainingOccurrenceId===input.trainingOccurrenceId);
  const duplicated = new Set(accepted.map(r=>r.sourceEventId).filter(Boolean)).size !== accepted.filter(r=>r.sourceEventId).length;
  if (duplicated) return {status:'BLOCKED' as const,reason:'DUPLICATE_EVENT_ID' as const,trainingOccurrenceId:input.trainingOccurrenceId,rejectedCount:rejected.length,observation:null};
  const context:SessionContext={purpose:input.purpose,reps:accepted,preSessionRecovery:input.preSessionRecovery,postSessionRpe:input.postSessionRpe,recovery24h:input.recovery24h,recovery48h:input.recovery48h};
  return {status:'READ_ONLY' as const,reason:rejected.length?'FOREIGN_OCCURRENCE_EXCLUDED' as const:'OK' as const,trainingOccurrenceId:input.trainingOccurrenceId,rejectedCount:rejected.length,observation:observeRunningSessionContext(context)};
}
