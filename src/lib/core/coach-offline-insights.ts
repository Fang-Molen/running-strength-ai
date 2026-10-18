import type {EvolutionSnapshot} from './coach-evolution-v4.ts'
import type {ReasoningFrame} from './coach-reasoning.ts'
import {rounded, type ChatTraining} from './coach-chat-evidence.ts'
import { splitArithmetic } from './coach-quantitative-math.ts'
import { calculateQuantitativeRule, type QuantDatum, type QuantResult } from './coach-quantitative.ts'

export function sanitizeOfflineSnapshot(snapshot:EvolutionSnapshot){
 const issues:string[]=[]
 const active=snapshot.active.map(e=>{
  const meters=Number(e.context.match(/:(\d+(?:\.\d+)?)m$/)?.[1])
  if(e.value!==null&&(e.metric==='SESSION_RPE'&&(e.value<0||e.value>10)||e.metric==='SPLIT_SECONDS'&&meters>0&&(meters/e.value>15||meters>=5000&&meters/e.value>9))){
   issues.push(e.metric==='SESSION_RPE'?'RPE超出0—10范围，暂不计算相关负荷。':`${meters}米/${e.value}秒的速度可能有误，先核对单位与计时，这段暂不参与计算。`)
   return {...e,value:null}
  }
  return e
 })
 return {snapshot:{...snapshot,active},issues}
}

