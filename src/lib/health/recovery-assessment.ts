import type { EvidenceSnapshot, RecoveryAssessment, MetricFact, ResponseFact, MuscleExposureReview, TrainingFact } from './analysis-contract'
import { refOf, analysisReference } from './analysis-evidence'
import { trainingDose, buildMuscleExposure } from './muscle-exposure'
import { REGION_LABEL } from './muscle-recovery-u11'

/** Evidence changes explanations; no physiological threshold authorizes a prescription. */
export function evaluateRecoveryEvidence(s:EvidenceSnapshot,exposure:MuscleExposureReview=buildMuscleExposure(s)):RecoveryAssessment {
 const observations:RecoveryAssessment['observations']=[],hypotheses:RecoveryAssessment['hypotheses']=[],missing=[...s.gaps]
 const training=s.facts.filter((f):f is TrainingFact=>f.kind==='TRAINING'&&Date.parse(f.startedAt)>=Date.parse(s.context.asOf)-72*36e5),metrics=s.facts.filter((f):f is MetricFact=>f.kind==='METRIC'&&f.value!==null)
 const responseRows=s.facts.filter((f):f is ResponseFact=>f.kind==='RESPONSE')
 const latest=new Map<string,ResponseFact[]>()
 for(const f of responseRows){
  const k=JSON.stringify([f.provider,f.accountRef,f.deviceId,f.protocolKey,f.observationProtocol,f.measure,f.region,f.side]),old=latest.get(k)
  const time=Date.parse(f.occurredAt),previous=old?Date.parse(old[0].occurredAt):-Infinity
  if(time>previous)latest.set(k,[f]);else if(time===previous)old!.push(f)
 }
 const responses=[...latest.values()].flat().filter(f=>f.measure==='PAIN'||Date.parse(f.occurredAt)>=Date.parse(s.context.asOf)-72*36e5)
 const responseConflict=[...latest.values()].some(rows=>new Set(rows.map(r=>JSON.stringify([r.value,r.scale]))).size>1)
 if(responseConflict)missing.push('同来源同刻反馈矛盾，保留各条；不得选择无痛值解除限制')
 for(const f of training){
  observations.push({text:`原计划目的：${f.plannedPurpose??'UNKNOWN（待确认）'}；实际类型：${f.observedType??'UNKNOWN'}。计划意图不证明目标已经实现。`,evidenceRefs:[refOf(f)]})
  const d=trainingDose(f)
  observations.push({text:f.modality==='RUN'?`已确认跑步 ${d.distanceM??'未知'} m，纯跑用时 ${d.workSeconds??'未知'} s；${d.segments.map(r=>`第${r.roundIndex??'?'}轮 ${r.distanceM??'未知'} m/${r.durationSeconds??'未知'} s，组休 ${r.restAfterSeconds??'未知'} s`).join('；')}；轮次与间歇按原记录保留，不冒充整课用时。`:f.modality==='JUMP'?`已确认跳跃接触 ${f.jumpContacts??'未知'} 次；未测着地力，不推断组织负荷。`:`已确认力量 ${d.sets} 组，${d.reps??'未知'} 次；${d.setDetails.join('；')}；只描述实际剂量，不代表组织受力或恢复。`,evidenceRefs:[refOf(f)]})
  if(f.sessionRpe!==null)observations.push({text:`整课 RPE ${f.sessionRpe}（${f.sessionRpeScale??'口径待核'}）；混合课不把同一个整课RPE当作两份负荷。`,evidenceRefs:[refOf(f)]})
 }
 const currentMetrics=metrics.filter(f=>!metrics.some(o=>o.metric===f.metric&&o.provider===f.provider&&o.accountRef===f.accountRef&&o.deviceId===f.deviceId&&o.protocolKey===f.protocolKey&&(o.providerDate??o.occurredAt)>(f.providerDate??f.occurredAt)))
 for(const f of [...currentMetrics,...responses]){
  if(f.kind==='METRIC'){
   if(f.value===null){missing.push(`${f.metric}未知（${f.quality}）`);continue}
   const b=analysisReference(s,f)
   observations.push({text:`${f.providerDate??f.occurredAt} ${f.metric} ${f.value} ${f.unit}（${f.provider} / ${f.protocolKey??'协议未知'}）${f.temporalResolution==='DAY'?'；日级记录，测量时刻未知':''}${b.deltaPercent!==null?`；较此前同协议 ${b.sampleCount} 日中位数 ${b.median} ${f.unit} 变化 ${Number(b.deltaPercent.toFixed(2))}%`:''}；不是医学许可。`,evidenceRefs:[refOf(f)]})
  }else if(f.kind==='RESPONSE')observations.push({text:`${f.region?REGION_LABEL[f.region]+' ':''}${f.measure} ${f.value??'未知'}（${f.scale}），${f.occurredAt} 自报；不能等同组织恢复。`,evidenceRefs:[refOf(f)]})
 }
 const overlap=(exposure.ledger??[]).filter(r=>r.overlapObserved)
 for(const r of overlap)observations.push({text:`${REGION_LABEL[r.region]}近期跑步＋力量重复暴露；${r.entries.map(e=>e.dose).join('；')}。缺少个人校准，不输出肌肉恢复百分比。`,evidenceRefs:r.supportingFacts})
 // An absence report only weakens an explanation; it never overrides an active pain restriction.
 const pain=responses.some(f=>f.measure==='PAIN'&&f.value!==null&&f.value>0)
 const noPain=responses.filter(f=>f.measure==='PAIN'&&f.value===0)
 const normalFunction=responses.filter(f=>f.measure==='FUNCTION'&&f.scale==='FUNCTION_LIMITATION_0_1'&&f.value===0)
 const limitedFunction=responses.filter(f=>f.measure==='FUNCTION'&&f.scale==='FUNCTION_LIMITATION_0_1'&&f.value===1)
 const reaction=responses.filter(f=>['SORENESS','SUBJECTIVE_FATIGUE','RECOVERY_FEELING','FUNCTION'].includes(f.measure)&&f.value!==null)
 const hold=pain||responseConflict||s.safetyConstraints.length>0,escalate=s.safetyConstraints.some(c=>c.scope==='EMERGENCY'||c.scope==='URGENT_MEDICAL')
 if(training.length&&reaction.length)hypotheses.push({id:'training-response',claim:overlap.length?`${overlap.map(r=>REGION_LABEL[r.region]).join('、')}的跑步与力量刺激重叠可能参与当前反应；尚不能确认因果或损伤`:'近期实际训练可能参与当前反应；尚不能确认因果或损伤',supportingRefs:[...training,...reaction].map(refOf),weakeningRefs:[...noPain,...normalFunction].map(refOf),discriminator:'下一次已有批准且不诱发症状的同协议课程，先记录原热身的功能、分段/逐组完成情况与休息；再记录24/48/72小时酸痛、疼痛和主观恢复。若相近实际剂量下表现稳定、反应不再出现，会削弱此解释；不新增试探剂量。',certainty:'POSSIBLE'})
 const sleep=currentMetrics.filter(f=>/SLEEP|sleep/.test(f.metric)),contextMetrics=currentMetrics.filter(f=>!f.metric.includes('饮食'))
 if(contextMetrics.length)hypotheses.push({id:'measurement-context',claim:sleep.length?'睡眠与测量背景可能参与当前状态；单一睡眠或HRV读数不足以判断恢复不良':'测量条件或生活背景可能影响当前指标；尚不能确认恢复能力变化',supportingRefs:contextMetrics.map(refOf),weakeningRefs:normalFunction.map(refOf),discriminator:'核对睡眠完整性、生活压力和同设备同协议个人基线。若热身功能正常、可比训练表现稳定，会削弱“当前训练能力下降”的判断；若生活条件未变但表现持续下降，应重新检查训练解释。',certainty:'UNRESOLVED'})
 if(hypotheses.length===1&&training.length&&reaction.length)hypotheses.push({id:'execution-context',claim:'实际执行节奏或休息安排差异也可能参与反应，不能直接诊断能力短板',supportingRefs:training.map(refOf),weakeningRefs:normalFunction.map(refOf),discriminator:'对照原批准课的组间及轮间休息、分段速度和逐组RPE；若这些条件相同但反应仍改变，则削弱执行差异解释。',certainty:'UNRESOLVED'})
 if(!responses.some(f=>f.measure==='PAIN'))missing.push('当前是否疼痛、在哪里、是否影响动作？')
 if(!responses.some(f=>f.measure==='FUNCTION'))missing.push('缺少原热身或日常功能表现')
 if(!sleep.length)missing.push('睡眠未记录，不妨碍已确认训练的分析')
 if(!metrics.some(f=>/HRV/i.test(f.metric)))missing.push('HRV未记录，不补零')
 if(!training.length)missing.push('近期实际训练明细未确认')
 if(!s.context.planVersion)missing.push('下一课目的、日期与计划版本待核对')
 const action:NonNullable<RecoveryAssessment['candidates'][number]['action']>=hold?'SKIP':overlap.length&&limitedFunction.length?'REDUCE':overlap.length&&reaction.some(f=>f.measure==='SORENESS'&&f.value!>0)?'MODIFY':'KEEP'
 const kind=hold?'DEFER_AND_REVIEW':action!=='KEEP'?'ADJUST_PENDING_CONFIRMATION':s.conflicts.length||missing.length?'REQUEST_MINIMUM_DATA':'KEEP_EXISTING'
 const conditions=hold?['暂不执行诱发疼痛的内容；走原安全路径核对症状和专业许可，不自动写入停训课表']:['先确认原课程目的及当前热身表现','不新增测试剂量；不凭单一HRV、厂商分数或酸痛消失放行','只比较一个变量：如已有批准的减组方案则只减组，其余保持；没有方案时只记录观察，不编造剂量','任何变更须本人确认、宿主核对最新事实及计划版本；已完成课不改写']
 return {snapshotId:s.snapshotId,dataQuality:s.conflicts.length?'CONFLICT':!s.facts.length?'MISSING':missing.length?'PARTIAL':'AVAILABLE',signalState:!s.facts.length?'INSUFFICIENT':pain||limitedFunction.length?'RECOVERY_CONCERN':reaction.length&&normalFunction.length?'MIXED_SIGNALS':'INSUFFICIENT',safetyState:escalate?'ESCALATION_REQUIRED':hold?'HOLD_ACTIVE':noPain.length?'NO_KNOWN_HOLD':'UNKNOWN',confidence:hold?'HOLD':s.conflicts.length?'UNKNOWN':'LOW',observations,hypotheses:hypotheses.slice(0,2),candidates:[{id:`${s.inputDigest}:${kind}:${action}`,kind,action,changedVariable:action==='REDUCE'?'SETS':action==='MODIFY'?'EXECUTION_REVIEW':'NONE',basisRefs:[...new Map(observations.flatMap(o=>o.evidenceRefs).map(r=>[r.id+'@'+r.revision,r])).values()],reason:hold?'疼痛/现有安全限制优先':overlap.length?'有实际跑步＋力量参与重叠，先用功能和后续反馈区分解释':'现有证据不支持自动改变训练量',observation:'记录原热身功能、原组休下完成量与RPE，再记录24/48/72h反馈',supportsWhen:'相同协议和实际剂量下重复出现相同反应',weakensWhen:'更正后暴露消失，或同协议表现和反馈稳定',doNotExecute:['医学限制未解除','来源、身份或实际剂量有冲突','缺少已批准课程或明确变更剂量'],executionState:'OBSERVATION_ONLY',conditions,planVersion:s.context.planVersion,requiresConfirmation:true}],missingDecisionInputs:[...new Set(missing)],medicalClearance:false,automaticPrescription:false}
}
