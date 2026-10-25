/** Public synthetic examples, executed through the same read-only assessment as the app. */
import { assessAthleteHistory, historySummary } from '../../src/lib/coach/assessment/history'
import { context, training, set } from '../../src/lib/health/analysis-fixtures'
import { projectAnalysisEvidence } from '../../src/lib/health/analysis-evidence'
import type { TrainingFact } from '../../src/lib/health/analysis-contract'
const run=(day:string,seconds:number,hr:number,rpe:number):TrainingFact=>training({id:day,canonicalActivityId:day,occurrenceId:day,componentId:'run',sourceRecordId:day,modality:'RUN',strengthSets:[],provider:'MANUAL',deviceId:'strap-A',accountRef:null,protocolKey:'same-track-1km',occurredAt:`2026-10-${day}T08:00:00Z`,knownAt:`2026-10-${day}T08:00:00Z`,receivedAt:`2026-10-${day}T08:00:00Z`,sessionRpe:rpe,sessionRpeScale:'0-10_SESSION_RPE',runSegments:[{id:'s1',blockId:'work',roundIndex:1,stepIndex:1,kind:'CONTINUOUS',distanceM:1000,durationSeconds:seconds,restAfterSeconds:0,rawResolutionSeconds:null,gradePercent:0,surface:'track',averageHeartRateBpm:hr,heartRateMethod:'CHEST_STRAP',completion:'COMPLETED'}]})
const prior=[run('15',300,150,5),run('18',300,150,5)],latest=run('22',330,156,7)
const report=(name:string,facts:TrainingFact[],hold=false)=>{
 const snapshot=projectAnalysisEvidence({context,facts,safetyConstraints:hold?[{id:'pain',version:'1',scope:'PAIN_REVIEW',evidenceRefs:[]}]:[]}),h=assessAthleteHistory(snapshot)
 return {name,synthetic:true,answer:historySummary(h),latestComparison:h.comparisons[0]??null,planning:h.planning,version:h.version,actualStrengthSets:h.actualStrengthSets}
}
const changedDevice=structuredClone(latest);changedDevice.deviceId='strap-B'
const changedRest=structuredClone(latest);changedRest.runSegments[0].restAfterSeconds=45
const noHR=structuredClone(latest);noHR.runSegments[0].averageHeartRateBpm=null
console.log(JSON.stringify([
 report('同条件：5分00秒到5分30秒，心率150到156，RPE5到7',[...prior,latest]),
 report('换设备：不计算跨设备能力变化',[...prior,changedDevice]),
 report('改间歇：不能直接认定退步',[...prior,changedRest]),
 report('缺心率：保留配速计算而不补心率',[...prior,noHR]),
 report('跑力混合：同一训练分别保留跑步和两组力量',[latest,training({id:'strength',canonicalActivityId:'22',occurrenceId:'22',componentId:'strength',strengthSets:[set(),set({id:'second',loadKg:null})]})]),
 report('疼痛限制：心率正常仍不能放行',[...prior,run('22',300,150,5)],true),
 report('撤销最新记录：旧差值不再沿用',[...prior,latest,{...latest,revision:2,status:'RETRACTED'}]),
],null,2))