export type NumericSignal={kind:string;value:number;unit:string;sourceIds:string[];text:string;calculation?:QuantResult}
/** Arithmetic only. These signals do not establish readiness, causal mechanisms or safe training thresholds. */
export function offlineSignals(frame:ReasoningFrame,question:string,chat?:ChatTraining):NumericSignal[]{
 const out:NumericSignal[]=[]
 for(const g of frame.computed.groups){
  const pts=frame.computed.points.filter(p=>g.sourceIds.includes(p.sourceId)),values=pts.map(p=>p.seconds)
  const calculated=splitArithmetic(values)
  if(!calculated)continue
  const mean=calculated.mean,first=calculated.firstSeconds,last=calculated.lastSeconds,delta=calculated.differenceSeconds,drop=calculated.speedDeclinePercent
  const round=pts[0].protocol.match(/:step:(\d+):/)?.[1]
  const add=(kind:string,value:number,unit:string,text:string)=>out.push({kind,value:rounded(value),unit,text,sourceIds:g.sourceIds})
  add('SPLIT_CHANGE',delta,'s',`${round?`第${round}轮`:'同距组'}${g.count}段${g.distanceMeters}米，${chat?.splits.find(s=>s.round===Number(round??1))?.seconds===null?'首个有效段':'首段'}${first}秒、末段${last}秒，末减首${rounded(delta)}秒，平均${rounded(mean)}秒`)
  add('SPEED_CHANGE',drop,'%',`等距离末段相对首段${drop>=0?'速度下降':'速度提高'}${rounded(Math.abs(drop))}%，用时变异系数${rounded(calculated.cvPercent!)}%（样本标准差÷均值；${g.count}个有效值，仅描述有效记录；课目与完整性需另核对）`)
 }
 const q=/假设|假如|朋友|同伴|队友|他人/.test(question)?'':question.normalize('NFKC')
 const capture=(re:RegExp)=>{const m=q.match(re);return m?Number(m[1]):null}
 const now=capture(/本周(?:的)?(?:跑量|周量|跑了|总量|负荷)?(?:为|是|共|[:：])?\s*(\d+(?:\.\d+)?)\s*(?:公里|km|千米)/i)
 const previous=capture(/上周(?:的)?(?:跑量|周量|跑了|总量|负荷)?(?:为|是|共|[:：])?\s*(\d+(?:\.\d+)?)\s*(?:公里|km|千米)/i)
 if(now!==null&&previous!==null&&previous>0)out.push({kind:'WEEK_CHANGE',value:rounded((now/previous-1)*100),unit:'%',sourceIds:['chat:weekly-self-report'],text:`本周${now}公里、上周${previous}公里，变化${rounded((now/previous-1)*100)}%；两周是否记录齐全仍需核对`})
 const rhr=capture(/(?:今天|今晨|当前)?静息心率(?:为|是|[:：])?\s*(\d+)/),baseline=capture(/(?:个人基线|平时|基线|通常)(?:静息心率)?(?:为|是|[:：])?\s*(\d+)/)
 if(rhr!==null&&baseline!==null&&baseline>0)out.push({kind:'RHR_CHANGE',value:rounded((rhr/baseline-1)*100),unit:'%',sourceIds:['chat:rhr-self-report'],text:`静息心率${rhr}对个人基线${baseline}，相差${rhr-baseline}次/分（${rounded((rhr/baseline-1)*100)}%）；不是诊断阈值`})
 const sleep=capture(/(?:昨晚|昨天)?(?:只睡(?:了)?|睡了|睡眠|睡)\s*(\d+(?:\.\d+)?)\s*小时/)
 if(sleep!==null)out.push({kind:'SLEEP',value:sleep,unit:'h',sourceIds:['chat:sleep-self-report'],text:`自报睡眠${sleep}小时；结合白天精神和个人平时睡眠判断`})
 const au=capture(/本周(?:的)?(?:总)?(?:负荷)?(?:为|是|[:：])?\s*(\d+(?:\.\d+)?)\s*AU/i)
 const previousAu=capture(/上周(?:的)?(?:总)?(?:负荷)?(?:为|是|[:：])?\s*(\d+(?:\.\d+)?)\s*AU/i)
 if(au!==null&&previousAu!==null&&previousAu>0)out.push({kind:'WEEK_AU_CHANGE',value:rounded((au/previousAu-1)*100),unit:'%',sourceIds:['chat:weekly-load-self-report'],text:`本周${au} AU、上周${previousAu} AU，按所报值变化${rounded((au/previousAu-1)*100)}%；整课口径与两周记录完整性待核对，不代替已验证周负荷窗口`})
 const past=q.match(/(?:之前|过去|此前|前)(?:四|4)周(?:完整)?(?:负荷|AU)?[为是：:\s]*([\d.,，/、\s]+)\s*AU/i)
 const weeks=past?.[1].split(/[,，/、\s]+/).filter(Boolean).map(Number)
 if(au!==null&&weeks?.length===4&&weeks.every(n=>Number.isFinite(n)&&n>=0)){
  const mean=weeks.reduce((a,b)=>a+b,0)/4
  if(mean>0)out.push({kind:'ACWR_WEEK',value:rounded(au/mean),unit:'ratio',sourceIds:['chat:five-week-self-report'],text:`本周${au} AU，此前四周平均${rounded(mean)} AU，描述性急慢性周负荷比${rounded(au/mean)}（本周÷此前四周均值，未混用每日EWMA）；不能据此预测伤病或自动加量`})
 }
 if(chat?.rpe!==null&&chat?.rpe!==undefined&&chat.minutes!==null){
  // Unqualified RPE remains a conditional illustration, not a confirmed formula input.
  if(chat.rpeAssumed)out.push({kind:'AU',value:rounded(chat.rpe*chat.minutes),unit:'AU',sourceIds:[chat.id+':rpe',chat.id+':duration'],text:`若这里是整课RPE，${chat.minutes}分钟 × RPE ${chat.rpe} = ${rounded(chat.minutes*chat.rpe)} AU（条件计算；评分范围待确认，不能当作已保存负荷）`})
  else{
   const observation=(field:string,value:number,unit:string):QuantDatum=>({id:chat.id+':'+field,athleteId:frame.basis.athleteId,value,unit,sourceIds:[chat.id+':'+field],revision:chat.raw,kind:'SELF_REPORT',at:frame.basis.asOf,recordedAt:frame.basis.asOf,protocol:'whole-session-self-report'})
   const calculation=calculateQuantitativeRule('LOAD_SRPE',{athleteId:frame.basis.athleteId,asOf:frame.basis.asOf,values:{minutes:observation('duration',chat.minutes,'min'),rpe:observation('rpe',chat.rpe,'/10')},conditions:['WHOLE_SESSION'],conditionSourceIds:[chat.id]})
   if(calculation.status==='AVAILABLE')out.push({kind:'AU',value:rounded(calculation.value!),unit:'AU',sourceIds:calculation.sourceRefs.map(s=>s.id),calculation,text:`${chat.minutes}分钟 × RPE ${chat.rpe} = ${rounded(calculation.value!)} AU（整课自报，未保存）`})
  }
 }
 if(chat?.aggregate)out.push({kind:'REPORTED_MEAN',value:chat.aggregate.meanSeconds,unit:'s',sourceIds:[chat.id],text:`自报${chat.aggregate.count}×${chat.aggregate.meters}米平均${chat.aggregate.meanSeconds}秒；没有逐组成绩，不能计算首末变化或把均值填进每一组`})
 if(chat?.total)out.push({kind:'REPORTED_TOTAL',value:chat.total.seconds,unit:'s',sourceIds:[chat.id],text:`自报全程${chat.total.meters}米用时${chat.total.seconds}秒；逐段保留，不把全程另算一次重复跑`})
 return out
}
export const signalQuery=(signals:NumericSignal[])=>signals.map(s=>({SPEED_CHANGE:s.value>0?'掉速 后程速度下降':'分段稳定性',WEEK_CHANGE:'周量变化 单课突增',RHR_CHANGE:'静息心率 恢复',SLEEP:'睡眠 恢复',ACWR_WEEK:'急慢性负荷比',AU:'整课负荷'}[s.kind]??'')).join(' ')
export function cleanAthleteText(text:string){
 return text.replace(/\[(?:fact:|R168:|R166:|PB-|chat-|import:|confirmed:)[^\]]*\]/g,'').replace(/confirmed:chat-[\w:.-]+/g,'已保存训练').replace(/\b(?:UNKNOWN|UNAVAILABLE|NOT_RECORDED)\b/g,'未记录').replace(/数据充分性\s*L[1-4][：:]?[^。\n]*[。]?/g,'').replace(/整课主观强度未知/g,'整课感受需核对').replace(/\n{3,}/g,'\n\n').trim()
}
