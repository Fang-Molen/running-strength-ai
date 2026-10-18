import {readUIPreferences} from './fangkun-preferences'
import { currentAthleteId } from '../core/events'
import { currentStore } from '../core/storage'
import { listRunningPlans, type RunningPlan } from '../core/running-plan'
import { loadEntries, recordManualFood, eatenAtFromClock } from '../nutrition/log'
import { loadChecks, upsertCheck, todayDate } from '../nutrition/body'
import { loadPlanDrafts, savePlanDraft, removePlanDraft, validDate, type DraftInput } from './fieldwork-plan-drafts'

export const FIELDWORK_LOCALES = ['zh-CN','zh-TW','zh-HK','en-US','ja-JP','ko-KR'] as const
export type FieldworkLocale = typeof FIELDWORK_LOCALES[number]
export type ViewPreferences = { locale: FieldworkLocale; gender: 'male' | 'female'; date: string; goal: 'cut' | 'gain' | 'hold'; scenario: number | null }
const preferencesKey = () => 'fr255-fieldwork-view-v1:' + encodeURIComponent(currentAthleteId())
export function readFieldworkPreferences(): ViewPreferences {
  const initial: ViewPreferences = {locale:'zh-CN',gender:'male',date:todayDate(),goal:'hold',scenario:null}
  try {
    const raw=currentStore()?.getItem(preferencesKey());if(!raw)return initial
    const saved=JSON.parse(raw) as {schema?:number;data?:Partial<ViewPreferences>};if(saved.schema!==1||!saved.data)return initial
    const p=saved.data
    return {locale:FIELDWORK_LOCALES.includes(p.locale!)?p.locale!:initial.locale,gender:p.gender==='female'?'female':'male',date:validDate(p.date)?p.date:initial.date,
      goal:p.goal==='gain'||p.goal==='cut'?p.goal:'hold',scenario:typeof p.scenario==='number'&&Number.isFinite(p.scenario)&&p.scenario>0?p.scenario:null}
  } catch{return initial}
}
export function saveFieldworkPreferences(input: Partial<ViewPreferences>): boolean {
  const old=readFieldworkPreferences(),p={...old,...input}
  if(!FIELDWORK_LOCALES.includes(p.locale)||!['male','female'].includes(p.gender)||!validDate(p.date)||!['cut','gain','hold'].includes(p.goal)||p.scenario!==null&&(!Number.isFinite(p.scenario)||p.scenario<=0))return false
  try{const box=currentStore();if(!box)return false;const raw=JSON.stringify({schema:1,data:{...readUIPreferences(),...p}});box.setItem(preferencesKey(),raw);return box.getItem(preferencesKey())===raw}catch{return false}
}

