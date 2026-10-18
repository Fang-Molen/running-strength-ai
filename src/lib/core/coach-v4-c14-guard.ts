import {auditV4CandidateAnswer,buildSafetyEnvelope} from './coach-evolution-v4-c10.ts'
import type {EvolutionSnapshot} from './coach-evolution-v4.ts'
/** C14: fail-closed post-output guard. Lexical and structural only, NOT medical/semantic certification. */
export type V4CandidateTurn={mode:'answer'|'ask'|'unavailable';text:string;citations:string[];nextStep:string|null;
 medicalReferral:boolean;claimsTrainingPlanSaved?:boolean;claimsDiagnosis?:boolean;claimsClearance?:boolean;claimsCausalEffect?:boolean}
export type GuardedTurn={mode:V4CandidateTurn['mode'];text:string;citations:string[];nextStep:string|null;
 medicalReferral:boolean;status:'PASSED_STRUCTURAL_GUARD'|'SAFE_FALLBACK_REQUIRES_REVIEW';flags:string[];
 trainingDecisionAuthorized:false;persisted:false}
const negatedReferral=/(?:不必|无需|不用|不需要|别|不要|没必要).{0,14}(?:运动医学|康复|医生|医疗|评估|就医|急诊)/
const unsupportedRelease=/(?:已经痊愈|保证不会受伤|完全安全回归|百分之百安全|已获准恢复比赛)/
const possibleWrite=/(?:已经|自动|已为你).{0,10}(?:保存|修改|更新).{0,10}(?:课表|训练计划)/
const leak=/\b(?:sourceId|occurrenceId|trainingDecisionAuthorized|TRAINING_FACT|USER_REPORT|PAIN_SCORE|SESSION_RPE)\b/
export function guardV4Turn(snapshot:EvolutionSnapshot,question:string,candidate:V4CandidateTurn):GuardedTurn{
 const envelope=buildSafetyEnvelope(snapshot,question)
 // Both fields are user-visible; a safe body must not conceal an unsafe next step.
 const visibleText=[candidate.text,candidate.nextStep].filter(Boolean).join('\n')
 const audit=auditV4CandidateAnswer(snapshot,{text:visibleText,sourceIds:candidate.citations,
  claimsTrainingPlanSaved:candidate.claimsTrainingPlanSaved,claimsDiagnosis:candidate.claimsDiagnosis,
  claimsClearance:candidate.claimsClearance,claimsCausalEffect:candidate.claimsCausalEffect})
 const flags=[...audit.flags]
 if(negatedReferral.test(visibleText))flags.push('NEGATED_REFERRAL')
 if(unsupportedRelease.test(visibleText))flags.push('UNSUPPORTED_RELEASE')
 if(possibleWrite.test(visibleText))flags.push('POSSIBLE_UNAUTHORIZED_WRITE')
 if(leak.test(visibleText))flags.push('INTERNAL_FIELD_LEAK')
 if(envelope.level==='EMERGENCY')flags.push('EMERGENCY_REQUIRES_OVERRIDE')
 if(envelope.level==='MEDICAL_REVIEW'&&!/(?:建议|应|需要|寻求|咨询|请).{0,18}(?:运动医学|康复|医生|医疗|就医|专业评估)/.test(visibleText))flags.push('POSITIVE_REFERRAL_MISSING')
 // Wording/length/citation completeness merits a reminder, not a replacement of sound analysis.
 const advisory=new Set(['NO_PERSONAL_FACT_CITATION','INVALID_ANSWER_LENGTH','POSITIVE_REFERRAL_MISSING','SAFETY_REFERRAL_MISSING'])
 const hard=flags.filter(f=>!advisory.has(f))
 if(!candidate.text.trim())hard.push('EMPTY_ANSWER')
 if(hard.length){
  const emergency=envelope.level==='EMERGENCY'
  const text=envelope.message??'这段回答中有无法核实的事实或结论，暂不采用。你希望先核对哪一项原始记录？'
  return {mode:emergency?'unavailable':'ask',text,citations:[],nextStep:null,medicalReferral:envelope.level!=='NONE',
   status:'SAFE_FALLBACK_REQUIRES_REVIEW',flags:[...new Set(flags)],trainingDecisionAuthorized:false,persisted:false}
 }
 const needsReferral=envelope.level==='MEDICAL_REVIEW'&&flags.some(f=>f==='POSITIVE_REFERRAL_MISSING'||f==='SAFETY_REFERRAL_MISSING')
 return {mode:candidate.mode,text:needsReferral?`${candidate.text}\n${envelope.message}`:candidate.text,citations:[...candidate.citations],nextStep:candidate.nextStep,
  medicalReferral:candidate.medicalReferral||envelope.level!=='NONE',status:'PASSED_STRUCTURAL_GUARD',flags,trainingDecisionAuthorized:false,persisted:false}
}
