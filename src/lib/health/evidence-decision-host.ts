import { currentAthleteId } from '../core/events'
import { readSavedSessionLoads, readLoadCoverage } from '../core/coach-load-metrics-store'
import { loadHealthSnapshot } from './snapshot'
import { dailyCheckin } from './analysis'
import { readRecoveryProjection, recoveryExplanation } from './recovery-host-u11'
import { loadEntries, aggregate } from '../nutrition/log'
import { buildEvidenceDecision } from './evidence-decision'
import { localDay } from './observation'
import { readAnalysis, analysisText } from './analysis-host'
/** Shared read-only host, recomputed from current versions after each app event. */
export function readEvidenceDecision(day=localDay(),asOf=new Date().toISOString(),question=''){
 const athleteId=currentAthleteId(),analysis=readAnalysis(day,asOf,question),muscle=analysis.muscle,foods=loadEntries().filter(f=>f.date===day&&(f.athleteId??'local')===athleteId&&!!f.recordedAt&&Date.parse(f.recordedAt)<=Date.parse(asOf))
 const d=buildEvidenceDecision({athleteId,day,asOf,question,offset:-new Date(asOf).getTimezoneOffset(),snapshot:loadHealthSnapshot(day),checkin:dailyCheckin(day,asOf),sessions:readSavedSessionLoads(athleteId,asOf),coverage:readLoadCoverage(athleteId,asOf),muscle:{text:recoveryExplanation(muscle),revision:muscle.revision,sourceIds:muscle.sources.map(s=>s.id),unreadable:muscle.unreadable,hasPain:muscle.review.regions.some(r=>r.state==='PAIN_REVIEW')},nutrition:{count:foods.length,kcal:aggregate(foods).kcal.known?aggregate(foods).kcal.sum:null,pending:aggregate(foods).kcal.pending}})
 const observations=analysis.assessment.observations.map((o,i)=>({id:`verified:${i}`,text:o.text,sourceIds:o.evidenceRefs.map(r=>r.id),kind:'ACTUAL' as const}))
 d.evidence.push(...observations)
 const evidenceIds=(refs:{id:string;revision:number}[])=>observations.filter(o=>o.sourceIds.some(id=>refs.some(r=>r.id===id))).map(o=>o.id)
 d.hypotheses=analysis.assessment.hypotheses.map(h=>({id:h.id,possibility:h.claim,support:evidenceIds(h.supportingRefs),counterEvidence:evidenceIds(h.weakeningRefs),against:h.weakeningRefs.length?observations.filter(o=>evidenceIds(h.weakeningRefs).includes(o.id)).map(o=>o.text):['尚无直接反证；不把缺少疼痛记录当作无痛'],missing:analysis.assessment.missingDecisionInputs,observe:h.discriminator,supportsWhen:'同协议实际训练和后续反馈重复支持该解释',weakensWhen:'反例出现、测量条件解释差异，或原训练更正/VOID',status:'PENDING' as const}))
 const c=analysis.assessment.candidates[0],hold=['HOLD_ACTIVE','ESCALATION_REQUIRED'].includes(analysis.assessment.safetyState)
 if(hold)d.safety=analysis.assessment.safetyState==='ESCALATION_REQUIRED'?'URGENT':'REVIEW'
 d.options=d.options.map(o=>o.kind==='KEEP'?{...o,available:o.available&&!hold&&c.action==='KEEP',why:c.reason??o.why}:o.kind==='ADJUST'?{...o,available:o.available&&!hold&&['MODIFY','REDUCE','RECOVERY'].includes(c.action??''),why:c.reason??o.why,conditions:[...o.conditions,...c.conditions]}:o.kind==='PROFESSIONAL'?{...o,available:o.available||hold}:o)
 d.missing=[...new Set([...d.missing,...analysis.assessment.missingDecisionInputs])]
 d.conflicts.push(...analysis.snapshot.conflicts.map(c=>c.reason))
 d.revision+=':'+analysis.revision
 return {...d,analysis}
}
