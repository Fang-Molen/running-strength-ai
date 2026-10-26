import { currentAthleteId } from '../../core/events'
import { readAnalysis } from '../../health/analysis-host'
import { loadSchedule, readScheduleDocument } from '../../ui/day-schedule'
import { scheduleExecutionId } from '../../ui/scheduled-execution'
import { readCoachPlanHostSnapshot } from '../plan-execution/host'
import { analysisDigest } from '../../health/analysis-evidence'
import { adaptScientificTrainingInput, type ScientificIntent } from './scientific-input'
import { readScientificInputSources } from './scientific-input-host'
import { buildTrainingCandidates } from './candidates'
import type { PlannedModelSession } from './types'

export type WorkbenchOptions = ScientificIntent
/** User intent and familiarity are self-reports, never measured physiology or clearance. */
export async function readTrainingModelWorkbench(options:WorkbenchOptions={},day:string,asOf=new Date().toISOString()){
 const athleteId=currentAthleteId(),analysis=readAnalysis(day,asOf),read=readScheduleDocument()
 if(!read.ok)throw Error('SCHEDULE_READ_FAILED')
 const entries=loadSchedule().entries,source=JSON.stringify(entries),scientificSources=readScientificInputSources(day,asOf,entries),host=await readCoachPlanHostSnapshot(asOf)
 if(currentAthleteId()!==athleteId||analysis.snapshot.context.athleteId!==athleteId||host.host.actor?.athleteId!==athleteId||host.host.readState!=='AVAILABLE'||JSON.stringify(loadSchedule().entries)!==source)throw Error('SUBJECT_OR_SOURCE_CHANGED')
 if(readScientificInputSources(day,asOf,entries).version!==scientificSources.version||readAnalysis(day,asOf).revision!==analysis.revision)throw Error('SUBJECT_OR_SOURCE_CHANGED')
 const missing:string[]=[],sessions:PlannedModelSession[]=[],courses:{id:string;title:string;date:string;state:PlannedModelSession['executionState'];reason:string|null}[]=[]
 for(const entry of entries){
  if(entry.athleteId&&entry.athleteId!==athleteId)continue
  const components=entry.runComponents??[],targets=components.map(c=>host.host.targets.filter(t=>t.scheduleId===entry.id&&t.componentId===c.componentId))
  const owned=entry.athleteId===athleteId&&entries.filter(e=>e.id===entry.id).length===1
  let state:PlannedModelSession['executionState']='UNKNOWN'
  if(owned&&entry.status==='planned'&&!entry.actual&&components.length&&targets.every(rows=>rows.length===1&&rows[0].identityResolved)){
   const states=targets.map(rows=>rows[0].state)
   state=states.every(s=>s==='NOT_STARTED')?'NOT_STARTED':states.some(s=>s==='COMPLETED')?'COMPLETED':states.some(s=>s==='STARTED')?'STARTED':'UNKNOWN'
  }
  const reason=!components.length?'未保存结构，不能从课程文字推造。':state==='UNKNOWN'?'归属、开始状态或实际记录待核对。':state!=='NOT_STARTED'?'该课程已经开始或完成。':null
  courses.push({id:entry.id,title:entry.title,date:entry.date,state,reason})
  if(!components.length){missing.push(entry.title+'：缺明确保存的课程结构。');continue}
  const run=components.filter(c=>c.modality==='RUNNING')
  // Unspecified intervals do not prove a VO2 or threshold purpose.
  const purpose:PlannedModelSession['purpose']|null=run.some(c=>c.purpose==='TEMPO_THRESHOLD')?'THRESHOLD':run.some(c=>c.purpose==='REPETITION_SPEED')?'SPEED':run.some(c=>c.purpose==='RACE')?'RACE_PACE':run.length&&run.every(c=>['EASY_AEROBIC','LONG','WARMUP','COOLDOWN'].includes(c.purpose))?'EASY':components.every(c=>c.modality==='STRENGTH')?'STRENGTH':null
  if(!purpose){missing.push(entry.title+'：训练目的尚未明确，保留结构，不猜生理刺激类型。');continue}
  const sourceVersion=targets.flat().map(t=>t.sourceVersion).sort().join(':')
  const shape=(e:typeof entry)=>analysisDigest(e.runComponents?.map(({componentId:_id,...saved})=>saved))
  const familiarActual=components.every(c=>c.modality==='RUNNING')?entries.find(e=>e.athleteId===athleteId&&e.id!==entry.id&&e.date<entry.date&&e.status==='done'&&e.actual?.outcome==='as_planned'&&e.actual.executionState!=='PARTIAL'&&e.actual.executionState!=='INTERRUPTED'&&Date.parse(e.actual.at)<=Date.parse(asOf)&&e.runComponents?.length&&shape(e)===shape(entry)):undefined
  const explicitFamiliar=options.familiarSessionIds?.includes(entry.id)===true
  sessions.push({id:entry.id,date:entry.date,purpose,executionState:state,familiar:explicitFamiliar||!!familiarActual,
   sourceRefs:[{id:'schedule:'+sourceVersion,revision:0},...(explicitFamiliar?[{id:'self-report:familiar:'+entry.id,revision:1}]:familiarActual?[{id:'saved-execution:familiar:'+familiarActual.id+':'+analysisDigest(familiarActual.actual),revision:0}]:[])],
   plan:{runningPlanSchemaVersion:1,planId:scheduleExecutionId(entry.id,'run'),planSlotId:entry.id,components:structuredClone(components)}})
 }
 const input=adaptScientificTrainingInput(analysis.snapshot,analysis.assessment,scientificSources,options,day,sessions)
 const result=buildTrainingCandidates(input)
 if(!entries.length)missing.push('没有当前档案已保存的结构化课程。')
 return {input,result,courses,asOf,scientificInput:input.scientificInput,missing:[...new Set([...missing,...input.scientificInput.missing,...result.missing,...result.review.methods.flatMap(m=>m.missing)])],followups:input.scientificInput.followups}
}
export type TrainingModelWorkbench=Awaited<ReturnType<typeof readTrainingModelWorkbench>>
