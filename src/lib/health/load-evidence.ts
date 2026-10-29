import type {EvidenceRef, EvidenceSnapshot, StrengthSet, TrainingFact} from './analysis-contract'
import {analysisDigest} from './analysis-evidence'
import {shiftLoadDay,validLoadDay,calculateEwmaSeries,type LoadTrend} from '../core/coach-load-metrics'

export const LOAD_ALGORITHM='FK_DESCRIPTIVE_LOAD_2' as const
/** What the source actually proves; recording time is distinct from rating collection time. */
export interface SessionLoadEvidence {
 origin:'NATIVE'|'CONFIRMED_IMPORT'; completed:boolean|null
 durationBasis:'FULL_SESSION'|'ELAPSED'|'MOVING'|'UNKNOWN'
 ratingScope:'SESSION'|'SET'|'UNKNOWN'; ratingCollectedAt:string|null
 ratingRecordedAt:string|null; ratingScale:string|null
 sourceIds:string[]
}
export type StrengthLoadGroup={key:string;catalogId:string|null;catalogVersion:string|null;side:StrengthSet['side'];loadBasis:StrengthSet['loadBasis'];completedSets:number;skippedSets:number;unknownSets:number;knownReps:number|null;knownHoldSeconds:number|null;knownKgReps:number|null;volumeComplete:boolean;setRpe:number[];rir:number[];restMissing:number;refs:EvidenceRef[]}
export type LoadOccurrence={id:string;day:string;startedAt:string;endedAt:string|null;modalities:string[];refs:EvidenceRef[];revision:string;knownDistanceM:number|null;distanceComplete:boolean;runningSeconds:number|null;runRestMissing:number;strength:StrengthLoadGroup[];sessionRpe:number|null;ratingScale:string|null;fullSeconds:number|null;candidateAU:number|null;sessionAU:number|null;loadState:'QUALIFIED'|'CANDIDATE'|'UNKNOWN';gaps:string[]}
export type LoadDay={day:string;occurrenceIds:string[];sourceVersion:string;knownDistanceM:number|null;distanceComplete:boolean;knownStrengthSets:number|null;candidateAU:number|null;sessionAU:number|null;coverage:'CONFIRMED_REST'|'COMPLETE'|'PARTIAL'|'NOT_RECORDED';gaps:string[]}
export type LoadSummary={athleteId:string;timeZone:string;asOf:string;startDay:string;endDay:string;algorithm:typeof LOAD_ALGORITHM;sourceVersion:string;occurrences:LoadOccurrence[];days:LoadDay[];weeks:LoadPeriod[];months:LoadPeriod[];gaps:string[];limitations:string[]}
export type LoadPeriod={startDay:string;endDay:string;knownDays:number;missingDays:number;knownDistanceM:number|null;knownStrengthSets:number|null;sessionAU:number|null;sourceVersion:string}
const calendarFormatters=new Map<string,Intl.DateTimeFormat>()
export const calendarDate=(at:string,zone:string)=>{
 const date=new Date(at);if(!Number.isFinite(date.getTime()))throw Error('INVALID_LOAD_INSTANT')
 let fmt=calendarFormatters.get(zone);if(!fmt){fmt=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'});calendarFormatters.set(zone,fmt);if(calendarFormatters.size>12)calendarFormatters.delete(calendarFormatters.keys().next().value!)}
 const p=fmt.formatToParts(date)
 return ['year','month','day'].map(k=>p.find(v=>v.type===k)!.value).join('-')
}
const sumKnown=(v:(number|null)[])=>v.some(x=>x!==null)?v.reduce<number>((s,x)=>s+(x??0),0):null
const num=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x)&&x>=0
const visible=(at:string|null,asOf:string)=>!!at&&Number.isFinite(Date.parse(at))&&Date.parse(at)<=Date.parse(asOf)
const distinct=<T>(xs:T[])=>[...new Set(xs)]
const one=(xs:(number|null)[])=>xs.length&&xs.every(x=>x!==null&&x===xs[0])?xs[0]:null

