import { normalizeCoachText } from './coach-red-flags.ts'
import { withoutUnavailableMetrics } from './coach-device-conflict.ts'
export type RpeScope='SESSION_RPE'|'SET_RPE'|'SEGMENT_RPE'|'UNSPECIFIED'
export type ReportedRpe={scope:RpeScope;value:number;text:string;index:number}
/** Nearest explicit scope owns the rating; an unqualified RPE is never a session fact. */
export function parseReportedRpes(input:string):ReportedRpe[]{
 const q=input.normalize('NFKC'),out:ReportedRpe[]=[]
 const re=/(?:(session[- ]?rpe)|((?:整节课?|整堂课?|整课|全课|总体|整体)(?:的)?(?:rpe|评分|感受|用力评分)?)|((?:最后一?组|末组|单组|这一组|那一组|第[一二三四五六七八九十\d]+组)(?:的)?(?:rpe|评分)?)|((?:单段|这一段|该段|第[一二三四五六七八九十\d]+段)(?:的)?(?:rpe|评分)?)|(rpe))\s*(?:我觉得|觉得|大概|大约|约|是|为|[:：]|\s){0,8}(\d+(?:\.\d+)?)(?![\d.]|\s*(?:分钟|小时|秒|组|次|公里))/gi
 for(const m of q.matchAll(re)){
  const value=Number(m[6]);if(value<0||value>10)continue
  const before=q.slice(0,m.index).split(/[，,。；;\n]/).at(-1)??''
  if(/假设|例如|如果|目标|计划|未记录|没有|没填|若/.test(before))continue
  let scope:RpeScope=m[1]||m[2]?'SESSION_RPE':m[3]?'SET_RPE':m[4]?'SEGMENT_RPE':'UNSPECIFIED'
  if(scope==='UNSPECIFIED'){
   const markers=[...before.matchAll(/整节课?|整堂课?|整课|全课|总体|整体|最后一?组|末组|单组|这一组|那一组|第[一二三四五六七八九十\d]+组|单段|这一段|该段|第[一二三四五六七八九十\d]+段/g)]
   const marker=markers.at(-1)?.[0]
   if(marker)scope=/组/.test(marker)?'SET_RPE':/段/.test(marker)?'SEGMENT_RPE':'SESSION_RPE'
  }
  out.push({scope,value,text:m[0],index:m.index??0})
 }
 return out
}
export function statedSessionDurations(input:string):number[]{
 const q=normalizeCoachText(input),values:number[]=[]
 const re=/(?:整节课?|整堂课?|整课|全课|总时长|训练课|(?:今天|这次|刚才|刚刚)?(?:力量训练|跑步|训练|练))(?:实际|持续|时长|一共|共|是|为|了|包括热身和整理|含热身|[:：]){0,8}(?:(半)小时|(\d+(?:\.\d+)?)(?:个)?(小时|分钟|分)(半)?(?:又?(\d+(?:\.\d+)?)分钟)?)/g
 for(const m of q.matchAll(re)){
  const before=q.slice(0,m.index).split(/[，,。；;\n]/).at(-1)??''
  if(/计划|打算|准备|明天|假如|假设|如果|例如|没有|没|单组|单段|每组|每段/.test(before))continue
  const n=m[1]?30:Number(m[2])*(m[3]==='小时'?60:1)+(m[4]?30:0)+Number(m[5]??0)
  if(n>0&&n<=1440)values.push(n)
 }
 return [...new Set(values)]
}
export function statedSessionMinutes(input:string):number|null{
 const values=statedSessionDurations(input)
 // Missing unrelated device measurements do not negate an explicitly supplied duration.
 // Keep actual/planned and whole-session scope restrictions on the remaining text.
 const durationContext=withoutUnavailableMetrics(input)
 if(!values.length&&!/计划|打算|准备|明天|假如|假设|如果|例如|单组|单段|每组|主段|没有/.test(durationContext)&&/RPE/i.test(durationContext)){
  const compact=durationContext.normalize('NFKC').match(/^\s*(\d+(?:\.\d+)?)\s*分钟\s*[，,\s]+(?:整课\s*)?RPE\s*\d/i)
  if(compact&&Number(compact[1])>0&&Number(compact[1])<=1440)return Number(compact[1])
 }
 return values.length===1?values[0]:null
}
export type SessionLoad={status:'CALCULATED'|'CONDITIONAL'|'MISSING'|'CONFLICT';rpe:number|null;minutes:number|null;au:number|null;rpeOrigin:'RECORDED'|'SELF_REPORT'|'MISSING';durationOrigin:'RECORDED'|'SELF_REPORT'|'CONTINUOUS_CONDITION'|'MISSING';reported:ReportedRpe[]}
export function calculateSessionLoad(question:string,recordedRpe:number|null=null,recordedSeconds:number|null=null,continuousSeconds:number|null=null):SessionLoad{
 const reported=parseReportedRpes(question),values=[...new Set(reported.filter(x=>x.scope==='SESSION_RPE').map(x=>x.value))]
 const validRpe=recordedRpe!==null&&recordedRpe>=0&&recordedRpe<=10?recordedRpe:null
 const rpe=validRpe??(values.length===1?values[0]:null)
 const stated=statedSessionMinutes(question),recorded=recordedSeconds!==null&&recordedSeconds>0?recordedSeconds/60:null
 const continuous=continuousSeconds!==null&&continuousSeconds>0?continuousSeconds/60:null
 const minutes=recorded??stated??continuous
 const conflict=statedSessionDurations(question).length>1||recorded!==null&&stated!==null&&recorded!==stated||values.length>1||validRpe!==null&&values.some(n=>n!==validRpe)
 return {status:conflict?'CONFLICT':rpe===null||minutes===null||minutes>1440?'MISSING':recorded===null&&stated===null?'CONDITIONAL':'CALCULATED',rpe,minutes,au:!conflict&&rpe!==null&&minutes!==null&&minutes<=1440?Number((rpe*minutes).toFixed(2)):null,
 rpeOrigin:validRpe!==null?'RECORDED':values.length===1?'SELF_REPORT':'MISSING',durationOrigin:recorded!==null?'RECORDED':stated!==null?'SELF_REPORT':continuous!==null?'CONTINUOUS_CONDITION':'MISSING',reported}
}
export function formatSessionLoad(result:SessionLoad):string{
 if(result.status==='CONFLICT')return '整课评分或时长之间存在冲突，不能择值计算。请确认每条记录对应的训练与有效值。'
 if(result.status==='MISSING')return 'session-RPE＝整课RPE × 整课实际分钟，单位AU；单组或末组评分不用于整课负荷。整课RPE和包含热身、恢复、整理的总时长各是多少？'
 const fmt=(n:number)=>Number(n.toFixed(2))
 const condition=result.status==='CONDITIONAL'?'若该段覆盖完整训练课；如另有热身、恢复或整理，须先补全':result.durationOrigin==='RECORDED'?'使用已记录整课时长，包含热身、恢复与整理的口径需一致':'按本次自报完整课时长'
 return `整课RPE ${fmt(result.rpe!)} × ${fmt(result.minutes!)} 分钟 = ${fmt(result.au!)} AU（条件：${condition}）。单组或末组RPE不用于整课负荷。它是单课相对负荷，不是疲劳百分比或伤病概率；周比较要同口径。${result.rpeOrigin==='SELF_REPORT'||result.durationOrigin==='SELF_REPORT'?'聊天自报未保存，需本人确认后保存。':''}${result.status==='CONDITIONAL'?'这段时间是否覆盖整堂课？':''}`
}
