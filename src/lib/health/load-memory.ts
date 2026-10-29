import type {EvidenceSnapshot,TrainingFact} from './analysis-contract'
import {sha256Hex} from '../core/sha256-sync'
import {analysisDigest} from './analysis-evidence'
import {buildLoadSummary,calendarDate,loadOccurrences,LOAD_ALGORITHM,type LoadCoverage,type LoadDay,type LoadOccurrence,type LoadSummary} from './load-evidence'
import {readAnalysis} from './analysis-host'
import {currentAthleteId,ATHLETE_SCOPE_CHANGED,onAppEvent} from '../core/events'
import {currentStore} from '../core/storage'
import {storageChangeRevision,notifyStorageChange,onStorageChange} from '../core/storage-changes'
import {appendJournal,readJournal} from '../core/storage-journal'
import {validLoadDay} from '../core/coach-load-metrics'

export const LOAD_MEMORY_COVERAGE='fr255-load-summary-coverage-v2:'
export const LOAD_MEASUREMENT='fr255-load-measurement-v2:'
export const LOAD_CACHE='fk-load-derived-cache-v2:'
type Measurement={id:string;athleteId:string;occurrenceId:string;sourceRevision:string;recordedAt:string;ratingCollectedAt:string;ratingScale:string;fullSession:true;completed:true}
export type LoadKeyEvent={id:string;knownAt:string;occurredAt:string|null;kind:'PAIN'|'RESPONSE'|'RESTRICTION'|'CONFLICT';text:string;refs:{id:string;revision:number}[]}
export type LoadMemoryResult={summary:LoadSummary;snapshot:EvidenceSnapshot;rawRevisions:Record<string,string>;keyEvents:LoadKeyEvent[];personalReference:{status:'DESCRIPTIVE_ONLY'|'NOT_ESTABLISHED';physiologicalBaseline:'NOT_ESTABLISHED';groups:{protocol:string;count:number;medianDistanceM:number|null;refs:{id:string;revision:number}[]}[]};diagnostics:{sourceReads:number;cacheHit:boolean;changedDays:string[];queryMilliseconds:number;cachePersisted:boolean}}
const visible=(at:string,asOf:string)=>Number.isFinite(Date.parse(at))&&Date.parse(at)<=Date.parse(asOf)
const freeze=<T>(value:T):T=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))freeze(child)}return value}
const median=(xs:number[])=>{const a=[...xs].sort((a,b)=>a-b);return a.length?a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2:null}
const dayKey=(owner:string,zone:string)=>JSON.stringify([owner,zone,LOAD_ALGORITHM])
function applyMeasurements(snapshot:EvidenceSnapshot){
 const raw=loadOccurrences(snapshot),rawRevisions=Object.fromEntries(raw.map(o=>[o.id,o.revision]))
 const proofs=readJournal<Measurement>(LOAD_MEASUREMENT).map(r=>r.data).filter(r=>r?.athleteId===snapshot.context.athleteId&&visible(r.recordedAt,snapshot.context.asOf)).sort((a,b)=>a.recordedAt.localeCompare(b.recordedAt))
 const facts=snapshot.facts.map(f=>{
  if(f.kind!=='TRAINING')return f
  const p=proofs.filter(p=>p.occurrenceId===f.canonicalActivityId&&p.sourceRevision===rawRevisions[f.canonicalActivityId]).at(-1)
  if(!p)return f
  return {...f,revision:parseInt(sha256Hex(JSON.stringify([f.revision,p])).slice(0,12),16),knownAt:[f.knownAt,p.recordedAt].sort().at(-1)!,sessionRpeScale:p.ratingScale,sessionLoadEvidence:{origin:f.sessionLoadEvidence?.origin??(f.provider==='APP'?'NATIVE':'CONFIRMED_IMPORT'),completed:true,durationBasis:'FULL_SESSION',ratingScope:'SESSION',ratingCollectedAt:p.ratingCollectedAt,ratingRecordedAt:p.recordedAt,ratingScale:p.ratingScale,sourceIds:[p.id,...(f.sessionLoadEvidence?.sourceIds??[])]}} as TrainingFact
 })
 const digest=analysisDigest([snapshot.context,facts,snapshot.excluded,snapshot.conflicts,snapshot.gaps,snapshot.safetyConstraints,snapshot.priorHypotheses])
 return {snapshot:{...snapshot,facts,snapshotId:digest,inputDigest:digest},rawRevisions}
}
function summarizeEvidence(snapshot:EvidenceSnapshot,rows:LoadOccurrence[]){
 const factIndex=new Map(snapshot.facts.map(f=>[f.id,f]))
   const keyEvents:LoadKeyEvent[]=[...snapshot.facts.filter(f=>f.kind==='RESPONSE').map(f=>({id:f.id,knownAt:f.knownAt,occurredAt:f.occurredAt,kind:f.kind==='RESPONSE'&&f.measure==='PAIN'?'PAIN' as const:'RESPONSE' as const,text:f.kind==='RESPONSE'?`${f.measure} ${f.value??'未知'} ${f.scale}；${f.notes??''}`:'',refs:[{id:f.id,revision:f.revision}]})),...snapshot.safetyConstraints.map(c=>({id:c.id,knownAt:snapshot.context.asOf,occurredAt:null,kind:'RESTRICTION' as const,text:c.scope,refs:c.evidenceRefs})),...snapshot.conflicts.map((c,i)=>({id:'conflict:'+i,knownAt:snapshot.context.asOf,occurredAt:null,kind:'CONFLICT' as const,text:c.reason,refs:c.refs}))]
   const comparable=new Map<string,LoadOccurrence[]>()
   for(const row of rows){
    const facts=row.refs.map(r=>factIndex.get(r.id)).filter((f):f is NonNullable<typeof f>=>!!f)
    if(facts.some(f=>!f.protocolKey))continue
    const protocol=analysisDigest(facts.map(f=>[f.provider,f.accountRef,f.deviceId,f.protocolKey,f.kind==='TRAINING'?[f.sessionRpeScale,f.modality,f.observedType]:null]))
    comparable.set(protocol,[...(comparable.get(protocol)??[]),row])
   }
   const groups=[...comparable].map(([protocol,rs])=>({protocol,count:rs.length,medianDistanceM:median(rs.filter(r=>r.distanceComplete&&r.knownDistanceM!==null).map(r=>r.knownDistanceM!)),refs:rs.flatMap(r=>r.refs)}))
 return {keyEvents,reference:{status:groups.length?'DESCRIPTIVE_ONLY' as const:'NOT_ESTABLISHED' as const,physiologicalBaseline:'NOT_ESTABLISHED' as const,groups}}
}
/** Source reads happen once per mutation/cutoff; indexed range reads never rescan raw history. */
export function createLoadMemory(readSource:(asOf:string,zone:string)=>EvidenceSnapshot){
 let reads=0
 const entries=new Map<string,{generation:number;snapshot:EvidenceSnapshot;rawRevisions:Record<string,string>;byDay:Map<string,LoadOccurrence[]>;byId:Map<string,LoadOccurrence>;dayResults:Map<string,LoadDay>;changedDays:string[];coverage:LoadCoverage[];keyEvents:LoadKeyEvent[];reference:LoadMemoryResult['personalReference']}>()
 return {
  clear(){entries.clear()},
  read(input:{athleteId:string;timeZone:string;startDay:string;endDay:string;asOf?:string;force?:boolean}):LoadMemoryResult{
   const began=performance.now(),now=input.asOf??new Date().toISOString(),scope=dayKey(input.athleteId,input.timeZone),key=scope+'|'+(input.asOf??'CURRENT:'+calendarDate(now,input.timeZone))
   if(!validLoadDay(input.startDay)||!validLoadDay(input.endDay)||input.startDay>input.endDay||!Number.isFinite(Date.parse(now)))throw Error('INVALID_LOAD_QUERY')
   let entry=entries.get(key),hit=!!entry&&!input.force&&entry.generation===storageChangeRevision()
   if(!hit){
    try{
     const source=readSource(now,input.timeZone);reads++
     if(source.context.athleteId!==input.athleteId||source.context.timeZone!==input.timeZone||source.context.asOf!==now)throw Error('LOAD_SCOPE_CHANGED')
     const applied=applyMeasurements(source),rows=loadOccurrences(applied.snapshot),byId=new Map(rows.map(o=>[o.id,o])),changed=new Set<string>(),byDay=new Map<string,LoadOccurrence[]>()
     for(const old of entry?.byId.values()??[])if(!byId.has(old.id)||byId.get(old.id)!.revision!==old.revision||byId.get(old.id)!.day!==old.day)changed.add(old.day)
     for(let row of rows){const old=entry?.byId.get(row.id);if(old?.revision===row.revision&&old.day===row.day)row=old;else changed.add(row.day);byDay.set(row.day,[...(byDay.get(row.day)??[]),row]);byId.set(row.id,row)}
     entry={generation:storageChangeRevision(),snapshot:applied.snapshot,rawRevisions:applied.rawRevisions,byDay,byId,dayResults:entry?.dayResults??new Map(),changedDays:[...changed].sort(),coverage:readJournal<LoadCoverage>(LOAD_MEMORY_COVERAGE).map(r=>r.data).filter(c=>c?.athleteId===input.athleteId),...summarizeEvidence(applied.snapshot,[...byId.values()])};entries.set(key,entry)
     while(entries.size>6)entries.delete(entries.keys().next().value!)
    }catch(error){entries.delete(key);throw error}
   }
   if(!entry)throw Error('LOAD_INDEX_UNAVAILABLE')
   const rows=[...entry.byDay].filter(([day])=>day>=input.startDay&&day<=input.endDay).flatMap(([,rows])=>rows)
   const coverage=entry.coverage
   const summary=buildLoadSummary(entry.snapshot,input.startDay,input.endDay,coverage,rows)
   summary.days=summary.days.map(day=>{const old=entry!.dayResults.get(day.day);if(old&&analysisDigest(old)===analysisDigest(day))return old;entry!.dayResults.set(day.day,day);return day})
   const {keyEvents,reference}=entry,groups=reference.groups
   let cachePersisted=false
   try{const store=currentStore();if(store){const cacheKey=LOAD_CACHE+encodeURIComponent(scope),value=JSON.stringify({schema:2,athleteId:input.athleteId,timeZone:input.timeZone,algorithm:LOAD_ALGORITHM,asOf:summary.asOf,startDay:summary.startDay,endDay:summary.endDay,sourceVersion:summary.sourceVersion,days:summary.days,weeks:summary.weeks,months:summary.months,keyEvents,personalReference:groups});store.setItem(cacheKey,value);cachePersisted=store.getItem(cacheKey)===value}}catch{/* Cache is dispensable; authoritative records and the fresh in-memory result remain intact. */}
   return freeze({summary,snapshot:entry.snapshot,rawRevisions:entry.rawRevisions,keyEvents,personalReference:reference,diagnostics:{sourceReads:reads,cacheHit:hit,changedDays:hit?[]:entry.changedDays,queryMilliseconds:performance.now()-began,cachePersisted}})
  }
 }
}
const memory=createLoadMemory((asOf,timeZone)=>{
 const a=readAnalysis(calendarDate(asOf,timeZone),asOf,'',{history:'RETAINED',timeZone})
 if(a.muscle.unreadable)throw Error('训练来源读取失败，汇总待更新；未把失败当成空白或零。')
 return a.snapshot
})
let watched:EventTarget|null=null
export function invalidateLoadMemory(){notifyStorageChange('LOAD_SOURCE_REFRESH')}
export function watchLoadMemory(listener:()=>void){
 const off=onStorageChange(()=>listener()),offEvents=onAppEvent(()=>invalidateLoadMemory())
 const target=typeof window==='undefined'?null:window
 const refresh=()=>invalidateLoadMemory(),scope=()=>{memory.clear();invalidateLoadMemory()}
 for(const event of ['storage','fk-training-activities-changed','fk-training-corrected'])target?.addEventListener(event,refresh)
 target?.addEventListener(ATHLETE_SCOPE_CHANGED,scope)
 return()=>{off();offEvents();for(const event of ['storage','fk-training-activities-changed','fk-training-corrected'])target?.removeEventListener(event,refresh);target?.removeEventListener(ATHLETE_SCOPE_CHANGED,scope)}
}
export function readLoadMemory(input:{startDay:string;endDay:string;asOf?:string;timeZone?:string;force?:boolean}){
 // Non-UI consumers also observe cross-tab and legacy writer notifications.
 if(typeof window!=='undefined'&&watched!==window){watched=window;for(const event of ['storage','fk-training-activities-changed','fk-training-corrected'])window.addEventListener(event,invalidateLoadMemory);window.addEventListener(ATHLETE_SCOPE_CHANGED,()=>{memory.clear();invalidateLoadMemory()})}
 return memory.read({...input,athleteId:currentAthleteId(),timeZone:input.timeZone??Intl.DateTimeFormat().resolvedOptions().timeZone})
}
export function confirmSummaryCoverage(summary:LoadSummary){
 if(summary.athleteId!==currentAthleteId())return {ok:false,reason:'档案已切换，未保存确认。'}
 const now=new Date().toISOString(),today=calendarDate(now,summary.timeZone)
 if(summary.endDay>=today||summary.days.length>366)return {ok:false,reason:'只能核对已结束的日期，一次最多366天。'}
 const fresh=readLoadMemory({startDay:summary.startDay,endDay:summary.endDay,timeZone:summary.timeZone,force:true}).summary
 if(fresh.days.length!==summary.days.length||fresh.days.some(d=>!summary.days.some(old=>old.day===d.day&&old.sourceVersion===d.sourceVersion)))return {ok:false,reason:'来源已变化，请刷新后重新核对。'}
 for(const day of fresh.days){
  const data:LoadCoverage={athleteId:summary.athleteId,timeZone:summary.timeZone,day:day.day,sourceVersion:day.sourceVersion,knownAt:now},id=analysisDigest([data.athleteId,data.timeZone,data.day,data.sourceVersion])
  if(readJournal<LoadCoverage>(LOAD_MEMORY_COVERAGE).some(r=>r.id===id&&r.data.sourceVersion===data.sourceVersion))continue
  if(!appendJournal(LOAD_MEMORY_COVERAGE,id,data))return {ok:false,reason:'部分日期确认保存失败，请刷新核对；没有自动补零。'}
 }
 return {ok:true,reason:'已保存日期完整性确认；缺少评分采集时间或完整课时口径的课程仍为候选。'}
}
export function confirmLoadMeasurement(input:{occurrenceId:string;day:string;expectedRevision:string;ratingCollectedAt:string;ratingScale:string;athleteId:string;fullSession:boolean;completed:boolean}){
 const now=new Date().toISOString(),zone=Intl.DateTimeFormat().resolvedOptions().timeZone,day=calendarDate(now,zone)
 if(input.athleteId!==currentAthleteId()||!input.fullSession||!input.completed||!['CR10','0-10_SESSION_RPE'].includes(input.ratingScale)||!visible(input.ratingCollectedAt,now))return {ok:false,reason:'请核对本人、整课范围、量表与评分采集时刻。'}
 if(!validLoadDay(input.day)||input.day>day)return {ok:false,reason:'训练日期无效。'}
 const current=readLoadMemory({startDay:input.day,endDay:input.day,force:true}),row=current.summary.occurrences.find(o=>o.id===input.occurrenceId)
 if(!row||current.rawRevisions[row.id]!==input.expectedRevision||row.sessionRpe===null||row.fullSeconds===null||row.fullSeconds<=0||Date.parse(input.ratingCollectedAt)<Date.parse(row.startedAt)+row.fullSeconds*1000||current.snapshot.facts.some(f=>f.kind==='TRAINING'&&f.canonicalActivityId===row.id&&(f.sessionLoadEvidence?.durationBasis==='MOVING'||f.sessionLoadEvidence?.origin==='NATIVE'&&(!f.endedAt||f.sessionLoadEvidence.completed!==true))))return {ok:false,reason:'训练版本、已结束状态、评分或时长不满足核对条件；未改写原记录。'}
 const id=analysisDigest([input.athleteId,input.occurrenceId,input.expectedRevision,input.ratingCollectedAt,input.ratingScale]),data:Measurement={id,athleteId:input.athleteId,occurrenceId:input.occurrenceId,sourceRevision:input.expectedRevision,recordedAt:now,ratingCollectedAt:input.ratingCollectedAt,ratingScale:input.ratingScale,fullSession:true,completed:true}
 const existing=readJournal<Measurement>(LOAD_MEASUREMENT).some(r=>r.id===id)
 if(!existing&&!appendJournal(LOAD_MEASUREMENT,id,data))return {ok:false,reason:'口径核对保存失败，请保留输入重试。'}
 return {ok:true,reason:existing?'该核对已保存，没有重复写入。':'已保存本人核对；这是自报口径，不是生理验证。'}
}