export function loadOccurrences(snapshot:EvidenceSnapshot):LoadOccurrence[]{
 const {athleteId,asOf,timeZone}=snapshot.context,groups=new Map<string,TrainingFact[]>()
 for(const f of snapshot.facts){
  if(f.kind!=='TRAINING'||f.athleteId!==athleteId||f.status!=='CONFIRMED'||!visible(f.startedAt,asOf)||!visible(f.knownAt,asOf)||!visible(f.receivedAt,asOf))continue
  const rows=groups.get(f.canonicalActivityId)??[]
  if(!rows.some(r=>r.id===f.id&&r.revision===f.revision))rows.push(f)
  groups.set(f.canonicalActivityId,rows)
 }
 return [...groups.values()].map(facts=>{
  const first=facts[0],starts=distinct(facts.map(f=>f.startedAt)),gaps:string[]=[]
  const refs=facts.map(f=>({id:f.id,revision:f.revision})),running=facts.filter(f=>f.modality==='RUN'),segments=running.flatMap(f=>f.runSegments)
  const done=segments.filter(s=>s.completion==='COMPLETED'),distanceComplete=running.length>0&&segments.length>0&&segments.every(s=>s.completion==='SKIPPED'||s.completion==='COMPLETED'&&num(s.distanceM))
  const knownDistanceM=done.some(s=>num(s.distanceM))?done.reduce((s,r)=>s+(r.distanceM??0),0):distanceComplete?0:null
  if(running.length&&!distanceComplete)gaps.push('跑步距离仅含已知部分，未记录分段未补零')
  const strength=new Map<string,StrengthLoadGroup>()
  for(const f of facts)for(const s of f.strengthSets){
   const key=JSON.stringify([s.catalogId,s.catalogVersion,s.side,s.loadBasis,s.rangeProtocol,s.effortScale])
   const group=strength.get(key)??{key,catalogId:s.catalogId,catalogVersion:s.catalogVersion,side:s.side,loadBasis:s.loadBasis,completedSets:0,skippedSets:0,unknownSets:0,knownReps:null,knownHoldSeconds:null,knownKgReps:null,volumeComplete:true,setRpe:[],rir:[],restMissing:0,refs:[]}
   if(!group.refs.some(r=>r.id===f.id&&r.revision===f.revision))group.refs.push({id:f.id,revision:f.revision})
   if(s.completion==='SKIPPED')group.skippedSets++
   else if(s.completion!=='COMPLETED'){group.unknownSets++;group.volumeComplete=false}
   else{
    group.completedSets++;if(num(s.reps))group.knownReps=(group.knownReps??0)+s.reps;if(num(s.holdSeconds))group.knownHoldSeconds=(group.knownHoldSeconds??0)+s.holdSeconds
    if(num(s.reps)&&num(s.loadKg)&&['TOTAL_EXTERNAL','PER_HAND'].includes(s.loadBasis))group.knownKgReps=(group.knownKgReps??0)+s.reps*s.loadKg;else group.volumeComplete=false
    if(num(s.setRpe))group.setRpe.push(s.setRpe);if(num(s.rir))group.rir.push(s.rir)
    if(!num(s.restAfterSeconds))group.restMissing++
   }
   strength.set(key,group)
  }
  const ss=[...strength.values()];if(ss.some(s=>!s.volumeComplete))gaps.push('力量重量口径、次数或组记录不完整；不推断刺激或肌肉疲劳')
  if(ss.some(s=>s.restMissing))gaps.push('部分力量组间休息未记录')
  if(ss.some(s=>!s.setRpe.length&&!s.rir.length))gaps.push('部分动作缺少逐组RIR/RPE；整课评分不能代替')
  const rpe=one(facts.map(f=>num(f.sessionRpe)&&f.sessionRpe<=10?f.sessionRpe:null)),duration=one(facts.map(f=>num(f.actualDurationSeconds)&&f.actualDurationSeconds>0&&f.actualDurationSeconds<=86400?f.actualDurationSeconds:null))
  const scales=distinct(facts.map(f=>f.sessionRpeScale)),scale=scales.length===1?scales[0]:null
  const proofs=facts.map(f=>f.sessionLoadEvidence)
  const ended=facts.every(f=>f.sessionLoadEvidence?.origin==='NATIVE'?visible(f.endedAt,asOf):f.sessionLoadEvidence?.completed===true||visible(f.endedAt,asOf))
  const futureEnd=facts.some(f=>f.endedAt&&!visible(f.endedAt,asOf))
  const moving=proofs.some(p=>p?.durationBasis==='MOVING')
  const scopeOk=proofs.every(p=>p?.ratingScope!=='SET'&&p?.completed!==false&&(!p?.ratingCollectedAt||visible(p.ratingCollectedAt,asOf))&&(!p?.ratingRecordedAt||visible(p.ratingRecordedAt,asOf)))
  const allowedScale=scale==='CR10'||scale==='0-10_SESSION_RPE'||scale==='APP_SESSION_RPE_1_10'
  const candidate=starts.length===1&&ended&&!futureEnd&&!moving&&scopeOk&&rpe!==null&&duration!==null&&allowedScale?Number((rpe*duration/60).toFixed(6)):null
  const qualified=candidate!==null&&proofs.every(p=>p?.completed===true&&p.durationBasis==='FULL_SESSION'&&p.ratingScope==='SESSION'&&p.ratingScale===scale&&visible(p.ratingCollectedAt,asOf)&&visible(p.ratingRecordedAt,asOf)&&Date.parse(p.ratingCollectedAt!)>=Date.parse(first.startedAt)+(duration??0)*1000&&Date.parse(p.ratingCollectedAt!)<=Date.parse(p.ratingRecordedAt!)&&p.sourceIds.length>0)
  if(candidate===null)gaps.push('整课结束、评分/量表或时长口径未确认，整课AU未知')
  else if(!qualified)gaps.push('仅候选AU：完整课时、评分采集时间或整课口径仍需核对')
  if(starts.length!==1)gaps.push('同一整课的开始时刻冲突，未拆算负荷')
  return {id:first.canonicalActivityId,day:calendarDate(first.startedAt,timeZone),startedAt:first.startedAt,endedAt:facts.every(f=>f.endedAt===first.endedAt)?first.endedAt:null,modalities:distinct(facts.map(f=>f.modality)),refs,revision:analysisDigest(facts),knownDistanceM,distanceComplete,runningSeconds:sumKnown(done.map(s=>num(s.durationSeconds)?s.durationSeconds:null)),runRestMissing:done.filter(s=>s.kind!=='CONTINUOUS'&&!num(s.restAfterSeconds)).length,strength:ss,sessionRpe:rpe,ratingScale:scale,fullSeconds:duration,candidateAU:candidate,sessionAU:qualified?candidate:null,loadState:qualified?'QUALIFIED' as const:candidate!==null?'CANDIDATE' as const:'UNKNOWN' as const,gaps:distinct(gaps)}
 }).sort((a,b)=>a.startedAt.localeCompare(b.startedAt)||a.id.localeCompare(b.id))
}
/** Confirmations apply only to this exact day revision, owner, zone and known-at cutoff. */
export type LoadCoverage={athleteId:string;timeZone:string;day:string;sourceVersion:string;knownAt:string}
export function buildLoadSummary(snapshot:EvidenceSnapshot,startDay:string,endDay:string,coverage:readonly LoadCoverage[]=[],projected?:readonly LoadOccurrence[]):LoadSummary{
 if(!validLoadDay(startDay)||!validLoadDay(endDay)||startDay>endDay||Date.parse(endDay)-Date.parse(startDay)>36600*86400000)throw Error('INVALID_LOAD_RANGE')
 const {athleteId,timeZone,asOf}=snapshot.context
 const all=projected??loadOccurrences(snapshot),occurrences=all.filter(o=>o.day>=startDay&&o.day<=endDay),days:LoadDay[]=[]
 const baseGaps=distinct([...snapshot.gaps.filter(g=>/训练.*(?:读取|冲突)|导入.*(?:未知|更正)|缓存.*冲突|整课总量/.test(g)),...snapshot.conflicts.map(c=>c.reason)])
 const byDay=new Map<string,LoadOccurrence[]>();for(const o of occurrences)byDay.set(o.day,[...(byDay.get(o.day)??[]),o]);const cover=new Map<string,LoadCoverage[]>();for(const c of coverage)cover.set(c.day,[...(cover.get(c.day)??[]),c]);
 for(let day=startDay;day<=endDay;day=shiftLoadDay(day,1)!){
  const rows=byDay.get(day)??[],sourceVersion=analysisDigest([LOAD_ALGORITHM,athleteId,timeZone,day,rows,baseGaps])
  const confirmed=(cover.get(day)??[]).some(c=>c.athleteId===athleteId&&c.timeZone===timeZone&&c.day===day&&c.sourceVersion===sourceVersion&&visible(c.knownAt,asOf))
  const mixedScales=new Set(rows.filter(o=>o.sessionAU!==null).map(o=>o.ratingScale)).size>1
  const complete=confirmed&&!mixedScales&&rows.every(o=>o.sessionAU!==null)&&baseGaps.length===0
  days.push({day,occurrenceIds:rows.map(o=>o.id),sourceVersion,knownDistanceM:rows.some(o=>o.modalities.includes('RUN'))?sumKnown(rows.filter(o=>o.modalities.includes('RUN')).map(o=>o.knownDistanceM)):confirmed&&baseGaps.length===0?0:null,distanceComplete:confirmed&&baseGaps.length===0&&rows.filter(o=>o.modalities.includes('RUN')).every(o=>o.distanceComplete),knownStrengthSets:rows.some(o=>o.strength.length)?rows.flatMap(o=>o.strength).reduce((s,g)=>s+g.completedSets,0):confirmed&&baseGaps.length===0?0:null,candidateAU:sumKnown(rows.map(o=>o.candidateAU)),sessionAU:complete?rows.reduce((s,o)=>s+o.sessionAU!,0):null,coverage:!rows.length?confirmed&&baseGaps.length===0?'CONFIRMED_REST':'NOT_RECORDED':complete?'COMPLETE':'PARTIAL',gaps:distinct([...rows.flatMap(o=>o.gaps),...baseGaps,...(mixedScales?['不同评分量表不可合并为同口径AU']:[]),...(!confirmed?['当天全部训练尚未核对，空白不是休息']:[])])})
 }
 const periods=(kind:'week'|'month')=>{
  const groups=new Map<string,LoadDay[]>()
  for(const d of days){const weekday=new Date(d.day+'T12:00:00Z').getUTCDay(),key=kind==='month'?d.day.slice(0,7):shiftLoadDay(d.day,-((weekday+6)%7))!;groups.set(key,[...(groups.get(key)??[]),d])}
  return [...groups.values()].map(ds=>({startDay:ds[0].day,endDay:ds.at(-1)!.day,knownDays:ds.filter(d=>d.sessionAU!==null).length,missingDays:ds.filter(d=>d.sessionAU===null).length,knownDistanceM:sumKnown(ds.map(d=>d.knownDistanceM)),knownStrengthSets:sumKnown(ds.map(d=>d.knownStrengthSets)),sessionAU:new Set(occurrences.filter(o=>ds.some(d=>d.day===o.day)&&o.sessionAU!==null).map(o=>o.ratingScale)).size<=1&&ds.every(d=>d.sessionAU!==null)?ds.reduce((s,d)=>s+d.sessionAU!,0):null,sourceVersion:analysisDigest(ds.map(d=>d.sourceVersion))}))
 }
 return {athleteId,timeZone,asOf,startDay,endDay,algorithm:LOAD_ALGORITHM,sourceVersion:analysisDigest([LOAD_ALGORITHM,athleteId,timeZone,startDay,endDay,days,baseGaps]),occurrences,days,weeks:periods('week'),months:periods('month'),gaps:[...baseGaps,...(new Set(occurrences.filter(o=>o.sessionAU!==null).map(o=>o.ratingScale)).size>1?['范围内评分量表不同，不计算跨量表AU总和或EWMA']:[])],limitations:['按用户时区的训练开始日归属；跨午夜整课只计一次','AU为同口径整课自报×完整分钟的描述，不是疲劳、恢复或伤病概率','力量按动作/版本/单双侧/重量口径分组，单手重量不擅自乘二','未记录不当零；个人生理参考未建立，检索权重不参与负荷公式']}
}

