import type {CoachRequestContext} from './online-contract';
import {interpretProfileLimit,parseCoachUtterance} from './utterance-semantics';
export type CoverageState='COMPLETE'|'INCOMPLETE'|'UNKNOWN';
export type ClearanceState='GRANTED'|'DENIED'|'UNKNOWN';
export type AnswerEvidenceState={coverage:CoverageState;clearance:ClearanceState;symptomReports:{id:string;revision:string;text:string;source:string}[];systemCautions:string[];declaredRestrictions:{id:string;revision:string;text:string;source:string}[]};
/** Describes source authority, never upgrades a symptom into a medical order.
 * Legacy `medicalClearance:false` meant absence of a verified grant, not denial. */
export function buildAnswerEvidenceState(question:string,context?:CoachRequestContext):AnswerEvidenceState{
 const result:AnswerEvidenceState={coverage:'UNKNOWN',clearance:'UNKNOWN',symptomReports:[],systemCautions:[],declaredRestrictions:[]};
 if(/(?:我|本人).{0,6}(?:确认|明确).{0,8}(?:漏记|缺失)|(?:我|本人).{0,4}(?:漏记了|漏记录)/.test(question))result.coverage='INCOMPLETE';
 const semantic=parseCoachUtterance(question);
 for(const [i,s] of [...semantic.personalSymptoms,...semantic.uncertainSymptoms].entries())result.symptomReports.push({id:'current-symptom:'+i,revision:'current',text:s.clause,source:'CURRENT_USER_REPORT'});
 for(const r of context?.records??[]){
  const value=(name:string)=>r.fields.find(f=>f.name===name)?.value;
  if(r.category==='DIALOGUE')continue;
  if(r.category==='RECOVERY'&&['PAIN','SORENESS'].includes(String(value('measure')))){
   const notes=String(value('notes')??'');if(notes&&!/^(?:无疼痛|无痛|没有疼痛)[；;。]?$/.test(notes))result.symptomReports.push({id:r.recordId,revision:r.revision,text:notes,source:r.source});
  }
  if(r.category==='RESTRICTION'&&typeof value('restriction')==='string'&&!value('omittedRestrictionCount')&&!['NONE_EXPLICIT','RESOLVED','UNKNOWN'].includes(interpretProfileLimit(String(value('restriction'))).status))result.declaredRestrictions.push({id:r.recordId,revision:r.revision,text:String(value('restriction')),source:r.source});
  const clearance=value('clearance');if(r.category==='RESTRICTION'&&['GRANTED','DENIED'].includes(String(clearance)))result.clearance=clearance as ClearanceState;
  if(value('coverageState')==='INCOMPLETE')result.coverage='INCOMPLETE';
 }
 if(result.symptomReports.length)result.systemCautions.push('依据症状作谨慎处理；这不是用户申报的医嘱或医疗许可状态。');
 return result;
}
