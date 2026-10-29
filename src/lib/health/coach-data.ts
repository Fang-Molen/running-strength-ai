import { readEvidenceDecision } from './evidence-decision-host'
import { bodyCaptureContext } from './body-capture-context'
import { evidenceDecisionText } from './evidence-decision'
import { healthModeSummary } from './mode'
import { loadWatch } from './legacy-inputs'
import { z } from 'zod'
import { loadHealthSnapshot, healthSummaryLine } from './snapshot'
import { reviewFatigue, reviewBalance, dailyCheckin } from './analysis'
import { localDay, shiftDay, validDay, shortHash } from './observation'
import { currentStore } from '../core/storage'
import { aggregate, loadEntries } from '../nutrition/log'
import { coachImports } from '../core/coach-import-evidence'
import { readCurrentImportConflicts } from '../core/current-import-conflicts'
import { currentAthleteId, loadEvents } from '../core/events'
import { occurrenceVoided, listCorrections } from '../core/training-correction'
import { listTrainingOccurrences } from '../core/occurrence'
import { readTrainingFact } from '../core/fact-read'
import { loadCheckins } from './legacy-inputs'
import type { ScheduleEntry } from './legacy-inputs'
import type { CoachBrief } from '../core/coach-brief'
import { readRecoveryProjection, recoveryExplanation } from './recovery-host-u11'

