import {evaluateCoachEvolution, type EvolutionEvidence} from './coach-evolution-v4.ts'
import {statedSessionMinutes, parseReportedRpes} from './coach-session-load.ts'
import {createTrainingImportDraft, confirmTrainingImport, loadConfirmedTrainingImports} from './training-import.ts'
import {detectRedFlags} from './coach-red-flags.ts'
import {listCorrections} from './training-correction.ts'

export type ChatSplit={round:number;repeat:number;meters:number;seconds:number|null;heartRate:number|null;excluded:string|null}
export type ChatTraining={id:string;raw:string;planned:number|null;rounds:number;perRound:number|null;splits:ChatSplit[];restSeconds:number|null;roundRestSeconds:number|null;minutes:number|null;rpe:number|null;rpeAssumed:boolean;issues:string[];hasActual:boolean;aggregate?:{meters:number;count:number;meanSeconds:number};total?:{meters:number;seconds:number};savedOccurrenceId?:string;rpeScopeClarification?:{originalTrainingId:string;originalRaw:string;answer:string;scope:'SESSION_RPE'|'SET_RPE'|'SEGMENT_RPE';answeredAt:string}}
export const rounded=(n:number)=>Number(n.toFixed(2))
const hash=(s:string)=>{let n=2166136261;for(const c of s)n=Math.imul(n^c.charCodeAt(0),16777619);return (n>>>0).toString(36)}
export function secondsToken(raw:string):number|null{
 const q=raw.trim().replace(/[秒s]$/i,'');if(/没记|未记|缺|漏|—|--|\?/.test(q))return null
 const clock=q.match(/^(\d{1,3})[:′'](\d{1,2}(?:\.\d{1,3})?)(?:[″"])?$/)
 if(clock)return Number(clock[2])<60?Number(clock[1])*60+Number(clock[2]):null
 const n=Number(q);return q&&Number.isFinite(n)&&n>0?n:null
}
const token="(?:\\d{1,4}(?:[:′']\\d{1,2}(?:\\.\\d{1,3})?|\\.\\d{1,3})?(?:秒|s)?|没记|未记|缺(?:圈|失)?|漏(?:圈|记)?|—|--|\\?)"
const sequence=new RegExp(`(${token}(?:\\s*[/、,，→\\s]\\s*${token}){1,79})`,'ig')
function series(text:string):Array<number|null>{
 const matches=[...text.matchAll(new RegExp(sequence.source,'ig'))]
 const m=matches.sort((a,b)=>b[0].length-a[0].length)[0]
 return m?m[0].trim().split(/\s*[/、,，→]\s*|\s+/).map(secondsToken):[]
}
function distanceTimePairs(text:string):Array<[number,number]>{
 const explicit=text.trim().match(/^(\d+)\s*(?:米|m|\s)\s*(\d+(?:\.\d+)?)\s*(?:秒)?$/)
 if(explicit)return [[Number(explicit[1]),Number(explicit[2])]]
 const compact=text.trim().replace(/秒$/,'');if(!/^\d+(?:\.\d+)?$/.test(compact))return []
 const out:Array<[number,number]>=[]
 for(let i=1;i<compact.length;i++){const a=compact.slice(0,i),b=compact.slice(i);if(/^\d+$/.test(a)&&/^[1-9]\d*(?:\.\d+)?$/.test(b))out.push([Number(a),Number(b)])}
 return out
}
function rest(text:string,round=false){
 const re=round?/(?:轮间|大组间|大组|两轮之间)(?:休息|间歇|恢复)?\s*(\d+(?:\.\d+)?)\s*(分钟|分|秒)/:/(?:组间|趟间|每组间|间歇|休息|恢复)(?:休息|恢复|为|是|约)?\s*(\d+(?:\.\d+)?)\s*(分钟|分|秒)/
 const source=round?text:text.replace(/(?:轮间|大组间|大组|两轮之间)(?:休息|间歇|恢复)?\s*\d+(?:\.\d+)?\s*(?:分钟|分|秒)/g,'');const m=source.match(re);return m?Number(m[1])*(m[2]==='秒'?1:60):null
}
/** Plan/future clauses are not completion assertions, regardless of their sentence position. */
function assertedActual(text:string){
 return [...text.matchAll(/实际|完成(?:了)?|跑了|跑完|练了|练完|训练了|测试结果|结果(?:是|为|[:：])/g)].some(m=>{
  const prefix=text.slice(Math.max(0,m.index!-12),m.index)
  return !/(?:没|未|没有|尚未|还没|未曾|计划|准备|打算)(?:能|有|去|要|真正|全部|训练|测试|比赛|课程|本课|今天|明天|的|\s)*$/.test(prefix)&&!/^后(?:再|会|才|要)/.test(text.slice(m.index!+m[0].length))
 })
}
function planningOnly(text:string){
 if(assertedActual(text))return false
 const firstDatum=text.search(/\d+(?:\.\d+)?\s*(?:米|m|公里|km|分钟|分|秒|[×x*])|\d+\s*(?:组|趟|次|个)|rpe\s*\d/i)
 const prefix=firstDatum<0?text:text.slice(0,firstDatum)
 if(/计划|目标|打算|准备|明天|后天|下次|下一课|下周/.test(prefix))return true
 const times=new RegExp(sequence.source,'i').exec(text)
 const singleTiming=/\d+[:′']\d{1,2}(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:秒|分钟|分)(?!段)|rpe\s*\d/i.exec(text)
 const timingAt=Math.min(times?.index??Infinity,singleTiming?.index??Infinity)
 return Number.isFinite(timingAt)&&/目标|计划|打算|准备|明天|后天|下次|下一课|下周/.test(text.slice(0,timingAt))
}
/** Chat creates transient self-report evidence. It never silently commits facts or borrows plan targets. */
export function parseChatTraining(input:string):ChatTraining{
 const raw=input.normalize('NFKC').slice(0,8000),q=raw.toLowerCase()
 const result:ChatTraining={id:'chat-'+hash(raw),raw,planned:null,rounds:1,perRound:null,splits:[],restSeconds:rest(q),roundRestSeconds:rest(q,true),minutes:statedSessionMinutes(q),rpe:null,rpeAssumed:false,issues:[],hasActual:false}
 if(/假设|假如|举例|例如|朋友|队友|同伴|学员|别人/.test(q)||planningOnly(q))return {...result,minutes:null}
 const rpes=parseReportedRpes(q),explicit=rpes.filter(r=>r.scope==='SESSION_RPE'),unqualified=rpes.filter(r=>r.scope==='UNSPECIFIED')
 const ratings=explicit.length?explicit:unqualified
 if(new Set(ratings.map(r=>r.value)).size===1){result.rpe=ratings[0].value;result.rpeAssumed=!explicit.length}
 else if(ratings.length)result.issues.push('整课评分存在多个不同值，先保留原值并核对。')
 const invalid=[...q.matchAll(/rpe\s*(?:是|为|[:：])?\s*(-?\d+(?:\.\d+)?)/g)].filter(m=>Number(m[1])<0||Number(m[1])>10)
 if(invalid.length){result.rpe=null;result.issues.push('RPE超出0—10范围，本次不据此计算负荷。')}
 const structure=q.match(/(\d+(?:\.\d+)?)\s*(米|m|公里|km)\s*[×x*]\s*(\d+)(?:\s*[×x*]\s*(\d+))?/)
 const reverse=q.match(/(\d+)\s*(?:组|趟|次|个)\s*(\d+(?:\.\d+)?)\s*(米|m|公里|km)/)
 const reverseTimes=q.match(/(\d+)\s*[×x*]\s*(\d+(?:\.\d+)?)(?![\d.])\s*(米|m|公里|km)?(?=[，,\s]|$)/)
 const measured=q.match(/(?:测了|跑了|完成了?)\s*([一二两三四五六七八九十\d]+)\s*(?:个|次|趟)\s*(\d+(?:\.\d+)?)(?![\d.])\s*(?:米|m)?/)
 let meters:number|null=null,tail=q
 if(structure){meters=Number(structure[1])*(/公里|km/.test(structure[2])?1000:1);result.perRound=Number(structure[3]);result.rounds=Number(structure[4]??1);tail=q.slice(structure.index!+structure[0].length)}
 else if(reverse||reverseTimes){const m=(reverse??reverseTimes)!;meters=Number(m[2])*(/公里|km/.test(m[3])?1000:1);result.perRound=Number(m[1]);tail=q.slice(m.index!+m[0].length)}
 else if(measured){const words:Record<string,number>={一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10};meters=Number(measured[2]);result.perRound=words[measured[1]]??Number(measured[1]);tail=q.slice(measured.index!+measured[0].length).replace(/和|与/g,'、')}
 if(result.perRound){result.planned=result.perRound*result.rounds;if(result.planned>80||result.rounds>20){result.issues.push('所述组数过大，请核对训练结构。');return result}}
 const kmSplits=q.match(/(?:公里分段|每公里|每千米|公里用时|千米分段|km分段)[：:\s]*(.*)/)
 if(kmSplits){meters=1000;tail=kmSplits[1]}
 const distanceList=q.match(/距离(?:依次|分别)?[为是：:\s]*([\d.、，,\s]+)\s*(米|m|公里|km)(?=[，,。；;\s]|$)/)
 const timingList=q.match(/(?:用时|时间)(?:依次|分别)?[为是：:\s]*([\d.:′'、，,\s]+)\s*(秒|s|分钟|分)(?=[，,。；;\s]|$)/)
 if(distanceList&&timingList){
  const ds=distanceList[1].trim().split(/[、，,\s]+/).map(Number),timeTokens=timingList[1].trim().split(/[、，,\s]+/),ts=timeTokens.map(secondsToken)
  if(ds.length!==ts.length||ds.some(n=>!Number.isFinite(n)||n<=0)||ts.some(n=>n===null))result.issues.push('距离与时间序列条数不一致或值无效；未猜配分段。')
  else result.splits=ds.map((d,i)=>({round:1,repeat:i+1,meters:d*(/公里|km/.test(distanceList[2])?1000:1),seconds:ts[i]!*(/分钟|分/.test(timingList[2])&&!/[:′']/.test(timeTokens[i])?60:1),heartRate:null,excluded:null}))
  meters=null
 }
 if(meters){
  // Rest, RPE and HR numbers cannot become split times.
  const actualTail=tail.split(/(?:实际(?:用时|成绩)?|成绩依次|分别(?:为|是)|用时依次)[：:\s]*/).at(-1)!
  const timeText=actualTail.split(/组间|轮间|大组|休息|恢复|间歇|rpe|心率|总时长|整课|训练时长|用时共|目标|计划|打算|准备|明天|后天|下次|下一课|下周/)[0]
  const average=timeText.match(/平均(?:用时|每组|每趟)?[为是：:\s]*(\d+(?:[:.′']\d{1,2})?)\s*(?:秒|s)?/)
  if(average&&result.planned){const meanSeconds=secondsToken(average[1]);if(meanSeconds!==null)result.aggregate={meters,count:result.planned,meanSeconds}}
  const times=average?[]:series(timeText)
  const noActual=planningOnly(q)
  if(!noActual){
   const expected=result.planned??times.length
   for(let i=0;i<Math.max(times.length,expected);i++)result.splits.push({round:result.perRound?Math.floor(i/result.perRound)+1:1,repeat:result.perRound?i%result.perRound+1:i+1,meters,seconds:times[i]??null,heartRate:null,excluded:null})
   if(times.length>expected)result.issues.push('用时条数超过所述计划组数，请核对是否还含热身或其他组。')
  }
 }
 if(!result.splits.length){
  const splitRace=q.match(/(\d+)\s*(?:米|m)?\s*用时\s*(\d+[:′']\d{1,2}(?:\.\d+)?|\d+(?:\.\d+)?秒)[，,\s]*前\s*([\d.\s米m秒]+)[，,\s]*后\s*([\d.\s米m秒]+)/)
  if(splitRace){const [,distance,t,front,back]=splitRace,total=secondsToken(t);if(total!==null){result.total={meters:Number(distance),seconds:total};const candidates=distanceTimePairs(front).flatMap(a=>distanceTimePairs(back).filter(b=>a[0]+b[0]===Number(distance)&&Math.abs(a[1]+b[1]-total)<.01).map(b=>[a,b]));if(candidates.length===1)result.splits=candidates[0].map(([meters,seconds],i)=>({round:1,repeat:i+1,meters,seconds,heartRate:null,excluded:null}));else result.issues.push('前后分段的距离与用时写法不明确或与总成绩不一致，请加单位核对；没有猜填分段。')}}
 }
 if(!result.splits.length){
  const continuous=q.match(/(?:实际|今天|刚刚|跑了|跑完|完成|轻松跑)[^。；;]{0,16}?(\d+(?:\.\d+)?)\s*(公里|km|米|m)[，,\s]*(?:用时|用了|时间)?\s*(\d+(?:\.\d+)?)\s*(分钟|分|秒)/)
  if(continuous&&!/计划|打算|准备|假设/.test(q.slice(0,continuous.index!))){const m=continuous;result.splits.push({round:1,repeat:1,meters:Number(m[1])*(/公里|km/.test(m[2])?1000:1),seconds:Number(m[3])*(m[4]==='秒'?1:60),heartRate:null,excluded:null})}
  const single=q.match(/(\d+(?:\.\d+)?)\s*(米|m|公里|km)\s*(?:跑了|跑完用了|用了|用时|成绩是)\s*(\d+[:′']\d{1,2}(?:\.\d+)?|\d+(?:\.\d+)?)\s*(秒|分钟|分)?/)
  if(!result.splits.length&&single){const seconds=secondsToken(single[3]);if(seconds!==null)result.splits.push({round:1,repeat:1,meters:Number(single[1])*(/公里|km/.test(single[2])?1000:1),seconds:seconds*(/分钟|分/.test(single[4]??'')&&!/[:′']/.test(single[3])?60:1),heartRate:null,excluded:null})}
 }
 const hr=q.match(/心率(?:序列|分段|依次|分别)?[：:\s]*([^。；;]+)/)
 const hrs=hr?series(hr[1]):[]
 const reportedHr=[...q.matchAll(/心率(?:是|为|到了|达到|最高|峰值|[:：])?\s*(\d{2,3})(?!\d)/g)].map(m=>Number(m[1]))
 if([...reportedHr,...hrs].some(n=>n!==null&&n>=220))result.issues.push('所报心率达到或超过220次/分，可能有测量伪影；保留原值并核对设备、佩戴与原始曲线，不作为已测最大心率。年龄公式不是个人心率上限。')
 for(const [i,s] of result.splits.entries())s.heartRate=hrs[i]??null
 if(hrs.length>=3&&new Set(hrs).size===1)result.issues.push(`心率连续${hrs.length}段都为${hrs[0]}，可能是传感器平台伪影；先核对佩戴和原始曲线，不据此加速。`)
 for(const s of result.splits)if(s.seconds!==null&&(s.meters/s.seconds>15||s.meters>=5000&&s.meters/s.seconds>9)){
  s.excluded='速度超出保守的数据合理性检查范围';result.issues.push(`${s.meters}米/${s.seconds}秒的速度可能有误，先核对单位、计时与距离；这段暂不参与计算。`)
 }
 if(/gps/.test(q)&&result.splits.length>=3&&result.splits.every(s=>s.meters===1000)){
  const values=result.splits.flatMap(s=>s.seconds!==null?[s.seconds]:[]).sort((a,b)=>a-b),median=values[Math.floor(values.length/2)]
  for(const s of result.splits)if(s.seconds!==null&&(s.seconds<median/2||s.seconds>median*2)){s.excluded='GPS孤立单公里跳点待核对';result.issues.push(`第${s.repeat}公里${s.seconds}秒可能为GPS跳点，保留原值；另列暂不计此段的结果。`)}
 }
 result.hasActual=result.splits.some(s=>s.seconds!==null)||!!result.aggregate||result.minutes!==null||result.rpe!==null
 return result
}

/** A declared inter-round interval replaces the final repetition interval of that round.
 * No recovery is invented after the last slot. Missing timing is not an unperformed rep. */
export function chatRestAfter(chat:ChatTraining,index:number){
 const current=chat.splits[index],next=chat.splits[index+1]
 if(!next)return {seconds:null,scope:'UNSPECIFIED' as const}
 return next.round!==current.round?{seconds:chat.roundRestSeconds,scope:'AFTER_ROUND' as const}:{seconds:chat.restSeconds,scope:'AFTER_REPEAT' as const}
}
/** Match a confirmed receipt, never infer a save from a previous reply or another athlete. */
export function savedChatReceipt(chat:ChatTraining,athleteId:string,asOf:string){
 const matches=loadConfirmedTrainingImports().filter(r=>(r.athleteId??'local')===athleteId&&r.draftId.startsWith(chat.id+'-')&&(!chat.savedOccurrenceId||r.confirmedImportId===chat.savedOccurrenceId)&&Date.parse(r.confirmedAt)<=Date.parse(asOf))
 if(matches.length!==1)return null
 const record=matches[0]
 let voided=false
 for(const c of listCorrections(record.confirmedImportId).filter(c=>c.recordedAt&&Date.parse(c.recordedAt)<=Date.parse(asOf))){if(c.kind==='VOID')voided=true;if(c.kind==='RESTORE')voided=false}
 return {occurrenceId:record.confirmedImportId,voided}
}
export function chatEvolution(chat:ChatTraining,athleteId:string,asOf:string){
 const evidence:EvolutionEvidence[]=[]
 const put=(suffix:string,metric:EvolutionEvidence['metric'],value:number|null,unit:string,context:string)=>evidence.push({id:chat.id+':'+suffix,athleteId,occurrenceId:chat.id,source:'USER_REPORT',sourceId:chat.id+':'+suffix,confirmation:'USER_REPORTED',recordedAt:asOf,eventAt:asOf,metric,value,unit,context})
 for(const [i,s] of chat.splits.entries()){
  put(`split:${s.round}:${s.repeat}`,'SPLIT_SECONDS',s.excluded?null:s.seconds,'s',`running:main:rep:chat:step:${s.round}:${s.repeat}:${s.meters}m`)
  const rest=chatRestAfter(chat,i)
  if(rest.seconds!==null)put(`rest:${s.round}:${s.repeat}`,'REST_SECONDS',rest.seconds,'s',`running:main:rest:chat:${rest.scope}:step:${s.round}:${s.repeat}`)
  if(s.heartRate!==null){put(`hr:${s.round}:${s.repeat}`,'HR_AVG_BPM',s.heartRate,'bpm',`heart:chat:${s.round}:${s.repeat}`);evidence[evidence.length-1]={...evidence[evidence.length-1],measurement:{method:'UNKNOWN',segmentSourceId:chat.id+`:split:${s.round}:${s.repeat}`}}}
 }
 if(chat.rpe!==null)put('rpe','SESSION_RPE',chat.rpe,'/10','session')
 return evaluateCoachEvolution({athleteId,asOf,question:chat.raw,evidence,scopeOccurrenceIds:[chat.id]})
}

export function saveChatTraining(chat:ChatTraining,occurredAt:string,confirmed:boolean,sport:'RUNNING'|'STRENGTH'|'MIXED'|'UNKNOWN'='UNKNOWN'){
 if(chat.splits.length>48)return {ok:false as const,reason:'这次超过48段，请使用完整训练记录入口分组核对并保留原始记录；没有截断或保存部分训练。'}
 if(chat.aggregate)return {ok:false as const,reason:'目前只有平均成绩，请在完整训练导入入口保留平均值说明并核对完成结构；没有把平均值复制成逐组用时。'}
 if(!chat.splits.length&&sport==='UNKNOWN')return {ok:false as const,reason:'请先确认实际训练类型；只有时长不能判断为力量训练。'}
 if(!confirmed||!chat.hasActual||!Number.isFinite(Date.parse(occurredAt))||Date.parse(occurredAt)>Date.now()||detectRedFlags(chat.raw).level!=='NONE')return {ok:false as const,reason:'请核对实际训练日期、症状和记录，再明确确认保存。'}
 if(chat.issues.length)return {ok:false as const,reason:'请先在完整训练导入入口核对异常值；原始聊天仍保留，没有把异常数据写为训练事实。'}
 const field=<T>(value:T|null)=>({value,status:value===null?'ABSENT':'RECORDED',sourceIds:['user-confirmed']})
 const draft=createTrainingImportDraft({sport:chat.splits.length?'RUNNING':sport,occurredAt:field(occurredAt),title:field('聊天确认的训练'),durationSeconds:field(chat.minutes===null?null:chat.minutes*60),sessionRpe:field(chat.rpe),runningStructure:chat.rounds>1||chat.planned!==null?'REPEATED':'CONTINUOUS',runningSegments:chat.splits.map((s,i)=>({id:`chat-${s.round}-${s.repeat}`,kind:'REPETITION',round:field(s.round),repeat:field(s.repeat),distanceMeters:field(s.meters),durationSeconds:field(s.seconds),recoverySeconds:field(chatRestAfter(chat,i).seconds),recoveryScope:chatRestAfter(chat,i).scope,averageHeartRateBpm:field(s.heartRate),heartRateMethod:field('UNKNOWN'),completion:s.seconds===null?'NOT_RECORDED':'COMPLETED',sourceIds:['user-confirmed']})),warnings:[`聊天逐项确认；轮间休息${chat.roundRestSeconds??'未提供'}秒；${chat.rpeAssumed?'用户已确认本次RPE为整课评分':'整课评分按原自报'}`]},'TEXT',['user-confirmed'])
 const draftId=chat.id+'-'+hash(occurredAt)
 if(loadConfirmedTrainingImports().length>=100&&!loadConfirmedTrainingImports().some(r=>r.draftId===draftId))return {ok:false as const,reason:'本机记录已达容量上限，请先备份；没有覆盖旧数据。'}
 return confirmTrainingImport({...draft,draftId})
}
