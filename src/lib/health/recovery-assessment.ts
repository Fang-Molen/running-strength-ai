import type { EvidenceSnapshot, RecoveryAssessment, MetricFact } from './analysis-contract'
import { refOf, analysisReference } from './analysis-evidence'
import { trainingDose } from './muscle-exposure'
export function evaluateRecoveryEvidence(s:EvidenceSnapshot):RecoveryAssessment {
 const observations:RecoveryAssessment['observations']=[],hypotheses:RecoveryAssessment['hypotheses']=[],missing=[...s.gaps]
 for(const f of s.facts){
  if(f.kind==='METRIC'){
   if(f.value===null){missing.push(`${f.metric}未知`);continue}
   const b=analysisReference(s,f);observations.push({text:`${f.providerDate??f.occurredAt} ${f.metric} ${f.value} ${f.unit}（${f.provider} / ${f.protocolKey??'协议未知'}）${b.deltaPercent!==null?`；较此前同协议 ${b.sampleCount} 日中位数 ${b.median} ${f.unit} 变化 ${Number(b.deltaPercent.toFixed(2))}%`:''}；不是医学许可。`,evidenceRefs:[refOf(f)]})
  }else if(f.kind==='RESPONSE')observations.push({text:`${f.measure} ${f.value??'未知'}（${f.scale}），${f.occurredAt} 自报；不能等同组织恢复。`,evidenceRefs:[refOf(f)]})
  else {
   const d=trainingDose(f)
   observations.push({text:f.modality==='RUN'?`已确认跑步 ${d.distanceM??'未知'} m，纯跑用时 ${d.workSeconds??'未知'} s；轮次、间歇按原分段保留，不冒充整课用时。`:`已确认力量 ${d.sets} 组，${d.reps??'未知'} 次；${d.setDetails.join('；')}；只描述实际剂量，不代表组织受力或恢复。`,evidenceRefs:[refOf(f)]})
   if(f.sessionRpe!==null)observations.push({text:`整课 RPE ${f.sessionRpe}（${f.sessionRpeScale??'口径待核'}）；不推定当前疲劳或单组 RIR。`,evidenceRefs:[refOf(f)]})
  }
 }
 const training=s.facts.filter(f=>f.kind==='TRAINING'),responses=s.facts.filter(f=>f.kind==='RESPONSE'),metrics=s.facts.filter((f):f is MetricFact=>f.kind==='METRIC'&&f.value!==null)
 const pain=responses.some(f=>f.kind==='RESPONSE'&&f.measure==='PAIN'&&f.value!==null&&f.value>0)
 const hold=pain||s.safetyConstraints.length>0,escalate=s.safetyConstraints.some(c=>c.scope==='EMERGENCY'||c.scope==='URGENT_MEDICAL')
 if(training.length&&responses.length)hypotheses.push({id:'training-response',claim:'训练暴露可能与自报反应有关，尚不能确认因果',supportingRefs:[...training,...responses].map(refOf),weakeningRefs:[],discriminator:'下一次已有批准且不诱发症状的同协议课程，保留实际剂量及24/48/72小时反馈；若可比剂量下反应不再出现，将削弱此解释。不得新增试探剂量。',certainty:'POSSIBLE'})
 if(metrics.length)hypotheses.push({id:'measurement-context',claim:'测量条件或生活背景可能影响当前指标；尚不能确认恢复能力变化',supportingRefs:metrics.map(refOf),weakeningRefs:[],discriminator:'核对同账号、设备、测量协议和发生时间；若同条件复测稳定且功能与主观反馈不一致，应修订解释。',certainty:'UNRESOLVED'})
 if(!responses.length)missing.push('当前疼痛或日常功能是否受影响？')
 if(!training.length)missing.push('近期实际训练明细未确认')
 if(!s.context.planVersion)missing.push('下一课目的、日期与计划版本待核对')
 const signalState:RecoveryAssessment['signalState']=!s.facts.length?'INSUFFICIENT':pain?'RECOVERY_CONCERN':responses.length&&metrics.length?'MIXED_SIGNALS':'INSUFFICIENT'
 const kind=hold?'DEFER_AND_REVIEW':s.conflicts.length||missing.length?'REQUEST_MINIMUM_DATA':'KEEP_EXISTING'
 return {snapshotId:s.snapshotId,dataQuality:s.conflicts.length?'CONFLICT':!s.facts.length?'MISSING':missing.length?'PARTIAL':'AVAILABLE',signalState,safetyState:escalate?'ESCALATION_REQUIRED':hold?'HOLD_ACTIVE':responses.some(f=>f.kind==='RESPONSE'&&f.measure==='PAIN'&&f.value===0)?'NO_KNOWN_HOLD':'UNKNOWN',observations,hypotheses:hypotheses.slice(0,2),candidates:[{id:`${s.inputDigest}:${kind}`,kind,basisRefs:s.facts.map(refOf),conditions:hold?['保留现有医学限制，不执行诱发症状的任务；按现有安全路径核对许可']:['先核对关键缺失资料及原计划目的','不新增测试剂量；任何改课须本人确认及宿主复核最新版本','已完成课程不得改写为未来候选'],planVersion:s.context.planVersion,requiresConfirmation:true}],missingDecisionInputs:[...new Set(missing)],medicalClearance:false,automaticPrescription:false}
}
