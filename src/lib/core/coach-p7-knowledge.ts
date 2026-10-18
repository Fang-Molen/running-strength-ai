/**
 * R187 read-only evidence candidates integrated into P7.
 * Source: RS-DAILY-20261014 candidate audit + R182/R183 standards.
 * This is NOT approval of thresholds, treatment, or automatic training rules.
 */
export type EvidenceStatus = 'QUALIFIED_INTERPRETATION'|'HOLD'|'NUMERICAL_HOLD'|'PROFESSIONAL_ONLY'|'NO_NORM_APPROVED';
export type EvidenceTier = 'ABSTRACT'|'FULL_TEXT_SECTIONS'|'OFFICIAL'|'INHERITED';
export type EvidenceCard = {
 id:string; doi:string|null; domains:readonly string[]; topic:string; tier:EvidenceTier; status:EvidenceStatus;
 scope:string; claim:string; forbidden:readonly string[]; duplicateGroup:string|null;
 canScoreAbility:false; canApproveTrainingDose:false; canAuthorizeMedicalReturn:false;
};
const card=(data:Omit<EvidenceCard,'canScoreAbility'|'canApproveTrainingDose'|'canAuthorizeMedicalReturn'>):EvidenceCard=>
 ({...data,canScoreAbility:false,canApproveTrainingDose:false,canAuthorizeMedicalReturn:false});
export const P7_EVIDENCE_VERSION='R187-CANDIDATE-2026-10-14';
export const P7_EVIDENCE:readonly EvidenceCard[]=[
 card({id:'R187-E01',doi:'10.1097/JSM.0000000000001519',domains:['FORM','PAIN'],topic:'patellofemoral-pain-gait-retraining',
  tier:'ABSTRACT',status:'HOLD',scope:'symptomatic patellofemoral pain runners, not healthy runners',
  claim:'Scoping review of three RCTs; short-term symptom/function findings require trial and follow-up verification.',
  forbidden:['universal cadence prescription','injury-prevention guarantee','automatic return-to-run clearance'],duplicateGroup:'PFP-GAIT-RETRAINING'}),
 card({id:'R187-E02',doi:'10.1249/JES.0000000000000401',domains:['HRV','AER','DEVICE'],topic:'dfa-a1-threshold',
  tier:'ABSTRACT',status:'QUALIFIED_INTERPRETATION',scope:'validated DFA a1 exercise protocols and equipment only',
  claim:'Narrative interpretation of DFA a1 during exercise; distinct from resting wearable HRV.',
  forbidden:['resting-HRV-as-LT1','unverified-device-threshold','automatic dose adjustment'],duplicateGroup:null}),
 card({id:'R187-E03',doi:'10.1016/j.ptsp.2026.101989',domains:['SPR','FORM'],topic:'acceleration-deceleration-biomechanics',
  tier:'ABSTRACT',status:'QUALIFIED_INTERPRETATION',scope:'task-specific biomechanics across sports',
  claim:'Mechanics and actual performance outcomes must be evaluated separately.',
  forbidden:['muscle-deficit-diagnosis-from-video','automatic race-performance-gain'],duplicateGroup:null}),
 card({id:'R187-E04',doi:'10.2519/jospt.2026.14372',domains:['PAIN','RTR'],topic:'hamstring-rehabilitation-guideline',
  tier:'ABSTRACT',status:'PROFESSIONAL_ONLY',scope:'clinical hamstring rehabilitation; full recommendation tables not verified',
  claim:'GRADE-based clinical guideline exists, but precise recommendations remain unverified.',
  forbidden:['automatic eccentric-exercise start date','return-to-sprint threshold','medical clearance'],duplicateGroup:'HAMSTRING-RETURN'}),
 card({id:'R187-E05',doi:'10.1186/s40798-026-01051-8',domains:['FORM','PAIN'],topic:'patellofemoral-pain-gait-retraining',
  tier:'FULL_TEXT_SECTIONS',status:'NUMERICAL_HOLD',scope:'umbrella review of overlapping secondary reviews',
  claim:'Short-term pain/function outcomes have some support; overlap CCA numerical interpretation unresolved.',
  forbidden:['counting overlapping reviews as independent RCTs','long-term prevention claim','universal cadence rule'],duplicateGroup:'PFP-GAIT-RETRAINING'}),
 card({id:'R187-E06',doi:'10.1186/s12891-026-10072-z',domains:['PAIN','RTR'],topic:'hamstring-return-to-sport',
  tier:'FULL_TEXT_SECTIONS',status:'PROFESSIONAL_ONLY',scope:'heterogeneous return-to-sport literature; not middle-distance clearance standard',
  claim:'Multiple clinical dimensions matter; approximately 10% asymmetry is not validated as universal clearance.',
  forbidden:['10-percent-asymmetry-clearance','automatic maximal-speed return','injury diagnosis'],duplicateGroup:'HAMSTRING-RETURN'}),
 card({id:'R187-E07',doi:null,domains:['SPD','SEN','AER','PWR','ECO'],topic:'five-axis-ability-norms',
  tier:'INHERITED',status:'NO_NORM_APPROVED',scope:'R182/R183 metric dictionary and measurement gates',
  claim:'Raw measurements and trends may be described; no approved population anchors for a five-axis 0–100 radar.',
  forbidden:['fake-ability-score','replace-strength-with-session-count','replace-economy-with-cadence'],duplicateGroup:null})
] as const;
export type KnowledgeQuery={domains:readonly string[];topic?:string;audience:'ATHLETE'|'COACH'|'CLINICIAN'};
export type KnowledgeMatch={card:EvidenceCard;usage:'LIMITED_EXPLANATION'|'HOLD_ONLY'|'PROFESSIONAL_REVIEW';warning:string};
export function selectP7Knowledge(q:KnowledgeQuery):KnowledgeMatch[]{
 return P7_EVIDENCE.filter(c=>c.domains.some(d=>q.domains.includes(d))&&(!q.topic||q.topic===c.topic))
  .map(c=>{const usage:KnowledgeMatch['usage']=c.status==='PROFESSIONAL_ONLY'?'PROFESSIONAL_REVIEW':
   c.status==='HOLD'||c.status==='NUMERICAL_HOLD'||c.status==='NO_NORM_APPROVED'?'HOLD_ONLY':'LIMITED_EXPLANATION';
   return {card:c,usage,warning:c.tier==='ABSTRACT'?'Abstract-level evidence; no detailed prescription.':
     c.status==='NUMERICAL_HOLD'?'Numerical interpretation unresolved.':'Candidate evidence, not approved decision rule.'};
  });
}
export function distinctEvidenceGroups(cards:readonly EvidenceCard[]):number{
 return new Set(cards.map(c=>c.duplicateGroup??c.id)).size;
}
export function knowledgeDecisionGate(match:KnowledgeMatch):{
 allowExplanation:boolean;allowNumericScore:false;allowAutomaticDose:false;allowMedicalClearance:false
}{
 return {allowExplanation:match.usage==='LIMITED_EXPLANATION',allowNumericScore:false,
  allowAutomaticDose:false,allowMedicalClearance:false};
}
