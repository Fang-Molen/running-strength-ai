/** Provenance for an imported daily value. Import time is never measurement time. */
export type Observation = {
  key: string; sourceId: string; statistic: string; syncedAt: string;
  measuredAt?: string | null; rawValue?: number; rawUnit?: string;
  previous?: { value: number; syncedAt: string }[];
}
export const HEALTH_CHANGED = 'fk-health-changed'
export function healthChanged() { if (typeof window !== 'undefined') window.dispatchEvent(new Event(HEALTH_CHANGED)) }
export function shortHash(value: string): string {
  let n = 2166136261
  for (const c of value) { n ^= c.charCodeAt(0); n = Math.imul(n, 16777619) }
  return (n >>> 0).toString(36)
}
export function localDay(now = new Date()): string { return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}` }
export function shiftDay(day: string, offset: number): string { return new Date(Date.parse(`${day}T12:00:00Z`) + offset * 86400000).toISOString().slice(0,10) }
export function validDay(day: string): boolean { return typeof day==='string' && /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(`${day}T12:00:00Z`).toISOString().slice(0,10) === day }
export function validObservation(v: Observation | undefined): boolean {
  return v === undefined || Boolean(v && typeof v.key==='string' && v.key.length>0 && v.key.length<=160 && typeof v.sourceId==='string' && v.sourceId.length>0 && v.sourceId.length<=120 && typeof v.statistic==='string' && v.statistic.length>0 && v.statistic.length<=80 && typeof v.syncedAt==='string' && Number.isFinite(Date.parse(v.syncedAt)) && (v.rawValue===undefined || Number.isFinite(v.rawValue)) && (v.rawUnit===undefined || typeof v.rawUnit==='string' && v.rawUnit.length<=20) && (v.measuredAt==null || typeof v.measuredAt==='string' && Number.isFinite(Date.parse(v.measuredAt))) && (v.previous===undefined || Array.isArray(v.previous) && v.previous.every(p=>p && Number.isFinite(p.value) && typeof p.syncedAt==='string' && Number.isFinite(Date.parse(p.syncedAt)))))
}
export function revisedObservation(next: Observation, old: {value:number; observation?:Observation} | undefined, value:number): Observation {
  return {...next, previous:[...(old?.observation?.previous??[]), ...(old && old.value!==value ? [{value:old.value,syncedAt:old.observation?.syncedAt??''}] : [])]}
}
export function valueText(metric:string,value:number):string {
  if(metric==='SLEEP') { const mins=Math.round(value*60); return `${Math.floor(mins/60)}小时${mins%60}分` }
  return `${Math.round(value*100)/100}${({HRV:' ms',RHR:' 次/分',NIGHT_HR:' 次/分',RECOVERY:' /10',WEIGHT:' kg',BODY_BATTERY:' /100',READINESS:' /100',STRESS:' /100',STEPS:' 步',SPO2:'%',RESP:' 次/分'} as Record<string,string>)[metric]??''}`
}
