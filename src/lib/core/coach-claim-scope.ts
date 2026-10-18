import { parseReportedRpes, calculateSessionLoad, formatSessionLoad } from './coach-session-load.ts'
export { parseReportedRpes } from './coach-session-load.ts'
/** Scope lexical claims before checking numbers. Conditions/examples are not completed facts. */
export function isConditionalAdvice(text:string):boolean {
 return /若|如果|仅在|前提|条件|核对.{0,12}后|确认.{0,12}后/.test(text) &&
  /候选|考虑|尝试|建议|可以|可先|再|保持|降低|减少|调整/.test(text) &&
  /停止|停下|撤回|退回|终止|复查|复核|反馈/.test(text)
}
export function isNonFactNumber(text:string,index:number):boolean {
 const start=Math.max(text.lastIndexOf('。',index),text.lastIndexOf('；',index),text.lastIndexOf('\n',index))+1
 const before=text.slice(start,index)
 if(/^(?:RPE|主观恢复|疼痛|酸痛)\s*(?:评分|范围|为|是)?\s*\d+(?:\.\d+)?\s*[-–—~～至到]\s*\d+/i.test(text.slice(index)))return true
 // Require a local scope marker, not a blanket exemption for the whole answer.
 return /(?:例如|举例|假设|如果|若|目标|建议|候选|范围|通常|一般|可考虑|控制在)[^。；\n]{0,70}$/.test(before)
}
export function reportedSessionRpes(question:string):number[] {
 return [...new Set(parseReportedRpes(question).filter(x=>x.scope==='SESSION_RPE').map(x=>x.value))]
}
export function sessionLoadAnswer(question:string,rpe:number|null,totalSeconds:number|null,continuousSeconds:number|null=null):string|null {
 const result=calculateSessionLoad(question,rpe,totalSeconds,continuousSeconds)
 const selfReported=calculateSessionLoad(question)
 if(!/sRPE|session[- ]?RPE|AU|整课负荷|训练负荷.*(?:算|多少)/i.test(question)&&!(selfReported.status==='CALCULATED'&&selfReported.rpeOrigin==='SELF_REPORT'&&selfReported.durationOrigin==='SELF_REPORT'))return null
 return result.status==='CONFLICT'?null:formatSessionLoad(result)
}
