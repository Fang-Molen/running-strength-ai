import {currentAthleteId} from '../core/events.ts'
import {currentStore,type MemoryStore} from '../core/storage.ts'
import {appendJournal,storeKeys} from '../core/storage-journal.ts'
import {healthChanged,validDay,localDay} from './observation.ts'
import {restKey,selectRestRecords,summarizeRest,type RestRecord,type RestKind,type RestSelection} from './intraday/sleep.ts'
import {stable,validRange,type MinuteRange,type Window} from './intraday/common.ts'

export const REST_PREFIX='fr255-recovery-rest-v1:'
const prefix=(owner:string)=>REST_PREFIX+encodeURIComponent(owner)+':'
export type SelfRestInput={requestId:string;athleteId:string;contextDay:string;kind:RestKind;
  duration:MinuteRange|null;start:string|null;end:string|null;timezone:string}
export type RestWriteResult={ok:true;persisted:true;id:string;replay:boolean}|{ok:false;persisted:false;code:string;id:string}
export function readRestHistory(s:MemoryStore|null=currentStore(),asOf=Date.now()) {
  const athleteId=currentAthleteId(),records:RestRecord[]=[],empty={athleteId,state:'UNAVAILABLE' as 'UNAVAILABLE'|'CORRUPT'|'AVAILABLE',records,selection:undefined as RestSelection|undefined,errors:[] as string[]}
  if(!s)return {...empty,errors:['STORAGE_UNAVAILABLE']}
  try {
    for(const key of storeKeys(s).filter(k=>k.startsWith(prefix(athleteId)))) {
      const e=JSON.parse(s.getItem(key)??'null'),row=e?.data?.record as RestRecord|undefined
      if(e?.schemaVersion!==1||e.data?.schema!=='FK-REST-U01'||!row||row.athleteId!==athleteId)throw Error('INVALID_REST_STORAGE')
      records.push(row)
    }
    const selection=selectRestRecords(records,athleteId,asOf)
    if(selection.conflicts.length)return {...empty,state:'CORRUPT' as const,records,errors:['REST_VERSION_CONFLICT']}
    return {...empty,state:'AVAILABLE' as const,records,selection}
  } catch(error){return {...empty,state:'CORRUPT' as const,errors:[error instanceof Error?error.message:'READ_FAILED']}}
}

/** Only self-reported entries enter this writer. Device transports require their own
 * verified, consented host adapter; caller JSON cannot manufacture one here. */
