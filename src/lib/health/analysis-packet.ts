import type { CoachAnalysisPacket, CoachAnalysisReply, EvidenceSnapshot, MuscleExposureReview, RecoveryAssessment, ReplyValidation } from './analysis-contract'
import { stableJson } from './analysis-evidence'
export function buildCoachAnalysisPacket(s:EvidenceSnapshot,a:RecoveryAssessment,e:MuscleExposureReview):CoachAnalysisPacket {
 if(a.snapshotId!==s.snapshotId||e.snapshotId!==s.snapshotId)throw Error('ANALYSIS_VERSION_MISMATCH')
 const used=new Set([...a.observations.flatMap(o=>o.evidenceRefs),...a.hypotheses.flatMap(h=>[...h.supportingRefs,...h.weakeningRefs]),...a.candidates.flatMap(c=>c.basisRefs)].map(r=>r.id+'@'+r.revision))
 return {schemaVersion:'FK_ANALYSIS_HANDOFF_1',context:s.context,snapshotId:s.snapshotId,inputDigest:s.inputDigest,permittedFacts:s.facts.filter(f=>used.has(f.id+'@'+f.revision)),assessment:a,exposure:e,allowedCandidateIds:a.candidates.map(c=>c.id),knowledgeRefs:[],writeAuthority:'NONE'}
}
/** Exact deterministic quotations are accepted structurally. All novel semantics require review. */
export function validateCoachAnalysisReply(reply:CoachAnalysisReply,p:CoachAnalysisPacket):ReplyValidation {
 const errors:string[]=[],reviewedClaims:string[]=[]
 if(!reply||typeof reply.answer!=='string'||!reply.answer.trim()||!Array.isArray(reply.factualClaims)||!Array.isArray(reply.hypotheses)||!Array.isArray(reply.unknowns)||reply.unknowns.some(x=>typeof x!=='string')||(reply.followup!==null&&typeof reply.followup!=='string'))return {status:'REJECTED',errors:['INVALID_REPLY'],reviewedClaims,professionalCorrectness:'NOT_PROVEN'}
 if(reply.selectedCandidateId&&!p.allowedCandidateIds.includes(reply.selectedCandidateId))errors.push('CANDIDATE_NOT_ALLOWED')
 if(reply.memoryClaim!=='NOT_SAVED')errors.push('WRITE_OR_CLEARANCE_CLAIM')
 let remaining=reply.answer
 for(const claim of reply.factualClaims){
  if(!claim.text||!Array.isArray(claim.refs)||!claim.refs.length||claim.refs.some(r=>!p.permittedFacts.some(f=>f.id===r.id&&f.revision===r.revision))){errors.push('UNKNOWN_OR_STALE_REFERENCE');continue}
  const allowed=p.assessment.observations.find(o=>o.text===claim.text&&stableJson(o.evidenceRefs)===stableJson(claim.refs))
  if(!allowed||!remaining.includes(claim.text)){errors.push('FACT_VALUE_UNIT_OR_DIRECTION_UNVERIFIED');continue}
  remaining=remaining.replace(claim.text,'');reviewedClaims.push(claim.text)
 }
 // Approved facts can explicitly negate medical clearance. Inspect only text
 // that has not already matched an exact, referenced host observation.
 if(/已经?保存|已记入|解除.{0,8}限制|医学.{0,3}许可|组织恢复|自动.{0,6}改课/.test(remaining))errors.push('WRITE_OR_CLEARANCE_CLAIM')
 if(/[0-9０-９]/.test(remaining))errors.push('UNREFERENCED_NUMERIC_CLAIM')
 for(const h of reply.hypotheses)if(!p.assessment.hypotheses.some(x=>stableJson(x)===stableJson(h)))errors.push('HYPOTHESIS_REQUIRES_REVIEW')
 const unseenSupplement=reply.unknowns.some(x=>!p.assessment.missingDecisionInputs.includes(x))||!!reply.followup&&!p.assessment.hypotheses.some(h=>h.discriminator===reply.followup)
 return {status:errors.length?'REJECTED':remaining.trim()||reply.hypotheses.length||unseenSupplement?'NEEDS_SEMANTIC_REVIEW':'ACCEPTED_STRUCTURALLY',errors,reviewedClaims,professionalCorrectness:'NOT_PROVEN'}
}
/** Host checks freshness/confirmation separately from any model text. No write port here. */
export function checkAnalysisCandidate(p:CoachAnalysisPacket,id:string,host:{snapshotId:string;planVersion:string|null;confirmed:boolean;alreadyExecuted:boolean}){
 return {available:p.assessment.candidates.some(c=>c.id===id&&c.executionState!=='OBSERVATION_ONLY')&&p.allowedCandidateIds.includes(id)&&host.snapshotId===p.snapshotId&&!!host.planVersion&&host.planVersion===p.context.planVersion&&host.confirmed&&!host.alreadyExecuted&&p.assessment.safetyState==='NO_KNOWN_HOLD',planChanged:false as const,requiresHostExecution:true as const}
}
/** Minimized model DTO with ephemeral IDs; raw athlete/account/device/source IDs stay local. */
export function analysisModelView(p:CoachAnalysisPacket){
 const refs=new Map(p.permittedFacts.map((f,i)=>[f.id,`F${i+1}`])),candidates=new Map(p.allowedCandidateIds.map((id,i)=>[id,`C${i+1}`]))
 const privateValues=[...new Set(p.permittedFacts.flatMap(f=>[f.athleteId,f.accountRef,f.deviceId,f.sourceRecordId,f.protocolKey]).filter((x):x is string=>!!x))]
 const aliases=new Map([...refs,...candidates]);for(const v of privateValues)if(!aliases.has(v))aliases.set(v,`S${aliases.size+1}`)
 const convert=(v:unknown,reverse=false):any=>{
  if(Array.isArray(v))return v.map(x=>convert(x,reverse))
  if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,convert(x,reverse)]))
  if(typeof v!=='string')return v
  const map=reverse?new Map([...aliases].map(([a,b])=>[b,a])):aliases
  if(map.has(v))return map.get(v)!
  // Embedded protocol/account IDs in a host quotation must also be removed.
  // One regex pass avoids replacing aliases introduced by another substitution.
  const keys=[...map.keys()].filter(k=>k.length>=4||reverse).sort((a,b)=>b.length-a.length)
  const escape=(x:string)=>x.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
  return keys.length?v.replace(new RegExp(keys.map(escape).join('|'),'g'),x=>map.get(x)!):v
 }
 return {view:convert({observations:p.assessment.observations,hypotheses:p.assessment.hypotheses,candidates:p.assessment.candidates,safetyState:p.assessment.safetyState,missing:p.assessment.missingDecisionInputs}),restore:(v:unknown)=>convert(v,true) as CoachAnalysisReply}
}
