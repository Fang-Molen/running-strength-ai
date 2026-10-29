import {currentAthleteId,loadCommittedEventRecords,EVENT_JOURNAL_PREFIX} from '../core/events'
import {currentStore} from '../core/storage'
import {storeKeys} from '../core/storage-journal'
import {getTrainingPlanSnapshot,listTrainingOccurrences} from '../core/occurrence'
import {loadTrainingFact} from '../core/training-fact'
import {readFormalEvidenceRows} from '../core/coach-v4-formal-rows-store'
import {adaptFormalEvidenceRows,strictIso} from '../core/coach-v4-c11-adapter'
import {evaluateCoachEvolution,type EvolutionEvidence} from '../core/coach-evolution-v4'
import {coachImports} from '../core/coach-import-evidence'
import {readCurrentImportConflicts} from '../core/current-import-conflicts'
import {listCorrections} from '../core/training-correction'
import {loadTrainingActivities} from '../ui/training-read-model'
import {RUNNING_TRANSACTION_PREFIX} from '../core/running-transaction'
import {exerciseById} from '../strength/catalog'
import {localDay,shiftDay,validDay} from '../health/observation'

type Facts={summary:string[];details:string[]}
type ImportTotals={distanceM:number|null;durationSec:number|null;distanceChanged:boolean;durationChanged:boolean;distanceConflict:boolean;durationConflict:boolean}
type SessionFacts={id:string;date:string;at:string;kind:string;run:boolean;lift:boolean;completed:boolean;status:string;rows:EvolutionEvidence[];rpe:string;names:Map<string,string>;identity:string;importTotals?:ImportTotals;selfReport?:string}
const round=(n:number)=>Number(n.toFixed(2))
const clipped=(s:string,n:number)=>s.length<=n?s:s.slice(0,n-8)+'（明细省略）'
const validTime=(v:unknown):v is string=>typeof v==='string'&&strictIso(v)

/** Readers may degrade malformed storage to empty; make that distinction before sending a fact packet. */
function assertReadableTraining(){
 const store=currentStore();if(!store)throw Error('STORAGE_UNAVAILABLE')
 for(const key of storeKeys(store).filter(k=>/^fr255-(?:events-v1|training-occurrence-v1|training-correction-v1|confirmed-training-imports-v1)$/.test(k)||k.startsWith(EVENT_JOURNAL_PREFIX)||k.startsWith(RUNNING_TRANSACTION_PREFIX))){
  const raw=store.getItem(key);if(raw===null)continue
  const value=JSON.parse(raw)
  if(!value||typeof value!=='object'||!('data'in value))throw Error('UNREADABLE_TRAINING')
  if(key==='fr255-training-occurrence-v1'&&(!Array.isArray(value.data?.occurrences)||!Array.isArray(value.data?.trainingPlans)))throw Error('UNREADABLE_OCCURRENCES')
  if(/(?:events-v1|training-correction-v1|confirmed-training-imports-v1)$/.test(key)&&!Array.isArray(value.data))throw Error('UNREADABLE_ROWS')
 }
}
function rpeLine(rows:readonly EvolutionEvidence[],completionRpe:unknown,conflict:boolean):string{
 const values=rows.filter(r=>r.metric==='SESSION_RPE'&&r.value!=null).map(r=>r.value!)
 if(typeof completionRpe==='number'&&Number.isFinite(completionRpe)&&completionRpe>=1&&completionRpe<=10)values.push(completionRpe)
 const unique=[...new Set(values)]
 return conflict||unique.length>1?'整课RPE来源冲突，未取平均':unique.length?`整课RPE ${round(unique[0])}/10`:rows.some(r=>r.metric==='SESSION_RPE'&&r.value===null&&r.supersedes)?'整课RPE已更正撤回，当前未知':'整课RPE未记录'
}
function groupDetail(session:SessionFacts,selected:boolean):string{
 if(session.selfReport!==undefined)return `${selected?'选定训练·':''}${session.date} ${session.kind}（${session.status}；${session.rpe}）：${session.selfReport}；实际组数、次数、负重未记录，未据此计算整课次数或训练量。`
 const groups=new Map<string,EvolutionEvidence[]>()
 for(const row of session.rows.filter(r=>r.metric.startsWith('STRENGTH_')))groups.set(row.context,[...groups.get(row.context)??[],row])
 const lifts=[...groups].map(([protocol,rows],index)=>{
  const value=(metric:string)=>rows.find(r=>r.metric===metric)?.value
  const kg=value('STRENGTH_KG'),reps=value('STRENGTH_REPS'),seconds=value('STRENGTH_SECONDS')
  const parts=protocol.split(':'),name=session.names.get(protocol)??`动作${index+1}`,ordinal=Number(parts.at(-1))
  return `${name}${Number.isInteger(ordinal)&&ordinal>0?`第${ordinal}组`:''}：${kg==null?'负重未记录':`${round(kg)} kg`} × ${reps!=null?`${round(reps)}次`:seconds!=null?`${round(seconds)}秒`:'完成量未记录'}`
 })
 const runs=session.rows.filter(r=>r.metric==='SPLIT_SECONDS').map((r,index)=>{
  const distance=r.context.match(/:(\d+(?:\.\d+)?)m$/)?.[1]
  return `第${index+1}段 ${distance?`${round(Number(distance))}米，`:''}${r.value==null?'用时未知':`${round(r.value)}秒`}`
 })
 const rests=session.rows.filter(r=>r.metric==='REST_SECONDS'&&r.value!=null).map(r=>`${round(r.value!)}秒`)
 const totals=session.importTotals
 const aggregate=totals?[
  totals.distanceM!==null?`已确认实际总距离 ${round(totals.distanceM)}米`:`总距离未知${totals.distanceConflict?'（当前缓存来源冲突，待核对）':totals.distanceChanged?'（已有更正，旧总量已撤回）':'（未记录）'}`,
  totals.durationSec!==null?`已确认实际总时长 ${round(totals.durationSec)}秒`:`总时长未知${totals.durationConflict?'（当前缓存来源冲突，待核对）':totals.durationChanged?'（已有更正，旧总量已撤回）':'（未记录）'}`,
 ]:[]
 const pieces=[...aggregate,...lifts,...runs,...(rests.length?[`实际组间休息 ${rests.slice(0,6).join('、')}${rests.length>6?'等':''}`]:[])]
 const head=`${selected?'选定训练·':''}${session.date} ${session.kind}（${session.status}；${session.rpe}）`
 return clipped(`${head}：${pieces.length?pieces.join('；'):'尚无截至分析时点可确认的实际组或分段'}。`,350)
}