export function saveSelfReportedRest(input:SelfRestInput,now=Date.now()):RestWriteResult {
  const s=currentStore()
  const id=input.requestId,owner=currentAthleteId(),fail=(code:string):RestWriteResult=>({ok:false,persisted:false,code,id})
  if(!s)return fail('STORAGE_UNAVAILABLE')
  if(input.athleteId!==owner)return fail('OWNER_CHANGED')
  if(!id||id.length>160||!validDay(input.contextDay)||input.contextDay>localDay(new Date(now))||!Number.isSafeInteger(now))return fail('INVALID_CONTEXT')
  try {new Intl.DateTimeFormat('en',{timeZone:input.timezone}).format(now)}catch{return fail('TIMEZONE_REQUIRED')}
  const h=readRestHistory(s,now);if(h.state!=='AVAILABLE')return fail(h.errors[0]??'READ_FAILED')
  const start=input.start===null?null:Date.parse(input.start),end=input.end===null?null:Date.parse(input.end)
  if(start!==null&&(!Number.isSafeInteger(start)||!/(?:Z|[+-]\d\d:\d\d)$/.test(input.start!))||end!==null&&(!Number.isSafeInteger(end)||!/(?:Z|[+-]\d\d:\d\d)$/.test(input.end!)))return fail('ABSOLUTE_EVENT_TIME_REQUIRED')
  if((start===null)!==(end===null)||start!==null&&(end!<=start||end!>now))return fail('INVALID_EVENT_INTERVAL')
  if(input.duration!==null&&(!validRange(input.duration)||input.duration.low>1440||(input.duration.high!==null&&input.duration.high>1440)))return fail('INVALID_DURATION')
  if(start===null&&input.duration===null)return fail('DURATION_OR_INTERVAL_REQUIRED')
  if(start!==null&&input.duration!==null)return fail('INTERVAL_OR_ESTIMATE_NOT_BOTH')
  const previous=h.records.find(r=>r.originEventId===id)
  const record:RestRecord={athleteId:owner,sourceNamespace:'self:'+owner,originEventId:id,transport:'SELF_REPORT',transportRecordId:id,
    revision:1,knownAt:previous?.knownAt??now,occurredStart:start,occurredEnd:end,removed:false,kind:input.kind,
    form:start===null?'DURATION_ESTIMATE':'INTERVAL',duration:input.duration===null?null:{...input.duration},contextDay:input.contextDay,
    sourceEpisodeId:null,inclusion:'UNKNOWN',protocol:'SELF_REPORTED_'+input.timezone}
  try {
    const selected=selectRestRecords([record],owner,now)
    if(selected.excluded.length||!selected.records.length)return fail('INVALID_REST_EVENT')
    if(previous)return stable(previous)===stable(record)?{ok:true,persisted:true,id,replay:true}:fail('REQUEST_ID_CONFLICT')
    if(currentAthleteId()!==owner)return fail('OWNER_CHANGED')
    if(!appendJournal(prefix(owner),id,{schema:'FK-REST-U01',record,timezone:input.timezone}))return fail('WRITE_OR_READBACK_FAILED')
    if(currentAthleteId()!==owner)return fail('OWNER_CHANGED_AFTER_WRITE')
    const after=readRestHistory(s,now)
    if(after.state!=='AVAILABLE'||!after.records.some(r=>restKey(r)===restKey(record)))return fail('READBACK_FAILED')
    healthChanged();return {ok:true,persisted:true,id,replay:false}
  } catch(error){return fail(error instanceof Error?error.message:'SAVE_FAILED')}
}

/** Calendar windows come from the caller's actual timezone, never assume 24 hours
 * for DST or turn an unplaced duration into an invented sleep interval. */
export function readRestForWindow(day:string,window:Window,asOf=Date.now(),s:MemoryStore|null=currentStore()) {
  const h=readRestHistory(s,asOf)
  if(!validDay(day)||h.state!=='AVAILABLE')return {state:h.state,summary:null,errors:h.errors}
  const relevant=h.records.filter(r=>r.occurredStart!==null||r.contextDay===day)
  try{return {state:'AVAILABLE' as const,summary:summarizeRest(relevant,h.athleteId,asOf,window),errors:[] as string[]}}
  catch(error){return {state:'CORRUPT' as const,summary:null,errors:[error instanceof Error?error.message:'PROJECTION_FAILED']}}
}
export const REST_LABELS:Record<RestKind,string>={MAIN_SLEEP:'主睡眠',NAP:'午睡/补觉',SLEEP_UNCLASSIFIED:'睡眠（性质未定）',QUIET_REST:'安静休息',IN_BED:'在床',AWAKE:'清醒',REST_UNCERTAIN:'休息（是否睡着不清楚）'}
/** Revision only for explicitly selected self-report. Device episodes cannot be
 * edited through this route. The previous payload and its knownAt remain intact. */
