/** Read-only descriptive history. No hypothesis/plan write and no causal or ability score. */
import type {EvidenceSnapshot,TrainingFact,ResponseFact,RecoveryAssessment} from './analysis-contract'
import {refOf,stableJson} from './analysis-evidence'
import {sampleStatistics} from '../core/coach-quantitative-math'
const stats=(f:TrainingFact)=>{const values=f.runSegments.filter(x=>x.completion==='COMPLETED'&&x.durationSeconds!==null).map(x=>x.durationSeconds!),s=sampleStatistics(values);return s?{...s,range:Math.max(...values)-Math.min(...values)}:null}
const comparable=(f:TrainingFact)=>f.protocolKey&&f.plannedPurpose&&f.runSegments.every(x=>x.distanceM!==null&&x.restAfterSeconds!==null&&x.rawResolutionSeconds!==null)?stableJson([f.provider,f.accountRef,f.deviceId,f.protocolKey,f.plannedPurpose,f.runSegments.map(x=>[x.blockId,x.roundIndex,x.stepIndex,x.distanceM,x.restAfterSeconds,x.rawResolutionSeconds,x.gradePercent,x.surface])]):null
export function describeAnalysisHistory(s:EvidenceSnapshot):RecoveryAssessment['observations']{
 const out:RecoveryAssessment['observations']=[]
 const runs=s.facts.filter((f):f is TrainingFact=>f.kind==='TRAINING'&&f.modality==='RUN').sort((a,b)=>a.startedAt.localeCompare(b.startedAt)||a.id.localeCompare(b.id)),latest=runs.at(-1)
 if(latest&&runs.length>1){
  const recent=stats(latest),key=comparable(latest)
  for(const f of runs.slice(0,-1)){
   const v=stats(f),missing=f.runSegments.filter(x=>x.completion==='NOT_RECORDED'||x.durationSeconds===null).length,skipped=f.runSegments.filter(x=>x.completion==='SKIPPED').length
   const same=key!==null&&key===comparable(f)
   out.push({text:`历史对照 ${f.startedAt.slice(0,10)}：实际用时 ${f.runSegments.map(x=>x.durationSeconds===null?'未记录':x.durationSeconds+' s').join('/')}；有效 ${v?.count??0}/${f.runSegments.length}，未完成/未记录 ${missing}，跳过 ${skipped}。${same?'所记录协议与结构一致':'可比条件未充分确认，不做改善排名'}${same&&v&&recent?`；分段极差 ${v.range}→${recent.range} s。`:''}不删除不利或缺失结果，不证明训练因果。`,evidenceRefs:[refOf(f),refOf(latest)]})
  }
 }
 for(const h of s.priorHypotheses??[]){
  const valid=[...h.supportingRefs,...h.weakeningRefs].filter(r=>s.facts.some(f=>f.id===r.id&&f.revision===r.revision))
  out.push({text:`旧假设（${h.knownAt}；原状态 ${h.status}）：${h.claim}。旧依据和反证保留；未自动改写状态或生成能力缺陷诊断。`,evidenceRefs:valid})
  const linked=s.facts.filter((f):f is ResponseFact=>f.kind==='RESPONSE'&&f.measure==='RECOVERY_FEELING'&&f.value!==null&&f.relatedTrainingRefs.some(r=>runs.some(t=>t.id===r.id&&t.revision===r.revision))).sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt))
  const first=linked[0],last=linked.at(-1)
  if(first&&last&&first.id!==last.id){
   const before=runs.find(t=>first.relatedTrainingRefs.some(r=>r.id===t.id&&r.revision===t.revision)),after=runs.find(t=>last.relatedTrainingRefs.some(r=>r.id===t.id&&r.revision===t.revision))
   if(before&&after&&comparable(before)!==null&&comparable(before)===comparable(after)){
    const times=(t:TrainingFact)=>t.runSegments.filter(x=>x.completion==='COMPLETED'&&x.durationSeconds!==null).map(x=>x.durationSeconds!),b=times(before),a=times(after)
    if(b.length===before.runSegments.length&&a.length===after.runSegments.length&&b.length>1&&a.length>1)out.push({text:`反证复核：同协议自报恢复 ${first.value}→${last.value}（${first.scale}）；后段与首段用时差 ${b.at(-1)!-b[0]}→${a.at(-1)!-a[0]} s。若恢复改善但该变化仍存在，则削弱疲劳的单一解释；保留配速、测量与其他解释，不能据相关性自动撤回旧判断。`,evidenceRefs:[refOf(before),refOf(after),refOf(first),refOf(last)]})
   }
  }
 }
 return out
}