/** UTC instant of the last millisecond of a user's calendar day, including DST. */
export function calendarDayEnd(day:string,zone:string){
 if(!validLoadDay(day))throw Error('INVALID_LOAD_DAY')
 const anchor=Date.parse(day+'T00:00:00Z');let lo=anchor-36*3600000,hi=anchor+48*3600000
 while(lo+1<hi){const mid=Math.floor((lo+hi)/2);if(calendarDate(new Date(mid).toISOString(),zone)<=day)lo=mid;else hi=mid}
 return lo
}

/** Existing descriptive EWMA, now fed only by canonical qualified days. */
export function summaryLoadTrend(summary:LoadSummary):LoadTrend {
 const days=summary.days.map(d=>({day:d.day,au:d.sessionAU,sessionCount:d.occurrenceIds.length,confirmed:d.coverage==='COMPLETE'||d.coverage==='CONFIRMED_REST'}))
 const complete=days.length===28&&days.every(d=>d.au!==null)&&new Set(summary.occurrences.filter(o=>o.sessionAU!==null).map(o=>o.ratingScale)).size<=1,values=days.map(d=>d.au!)
 const acute=complete?calculateEwmaSeries(values,7)!.at(-1)!:null,chronic=complete?calculateEwmaSeries(values,28)!.at(-1)!:null
 return {status:!complete?'INSUFFICIENT':chronic===0?'ZERO_BASELINE':'AVAILABLE',startDay:summary.startDay,endDay:summary.endDay,knownDays:days.filter(d=>d.au!==null).length,missingDays:days.filter(d=>d.au===null).map(d=>d.day),incompleteSessionIds:summary.occurrences.filter(o=>o.sessionAU===null).map(o=>o.id),duplicateIds:[],days,acute,chronic,ratio:chronic?acute!/chronic:null,sourceIds:summary.occurrences.flatMap(o=>o.refs.map(r=>`${r.id}@${r.revision}`))}
}