export async function correctSelfReportedRest(input:{athleteId:string;originEventId:string;expectedRevision:number;requestId:string;
  kind:RestKind;duration:MinuteRange;confirmation:'CORRECT_SELECTED_REST'},options:{now?:number;lock?:<T>(work:()=>T|Promise<T>)=>Promise<T>}={}):Promise<RestWriteResult>{
  const owner=currentAthleteId(),now=options.now??Date.now(),id=input.requestId
  const fail=(code:string):RestWriteResult=>({ok:false,persisted:false,code,id})
  if(input.athleteId!==owner||input.confirmation!=='CORRECT_SELECTED_REST'||!id?.trim()||id.length>160||now>Date.now())return fail('INVALID_CORRECTION_CONTEXT')
  if(!validRange(input.duration)||input.duration.low>1440||input.duration.high!==null&&input.duration.high>1440)return fail('INVALID_DURATION')
  const lock=options.lock??(async<T>(work:()=>T|Promise<T>):Promise<T>=>{
    if(typeof navigator==='undefined'||!navigator.locks?.request)throw Error('CORRECTION_COORDINATION_UNAVAILABLE')
    return await navigator.locks.request('fk-rest-correction:'+owner,work)
  })
  try{return await lock(()=>{
    if(currentAthleteId()!==owner)return fail('OWNER_CHANGED')
    const h=readRestHistory(undefined,now);if(h.state!=='AVAILABLE')return fail('READ_FAILED')
    const rows=h.records.filter(r=>r.originEventId===input.originEventId).sort((a,b)=>b.revision-a.revision),old=rows[0]
    if(!old||old.sourceNamespace!=='self:'+owner||old.transport!=='SELF_REPORT'||old.form!=='DURATION_ESTIMATE')return fail('SELF_REPORTED_ESTIMATE_REQUIRED')
    const previous=h.records.find(r=>r.transportRecordId===id)
    if(previous)return previous.originEventId===input.originEventId&&previous.revision===input.expectedRevision+1&&previous.kind===input.kind&&stable(previous.duration)===stable(input.duration)?{ok:true,persisted:true,id,replay:true}:fail('REQUEST_ID_CONFLICT')
    if(old.revision!==input.expectedRevision)return fail('STALE_REST_REVISION')
    const record:RestRecord={...old,kind:input.kind,duration:{...input.duration},revision:old.revision+1,knownAt:now,transportRecordId:id}
    const selected=selectRestRecords([...h.records,record],owner,now);if(selected.conflicts.length||!selected.records.some(r=>r.transportRecordId===id))return fail('INVALID_REST_CORRECTION')
    if(!appendJournal(prefix(owner),id,{schema:'FK-REST-U01',record}))return fail('WRITE_OR_READBACK_FAILED')
    if(currentAthleteId()!==owner)return fail('OWNER_CHANGED_AFTER_WRITE')
    const read=readRestHistory(undefined,now);if(read.state!=='AVAILABLE'||!read.records.some(r=>r.transportRecordId===id))return fail('READBACK_FAILED')
    healthChanged();return {ok:true,persisted:true,id,replay:false}
  })}catch(error){return fail(error instanceof Error?error.message:'CORRECTION_FAILED')}
}
export function restContextLines(day:string,asOf=Date.now()):string[] {
  const from=new Date(day+'T00:00:00'),to=new Date(from);to.setDate(to.getDate()+1)
  const result=readRestForWindow(day,{start:from.getTime(),end:to.getTime()},asOf)
  if(!result.summary)return result.state==='AVAILABLE'?[]:['日内睡眠/休息读取未完成，未据此判断没有休息。']
  const summary=result.summary,lines=summary.records.map(r=>{
    const label=REST_LABELS[r.kind],range=r.duration
    return range?`${label}：自报${range.high===null?`至少${range.low}`:range.low===range.high?range.low:`${range.low}–${range.high}`}分钟，${r.occurredStart===null?'起止时间未定位':'起止已提供'}。`:
      `${label}：自报区间 ${new Date(r.occurredStart!).toISOString()} 至 ${new Date(r.occurredEnd!).toISOString()}。`
  })
  if(summary.state==='CONFLICT')lines.push('存在来源或重叠冲突，未选择最长或最新记录。')
  if(lines.length)lines.push('这些记录未证明全天睡眠覆盖完整；未与日汇总自动相加，也不据此自动加量。')
  return lines
}
