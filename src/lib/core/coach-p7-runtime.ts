/** R188 adapters for existing review/correction/coach entry points. Local journals only. */
import {appendJournal,readJournal} from './storage-journal.ts'
import {readFormalEvidenceRows} from './coach-v4-formal-rows-store.ts'
import {adaptFormalEvidenceRows,type FormalEvidenceRow} from './coach-v4-c11-adapter.ts'
import {auditClaimCorrection,type AuditedClaim,type ClaimCorrectionResult,type VersionedFact,type FactOrigin} from './coach-claim-revision.ts'
import {p7CommitLiveDecision} from './coach-p7-lifecycle.ts'
import {P7_EVIDENCE_VERSION} from './coach-p7-knowledge.ts'
import type {OfflineReview} from './coach-offline-loop.ts'
import type {TrainingCorrection} from './training-correction.ts'
import type {LocalCoachAnswer} from './coach-local-first.ts'

export const CLAIM_PREFIX='fr255-p7-claim:'
export const CLAIM_REVISION_PREFIX='fr255-p7-claim-revision:'
const INPUT_PREFIX='fr255-p7-input:'
type SavedClaim={athleteId:string;reviewId:string;occurrenceId:string|null;claim:AuditedClaim}
type RevisionRecord={athleteId:string;reviewId:string;correctionId:string;result:ClaimCorrectionResult;recordedAt:string}
const origin=(source:string):FactOrigin=>source==='DEVICE'?'DEVICE':source==='PLAN'?'PLAN':'USER_REPORT'

export function registerReviewClaims(reviewId:string,review:OfflineReview):boolean{
 let ok=true
 for(const h of review.hypotheses){
  const id=`${reviewId}:${h.id}`
  if(readJournal<SavedClaim>(CLAIM_PREFIX).some(r=>r.id===id))continue
  const dependencies=(review.development?.dependencies??[]).filter(d=>h.sourceIds.includes(d.sourceId))
   .map(d=>({sourceId:d.sourceId,revision:d.signature,fieldPaths:['value','context']}))
  const claim:AuditedClaim={claimId:id,status:'ACTIVE_HYPOTHESIS',dependencies,candidateIds:review.development?[review.development.cycleCandidate.id]:[]}
  ok=appendJournal<SavedClaim>(CLAIM_PREFIX,id,{athleteId:review.athleteId,reviewId,occurrenceId:review.occurrenceId,claim})&&ok
 }
 return ok
}

export function readClaimRevisions(athleteId:string,asOf=new Date().toISOString()):RevisionRecord[]{
 return readJournal<RevisionRecord>(CLAIM_REVISION_PREFIX).filter(r=>r.recordedAt&&Date.parse(r.recordedAt)<=Date.parse(asOf)&&r.data.athleteId===athleteId).map(r=>r.data)
}

/** Capture authoritative source versions BEFORE the fact writer commits its event. */
export function captureCorrectionSources(occurrenceId:string):Map<string,FormalEvidenceRow[]>{
 const athletes=new Set(readJournal<SavedClaim>(CLAIM_PREFIX).filter(r=>r.data.occurrenceId===occurrenceId||r.data.claim.dependencies.length).map(r=>r.data.athleteId))
 const result=new Map<string,FormalEvidenceRow[]>()
 for(const id of athletes)result.set(id,readFormalEvidenceRows(id).rows)
 return result
}

