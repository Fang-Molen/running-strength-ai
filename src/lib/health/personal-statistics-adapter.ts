/** Adapter for V87 HealthSnapshot. Read-only; host must load authorized athlete-scoped data. */
import type { HealthSnapshot } from './snapshot.ts'
import { selectComparableSeries, type ComparableSeries, type PersonalObservation } from '../core/personal-uncertainty.ts'

export function comparableHealthSeries(input:{
  snapshot:HealthSnapshot; athleteId:string; metric:'RHR'|'HRV'|'SLEEP'; asOf:string
}):ComparableSeries {
  const {snapshot,athleteId,metric,asOf}=input
  const view=snapshot.metrics.find(v=>v.metric===metric)
  const current=view?.current
  const unit=metric==='RHR'?'bpm':metric==='HRV'?'ms':'h'
  // Never infer a common protocol across device changes or legacy data.
  const protocol=current?.stream && !current.legacy && current.statistic &&
    !(metric==='HRV'&&!['RMSSD','SDNN'].includes(current.method)) &&
    !/区间代表值|UNKNOWN|未知|未提供/i.test(current.statistic)
      ? JSON.stringify([current.stream,current.statistic,current.method,current.deviceLabel??'',current.measurementMethod??'']) : ''
  const records:PersonalObservation[]=[]
  if(protocol && !snapshot.unreadable && view?.state!=='CONFLICT') {
    const unique=new Map<string,typeof current>()
    for(const p of [...(view?.series??[]),...(view?.candidates??[]),...(current?[current]:[])]){
      if(!p||p.metric!==metric||p.legacy||p.stream!==current?.stream||p.statistic!==current.statistic||p.method!==current.method||p.deviceLabel!==current.deviceLabel||p.measurementMethod!==current.measurementMethod)continue
      // No invented observation timestamp; only knownAt is required for as-of filtering.
      unique.set(p.id+':'+p.updatedAt,p)
    }
    for(const p of unique.values())if(p)records.push({observationId:p.id,athleteId,metric,day:p.day,value:p.value,unit,protocol,sourceId:p.stream,revision:p.updatedAt,recordedAt:p.updatedAt,kind:'ACTUAL'})
  }
  return selectComparableSeries({observations:records,athleteId,metric,unit,protocol:protocol||'NOT_COMPARABLE',asOf,onePerDay:true})
}
