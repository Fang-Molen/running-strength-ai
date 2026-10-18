import { evaluateCoachEvolution, formatEvolutionReadOnlyContext, type EvolutionEvidence, type EvolutionSnapshot } from './coach-evolution-v4.ts'
import { screenLocalSafety, localSafetyAction, localMedicalReviewGuidance, type LocalSafety } from './coach-local-safety.ts'
import { preserveReferral } from './coach-referral-safety.ts'

/** V4-C2..C10: deterministic, read-only reasoning scaffolding. Never loads or writes personal storage. */
export const V4_C10_VERSION='FK-V4-C10-RESEARCH-CANDIDATE' as const
export type AuditIssue={id:string;code:string}
export type V4AuditedSnapshot={snapshot:EvolutionSnapshot;issues:AuditIssue[];sourceStatus:'EXPLICIT_INPUT_ONLY';decisionAuthorization:false}
const uniq=(items:string[])=>[...new Set(items)]
const validUnit:Record<EvolutionEvidence['metric'],string>={SPLIT_SECONDS:'s',REST_SECONDS:'s',GOAL_SECONDS:'s',SLEEP_HOURS:'h',SESSION_RPE:'score',PAIN_SCORE:'score',SUBJECTIVE_RECOVERY:'score',SORENESS:'score',STRENGTH_REPS:'reps',STRENGTH_KG:'kg',STRENGTH_SECONDS:'s',HR_AVG_BPM:'bpm'}

/** C2: Reject impossible/mislabeled evidence before the legacy V4-C1 evaluator. */
export function auditPersonalEvidence(input:{athleteId:string;asOf:string;question:string;evidence:readonly EvolutionEvidence[];prior?:EvolutionSnapshot;scopeOccurrenceIds?:readonly string[]}):V4AuditedSnapshot{
 const issues:AuditIssue[]=[],clean:EvolutionEvidence[]=[]
 const sameSource=new Map<string,string>()
 const signatures=new Map<string,Set<string>>()
 const visible=(e:EvolutionEvidence)=>e.athleteId===input.athleteId&&e.source!=='THIRD_PARTY'&&
  !(Date.parse(e.recordedAt)>Date.parse(input.asOf))&&
  (e.source==='PLAN'||e.metric==='GOAL_SECONDS'||!(Date.parse(e.eventAt)>Date.parse(input.asOf)))
 for(const e of input.evidence){
  if(!visible(e))continue
  const k=`${e.athleteId}|${e.source}|${e.sourceId}`
  const sig=JSON.stringify([e.id,e.occurrenceId,e.metric,e.value,e.unit,e.context,e.eventAt,e.recordedAt,e.supersedes,e.measurement])
  if(!signatures.has(k))signatures.set(k,new Set())
  signatures.get(k)!.add(sig)
 }
 const conflictingSources=new Set([...signatures].filter(([,sigs])=>sigs.size>1).map(([k])=>k))
 for(const e of input.evidence){
  // Leave future/foreign exclusion to the evaluator, but never let it affect current conflicts.
  if(!visible(e)){clean.push(e);continue}
  let reason:string|null=null
  if(e.unit!==validUnit[e.metric])reason='METRIC_UNIT_MISMATCH'
  else if(['SESSION_RPE','SUBJECTIVE_RECOVERY','SORENESS'].includes(e.metric)&&e.value!==null&&e.value>10)reason='RPE_OUT_OF_RANGE'
  else if(e.metric==='PAIN_SCORE'&&e.value!==null&&e.value>10)reason='PAIN_OUT_OF_RANGE'
  else if(e.metric==='SLEEP_HOURS'&&e.value!==null&&e.value>24)reason='SLEEP_OUT_OF_RANGE'
  else if(e.metric==='HR_AVG_BPM'&&(!e.measurement?.method||!e.measurement.segmentSourceId||e.value===null||e.value<20||e.value>240))reason='HEART_RATE_PROVENANCE_MISSING'
  else if(e.source==='PLAN'&&e.metric!=='GOAL_SECONDS')reason='PLAN_NOT_OBSERVED_FACT'
  else if(e.source==='DEVICE'&&e.confirmation==='CONFIRMED'&&e.metric==='PAIN_SCORE')reason='DEVICE_CANNOT_CONFIRM_SYMPTOM'
  else if(e.source==='THIRD_PARTY'&&e.confirmation==='CONFIRMED')reason='THIRD_PARTY_NOT_PERSONAL_CONFIRMATION'
  else if(e.source==='USER_REPORT'&&e.confirmation==='CONFIRMED')reason='SELF_REPORT_NOT_FORMAL_FACT'
  else if(e.supersedes===e.id)reason='SELF_CORRECTION'
  const sourceKey=`${e.athleteId}|${e.source}|${e.sourceId}`
  const previous=sameSource.get(sourceKey)
  const signature=JSON.stringify([e.id,e.occurrenceId,e.metric,e.value,e.unit,e.context,e.eventAt,e.recordedAt,e.supersedes,e.measurement])
  if(!reason&&(conflictingSources.has(sourceKey)||previous&&previous!==signature))reason='SOURCE_ID_REUSED_FOR_DIFFERENT_FACT'
  if(reason){issues.push({id:e.id,code:reason});continue}
  sameSource.set(sourceKey,signature)
  clean.push(e)
 }
 let snapshot=evaluateCoachEvolution({...input,evidence:clean})
 // An invalid personal pain record is NOT usable as a numerical fact, but its
 // risk signal must not disappear merely because its unit/confirmation failed.
 const unsafeRejected=input.evidence.some(e=>e.athleteId===input.athleteId&&e.source!=='THIRD_PARTY'&&e.metric==='PAIN_SCORE'&&
   (e.value??0)>0&&issues.some(issue=>issue.id===e.id)&&Date.parse(e.recordedAt)<=Date.parse(input.asOf)&&Date.parse(e.eventAt)<=Date.parse(input.asOf))
 if(unsafeRejected&&snapshot.safety==='NONE')snapshot={...snapshot,safety:'MEDICAL_REVIEW',
   safetyMessage:'存在尚未核实的疼痛风险线索，不能据此宣布无痛或安全回归；必要时寻求运动医学或康复评估。',nextAction:'MEDICAL_REVIEW'}
 return {snapshot,issues,sourceStatus:'EXPLICIT_INPUT_ONLY',decisionAuthorization:false}
}

