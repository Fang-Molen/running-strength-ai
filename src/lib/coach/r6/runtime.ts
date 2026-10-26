/** R6 host-only decisions: saved inputs → reviewable choice → explicit calendar transaction.
 * No model output is accepted here. Original actuals and earlier decisions are immutable.
 */
import { currentAthleteId, loadEvents } from '../../core/events'
import { currentStore } from '../../core/storage'
import { appendJournal, readJournal } from '../../core/storage-journal'
import { analysisDigest } from '../../health/analysis-evidence'
import { localDay } from '../../health/observation'
import type { EvidenceRef } from '../../health/analysis-contract'
import { readScheduleDocument, loadSchedule, type R5ScheduleAudit } from '../../ui/day-schedule'
import { addDays, type ScheduleEntry } from '../../ui/day-schedule-rules'
import { withScheduleLock } from '../../ui/schedule-writer'
import { activePlanDoc } from '../../plan/active-plan'
import { readR5Context, commitR5Schedule } from '../r5/host'
import { requireR5Scope, r5ScopeReady } from '../r5/scope'
import { isR4CourseCandidate, r4CourseStarted } from '../r4/courses'
import { readCycleGoal, readCycleDocuments } from '../cycle/host'
import { validCycleDay } from '../cycle/types'
import { assessAthleteHistory } from '../assessment/history'
import { readTrainingModelWorkbench, type TrainingModelWorkbench } from '../training-models/workbench'
import { readScientificInputSources } from '../training-models/scientific-input-host'
import { canonical, exactTime } from '../training-models/source'
import { trainingDecisionEvidencePolicy } from '../training-models/knowledge'
import { KNOWLEDGE_APPROVALS_KEY } from '../knowledge/approval-store'
import { COMPLETE_KNOWLEDGE_VERSION } from '../knowledge/complete'