/** Projection confirms the same-source link; a caller's originalValue is never source authority. */
export function auditSavedClaimsForCorrection(c:TrainingCorrection,before:Map<string,FormalEvidenceRow[]>):boolean{
 const now=new Date().toISOString();let ok=true
 for(const [athleteId,oldRows] of before){
  const after=readFormalEvidenceRows(athleteId,now).rows
  const oldEvidence=adaptFormalEvidenceRows(oldRows,athleteId,now).evidence
  const changes=after.filter(r=>r.trainingOccurrenceId===c.trainingOccurrenceId&&r.supersedesRecordId&&r.sourceEventId.includes(c.correctionId))
  const claims=readJournal<SavedClaim>(CLAIM_PREFIX).map(r=>r.data).filter(r=>r.athleteId===athleteId)
  for(const saved of claims){
   const previous=readClaimRevisions(athleteId).filter(r=>r.result.claimId===saved.claim.claimId).at(-1)
   const claim={...saved.claim,status:previous?.result.status??saved.claim.status}
   const dependencies=claim.dependencies.filter(d=>oldRows.some(r=>r.trainingOccurrenceId===c.trainingOccurrenceId&&r.sourceEventId===d.sourceId))
   if(!dependencies.length&&saved.occurrenceId!==c.trainingOccurrenceId)continue
   for(const dep of dependencies.length?dependencies:[null]){
    const old=dep?oldEvidence.find(r=>r.sourceId===dep.sourceId&&JSON.stringify(r)===dep.revision):null
    const next=old?changes.find(r=>r.supersedesRecordId===old.id):null
    const voided=old&&c.kind==='VOID'&&after.some(r=>r.recordId===old.id&&r.status==='VOIDED')
    if(old&&!next&&!voided&&c.kind!=='RESTORE')continue // A different field/source was changed.
    if(c.kind==='RESTORE')continue // A restored fact never reactivates the old withdrawn explanation.
    const verified=old&&(voided||next&&next.value!==null)
    const fact:VersionedFact|null=verified?{sourceId:old.sourceId,revision:JSON.stringify(old),origin:origin(old.source),fieldPaths:['value','context','completionState']}:null
    const result=auditClaimCorrection(claim,fact,{sourceId:dep?.sourceId??`unresolved:${c.trainingOccurrenceId}`,fromRevision:dep?.revision??'UNKNOWN',toRevision:next?JSON.stringify(next):`void:${c.correctionId}`,sourceOrigin:old?origin(old.source):'USER_REPORT',changedFieldPaths:c.kind==='VOID'?['value','context','completionState']:c.field==='distance'?['context']:['value']})
    const id=`${c.correctionId}:${claim.claimId}:${dep?.sourceId??'unknown'}`
    if(readJournal<RevisionRecord>(CLAIM_REVISION_PREFIX).some(r=>r.id===id))continue
    ok=appendJournal<RevisionRecord>(CLAIM_REVISION_PREFIX,id,{athleteId,reviewId:saved.reviewId,correctionId:c.correctionId,result,recordedAt:now})&&ok
   }
  }
 }
 return ok
}

/** Called by the displayed local coach result; never writes the formal plan or invents a forecast. */
export function commitDisplayedCoachAdvice(answer:LocalCoachAnswer,question:string):{ok:boolean;id:string|null;reason:string}{
 if(!answer.candidate||!answer.dialogue||answer.dialogue.emergency||answer.dialogue.medicalHold)return {ok:false,id:null,reason:'NO_SAFE_ADVICE'}
 const now=new Date().toISOString(),id=`advice:${crypto.randomUUID()}`
 const sourceId=`input:${id}`,revision=JSON.stringify({question,profile:answer.dialogue.profile,candidate:answer.candidate})
 if(!appendJournal(INPUT_PREFIX,sourceId,{athleteId:answer.dialogue.athleteId,sourceId,revision,origin:'USER_REPORT',createdAt:now}))return {ok:false,id:null,reason:'INPUT_SAVE_FAILED'}
 const result=p7CommitLiveDecision({id,athleteId:answer.dialogue.athleteId,actor:'FANGKUN',caseId:id,createdAt:now,evidenceCutoff:now,sources:[{sourceId,revision}],hypothesis:answer.dialogue.previousDecision??answer.text.split('。')[0],alternative:'批准课程、恢复或症状新证据可能使建议撤回；先核对再调整。',metricId:'NEXT_SESSION_OBSERVATION',protocolKey:'OBSERVATION_ONLY_NO_PERFORMANCE_FORECAST',unit:'observation',forecastValue:null,forecastDirection:'LOWER_BETTER',
  // Administrative review deadline only; never a prescribed training or return-to-sport date.
  observationDueAt:new Date(Date.now()+7*86400000).toISOString(),uncertaintyNote:'仅记录事前建议；没有数值预测，不计入准确率。R187知识仍为候选，不能核准剂量。',safetyHold:false,planWrite:false,knowledgeEvidenceIds:['R187-E07'],knowledgeVersion:P7_EVIDENCE_VERSION})
 return {...result,id:result.ok?id:null}
}
