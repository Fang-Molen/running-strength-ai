import {currentAthleteId} from './events.ts'
import type {EvolutionSnapshot} from './coach-evolution-v4.ts'
import type {EvidenceDependency} from './coach-development-projection.ts'
import {loadHealthSnapshot} from '../health/snapshot.ts'
import {loadCheckins,readArray,recoveryText} from '../health/legacy-inputs.ts'
import {localDay,shiftDay,validDay,shortHash} from '../health/observation.ts'
import {quantifyRecoverySnapshot,type RecoveryQuantification} from '../health/recovery-quantitative.ts'
import {readRestHistory,restContextLines} from '../health/rest-store.ts'

export type RecoveryContext={
 scope:'DAY_CONTEXT';athleteId:string;day:string;asOf:string;sourceId:string;
 quantitative:RecoveryQuantification;subjective:string[];missing:string[];
 safetyHold:boolean;safetyNotes:string[];dependency:EvidenceDependency|null;planWrite:false;diagnosis:false;
}
const time=(value:string)=>/T.*(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value))

/** A saved occurrence owns its date. A fresh chat needs an explicit date; an old “today”
 * in conversation memory cannot acquire today's health data on a later review. */
export function recoveryDayForReview(snapshot:EvolutionSnapshot,occurrenceId:string|null,question:string,freshChat=false,selectedStart?:string|null):string|null{
 if(!time(snapshot.asOf))return null
 if(!freshChat&&occurrenceId?.startsWith('chat-'))return null
 if(occurrenceId&&!freshChat){
  const rows=snapshot.active.filter(e=>e.athleteId===snapshot.athleteId&&e.occurrenceId===occurrenceId&&e.source!=='PLAN'&&e.source!=='THIRD_PARTY'&&time(e.eventAt)&&time(e.recordedAt)&&Date.parse(e.eventAt)<=Date.parse(snapshot.asOf)&&Date.parse(e.recordedAt)<=Date.parse(snapshot.asOf))
  if(rows.length&&selectedStart&&time(selectedStart)&&Date.parse(selectedStart)<=Date.parse(snapshot.asOf))return localDay(new Date(selectedStart))
  const days=[...new Set(rows.map(e=>localDay(new Date(e.eventAt))))]
  return days.length===1?days[0]:null
 }
 if(!freshChat||/朋友|队友|别人|假设|如果|举例/.test(question))return null
 const dates=[...new Set(question.match(/\d{4}-\d{2}-\d{2}/g)??[])]
 if(dates.length)return dates.length===1&&validDay(dates[0])&&dates[0]<=localDay(new Date(snapshot.asOf))?dates[0]:null
 const offsets=[...new Set([...question.matchAll(/今天|刚才|刚刚|昨天|前天/g)].map(m=>m[0]==='昨天'?-1:m[0]==='前天'?-2:0))]
 return offsets.length===1?shiftDay(localDay(new Date(snapshot.asOf)),offsets[0]):null
}

