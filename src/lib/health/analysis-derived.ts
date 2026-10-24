import type { AnalysisFact, AnalysisPacketOptions, DerivedFact, EvidenceSnapshot, MetricFact, TrainingFact } from './analysis-contract'
import { analysisDigest, analysisReference, projectAnalysisEvidence, refOf, sourceScope, stableJson } from './analysis-evidence'
import { trainingDose } from './muscle-exposure'

const known = (value:unknown):value is number => typeof value==='number' && Number.isFinite(value) && value>=0
const sum = (values:number[]) => values.reduce((total,value) => total+value,0)
const uniqueRefs = (facts:AnalysisFact[]) => [...new Map(facts.map(f => [`${f.id}@${f.revision}`,refOf(f)])).values()].sort((a,b) => a.id.localeCompare(b.id)||a.revision-b.revision)
const input = (f:AnalysisFact,field:string,value:number,unit:string):DerivedFact['inputs'][number] => ({ref:refOf(f),field,value,unit})
const dayIndex = (day:string):number|null => {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return null
 const instant=Date.parse(`${day}T00:00:00Z`)
 return Number.isFinite(instant) && new Date(instant).toISOString().slice(0,10)===day ? instant/86400000 : null
}
function calendarDay(instant:string,timeZone:string):string {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(instant))
 const part=(type:string) => parts.find(p => p.type===type)!.value
 return `${part('year')}-${part('month')}-${part('day')}`
}
const rmssd = (f:MetricFact) => /^(?:RMSSD|HRV[_ -]RMSSD|RMSSD[_ -]MS)$/i.test(f.metric) && f.unit.toLowerCase()==='ms'
const rhr = (f:MetricFact) => /^(?:RHR|RESTING[_ -]HEART[_ -]RATE)$/i.test(f.metric) && f.unit.toLowerCase()==='bpm'

