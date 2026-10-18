/** P7 complete local decision lifecycle adapter. No automatic decisions or network calls. */
import { appendJournal, readJournal } from './storage-journal.ts';
import { P7_EVIDENCE, P7_EVIDENCE_VERSION } from './coach-p7-knowledge.ts';
import { auditDecision, summarizeCalibration, compareBlindPairs,
  type DecisionSnapshot, type OutcomeSnapshot, type AuditResult, type PairedJudgment } from './coach-decision-calibration.ts';
import {groupCalibration} from './coach-p7-evaluation.ts';

const PREFIX = 'fr255-p7:';
export type P7Event =
  | { kind:'DECISION'; decision:DecisionSnapshot; commitmentKind?:'LIVE'|'LEGACY' }
  | { kind:'OUTCOME'; outcome:OutcomeSnapshot; decisionId:string }
  | { kind:'SOURCE_REVISION'; athleteId:string; sourceId:string; revision:string; effectiveAt:string }
  | { kind:'REVIEW'; athleteId:string; decisionId:string; reviewedAt:string; note:string; reviewer:'HUMAN_COACH'|'ATHLETE'; action:'KEEP'|'RECONSIDER'|'DISMISS' };
export type P7Record = {id:string; event:P7Event; committedAt?:string};
const validTime=(s:string)=>Number.isFinite(Date.parse(s)) && /(?:Z|[+-]\d\d:\d\d)$/.test(s);
const athleteOf=(e:P7Event)=>e.kind==='DECISION'?e.decision.athleteId:e.kind==='OUTCOME'?e.outcome.athleteId:e.athleteId;
const unique=(id:string, records:readonly P7Record[])=>!records.some(r=>r.id===id);
export function p7Read(athleteId:string):P7Record[] {
  return readJournal<P7Event>(PREFIX).filter(x=>{
    try{const e=x.data;return ['DECISION','OUTCOME','SOURCE_REVISION','REVIEW'].includes(e.kind)&&athleteOf(e)===athleteId&&
      (e.kind!=='DECISION'||Array.isArray(e.decision.sources))&&(e.kind!=='OUTCOME'||!!e.outcome.source)}catch{return false}
  }).map(x=>({id:x.id,event:x.data,committedAt:x.recordedAt}));
}
function commitDecision(d:DecisionSnapshot,commitmentKind:'LIVE'|'LEGACY'):{ok:boolean;reason:string} {
  const records=p7Read(d.athleteId);
  if(!unique(d.id,records))return {ok:false,reason:'DUPLICATE_ID'};
  if(!d.id||!d.athleteId||!d.caseId||!d.metricId||!d.protocolKey||!d.unit||!d.hypothesis||!d.alternative||
     !d.sources.length||!validTime(d.createdAt)||!validTime(d.evidenceCutoff)||!validTime(d.observationDueAt)||
     Date.parse(d.evidenceCutoff)>Date.parse(d.createdAt)||Date.parse(d.observationDueAt)<=Date.parse(d.createdAt)||
     d.sources.some(s=>!s.sourceId||!s.revision)||d.planWrite!==false||
     (d.forecastValue!==null&&!Number.isFinite(d.forecastValue)))return {ok:false,reason:'INVALID_DECISION'};
  // The host must capture at the actual pre-outcome moment, not import a retroactive prediction.
  if(Date.parse(d.createdAt)>Date.now()+60_000)return {ok:false,reason:'FUTURE_DECISION'};
  if(d.sources.some(s=>{const notice=records.filter(r=>r.event.kind==='SOURCE_REVISION'&&r.event.sourceId===s.sourceId).at(-1);return notice?.event.kind==='SOURCE_REVISION'&&notice.event.revision!==s.revision}))
    return {ok:false,reason:'KNOWN_SOURCE_CONFLICT'};
  return {ok:appendJournal(PREFIX,d.id,{kind:'DECISION',decision:d,commitmentKind}),reason:'PERSISTENCE_RESULT'};
}
/** Legacy research imports are never eligible for live forecast calibration. */
export function p7CommitDecision(d:DecisionSnapshot):{ok:boolean;reason:string} {
  return commitDecision(d,'LEGACY');
}
/** Live predictions must use a non-injectable wall clock at commit time. */
export function p7CommitLiveDecision(d:DecisionSnapshot):{ok:boolean;reason:string} {
  const nowMs=Date.now();
  if(!Number.isFinite(nowMs)||!validTime(d.createdAt)||Math.abs(Date.parse(d.createdAt)-nowMs)>120_000||
     !validTime(d.observationDueAt)||Date.parse(d.observationDueAt)<=nowMs)
    return {ok:false,reason:'NOT_LIVE_PRECOMMITMENT'};
  if(!d.knowledgeEvidenceIds?.length||d.knowledgeVersion!==P7_EVIDENCE_VERSION||
     d.knowledgeEvidenceIds.some(id=>!P7_EVIDENCE.some(e=>e.id===id)))
    return {ok:false,reason:'UNVERIFIED_KNOWLEDGE_PROVENANCE'};
  return commitDecision(d,'LIVE');
}
export function p7CommitOutcome(decisionId:string,o:OutcomeSnapshot):{ok:boolean;reason:string} {
  const records=p7Read(o.athleteId);
  const decision=records.find(r=>r.id===decisionId&&r.event.kind==='DECISION');
  if(!decision||decision.event.kind!=='DECISION')return {ok:false,reason:'DECISION_NOT_FOUND'};
  if(!unique(o.id,records))return {ok:false,reason:'DUPLICATE_ID'};
  const d=decision.event.decision;
  if(!o.id||!o.source.sourceId||!o.source.revision||o.athleteId!==d.athleteId||o.caseId!==d.caseId||
     o.metricId!==d.metricId||o.protocolKey!==d.protocolKey||o.unit!==d.unit||
     !validTime(o.observedAt)||!validTime(o.recordedAt)||Date.parse(o.observedAt)<=Date.parse(d.createdAt)||
     (decision.event.commitmentKind==='LIVE'&&(!decision.committedAt||Date.parse(o.observedAt)<=Date.parse(decision.committedAt)))||
     Date.parse(o.recordedAt)<Date.parse(o.observedAt)||Date.parse(o.recordedAt)>Date.now()+60_000||
     Date.parse(o.observedAt)>Date.now()||
     (o.value!==null&&!Number.isFinite(o.value)))return {ok:false,reason:'INVALID_OUTCOME'};
  return {ok:appendJournal(PREFIX,o.id,{kind:'OUTCOME',outcome:o,decisionId}),reason:'PERSISTENCE_RESULT'};
}
export function p7CommitSourceRevision(athleteId:string,sourceId:string,revision:string,effectiveAt:string):boolean {
  if(!athleteId||!sourceId||!revision||!validTime(effectiveAt))return false;
  return appendJournal(PREFIX,`source:${sourceId}:${revision}`,{kind:'SOURCE_REVISION',athleteId,sourceId,revision,effectiveAt});
}
export function p7CommitReview(e:P7Event&{kind:'REVIEW'}):boolean {
  if(!e.athleteId||!e.decisionId||!validTime(e.reviewedAt)||!e.note.trim()||
     !p7Read(e.athleteId).some(r=>r.id===e.decisionId&&r.event.kind==='DECISION'))return false;
  return appendJournal(PREFIX,`review:${e.decisionId}:${e.reviewedAt}`,e);
}
export type P7Projection={decisions:DecisionSnapshot[]; results:AuditResult[];
  calibration:ReturnType<typeof summarizeCalibration>; blindComparison:ReturnType<typeof compareBlindPairs>;
  calibrationGroups:ReturnType<typeof groupCalibration>;
  needsReview:string[]; autonomousRuleUpdateAuthorized:false};
