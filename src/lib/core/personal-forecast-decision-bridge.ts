/** Optional bridge to V87 coach-decision-calibration.ts; drafts only, never persists. */
import type { DecisionSnapshot, ForecastDirection } from './coach-decision-calibration.ts'
import { auditRollingForecast, type ComparableSeries } from './personal-uncertainty.ts'
const validTime=(s:string)=>typeof s==='string'&&/T.*(?:Z|[+-]\d\d:\d\d)$/.test(s)&&Number.isFinite(Date.parse(s))
export function draftPersonalForecast(input:{
  series:ComparableSeries; decisionId:string; caseId:string; createdAt:string; dueAt:string;
  direction:ForecastDirection; safetyHold:boolean
  /** Trusted host's version for the whole source stream (not a per-day timestamp). */
  sourceVersions?:Readonly<Record<string,string>>
  /** Optional query-coverage revision: invalidate draft when missing or late data arrives. */
  coverageVersion?:{sourceId:string;revision:string}
}):DecisionSnapshot|null {
  const {series,decisionId,caseId,createdAt,dueAt,direction,safetyHold}=input
  const audit=auditRollingForecast(series)
  if(audit.status!=='AVAILABLE'||!decisionId||!caseId||!validTime(createdAt)||!validTime(dueAt)||
     Date.parse(createdAt)>Date.parse(series.asOf)||Date.parse(dueAt)<=Date.parse(createdAt)||
     series.points.at(-1)?.day!==series.asOf.slice(0,10)||!['LOWER_BETTER','HIGHER_BETTER'].includes(direction))return null
  const sources=new Map<string,string>()
  if(input.sourceVersions){
    // Per-day updatedAt differs for ordinary health records. Do not confuse it
    // with a version for the *entire* source stream; require trusted host handles.
    for(const sourceId of series.sourceIds){
      const revision=input.sourceVersions[sourceId]
      if(typeof revision!=='string'||!revision.trim())return null
      sources.set(sourceId,revision)
    }
  }else{
    // Backward-compatible only when the host truly provides one shared revision.
    for(const p of series.points){
      const existing=sources.get(p.sourceId)
      if(existing&&existing!==p.revision)return null
      sources.set(p.sourceId,p.revision)
    }
  }
  if(input.coverageVersion){
    const {sourceId,revision}=input.coverageVersion
    if(!sourceId||!revision||sources.has(sourceId))return null
    sources.set(sourceId,revision)
  }
  if(!sources.size)return null
  return {id:decisionId,athleteId:series.athleteId,actor:'FANGKUN',caseId,createdAt,
    evidenceCutoff:series.asOf,sources:[...sources].map(([sourceId,revision])=>({sourceId,revision})),
    hypothesis:'相同协议下，下一次观测值可能接近最近五次有效记录的均值。',
    alternative:'末次值持平或训练与生活条件改变也可能更符合实际；必须在后续观察中比较。',
    metricId:series.metric,protocolKey:series.protocol,unit:series.unit,
    forecastValue:audit.nextPrediction,forecastDirection:direction,observationDueAt:dueAt,
    uncertaintyNote:`研究性95%区间 ${audit.nextInterval![0].toFixed(3)}～${audit.nextInterval![1].toFixed(3)} ${series.unit}；留出回测覆盖 ${(audit.empiricalHoldoutCoverage!*100).toFixed(1)}%（n=${audit.holdoutN}），非未来保证。`,
    safetyHold,planWrite:false}
}
