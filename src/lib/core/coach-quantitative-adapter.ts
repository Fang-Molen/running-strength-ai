import {calculateQuantitativeRule,type QuantDatum,type QuantResult} from './coach-quantitative.ts'
import type {EvolutionSnapshot} from './coach-evolution-v4.ts'
import type {ChatTraining} from './coach-chat-evidence.ts'

/** Existing R173 engine, fed only by visible facts and explicit scope conditions.
 * Candidate thresholds never become decision or dosing instructions here. */
export function quantitativeReviewFacts(snapshot:EvolutionSnapshot,occurrenceId:string|null,chat?:ChatTraining):QuantResult[]{
 const active=snapshot.active.filter(e=>e.occurrenceId===occurrenceId&&e.athleteId===snapshot.athleteId&&e.source!=='THIRD_PARTY')
 const datum=(e:typeof active[number]):QuantDatum=>({id:e.id,athleteId:e.athleteId,value:e.value,unit:e.unit,sourceIds:[e.sourceId],revision:JSON.stringify(e),kind:e.source==='PLAN'?'PLAN':e.source==='USER_REPORT'?'SELF_REPORT':'ACTUAL',at:e.eventAt,recordedAt:e.recordedAt,protocol:e.context})
 const results:QuantResult[]=[]
 const call=(ruleId:string,values:Record<string,QuantDatum>,series:QuantDatum[]=[],conditions:string[]=[],conditionSourceIds:string[]=[])=>results.push(calculateQuantitativeRule(ruleId,{athleteId:snapshot.athleteId,asOf:snapshot.asOf,values,series,conditions,conditionSourceIds}))
 const groups=new Map<string,QuantDatum[]>()
 for(const e of active){
  if(e.metric==='SPLIT_SECONDS'&&e.source!=='PLAN'){
   const match=e.context.match(/^running:([^:]+):rep:([^:]+):([^:]+):(\d+):(\d+):(\d+(?:\.\d+)?)m$/)
   if(!match)continue
   const [,componentId,blockId,stepId,round,ordinal,meters]=match,key=JSON.stringify([componentId,blockId,stepId,round,meters])
   const d={...datum(e),distanceMeters:Number(meters),protocol:key,structure:{sessionId:e.occurrenceId,componentId,blockId,stepId,round:Number(round),ordinal:Number(ordinal)}}
   groups.set(key,[...groups.get(key)??[],d])
  }
  if(e.metric==='SLEEP_HOURS'&&e.source!=='PLAN')call('REC_SLEEP',{minutes:{...datum(e),value:e.value===null?null:e.value*60,unit:'min'}})
 }
 for(const rows of groups.values()){
  const round=rows[0].structure!.round
  const expected=chat?.splits.filter(s=>s.round===round)
  const complete=!!expected?.length&&expected.length===rows.length&&expected.every(s=>s.seconds!==null&&!s.excluded)
  const conditions=complete?['ALL_SEGMENTS_COMPLETED']:[]
  if(chat&&/(?:原计划|本课|这节课)(?:目的|目标)?(?:是|为|按)?(?:均速|均匀配速|同强度)|同目标/.test(chat.raw)&&!/不是均速|并非均匀/.test(chat.raw))conditions.push('UNIFORM_TASK')
  call('SESS_FADE',{},rows,conditions,chat?[chat.id]:[])
  call('SESS_CV',{},rows,conditions,chat?[chat.id]:[])
 }
 if(chat?.minutes!==null&&chat?.minutes!==undefined&&chat.rpe!==null){
  const base:QuantDatum={id:chat.id,athleteId:snapshot.athleteId,value:null,unit:'',sourceIds:[chat.id],revision:chat.raw,kind:'SELF_REPORT',at:snapshot.asOf,recordedAt:snapshot.asOf,protocol:'whole-session-self-report'}
  call('LOAD_SRPE',{minutes:{...base,id:chat.id+':minutes',value:chat.minutes,unit:'min'},rpe:{...base,id:chat.id+':rpe',value:chat.rpe,unit:'/10'}},[],chat.rpeAssumed?[]:['WHOLE_SESSION'],[chat.id])
 }
 for(const e of active.filter(e=>e.metric==='SPLIT_SECONDS'&&e.source!=='PLAN')){
  const target=active.filter(p=>p.metric==='GOAL_SECONDS'&&p.source==='PLAN'&&p.context===e.context)
  if(target.length===1)call('SESS_TARGET_HIT',{current:datum(e),reference:datum(target[0])})
 }
 return results
}