/** Host arithmetic over confirmed evidence. Missing fields never contribute an invented zero. */
export function deriveAnalysisFacts(snapshot:EvidenceSnapshot,options:AnalysisPacketOptions={}):DerivedFact[] {
 // Reuse the authority projection even when a caller constructs a snapshot directly.
 // It resolves revisions/retractions and checks athlete, actual status and knowledge time.
 const s=projectAnalysisEvidence({context:snapshot.context,facts:snapshot.facts})
 const now=Date.parse(s.context.asOf),result:DerivedFact[]=[]
 const training=s.facts.filter((f):f is TrainingFact => f.kind==='TRAINING' && !!f.occurrenceId && Date.parse(f.startedAt)<=now && (!f.endedAt || Date.parse(f.endedAt)<=now))
 const add=(metric:string,value:number,unit:string,formula:string,text:string,sources:AnalysisFact[],occurrenceId:string|null,inputs:DerivedFact['inputs'],variant='',contextSources?:DerivedFact['contextSources']) => {
  if(!Number.isFinite(value))return
  const evidenceRefs=uniqueRefs(sources)
  const scope={athleteId:s.context.athleteId,asOf:s.context.asOf,occurrenceId,providerScopes:[...new Set(sources.map(sourceScope))].sort()}
  const token=analysisDigest([metric,value,unit,formula,evidenceRefs,scope,inputs,variant,...(contextSources?[contextSources]:[])]).slice('analysis:'.length)
  const anchor=evidenceRefs.map(r => `${encodeURIComponent(r.id)}@${r.revision}`).join('+')||'context'
  result.push({id:`derived:${metric}:${anchor}:${token}`,metric,value,unit,formula,formulaVersion:'FK_DERIVED_1',text,evidenceRefs,scope,inputs,...(contextSources?{contextSources}:{})})
 }
 const trainingLabel=(t:TrainingFact) => `${calendarDay(t.startedAt,s.context.timeZone)} ${t.id}@${t.revision}（occurrence ${t.occurrenceId}；${t.modality}/${t.componentId}）`
 for(const t of training){
  const label=trainingLabel(t),dose=trainingDose(t)
  const record=(metric:string,value:number,unit:string,formula:string,description:string,inputs:DerivedFact['inputs'],variant='') => add(metric,value,unit,formula,`${label}：${description} ${value} ${unit}。`,[t],t.occurrenceId,inputs,variant)
  // A projected PARTIAL record may lack RPE or classification while its dose
  // inputs are complete. Each calculation checks its own fields below.
  if(t.modality==='RUN' && ['AVAILABLE','PARTIAL'].includes(t.quality) && t.runSegments.length && t.runSegments.every(r => ['COMPLETED','SKIPPED'].includes(r.completion))){
   const runs=t.runSegments.map((r,index) => ({r,index})).filter(({r}) => r.completion==='COMPLETED')
   const distances=runs.map(({r}) => r.distanceM),durations=runs.map(({r}) => r.durationSeconds)
   const distanceInputs=runs.map(({r,index}) => input(t,`runSegments[${index}].distanceM`,r.distanceM!,'m'))
   const timeInputs=runs.map(({r,index}) => input(t,`runSegments[${index}].durationSeconds`,r.durationSeconds!,'s'))
   const distanceKnown=runs.length>0 && distances.every(known),timeKnown=runs.length>0 && durations.every(known)
   if(distanceKnown)record('RUN_DISTANCE_M',dose.distanceM!,'m','sum(COMPLETED runSegments.distanceM)','完成段总距离',distanceInputs)
   if(timeKnown){
    record('RUN_WORK_SECONDS',dose.workSeconds!,'s','sum(COMPLETED runSegments.durationSeconds); excludes rest','纯跑总用时（不含间歇）',timeInputs)
    record('RUN_SEGMENT_RANGE_SECONDS',Math.max(...durations as number[])-Math.min(...durations as number[]),'s','max(COMPLETED runSegments.durationSeconds) - min(COMPLETED runSegments.durationSeconds)','完成段用时极差',timeInputs)
    record('RUN_SEGMENT_MEAN_SECONDS',dose.workSeconds!/runs.length,'s','sum(COMPLETED runSegments.durationSeconds) / count(COMPLETED runSegments)','完成段平均用时',timeInputs)
   }
   if(distanceKnown && timeKnown && dose.distanceM!>0)record('RUN_PACE_SECONDS_PER_KM',dose.workSeconds!/dose.distanceM!*1000,'s/km','sum(workSeconds) / sum(distanceM) * 1000','完成段平均配速', [...timeInputs,...distanceInputs])
   // Time changes require comparable distances and recorded ordering. A time
   // increase and a speed decline have different denominators.
   if(runs.length>=2 && distanceKnown && timeKnown && runs.every(({r}) => r.distanceM===runs[0].r.distanceM && r.distanceM!>0 && r.durationSeconds!>0 && r.gradePercent===runs[0].r.gradePercent && r.surface===runs[0].r.surface)){
    const first=runs[0],last=runs[runs.length-1],firstTime=first.r.durationSeconds!,lastTime=last.r.durationSeconds!,delta=lastTime-firstTime
    const times=[input(t,`runSegments[${first.index}].durationSeconds`,firstTime,'s'),input(t,`runSegments[${last.index}].durationSeconds`,lastTime,'s')]
    record('RUN_TIME_CHANGE_SECONDS',delta,'s','last.durationSeconds - first.durationSeconds (same-distance completed segments)','末段较首段用时变化',times)
    record('RUN_TIME_CHANGE_PERCENT',delta/firstTime*100,'%','(last.durationSeconds - first.durationSeconds) / first.durationSeconds * 100','末段较首段用时变化率',times)
    const firstSpeed=first.r.distanceM!/firstTime,lastSpeed=last.r.distanceM!/lastTime
    record('RUN_SPEED_DECLINE_PERCENT',(firstSpeed-lastSpeed)/firstSpeed*100,'%','(first.distanceM/first.durationSeconds - last.distanceM/last.durationSeconds) / (first.distanceM/first.durationSeconds) * 100','末段较首段速度下降率',[...times,input(t,`runSegments[${first.index}].distanceM`,first.r.distanceM!,'m'),input(t,`runSegments[${last.index}].distanceM`,last.r.distanceM!,'m')])
   }
  }
  if(t.modality==='STRENGTH' && ['AVAILABLE','PARTIAL'].includes(t.quality) && t.strengthSets.length && t.strengthSets.every(set => ['COMPLETED','SKIPPED'].includes(set.completion))){
   const sets=t.strengthSets.map((set,index) => ({set,index})).filter(({set}) => set.completion==='COMPLETED')
   if(sets.length)record('STRENGTH_SETS',sets.length,'sets','count(COMPLETED strengthSets)','完成组数',sets.map(({index}) => input(t,`strengthSets[${index}].completion.COMPLETED`,1,'sets')))
   if(sets.length && sets.every(({set}) => known(set.reps)))record('STRENGTH_REPS',dose.reps!,'reps','sum(COMPLETED strengthSets.reps)','完成总次数',sets.map(({set,index}) => input(t,`strengthSets[${index}].reps`,set.reps!,'reps')))
   const groups=new Map<string,typeof sets>()
   for(const entry of sets){
    const set=entry.set
    if(!['TOTAL_EXTERNAL','PER_HAND'].includes(set.loadBasis))continue
    const key=stableJson([set.catalogId,set.catalogVersion,set.loadBasis,set.side,set.rangeProtocol])
    groups.set(key,[...(groups.get(key)??[]),entry])
   }
   for(const [key,group] of groups){
    if(!group.every(({set}) => known(set.loadKg) && known(set.reps)))continue
    const set=group[0].set,unit=set.loadBasis==='PER_HAND'?'kg·reps/hand':'kg·reps'
    const inputs=group.flatMap(({set,index}) => [input(t,`strengthSets[${index}].loadKg`,set.loadKg!,set.loadBasis==='PER_HAND'?'kg/hand':'kg'),input(t,`strengthSets[${index}].reps`,set.reps!,'reps')])
    record('STRENGTH_EXTERNAL_VOLUME_KG_REPS',sum(group.map(({set}) => set.loadKg!*set.reps!)),unit,`sum(loadKg * reps); basis=${set.loadBasis}; grouped by catalog/version/side/range; no inferred hand multiplier`,`${set.catalogId??'UNMAPPED'} ${set.loadBasis} ${set.side} 外部负重次数积`,inputs,key)
   }
  }
 }
 if(training.length){
  const count=new Set(training.map(t => t.occurrenceId)).size
  add('OCCURRENCE_COUNT',count,'occurrences','countDistinct(confirmed training.occurrenceId); mixed components share one occurrence',`截至 ${s.context.asOf}，已确认训练记录包含 ${count} 个独立 occurrence；同课跑步和力量按同一 occurrence 计数。`,training,null,training.map(t => input(t,`occurrenceId:${t.occurrenceId}`,1,'occurrence-marker')))
 }

 const metricGroups=new Map<string,MetricFact[]>()
 for(const f of s.facts){
  if(f.kind!=='METRIC' || f.quality!=='AVAILABLE' || !known(f.value) || !(rmssd(f)||rhr(f)))continue
  const key=stableJson([sourceScope(f),f.metric,f.unit,f.statistic])
  metricGroups.set(key,[...(metricGroups.get(key)??[]),f])
 }
 for(const group of metricGroups.values()){
  const order=(f:MetricFact) => `${f.providerDate??f.occurredAt}|${f.occurredAt}`
  const latest=group.map(order).sort().at(-1)!,current=group.filter(f => order(f)===latest)
  if(new Set(current.map(f => f.value)).size!==1)continue
  const f=current.sort((a,b) => a.id.localeCompare(b.id))[0],isRmssd=rmssd(f),prefix=isRmssd?'RMSSD':'RHR',unit=isRmssd?'ms':'bpm'
  const b=analysisReference({...s,facts:s.facts.filter(x => x.kind!=='METRIC' || x.quality==='AVAILABLE')},f)
  const baseline=b.sourceRefs.map(ref => s.facts.find(x => x.id===ref.id && x.revision===ref.revision) as MetricFact).sort((a,b) => a.id.localeCompare(b.id))
  const label=`${f.providerDate??calendarDay(f.occurredAt,s.context.timeZone)} ${f.id}@${f.revision} ${prefix}（${f.provider}；同账号/设备/协议）`
  const measured=[input(f,'value',f.value!,unit)],baselineInputs=baseline.map(row => input(row,'value',row.value!,unit)),allInputs=[...measured,...baselineInputs],sources=[f,...baseline]
  const metric=(name:string,value:number,valueUnit:string,formula:string,description:string,refs:AnalysisFact[],inputs:DerivedFact['inputs']) => add(name,value,valueUnit,formula,`${label}：${description} ${value} ${valueUnit}。`,refs,null,inputs)
  metric(`${prefix}_CURRENT_${isRmssd?'MS':'BPM'}`,f.value!,unit,'current.value','当前值',[f],measured)
  metric(`${prefix}_BASELINE_SAMPLES`,b.sampleCount,'days','count(distinct valid same-scope baseline providerDate in preceding 30 calendar days)',`此前同来源基线样本数（${b.sampleCount} 日）`,sources,baselineInputs)
  if(b.median===null)continue
  metric(isRmssd?'RMSSD_BASELINE_MEDIAN_MS':'RHR_BASELINE_BPM',b.median,unit,'median(one unambiguous final same-scope value per baseline providerDate)',`此前同来源 ${b.sampleCount} 日基线中位数`,sources,baselineInputs)
  if(isRmssd && b.median>0){
   metric('RMSSD_CHANGE_PERCENT',(f.value!-b.median)/b.median*100,'%','(current.value - baseline.median) / baseline.median * 100','相对基线变化率',sources,allInputs)
   if(f.value!>0)metric('RMSSD_LOG_RATIO',Math.log(f.value!/b.median),'ln-ratio','ln(current.RMSSD / baseline.median.RMSSD)','自然对数比值变化',sources,allInputs)
  }else if(!isRmssd)metric('RHR_CHANGE_BPM',f.value!-b.median,'bpm','current.RHR - baseline.median.RHR','较基线绝对变化',sources,allInputs)
 }

 const competition=options.competitionDate,competitionIndex=competition?dayIndex(competition):null
 if(competition && competitionIndex!==null){
  const asOfDay=calendarDay(s.context.asOf,s.context.timeZone),asOfIndex=dayIndex(asOfDay)!
  const contextSources:DerivedFact['contextSources']=[{kind:'ANALYSIS_AS_OF',value:s.context.asOf,athleteId:s.context.athleteId,asOf:s.context.asOf,version:s.context.analysisVersion},{kind:'COMPETITION_DATE',value:competition,athleteId:s.context.athleteId,asOf:s.context.asOf,version:s.context.planVersion??null}]
  add('DAYS_TO_COMPETITION_FROM_ASOF',competitionIndex-asOfIndex,'days',`calendarDate(${competition}) - calendarDate(context.asOf=${asOfDay}, timezone=${s.context.timeZone})`,`比赛 ${competition} 距分析日 ${asOfDay}（${s.context.timeZone}） ${competitionIndex-asOfIndex} 个日历日。`,[],null,[],'',contextSources)
  for(const t of training){
   const day=calendarDay(t.startedAt,s.context.timeZone),index=dayIndex(day)!,days=competitionIndex-index
   add('DAYS_TO_COMPETITION_FROM_TRAINING',days,'days',`calendarDate(${competition}) - calendarDate(training.startedAt=${day}, timezone=${s.context.timeZone})`,`${trainingLabel(t)}：比赛 ${competition} 距训练日 ${days} 个日历日。`,[t],t.occurrenceId,[input(t,'startedAt.calendarDayIndex',index,'calendar-day-index')],'',contextSources)
  }
 }
 return result
}
