/** Raw facts only: source identity, actual dose, unknowns and historical claims. No conclusions. */
const text=(v:unknown):string=>v===null||v===undefined?'未记录':typeof v==='object'?JSON.stringify(v):String(v)
export function neutralFacts(common:any):string{
 const lines=[`账号/设备均为临时别名；null表示未记录，不推断相同设备。`,`资料截止 ${common.asOf}；时区 ${common.timeZone}。原始记录；未记录=null，不是0。`,`背景（不代替实际）：${JSON.stringify(common.coachContext)}`,...(common.priorHypotheses??[]).map((h:any)=>`历史假设（原记录）：${JSON.stringify(h)}`)]
 for(const s of common.scopes??[])lines.push(`来源组 ${s.id}：${s.provider}/${s.protocol??'协议未知'}，账号${text(s.account)}，设备${text(s.device)}。同组未知设备不证明同一设备。`)
 for(const f of common.facts){const [id,rev,provider,protocol,at,known,status,quality]=f.source,v=f.value
  lines.push(`${id}@${rev}｜${f.scopeId}｜发生 ${at}；可知 ${known}｜${status}/${quality}`)
  if(v.kind==='METRIC')lines.push(`${v.metric}=${text(v.value)} ${v.unit}；统计 ${v.statistic}；日期 ${text(v.providerDate)}；能量口径 ${text(v.energyKind)}。`)
  else if(v.kind==='RESPONSE')lines.push(`${v.measure}=${text(v.value)}；量表 ${v.scale}；部位 ${text(v.region)}；距训练 ${text(v.elapsedHours)} h；关联 ${JSON.stringify(v.relatedTrainingRefs)}；侧别 ${text(v.side)}；协议 ${text(v.observationProtocol)}；功能 ${text(v.functionTaskId)}；备注 ${text(v.notes)}。`)
  else{
   lines.push(`课次 ${v.occurrenceId}/${v.componentId}｜${v.modality}；原目的 ${text(v.plannedPurpose)}；类型 ${text(v.observedType)}；RPE ${text(v.sessionRpe)}（${text(v.sessionRpeScale)}）；时长 ${text(v.actualDurationSeconds)} s；跳跃 ${text(v.jumpContacts)} 次。`)
   const props=['rawResolutionSeconds','gradePercent','surface'];const shared=Object.fromEntries(props.filter(k=>v.runSegments.length&&v.runSegments.every((r:any)=>r[k]===v.runSegments[0][k])).map(k=>[k,v.runSegments[0][k]]))
   if(Object.keys(shared).length)lines.push(`各段共同：${JSON.stringify(shared)}（分辨率s、坡度%；null=未记录）。`)
   for(const r of v.runSegments)lines.push(`区块 ${r.blockId} 第${text(r.roundIndex)}轮/步骤${r.stepIndex}：${text(r.distanceM)} m/${text(r.durationSeconds)} s；组休 ${text(r.restAfterSeconds)} s；${r.completion}；${props.filter(k=>!(k in shared)).map(k=>k+'='+text(r[k])).join('；')}。`)
   for(const [i,s] of v.strengthSets.entries())lines.push(`动作 ${text(s.catalogId)}（版本 ${text(s.catalogVersion)}）第${i+1}组：${text(s.reps)} 次 × ${text(s.loadKg)} kg（${s.loadBasis}，${s.side}）；RPE ${text(s.setRpe)}，RIR ${text(s.rir)}，量表 ${text(s.effortScale)}；保持 ${text(s.holdSeconds)} s，离心 ${text(s.eccentricSeconds)} s，幅度 ${text(s.rangeProtocol)}；${s.completion}。`)
  }
 }
 return lines.join('\n')
}
