/** Batch99: immutable source evidence. Import adapters supply explicit metadata;
 * no inferred device protocol, training permission, source averaging or synthetic zero. */
export type FactProvider = 'GARMIN' | 'COROS' | 'APPLE' | 'HUAWEI' | 'MANUAL'
export type FactMetric = 'STEPS' | 'ACTIVE_KCAL' | 'RESTING_KCAL' | 'TOTAL_KCAL' | 'WORKOUT_KCAL' | 'HRV' | 'RHR' | 'SLEEP' | 'BODY_BATTERY' | 'DURATION' | 'DISTANCE' | 'SESSION_RPE' | 'WEIGHT'
export type FactQuality = 'VALID' | 'UNKNOWN' | 'UNAVAILABLE' | 'NOT_WORN' | 'CONFLICT' | 'RETRACTED'
export type UnifiedFact = {
  athleteId: string; provider: FactProvider; accountRef: string; deviceId: string;
  recordId: string; metric: FactMetric; value: number | null; unit: string; protocol: string;
  start: string | null; end: string | null; receivedAt: string; day: string;
  utcOffsetMinutes: number | null; quality: FactQuality; revision: number;
  /** Set only for an explicitly confirmed common activity, never from proximity. */
  activityRef?: string; rawValue?: number | null; rawUnit?: string;
  /** An explicit reviewed edit supersedes this revision; original source evidence stays immutable. */
  manualCorrection?: { previousRevision: number };
}
export const FACT_UNITS: Record<FactMetric,string> = {STEPS:'steps',ACTIVE_KCAL:'kcal',RESTING_KCAL:'kcal',TOTAL_KCAL:'kcal',WORKOUT_KCAL:'kcal',HRV:'ms',RHR:'bpm',SLEEP:'h',BODY_BATTERY:'score',DURATION:'min',DISTANCE:'m',SESSION_RPE:'RPE',WEIGHT:'kg'}
const providers = ['GARMIN','COROS','APPLE','HUAWEI','MANUAL']
const qualities = ['VALID','UNKNOWN','UNAVAILABLE','NOT_WORN','CONFLICT','RETRACTED']
const known = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0 && s.length <= 200
export const exactInstant = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v)) && factDay(v.slice(0,10))
export const factDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v+'T00:00:00Z').toISOString().slice(0,10) === v
export function dayAt(instant: string, offset: number): string | null {
  return exactInstant(instant) && Number.isInteger(offset) && Math.abs(offset)<=840 ? new Date(Date.parse(instant)+offset*60000).toISOString().slice(0,10) : null
}
export function normalizeFact(input: UnifiedFact): UnifiedFact | null {
  if (!input || ![input.athleteId,input.accountRef,input.deviceId,input.recordId,input.protocol].every(known) || !providers.includes(input.provider) || !Object.hasOwn(FACT_UNITS,input.metric) || !qualities.includes(input.quality) || !Number.isSafeInteger(input.revision) || input.revision<0 || !exactInstant(input.receivedAt) || !factDay(input.day)) return null
  if (input.utcOffsetMinutes!==null && (!Number.isInteger(input.utcOffsetMinutes)||Math.abs(input.utcOffsetMinutes)>840)) return null
  if ([input.start,input.end].some(v=>v!==null&&!exactInstant(v))) return null
  if (input.start && input.end && Date.parse(input.end)<Date.parse(input.start) || input.end && Date.parse(input.end)>Date.parse(input.receivedAt) || input.start && Date.parse(input.start)>Date.parse(input.receivedAt)) return null
  if (input.activityRef!==undefined && !known(input.activityRef)) return null
  if (input.manualCorrection!==undefined && (!input.manualCorrection || !Number.isSafeInteger(input.manualCorrection.previousRevision) || input.manualCorrection.previousRevision<0 || input.manualCorrection.previousRevision>=input.revision)) return null
  if(input.rawValue!==undefined&&input.rawValue!==null&&(typeof input.rawValue!=='number'||!Number.isFinite(input.rawValue)) || input.rawUnit!==undefined&&(typeof input.rawUnit!=='string'||input.rawUnit.length>30))return null
  const {athleteId,provider,accountRef,deviceId,recordId,metric,value,unit,protocol,start,end,receivedAt,day,utcOffsetMinutes,quality,revision,activityRef}=input
  const f:UnifiedFact={athleteId,provider,accountRef,deviceId,recordId,metric,value,unit,protocol,start,end,receivedAt,day,utcOffsetMinutes,quality,revision,...(activityRef?{activityRef}:{}),rawValue:input.rawValue===undefined?input.value:input.rawValue,rawUnit:input.rawUnit??input.unit,...(input.manualCorrection?{manualCorrection:{previousRevision:input.manualCorrection.previousRevision}}:{})}
  if (f.quality!=='VALID') return f.value===null?{...f,unit:FACT_UNITS[f.metric]}:null
  if (typeof f.value!=='number'||!Number.isFinite(f.value)||f.value<0) return null
  const units: Record<string,number> = f.metric==='DISTANCE'?{m:1,km:1000,mi:1609.344}:f.metric==='DURATION'?{min:1,s:1/60,h:60}:f.metric==='SLEEP'?{h:1,min:1/60,s:1/3600}:f.metric.endsWith('KCAL')?{kcal:1,kJ:1/4.184}:f.metric==='WEIGHT'?{kg:1,lb:0.45359237}:f.metric==='HRV'?{ms:1,s:1000}:{[FACT_UNITS[f.metric]]:1}
  if (!(f.unit in units)) return null
  f.value*=units[f.unit];f.unit=FACT_UNITS[f.metric]
  if (!Number.isFinite(f.value) || ['HRV','RHR','WEIGHT'].includes(f.metric)&&f.value===0 || f.metric==='SESSION_RPE'&&f.value>10 || f.metric==='BODY_BATTERY'&&f.value>100 || f.metric==='SLEEP'&&f.value>24 || f.metric==='STEPS'&&!Number.isSafeInteger(f.value)) return null
  if (f.metric==='SLEEP'&&f.end&&f.utcOffsetMinutes!==null) f.day=dayAt(f.end,f.utcOffsetMinutes)!
  return f
}
export const factId = (f: UnifiedFact): string => JSON.stringify([f.athleteId,f.provider,f.accountRef,f.deviceId,f.recordId,f.metric])
export const factProtocol = (f: UnifiedFact): string => JSON.stringify([f.provider,f.accountRef,f.deviceId,f.protocol,f.unit])
/** Arrival order is irrelevant. A same-revision disagreement blocks that identity.
 * A higher revision resolves it; retractions never restore a lower value. */
