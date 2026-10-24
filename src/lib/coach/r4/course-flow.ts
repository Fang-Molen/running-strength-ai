import {currentAthleteId} from '../../core/events'
import {currentStore} from '../../core/storage'
import {loadSchedule,readScheduleDocument,saveSchedule} from '../../ui/day-schedule'
import {withScheduleLock} from '../../ui/schedule-writer'
import type {ScheduleEntry} from '../../ui/day-schedule-rules'
import {isR4CourseCandidate,r4CourseStarted as started} from './courses'
import {planDocumentKey,activePlanDoc} from '../../plan/active-plan'
import {v4ScheduleId} from '../../ui/v4-effective-move'
import {analysisDigest} from '../../health/analysis-evidence'
import {localDay} from '../../health/observation'
import {readR4CoachAnswer} from './answer'

type Pair={before:ScheduleEntry;after:ScheduleEntry}
export type CourseChangeOrigin='COACH_REFERENCE'|'USER_CALENDAR'
export type R4CourseProposal=Pair&{id:string;athleteId:string;question:string;kind:'MOVE'|'SWAP';origin:CourseChangeOrigin;reason:string;second?:Pair;createdAt:string;expiresAt:string;sourceVersion:string;basisVersion:string;planVersion:string|null;diff:string}
type Receipt=Pair&{id:string;athleteId:string;kind:'R4_MOVE'|'R4_SWAP'|'R4_UNDO';at:string;proposalId:string;reason?:string;second?:Pair}
const validDay=(day:string)=>/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day+'T00:00:00Z'))&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day
const fail=(reason:string)=>({ok:false as const,reason})
function snapshot(question:string,origin:CourseChangeOrigin){
 const answer=readR4CoachAnswer(question)
 if(!answer)throw Error('当前课程依据无法读取，请重新打开日历')
 if(origin==='COACH_REFERENCE'&&(answer.conditions.population!=='healthy_adult'||!answer.conditions.profile))throw Error('请先核对并保存成人健康筛查与训练条件')
 if(['HOLD_ACTIVE','ESCALATION_REQUIRED'].includes(answer.safety))throw Error('当前安全限制需复核，调整日期不能解除限制')
 const read=readScheduleDocument();if(!read.ok)throw Error(read.reason)
 const planRaw=currentStore()?.getItem(planDocumentKey())??null
 if(planRaw&&!activePlanDoc(currentStore()))throw Error('已保存周期计划无法完整读取，不能当作空日历')
 return {answer,read,planRaw,entries:loadSchedule().entries}
}
/** Both dates are changed in one canonical document. The original plan and all
 * course dose parameters remain unchanged; a swap is never two separate saves. */