/** Current-owner, read-only chat facts. Selection prioritizes detail; it never gates the daily context. */
export function onlineTrainingFacts(day:string,asOf:string,options:{selectedOccurrenceId?:string|null}={}):Facts{
 const owner=currentAthleteId(),fail=(message:string):Facts=>({summary:[`训练与力量：${message}`],details:[]})
 if(!validDay(day)||!validTime(asOf)||day>localDay(new Date(asOf)))return fail('分析日期或截止时间无效，未读取训练数值。')
 try{
  assertReadableTraining()
  const cutoff=Date.parse(asOf),from=shiftDay(day,-6),selected=options.selectedOccurrenceId??null
  const committed=loadCommittedEventRecords(),visible=committed.filter(r=>r.event.athlete_id===owner&&validTime(r.recordedAt)&&validTime(r.event.timestamp)&&Date.parse(r.recordedAt)<=cutoff&&Date.parse(r.event.timestamp)<=cutoff&&Date.parse(r.recordedAt)>=Date.parse(r.event.timestamp))
  const events=visible.map(r=>r.event),formal=readFormalEvidenceRows(owner,asOf)
  const snapshot=evaluateCoachEvolution({athleteId:owner,asOf,question:'读取训练事实',evidence:adaptFormalEvidenceRows(formal.rows,owner,asOf).evidence})
  const active=snapshot.active.filter(r=>r.source!=='PLAN'),allCorrections=listCorrections(),visibleCorrections=allCorrections.filter(c=>validTime(c.recordedAt)&&Date.parse(c.recordedAt)<=cutoff)
  const quarantinedIds=new Set(snapshot.quarantined.flatMap(q=>q.id.split(',')))
  const rpeConflict=(id:string)=>formal.rows.some(r=>r.trainingOccurrenceId===id&&r.metric==='SESSION_RPE'&&quarantinedIds.has(r.recordId))
  const removed=(id:string)=>{const rows=allCorrections.filter(c=>c.trainingOccurrenceId===id);return rows.some(c=>!validTime(c.recordedAt))||rows.filter(c=>validTime(c.recordedAt)&&Date.parse(c.recordedAt)<=cutoff&&(c.kind==='VOID'||c.kind==='RESTORE')).sort((a,b)=>Date.parse(a.recordedAt!)-Date.parse(b.recordedAt!)).at(-1)?.kind==='VOID'}
  // Reuse only identity links from the unified log; its current numeric values are not as-of evidence.
  const links=loadTrainingActivities(),identity=(id:string)=>{const row=links.find(r=>r.occurrenceId===id||r.importId===id||r.id===id||r.originIds.includes(id));return row?.id??id}
  const sessions:SessionFacts[]=[],occurrences=listTrainingOccurrences()
  const imports=coachImports(owner,asOf),currentConflicts=readCurrentImportConflicts(imports)
  const conflictNotes=new Set<string>()
  for(const occurrence of occurrences){
   const id=occurrence.trainingOccurrenceId,start=events.find(e=>e.event_id===occurrence.startEventId&&e.event_type==='TRAINING_STARTED')
   if(!start||removed(id))continue
   const date=localDay(new Date(start.timestamp));if(date>day||(date<from&&id!==selected))continue
   const rows=active.filter(r=>r.occurrenceId===id),fact=loadTrainingFact(id,events)
   const close=fact?.endedAt?events.find(e=>e.event_id===occurrence.closeEventId):null
   const completed=fact?.lifecycle==='COMPLETED'&&close?.payload.completion!==false&&close?.payload.completionStatus!=='PARTIAL'
   const status=completed?'整课已完成':fact?.lifecycle==='INTERRUPTED'?'训练中断，未完成':fact?.lifecycle==='IN_PROGRESS'?'进行中，未完成':'完成状态待核对，未计为完成'
   const run=rows.some(r=>r.metric==='SPLIT_SECONDS'),lift=rows.some(r=>r.metric.startsWith('STRENGTH_'))
   const plan=occurrence.trainingPlanSnapshotId?getTrainingPlanSnapshot(occurrence.trainingPlanSnapshotId):null,names=new Map<string,string>()
   for(const row of rows.filter(r=>r.metric.startsWith('STRENGTH_'))){
    const match=/^strength:(.*):\d+$/.exec(row.context),moveId=match?decodeURIComponent(match[1]):null
    const exercise=plan?.exercises.find(e=>e.moveId===moveId),safe=exercise?.catalogId?exerciseById(exercise.catalogId)?.name:null
    if(safe)names.set(row.context,safe)
   }
   sessions.push({id,date,at:start.timestamp,kind:run&&lift?'跑步＋力量':run?'跑步':lift?'力量':'训练',run,lift,completed,status,rows,rpe:rpeLine(rows,close?.payload.rpe,rpeConflict(id)),names,identity:identity(id)})
  }
  for(const record of imports){
   const id=record.confirmedImportId;if(removed(id)||!validTime(record.occurredAt.value))continue
   const date=localDay(new Date(record.occurredAt.value));if(date>day||(date<from&&id!==selected))continue
   const conflict=currentConflicts.get(id),distanceConflict=conflict?.distance??false,durationConflict=conflict?.duration??false
   if(conflict)conflictNotes.add(conflict.note)
   const rows=active.filter(r=>r.occurrenceId===id),same=sessions.find(s=>s.identity===identity(id))
   if(same)continue
   const incomplete=record.runningSegments.some(s=>s.completion!=='COMPLETED')||record.strengthSets.some(s=>s.completion!=='COMPLETED')
   // A segment correction does not establish a replacement whole-session total.
   const distanceChanged=visibleCorrections.some(c=>c.trainingOccurrenceId===id&&c.kind==='FIELD'&&c.field==='distance')
   const durationChanged=visibleCorrections.some(c=>c.trainingOccurrenceId===id&&c.kind==='FIELD'&&c.field==='duration')
   const importTotals={distanceM:!distanceChanged&&!distanceConflict&&record.totalDistanceMeters.status==='RECORDED'?record.totalDistanceMeters.value:null,durationSec:!durationChanged&&!durationConflict&&record.durationSeconds.status==='RECORDED'?record.durationSeconds.value:null,distanceChanged,durationChanged,distanceConflict,durationConflict}
   sessions.push({id,date,at:record.occurredAt.value,kind:record.sport==='RUNNING'?'导入跑步':record.sport==='STRENGTH'?'导入力量':'导入训练',run:record.sport==='RUNNING'||record.sport==='MIXED',lift:record.sport==='STRENGTH'||record.sport==='MIXED',completed:false,status:incomplete?'已有实际记录，整课未确认完成':'已确认导入实际，整课完成状态未单独记录',rows,rpe:rpeLine(rows,null,rpeConflict(id)),names:new Map(),identity:identity(id),importTotals})
  }
  // The strength page saves completion/feedback without creating an occurrence. A save/edit is
  // a dated self-report, not evidence of the plan's sets or of another completed workout.
  const boundCloses=new Set(occurrences.flatMap(o=>[o.closeEventId,...(o.duplicateCloseEventIds??[])]).filter(Boolean))
  const reports=new Map<string,{record:typeof visible[number];strength:boolean}>()
  const feels:Record<string,string>={easy:'太轻松',ok:'刚好',hard:'偏重',pain:'有不适'}
  for(const record of [...visible].sort((a,b)=>Date.parse(a.recordedAt!)-Date.parse(b.recordedAt!))){
   const event=record.event,payload=event.payload
   if(event.event_type!=='TRAINING_COMPLETED'&&event.event_type!=='TRAINING_INTERRUPTED')continue
   if(payload.trainingOccurrenceId||boundCloses.has(event.event_id)||typeof payload.sessionId!=='string'||!payload.sessionId.trim())continue
   const date=localDay(new Date(event.timestamp)),id=`sets:${payload.sessionId}:${date}`
   if(date>day||(date<from&&id!==selected&&event.event_id!==selected))continue
   const strength=typeof payload.feel==='string'&&Object.hasOwn(feels,payload.feel)
   reports.set(id,{record,strength:strength||reports.get(id)?.strength===true})
  }
  for(const [id,{record,strength}] of reports){
   const event=record.event,payload=event.payload,shared=identity(id)
   if(removed(id)||removed(event.event_id)||sessions.some(s=>s.identity===shared))continue
   const changed=visibleCorrections.some(c=>(c.trainingOccurrenceId===id||c.trainingOccurrenceId===event.event_id)&&c.kind==='FIELD'&&c.field==='feedback'&&Date.parse(c.recordedAt!)>=Date.parse(record.recordedAt!))
   const completed=event.event_type==='TRAINING_COMPLETED'&&payload.completion!==false&&payload.completionStatus!=='PARTIAL'&&payload.interruptions!==true
   const label=typeof payload.feel==='string'&&Object.hasOwn(feels,payload.feel)?feels[payload.feel]:null
   const feedback=changed?'反馈已更正撤回，当前未知':label?`反馈：${label}`:completed?'反馈未记录':'反馈：未完成或中断'
   sessions.push({id,date:localDay(new Date(event.timestamp)),at:event.timestamp,kind:strength?'力量反馈':'训练反馈',run:false,lift:false,completed,status:completed?'完成自报':'未完成自报',rows:[],rpe:changed?'整课RPE已更正撤回，当前未知':rpeLine([],payload.rpe,false),names:new Map(),identity:shared,selfReport:feedback})
  }
  if(currentAthleteId()!==owner)return fail('运动员档案已切换，旧训练摘要已丢弃。')
  const measured=(s:SessionFacts)=>s.selfReport!==undefined||!!s.importTotals||s.rows.some(r=>['SPLIT_SECONDS','STRENGTH_REPS','STRENGTH_SECONDS'].includes(r.metric)&&r.value!=null&&r.value>0)
  const recent=sessions.filter(s=>s.date>=from&&s.date<=day&&measured(s)),today=recent.filter(s=>s.date===day)
  const counts=(rows:SessionFacts[])=>{
   const actual=rows.filter(s=>s.selfReport===undefined),reports=rows.filter(s=>s.selfReport!==undefined)
   const actualLine=actual.length?`本机已完成${actual.filter(s=>!s.importTotals&&s.completed).length}次；本机有实际记录但整课未完成${actual.filter(s=>!s.importTotals&&!s.completed).length}次；已确认导入${actual.filter(s=>s.importTotals).length}条（不推断整课完成）；跑步${actual.filter(s=>s.run).length}次、力量${actual.filter(s=>s.lift).length}次（跑步与力量可能属同课，不相加）`:'无可确认的逐组、逐段或导入实际'
   return actualLine+(reports.length?`；完成自报${reports.filter(s=>s.completed).length}条、未完成反馈${reports.filter(s=>!s.completed).length}条（按同课同日保留最新反馈，未据此计算整课次数或训练量）`:'')
  }
  const summary=[`${day} 逐组/逐段/完成自报/已确认导入训练：${today.length?counts(today):'本范围无截至分析时点可确认的实际记录'}。`, `近7天同范围（${from}—${day}）${recent.length?counts(recent):'无可确认实际记录'}；截至 ${asOf}，与手表摘要同源记录不重复累加。`]
  const ordered=sessions.sort((a,b)=>Number(b.id===selected)-Number(a.id===selected)||b.at.localeCompare(a.at))
  const details=ordered.slice(0,8).map(s=>groupDetail(s,s.id===selected))
  if(ordered.length>8)summary.push(`训练摘要仅列最近或选定的8次明细，另${ordered.length-8}次未展开。`)
  if(formal.unknownCommitTime.length||formal.corrections.unknownCommitTime.length)summary.push('部分旧训练缺少可靠录入时间，未补造数值或完成事实。')
  if(snapshot.quarantined.length)summary.push('部分训练数值或重复来源有冲突，相关数值未采用。')
  summary.push(...conflictNotes)
  return{summary:summary.map(s=>clipped(s,500)),details}
 }catch{return fail('部分训练来源读取失败，不能解释为没有训练；请保留并核对原记录。')}
}
