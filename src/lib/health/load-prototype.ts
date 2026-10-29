import type { EvidenceSnapshot, EvidenceRef, TrainingFact } from './analysis-contract'
import { trainingDose } from './muscle-exposure'
export type LoadPrototypeSession = {ref:EvidenceRef; day:string; modality:string; distanceM:number|null; strengthSets:number; strengthComplete:boolean; sessionLoadAU:number|null; gaps:string[]}
/** Experimental descriptive view of a previously verified evidence snapshot. */
export function buildLoadPrototype(snapshot:EvidenceSnapshot):{sessions:LoadPrototypeSession[];snapshotId:string;limitations:string[]} {
 const facts=snapshot.facts.filter((f):f is TrainingFact=>f.kind==='TRAINING'&&f.athleteId===snapshot.context.athleteId&&f.status==='CONFIRMED'&&Date.parse(f.startedAt)<=Date.parse(snapshot.context.asOf))
 const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:snapshot.context.timeZone,year:'numeric',month:'2-digit',day:'2-digit'})
 const sessions=facts.map(t=>{
  const d=trainingDose(t),parts=fmt.formatToParts(new Date(t.startedAt)),day=['year','month','day'].map(k=>parts.find(p=>p.type===k)?.value).join('-')
  const ambiguous=facts.filter(x=>x.occurrenceId===t.occurrenceId).length!==1
  const valid=(t.endedAt?Date.parse(t.endedAt)<=Date.parse(snapshot.context.asOf):t.sessionLoadEvidence?.origin==='CONFIRMED_IMPORT'&&t.sessionLoadEvidence.completed===true)&&t.sessionRpeScale==='CR10'&&t.sessionRpe!==null&&Number.isFinite(t.sessionRpe)&&t.sessionRpe>=0&&t.sessionRpe<=10&&t.actualDurationSeconds!==null&&Number.isFinite(t.actualDurationSeconds)&&t.actualDurationSeconds>0&&t.actualDurationSeconds<=86400
  const gaps=[...new Set([...d.missing,...(!valid?['整课CR10评分或完整时长未确认']:[]),...(ambiguous?['同一训练存在多个部分，整课负荷未拆分']:[])])]
  return {ref:{id:t.id,revision:t.revision},day,modality:t.modality,distanceM:t.modality==='RUN'&&d.complete.distance?d.distanceM:null,strengthSets:d.sets,strengthComplete:d.complete.sets,sessionLoadAU:!ambiguous&&valid?Number((t.sessionRpe!*t.actualDurationSeconds!/60).toFixed(2)):null,gaps}
 })
 return {sessions,snapshotId:snapshot.snapshotId,limitations:['整课负荷为主观描述，不是疲劳、恢复或伤病预测','缺失及冲突不视为零；用户未确认的课次不计入','跑步与力量分开保留；本原型未接入曲线、问答或自动更新']}
}