export function projectFacts(raw: readonly UnifiedFact[], athleteId: string, asOf: string) {
  const evidence: UnifiedFact[]=[], rejected: string[]=[], conflicts: string[]=[]
  if(!known(athleteId)||!exactInstant(asOf)) return {facts:[] as UnifiedFact[],evidence,rejected:['INVALID_CONTEXT'],conflicts}
  const groups=new Map<string,UnifiedFact[]>()
  for(const x of raw){
    if(x?.athleteId!==athleteId)continue
    const f=normalizeFact(x);if(!f){rejected.push('INVALID_FACT');continue}
    if(Date.parse(f.receivedAt)>Date.parse(asOf))continue
    evidence.push(f); const id=factId(f);groups.set(id,[...groups.get(id)??[],f])
  }
  const facts:UnifiedFact[]=[]
  for(const [id,rows] of groups){
    const rev=Math.max(...rows.map(f=>f.revision)),latest=rows.filter(f=>f.revision===rev)
    const semantic=(f:UnifiedFact)=>JSON.stringify([f.metric,f.value,f.unit,f.protocol,f.start,f.end,f.day,f.quality,f.activityRef??null,f.utcOffsetMinutes,f.manualCorrection?.previousRevision??null])
    if(new Set(latest.map(semantic)).size!==1){conflicts.push(id);continue}
    const f=latest.sort((a,b)=>a.receivedAt.localeCompare(b.receivedAt)).at(-1)!
    if(f.quality==='CONFLICT')conflicts.push(id)
    if(f.quality==='VALID')facts.push(f)
  }
  return {facts:facts.sort((a,b)=>factId(a).localeCompare(factId(b))),evidence,rejected,conflicts}
}
/** Never sum alternate watches. Even agreeing independent records remain separate evidence. */
export function selectDailyFact(facts:readonly UnifiedFact[],metric:FactMetric,day:string,preferredProtocol?:string) {
  const candidates=facts.filter(f=>f.metric===metric&&f.day===day&&f.quality==='VALID'&&(!preferredProtocol||factProtocol(f)===preferredProtocol))
  const signatures=new Set(candidates.map(f=>JSON.stringify([f.athleteId,factProtocol(f),f.value])))
  return {status:!candidates.length?'UNAVAILABLE':signatures.size===1?'AVAILABLE':'CONFLICT',value:signatures.size===1?candidates[0].value:null,candidates} as const
}
export function personalFactBaseline(facts:readonly UnifiedFact[],current:UnifiedFact,windowDays=30){
  if(!normalizeFact(current)||current.quality!=='VALID'||!Number.isInteger(windowDays)||windowDays<1||windowDays>366||/UNKNOWN|UNSPECIFIED|未提供|未知/i.test(current.protocol))return null
  const from=new Date(Date.parse(current.day+'T00:00:00Z')-windowDays*864e5).toISOString().slice(0,10)
  const prior=facts.filter(f=>f.athleteId===current.athleteId&&f.metric===current.metric&&f.day>=from&&f.day<current.day&&factProtocol(f)===factProtocol(current))
  const days=[...new Set(prior.map(f=>f.day))].sort(),valid=days.flatMap(day=>{const s=selectDailyFact(prior,current.metric,day);return s.status==='AVAILABLE'?[s.candidates[0]]:[]})
  if(!valid.length||current.value===null)return null
  const values=valid.map(f=>f.value!).sort((a,b)=>a-b),i=Math.floor(values.length/2),median=values.length%2?values[i]:(values[i-1]+values[i])/2
  return {median,delta:current.value-median,percent:median===0?null:(current.value-median)/median*100,observedDays:valid.length,windowDays,sourceIds:valid.map(factId),complete:valid.length===windowDays,decisionAuthorized:false as const}
}
/** Calorie components never combine with a total or workout estimate implicitly. */
export function energyFacts(facts:readonly UnifiedFact[],day:string){
  return {active:selectDailyFact(facts,'ACTIVE_KCAL',day),resting:selectDailyFact(facts,'RESTING_KCAL',day),total:selectDailyFact(facts,'TOTAL_KCAL',day),workout:selectDailyFact(facts,'WORKOUT_KCAL',day),sum:null,reason:'活动、静息、全天总量和单次运动热量分别列示；不重复相加。'}
}
