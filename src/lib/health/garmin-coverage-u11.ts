/** U11 Garmin coverage gate. Does not invent APIs or bypass account authorization. */
export type Capability='VERIFIED'|'UNVERIFIED'|'UNSUPPORTED'|'NOT_AUTHORIZED'
export type SyncState='OK'|'PARTIAL'|'EMPTY'|'AUTH'|'FAIL'|'STALE'
export type GarminCoverage={accountLinked:boolean;lastAttemptAt:string|null;lastUsefulAt:string|null;healthDays:number;activityRows:number;status:SyncState;intraday:Capability;napEvents:Capability;strengthSets:Capability;now:string}
export type GarminAdvice={mode:'READY_SUMMARY'|'SUMMARY_ONLY'|'NEEDS_SYNC'|'AUTH_REQUIRED';intradayVisible:boolean;napAutoAvailable:boolean;strengthSetAutoAvailable:boolean;messages:string[];canRetry:boolean}
const t=(x:string|null)=>x?Date.parse(x):NaN
export function reviewGarminCoverage(c:GarminCoverage):GarminAdvice{
 if(!Number.isFinite(Date.parse(c.now)))throw Error('INVALID_NOW')
 const messages:string[]=[]
 if(!c.accountLinked||c.status==='AUTH')return {mode:'AUTH_REQUIRED',intradayVisible:false,napAutoAvailable:false,strengthSetAutoAvailable:false,messages:['佳明账号未连接或授权失效；保留已有记录与手动输入。'],canRetry:false}
 if(c.status==='STALE')messages.push('账号或运动员切换，本次结果已丢弃')
 if(c.status==='PARTIAL')messages.push('部分同步成功，缺失的健康字段不能当作零')
 if(c.status==='FAIL')messages.push('同步失败，保留上次有效记录，不标记为本次更新')
 if(c.activityRows>=200)messages.push('活动列表达到本次200条上限，不能宣称历史活动完整')
 const useful=Number.isFinite(t(c.lastUsefulAt))&&t(c.lastUsefulAt)<=Date.parse(c.now)
 if(!useful||Date.parse(c.now)-t(c.lastUsefulAt)>6*3600000)messages.push('最近有效同步已较久，需标注测量时间而非冒充当前状态')
 const intraday=c.intraday==='VERIFIED',nap=c.napEvents==='VERIFIED',sets=c.strengthSets==='VERIFIED'
 if(!intraday)messages.push('未核实逐时心率/电量接口；每日汇总不能拼成全天曲线')
 if(!nap)messages.push('未取得明确午睡事件；心率下降不能自动当作午睡')
 if(!sets)messages.push('力量活动未提供可靠动作组次，需从App实际记录读取')
 const mode:GarminAdvice['mode']=!useful||c.status==='FAIL'||c.status==='STALE'?'NEEDS_SYNC':intraday?'READY_SUMMARY':'SUMMARY_ONLY'
 return {mode,intradayVisible:intraday&&useful,napAutoAvailable:nap&&useful,strengthSetAutoAvailable:sets&&useful,messages,canRetry:c.status!=='STALE'}
}
/** Only accepts data already delivered by a verified/authorized upstream adapter. */
export type IntradayPayload={athleteId:string;accountScope:string;providerVerified:boolean;authorized:boolean;sourceId:string;protocol:string;samples:{metric:'HEART_RATE'|'BODY_BATTERY'|'STRESS';at:string;value:number}[];sleepEvents:{id:string;kind:'MAIN'|'NAP'|'REST';startAt:string;endAt:string;providerConfirmed:boolean}[]}
export type IntradayNormalized={samples:{athleteId:string;metric:'HEART_RATE'|'BODY_BATTERY'|'STRESS';value:number;measuredAt:string;knownAt:string;sourceId:string;protocol:string;statistic:'INSTANT';quality:'CONFIRMED';context:'UNKNOWN'}[];sleepEvents:{athleteId:string;eventId:string;startAt:string;endAt:string;knownAt:string;sourceId:string;kind:'MAIN'|'NAP'|'REST';evidence:'DEVICE_SLEEP'|'DEVICE_REST'}[];errors:string[]}
const ISO=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/
const stamp=(x:string)=>ISO.test(x)&&Number.isFinite(Date.parse(x))
export function normalizeVerifiedGarminIntraday(p:IntradayPayload,subject:string,scope:string,knownAt:string):IntradayNormalized{
 const out:IntradayNormalized={samples:[],sleepEvents:[],errors:[]}
 if(!p.authorized||!p.providerVerified||p.athleteId!==subject||p.accountScope!==scope||!p.sourceId||!p.protocol||!stamp(knownAt)){
  out.errors.push('缺少已核验的授权、账号归属、时间或接口能力；未导入');return out
 }
 if(p.samples.length>20000||p.sleepEvents.length>200){out.errors.push('返回记录超过安全上限；拒绝静默截断');return out}
 const bounds={HEART_RATE:[25,240],BODY_BATTERY:[0,100],STRESS:[0,100]} as const
 const bySample=new Map<string,typeof out.samples[number]>(),conflicts=new Set<string>()
 for(const s of p.samples){
  const b=bounds[s.metric];if(!b||!stamp(s.at)||Date.parse(s.at)>Date.parse(knownAt)||!Number.isFinite(s.value)||s.value<b[0]||s.value>b[1]){out.errors.push('无效或未来的逐时样本已排除');continue}
  const key=`${s.metric}:${s.at}`,old=bySample.get(key)
  if(old&&old.value!==s.value){conflicts.add(key);continue}
  bySample.set(key,{athleteId:subject,metric:s.metric,value:s.value,measuredAt:s.at,knownAt,sourceId:p.sourceId,protocol:p.protocol,statistic:'INSTANT',quality:'CONFIRMED',context:'UNKNOWN'})
 }
 for(const k of conflicts)bySample.delete(k)
 if(conflicts.size)out.errors.push('同时间同指标存在冲突值，已排除冲突点')
 out.samples=[...bySample.values()].sort((a,b)=>Date.parse(a.measuredAt)-Date.parse(b.measuredAt))
 const events=new Map<string,typeof out.sleepEvents[number]>(),eventConflicts=new Set<string>()
 for(const e of p.sleepEvents){
  if(!e.id||!stamp(e.startAt)||!stamp(e.endAt)||Date.parse(e.endAt)<=Date.parse(e.startAt)||Date.parse(e.endAt)>Date.parse(knownAt)||Date.parse(e.endAt)-Date.parse(e.startAt)>24*3600000){out.errors.push('无效睡眠事件已排除');continue}
  if(!e.providerConfirmed){out.errors.push('未确认的休息事件未作为午睡');continue}
  const candidate:typeof out.sleepEvents[number]={athleteId:subject,eventId:e.id,startAt:e.startAt,endAt:e.endAt,knownAt,sourceId:p.sourceId,kind:e.kind,evidence:e.kind==='REST'?'DEVICE_REST':'DEVICE_SLEEP'}
  if(eventConflicts.has(e.id))continue
  const old=events.get(e.id)
  if(old&&JSON.stringify(old)!==JSON.stringify(candidate)){events.delete(e.id);eventConflicts.add(e.id);out.errors.push('同一睡眠事件存在冲突版本，未导入');continue}
  events.set(e.id,candidate)
 }
 out.sleepEvents=[...events.values()]
 return out
}
