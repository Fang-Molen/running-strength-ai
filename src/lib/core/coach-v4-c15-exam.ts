import {reviewFormalEvidence,strictIso,type FormalEvidenceRow} from './coach-v4-c11-adapter.ts'
import {guardV4Turn,type V4CandidateTurn} from './coach-v4-c14-guard.ts'
import {compareCompetingHypotheses,proposeTrainingReview} from './coach-evolution-v4-c10.ts'
/** C15: fixed structural exam. No model answers are generated or simulated as model outputs. */
export const V4_C15_VERSION='FK-V4-C15-ISOLATED-CANDIDATE' as const
export const V4_C15_CRITERIA=Object.freeze([
 'ONLY_VISIBLE_PERSONAL_EVIDENCE','MULTIPLE_UNCONFIRMED_HYPOTHESES','CORRECTIONS_WITHDRAW_OLD_SOURCES',
 'NO_AUTONOMOUS_PLAN_WRITE','SAFETY_ESCALATION_SURVIVES_ASK_OR_REFUSAL','NO_UNSUPPORTED_CAUSAL_OR_CLINICAL_CLAIM'
] as const)
export type ExamTurn={asOf:string;question:string;answer?:V4CandidateTurn}
export type ExamResult={version:typeof V4_C15_VERSION;modelAssessment:'NOT_RUN'|'OUTPUT_STRUCTURALLY_SCREENED_NOT_INDEPENDENTLY_SCORED';
 points:{asOf:string;factCount:number;hypothesisCount:number;missing:string[];safety:string;planWrite:false;
 answerStatus:'NOT_SUPPLIED'|'PASSED_STRUCTURAL_GUARD'|'SAFE_FALLBACK_REQUIRES_REVIEW'}[];
 clinicalClearance:'UNKNOWN';trainingDecisionAuthorized:false;independentExpertReview:false}
export function runV4ShadowExam(input:{athleteId:string;rows:readonly FormalEvidenceRow[];turns:readonly ExamTurn[]}):ExamResult{
 if(input.turns.length>24)throw Error('EXAM_TOO_LARGE')
 const points:ExamResult['points']=[]
 let last=-Infinity
 for(const turn of input.turns){
  const current=Date.parse(turn.asOf)
  if(!strictIso(turn.asOf)||!Number.isFinite(current)||current<=last)throw Error('EXAM_TIMELINE_INVALID')
  last=current
  const {audit}=reviewFormalEvidence({athleteId:input.athleteId,asOf:turn.asOf,question:turn.question,rows:input.rows})
  const s=audit.snapshot
  const screened=turn.answer?guardV4Turn(s,turn.question,turn.answer):null
  const proposal=proposeTrainingReview(s,turn.question)
  points.push({asOf:turn.asOf,factCount:s.active.length,hypothesisCount:compareCompetingHypotheses(s).length,
   missing:[...s.missing],safety:s.safety,planWrite:proposal.persisted,
   answerStatus:screened?.status??'NOT_SUPPLIED'})
 }
 return {version:V4_C15_VERSION,modelAssessment:input.turns.every(t=>!t.answer)?'NOT_RUN':'OUTPUT_STRUCTURALLY_SCREENED_NOT_INDEPENDENTLY_SCORED',
  points,clinicalClearance:'UNKNOWN',trainingDecisionAuthorized:false,independentExpertReview:false}
}
