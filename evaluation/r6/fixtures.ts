import { normalizeAskCoachInput } from '@/lib/strength/coach-pipeline'
import { deriveCoachBrief } from '@/lib/core/coach-brief'
import { buildParts } from '../k12/fixtures.ts'
import type { FormalEvidenceRow } from '@/lib/core/coach-v4-c11-adapter'
import type { ReasoningBasis } from '@/lib/core/coach-reasoning'
export const A='synthetic-r6',BEFORE='2026-03-03T12:00:00Z',AFTER='2026-03-06T12:00:00Z'
export const row=(recordId:string,metric:FormalEvidenceRow['metric'],value:number|null,patch:Partial<FormalEvidenceRow>={}):FormalEvidenceRow=>({
 recordId,athleteId:A,trainingOccurrenceId:'s1',sourceEventId:recordId,source:'TRAINING_FACT',status:'OBSERVED',metric,value,
 unit:metric==='SLEEP_HOURS'?'h':metric==='SESSION_RPE'||metric==='PAIN_SCORE'?'score':'s',protocol:metric==='SPLIT_SECONDS'?'running:c:rep:b:step:1:1:400m':'session:'+metric,
 occurredAt:'2026-03-01T10:00:00Z',knownAt:'2026-03-01T11:00:00Z',verifiedByFormalProjection:true,...patch})
export const baseRows=()=>[row('rep1','SPLIT_SECONDS',64),row('rep2','SPLIT_SECONDS',70,{protocol:'running:c:rep:b:step:1:2:400m',occurredAt:'2026-03-01T10:06:00Z'}),
 row('sleep','SLEEP_HOURS',5),row('ev:s1:rpe','SESSION_RPE',6)]
export function request(rows:FormalEvidenceRow[],asOf=BEFORE,priorAnalysis?:ReasoningBasis|null,question='这次训练掉速如何分析？'){
 return normalizeAskCoachInput({brief:deriveCoachBrief(buildParts(question,{occurrence:{id:'s1',startedAt:'2026-03-01T09:00:00Z'},rpe:6})),
  v4:{athleteId:A,asOf,rows,priorAnalysis}})
}
