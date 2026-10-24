import type { EvidenceSnapshot, RecoveryAssessment, MetricFact } from '../../health/analysis-contract'
import type { ModelInput, ModelProfile, PlannedModelSession, ThresholdRecord, PerformanceRecord } from './types'
import { buildTrainingCandidates } from './candidates'
import type { selectTrainingModels } from './selection'
const emptyProfile:ModelProfile={eventMeters:null,phase:'UNKNOWN',raceDate:null,experience:'UNKNOWN',doubleThresholdExperience:null,lactateMonitoring:null,coachSupervision:null,twoSessionsAvailable:null,sourceRefs:[]}
/** A thin adapter: only explicitly named test metrics become thresholds.
 * Report id + protocol + timestamp must match. Generic HR/CS/OBLA never fills LT.
 * Context/options belong to the local host, never a model-produced facts object.
 */
export function adaptTrainingModelInput(snapshot:EvidenceSnapshot,recovery:RecoveryAssessment|null,options:Partial<Pick<ModelInput,'profile'|'sessions'|'thresholds'|'performances'|'zoneSegments'|'window'>>={}):ModelInput{
 const thresholds:ThresholdRecord[]=snapshot.facts.flatMap(f=>{
  if(f.kind!=='METRIC'||f.statistic!=='SAMPLE'||!f.protocolKey||!/^LAB:/.test(f.protocolKey))return []
  const marker=({LT1_SPEED:'LT1',LT2_SPEED:'LT2',VT1_SPEED:'VT1',VT2_SPEED:'VT2',LT1_HR:'LT1',LT2_HR:'LT2',VT1_HR:'VT1',VT2_HR:'VT2'} as const)[f.metric as 'LT1_SPEED']
  if(!marker||!(f.unit==='m/s'||f.unit==='bpm')||/_SPEED$/.test(f.metric)&&f.unit!=='m/s'||/_HR$/.test(f.metric)&&f.unit!=='bpm')return []
  return [{...f,marker,unit:f.unit,testId:f.sourceRecordId,method:f.protocolKey,modality:'RUNNING' as const,validUntil:null}]
 })
 const performances:PerformanceRecord[]=snapshot.facts.flatMap(f=>{
  if(f.kind!=='TRAINING'||f.modality!=='RUN'||!['RACE_MAXIMAL','TIME_TRIAL_MAXIMAL'].includes(f.observedType??'')||!f.observedTypeBasis.length||!f.protocolKey||f.runSegments.length!==1)return []
  const segment=f.runSegments[0]
  if(segment.completion!=='COMPLETED'||!segment.distanceM||!segment.durationSeconds||segment.restAfterSeconds!==null&&segment.restAfterSeconds!==0)return []
  return [{...f,distanceM:segment.distanceM,seconds:segment.durationSeconds,effort:f.observedType==='RACE_MAXIMAL'?'RACE' as const:'TIME_TRIAL' as const,maximal:true,testId:f.protocolKey}]
 })
 return {context:{...snapshot.context},snapshot,thresholds:options.thresholds??thresholds,performances:options.performances??performances,zoneSegments:options.zoneSegments??[],
 window:options.window??{startAt:new Date(Date.parse(snapshot.context.asOf)-7*86400000).toISOString(),endAt:snapshot.context.asOf,complete:false,totalRunSeconds:null,basis:'TIME_IN_ZONE'},
 profile:options.profile??structuredClone(emptyProfile),recovery,sessions:options.sessions??[]}
}
export function readTrainingModelReview(snapshot:EvidenceSnapshot,recovery:RecoveryAssessment|null,options:Parameters<typeof adaptTrainingModelInput>[2]={}){
 const input=adaptTrainingModelInput(snapshot,recovery,options)
 return buildTrainingCandidates(input)
}
const words={PYRAMIDAL:'金字塔',POLARIZED:'极化',DOUBLE_THRESHOLD:'双阈值',EVENT_SPECIFIC:'专项'} as const
const statuses={CONSIDER:'可讨论',CONDITIONAL:'有条件',NOT_APPLICABLE:'不适用',INSUFFICIENT:'缺资料',HOLD:'暂停复核'} as const
export function trainingModelSummary(r:ReturnType<typeof selectTrainingModels>):string{
 const threshold=r.physiology.thresholds.speed??r.physiology.thresholds.heartRate
 const state=threshold?`${threshold.markers.join('/')}实测 ${threshold.values.map(v=>Number(v.toFixed(2))).join('/')} ${threshold.unit}`:'个体LT1/LT2缺少同测试实测依据'
 const cs=r.physiology.cs.status==='AVAILABLE'?`；CS估计 ${r.physiology.cs.value!.toFixed(2)} m/s（不是LT2）`:'；CS缺可用最大努力测试组'
 return [state+cs,r.methods.map(m=>`${words[m.method]}：${statuses[m.status]}`).join('；'),...r.notes.slice(0,1),'候选与确认导出均未写入正式日程；工程规则尚未经长期个体效果验证。'].join('。')
}
