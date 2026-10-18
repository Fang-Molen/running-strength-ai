import { loadCoachPlanCandidates } from './coach-plan.ts'
import { loadProfile } from '../strength/profile.ts'
import { loadVitals, type VitalRecord } from '../nutrition/vitals.ts'
import { loadSportGoal, sportLabel, goalLabel } from '../ui/sport-goal.ts'
import { validReading, type DeviceConfirmed } from './device-image-evidence.ts'
import { strictIso } from './coach-v4-c11-adapter.ts'
import type { CoachBrief } from './coach-brief.ts'
import { readFieldworkCoachSources } from './coach-fieldwork-context.ts'
export type LinkedSource = NonNullable<CoachBrief['sources']>[number]

export function vitalCoachSources(records:readonly VitalRecord[],asOf:string):LinkedSource[] {
 const visible=records.filter(r=>strictIso(r.createdAt)&&Date.parse(r.createdAt)<=Date.parse(asOf)&&r.observedOn<=asOf.slice(0,10)&&Number.isFinite(r.value)).slice(-30)
 const sources:LinkedSource[]=visible.map(r=>({id:`linked:vital:${r.id}`,kind:'CONTEXT',detail:`身体记录 ${r.observedOn} ${r.observedAt??'时刻未知'}：${r.kind} ${r.value}${r.unit}；设备 ${r.deviceLabel??'未知'}；方法 ${r.hrvMethod??r.measurementMethod??'未知'}；${r.source}；不是所选训练当时或当前恢复的证明`}))
 const groups=new Map<string,VitalRecord[]>()
 for(const r of visible){
  const method=r.kind==='HRV'?r.hrvMethod:r.measurementMethod
  if(!['HRV','RHR'].includes(r.kind)||!r.deviceLabel||!method||method==='UNSPECIFIED'||!r.observedAt)continue
  const key=JSON.stringify([r.kind,r.deviceLabel,method,r.observedAt,r.source]);groups.set(key,[...(groups.get(key)??[]),r])
 }
 for(const group of groups.values()){
  const sorted=[...group].sort((a,b)=>a.observedOn.localeCompare(b.observedOn))
  if(sorted.length<2||new Set(sorted.map(r=>r.observedOn)).size!==sorted.length)continue
  const first=sorted[0],last=sorted.at(-1)!
  sources.push({id:`linked:trend:${last.id}`,kind:'CONTEXT',detail:`相同设备、方法、时刻的${last.kind}已记录观察：${first.observedOn} ${first.value}${first.unit} → ${last.observedOn} ${last.value}${last.unit}（${sorted.length}天记录）；来源 ${sorted.map(r=>r.id).join('、')}；不是连续完整趋势或恢复、疾病诊断`})
 }
 return sources.map(s=>({...s,detail:s.detail.slice(0,300)}))
}
export function readLinkedCoachSources(asOf=new Date().toISOString(),question=''):LinkedSource[] {
 const sources:LinkedSource[]=[]
 const goal=loadSportGoal(),profile=loadProfile()
 sources.push({id:'linked:goal-preference',kind:'CONTEXT',detail:`运动偏好/目标：${sportLabel(goal.sport)}；${goalLabel(goal.primaryGoal)}；不是成绩事实`})
 for(const [i,m] of profile.marks.entries())if(m.goal)sources.push({id:`linked:goal:${i}`,kind:'CONTEXT',detail:`目标 ${m.meters}米，目标时间 ${m.goal}，期限 ${m.deadline||'未知'}；不是实际完成成绩`})
 for(const p of loadCoachPlanCandidates().filter(p=>p.status==='ACCEPTED'&&strictIso(p.createdAt)&&Date.parse(p.createdAt)<=Date.parse(asOf)).slice(-2)){
  sources.push({id:`linked:plan:${p.candidateId}`,kind:'CONTEXT',detail:`已接受的候选方向，尚未应用课表：${p.candidate.horizonWeeks}周；${p.candidate.firstWeek.map(s=>`第${s.day}天 ${s.title} ${s.prescription}`).join('；')}`.slice(0,300)})
 }
 const vitals=loadVitals()
 if(vitals.unreadable)sources.push({id:'linked:vitals-unreadable',kind:'CONTEXT',detail:'身体指标读取失败，不能当作没有记录或恢复正常'})
 else sources.push(...vitalCoachSources(vitals.records,asOf))
 sources.push(...readFieldworkCoachSources(question,asOf))
 return sources.slice(-40)
}
/** Only confirmed readings enter read-only context. Original image and raw OCR text never enter a request. */
export function deviceCoachSources(records:readonly DeviceConfirmed[],asOf:string):LinkedSource[]{
 return records.filter(r=>r.consent==='USER_CONFIRMED'&&strictIso(r.confirmedAt)&&strictIso(r.recordedAt)&&Date.parse(r.confirmedAt)<=Date.parse(asOf)&&Date.parse(r.recordedAt)<=Date.parse(r.confirmedAt)).slice(0,5)
  .flatMap(r=>r.readings.filter(validReading).slice(0,8).map(v=>({id:`linked:device:${r.id}:${v.id}`.slice(0,120),kind:'CONTEXT' as const,detail:`设备证据 ${r.deviceLabel}；发生 ${r.recordedAt}；确认 ${r.confirmedAt}；${v.metric} ${v.value}${v.unit}；${v.details?JSON.stringify(v.details):''}；测量方法/所属课次未核实，仅作记录观察，不能推断生理解耦或当前恢复`.slice(0,300)})))
}
export function attachLinkedSources(brief:CoachBrief,sources:LinkedSource[]):CoachBrief {
 const all=[...(brief.sources??[]).filter(s=>!sources.some(n=>n.id===s.id)),...sources].slice(0,100)
 return {...brief,sources:all,sourceIds:all.map(s=>s.id)}
}
export function linkedContextText(brief:CoachBrief):string {
 if(!/心率|HRV|RHR|设备|截图|目标|计划|课表|待练|草稿|安排|营养|饮食|餐|摄入|体重|腰围|实测|体型/i.test(brief.question))return ''
 const sources=(brief.sources??[]).filter(s=>s.kind==='CONTEXT'&&s.id.startsWith('linked:')).filter(s=>
  /心率|HRV|RHR|设备|截图/i.test(brief.question)?/linked:(vital|trend|device)/.test(s.id):/linked:(goal|plan|fieldwork|measurement|meal)/.test(s.id))
 return sources.length?'\n相关只读记录（不自动绑定为本课事实）：\n'+sources.slice(-8).map(s=>s.detail).join('\n'):''
}