/** Read-only bridge; health remains daily background and never becomes a session measurement. */
export function readRecoveryContext(athleteId:string,day:string|null,asOf:string):RecoveryContext|null{
 if(athleteId!==currentAthleteId()||!day||!validDay(day)||!time(asOf)||day>localDay(new Date(asOf)))return null
 const snapshot=loadHealthSnapshot(day),quantitative=quantifyRecoverySnapshot({snapshot,athleteId,asOf,calendarOffsetMinutes:-new Date(asOf).getTimezoneOffset()})
 const checkins=loadCheckins().filter(c=>c.date===day&&time(c.at)&&Date.parse(c.at)<=Date.parse(asOf))
 const signatures=new Set(checkins.map(c=>JSON.stringify([c.fatigue??null,c.pain??null,c.recovery??null])))
 const ci=signatures.size===1?checkins.at(-1):null
 const subjective:string[]=[],missing=[...quantitative.missing]
 // U01->V88: self-reported naps/quiet rest are separate events, never silently added
 // to overnight sleep or interpreted as device-measured recovery.
 const rest=readRestHistory(undefined,Date.parse(asOf))
 const restRows=rest.state==='AVAILABLE' ? rest.selection?.records.filter(r=>r.contextDay===day)??[] : []
 if(rest.state==='CORRUPT')missing.push('独立休息记录有冲突或读取失败，未用于推断恢复')
 if(restRows.length)subjective.push(...restContextLines(day,Date.parse(asOf)))
 if(signatures.size>1)missing.push('当天主观反馈存在冲突，未任取一条')
 if(ci?.fatigue)subjective.push(`当天自报感受：${{fresh:'轻松',ok:'一般',tired:'很累'}[ci.fatigue]}`)
 if(ci?.recovery!==undefined&&recoveryText(ci))subjective.push(`当天自报恢复 ${recoveryText(ci)}`)
 if(ci?.pain)subjective.push(`当天自报疼痛：${{none:'未报告',mild:'有点疼',sharp:'明显疼'}[ci.pain]}`)
 // Legacy pain logs have no reliable knowledge time. Keep them as a separately
 // labelled present safety concern; never add them to historical quantitative evidence.
 const safetyNotes:string[]=[]
 const painLog=readArray('fk-pain-log-v1')
 if(painLog.unreadable)missing.push('独立疼痛日志不可读，未据此确认无痛')
 for(const row of painLog.rows){
  if(!row||typeof row!=='object')continue
  const p=row as Record<string,unknown>
  if((p.athleteId??'local')!==athleteId||p.date!==day||typeof p.score!=='number'||!Number.isFinite(p.score)||p.score<=0||p.score>10)continue
  const stamps=[p.at,p.recordedAt,p.updatedAt,p.timestamp].filter(v=>v!==undefined)
  if(stamps.some(v=>typeof v!=='string'||!time(v)||Date.parse(v)>Date.parse(asOf))){missing.push('疼痛日志的知晓时间无效或晚于分析时点，未纳入');continue}
  if(!stamps.length&&localDay(new Date(asOf))!==localDay(new Date())){missing.push('疼痛日志录入时间未知，未回填到历史分析时点');continue}
  safetyNotes.push(stamps.length?`${day} 独立疼痛日志报告不适，先核对部位与日常功能。`:`当前本地疼痛日志中有 ${day} 的报告；录入时间未知，仅作安全线索，不作为该分析时点已知的历史事实。`)
 }
 // Conflicting reports never cancel a positive safety report.
 const safetyHold=checkins.some(c=>c.pain==='mild'||c.pain==='sharp')||safetyNotes.length>0
 const sourceId=`health-context:${shortHash(athleteId)}:${day}`
 const points=snapshot.metrics.flatMap(m=>[...m.series,...m.candidates,...(m.current?[m.current]:[])])
 const times=[...points.filter(p=>quantitative.sourceIds.includes(p.id)&&time(p.updatedAt)&&Date.parse(p.updatedAt)<=Date.parse(asOf)).map(p=>p.updatedAt),...(ci?[ci.at]:[]),...restRows.map(r=>new Date(r.knownAt).toISOString())]
 const signature=JSON.stringify({scope:'DAY_CONTEXT',athleteId,day,quantitative:quantitative.revision,checkin:ci??null,checkinConflict:signatures.size>1,rest:restRows.map(r=>[r.originEventId,r.revision,r.knownAt,r.kind,r.duration])})
 const dependency:EvidenceDependency|null=!snapshot.unreadable&&times.length&&(quantitative.facts.length||subjective.length)?{
  id:sourceId,sourceId,occurrenceId:`health-day:${day}`,signature,eventAt:new Date(`${day}T00:00:00`).toISOString(),recordedAt:times.sort((a,b)=>Date.parse(a)-Date.parse(b)).at(-1)!,
 }:null
 return {scope:'DAY_CONTEXT',athleteId,day,asOf,sourceId,quantitative,subjective,missing,safetyHold,safetyNotes:[...new Set(safetyNotes)],dependency,planWrite:false,diagnosis:false}
}

export function recoveryContextLines(context:RecoveryContext):string[]{
 const facts=context.quantitative.facts
 const selected=[...facts.filter(f=>['SLEEP','FAT_RHR','FAT_HRV'].includes(f.metric)),...facts.filter(f=>['RHR','HRV'].includes(f.metric)&&!facts.some(x=>x.metric===(f.metric==='RHR'?'FAT_RHR':'FAT_HRV')))]
 return [...selected.map(f=>f.text),...context.subjective]
}

export function validRecoveryContext(context:RecoveryContext|undefined,snapshot:EvolutionSnapshot):context is RecoveryContext{
 return !!context&&context.scope==='DAY_CONTEXT'&&context.athleteId===snapshot.athleteId&&context.asOf===snapshot.asOf&&validDay(context.day)&&context.day<=localDay(new Date(snapshot.asOf))&&context.quantitative.athleteId===snapshot.athleteId&&context.quantitative.day===context.day&&context.quantitative.asOf===snapshot.asOf&&context.planWrite===false&&context.diagnosis===false&&context.quantitative.decisionAuthorized===false
}
