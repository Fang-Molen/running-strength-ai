/** Facts -> explanations -> observations -> conditional candidates. No plan writer. */
import { savedSessionAu, calculateLoadTrend, formatLoadTrend, type SavedSessionLoad, type LoadDayConfirmation } from '../core/coach-load-metrics'
import { quantifyRecoverySnapshot } from './recovery-quantitative'
import { reviewFatigue } from './analysis'
import type { HealthSnapshot } from './snapshot'
import type { Checkin } from './legacy-inputs'
import { detectRedFlags } from '../core/coach-red-flags'
import { shortHash, shiftDay } from './observation'
export type DecisionEvidence={id:string;text:string;sourceIds:string[];kind:'ACTUAL'|'DESCRIPTIVE'|'SELF_REPORT'|'GAP'}
export type DecisionExplanation={id:string;possibility:string;support:string[];against:string[];missing:string[];observe:string;supportsWhen:string;weakensWhen:string;status:'PENDING'}
export type DecisionOption={kind:'KEEP'|'ADJUST'|'DEFER'|'PROFESSIONAL';available:boolean;why:string;conditions:string[];doNotExecute:string[];automatic:false}
export type EvidenceDecisionInput={athleteId:string;day:string;asOf:string;offset:number;snapshot:HealthSnapshot;checkin:Checkin|null;sessions:SavedSessionLoad[];coverage:LoadDayConfirmation[];muscle:{text:string;sourceIds:string[];unreadable:boolean;revision:string;hasPain:boolean};nutrition:{count:number;kcal:number;pending:number;complete?:boolean};question?:string;returnPermission?:'REQUIRED'|'GRANTED'|'UNKNOWN'}
export function buildEvidenceDecision(i:EvidenceDecisionInput){
 const evidence:DecisionEvidence[]=[],missing:string[]=[],conflicts:string[]=[]
 const q=quantifyRecoverySnapshot({snapshot:i.snapshot,athleteId:i.athleteId,asOf:i.asOf,calendarOffsetMinutes:i.offset})
 for(const f of q.facts)evidence.push({id:`recovery:${f.metric}`,text:f.metric==='SLEEP'?f.text.replace(/(\d+(?:\.\d+)?) h/,(_,h)=>{const mins=Math.round(Number(h)*60);return `${Math.floor(mins/60)}小时${mins%60}分（${h} h）`}):f.text,sourceIds:f.sourceIds,kind:f.quality==='SELF_REPORT_RANGE'?'SELF_REPORT':'DESCRIPTIVE'})
 missing.push(...q.missing)
 conflicts.push(...i.snapshot.metrics.filter(m=>m.state==='CONFLICT').map(m=>`${m.label}来源冲突，未选择较好值`))
 const sessions=i.sessions.filter(s=>s.athleteId===i.athleteId&&s.day>=shiftDay(i.day,-6)&&s.day<=i.day)
 // Even a repeated identity cannot contribute two or inconsistent quantities.
 for(const id of new Set(sessions.map(s=>s.id))){const rows=sessions.filter(s=>s.id===id),s=rows[0]
  if(new Set(rows.map(r=>JSON.stringify([r.day,r.minutes,r.sessionRpe,r.revision]))).size!==1){conflicts.push(`训练 ${id} 版本冲突`);continue}
  const au=savedSessionAu(s)
  if(au===null||!s.sourceIds.length){missing.push(`训练 ${id} 缺整课实际时长、整课RPE或来源；未补零`);continue}
  evidence.push({id:`load:${id}`,text:`${s.day} 整课实际 ${Number(s.minutes!.toFixed(2))} min × session RPE ${s.sessionRpe} = ${Number(au.toFixed(2))} AU。`,sourceIds:s.sourceIds,kind:'DESCRIPTIVE'})
 }
 const trend=calculateLoadTrend({athleteId:i.athleteId,endDay:i.day,sessions:i.sessions,confirmations:i.coverage})
 evidence.push({id:'load:trend',text:formatLoadTrend(trend),sourceIds:trend.sourceIds,kind:trend.status==='AVAILABLE'?'DESCRIPTIVE':'GAP'})
 if(i.muscle.text)evidence.push({id:'muscle:current',text:i.muscle.text,sourceIds:i.muscle.sourceIds,kind:i.muscle.unreadable?'GAP':'ACTUAL'})
 for(const v of i.snapshot.metrics.filter(v=>['STEPS','ACTIVE_KCAL','RESTING_KCAL','TOTAL_KCAL','WORKOUT_KCAL'].includes(v.metric))){
  if(v.state==='AVAILABLE'&&v.current&&Date.parse(v.current.updatedAt)<=Date.parse(i.asOf))evidence.push({id:'daily:'+v.metric,text:`${v.label} ${v.current.value} ${v.metric==='STEPS'?'步':'kcal'} · ${v.current.statistic}；${v.current.source}。`,sourceIds:[v.current.id],kind:'DESCRIPTIVE'})
 }
 if(evidence.some(e=>e.id.startsWith('daily:')))missing.push('日常步数和不同热量口径分别保留，不能与训练AU相加；未佩戴时段未知')
 const n=i.nutrition
 if(n.count)evidence.push({id:'nutrition:recorded',text:`${i.day} 饮食已记录 ${n.count} 条，已知 ${Number(n.kcal.toFixed(1))} kcal，${n.pending} 条能量未知。`,sourceIds:[`nutrition:${i.day}`],kind:'ACTUAL'})
 if(!n.complete||n.pending)missing.push('全天饮食完整性或能量口径未确认，不能据此判断热量缺口、REDs或建议减重')
 const fatigue=reviewFatigue({...i.snapshot,metrics:i.snapshot.metrics.map(v=>({...v,baseline:null,current:v.current&&Date.parse(v.current.updatedAt)<=Date.parse(i.asOf)?v.current:null}))},i.checkin),danger=detectRedFlags(i.question??'')
 const urgent=['EMERGENCY','URGENT_MEDICAL'].includes(danger.level)
 const pain=i.muscle.hasPain||i.checkin?.pain==='sharp'||i.checkin?.pain==='mild'
 const medical=urgent||danger.level==='MEDICAL_REVIEW'||pain||i.returnPermission==='REQUIRED'
 const hypotheses:DecisionExplanation[]=[]
 if(!urgent&&(fatigue.signals.length||sessions.length)){
  hypotheses.push({id:'training-response',possibility:'近期训练负荷可能与当前感受有关，尚不能确认因果',support:[...evidence.filter(e=>e.id.startsWith('load:')&&e.kind!=='GAP').map(e=>e.id),...fatigue.signals.filter(s=>s.domain==='SUBJECTIVE').flatMap(s=>s.sourceIds)],against:['整课AU只描述负荷；训练目的、近期疲劳或测量条件都可能不同','若同协议课程表现稳定且主观恢复良好，会削弱这一解释'],missing:['同协议课程的实际表现、原计划目的、功能反馈'],observe:'下一次已有批准且无痛的同协议课程，保留分段/组次与休息，记录整课RPE及次日感受；不新增测试剂量。',supportsWhen:'可比条件下相同任务更费力，并且连续新证据一致',weakensWhen:'记录更正后差异消失，或同协议表现和主观反馈稳定',status:'PENDING'})
  hypotheses.push({id:'measurement-context',possibility:'睡眠、测量条件或非训练生活负担也可能解释这些变化',support:q.facts.map(f=>`recovery:${f.metric}`),against:['单一HRV或睡眠变化不能证明恢复不良','若同设备同协议复测仍一致，而生活条件不变，此解释减弱'],missing:['测量时段、设备协议、工作压力及睡眠记录完整性'],observe:'先核对来源与时区，再在原来的同设备同协议下记录下一次读数和当天感受；不为验证而增加训练。',supportsWhen:'纠正设备/测量条件后变化消失，或生活变化与感受同步',weakensWhen:'可比测量稳定而训练表现持续变化',status:'PENDING'})
 }
 const noGo=medical?['疼痛、功能下降或医学回归许可未完成时，不执行训练候选']:['出现胸痛、晕厥、呼吸困难或急性疼痛时停止执行并寻求专业帮助']
 const options:DecisionOption[]=[
  {kind:'KEEP',available:!medical,why:'缺少证据不能证明需要改变原计划；保持是有条件选项，不是已确认恢复',conditions:['原课已获批准','当前无痛且原有安全边界允许','先核对热身和实际反馈'],doNotExecute:noGo,automatic:false},
  {kind:'ADJUST',available:!medical,why:'只有训练目的和有效新证据支持时，才比较调整顺序或单一变量',conditions:['教练/用户确认具体变更','保留原目的与全部训练结构','不自动加量，不凭ACWR或单一HRV减量'],doNotExecute:[...noGo,'缺少批准课程或训练剂量时仅记录观察任务'],automatic:false},
  {kind:'DEFER',available:true,why:medical?'先核对疼痛、其他症状和功能，暂缓诱发疼痛的内容':'关键事实冲突或未确认时，暂缓作出改课决定',conditions:[medical?'不通过加速或负重试探疼痛':'补齐最重要的缺失信息后再复核'],doNotExecute:['不能把暂缓判断自动写成停训课表'],automatic:false},
  {kind:'PROFESSIONAL',available:medical,why:urgent?'当前危险症状优先：停止运动并及时寻求急救或医疗评估':pain?'疼痛不能被正常设备指标抵消':'伤后回归许可或医学限制需相应专业评估',conditions:['保留症状时间、部位及功能变化'],doNotExecute:['AI不能签发医学回归许可'],automatic:false},
 ]
 const result={version:'EVIDENCE_DECISION_1',athleteId:i.athleteId,day:i.day,asOf:i.asOf,evidence,hypotheses,missing:[...new Set(missing)],conflicts,options,safety:urgent?'URGENT':medical?'REVIEW':'NO_CLEARANCE',fatigueRuleStatus:'RESEARCH_CANDIDATE',planChanged:false as const,automaticPrescription:false as const,revision:''}
 result.revision='decision:'+shortHash(JSON.stringify([i.athleteId,i.day,evidence,hypotheses,result.missing,conflicts,options,i.muscle.revision]))
 return result
}
export type EvidenceDecision=ReturnType<typeof buildEvidenceDecision>
export function evidenceDecisionText(d:EvidenceDecision){
 const lines=[...(d.safety==='URGENT'?['当前症状需要优先停止运动并及时寻求急救或医疗评估。']:[]),'本次事实：',...d.evidence.map(e=>e.text),'可能解释：',...d.hypotheses.flatMap(h=>[h.possibility,`支持依据：${h.support.join('、')||'缺少，仍待验证'}。反证/替代解释：${h.against.join('；')}`,`下一次观察：${h.observe}`,`支持判断的结果：${h.supportsWhen}；削弱判断的结果：${h.weakensWhen}`]),`当前不确定性：${[...d.conflicts,...d.missing].slice(0,8).join('；')||'现有记录不能确认因果关系'}`,'调整选项：',...d.options.filter(o=>o.available).map(o=>`${({KEEP:'保持',ADJUST:'调整',DEFER:'暂缓',PROFESSIONAL:'专业评估'} as const)[o.kind]}：${o.why}；条件：${o.conditions.join('、')}；不执行条件：${o.doNotExecute.join('、')}。`),'没有自动修改训练计划，也不把单项设备指标当作训练许可。']
 return lines.join('\n')
}
