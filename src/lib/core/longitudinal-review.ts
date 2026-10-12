import { projectAthleteEvidence } from './athlete-longitudinal-evidence.ts'
import { compareLongitudinalSessions } from './longitudinal-comparability.ts'
import type { AthleteEvidence } from './athlete-evidence-audit.ts'

/** K17: read-only longitudinal review. A measurement difference is never a training effect. */
export type LongitudinalReview = Readonly<{
  version:'FK-K17-1'; status:'REVIEWABLE'|'NEEDS_RECONCILIATION'|'INSUFFICIENT';
  count:number; dates:string[]; comparison:ReturnType<typeof compareLongitudinalSessions>;
  issues:string[]; followUpQuestions:string[];
  clinicalClearance:'UNKNOWN'; trainingAdaptation:'UNKNOWN';
  trainingDecisionAuthorized:false; originalDataModified:false;
}>
const followUp:Record<string,string>={
  REJECTED_INVALID_RECORDS:'请核对无效日期或记录值，保留原始记录与更正来源。',
  QUARANTINED_CONFLICTS:'同一记录存在冲突版本，需人工确认，不能自动择一。',
  FEWER_THAN_TWO_VALID_SESSIONS:'需要至少两个不同日期的有效同协议训练记录。',
  MISSING_SESSION_VALUE:'实际成绩缺失，不能按零处理。',
  MISSING_UNIT:'需要核实计时或距离单位。',
  MISSING_PROTOCOL_CONTEXT:'需要补充训练距离、组数、休息及测量条件。',
  UNIT_MISMATCH:'两次训练单位不同，不能直接比较。',
  PROTOCOL_CONTEXT_MISMATCH:'训练协议不同，不能将差异归因为能力变化。',
  SOURCE_MISMATCH:'记录来源不同，需核实设备与计时方式。',
  SAME_DAY_ONLY:'同一天的多次观测不足以说明长期适应。',
  SYMPTOM_REPORTED:'存在症状记录；成绩改善或HRV正常不能解除专业限制。',
  MISSING_SYMPTOM_ASSESSMENT:'没有症状评估记录不等于没有症状。',
  MISSING_RECOVERY:'恢复状态未记录，不得假定恢复良好。',
}
export function reviewLongitudinalTraining(items:readonly AthleteEvidence[]):LongitudinalReview {
 const timeline=projectAthleteEvidence(items)
 const comparison=compareLongitudinalSessions(items)
 const issues=[...comparison.reasons]
 const hasSymptom=timeline.ordered.some(x=>x.kind==='SYMPTOM')
 if(hasSymptom)issues.push('SYMPTOM_REPORTED')
 if(!timeline.latestByKind.SYMPTOM)issues.push('MISSING_SYMPTOM_ASSESSMENT')
 if(!timeline.latestByKind.RECOVERY)issues.push('MISSING_RECOVERY')
 const unique=[...new Set(issues)]
 const status:LongitudinalReview['status']=
  timeline.rejected.length||timeline.conflicts.length||hasSymptom||comparison.status==='NOT_COMPARABLE'
   ?'NEEDS_RECONCILIATION'
   :comparison.status==='COMPARABLE_OBSERVATIONS'?'REVIEWABLE':'INSUFFICIENT'
 return {version:'FK-K17-1',status,count:timeline.ordered.length,
  dates:[...new Set(timeline.ordered.map(x=>x.date))].sort(),comparison,
  issues:unique,followUpQuestions:unique.map(x=>followUp[x]||'请补充可追溯记录。'),
  clinicalClearance:'UNKNOWN',trainingAdaptation:'UNKNOWN',trainingDecisionAuthorized:false as const,originalDataModified:false as const}
}
/** Safety-critical flags are never truncated to fit a prompt. Raw personal data is not exported. */
export function buildLongitudinalReviewContext(items:readonly AthleteEvidence[],maxChars=1600):string {
 const budget=Number.isFinite(maxChars)?Math.max(400,Math.min(3000,Math.floor(maxChars))):1600
 const r=reviewLongitudinalTraining(items)
 const critical={version:r.version,status:r.status,issues:r.issues,
   clinicalClearance:r.clinicalClearance,trainingAdaptation:r.trainingAdaptation,
   trainingDecisionAuthorized:false as const,originalDataModified:false as const}
 const context:{version:string;status:string;issues:string[];clinicalClearance:'UNKNOWN';trainingAdaptation:'UNKNOWN';trainingDecisionAuthorized:false;originalDataModified:false;observations?:number;comparison?:{status:string;reasons:string[]};followUpQuestions?:string[]}={...critical}
 // Critical issues must not disappear even when the model's context budget is small.
 if(JSON.stringify(context).length>budget){
   return JSON.stringify({version:r.version,status:'NEEDS_RECONCILIATION',
     issues:['CONTEXT_BUDGET_EXCEEDED'],clinicalClearance:'UNKNOWN',trainingAdaptation:'UNKNOWN',
     trainingDecisionAuthorized:false as const,originalDataModified:false as const})
 }
 const optional={observations:r.count,comparison:{status:r.comparison.status,reasons:r.comparison.reasons},followUpQuestions:r.followUpQuestions}
 if(JSON.stringify({...context,...optional}).length<=budget)Object.assign(context,optional)
 else {
   if(JSON.stringify({...context,observations:r.count}).length<=budget)context.observations=r.count
   const questions=[...r.followUpQuestions]
   while(questions.length&&JSON.stringify({...context,followUpQuestions:questions}).length>budget)questions.pop()
   if(questions.length)context.followUpQuestions=questions
 }
 return JSON.stringify(context)
}
