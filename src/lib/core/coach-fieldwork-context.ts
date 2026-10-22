import {loadPlanDrafts} from '../ui/fieldwork-plan-drafts'
import {loadChecks} from '../nutrition/body'
import {loadEntries,nutrientOf} from '../nutrition/log'
import {calendarDay} from './coach-calendar'
import type {CoachBrief} from './coach-brief'
type Source=NonNullable<CoachBrief['sources']>[number]
const available=(time:string|undefined,cutoff:number)=>!!time&&Number.isFinite(Date.parse(time))&&Date.parse(time)<=cutoff
/** Topic-scoped observations only. Never converts a draft, appearance choice or meal into a training fact. */
export function readFieldworkCoachSources(question:string,asOf=new Date().toISOString()):Source[]{
 const cutoff=Date.parse(asOf),day=calendarDay(asOf);if(!Number.isFinite(cutoff)||!day)return []
 const sources:Source[]=[]
 if(/计划|待练|草稿|课表|安排/.test(question)){
  const view=loadPlanDrafts()
  if(!view.ok)sources.push({id:'linked:fieldwork-drafts-unavailable',kind:'CONTEXT',detail:'待练草稿读取异常；不能当作没有安排或已获得训练许可。'})
  else for(const d of view.drafts.filter(d=>available(d.createdAt,cutoff)&&available(d.updatedAt,cutoff)).slice(-2))sources.push({id:`linked:fieldwork-draft:${d.uid}:${d.revisionId}`,kind:'CONTEXT',detail:`待练草稿 ${d.date} ${d.title}；${d.sets??'组数待确认'}组 × ${d.amount??'数量待确认'}${d.unit}；休息${d.restSec??'待确认'}秒；内容${d.contentVersion}／${d.reviewStatus}。仅为候选，未确认个人适用性或医学许可，不是已完成训练，不自动修改正式计划。`.slice(0,300)})
 }
 if(/体重|腰围|实测|体型|身体测量/.test(question))for(const row of loadChecks().filter(r=>r.date<=day&&available(r.recordedAt,cutoff)).slice(-2))sources.push({id:`linked:measurement:${row.id}:${row.recordedAt}`,kind:'CONTEXT',detail:`身体记录 ${row.date}：体重${row.weight}公斤；腰围${row.waist??'未记录'}${row.waist===undefined?'':'厘米'}；${row.source??'来源未知'}；保存于${row.recordedAt}。数值记录不证明恢复或能力变化；不读取体型模拟、外观或目标情景。`.slice(0,300)})
 if(/记录|我的|本地/.test(question)&&/饮食|营养|食物|餐|摄入|热量|补给/.test(question))for(const row of loadEntries().filter(r=>r.date<=day&&available(r.recordedAt,cutoff)&&(!r.eatenAt||Date.parse(r.eatenAt)<=cutoff)).sort((a,b)=>Date.parse(a.recordedAt!)-Date.parse(b.recordedAt!)).slice(-3)){
  const kcal=nutrientOf(row,'kcal'),protein=nutrientOf(row,'protein'),carb=nutrientOf(row,'carb'),fat=nutrientOf(row,'fat')
  const sourceLabel=row.nutritionSnapshot?.source?.label??row.foodSnapshot?.source.status??'用户手填',region=row.nutritionSnapshot?.region??row.foodSnapshot?.region??''
  sources.push({id:`linked:meal:${row.id}${row.revisionId?':'+row.revisionId:''}`,kind:'CONTEXT',detail:`餐食记录 ${row.date} ${row.name}：${kcal===null?'热量未知':'已记录'+kcal+'千卡'}；蛋白${protein??'未记录'}${protein===null?'':'克'}，碳水${carb??'未记录'}${carb===null?'':'克'}，脂肪${fat??'未记录'}${fat===null?'':'克'}；来源${sourceLabel}${region?'／'+region:''}；实际进食${row.eatenAt??'时刻未知'}。不代表全天记录完整，不证明供能不足或训练掉速原因。`.slice(0,300)})
 }
 return sources
}
