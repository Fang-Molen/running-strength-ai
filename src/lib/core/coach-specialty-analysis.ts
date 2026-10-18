import { secondsToken, rounded, type ChatTraining } from './coach-chat-evidence.ts'

export type ReportedPb={meters:number;seconds:number;source:'USER_REPORT';raw:string}
/** PB declarations only: a repetition distance or future target is never a main event/PB. */
export function reportedPbs(input:string):ReportedPb[]{
 const q=input.normalize('NFKC'),out:ReportedPb[]=[]
 const re=/(60|100|200|400|800|1500|3000|5000|10000)\s*(?:米|m)\s*(?:的)?\s*(?:PB|最好成绩|个人最好|最好)\s*(?:是|为|[:：])?\s*(\d{1,3}[:′']\d{1,2}(?:\.\d{1,3})?|\d+(?:\.\d+)?)\s*(秒|分钟|分)?/gi
 for(const m of q.matchAll(re)){
  if(/目标|想跑进|假设|如果|不是|并非|没有/.test(q.slice(Math.max(0,m.index!-12),m.index)))continue
  const seconds=secondsToken(m[2]),factor=/分钟|分/.test(m[3]??'')&&!/[:′']/.test(m[2])?60:1
  if(seconds!==null&&seconds*factor>0)out.push({meters:Number(m[1]),seconds:seconds*factor,source:'USER_REPORT',raw:m[0]})
 }
 return out
}
export type RaceSplit={atM:number;seconds:number;sourceId:string;source:'USER_REPORT'|'OFFICIAL'|'DEVICE'|'DERIVED'}
/** Cumulative checkpoints; no interpolation, no mutation and no normative cutoffs. */
export function calculateRaceSplits(eventMeters:number,totalSeconds:number|null,reported:readonly RaceSplit[]){
 const errors:string[]=[],points=[...reported].sort((a,b)=>a.atM-b.atM)
 if(!Number.isFinite(eventMeters)||eventMeters<=0||totalSeconds!==null&&(!Number.isFinite(totalSeconds)||totalSeconds<=0))errors.push('INVALID_TOTAL')
 for(let i=0;i<points.length;i++)if(!points[i].sourceId||!Number.isFinite(points[i].atM)||!Number.isFinite(points[i].seconds)||points[i].atM<=0||points[i].atM>eventMeters||points[i].seconds<=0||i>0&&(points[i].atM<=points[i-1].atM||points[i].seconds<=points[i-1].seconds))errors.push('INVALID_CHECKPOINT')
 const end=points.find(p=>p.atM===eventMeters)
 if(totalSeconds!==null&&end&&Math.abs(end.seconds-totalSeconds)>.005)errors.push('TOTAL_CONFLICT')
 if(totalSeconds!==null&&!end)points.push({atM:eventMeters,seconds:totalSeconds,sourceId:'derived-total',source:'DERIVED'})
 if(points.length>1&&points.at(-1)!.seconds<=points.at(-2)!.seconds)errors.push('NONINCREASING_TIME')
 if(errors.length)return {status:'UNKNOWN' as const,errors,segments:[],halfDifferenceSeconds:null,halfDifferencePercent:null,missing:['核对累计分段、单位和总成绩']}
 const segments=points.map((p,i)=>{const prev=points[i-1],meters=p.atM-(prev?.atM??0),seconds=p.seconds-(prev?.seconds??0);return {fromM:prev?.atM??0,toM:p.atM,meters,seconds,paceSecondsPerKm:seconds/meters*1000,speedMps:meters/seconds,sourceIds:[...(prev?[prev.sourceId]:[]),p.sourceId],derived:p.source==='DERIVED'}})
 const half=points.find(p=>p.atM===eventMeters/2),total=points.find(p=>p.atM===eventMeters)
 const difference=half&&total?total.seconds-2*half.seconds:null
 return {status:'AVAILABLE' as const,errors,segments,halfDifferenceSeconds:difference,halfDifferencePercent:difference!==null&&half?difference/half.seconds*100:null,missing:half?[]:['半程累计计时 UNKNOWN；未插值']}
}
/** Actual values drive the text; targets remain targets, separately labelled. */
export function intervalTargetAnalysis(chat:ChatTraining,question:string,purpose:string){
 const q=question.normalize('NFKC')
 const targets=[...q.matchAll(/(?:目标|计划)(?:每(?:组|趟|次))?(?:用时|时间|配速)?(?:是|为|控制在|[:：])?\s*(\d+[:′']\d{1,2}(?:\.\d+)?|\d+(?:\.\d+)?)\s*(秒|分钟|分)?/g)].flatMap(m=>{
  if(!m[2]&&!/[:′']/.test(m[1])||/(?:没有|未设|不是|并非|取消|撤回)\s*$/.test(q.slice(Math.max(0,m.index!-12),m.index)))return []
  const seconds=secondsToken(m[1]);return seconds===null?[]:[seconds*(/分/.test(m[2]??'')&&!/[:′']/.test(m[1])?60:1)]
 })
 const target=targets.length&&new Set(targets).size===1?targets[0]:null,valid=chat.splits.filter(s=>s.seconds!==null&&Number.isFinite(s.seconds)&&s.seconds>0&&Number.isFinite(s.meters)&&s.meters>0&&!s.excluded)
 if(!chat.hasActual||target===null||!valid.length||new Set(valid.map(s=>s.meters)).size!==1)return null
 const deviations=valid.map(s=>({round:s.round,repeat:s.repeat,seconds:s.seconds!,deltaSeconds:s.seconds!-target})),first=valid[0],last=valid.at(-1)!
 const delta=last.seconds!-first.seconds!,pct=delta/first.seconds!*100
 const coursePurpose=purpose==='UNKNOWN'?'课程目的 UNKNOWN，先确认教练希望练什么':`原目的为${purpose}`
 const pattern=delta>0?(first.seconds!<target?`首段比目标快${rounded(target-first.seconds!)}秒，随后变慢，起步节奏可能影响执行`:`首段${first.seconds===target?'贴近目标':'已慢于目标'}且后段继续变慢；没有首段快于目标的证据`):'首末接近或后段更快仍需核对中间波动与课程强度'
 const text=`目标是每次${target}秒；实际相对目标依次为${deviations.map(d=>`第${d.round}轮第${d.repeat}次${d.deltaSeconds>=0?'+':''}${rounded(d.deltaSeconds)}秒`).join('、')}（正值表示慢于目标）。首末用时相差${rounded(delta)}秒、${rounded(pct)}%；${coursePurpose}，不能仅按掉速比例判定达标或能力缺陷。${pattern}；组间恢复、环境或近期疲劳也可能影响表现。下一次已批准同协议课程保留距离、组次和休息，观察各段与原目标的差及后段偏差是否收窄；同条件调整起步节奏后改善支持节奏解释，不改善则削弱该解释并核对恢复及计时；任何改动先确认，不增加剂量。`
 return {targetSeconds:target,deviations,firstLastSeconds:delta,firstLastPercent:pct,sourceId:chat.id,validSamples:valid.length,missingSamples:chat.splits.length-valid.length,text}
}
/** Source-aware proposals, never corrections or physiological rules. Requires explicit nominal distance. */
export function proposeNominalDistance(rawMeters:readonly number[],nominalMeters:number,source:'TRACK'|'GPS'|'HANDTIME',confirmedCourse:boolean){
 if(!confirmedCourse||!Number.isFinite(nominalMeters)||nominalMeters<=0||rawMeters.length<2||rawMeters.some(v=>!Number.isFinite(v)||v<=0))return {status:'UNKNOWN' as const,rawMeters:[...rawMeters],nominalMeters,reason:'先确认同一课程、距离单位与名义距离',autoApply:false as const}
 // No empirical tolerance becomes an automatic decision; reviewer sees every raw delta.
 return {status:'REVIEW_REQUIRED' as const,source,rawMeters:[...rawMeters],nominalMeters,proposedMeters:rawMeters.map(()=>nominalMeters),deviations:rawMeters.map(v=>({meters:v-nominalMeters,percent:(v-nominalMeters)/nominalMeters*100})),reason:nominalMeters<=200&&source==='GPS'?'短距离GPS不适合精确计时评估；优先核对场地与手计时':'核对课程、测量方法和原始逐圈后再确认；不可据此重写原值',autoApply:false as const}
}
export function explicitlyReviewsRecord(q:string){
 const text=q.normalize('NFKC')
 const reference=/分析(?:这|本|刚才|上次|所选)|这(?:节|次|个)(?:训练|课|记录)|刚才(?:的|那)?(?:训练|课|分段|成绩|记录)|上次(?:训练|那课|的分段)|本次训练|这次练得/.test(text)
 if(reference)return true
 // Asking what reviews are or why a field matters is not a request to review the last workout.
 if(/复盘(?:时|中|的)?(?:为什么|为何|有什么|有何|如何|怎么|需要|要不要)|(?:为什么|为何|如何|怎么).{0,8}复盘|什么是(?:训练)?复盘|回顾(?:时|中)为什么/.test(text))return false
 return /(?:复盘|回顾)/.test(text)
}
/** Explicit cumulative race report, self-report only. Missing checkpoints stay missing. */
export function reportedRace(input:string){
 const q=input.normalize('NFKC')
 if(!/累计|分段|前\s*\d+\s*(?:米|m)/i.test(q)||/假设|如果|举例|朋友|队友|同伴|学员|别人/.test(q))return null
 const actualScope=(index:number)=>!/(?:目标|计划|打算|准备|明天|后天|下次|下一课|下周|不是|并非|没有)/.test(q.slice(0,index).split(/[，,。；;！？?]/).at(-1)??'')
 const total=[...q.matchAll(/(?:比赛|测试|这次|今天|跑了)?\s*(400|800|1500|3000|5000|10000)\s*(?:米|m)\s*(?:总成绩|总用时|成绩|跑了|用时|是|为|[:：])\s*(\d+[:′']\d{1,2}(?:\.\d+)?|\d+(?:\.\d+)?)\s*(秒|分钟|分)?/gi)].find(m=>actualScope(m.index!))
 if(!total)return null
 const seconds=secondsToken(total[2]);if(seconds===null)return null
 const totalSeconds=seconds*(/分/.test(total[3]??'')&&!/[:′']/.test(total[2])?60:1),splits:RaceSplit[]=[]
 for(const m of q.matchAll(/(?:前\s*)?(\d+)\s*(?:米|m)\s*(?:累计(?:用时)?|分段累计|累计到|用了|用时|[:：])\s*(\d+[:′']\d{1,2}(?:\.\d+)?|\d+(?:\.\d+)?)\s*(秒|分|分钟)?/gi)){
  if(m.index===total.index||Number(m[1])>=Number(total[1])||!actualScope(m.index!))continue
  const t=secondsToken(m[2]);if(t!==null)splits.push({atM:Number(m[1]),seconds:t*(/分/.test(m[3]??'')&&!/[:′']/.test(m[2])?60:1),source:'USER_REPORT',sourceId:`race-report:${m.index}`})
 }
 if(!splits.length)return null
 return {eventMeters:Number(total[1]),totalSeconds,splits,calculation:calculateRaceSplits(Number(total[1]),totalSeconds,splits)}
}
