/** Descriptive UI adapter. R182–R184: no approved norms => no numerical capability score. */
import type {ScheduleEntry} from './day-schedule-rules'
import type {VitalRecord} from '../nutrition/vitals'
import type {ExtraRow} from './device-store'
import type {Checkin,Tier} from './watch-mode'
export type AbilityKey='speed'|'speedEndurance'|'endurance'|'strength'|'economy'
export const ABILITY_ORDER:AbilityKey[]=['speed','speedEndurance','endurance','strength','economy']
export const ABILITY_LABEL:Record<AbilityKey,string>={speed:'速度',speedEndurance:'速度耐力',endurance:'有氧耐力',strength:'力量功率',economy:'跑步经济性'}
export type AbilityScore={key:AbilityKey;label:string;status:'pending';score:null;confidence:null;samples:number;need:string;drivers:string[];tip:string}
export type AbilityInput={entries:ScheduleEntry[];vitals:VitalRecord[];extras:ExtraRow[];checkins:Checkin[];tier:Tier;asOf:string}
export const WINDOW_DAYS=28
export const shiftDay=(day:string,n:number)=>new Date(Date.parse(day+'T00:00:00Z')+n*864e5).toISOString().slice(0,10)
export function computeAbilities(input:AbilityInput):AbilityScore[]{
 const valid=/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)&&Number.isFinite(Date.parse(input.asOf));const start=valid?shiftDay(input.asOf,-28):''
 const done=input.entries.filter(e=>valid&&e.date>start&&e.date<=input.asOf&&e.status==='done'&&e.actual&&e.actual.outcome!=='missed')
 const runs=done.filter(e=>e.modality==='run'),lifts=done.filter(e=>e.modality==='strength')
 const actualRuns=runs.filter(e=>Number.isFinite(e.actual?.km)&&e.actual!.km!>0&&Number.isFinite(e.actual?.minutes)&&e.actual!.minutes!>0)
 return ABILITY_ORDER.map(key=>({key,label:ABILITY_LABEL[key],status:'pending',score:null,confidence:null,samples:key==='strength'?lifts.length:key==='economy'?0:runs.length,need:'尚无核准的维度评分常模',drivers:key==='strength'?[`已反馈力量日程 ${lifts.length} 条；次数不等于力量能力`]:key==='endurance'?actualRuns.map(e=>`${e.date} ${e.title}：实际 ${e.actual!.km} km / ${e.actual!.minutes} 分钟`):['需要同协议、可追溯的测量记录；计划量不替代实际量'],tip:'先保留原始指标；有可比历史再展示变化，不凭单次表现调整长期能力或计划。'}))
}
export function abilityComparison(input:AbilityInput){return {now:computeAbilities(input),before:computeAbilities({...input,asOf:shiftDay(input.asOf,-30)})}}