export type RankedHypothesis={id:string;explanation:string;supportSourceIds:string[];challengeSourceIds:string[];counterEvidence:string[];missingEvidence:string[];limitations:string[];nextQuestion:string;status:'UNCONFIRMED';rank:number}
/** C3: deterministic information-priority ordering, NOT probability or causal ranking. */
export function compareCompetingHypotheses(snapshot:EvolutionSnapshot):RankedHypothesis[]{
 const visible=new Set(snapshot.active.map(e=>e.sourceId))
 const ranked=snapshot.hypotheses.map((h,index)=>({h,index,priority:(h.supports.some(id=>visible.has(id))?3:0)+(h.challenges.some(c=>c.startsWith('SLEEP_NOT_SHORT:')||visible.has(c))?1:0)+(h.id==='MEASUREMENT'&&(snapshot.scopeConflictCount??snapshot.quarantined.length)?4:0)}))
  .sort((a,b)=>b.priority-a.priority||a.index-b.index)
 return ranked.map((x,i)=>({id:x.h.id,explanation:x.h.explanation,supportSourceIds:x.h.supports.filter(id=>visible.has(id)),challengeSourceIds:uniq(x.h.challenges.flatMap(c=>
  visible.has(c)?[c]:c.startsWith('SLEEP_NOT_SHORT:')&&visible.has(c.slice('SLEEP_NOT_SHORT:'.length))?[c.slice('SLEEP_NOT_SHORT:'.length)]:[])),
  counterEvidence:x.h.challenges.filter(c=>c.startsWith('SLEEP_NOT_SHORT:')||visible.has(c)),missingEvidence:x.h.challenges.filter(c=>c.startsWith('NO_')),
  limitations:x.h.challenges.filter(c=>!c.startsWith('NO_')&&!c.startsWith('SLEEP_NOT_SHORT:')&&!visible.has(c)),nextQuestion:x.h.discriminatingQuestion,status:'UNCONFIRMED',rank:i+1}))
}

