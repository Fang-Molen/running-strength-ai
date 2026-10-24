/** Read-only descriptive projections; no approval, persistence, plan or network port. */
import type {EvidenceSnapshot,MetricFact,TrainingFact} from '../../health/analysis-contract'
import {projectAnalysisEvidence,sourceScope,refOf,stableJson,analysisDigest} from '../../health/analysis-evidence'
import {retrieveR4,summarizeR4Nutrition,type R4Task} from './reference'
export type R4ReviewOptions={tasks?:R4Task[];population?:'healthy_adult'|'unknown'|'special';foods?:Record<string,number|null>[]}
const dayAt=(instant:string,timeZone:string)=>{
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(instant))
 return ['year','month','day'].map(k=>parts.find(p=>p.type===k)!.value).join('-')
}
/** A tentative hint only. The host may explicitly correct tasks; the question survives. */
export function suggestR4Tasks(question:string):R4Task[]{
 const only=question.match(/(?:只问|只谈|仅讨论)(饮食|营养|跑步|力量|热身)/)?.[1]
 const names:Record<string,R4Task>={饮食:'nutrition',营养:'nutrition',跑步:'running',力量:'strength',热身:'warmup'}
 if(only)return [names[only]]
 const q=question.replace(/(?:不谈|不问|不要谈|不用讨论)[^，。；,;]*/g,'')
 const patterns:[R4Task,RegExp][]=[['nutrition',/饮食|营养|摄入|蛋白|碳水|热量|食物|吃/],['fatigue',/疲劳|睡眠|恢复|HRV|RMSSD|静息心率/i],['baseline',/基线|常态|换表|设备切换/],['capability',/能力|成绩|经验|水平/],['running',/跑步|配速|分段|间歇|起跑/],['strength',/力量|增肌|爆发力|组休|RIR/i],['warmup',/热身/],['planning',/漏练|安排|改期|计划|课表|对调|调换|换课/],['load',/负荷|ACWR/i]]
 const tasks=patterns.filter(([,p])=>p.test(q)).map(([task])=>task)
 return tasks.length?tasks:['communication']
}
export function buildR4Review(snapshot:EvidenceSnapshot,question:string,options:R4ReviewOptions={}){
 const s=projectAnalysisEvidence({context:snapshot.context,facts:snapshot.facts,safetyConstraints:snapshot.safetyConstraints,priorHypotheses:snapshot.priorHypotheses})
 const hypothetical=/朋友|队友|他人|假设|举例|案例/.test(question)
 const facts=hypothetical?[]:s.facts,today=dayAt(s.context.asOf,s.context.timeZone),groups=new Map<string,MetricFact[]>()
 for(const f of facts){
  if(f.kind!=='METRIC'||f.statistic==='PROVIDER_ASSESSMENT'||dayAt(f.occurredAt,s.context.timeZone)>=today)continue
  const key=stableJson([sourceScope(f),f.metric,f.unit,f.statistic,s.context.timeZone])
  groups.set(key,[...(groups.get(key)??[]),f])
 }
 const baselines=[...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([key,rows])=>{
  const byDay=new Map<string,MetricFact[]>()
  for(const f of rows){const d=dayAt(f.occurredAt,s.context.timeZone);byDay.set(d,[...(byDay.get(d)??[]),f])}
  const values:number[]=[],days:string[]=[];let conflictingDays=0,missingDays=0
  for(const [day,entries] of [...byDay].sort(([a],[b])=>a.localeCompare(b))){
   const known=[...new Set(entries.map(f=>f.value).filter((v):v is number=>typeof v==='number'&&Number.isFinite(v)))]
   if(known.length>1){conflictingDays++;continue}
   if(!known.length){missingDays++;continue}
   values.push(known[0]);days.push(day)
  }
  return {key,metric:rows[0].metric,unit:rows[0].unit,provider:rows[0].provider,device:rows[0].deviceId,protocol:rows[0].protocolKey,sampleDays:values.length,days,values,
   mean:values.length?values.reduce((a,b)=>a+b,0)/values.length:null,min:values.length?Math.min(...values):null,max:values.length?Math.max(...values):null,
   conflictingDays,missingDays,evidenceRefs:rows.map(refOf),provisional:true as const,status:'DESCRIPTIVE_ONLY' as const,
   limitation:'样本量与协议稳定性需复核；不生成正常阈值、疲劳诊断或训练许可。'}
 })
 const training=facts.filter((f):f is TrainingFact=>f.kind==='TRAINING'),runs=training.filter(f=>f.modality==='RUN'),strength=training.filter(f=>f.modality==='STRENGTH')
 const capability={running:{status:runs.length?'OBSERVED' as const:'UNKNOWN' as const,records:runs.map(f=>({ref:refOf(f),occurredAt:f.occurredAt,protocol:f.protocolKey,purpose:f.plannedPurpose,segments:structuredClone(f.runSegments)}))},
  strength:{status:strength.length?'OBSERVED' as const:'UNKNOWN' as const,records:strength.map(f=>({ref:refOf(f),occurredAt:f.occurredAt,protocol:f.protocolKey,sets:structuredClone(f.strengthSets)}))},movementSkill:'UNKNOWN' as const,tolerance:'NOT_ESTABLISHED' as const,overallScore:null}
 const foods=hypothetical?[]:options.foods??[],nutrition=summarizeR4Nutrition(foods),tasks=options.tasks??suggestR4Tasks(question),fields:Record<string,unknown>={}
 if(training.length){fields.trainingHistory=training.map(f=>({ref:refOf(f),at:f.occurredAt}));fields.recentTraining=fields.trainingHistory}
 const responses=facts.filter(f=>f.kind==='RESPONSE');if(responses.length)fields.symptoms=responses.map(f=>({ref:refOf(f),measure:f.measure,value:f.value}))
 if(foods.length)fields.foodEntries=foods
 if(facts.length)fields.verifiedFacts=facts.map(refOf)
 const selection=retrieveR4({question,tasks,population:hypothetical?'unknown':options.population??'unknown',fields})
 const inputRevision=analysisDigest([s.inputDigest,selection.version,selection.question,selection.tasks,selection.population,foods])
 return {selection,taskResolution:{origin:options.tasks?'EXPLICIT_HOST':'TENTATIVE_LOCAL_HINT',question,reason:options.tasks?'任务由宿主明确指定':'保留原问题；此任务提示可纠正，不决定事实或权限。'},baselines,capability,nutrition,inputRevision,excluded:s.excluded,conflicts:s.conflicts,personalFactsUsed:!hypothetical,autoExecute:false as const}
}