export function previewR4CourseMove(question:string,id:string,toDate:string,reason='用户调整日期',origin:CourseChangeOrigin='COACH_REFERENCE'):R4CourseProposal{
 if(!['COACH_REFERENCE','USER_CALENDAR'].includes(origin))throw Error('调整来源无效')
 const s=snapshot(question,origin),owner=currentAthleteId(),before=s.entries.find(e=>e.id===id),today=localDay()
 if(!before||s.entries.filter(e=>e.id===id).length!==1||!isR4CourseCandidate(before))throw Error('只可调整归属明确、结构完整且未开始的已保存课程')
 if(!validDay(toDate)||toDate<today||toDate===before.date)throw Error('请选择今天或未来的不同日期')
 const why=reason.trim();if(!why||why.length>160)throw Error('请填写160字以内的调整原因')
 const active=s.entries.filter(e=>!['rejected','skipped'].includes(e.status)&&e.modality!=='rest')
 const targets=active.filter(e=>e.id!==id&&e.date===toDate)
 if(targets.length>1)throw Error('目标日期有多节训练，需先核对；不会自动叠加或移动其他课程')
 const other=targets[0]
 if(other&&(!isR4CourseCandidate(other)||before.date<today))throw Error('对调双方都须是今天或未来、未开始且未完成的完整课程')
 const move=(e:ScheduleEntry,date:string)=>({...e,date,movedFrom:e.movedFrom??e.date})
 const pairs:Pair[]=[{before,after:move(before,toDate)},...(other?[{before:other,after:move(other,before.date)}]:[])]
 const ids=new Set(pairs.map(p=>p.before.id)),remaining=active.filter(e=>!ids.has(e.id)),profile=s.answer.conditions.profile
 const imported=activePlanDoc(currentStore())?.plan.days??[]
 for(const pair of pairs){
  const date=pair.after.date
  if(profile&&!profile.days.includes(new Date(date+'T12:00:00').getDay()))throw Error(`${date} 不在已确认的可训练日内，请先核对时间`)
  if(profile&&pair.after.minutes>profile.minutes)throw Error(`${pair.before.title} 超过已确认的单次时间；不会自动压缩课程`)
  if(remaining.some(e=>e.date===date))throw Error('调整后与其他课程同日冲突，请重新选择')
  if(imported.some(d=>d.date===date&&!/休息/.test(d.title)&&!pairs.some(p=>p.before.id===v4ScheduleId(d.date))))throw Error('目标日期有导入计划中的其他训练，请先核对；不会覆盖原课表')
  const neighbours=[...remaining,...pairs.filter(p=>p!==pair).map(p=>p.after)]
  if(neighbours.some(e=>Math.abs(Date.parse(e.date)-Date.parse(date))<=86400000&&(pair.after.intensity==='HARD'||pair.after.lowerHeavy)&&(e.intensity==='HARD'||e.lowerHeavy)))throw Error('调整后相邻日期存在关键课或下肢负担冲突，请选择其他安排')
 }
 const createdAt=new Date().toISOString(),kind=other?'SWAP' as const:'MOVE' as const
 return {id:crypto.randomUUID(),athleteId:owner,question,origin,reason:why,kind,createdAt,expiresAt:new Date(Date.now()+15*60000).toISOString(),sourceVersion:analysisDigest(s.read.value),basisVersion:s.answer.basisVersion,planVersion:s.planRaw,...structuredClone(pairs[0]),...(pairs[1]?{second:structuredClone(pairs[1])}:{}),
  diff:pairs.map(p=>`${p.before.title}：${p.before.date} → ${p.after.date}`).join('\n')+`\n原因：${why}。保留全部动作、组次、重量、休息和时长；只调整日期，不记录完成。`+(!profile?'\n当前可训练日与单次时间尚未确认，请自行核对；这次是你主动调整既有课程。':'')}
}
export async function confirmR4CourseMove(proposal:R4CourseProposal,confirmation:string){
 if(confirmation!=='CONFIRM_THIS_CHANGE')return fail('未确认，日历未修改')
 if(typeof navigator==='undefined'||!navigator.locks?.request)return fail('当前浏览器无法协调确认写入，日历未修改')
 return (await withScheduleLock(()=>{
  try{
   const s=snapshot(proposal.question,proposal.origin)
   if(!proposal.id||!Number.isFinite(Date.parse(proposal.createdAt))||!Number.isFinite(Date.parse(proposal.expiresAt))||Date.parse(proposal.expiresAt)-Date.parse(proposal.createdAt)!==15*60000)return fail('预览回执无效，请重新预览')
   if(currentAthleteId()!==proposal.athleteId||Date.now()>Date.parse(proposal.expiresAt)||Date.now()<Date.parse(proposal.createdAt)||analysisDigest(s.read.value)!==proposal.sourceVersion||s.answer.basisVersion!==proposal.basisVersion||s.planRaw!==proposal.planVersion)return fail('个人条件、记录或日历已变化，请重新预览')
   const fresh=previewR4CourseMove(proposal.question,proposal.before.id,proposal.after.date,proposal.reason,proposal.origin)
   const content=(p:R4CourseProposal)=>[p.kind,p.origin,p.reason,p.before,p.after,p.second??null]
   if(analysisDigest(content(fresh))!==analysisDigest(content(proposal)))return fail('课程内容已变化，请重新预览')
   const pairs=[proposal,...(proposal.second?[proposal.second]:[])],changed=new Map(pairs.map(p=>[p.before.id,p.after]))
   const receipt:Receipt={id:crypto.randomUUID(),athleteId:proposal.athleteId,kind:proposal.kind==='SWAP'?'R4_SWAP':'R4_MOVE',at:new Date().toISOString(),before:proposal.before,after:proposal.after,proposalId:proposal.id,reason:proposal.reason,...(proposal.second?{second:proposal.second}:{})}
   if(!saveSchedule({...loadSchedule(),entries:s.entries.map(e=>changed.get(e.id)??e)},'plan-execution',receipt))return fail('本机写入未核实，未报告成功；请刷新核对')
   return {ok:true as const,receipt,message:proposal.kind==='SWAP'?'两节课已一次性对调，内容未改变；调整原因与前后日期已保留。':'已保存到本机日历，原训练参数保留；尚未开始训练。'}
  }catch(e){return fail(e instanceof Error?e.message:'日历核对失败')}
 })).value
}
export async function undoR4CourseMove(proposalId:string,confirmation:string){
 if(confirmation!=='UNDO_THIS_CHANGE')return fail('未确认撤销')
 if(typeof navigator==='undefined'||!navigator.locks?.request)return fail('当前浏览器无法协调撤销写入')
 return (await withScheduleLock(()=>{
  try{
   const read=readScheduleDocument();if(!read.ok)return fail(read.reason)
   const receipts=(read.value as typeof read.value&{r4Receipts?:Receipt[]}).r4Receipts
   if(!Array.isArray(receipts))return fail('未找到可核对的本机回执')
   const original=receipts.find(r=>r&&r.proposalId===proposalId&&['R4_MOVE','R4_SWAP'].includes(r.kind)&&r.athleteId===currentAthleteId())
   if(!original||receipts.some(r=>r&&r.proposalId===proposalId&&r.kind==='R4_UNDO'))return fail('该调整不存在或已经撤销')
   const pairs=[original,...(original.second?[original.second]:[])],current=loadSchedule(),ids=new Set(pairs.map(p=>p.before.id))
   for(const pair of pairs){
    if(!pair.before||!pair.after||(pair.before.athleteId??'local')!==currentAthleteId()||(pair.after.athleteId??'local')!==currentAthleteId()||pair.before.id!==pair.after.id)return fail('回执归属或课程标识无效')
    const entry=current.entries.find(e=>e.id===pair.after.id)
    if(!entry||analysisDigest(entry)!==analysisDigest(pair.after)||started(entry))return fail('课程已改变或开始，不能覆盖新记录')
    if(current.entries.some(e=>!ids.has(e.id)&&e.date===pair.before.date&&!['rejected','skipped'].includes(e.status)&&e.modality!=='rest'))return fail('原日期已有新的训练安排，撤销前需核对冲突')
   }
   const restore=new Map(pairs.map(p=>[p.before.id,p.before]))
   const receipt:Receipt={id:crypto.randomUUID(),athleteId:currentAthleteId(),kind:'R4_UNDO',at:new Date().toISOString(),before:original.after,after:original.before,proposalId,reason:'用户撤销调整',...(original.second?{second:{before:original.second.after,after:original.second.before}}:{})}
   return saveSchedule({...current,entries:current.entries.map(e=>restore.get(e.id)??e)},'plan-execution',receipt)?{ok:true as const,receipt,message:'已撤销本次日期调整；调整与撤销历史均保留。'}:fail('撤销保存未核实，请刷新核对')
  }catch{return fail('调整回执无法完整读取，未覆盖日历')}
 })).value
}