export const R6_CHANGED = 'fk-r6-changed'
export const R6_CONFIRMATION = 'CONFIRM_R6_CANDIDATE' as const
export const R6_POLICY_VERSION = 'FK_R6_DECISION_1'
const TTL = 15 * 60000
export type R6Candidate = {
 id:string; option:'A'|'B'|'C'; action:'KEEP'|'MOVE'|'DEFER'; title:string; sessionId:string
 changedVariable:'NONE'|'DATE'|'SESSION_EXECUTION'; before:ScheduleEntry; after:ScheduleEntry
 reason:string; evidence:EvidenceRef[]; evidenceIds:string[]; risks:string[]; observationMetrics:string[]
 reschedule:string|null; requiresConfirmation:true; canConfirm:boolean; blockedReasons:string[]
}
export type R6Decision = {
 id:string; athleteId:string; day:string; asOf:string; version:string; knowledgeVersion:string
 input:TrainingModelWorkbench['input']; comparison:TrainingModelWorkbench['result']['review']
 history:ReturnType<typeof assessAthleteHistory>; candidates:R6Candidate[]; missing:string[]
 safety:{hold:boolean;message:string}; explanation:string
 /** Exact source bytes, also checked synchronously after the last asynchronous read. */
 source:string
}
export type R6Proposal = {
 schema:1; id:string; athleteId:string; createdAt:string; expiresAt:string; hash:string
 decision:R6Decision; candidate:R6Candidate; rescheduleOf?:string
}
export type R6Reassessment = {
 state:'PENDING'|'SUPPORTED'|'WEAKENED'|'WITHDRAWN'; message:string; reasons:string[]; basis:string
}
export type R6Feedback = { outcome:'BETTER'|'UNCHANGED'|'WORSE'|'UNKNOWN'; note:string }
export type R6HistoryRow = {
 id:string; proposal:R6Proposal; status:'PENDING'|'ACCEPTED'|'REJECTED'|'STALE'; acceptedAt:string|null
 execution:{state:'NOT_STARTED'|'STARTED'|'COMPLETED'|'DEFERRED'|'UNKNOWN';text:string}
 outcome:{text:string;actual:ScheduleEntry['actual']|null;feedback:R6Feedback|null}
 reassessment:R6Reassessment; events:{at:string;action:string;detail:string}[]
}
type Event = {schema:1;athleteId:string;proposalId:string;at:string;action:'PROPOSED'|'ACCEPTED'|'REJECTED'|'STALE'|'FEEDBACK'|'REASSESSED';detail:string;proposal?:R6Proposal;feedback?:R6Feedback;reassessment?:R6Reassessment}
const prefix = (owner=currentAthleteId()) => `fk-r6-ledger:${encodeURIComponent(owner)}:`
const digest = async (v:unknown) => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(v))))].map(x=>x.toString(16).padStart(2,'0')).join('')
const changed = () => { if(typeof window!=='undefined')window.dispatchEvent(new Event(R6_CHANGED)) }
const fail = (message:string) => ({ok:false as const,message})
function append(event:Omit<Event,'schema'|'athleteId'>,owner=currentAthleteId()) {
 if(currentAthleteId()!==owner)return false
 return appendJournal(prefix(owner),`${event.proposalId}:${event.action}`,{...event,schema:1 as const,athleteId:owner})
}
function events(asOf:string):Event[] {
 return readJournal<Event>(prefix()).map(r=>r.data).filter(e=>e.schema===1&&e.athleteId===currentAthleteId()&&exactTime(e.at)&&Date.parse(e.at)<=Date.parse(asOf))
}
function validateTime(day:string,asOf:string) {
 if(!validCycleDay(day)||!exactTime(asOf)||Date.parse(asOf)>Date.now())throw Error('日期或读取截止时间无效，不能用未来记录做当前决定。')
}
function fresh(asOf:string,now=new Date().toISOString()) {
 return exactTime(now)&&Date.parse(asOf)<=Date.parse(now)&&Date.parse(now)-Date.parse(asOf)<TTL
}
function knowledgeSource() {
 return {policy:R6_POLICY_VERSION,catalog:COMPLETE_KNOWLEDGE_VERSION,evidence:trainingDecisionEvidencePolicy(),approvals:currentStore()?.getItem(KNOWLEDGE_APPROVALS_KEY)??null}
}
function sourceAt(day:string,asOf:string) {
 const c=readR5Context(asOf),s=c.analysis.snapshot,scientific=readScientificInputSources(day,asOf,c.entries)
 return canonical({owner:c.owner,day,entries:c.entries,profile:c.rawProfile,training:c.trainingProfile,checks:c.checks,symptoms:c.symptoms,
  context:{...s.context,asOf:undefined},facts:s.facts,excluded:s.excluded,conflicts:s.conflicts,gaps:s.gaps,safety:s.safetyConstraints,
  hold:c.hold,scientific:{...scientific,foods:scientific.foods.filter(f=>(f.athleteId??'local')===c.owner)},goal:readCycleGoal(),importedPlan:activePlanDoc(currentStore()),knowledge:knowledgeSource(),
  events:loadEvents().filter(e=>e.athlete_id===c.owner)})
}
const posture = (e:ScheduleEntry) => e.modality==='strength'&&!!e.exercises?.length&&e.exercises.some(x=>/硬拉|臀|腘|腿弯举|后链|deadlift|hip.?thrust|leg.?curl|rdl/i.test(x.name))
const speed = (e:ScheduleEntry) => e.runComponents?.some(c=>c.modality==='RUNNING'&&['REPETITION_SPEED','RACE'].includes(c.purpose))===true
const snapshotRefs = (w:TrainingModelWorkbench):EvidenceRef[] => w.input.snapshot.facts.map(f=>({id:f.id,revision:f.revision}))
function freeDate(entry:ScheduleEntry,after:string,c:ReturnType<typeof readR5Context>,earliest:string) {
 const training=c.trainingProfile,days=training.days,minutes=training.minutes
 if(!validCycleDay(after)||after<earliest||!days||!minutes||!days.at||!minutes.at||training.conflicts.length||training.restrictions.length)return false
 if(Date.parse(days.at)>Date.parse(c.analysis.snapshot.context.asOf)||Date.parse(minutes.at)>Date.parse(c.analysis.snapshot.context.asOf))return false
 if(!days.value.includes(new Date(after+'T12:00:00Z').getUTCDay())||minutes.value<entry.minutes)return false
 if(c.entries.some(e=>e.id!==entry.id&&e.date===after&&!['skipped','rejected'].includes(e.status)))return false
 if(activePlanDoc(currentStore())?.plan.days.some(e=>e.date===after&&!/休息/.test(e.title)))return false
 const races=[readCycleGoal()?.raceDate,...c.profile.marks.map(x=>x.deadline)].filter((x):x is string=>!!x)
 // A conservative product search window; these are not physiological recovery cutoffs.
 if(races.some(d=>Math.abs(Date.parse(d)-Date.parse(after))<=2*86400000))return false
 return !c.entries.some(e=>e.id!==entry.id&&speed(e)&&!['skipped','rejected'].includes(e.status)&&Math.abs(Date.parse(e.date)-Date.parse(after))<=86400000)
}
/** Schedule-only permission for an existing strength dose, never a new prescription. */
function strengthScheduleReady(target:ScheduleEntry,input:TrainingModelWorkbench['input'],c:ReturnType<typeof readR5Context>,asOf:string) {
 const today=localDay(new Date(asOf))
 const responses=input.snapshot.facts.filter(f=>f.kind==='RESPONSE'&&Date.parse(f.occurredAt)>=Date.parse(asOf)-86400000)
 const localScreen=responses.some(p=>p.kind==='RESPONSE'&&p.measure==='PAIN'&&p.value===0&&p.region!==null&&['hamstrings','glutes','lower_back'].includes(p.region)&&p.side==='BILATERAL'&&p.scale==='0-10_HIGH_WORSE'&&responses.some(f=>f.kind==='RESPONSE'&&f.measure==='FUNCTION'&&f.value===0&&f.scale==='FUNCTION_LIMITATION_0_1'&&p.region===f.region&&p.side===f.side))
 const familiarStrength=c.entries.some(e=>e.id!==target.id&&e.athleteId===c.owner&&e.date<today&&e.date>=addDays(today,-90)&&e.actual?.outcome==='as_planned'&&e.actual.executionState!=='PARTIAL'&&e.actual.executionState!=='INTERRUPTED'&&Date.parse(e.actual.at)<=Date.parse(asOf)&&!e.actual.reasons.length&&e.actual.minutes!==null&&e.actual.minutes>=target.minutes&&e.actual.intensity===target.intensity&&canonical(e.exercises)===canonical(target.exercises))
 return posture(target)&&!c.hold&&input.recovery?.safetyState==='NO_KNOWN_HOLD'&&input.recovery.signalState==='NO_ADVERSE_SIGNAL_OBSERVED'&&!input.snapshot.conflicts.length&&localScreen&&familiarStrength
}
function candidatesFor(w:TrainingModelWorkbench,c:ReturnType<typeof readR5Context>,version:string,day:string):R6Candidate[] {
 const today=localDay(new Date(w.asOf)),earliest=day>today?day:today
 const entries=c.entries.filter(e=>e.athleteId===c.owner&&e.date>=earliest&&validCycleDay(e.date)&&c.entries.filter(x=>x.id===e.id).length===1&&isR4CourseCandidate(e)).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))
 const conflict=entries.find(e=>posture(e)&&c.entries.some(s=>speed(s)&&s.date>=e.date&&Date.parse(s.date)-Date.parse(e.date)<=86400000))
 const target=conflict??entries[0]
 if(!target)return []
 const purpose=w.result.review.purposeReadiness.find(p=>p.sessionId===target.id)
 const commonBlocked=[...(c.hold?['疼痛或健康限制仍生效，不能以维持原课表放行。']:[]),...(!w.input.recovery||w.input.recovery.safetyState!=='NO_KNOWN_HOLD'?['安全状态尚未完整核定。']:[])]
 const blocked=[...commonBlocked,...(!purpose?.allowKeep?[...(purpose?.reasons??[]),...(purpose?.missing??[]),'当前课程目的与既有耐受尚不支持直接保留执行。']:[])]
 const moveAllowed=strengthScheduleReady(target,w.input,c,w.asOf)
 const observations=['实际完成的组数/分段及同结构成绩','同量表主观用力程度（RPE）','局部疼痛/酸痛与次日功能','同设备、同协议的睡眠和恢复记录']
 const refs=[{id:`schedule:${target.id}:${analysisDigest(target)}`,revision:0},...snapshotRefs(w)]
 const make=(option:R6Candidate['option'],action:R6Candidate['action'],after:ScheduleEntry,reason:string,block:string[]=blocked):R6Candidate=>({id:`r6:${version}:${target.id}:${action}`,option,action,title:action==='KEEP'?'保留原安排':action==='MOVE'?'移动后链力量课':'暂缓本课并复核',sessionId:target.id,
  changedVariable:action==='KEEP'?'NONE':action==='MOVE'?'DATE':'SESSION_EXECUTION',before:structuredClone(target),after:structuredClone(after),reason,evidence:refs,evidenceIds:conflict?['CONCURRENT-SCHUMANN-2022']:[],
  risks:action==='MOVE'?['挪动日期不保证组织恢复或训练效果；须观察局部功能和下一次速度课。']:action==='KEEP'?['维持计划不代表已经恢复；单次设备分数不能清除疼痛限制。']:['本课延期会减少本周已安排刺激；后续不可自动补课或叠加剂量。'],
  observationMetrics:observations,reschedule:action==='DEFER'?'复核疼痛、功能、恢复与可用日后，可从本次记录单独预览原剂量的重排；不会自动补回。':null,
  requiresConfirmation:true,canConfirm:block.length===0,blockedReasons:[...new Set(block)]})
 const out=[make('A','KEEP',target,conflict?'保留已有课程顺序作为比较基准；后链力量与关键速度课接近，需要核对执行质量。':'保留真实已保存课程的结构和剂量，不因模型标签增加训练。')]
 if(conflict&&moveAllowed){
  const key=c.entries.filter(e=>speed(e)&&e.date>=target.date&&Date.parse(e.date)-Date.parse(target.date)<=86400000).sort((a,b)=>b.date.localeCompare(a.date))[0]
  const date=Array.from({length:6},(_,i)=>addDays(key.date,i+2)).find(d=>freeDate(target,d,c,earliest))
  if(date)out.push(make('B','MOVE',{...target,date,movedFrom:target.movedFrom??target.date},`仅将后链力量从${target.date}移到${date}，保护${key.date}已保存速度课的顺序；组数、次数、负重、休息与总剂量保持。日期间隔是保守排期条件，不是恢复完成判定。`,[]))
 }
 out.push(make('C','DEFER',{...target,status:'skipped'},'暂缓这节尚未开始的已保存课程，保留原结构供后续复核；不记录为完成，不添加替代课。',[]))
 return out
}
export async function readR6Decision(day=localDay(),asOf=new Date().toISOString()):Promise<R6Decision> {
 requireR5Scope();validateTime(day,asOf)
 const owner=currentAthleteId(),before=sourceAt(day,asOf),w=await readTrainingModelWorkbench({},day,asOf)
 if(currentAthleteId()!==owner||before!==sourceAt(day,asOf))throw Error('身份或输入已变化，请重新读取。')
 const version=await digest(before),knowledgeVersion=await digest(knowledgeSource())
 if(currentAthleteId()!==owner||before!==sourceAt(day,asOf))throw Error('资料版本已变化，请重新读取。')
 const c=readR5Context(asOf),candidates=candidatesFor(w,c,version,day),history=assessAthleteHistory(w.input.snapshot)
 return {id:`r6:${version}`,athleteId:owner,day,asOf,version,knowledgeVersion,input:w.input,comparison:w.result.review,history,candidates,
  missing:[...new Set([...w.missing,...(!candidates.length?['当前没有归属明确、结构完整且尚未开始的已保存课程。']:[])])],safety:{hold:c.hold,message:c.safety.message},
  explanation:'依据当前档案、已保存目标与实际记录比较候选；计划是待执行安排，设备信号与模型估计不能单独证明已恢复。每次只改变一个安排变量，确认后才更新日历。',source:before}
}
const proposalPayload=(p:R6Proposal)=>({...p,hash:undefined})
async function persistProposal(decision:R6Decision,candidate:R6Candidate,now:string,rescheduleOf?:string) {
 const p:R6Proposal={schema:1,id:crypto.randomUUID(),athleteId:decision.athleteId,createdAt:now,expiresAt:new Date(Date.parse(now)+TTL).toISOString(),decision:structuredClone(decision),candidate:structuredClone(candidate),hash:'',...(rescheduleOf?{rescheduleOf}:{})}
 p.hash=await digest(proposalPayload(p))
 if(currentAthleteId()!==p.athleteId||sourceAt(decision.day,now)!==decision.source)throw Error('依据已经变化，未保存过期预览。')
 if(!append({proposalId:p.id,at:now,action:'PROPOSED',detail:'保存了当时可见事实、比较、解释与待选方案。',proposal:p}))throw Error('候选保存失败，未修改课表。')
 changed();return p
}
export async function prepareR6Candidate(candidateId:string,day=localDay(),asOf=new Date().toISOString()):Promise<R6Proposal> {
 requireR5Scope();if(!fresh(asOf))throw Error('预览时间已过期，请重新读取当前资料。')
 const owner=currentAthleteId()
 return (await withScheduleLock(async()=>{
  if(currentAthleteId()!==owner)throw Error('身份已变化。')
  const d=await readR6Decision(day,asOf),c=d.candidates.find(c=>c.id===candidateId)
  if(!c)throw Error('候选或依据版本已变化，请重新读取。')
  if(!c.canConfirm)throw Error(c.blockedReasons.join('；'))
  return persistProposal(d,c,asOf)
 })).value
}
function scheduleReceipt(id:string,asOf=new Date().toISOString()):R5ScheduleAudit|undefined {
 const d=readScheduleDocument();if(!d.ok)throw Error(d.reason)
 return (d.value as typeof d.value&{r4Receipts?:R5ScheduleAudit[]}).r4Receipts?.find(r=>r.athleteId===currentAthleteId()&&r.proposalId===id&&r.kind==='R5_CHANGE'&&Date.parse(r.at)<=Date.parse(asOf))
}
function storedProposal(id:string,asOf:string) {
 return events(asOf).find(e=>e.proposalId===id&&e.action==='PROPOSED')?.proposal
}
function processed(id:string,asOf:string) {
 return events(asOf).some(e=>e.proposalId===id&&['ACCEPTED','REJECTED','STALE'].includes(e.action))||!!scheduleReceipt(id,asOf)
}
export async function confirmR6Candidate(proposal:R6Proposal,confirmation:typeof R6_CONFIRMATION,now=new Date().toISOString()) {
 if(confirmation!==R6_CONFIRMATION)return fail('需要明确确认本次候选；没有修改日历。')
 const owner=currentAthleteId()
 if(typeof window!=='undefined'&&!navigator.locks?.request)return fail('此浏览器无法协调跨页面确认，保留预览。')
 try{return (await withScheduleLock(async()=>{
  requireR5Scope()
  if(currentAthleteId()!==owner||proposal.athleteId!==owner)return fail('身份已变化或候选不属于当前用户。')
  const stored=storedProposal(proposal.id,now)
  if(!stored||processed(stored.id,now))return fail('候选不存在或已经处理；没有重复写入。')
  if(!exactTime(now)||Date.parse(now)<Date.parse(stored.createdAt)||Date.parse(now)>=Date.parse(stored.expiresAt)||canonical(proposal)!==canonical(stored)||await digest(proposalPayload(stored))!==stored.hash)return fail('确认内容、签名摘要或时间无效，请重新预览。')
  const d=await readR6Decision(stored.decision.day,now)
  const candidate=stored.rescheduleOf?rescheduleCandidate(d,stored.rescheduleOf,stored.candidate.after.date,now):d.candidates.find(c=>c.id===stored.candidate.id)
  if(d.version!==stored.decision.version||!candidate||canonical(candidate)!==canonical(stored.candidate)||!candidate.canConfirm){
   append({proposalId:stored.id,at:now,action:'STALE',detail:'当前事实、计划、知识或安全条件已变化，原预览作废。'});changed()
   return fail('依据、计划或安全条件已变化，请重新预览；没有覆盖当前记录。')
  }
  // No awaits below this point: re-read exact bytes and execution state immediately before the shared R5 write.
  if(currentAthleteId()!==owner||sourceAt(d.day,now)!==d.source)return fail('读取期间身份或事实已变化，请重新预览。')
  const entry=loadSchedule().entries.find(e=>e.id===candidate.sessionId)
  if(!entry||entry.athleteId!==owner||entry.actual||r4CourseStarted(entry)||!['planned',...(stored.rescheduleOf?['skipped']:[])].includes(entry.status)||canonical(entry)!==canonical(candidate.before))return fail('课程已开始、完成或被修改，不能覆盖。')
  // KEEP records a decision but writes no schedule bytes. MOVE/DEFER commit old/new + receipt atomically.
  if(candidate.action!=='KEEP'&&!commitR5Schedule([{before:entry,after:candidate.after}],stored.id,`R6用户确认：${candidate.reason}`,false,now))return fail('日历写入失败或课程已变化，请核对回执。')
  const saved=append({proposalId:stored.id,at:now,action:'ACCEPTED',detail:candidate.action==='KEEP'?'用户确认保留既有安排；无日历变更。':'用户明确确认；原结构与实际记录保留，日历已有原子变更回执。'})
  if(!saved&&candidate.action==='KEEP')return fail('确认记录保存失败，既有日历未改变；请重新确认。')
  changed();return {ok:true as const,message:saved?'已按确认保存；后续结果将用于复核这次判断。':'日历已保存并保留回执；历史卡写入失败，刷新可从回执恢复，勿重复提交。'}
 })).value}catch(e){return fail(e instanceof Error?e.message:'确认失败，未静默覆盖课表。')}
}
export async function rejectR6Candidate(proposal:R6Proposal,now=new Date().toISOString()) {
 const owner=currentAthleteId()
 if(!exactTime(now)||Date.parse(now)>Date.now()||Date.parse(now)<Date.parse(proposal.createdAt))return fail('取消时间无效。')
 return (await withScheduleLock(()=>{
  requireR5Scope();if(currentAthleteId()!==owner||proposal.athleteId!==owner)return fail('身份已变化。')
  const stored=storedProposal(proposal.id,now)
  if(!stored||canonical(stored)!==canonical(proposal)||processed(proposal.id,now))return fail('预览已变化或已经处理。')
  if(!append({proposalId:proposal.id,at:now,action:'REJECTED',detail:'用户取消本次候选，课表未改变。'}))return fail('取消记录保存失败。')
  changed();return {ok:true as const,message:'已记录取消，课表未改变。'}
 })).value
}
function rescheduleCandidate(d:R6Decision,deferredId:string,date:string,asOf:string):R6Candidate|undefined {
 const prior=storedProposal(deferredId,asOf),receipt=scheduleReceipt(deferredId,asOf)
 if(!prior||prior.candidate.action!=='DEFER'||!receipt)return
 const c=readR5Context(asOf),e=c.entries.find(e=>e.id===prior.candidate.sessionId)
 const purpose=d.comparison.purposeReadiness.find(p=>p.sessionId===e?.id)
 if(!e||e.status!=='skipped'||e.actual||r4CourseStarted(e)||e.athleteId!==d.athleteId||canonical(e)!==canonical(prior.candidate.after)||c.hold||d.input.recovery?.safetyState!=='NO_KNOWN_HOLD'||!(purpose?.allowKeep||strengthScheduleReady(e,d.input,c,asOf))||!freeDate(e,date,c,localDay(new Date(asOf))))return
 return {...prior.candidate,id:`r6:${d.version}:${e.id}:RESCHEDULE:${date}`,option:'B',action:'MOVE',title:'重排已暂缓的原课程',before:structuredClone(e),after:{...e,date,status:'planned',movedFrom:e.movedFrom??e.date},changedVariable:'DATE',reason:`复核后将已暂缓的原课安排到${date}，原剂量完整保留，不增加第二节课。`,reschedule:null,canConfirm:true,blockedReasons:[]}
}
export async function prepareR6Reschedule(deferredDecisionId:string,date:string,now=new Date().toISOString()) {
 requireR5Scope();validateTime(date,now);if(!fresh(now))throw Error('请读取当前资料后重排。')
 return (await withScheduleLock(async()=>{
  const d=await readR6Decision(localDay(new Date(now)),now),c=rescheduleCandidate(d,deferredDecisionId,date,now)
  if(!c)throw Error('当前恢复、可用日或原课程状态不满足重排条件；保留暂缓，不追加补课。')
  return persistProposal(d,c,now,deferredDecisionId)
 })).value
}
function reviewRow(proposal:R6Proposal,rows:Event[],d:R6Decision):R6HistoryRow {
 const own=rows.filter(e=>e.proposalId===proposal.id),receipt=scheduleReceipt(proposal.id,d.asOf)
 const accepted=own.find(e=>e.action==='ACCEPTED'),last=own.filter(e=>['ACCEPTED','REJECTED','STALE'].includes(e.action)).at(-1)
 const status:R6HistoryRow['status']=receipt||accepted?'ACCEPTED':last?.action==='REJECTED'?'REJECTED':last?.action==='STALE'?'STALE':'PENDING'
 const entry=loadSchedule().entries.find(e=>e.id===proposal.candidate.sessionId&&e.athleteId===d.athleteId)
 const actual=entry?.actual&&Date.parse(entry.actual.at)<=Date.parse(d.asOf)?structuredClone(entry.actual):null
 const execution:R6HistoryRow['execution']=actual?{state:actual.executionState==='PARTIAL'||actual.executionState==='INTERRUPTED'?'STARTED':actual.outcome==='missed'?'NOT_STARTED':'COMPLETED',text:actual.outcome==='missed'?'记录为未执行':actual.executionState==='PARTIAL'||actual.executionState==='INTERRUPTED'?'记录为部分执行或中断':'已记录实际完成'}:
  entry&&loadEvents().some(e=>e.athlete_id===d.athleteId&&Date.parse(e.timestamp)<=Date.parse(d.asOf)&&['TRAINING_STARTED','TRAINING_COMPLETED','TRAINING_SET_COMPLETED','RUNNING_CONTINUOUS_COMPLETED'].includes(e.event_type)&&['run','strength'].some(part=>e.payload.sessionId===`scheduled:${entry.id}:${part}`))?{state:'STARTED',text:'已有真实开始事件'}:status==='ACCEPTED'&&proposal.candidate.action==='DEFER'?{state:'DEFERRED',text:'已确认暂缓；没有记为完成'}:entry?{state:'NOT_STARTED',text:'尚无实际执行记录'}:{state:'UNKNOWN',text:'当前课程来源待核对'}
 const feedback=own.filter(e=>e.action==='FEEDBACK').at(-1)?.feedback??null
 const oldFacts=proposal.decision.input.snapshot.facts,currentFacts=new Map(d.input.snapshot.facts.map(f=>[f.id,f]))
 const corrected=oldFacts.some(f=>{
  const now=currentFacts.get(f.id)
  return !now||canonical(now)!==canonical(f)
 })
 const oldSource=JSON.parse(proposal.decision.source),newSource=JSON.parse(d.source)
 const purposeRevised=canonical(oldSource.goal)!==canonical(newSource.goal)||canonical(oldSource.profile)!==canonical(newSource.profile)||canonical(oldSource.training)!==canonical(newSource.training)
 const planShape=(e:ScheduleEntry)=>{const {actual:_a,status:_s,restLog:_r,...other}=e;return other}
 const planRevised=status==='ACCEPTED'&&entry&&canonical(planShape(entry))!==canonical(planShape(proposal.candidate.after))
 const reasons:string[]=[]
 if(corrected)reasons.push('当时依赖的实际记录已更正、撤回、发生版本冲突或当前窗口无法核对。')
 if(purposeRevised)reasons.push('当时使用的目标、档案或训练约束已修订。')
 if(d.knowledgeVersion!==proposal.decision.knowledgeVersion)reasons.push('知识来源、审批状态或决策规则已变化。')
 if(planRevised)reasons.push('课程后来被重新安排，旧选择不能继续说明当前计划。')
 const withdrawn=reasons.length>0
 const adverse=!!actual&&(actual.outcome==='missed'||actual.executionState==='PARTIAL'||actual.executionState==='INTERRUPTED'||actual.reasons.length>0||(actual.rpe??0)>=9||actual.minutes!==null&&actual.minutes<proposal.candidate.after.minutes)
 if(d.safety.hold)reasons.push('新近疼痛或健康限制要求重新核对；原选择不是训练放行。')
 if(adverse)reasons.push('实际执行中出现中断、未完成、疼痛或吃力等反证。')
 if(feedback?.outcome==='WORSE')reasons.push('用户报告结果更差；需同时核对条件变化，不能确定原因。')
 if(d.input.recovery?.signalState==='RECOVERY_CONCERN'||d.history.planning.reviewExecution)reasons.push('新增恢复或可比较训练表现提示复核，削弱原安排的适用性。')
 const supported=actual?.outcome==='as_planned'&&actual.minutes!==null&&actual.minutes>=proposal.candidate.after.minutes&&actual.intensity===proposal.candidate.after.intensity&&!actual.reasons.length&&execution.state==='COMPLETED'
 const state:R6Reassessment['state']=status!=='ACCEPTED'?'PENDING':withdrawn?'WITHDRAWN':reasons.length?'WEAKENED':supported?'SUPPORTED':'PENDING'
 const message=state==='WITHDRAWN'?'原依据或适用条件已修订，撤回旧判断的当前适用性；原判断、实际与修订链保留。':state==='WEAKENED'?'新反证削弱这次安排，先复核原因和条件，再生成新的待确认候选。':state==='SUPPORTED'?'记录支持本次安排的可执行性；不能证明长期增益、恢复完成或因果关系。':status==='REJECTED'?'用户已取消；未执行这次选择。':execution.state==='DEFERRED'?'已暂缓，等待恢复观察和另一次明确重排确认。':'等待可核对的执行与结果；缺记录不视为失败。'
 const reassessment:R6Reassessment={state,message,reasons,basis:analysisDigest([state,reasons,actual,feedback,execution,d.knowledgeVersion,oldFacts.map(f=>currentFacts.get(f.id)??null)])}
 const cycleLinks=readCycleDocuments().filter(c=>c.status==='ACCEPTED'&&Date.parse(c.history.at(-1)?.at??'')<=Date.parse(d.asOf)).slice(0,2).map(c=>c.feedback?.message).filter((x):x is string=>!!x)
 const outcome={text:[actual?`实际${actual.minutes??'未知'}分钟，RPE ${actual.rpe??'未记录'}${actual.note?'；'+actual.note:''}`:'实际结果尚未记录。',feedback?`用户反馈：${({BETTER:'更好',UNCHANGED:'相近',WORSE:'更差',UNKNOWN:'尚不清楚'} as const)[feedback.outcome]}；${feedback.note}`:'',...cycleLinks].filter(Boolean).join(' '),actual,feedback}
 return {id:proposal.id,proposal,status,acceptedAt:accepted?.at??receipt?.at??null,execution,outcome,reassessment,events:own.map(e=>({at:e.at,action:e.action,detail:e.detail})).concat(receipt&&!accepted?[{at:receipt.at,action:'ACCEPTED',detail:'从日历同笔写入回执恢复确认状态。'}]:[])}
}
export async function readR6History(day=localDay(),asOf=new Date().toISOString()):Promise<R6HistoryRow[]> {
 if(!r5ScopeReady())return []
 const d=await readR6Decision(day,asOf),rows=events(asOf)
 const proposals=rows.flatMap(e=>e.action==='PROPOSED'&&e.proposal?[e.proposal]:[])
 const results=proposals.map(p=>reviewRow(p,rows,d)).sort((a,b)=>b.proposal.createdAt.localeCompare(a.proposal.createdAt))
 // Append only a new reassessment. Never rewrite what was known or said at decision time.
 for(const row of results.filter(x=>x.status==='ACCEPTED')){
  const previous=rows.filter(e=>e.proposalId===row.id&&e.action==='REASSESSED').at(-1)
  if(previous?.reassessment?.basis!==row.reassessment.basis){
   if(currentAthleteId()!==d.athleteId||sourceAt(day,asOf)!==d.source)throw Error('资料变化，复核记录尚未保存。')
   if(!append({proposalId:row.id,at:asOf,action:'REASSESSED',detail:row.reassessment.message,reassessment:row.reassessment}))throw Error('复核历史保存失败，原课表保留。')
   row.events.push({at:asOf,action:'REASSESSED',detail:row.reassessment.message})
  }
 }
 return results
}
export async function recordR6Feedback(decisionId:string,feedback:R6Feedback,now=new Date().toISOString()) {
 const owner=currentAthleteId()
 if(!feedback||!['BETTER','UNCHANGED','WORSE','UNKNOWN'].includes(feedback.outcome)||typeof feedback.note!=='string'||feedback.note.length>1000||!exactTime(now)||Date.parse(now)>Date.now())return fail('反馈字段或时间无效。')
 return (await withScheduleLock(()=>{
  requireR5Scope();if(currentAthleteId()!==owner)return fail('身份已变化。')
  const p=storedProposal(decisionId,now)
  if(!p||!events(now).some(e=>e.proposalId===decisionId&&e.action==='ACCEPTED')&&!scheduleReceipt(decisionId,now))return fail('没有当前用户已确认的这次决定。')
  if(!append({proposalId:decisionId,at:now,action:'FEEDBACK',detail:'新增用户结果反馈；不改写任何原始训练事实。',feedback:{...feedback,note:feedback.note.trim()}}))return fail('反馈保存失败。')
  changed();return {ok:true as const,message:'反馈已保留，下一次读取将重新核对原判断。'}
 })).value
}
/** Read-only coach wording. No tool/model result can invoke calendar writes. */
export function r6DecisionText(d:R6Decision):string {
 return [d.explanation,...d.history.observations.slice(0,2).map(x=>x.text),...d.candidates.map(c=>`${c.option} ${c.title}：${c.reason}${c.canConfirm?'（待用户确认）':'（当前不可执行：'+c.blockedReasons.join('；')+'）'}`),...d.missing.slice(0,3)].join('\n')
}