export type RevisionAudit={changed:boolean;addedFactIds:string[];withdrawnFactIds:string[];changedHypotheses:string[];reasonCodes:string[];conclusion:'REASSESS_REQUIRED'|'NO_NEW_EVIDENCE';trainingDecisionAuthorized:false}
/** C4: explain changes; never silently keep superseded conclusions. */
export function auditFeedbackRevision(previous:EvolutionSnapshot,next:EvolutionSnapshot):RevisionAudit{
 if(previous.athleteId!==next.athleteId||Date.parse(next.asOf)<=Date.parse(previous.asOf))throw Error('INVALID_REVISION_WINDOW')
 const oldIds=new Set(previous.active.map(x=>x.id)),newIds=new Set(next.active.map(x=>x.id))
 const added=next.active.filter(x=>!oldIds.has(x.id)).map(x=>x.id)
 const withdrawn=previous.active.filter(x=>!newIds.has(x.id)).map(x=>x.id)
 const changedHypotheses=next.hypotheses.filter(h=>{
  const p=previous.hypotheses.find(x=>x.id===h.id)
  return !p||JSON.stringify([p.supports,p.challenges])!==JSON.stringify([h.supports,h.challenges])
 }).map(x=>x.id)
 const reasonCodes=uniq([
  ...(added.length?['NEW_VISIBLE_FACT']:[]),...(withdrawn.length?['FACT_WITHDRAWN_OR_CORRECTED']:[]),
  ...(next.corrections.length>previous.corrections.length?['CORRECTION_CHAIN_UPDATED']:[]),
  ...(next.quarantined.length?['UNRESOLVED_CONFLICT']:[]),...(next.safety!==previous.safety?['SAFETY_REASSESSMENT']:[]),
  ...(changedHypotheses.length?['HYPOTHESIS_EVIDENCE_CHANGED']:[])])
 return {changed:reasonCodes.length>0,addedFactIds:added,withdrawnFactIds:withdrawn,changedHypotheses,reasonCodes,
  conclusion:reasonCodes.length?'REASSESS_REQUIRED':'NO_NEW_EVIDENCE',trainingDecisionAuthorized:false}
}

export type SafetyEnvelope={level:LocalSafety;message:string|null;mustRetain:boolean;trainingDecisionAuthorized:false}
/** C5: the current conversation can trigger safety even with no selected training. */
export function buildSafetyEnvelope(snapshot:EvolutionSnapshot,question:string):SafetyEnvelope{
 const chat=screenLocalSafety(question)
 const level=chat.level==='EMERGENCY'||snapshot.safety==='EMERGENCY'?'EMERGENCY':
  chat.level==='MEDICAL_REVIEW'||snapshot.safety==='MEDICAL_REVIEW'?'MEDICAL_REVIEW':'NONE'
 const action=localSafetyAction(question)
 const emergencyAction='请立即停止训练并联系120或当地急救服务，由医务人员评估；不能通过聊天诊断。'
 const message=level==='EMERGENCY'?(chat.level==='EMERGENCY'?(action??emergencyAction):emergencyAction):(level==='MEDICAL_REVIEW'?localMedicalReviewGuidance(question):null)
 return {level,message,mustRetain:level!=='NONE',trainingDecisionAuthorized:false}
}
export function retainSafetyInTurn(turn:{mode:'answer'|'ask'|'unavailable';text:string;nextStep:string|null;medicalReferral:boolean},envelope:SafetyEnvelope){
 const withReferral=preserveReferral(turn,envelope.level==='MEDICAL_REVIEW')
 if(envelope.level==='EMERGENCY'&&envelope.message)return {...withReferral,mode:'answer' as const,text:envelope.message,nextStep:null,medicalReferral:true}
 return withReferral
}

export type PlanCandidate={status:'PROPOSED_NOT_SAVED'|'INSUFFICIENT_INFORMATION'|'SAFETY_REVIEW_REQUIRED';options:('HOLD'|'RECOVERY_REVIEW'|'VERIFY_FACTS')[];
 reasons:string[];requiresExplicitConfirmation:true;confirmedByUser:false;persisted:false;autonomousPrescription:false}
/** C6: suggestions are non-numeric and cannot mutate the plan. */
export function proposeTrainingReview(snapshot:EvolutionSnapshot,question:string):PlanCandidate{
 const envelope=buildSafetyEnvelope(snapshot,question)
 if(envelope.level!=='NONE')return {status:'SAFETY_REVIEW_REQUIRED',options:['RECOVERY_REVIEW','VERIFY_FACTS'],reasons:[envelope.level],requiresExplicitConfirmation:true,confirmedByUser:false,persisted:false,autonomousPrescription:false}
 const incomplete=snapshot.missing.length>0||snapshot.quarantined.length>0
 return {status:incomplete?'INSUFFICIENT_INFORMATION':'PROPOSED_NOT_SAVED',options:incomplete?['VERIFY_FACTS','HOLD']:['HOLD','VERIFY_FACTS'],
  reasons:incomplete?uniq([...snapshot.missing,...snapshot.quarantined.map(x=>x.reason)]):['NO_VALIDATED_CAUSAL_TRAINING_EFFECT'],
  requiresExplicitConfirmation:true,confirmedByUser:false,persisted:false,autonomousPrescription:false}
}

