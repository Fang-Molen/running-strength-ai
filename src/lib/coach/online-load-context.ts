import {calendarDate,type LoadSummary} from '../health/load-evidence'
import {readLoadMemory} from '../health/load-memory'
import {buildMuscleExposure} from '../health/muscle-exposure'
import {evaluateRecoveryEvidence} from '../health/recovery-assessment'
import {buildCoachAnalysisPacket} from '../health/analysis-packet'
import {detectRedFlags} from '../core/coach-red-flags'
import {shiftLoadDay} from '../core/coach-load-metrics'
import {contextPeriod} from './context-period'
import {sha256Hex} from '../core/sha256-sync'
import type {CoachContextRecord} from './online-contract'
export const asksLoadSummary=(q:string)=>/负荷|曲线|趋势|汇总|总量|月度|周度|整课\s*AU/i.test(q)

/** Exact full-scope totals precede optional representative details in the token budget. */
export function loadSummaryRecord(summary:LoadSummary,question:string,day:string):CoachContextRecord {
 const period=contextPeriod(question,calendarDate(summary.asOf,summary.timeZone),summary.timeZone),days=summary.days.filter(d=>period.matches(d.day,true)),ids=new Set(days.flatMap(d=>d.occurrenceIds)),rows=summary.occurrences.filter(o=>ids.has(o.id))
 const known=(values:(number|null)[])=>values.some(v=>v!==null)?values.reduce<number>((a,b)=>a+(b??0),0):null
 const raw=[...new Set(rows.flatMap(o=>o.refs.map(r=>r.id+'@'+r.revision)))],f=(name:string,value:string|number|boolean|null,unit:string|null=null)=>({name,value,unit})
 return {recordId:'ctx:'+sha256Hex(JSON.stringify([summary.athleteId,summary.timeZone,summary.startDay,summary.endDay,period.days])),revision:summary.sourceVersion,occurredAt:null,knownAt:summary.asOf,category:'ANALYSIS',state:'UNKNOWN',source:'USER_DECLARED:CANONICAL_LOAD_SUMMARY',fields:[
  f('kind','COMPUTED'),f('scope',period.label??summary.startDay+'至'+summary.endDay),f('timeZone',summary.timeZone),f('algorithm',summary.algorithm),f('sourceVersion',summary.sourceVersion),
  f('sessions',rows.length),f('days',days.length),f('qualifiedDays',days.filter(d=>d.sessionAU!==null).length),f('missingDays',days.filter(d=>d.sessionAU===null).length),
  f('knownDistance',known(days.map(d=>d.knownDistanceM)),'m'),f('distanceComplete',!!days.length&&days.every(d=>d.distanceComplete)),f('knownStrengthSets',known(days.map(d=>d.knownStrengthSets)),'sets'),
  f('qualifiedSessionLoad',days.length&&new Set(rows.filter(o=>o.sessionAU!==null).map(o=>o.ratingScale)).size<=1&&days.every(d=>d.sessionAU!==null)?known(days.map(d=>d.sessionAU)):null,'AU'),
  f('physiologicalBaseline','NOT_ESTABLISHED'),f('ratingScalesConsistent',new Set(rows.filter(o=>o.sessionAU!==null).map(o=>o.ratingScale)).size<=1),f('scopeRule','整课按开始日归属；混合课只计一次；只汇总全范围已确认事实，未知不补零；已知距离/组数不是完整负荷或生理结论'),
  f('dependencyDigest',sha256Hex(JSON.stringify(raw))),f('dependencyCount',raw.length),f('sourceLookup','按上述日期在负荷曲线查看原训练及版本')
 ]}
}
export function loadQuestionAnalysis(question:string,day:string,asOf:string,current=false){
 const timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone,period=contextPeriod(question,calendarDate(asOf,timeZone),timeZone)
 const range=period.bounds??{startDay:shiftLoadDay(day,-27)!,endDay:day}
 const memory=readLoadMemory({...range,timeZone,...(current?{}:{asOf})})
 const flags=detectRedFlags(question,{excludeOtherSubjects:true})
 const snapshot={...memory.snapshot,safetyConstraints:[...memory.snapshot.safetyConstraints,...(flags.level==='NONE'?[]:[{id:'current-question-flags',version:'CURRENT',scope:flags.level,evidenceRefs:[]}])]}
 const exposure=buildMuscleExposure(snapshot),assessment=evaluateRecoveryEvidence(snapshot,exposure)
 return {snapshot,packet:buildCoachAnalysisPacket(snapshot,assessment,exposure,{question}),summary:memory.summary,diagnostics:memory.diagnostics}
}
