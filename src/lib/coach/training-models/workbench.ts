import { currentAthleteId } from '../../core/events'
import { readAnalysis } from '../../health/analysis-host'
import { loadSchedule, readScheduleDocument } from '../../ui/day-schedule'
import { scheduleExecutionId } from '../../ui/scheduled-execution'
import { readCoachPlanHostSnapshot } from '../plan-execution/host'
import { adaptTrainingModelInput } from './host'
import { buildTrainingCandidates } from './candidates'
import type { ModelProfile, PlannedModelSession } from './types'

export type WorkbenchOptions = { eventMeters?:number|null; phase?:ModelProfile['phase']; experience?:ModelProfile['experience']; familiarSessionIds?:readonly string[] }
/** User intent and familiarity are self-reports, never measured physiology or clearance. */
export async function readTrainingModelWorkbench(options:WorkbenchOptions={},day:string,asOf=new Date().toISOString()){
 const athleteId=currentAthleteId(),analysis=readAnalysis(day,asOf),read=readScheduleDocument()
 if(!read.ok)throw Error('SCHEDULE_READ_FAILED')
 const entries=loadSchedule().entries,source=JSON.stringify(entries),host=await readCoachPlanHostSnapshot(asOf)
 if(currentAthleteId()!==athleteId||analysis.snapshot.context.athleteId!==athleteId||host.host.actor?.athleteId!==athleteId||host.host.readState!=='AVAILABLE'||JSON.stringify(loadSchedule().entries)!==source)throw Error('SUBJECT_OR_SOURCE_CHANGED')
 const missing:string[]=[],sessions:PlannedModelSession[]=[],courses:{id:string;title:string;date:string;state:PlannedModelSession['executionState'];reason:string|null}[]=[]
 for(const entry of entries){
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
  sessions.push({id:entry.id,date:entry.date,purpose,executionState:state,familiar:options.familiarSessionIds?.includes(entry.id)===true,
   sourceRefs:[{id:'schedule:'+sourceVersion,revision:0},...(options.familiarSessionIds?.includes(entry.id)?[{id:'self-report:familiar:'+entry.id,revision:1}]:[])],
   plan:{runningPlanSchemaVersion:1,planId:scheduleExecutionId(entry.id,'run'),planSlotId:entry.id,components:structuredClone(components)}})
 }
 const hasIntent=options.eventMeters!=null||options.phase&&options.phase!=='UNKNOWN'||options.experience&&options.experience!=='UNKNOWN'
 const profile:ModelProfile={eventMeters:options.eventMeters??null,phase:options.phase??'UNKNOWN',raceDate:null,experience:options.experience??'UNKNOWN',doubleThresholdExperience:null,lactateMonitoring:null,coachSupervision:null,twoSessionsAvailable:null,sourceRefs:hasIntent?[{id:'workbench:user-intent',revision:1}]:[]}
 const endAt=day+'T00:00:00.000Z'
 const input=adaptTrainingModelInput(analysis.snapshot,analysis.assessment,{profile,sessions,window:{startAt:new Date(Date.parse(endAt)-7*86400000).toISOString(),endAt,complete:false,totalRunSeconds:null,basis:'TIME_IN_ZONE'}})
 const result=buildTrainingCandidates(input)
 if(!entries.length)missing.push('没有当前档案已保存的结构化课程。')
 return {input,result,courses,asOf,missing:[...new Set([...missing,...result.missing,...result.review.methods.flatMap(m=>m.missing)])]}
}
export type TrainingModelWorkbench=Awaited<ReturnType<typeof readTrainingModelWorkbench>>