export function p7Project(athleteId:string, currentVersions:Readonly<Record<string,string>>):P7Projection {
  const entries=p7Read(athleteId);
  const decisions=entries.flatMap(r=>r.event.kind==='DECISION'?[r.event.decision]:[]);
  // Never override the caller's authoritative fact revisions with unverified
  // journal notices. Missing authoritative versions must remain unevaluable.
  const versions={...currentVersions};
  const results=decisions.map(d=>{
    const own=entries.find(r=>r.event.kind==='DECISION'&&r.event.decision.id===d.id);
    if(own?.event.kind!=='DECISION'||own.event.commitmentKind!=='LIVE')
      return {decisionId:d.id,state:'INCONCLUSIVE' as const,error:null,absoluteError:null,reason:'LEGACY_NOT_LIVE_PRECOMMITTED'};
    const candidates=entries.flatMap(r=>r.event.kind==='OUTCOME'&&r.event.decisionId===d.id?[r.event.outcome]:[]);
    const latest=candidates.at(-1)??null;
    if(latest&&(!own.committedAt||Date.parse(latest.observedAt)<=Date.parse(own.committedAt)))
      return {decisionId:d.id,state:'INVALID' as const,error:null,absoluteError:null,reason:'OUTCOME_PRECEDES_ACTUAL_COMMIT'};
    return auditDecision(d,latest,versions);
  });
  // Blind comparisons must share the exact outcome source and version, not just
  // athlete/case/metric. A different observation is not a valid paired trial.
  const paired:PairedJudgment[]=[];
  const usedHuman=new Set<string>();
  const latestOutcome=(id:string)=>entries.flatMap(r=>r.event.kind==='OUTCOME'&&r.event.decisionId===id?[r.event.outcome]:[]).at(-1)??null;
  for(const d of decisions.filter(x=>x.actor==='FANGKUN')){
    const a=results.find(x=>x.decisionId===d.id),oa=latestOutcome(d.id);
    if(!a||a.state!=='EVALUABLE'||!oa)continue;
    const other=decisions.find(x=>x.actor==='HUMAN_COACH'&&x.caseId===d.caseId&&x.metricId===d.metricId&&
      x.protocolKey===d.protocolKey&&x.unit===d.unit&&!usedHuman.has(x.id)&&
      latestOutcome(x.id)?.source.sourceId===oa.source.sourceId&&
      latestOutcome(x.id)?.source.revision===oa.source.revision&&
      results.some(r=>r.decisionId===x.id&&r.state==='EVALUABLE'));
    const b=other&&results.find(x=>x.decisionId===other.id);
    if(other&&b){paired.push({athleteId,caseId:d.caseId,fangkun:a,human:b});usedHuman.add(other.id);}
  }
  const calibrationGroups=groupCalibration(decisions.flatMap(d=>{const o=latestOutcome(d.id),result=results.find(r=>r.decisionId===d.id);return o&&result?[{athleteId,caseId:d.caseId,metricId:d.metricId,protocolKey:d.protocolKey,unit:d.unit,decisionAt:d.createdAt,outcomeAt:o.observedAt,actor:d.actor,result,outcomeSourceId:o.source.sourceId,outcomeSourceRevision:o.source.revision}]:[]}));
  const protocols=new Set(decisions.filter(d=>results.some(r=>r.decisionId===d.id&&r.state==='EVALUABLE')).map(d=>JSON.stringify([d.metricId,d.unit,d.protocolKey,d.actor])));
  const calibration=protocols.size>1?{status:'INSUFFICIENT_EVIDENCE' as const,eligibleCount:0,excludedCount:results.length,mae:null,bias:null,autonomousRuleUpdateAuthorized:false as const}:summarizeCalibration(results);
  return {decisions,results,calibration,calibrationGroups,blindComparison:compareBlindPairs(paired),
    needsReview:results.filter(r=>(r.state==='SUPERSEDED'||r.state==='INCONCLUSIVE')&&r.reason!=='LEGACY_NOT_LIVE_PRECOMMITTED').map(r=>r.decisionId),
    autonomousRuleUpdateAuthorized:false};
}