export function describeFieldworkCourse(plan: RunningPlan) {
  const running=plan.components.filter(c=>c.modality==='RUNNING')
  const descriptions=running.map(c=>c.structure.kind==='CONTINUOUS'
    ? `连续跑：${c.structure.plannedDistanceMeters===null?'距离未知':c.structure.plannedDistanceMeters+'米'}，${c.structure.plannedDurationSeconds===null?'时长未知':c.structure.plannedDurationSeconds+'秒'}`
    : c.structure.blocks.map(b=>`${b.roundCount}个大组；每大组 ${b.steps.map(s=>`${s.repeatCount} × ${s.plannedDistanceMeters===null?'距离未知':s.plannedDistanceMeters+'米'}${s.plannedDurationSeconds===null?'':'（目标'+s.plannedDurationSeconds+'秒）'}；组间休息${s.recoveryAfterRepeatSeconds===null?'未知':s.recoveryAfterRepeatSeconds+'秒'}${s.recoveryBeforeNextStepSeconds===null?'':'；下一步骤前休息'+s.recoveryBeforeNextStepSeconds+'秒'}`).join(' + ')}；大组休息${b.recoveryAfterRoundSeconds===null?'未知':b.recoveryAfterRoundSeconds+'秒'}`).join(' / '))
  const first=running[0],block=first?.structure.kind==='REPEATED'?first.structure.blocks[0]:null,step=block?.steps[0]
  const title=running.length===1&&first?.structure.kind==='REPEATED'&&first.structure.blocks.length===1&&block?.steps.length===1&&step?.plannedDistanceMeters!=null
    ? `${block.roundCount} × (${step.repeatCount} × ${step.plannedDistanceMeters}m)` : plan.planId
  const purposeLabels={UNSPECIFIED:'未知，待确认',WARMUP:'热身',EASY_AEROBIC:'轻松有氧',LONG:'长距离',TEMPO_THRESHOLD:'节奏／阈值',INTERVAL:'间歇',REPETITION_SPEED:'重复速度',HILL:'坡跑',RACE:'比赛',COOLDOWN:'放松',OTHER:'其他目的'}
  return {sourceId:plan.planId,title,structureText:descriptions.join(' / ')||'结构未知',purpose:running.map(c=>c.purpose==='UNSPECIFIED'?'UNKNOWN':c.purpose).join(' / ')||'UNKNOWN',purposeText:running.map(c=>purposeLabels[c.purpose]).join(' / ')||'未知，待确认'}
}
export function readFieldworkState() {
  const prefs=readFieldworkPreferences(),drafts=loadPlanDrafts()
  return {...prefs,...readUIPreferences(),plans:drafts.drafts,draftError:drafts.ok?null:drafts.reason,trainingPlans:listRunningPlans().map(describeFieldworkCourse),
    food:loadEntries().map(row=>({...row,uid:row.id,protein:row.protein??null,carbs:row.carbs??null,fat:row.fat??null,
      time:row.eatenAt&&Number.isFinite(Date.parse(row.eatenAt))?new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(row.eatenAt)):null})),
    measurements:loadChecks().map(row=>({...row,waist:row.waist??null})),calTarget:null,macroTargets:{protein:null,carbs:null,fat:null}}
}
export type FieldworkState = ReturnType<typeof readFieldworkState>
export type SaveReceipt = {ok:true;state:FieldworkState}|{ok:false;reason:string}
async function locked(action:()=>{ok:boolean;reason?:string}):Promise<SaveReceipt> {
  const athlete=currentAthleteId()
  if(typeof navigator==='undefined'||!navigator.locks?.request)return {ok:false,reason:'浏览器不支持保存互斥锁，输入仍保留。'}
  return navigator.locks.request('fr255-fieldwork-v4-write',()=>{
    if(currentAthleteId()!==athlete)return {ok:false,reason:'当前运动员已变化，请重新打开页面。'}
    const result=action();return result.ok?{ok:true,state:readFieldworkState()}:{ok:false,reason:result.reason??'未能保存并回读，请重试。'}
  })
}
export const commitFieldworkDraft=(input:DraftInput)=>locked(()=>savePlanDraft(input))
export const removeFieldworkDraft=(input:{uid:string;expectedRevision:string})=>locked(()=>removePlanDraft(input.uid,input.expectedRevision))
export function commitFieldworkMeal(input:{date:string;name:string;kcal:number|null;protein:number|null;carbs:number|null;fat:number|null;time:string}):Promise<SaveReceipt>{
  return locked(()=>{
    if(!validDate(input.date)||input.date>todayDate()||!input.name?.trim()||input.name.length>80||typeof input.kcal!=='number'||!Number.isFinite(input.kcal)||input.kcal<0||[input.protein,input.carbs,input.fat].some(n=>n!==null&&(typeof n!=='number'||!Number.isFinite(n)||n<0)))return {ok:false,reason:'请填写有效的实际日期、食物和热量；未知营养素可留空。'}
    const eatenAt=eatenAtFromClock(input.time,new Date(input.date+'T12:00:00'))
    if(!eatenAt)return {ok:false,reason:'请填写实际进食时间，不能用保存时间替代。'}
    const row=recordManualFood({date:input.date,meal:'加餐',name:input.name.trim(),kcal:input.kcal,protein:input.protein??undefined,carbs:input.carbs??undefined,fat:input.fat??undefined,eatenAt,label:'手动总量记录 · 重量未填写'})
    return row?{ok:true}:{ok:false,reason:'餐食未保存，输入仍保留。'}
  })
}
export function commitFieldworkMeasurement(input:{date:string;weight:number|null;waist:number|null}):Promise<SaveReceipt>{
  return locked(()=>{
    if(!validDate(input.date)||input.date>todayDate()||typeof input.weight!=='number'||!Number.isFinite(input.weight)||input.weight<30||input.weight>150||input.waist!==null&&(!Number.isFinite(input.waist)||input.waist<40||input.waist>150))return {ok:false,reason:'请填写有效的实测日期与体重；腰围未知可留空。'}
    const rows=upsertCheck({date:input.date,weight:input.weight,...(input.waist===null?{}:{waist:input.waist})})
    return rows?.some(r=>r.date===input.date&&r.weight===input.weight)?{ok:true}:{ok:false,reason:'身体记录未保存，输入仍保留。'}
  })
}
