import { useMemo, useState } from 'react'
import type { RecoveryProjection } from '@/lib/health/recovery-host-u11'
import { readRecoveryProjection } from '@/lib/health/recovery-host-u11'
import { REGION_LABEL, REGIONS, type Region } from '@/lib/health/muscle-recovery-u11'
import { readPersonalResponses, savePersonalResponse } from '@/lib/health/personal-response-store'
import { reviewPersonalResponse } from '@/lib/health/personal-response'
import type { ResponseFact, Side, TrainingFact } from '@/lib/health/analysis-contract'
import { localDay } from '@/lib/health/observation'

/** Existing muscle-page disclosure; explicit save action, no automatic training mutation. */
export function PersonalResponsePanel({value}:{value:RecoveryProjection}){
 const [region,setRegion]=useState<Region>('quads'),[side,setSide]=useState<Side>('UNSPECIFIED'),[trainingId,setTrainingId]=useState(''),[score,setScore]=useState(''),[at,setAt]=useState(''),[notes,setNotes]=useState(''),[message,setMessage]=useState(''),[revision,setRevision]=useState(0)
 const history=useMemo(()=>{void revision;try{return readRecoveryProjection(localDay(),new Date().toISOString(),24*365).analysis}catch{return value.analysis}},[value.revision,revision])
 const sessions=history.facts.filter((f):f is TrainingFact=>f.kind==='TRAINING'),selected=sessions.find(t=>t.id===trainingId)
 const review=useMemo(()=>reviewPersonalResponse({context:history.context,protocolKey:selected?.protocolKey??'UNCONFIRMED',region,side,training:sessions,responses:readPersonalResponses(history.context.asOf),registeredEndpoint:'SELF_REPORTED_SORENESS_ZERO_V1',settingsVersion:'DESCRIPTIVE_1'}),[history,region,side,trainingId])
 const save=()=>{
  if(!selected||!at||score.trim()===''||!Number.isFinite(Number(score))||Number(score)<0||Number(score)>10){setMessage('请选择实际训练、观测时刻和0–10酸痛自评分；缺失不会填零。');return}
  if(!Number.isFinite(Date.parse(at))){setMessage('观测时刻无法识别，请重新选择。');return}
  const occurredAt=new Date(at).toISOString(),now=new Date().toISOString()
  if(Date.parse(occurredAt)<Date.parse(selected.endedAt??selected.startedAt)||Date.parse(occurredAt)>Date.parse(now)){setMessage('反馈时刻须在该次训练之后，且不能是未来。');return}
  const f:ResponseFact={id:'response:'+crypto.randomUUID(),revision:0,athleteId:history.context.athleteId,provider:'MANUAL',accountRef:null,deviceId:null,protocolKey:selected.protocolKey,sourceRecordId:'manual-response',occurredAt,knownAt:now,receivedAt:now,sourceTimeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,status:'CONFIRMED',quality:'AVAILABLE',ownershipReceiptId:null,kind:'RESPONSE',relatedTrainingRefs:[{id:selected.id,revision:selected.revision}],region,side,measure:'SORENESS',value:Number(score),scale:'0-10_HIGH_WORSE',observationProtocol:'SELF_REPORTED_SORENESS_ZERO_V1',elapsedHours:(Date.parse(occurredAt)-Date.parse(selected.endedAt??selected.startedAt))/3600000,functionTaskId:null,notes:notes.trim()||null}
  f.sourceRecordId=f.id
  const result=savePersonalResponse(f);setMessage(result.ok?'已保存自报反馈；这不表示医学恢复。':'保存失败：'+result.error);if(result.ok)setRevision(n=>n+1)
 }
 return <details className="fk-h89-disclosure" data-testid="personal-response"><summary>训练后反馈与个人对照</summary>
  <p className="keep text-sm">未校准：记录24/48/72小时及更晚的真实感受。酸痛与功能、组织恢复分别判断，不新增训练剂量。</p>
  <div className="grid gap-2 text-sm">
   <label>关联的实际训练<select className="w-full" value={trainingId} onChange={e=>setTrainingId(e.target.value)}><option value="">请选择</option>{sessions.map(t=><option key={t.id} value={t.id}>{t.startedAt} · {t.modality} · {t.occurrenceId}</option>)}</select></label>
   <label>部位<select value={region} onChange={e=>setRegion(e.target.value as Region)}>{REGIONS.map(r=><option key={r} value={r}>{REGION_LABEL[r]}</option>)}</select></label>
   <label>侧别<select value={side} onChange={e=>setSide(e.target.value as Side)}>{(['UNSPECIFIED','LEFT','RIGHT','BILATERAL'] as const).map((s,i)=><option key={s} value={s}>{['待确认','左侧','右侧','双侧'][i]}</option>)}</select></label>
   <label>实际观测时刻<input type="datetime-local" value={at} onChange={e=>setAt(e.target.value)} /></label>
   <label>自报酸痛（0无酸痛，10最强）<input type="number" min="0" max="10" step="0.1" value={score} onChange={e=>setScore(e.target.value)} /></label>
   <label>日常功能、睡眠、疾病或中间训练等背景<input value={notes} maxLength={300} onChange={e=>setNotes(e.target.value)} /></label>
   <button type="button" className="fk-h89-pill" onClick={save}>保存这次反馈</button>
  </div>
  <p role="status">{message}</p><p className="keep text-xs">状态 {review.status} · 独立训练 {review.independentSessionCount} 次 · 反馈 {review.observationCount} 条；没有完整可比协议时只保留观测，不预测恢复时间。</p>
  {review.timeline.map(t=><p key={t.trainingRef.id} className="keep text-xs">{t.trainingRef.id}（{t.timeOrigin==='TRAINING_END'?'从结束时刻计算':'结束未知，从开始时刻描述'}）：{t.observations.map(o=>`${Number(o.hours.toFixed(1))}小时 ${o.measure} ${o.value??'未知'}`).join('；')||'暂无随访'}{t.endpointInterval?`；自报酸痛首次为0在（${t.endpointInterval[0]}, ${t.endpointInterval[1]}]小时`:t.rightCensoredAt!==null?`；截至${t.rightCensoredAt}小时仍未观察到终点`:''}{t.reason.length?'；'+t.reason.join('、'):''}</p>)}
 </details>
}