const S=z.string().max(500),N=z.number().finite().nonnegative()
const DataSchema=z.object({
  mode:z.object({mode:z.enum(['pro','basic','none','unset']),label:S,description:S,available:N,conflicts:N,reminder:S}),
  day:z.string().refine(validDay),sourceId:z.string().max(120),
  health:z.array(z.object({metric:z.string().max(30),state:z.enum(['AVAILABLE','CONFLICT','STALE','MISSING']),detail:S})).max(16),
  fatigue:z.object({ruleStatus:z.literal('RESEARCH_CANDIDATE'),automaticPrescription:z.literal(false),state:S,title:S,reasons:z.array(S).max(12),excluded:z.array(S).max(20),action:S,followup:S}),
  balance:z.object({from:z.string().max(10),to:z.string().max(10),plannedRun:N,plannedStrength:N,actualSessions:N,knownMinutes:N,unknownMinutes:N,knownRunKm:N,unknownRunKm:N,groups:z.array(S).max(12),observations:z.array(S).max(20),gaps:z.array(S).max(12),action:S}),
  coreActual:z.object({sessions:N,knownMinutes:N,unknownMinutes:N,sourceIds:z.array(z.string().max(120)).max(100)}),
  nutrition:z.object({count:N,knownKcal:N,pending:N}),
  imports:z.object({count:N,unknownDate:N,latest:z.array(z.object({id:z.string().max(120),day:z.string().max(10),title:z.string().max(120),sport:z.string().max(15),distanceM:N.nullable(),durationSec:N.nullable()})).max(8)}),
  subjective:z.string().max(200),warnings:z.array(S).max(15),planChanged:z.literal(false),
  decision:z.object({revision:z.string(),text:z.string().max(20000),safety:z.enum(['URGENT','REVIEW','NO_CLEARANCE']).optional()}).optional(),
  muscleRecovery:z.object({revision:z.string(),summary:z.string(),explanation:z.string(),hasEvidence:z.boolean(),hasObservedRegions:z.boolean(),unreadable:z.boolean()}).optional()
})
export type CoachDataContext=z.infer<typeof DataSchema>
export function assertCoachData(v:unknown){if(v!=null)DataSchema.parse(v)}
export function analysisDay(question:string,selectedStart:string|null,now=localDay()):string{
  const explicit=question.match(/\b(\d{4}-\d{2}-\d{2})\b/)?.[1]
  if(explicit&&validDay(explicit))return explicit
  if(/昨天/.test(question))return shiftDay(now,-1)
  if(/今天|现在|目前|最近|近期|这周/.test(question))return now
  if(/本次|这次|那次|上次/.test(question)&&selectedStart){const d=new Date(selectedStart);if(Number.isFinite(d.getTime()))return localDay(d)}
  return now
}
function scheduleRows():ScheduleEntry[]{try{const v=JSON.parse(currentStore()?.getItem('fk-schedule-v1')??'null');return Array.isArray(v?.entries)?v.entries.filter((x:any)=>x&&(x.athleteId??'local')===currentAthleteId()&&validDay(x.date)&&typeof x.id==='string'&&['run','strength','rest'].includes(x.modality)&&['proposed','planned','done','skipped','rejected'].includes(x.status)):[]}catch{return []}}
function coreActual(day:string){
 const events=loadEvents(),from=shiftDay(day,-6);
 const rows=listTrainingOccurrences().filter(o=>!occurrenceVoided(o.trainingOccurrenceId)&&o.startedAt&&localDay(new Date(o.startedAt))>=from&&localDay(new Date(o.startedAt))<=day&&o.lifecycle==='COMPLETED'&&events.some(e=>e.event_id===o.startEventId&&e.athlete_id===currentAthleteId())).map(o=>readTrainingFact(o.trainingOccurrenceId)).filter(x=>x!==null);
 return {sessions:rows.length,knownMinutes:rows.reduce((n,r)=>n+(r.duration===null?0:r.duration/60000),0),unknownMinutes:rows.filter(r=>r.duration===null).length,sourceIds:rows.map(r=>r.trainingOccurrenceId).slice(0,100)}
}
function scheduleUnreadable():boolean{
 try{const raw=currentStore()?.getItem('fk-schedule-v1');if(!raw)return false;const v=JSON.parse(raw);return !Array.isArray(v?.entries)||v.entries.some((x:any)=>!x||!validDay(x.date)||typeof x.id!=='string'||!['run','strength','rest'].includes(x.modality)||!['proposed','planned','done','skipped','rejected'].includes(x.status))}catch{return true}
}
/** Current app records as separate daily context, never backfilled into a training occurrence. */
export function readCoachData(day=localDay()):CoachDataContext{
  const snap=loadHealthSnapshot(day),ci=dailyCheckin(day)
  const fatigue=reviewFatigue(snap,ci),balance=reviewBalance(scheduleRows(),day)
  const foods=loadEntries().filter(e=>e.date===day&&(e.athleteId??'local')===currentAthleteId()),agg=aggregate(foods)
  const all=coachImports().filter(i=>!occurrenceVoided(i.confirmedImportId)),unknownDate=all.filter(i=>i.occurredAt.status!=='RECORDED'||!i.occurredAt.value).length
  const imports=all.filter(i=>i.occurredAt.status==='RECORDED'&&i.occurredAt.value&&Number.isFinite(Date.parse(i.occurredAt.value))).map(i=>({i,day:localDay(new Date(i.occurredAt.value!))})).filter(x=>x.day>=shiftDay(day,-27)&&x.day<=day).sort((a,b)=>b.day.localeCompare(a.day))
  const currentConflicts=readCurrentImportConflicts(imports.map(({i})=>i))
  const result:CoachDataContext={mode:healthModeSummary(loadWatch(currentStore()),snap),day,sourceId:`appdata:${day}`,health:snap.metrics.map(v=>({metric:v.metric,state:v.state,detail:healthSummaryLine(v).slice(0,500)})),fatigue:{ruleStatus:fatigue.ruleStatus,automaticPrescription:false,state:fatigue.state,title:fatigue.title,reasons:fatigue.signals.map(s=>s.detail),excluded:fatigue.excluded,action:fatigue.action,followup:fatigue.followup},balance:{from:balance.from,to:balance.to,plannedRun:balance.planned.run,plannedStrength:balance.planned.strength,actualSessions:balance.actual.sessions,knownMinutes:balance.actual.knownMinutes,unknownMinutes:balance.actual.unknownMinutes,knownRunKm:balance.actual.knownRunKm,unknownRunKm:balance.actual.unknownRunKm,groups:balance.planned.muscleGroups,observations:balance.observations.slice(0,20),gaps:balance.gaps,action:balance.action},coreActual:coreActual(day),nutrition:{count:foods.length,knownKcal:agg.kcal.sum,pending:agg.kcal.pending},imports:{count:imports.length,unknownDate,latest:imports.slice(0,8).map(({i,day})=>({id:i.confirmedImportId.slice(0,120),day,title:String(i.title.value??'未命名训练').slice(0,120),sport:i.sport,distanceM:i.totalDistanceMeters.status==='RECORDED'&&!currentConflicts.get(i.confirmedImportId)?.distance&&!listCorrections(i.confirmedImportId).some(c=>c.kind==='FIELD'&&c.field==='distance')?i.totalDistanceMeters.value:null,durationSec:i.durationSeconds.status==='RECORDED'&&!currentConflicts.get(i.confirmedImportId)?.duration&&!listCorrections(i.confirmedImportId).some(c=>c.kind==='FIELD'&&c.field==='duration')?i.durationSeconds.value:null}))},subjective:ci?`当天感受：${({fresh:'轻松',ok:'一般',tired:'很累'} as Record<string,string>)[ci.fatigue??'']??'疲劳未填'}；疼痛：${({none:'不疼',mild:'有点疼',sharp:'明显疼'} as Record<string,string>)[ci.pain??'']??'未填'}；主观恢复：${ci.recovery??'未填'}`:'当天主观感受未记录',warnings:[...(scheduleUnreadable()?['兼容日程无法读取，零汇总不能解释为没有训练']:[]),...(snap.unreadable?['健康存储无法读取；未当作没有健康记录']:[]),'这些为日历日背景，不自动绑定某次训练。','经验阈值尚未科学核准，只作复核提示，不决定减量、停训或医学回归。','已确认导入与日程实际明细可能重叠，分开列示，不重复累加。','导入距离/时长有更正时，日汇总暂不引用旧总量；请进入对应训练核对更正后的明细。','独立截图证据需选择“用于健康分析”后进入健康记录；待核对图片不参与分析。'],planChanged:false}
  result.warnings.push(...new Set([...currentConflicts.values()].map(conflict=>conflict.note)))
  const body=bodyCaptureContext(day)
  if(body.rows.length){
    result.subjective=(ci?`${result.subjective}；`:'')+body.text
    result.sourceId+=':body:'+shortHash(body.rows.map(r=>r.id).join('|'))
  }
  const recovery=readRecoveryProjection(day)
  result.muscleRecovery={revision:recovery.revision,summary:recovery.review.summary,explanation:recoveryExplanation(recovery),
    hasEvidence:recovery.sources.length>0||recovery.review.gaps.length>0,hasObservedRegions:recovery.review.regions.some(r=>r.state!=='UNKNOWN'),unreadable:recovery.unreadable}
  try { const decision=readEvidenceDecision(day);result.decision={revision:decision.revision,text:evidenceDecisionText(decision),safety:decision.safety as 'URGENT'|'REVIEW'|'NO_CLEARANCE'} } catch { result.warnings.push('综合事实复核暂不可用；保留分项记录') }
  result.sourceId+=':'+shortHash(JSON.stringify(result));return result
}
export function dataHasRecords(d:CoachDataContext):boolean{return d.mode.mode!=='unset'||d.warnings.some(x=>x.includes('无法读取'))||d.health.some(x=>x.state!=='MISSING')||d.nutrition.count>0||d.imports.count>0||d.balance.actualSessions>0||d.coreActual.sessions>0||d.balance.plannedRun+d.balance.plannedStrength>0||!d.subjective.includes('未记录')}
export function answerFromAppData(brief:CoachBrief):string|null{
  const q=brief.question,d=brief.appData;if(!d)return null
  // Session-specific reviews and medical triage retain their established routes.
  if(/肌群|肌肉参与|训练反应|肌肉恢复/.test(q) && !/本次|这次|疼|痛|受伤|不舒服|朋友|队友|假设|科普/.test(q) && d.muscleRecovery)
    return `分析日期：${d.day}（本机记录，只读）。\n${d.muscleRecovery.explanation}`
  if(!dataHasRecords(d))return null
  if(/本次|这次|那次|上次|这节|这堂|掉速|分段|配速|组间|大组|休息时间/.test(q))return null
  if(/朋友|队友|假设|举例|案例|他人|科普|解释|原理|是什么|什么意思|疼|痛|受伤|不舒服/.test(q))return null
  const health=/健康|手表|睡眠|hrv|静息|身体电量|疲劳|恢复|健康数据|连接/i.test(q)
  const balance=/均衡|安排|小周期|强度分布|这周|本周|训练结构|训练搭配/.test(q)
  const food=/今天|当天|最近/.test(q)&&/饮食|吃|摄入|热量/.test(q)
  const imports=/最近|近期|导入|手表|记录|数据/.test(q)&&/训练|活动|跑步|数据/.test(q)
  if(!health&&!balance&&!food&&!imports)return null
  if((health||balance)&&d.decision){
    const caution=health&&/很累|特别疲劳|腿沉|睡不够|状态很差/.test(q)?'你这轮提到的新不适或疲劳需优先核对；不能用手表数据抵消你的感受。下文选项均待核对，先暂缓加量，补充发生时间、部位与热身表现。\n':''
    const cycle=balance&&brief.daysToCompetition!=null?`距目标比赛${brief.daysToCompetition}天；结合原计划目的复核，不自动补量。\n`:''
    return `分析日期：${d.day}（本机记录，只读）。\n${caution}${d.decision.text}\n${d.subjective}。证据不足时只作有限解释。\n${cycle}${d.warnings.filter(w=>/无法读取|缓存.*冲突/.test(w)).join('；')}`
  }
  const lines=[`分析日期：${d.day}（本机已保存记录）。`,`${d.mode.label}：${d.mode.description}`]
  if(health){lines.push(...d.health.filter(x=>x.state!=='MISSING'&&['SLEEP','HRV','RHR','BODY_BATTERY','RECOVERY','READINESS'].includes(x.metric)).map(x=>x.detail),d.subjective,`基于已保存记录的判断：${d.fatigue.title}。`,...d.fatigue.reasons,`建议：${d.fatigue.action}`,`跟进：${d.fatigue.followup}`);if(d.fatigue.excluded.length)lines.push(`暂不采用：${d.fatigue.excluded.slice(0,4).join('；')}。`)}
  if(balance){const b=d.balance;lines.push(`近7天（${b.from}—${b.to}）课表：跑步 ${b.plannedRun} 节、力量 ${b.plannedStrength} 节；实际反馈 ${b.actualSessions} 节，已知时长 ${b.knownMinutes} 分钟${b.unknownMinutes?`，另${b.unknownMinutes}节时长未填`:''}。`,`已识别计划肌群：${b.groups.join('、')||'动作信息不足'}。`,...b.observations,...b.gaps,`建议：${b.action}`)}
  if(balance)lines.push(`训练事实层：近7天已完成 ${d.coreActual.sessions} 次，已记录用时 ${Number(d.coreActual.knownMinutes.toFixed(2))} 分钟，${d.coreActual.unknownMinutes} 次用时未知；与导入活动、兼容日程分别列示，未相加。`)
  if((health||balance)&&d.muscleRecovery?.hasEvidence)lines.push(`肌群依据：${d.muscleRecovery.explanation}`)
  if(health||balance)lines.push('阈值状态：研究候选，只作复核提示，不是已验证的训练处方。')
  if(balance&&!health)lines.push(`当天恢复复核：${d.fatigue.title}。${d.fatigue.action}`)
  if(food)lines.push(`${d.day} 饮食 ${d.nutrition.count} 条，已知热量合计 ${Math.round(d.nutrition.knownKcal)} kcal，${d.nutrition.pending} 项热量待补；未确认全天记录完整，不能据此判断吃得不足。`)
  if(imports)lines.push(`近28天已确认导入活动 ${d.imports.count} 条；另有 ${d.imports.unknownDate} 条日期未知未纳入。`,`最近导入：${d.imports.latest.slice(0,3).map(i=>`${i.day} ${i.title}${i.distanceM!=null?` ${i.distanceM}米`:''}${i.durationSec!=null?` ${i.durationSec}秒`:''}`).join('；')||'暂无'}。`,'导入与日程记录可能重叠，未合并计算总负荷。')
  if(imports)lines.push(...d.warnings.filter(w=>/缓存.*冲突/.test(w)))
  if(d.warnings.some(x=>x.includes('无法读取')))lines.push(...d.warnings.filter(x=>x.includes('无法读取')),'无法读取不等于没有问题。')
  if(health&&/很累|特别疲劳|腿沉|睡不够|状态很差/.test(q))lines.push('你这轮提到的新不适或疲劳需优先核对；上面的结果只反映已保存记录，不能用手表数据抵消你的感受。先暂缓加量，补充发生时间、部位与热身表现。')
  if(balance&&brief.daysToCompetition!=null&&brief.daysToCompetition>=0&&brief.daysToCompetition<=28)lines.push(`当前目标距比赛${brief.daysToCompetition}天；需结合参赛项目和原定减量安排，不为补齐肌群或比例临时堆训练。`)
  if(balance&&(brief.bias==='deload'||brief.week===4))lines.push('当前计划标注减量阶段；训练数量暂时不均不自动等于安排错误。')
  lines.push('以上为已有记录支持的复核；没有自动改课，也没有诊断疲劳综合征。')
  return lines.join('\n')
}