export type WeeklyReview={weekStart:string;observedSessionCount:number;observedSplitCount:number;incomplete:boolean;flags:string[]}
export type LongitudinalReview={weeks:WeeklyReview[];status:'OBSERVATION_ONLY'|'INSUFFICIENT_HISTORY';adaptation:'UNKNOWN';injuryPrediction:'UNAVAILABLE';decisionAuthorization:false}
const dayMs=86400000
/** C7: count only explicit events, never infer missing sessions, volume or adaptation. */
export function reviewLongitudinalWindow(snapshot:EvolutionSnapshot,weeks=4):LongitudinalReview{
 const n=Number.isFinite(weeks)?Math.max(4,Math.min(8,Math.floor(weeks))):4
 const end=Date.parse(snapshot.asOf),today=new Date(end).toISOString().slice(0,10)
 const startOfDay=Date.parse(`${today}T00:00:00Z`)
 const start=startOfDay-(n*7-1)*dayMs
 const output:WeeklyReview[]=[]
 for(let i=0;i<n;i++){
  const lo=start+i*7*dayMs,hi=lo+7*dayMs
  const events=snapshot.active.filter(e=>e.source!=='PLAN'&&e.metric==='SPLIT_SECONDS'&&e.value!==null&&Date.parse(e.eventAt)>=lo&&Date.parse(e.eventAt)<hi)
  const flags:string[]=[]
  if(!events.length)flags.push('NO_RECORDED_SPLITS_NOT_ZERO_TRAINING')
  if(snapshot.quarantined.length)flags.push('CONFLICTED_RECORDS_EXCLUDED')
  if(snapshot.excluded.some(e=>e.reason==='NOT_KNOWN_AS_OF'))flags.push('FUTURE_OR_BACKFILLED_DATA_EXCLUDED')
  output.push({weekStart:new Date(lo).toISOString().slice(0,10),observedSessionCount:new Set(events.map(e=>e.occurrenceId)).size,
   observedSplitCount:events.length,incomplete:true,flags})
 }
 return {weeks:output,status:output.some(w=>w.observedSessionCount)?'OBSERVATION_ONLY':'INSUFFICIENT_HISTORY',adaptation:'UNKNOWN',injuryPrediction:'UNAVAILABLE',decisionAuthorization:false}
}

export type ScienceReference={id:string;doi:string|null;verification:'FULL_TEXT'|'ABSTRACT'|'BIBLIOGRAPHIC'|'UNVERIFIED';topic:string;includedIn?:string[]}
export type EvidenceLinkAudit={usableForExplanation:string[];limitedSources:string[];overlapPairs:[string,string][];decisionAuthorization:false}
/** C8: literature references are never personal facts, and review overlap is visible. */
export function auditScienceLinks(refs:readonly ScienceReference[]):EvidenceLinkAudit{
 const seen=new Map<string,string>(),usable:string[]=[],limited:string[]=[],overlapPairs:[string,string][]=[]
 for(const r of refs){
  const doi=r.doi?.trim().toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//,'')??''
  if(doi){const p=seen.get(doi);if(p)overlapPairs.push([p,r.id]);else seen.set(doi,r.id)}
  if(r.verification==='FULL_TEXT'||r.verification==='ABSTRACT')usable.push(r.id)
  else limited.push(r.id)
  for(const parent of r.includedIn??[])overlapPairs.push([r.id,parent])
 }
 return {usableForExplanation:uniq(usable),limitedSources:uniq(limited),overlapPairs,decisionAuthorization:false}
}

export type V4ModelPacket={version:typeof V4_C10_VERSION;status:'READ_ONLY_CANDIDATE'|'BUDGET_EXCEEDED';evidenceContext:string;
 safety:SafetyEnvelope;reasoning:{hypotheses:RankedHypothesis[];missing:string[]};policy:{decisionAuthorization:false;personalMemoryWrite:false;planWrite:false;clinicalClearance:'UNKNOWN'}}
