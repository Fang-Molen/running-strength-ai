/** P7 evaluation policy. Descriptive, time-respecting, no automatic rule promotion. */
import type {AuditResult} from './coach-decision-calibration.ts';
export type EvaluatedCase={athleteId:string;caseId:string;metricId:string;protocolKey:string;
  unit:string;decisionAt:string;outcomeAt:string;actor:'FANGKUN'|'HUMAN_COACH'|'BASELINE';
  result:AuditResult;outcomeSourceId:string; outcomeSourceRevision:string};
export type GroupAudit={metricId:string;unit:string;protocolKey:string;actor:EvaluatedCase['actor'];n:number;athletes:number;
  mae:number|null;bias:number|null;excluded:number;status:'DESCRIPTIVE_ONLY'|'INSUFFICIENT_EVIDENCE'};
export function groupCalibration(cases:readonly EvaluatedCase[]):GroupAudit[]{
 const groups=new Map<string,EvaluatedCase[]>();
 for(const c of cases){const key=JSON.stringify([c.metricId,c.unit,c.protocolKey,c.actor]);groups.set(key,[...(groups.get(key)??[]),c]);}
 return [...groups].map(([key,items])=>{
  const [metricId,unit,protocolKey,actor]=JSON.parse(key) as [string,string,string,EvaluatedCase['actor']];
  const valid=items.filter(x=>x.result.state==='EVALUABLE'&&x.result.error!==null&&Number.isFinite(x.result.error)&&
    Date.parse(x.decisionAt)<Date.parse(x.outcomeAt));
  const n=valid.length;
  return {metricId,unit,protocolKey,actor,n,athletes:new Set(valid.map(x=>x.athleteId)).size,
   mae:n?valid.reduce((s,x)=>s+Math.abs(x.result.error!),0)/n:null,
   bias:n?valid.reduce((s,x)=>s+x.result.error!,0)/n:null,
   excluded:items.length-n,status:n?'DESCRIPTIVE_ONLY':'INSUFFICIENT_EVIDENCE'};
 });
}
export type BlindComparison={status:'DESCRIPTIVE_ONLY'|'NO_VALID_PAIRS';pairs:number;
  athleteCount:number;meanAbsoluteErrorDifference:number|null;fangkunWins:number;humanWins:number;ties:number;
  superiorityEstablished:false};
/** Only matched same-athlete, same-outcome-source, same-unit/protocol cases can be compared. */
export function strictBlindCompare(cases:readonly EvaluatedCase[]):BlindComparison{
 const f=cases.filter(x=>x.actor==='FANGKUN');
 const h=cases.filter(x=>x.actor==='HUMAN_COACH');
 const pairs:{a:EvaluatedCase;b:EvaluatedCase}[]=[];
 const used=new Set<string>();
 for(const a of f){
  if(a.result.state!=='EVALUABLE'||a.result.absoluteError===null)continue;
  const b=h.find(x=>x.athleteId===a.athleteId&&x.caseId===a.caseId&&x.metricId===a.metricId&&
   x.protocolKey===a.protocolKey&&x.unit===a.unit&&x.outcomeSourceId===a.outcomeSourceId&&
   x.outcomeSourceRevision===a.outcomeSourceRevision&&x.result.state==='EVALUABLE'&&
   x.result.absoluteError!==null&&!used.has(x.result.decisionId));
  if(b){pairs.push({a,b});used.add(b.result.decisionId);}
 }
 const differences=pairs.map(({a,b})=>a.result.absoluteError!-b.result.absoluteError!);
 return {status:pairs.length?'DESCRIPTIVE_ONLY':'NO_VALID_PAIRS',pairs:pairs.length,
  athleteCount:new Set(pairs.map(x=>x.a.athleteId)).size,
  meanAbsoluteErrorDifference:differences.length?differences.reduce((a,b)=>a+b,0)/differences.length:null,
  fangkunWins:differences.filter(x=>x<0).length,humanWins:differences.filter(x=>x>0).length,
  ties:differences.filter(x=>x===0).length,superiorityEstablished:false};
}
export type ImprovementCandidate={id:string;ruleId:string;reason:string;supportingCaseIds:string[];
  counterEvidenceCaseIds:string[];proposal:string;sourceVersions:string[];
  status:'RESEARCH_PROPOSAL';automaticApproval:false};
export function proposeRuleReview(input:{id:string;ruleId:string;reason:string;
 supportingCaseIds:string[];counterEvidenceCaseIds:string[];proposal:string;sourceVersions:string[]}):ImprovementCandidate|null{
 if(!input.id||!input.ruleId||!input.reason||!input.proposal||!input.supportingCaseIds.length||
    !input.sourceVersions.length)return null;
 return {...input,status:'RESEARCH_PROPOSAL',automaticApproval:false};
}
