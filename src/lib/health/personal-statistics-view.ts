/** Optional UI projection. No scores, medical red/green badges or automatic training changes. */
import { summarizeSeries,fitIndependentTrend,auditRollingForecast,type ComparableSeries } from '../core/personal-uncertainty.ts'
export type PersonalStatisticsCard={
  status:'DATA_CONFLICT'|'HISTORY_ONLY'|'NEED_MORE_DATA'|'DESCRIPTIVE'|'STATISTICAL_REVIEW'
  title:string
  lines:string[]
  caveats:string[]
  chartPoints:{day:string;value:number}[]
  sourceIds:string[]
  decisionAuthorized:false
}
export function buildPersonalStatisticsCard(series:ComparableSeries):PersonalStatisticsCard {
  const summary=summarizeSeries(series),trend=fitIndependentTrend(series),forecast=auditRollingForecast(series)
  const card:PersonalStatisticsCard={status:'NEED_MORE_DATA',title:`${series.metric} · 个人趋势`,lines:[],caveats:['仅研究性统计描述；不等于恢复许可、医学诊断或训练调整指令。'],chartPoints:series.points.map(p=>({day:p.day,value:p.value})),sourceIds:series.sourceIds,decisionAuthorized:false}
  if(series.status==='INVALID'||series.status==='CONFLICT'){
    card.status='DATA_CONFLICT';card.lines.push('来源、身份或重复记录存在冲突，暂不生成统计判断。');return card
  }
  if(summary.status==='INSUFFICIENT'){
    card.lines.push(`当前有效可比记录 ${summary.n} 条，尚不足以建立稳定描述。`);return card
  }
  card.status=series.points.at(-1)?.day===series.asOf.slice(0,10)?'DESCRIPTIVE':'HISTORY_ONLY'
  card.lines.push(`有效可比记录 ${summary.n} 条；均值 ${summary.mean!.toFixed(2)} ${summary.unit}，中位数 ${summary.median!.toFixed(2)} ${summary.unit}，样本SD ${summary.sd!.toFixed(2)}。`)
  if(card.status==='HISTORY_ONLY')card.caveats.push(`最新有效记录日期为 ${series.points.at(-1)?.day}，不能代表今天的状态。`)
  if(trend.status==='AVAILABLE')card.lines.push(`研究性线性趋势 ${trend.slopePerDay!.toFixed(3)} ${summary.unit}/天；斜率95%模型置信区间 ${trend.slopeCi95![0].toFixed(3)}～${trend.slopeCi95![1].toFixed(3)}。`)
  else card.caveats.push('回归样本不足或残差诊断未通过，不展示斜率置信区间。')
  if(forecast.status==='AVAILABLE'){
    card.lines.push(`下一日统计预测 ${forecast.nextPrediction!.toFixed(2)} ${summary.unit}；研究性95%预测区间 ${forecast.nextInterval![0].toFixed(2)}～${forecast.nextInterval![1].toFixed(2)}。`)
    card.lines.push(`留出回测覆盖 ${Math.round(forecast.empiricalHoldoutCoverage!*100)}%（${forecast.holdoutN}条）；不是未来覆盖保证。`)
  } else if(forecast.status==='REVIEW_REQUIRED'){
    card.status='STATISTICAL_REVIEW';card.caveats.push(`历史留出回测覆盖率仅 ${Math.round(forecast.empiricalHoldoutCoverage!*100)}%，未达到产品质量复核门槛；预测区间已隐藏。`)
  } else card.caveats.push('预测所需连续历史不足或存在缺失，暂不显示预测区间。')
  return card
}