/** C9: explicit bounded packet; no database access, no network, no implicit identity lookup. */
export function buildV4ModelPacket(snapshot:EvolutionSnapshot,question:string,maxChars=6500):V4ModelPacket{
 const bound=Number.isFinite(maxChars)?Math.max(1000,Math.min(10000,Math.floor(maxChars))):6500
 const safety=buildSafetyEnvelope(snapshot,question)
 const policy={decisionAuthorization:false as const,personalMemoryWrite:false as const,planWrite:false as const,clinicalClearance:'UNKNOWN' as const}
 const base:V4ModelPacket={version:V4_C10_VERSION,status:'READ_ONLY_CANDIDATE',evidenceContext:formatEvolutionReadOnlyContext(snapshot,Math.min(3600,bound-400)),
  safety,reasoning:{hypotheses:compareCompetingHypotheses(snapshot),missing:[...snapshot.missing]},policy}
 if(JSON.stringify(base).length<=bound)return base
 const fallback:V4ModelPacket={...base,status:'BUDGET_EXCEEDED',evidenceContext:'EVIDENCE_NOT_INCLUDED_CONTEXT_BUDGET',reasoning:{hypotheses:[],missing:['CONTEXT_BUDGET_EXCEEDED']}}
 if(JSON.stringify(fallback).length>bound)throw Error('V4_SAFETY_PACKET_TOO_LARGE')
 return fallback
}

export type AnswerAudit={status:'REQUIRES_REVIEW'|'STRUCTURE_OK';flags:string[];scoreEligible:boolean;autonomousApproval:false}
/** C10: limited structural audit; NOT a reliable semantic classifier or medical clearance. */
export function auditV4CandidateAnswer(snapshot:EvolutionSnapshot,answer:{text:string;sourceIds:string[];claimsTrainingPlanSaved?:boolean;claimsDiagnosis?:boolean;claimsClearance?:boolean;claimsCausalEffect?:boolean}):AnswerAudit{
 const flags:string[]=[]
 const available=new Set(snapshot.active.map(e=>e.sourceId))
 if(answer.sourceIds.some(id=>!available.has(id)))flags.push('UNKNOWN_OR_REVOKED_SOURCE')
 if(snapshot.active.length&&answer.sourceIds.length===0)flags.push('NO_PERSONAL_FACT_CITATION')
 if(answer.claimsTrainingPlanSaved)flags.push('UNAUTHORIZED_PLAN_WRITE_CLAIM')
 if(answer.claimsDiagnosis)flags.push('UNSUPPORTED_MEDICAL_DIAGNOSIS')
 if(answer.claimsClearance)flags.push('UNSUPPORTED_CLINICAL_CLEARANCE')
 if(answer.claimsCausalEffect)flags.push('UNSUPPORTED_CAUSAL_CLAIM')
 if(!answer.text.trim()||answer.text.length>1200)flags.push('INVALID_ANSWER_LENGTH')
 // Lexical red flags require human review; do not try to infer complex negation.
 if(/(?:我已经|系统已经|自动)(?:为你)?(?:保存|修改|更新).{0,10}(?:计划|课表)/.test(answer.text))flags.push('POSSIBLE_UNAUTHORIZED_WRITE')
 if(/\b(?:sourceId|occurrenceId|trainingDecisionAuthorized|TRAINING_FACT|USER_REPORT|PAIN_SCORE|SESSION_RPE)\b/.test(answer.text))flags.push('INTERNAL_FIELD_LEAK')
 if(/(?:已确诊|保证不会受伤|百分之百安全回归)/.test(answer.text))flags.push('POSSIBLE_MEDICAL_OVERCLAIM')
 const safety=buildSafetyEnvelope(snapshot,'')
 if(safety.mustRetain&&!/(?:评估|医生|就医|急救|急诊|医疗|康复)/.test(answer.text))flags.push('SAFETY_REFERRAL_MISSING')
 return {status:flags.length?'REQUIRES_REVIEW':'STRUCTURE_OK',flags:uniq(flags),scoreEligible:flags.length===0,autonomousApproval:false}
}

/** This may be appended to the existing model's system prompt; it contains NO personal facts. */
export const V4_C10_SYSTEM_BOUNDARY='\nV4候选推理原则：核对个人事实来源与发生/记录时间，计划不等于完成，后补记录不得进入过去时点；同时提出竞争解释、反证和最关键的核对问题。后续更正应撤回依赖旧事实的结论并解释修订理由。只有当前请求已绑定的事实可作个人判断；未选择训练时只提供一般原则和安全提示。医学转诊在回答、追问、拒绝中都不得丢失。不得输出内部字段名，不得自动诊断、宣布安全回归、声称已写入课表或把科学相关性当因果。此为未通过真实模型验证的候选指令，不授予训练决策权限。'
