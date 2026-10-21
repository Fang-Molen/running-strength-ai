/** U10 read-only recovery projection. No medical clearance or plan mutation. */
export type Metric='HEART_RATE'|'BODY_BATTERY'|'STRESS'
export type Context='SLEEP'|'REST'|'TRAINING'|'AWAKE'|'UNKNOWN'
export type Sample={athleteId:string;metric:Metric;value:number;measuredAt:string;knownAt:string;sourceId:string;protocol:string;statistic:'INSTANT'|'DAILY_MEAN'|'DAILY_MAX';quality:'CONFIRMED'|'UNVERIFIED'|'CONFLICT';context:Context;revision?:number}
export type Sleep={athleteId:string;eventId:string;startAt:string;endAt:string;knownAt:string;sourceId:string;kind:'MAIN'|'NAP'|'REST'|'UNKNOWN_SLEEP';evidence:'DEVICE_SLEEP'|'USER_CONFIRMED'|'DEVICE_REST'|'INFERRED_REST'}
export type Training={athleteId:string;eventId:string;startAt:string;endAt:string;sourceId:string;kind:'RUN'|'STRENGTH'|'OTHER';knownAt?:string;label?:string;endEstimated?:boolean}
export type Point={hour:number;value:number;n:number;measuredAt:string;sourceId:string}
export type Reference={hour:number;median:number;p25:number;p75:number;days:number}
export type Event={eventId:string;kind:Sleep['kind']|Training['kind'];startHour:number;endHour:number;startAt:string;endAt:string;sourceId:string;status:'CONFIRMED'|'POSSIBLE'|'CONFLICT';label?:string;endEstimated?:boolean}
export type MetricView={points:Point[];reference:Reference[];latest:Point|null;sourceId:string|null;status:'AVAILABLE'|'NO_CONTINUOUS_DATA'|'SOURCE_CONFLICT'}
export type View={athleteId:string;day:string;utcOffsetMinutes:number;generatedAt:string;metrics:Record<Metric,MetricView>;events:Event[];warnings:string[]}
export type Input={athleteId:string;day:string;utcOffsetMinutes:number;now:string;samples:Sample[];sleepEvents:Sleep[];trainingEvents:Training[];preferredSources?:Partial<Record<Metric,string>>;minReferenceDays?:number}
const DAY=86400000,MS=60000,metrics:Metric[]=['HEART_RATE','BODY_BATTERY','STRESS']
const ranges:Record<Metric,[number,number]>={HEART_RATE:[25,240],BODY_BATTERY:[0,100],STRESS:[0,100]}
const ts=(s:string)=>Date.parse(s),valid=(s:string)=>typeof s==='string'&&Number.isFinite(ts(s))
const localDay=(t:number,offset:number)=>new Date(t+offset*MS).toISOString().slice(0,10)
const hour=(t:number,offset:number)=>Math.floor((((t+offset*MS)%DAY)+DAY)%DAY/3600000)
const med=(xs:number[])=>{const a=[...xs].sort((x,y)=>x-y),n=a.length;return n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2}
const q=(xs:number[],p:number)=>{const a=[...xs].sort((x,y)=>x-y),k=(a.length-1)*p,i=Math.floor(k),j=Math.ceil(k);return a[i]+(a[j]-a[i])*(k-i)}
const overlap=(a:Sleep,b:Sleep)=>Math.max(0,Math.min(ts(a.endAt),ts(b.endAt))-Math.max(ts(a.startAt),ts(b.startAt)))
const sameSleep=(a:Sleep,b:Sleep)=>a.kind!=='REST'&&b.kind!=='REST'&&overlap(a,b)/Math.min(ts(a.endAt)-ts(a.startAt),ts(b.endAt)-ts(b.startAt))>=.7
const rank=(e:Sleep)=>e.evidence==='DEVICE_SLEEP'?3:e.evidence==='USER_CONFIRMED'?2:e.evidence==='DEVICE_REST'?1:0
export function buildIntradayRecovery(input:Input):View{
 const {athleteId,day,utcOffsetMinutes:offset}=input
 if(!athleteId||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(day)||!Number.isFinite(ts(day+'T00:00:00Z'))||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day||!Number.isInteger(offset)||Math.abs(offset)>840||!valid(input.now))throw Error('INVALID_CONTEXT')
 const now=ts(input.now),start=ts(day+'T00:00:00Z')-offset*MS,end=start+DAY,warnings:string[]=[],out={} as Record<Metric,MetricView>
 const accepted=input.samples.filter(s=>s.athleteId===athleteId&&metrics.includes(s.metric)&&valid(s.measuredAt)&&valid(s.knownAt)&&ts(s.measuredAt)<=now+5*MS&&ts(s.knownAt)<=now+5*MS&&ts(s.knownAt)>=ts(s.measuredAt)&&s.sourceId&&s.protocol&&s.quality==='CONFIRMED'&&s.statistic==='INSTANT'&&Number.isFinite(s.value)&&s.value>=ranges[s.metric][0]&&s.value<=ranges[s.metric][1])
 for(const metric of metrics){
  const relevant=accepted.filter(s=>s.metric===metric),today=relevant.filter(s=>localDay(ts(s.measuredAt),offset)===day),sources=[...new Set(today.map(s=>s.sourceId))]
  const selected=input.preferredSources?.[metric]
  if(sources.length>1&&!selected){out[metric]={points:[],reference:[],latest:null,sourceId:null,status:'SOURCE_CONFLICT'};warnings.push(metric+' 来源冲突，未合并');continue}
  const source=selected??sources[0]??null,protocol=today.find(s=>s.sourceId===source)?.protocol
  if(!source||!protocol){out[metric]={points:[],reference:[],latest:null,sourceId:source,status:'NO_CONTINUOUS_DATA'};continue}
  const byInstant=new Map<number,Sample>(),conflict=new Set<number>()
  for(const s of today.filter(s=>s.sourceId===source&&s.protocol===protocol)){
   const t=ts(s.measuredAt),old=byInstant.get(t)
   if(!old){byInstant.set(t,s);continue}
   if((s.revision??0)===(old.revision??0)&&s.value!==old.value){conflict.add(t);continue}
   if((s.revision??0)>(old.revision??0)){byInstant.set(t,s);conflict.delete(t);continue}
   if((s.revision??0)===(old.revision??0)&&ts(s.knownAt)>ts(old.knownAt))byInstant.set(t,s)
  }
  for(const t of conflict)byInstant.delete(t)
  if(conflict.size)warnings.push(metric+' 同时刻读数冲突，已排除')
  const unique=[...byInstant.values()].sort((a,b)=>ts(a.measuredAt)-ts(b.measuredAt)),groups=new Map<number,Sample[]>()
  for(const s of unique){const h=hour(ts(s.measuredAt),offset);groups.set(h,[...(groups.get(h)??[]),s])}
  const points=[...groups].sort((a,b)=>a[0]-b[0]).map(([h,ss])=>({hour:h,value:med(ss.map(s=>s.value)),n:ss.length,measuredAt:ss.at(-1)!.measuredAt,sourceId:source}))
  const last=unique.at(-1),latest=last?{hour:hour(ts(last.measuredAt),offset),value:last.value,n:1,measuredAt:last.measuredAt,sourceId:source}:null
  const hist=relevant.filter(s=>s.sourceId===source&&s.protocol===protocol&&ts(s.measuredAt)<start&&ts(s.measuredAt)>=start-28*DAY)
  const reference:Reference[]=[]
  for(const [h,ss] of groups){
   const contexts=[...new Set(ss.map(s=>s.context).filter(x=>x!=='UNKNOWN'))];if(contexts.length!==1)continue
   const byDay=new Map<string,number[]>()
   for(const s of hist){if(s.context!==contexts[0]||hour(ts(s.measuredAt),offset)!==h)continue
    const d=localDay(ts(s.measuredAt),offset);byDay.set(d,[...(byDay.get(d)??[]),s.value])}
   const values=[...byDay.values()].map(med);if(values.length<Math.max(3,input.minReferenceDays??7))continue
   reference.push({hour:h,median:med(values),p25:q(values,.25),p75:q(values,.75),days:values.length})
  }
  out[metric]={points,reference,latest,sourceId:source,status:points.length?'AVAILABLE':'NO_CONTINUOUS_DATA'}
 }
 const sleeps=input.sleepEvents.filter(e=>e.athleteId===athleteId&&e.eventId&&e.sourceId&&valid(e.startAt)&&valid(e.endAt)&&valid(e.knownAt)&&ts(e.startAt)<ts(e.endAt)&&ts(e.endAt)<=now+5*MS&&ts(e.knownAt)<=now+5*MS&&ts(e.endAt)>start&&ts(e.startAt)<end&&ts(e.endAt)-ts(e.startAt)<=DAY)
 const chosen:Sleep[]=[],conflicts=new Set<string>()
 for(const e of [...sleeps].sort((a,b)=>rank(b)-rank(a)||ts(b.knownAt)-ts(a.knownAt))){
  const existing=chosen.find(x=>sameSleep(e,x));if(!existing){chosen.push(e);continue}
  const durationDiff=Math.abs((ts(e.endAt)-ts(e.startAt))-(ts(existing.endAt)-ts(existing.startAt)))
  if(durationDiff>30*MS){conflicts.add(existing.eventId);warnings.push('重叠睡眠记录时长冲突，需核对')}
 }
 const events:Event[]=chosen.map(e=>({eventId:e.eventId,kind:e.kind,startAt:e.startAt,endAt:e.endAt,startHour:Math.max(0,(ts(e.startAt)-start)/3600000),endHour:Math.min(24,(ts(e.endAt)-start)/3600000),sourceId:e.sourceId,status:conflicts.has(e.eventId)?'CONFLICT':e.evidence==='DEVICE_SLEEP'||e.evidence==='USER_CONFIRMED'?'CONFIRMED':'POSSIBLE'}))
 for(const e of input.trainingEvents){if(e.athleteId!==athleteId||!e.eventId||!e.sourceId||!valid(e.startAt)||!valid(e.endAt)||ts(e.startAt)>=ts(e.endAt)||ts(e.endAt)>now||e.knownAt!==undefined&&(!valid(e.knownAt)||ts(e.knownAt)>now||ts(e.knownAt)<ts(e.endAt))||ts(e.endAt)<=start||ts(e.startAt)>=end)continue
  events.push({eventId:e.eventId,kind:e.kind,startAt:e.startAt,endAt:e.endAt,startHour:Math.max(0,(ts(e.startAt)-start)/3600000),endHour:Math.min(24,(ts(e.endAt)-start)/3600000),sourceId:e.sourceId,status:'CONFIRMED',label:e.label,endEstimated:e.endEstimated})}
 events.sort((a,b)=>a.startHour-b.startHour)
 return {athleteId,day,utcOffsetMinutes:offset,generatedAt:input.now,metrics:out,events,warnings}
}
/** Coach-facing read-only facts: a device metric cannot issue training clearance. */
export function recoveryCoachFacts(v:View){return {athleteId:v.athleteId,day:v.day,asOf:v.generatedAt,medicalClearance:false,autoPlanChange:false,
 readings:metrics.map(metric=>({metric,status:v.metrics[metric].status,sourceId:v.metrics[metric].sourceId,latest:v.metrics[metric].latest,referenceDays:v.metrics[metric].reference.map(x=>x.days),referenceType:'历史四分位描述区间（非置信区间）'})),
 sleepEvents:v.events.filter(e=>['MAIN','NAP','REST','UNKNOWN_SLEEP'].includes(e.kind)),warnings:v.warnings,
 interpretationLimit:'身体电量回升或心率下降不能证明午睡、局部肌肉恢复或训练许可；疼痛及医学限制独立优先'} }
