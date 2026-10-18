import type { Plan } from '../strength/model.ts'
import { assembleCoachBrief } from './coach-brief.ts'
import { readFormalEvidenceRows } from './coach-v4-formal-rows-store.ts'
import { normalizeV4 } from '../strength/coach-pipeline.ts'
import { getRunningPlanSnapshot } from './running-plan.ts'
import { projectRunningRepetitions } from './running-execution.ts'
import { analyzeRunningRounds } from './running-round-analysis.ts'
import { loadEvents } from './events.ts'
import { buildOfflineReview, readOfflineProfile } from './coach-offline-loop.ts'
import { listTrainingOccurrences } from './occurrence.ts'
import { calculateSessionLoad } from './coach-session-load.ts'
import type { AbilityMetricRequest } from './coach-ability-standard.ts'
import type { ApprovedCourse } from './coach-development-projection.ts'
import {readRecoveryContext,recoveryDayForReview} from './coach-recovery-context.ts'
import {effectiveRunningRepetition} from './running-log-correction.ts'

/** Existing corrected facts, original plan snapshots and round analysis remain the source of truth. */
export function readOfflineWorkspace(plan:Plan|null,athleteId:string,occurrenceId:string|null,question='复盘这次训练',asOf=new Date().toISOString(),development:{metricRequests?:readonly AbilityMetricRequest[];approvedCourses?:readonly ApprovedCourse[];purposeContext?:{text:string;sourceId:string;occurrenceId:string}}={}){
 const formal=readFormalEvidenceRows(athleteId,asOf),brief=assembleCoachBrief(plan,question,occurrenceId,asOf,formal.rows)
 const reviewed=normalizeV4({athleteId,asOf,rows:formal.rows,unknownCommitTime:formal.unknownCommitTime.length},question,Date.parse(asOf),occurrenceId)
 if(!reviewed)throw Error('FORMAL_EVIDENCE_UNAVAILABLE')
 const snapshot=occurrenceId?getRunningPlanSnapshot(occurrenceId):null
 const occurrence=listTrainingOccurrences().find(o=>o.trainingOccurrenceId===occurrenceId)
 // Today's edited plan is never substituted for the original pre-session snapshot.
 const original=snapshot&&occurrence?.startedAt&&Date.parse(snapshot.capturedAt)<=Date.parse(occurrence.startedAt)?snapshot:null
 const raw=occurrenceId&&original?projectRunningRepetitions(occurrenceId,loadEvents()):null
 const rounds=raw&&original?analyzeRunningRounds({...raw,slots:raw.slots.map(slot=>effectiveRunningRepetition(slot,formal.rows,asOf))},original):null
 const recoveryContext=readRecoveryContext(athleteId,recoveryDayForReview(reviewed.review.audit.snapshot,occurrenceId,question,false,occurrence?.startedAt),asOf)
 return {brief,logic:{snapshot:reviewed.review.audit.snapshot,frame:reviewed.reasoning},review:buildOfflineReview({snapshot:reviewed.review.audit.snapshot,frame:reviewed.reasoning,occurrenceId,question,invalidatedSources:formal.rows.filter(r=>r.athleteId===athleteId&&r.status==='VOIDED'&&Date.parse(r.knownAt)<=Date.parse(asOf)).map(r=>({id:r.recordId,sourceId:r.sourceEventId,occurrenceId:r.trainingOccurrenceId})),profile:readOfflineProfile(athleteId,asOf),plan:original,rounds,sessionLoad:{value:calculateSessionLoad(question,brief.sessionRpe,brief.durationSec),sourceIds:brief.sourceIds},...development,recoveryContext})}
}
