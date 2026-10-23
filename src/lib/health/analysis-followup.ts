/** Adapt existing import follow-ups; never write, fabricate timestamps or rebind a stale revision. */
import type { ResponseFact, TrainingFact } from './analysis-contract'
import { coachImports } from '../core/coach-import-evidence'
import { readImportedFollowups } from '../core/training-followup'
import { regionFromExplicitLabel } from './recovery-host-u11'
import { refOf } from './analysis-evidence'
export function importedResponseFacts(athleteId:string,asOf:string,training:TrainingFact[]):ResponseFact[] {
 const result:ResponseFact[]=[]
 for(const record of coachImports(athleteId,asOf)){
  const targets=training.filter(t=>t.athleteId===athleteId&&t.occurrenceId===record.confirmedImportId)
  if(!targets.length)continue
  for(const row of readImportedFollowups(record)){
   if(Date.parse(row.savedAt)>Date.parse(asOf)||Date.parse(row.observedAt)>Date.parse(asOf)||targets.some(t=>Date.parse(t.knownAt)>Date.parse(row.savedAt)))continue
   for(const measure of ['PAIN','SORENESS','RECOVERY_FEELING'] as const){
    const body=measure==='PAIN'?row.pain:measure==='SORENESS'?row.soreness:null
    if(body?.state==='UNKNOWN'||measure==='RECOVERY_FEELING'&&row.recoveryScore===null)continue
    const id=`${row.followupId}:${measure}`
    result.push({id,revision:0,athleteId,provider:'MANUAL',accountRef:null,deviceId:null,sourceRecordId:id,protocolKey:'IMPORTED_FOLLOWUP_V1',occurredAt:row.observedAt,knownAt:row.savedAt,receivedAt:row.savedAt,sourceTimeZone:null,status:'CONFIRMED',quality:'PARTIAL',ownershipReceiptId:null,kind:'RESPONSE',relatedTrainingRefs:targets.map(refOf),region:body?.location?regionFromExplicitLabel(body.location):null,side:'UNSPECIFIED',measure,value:body?(body.state==='ABSENT'?0:body.intensity):row.recoveryScore,scale:body?'0-10_HIGH_WORSE':'1-10_HIGH_BETTER',observationProtocol:'IMPORTED_FOLLOWUP_V1',elapsedHours:null,functionTaskId:null,notes:row.sleepHours!==null?`自报睡眠 ${row.sleepHours} h；训练结束时间不明时不从开始时间冒充恢复间隔`:null})
   }
  }
 }
 return result
}
