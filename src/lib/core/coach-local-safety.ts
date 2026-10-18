import { detectRedFlags, redFlagResponse } from './coach-red-flags.ts'
/** Compatibility facade; richer urgency is retained by the shared red-flag result. */
export type LocalSafety='EMERGENCY'|'MEDICAL_REVIEW'|'NONE'
export function screenLocalSafety(question:string):{level:LocalSafety;signals:string[];historical:string[];psychological:boolean}{
 const result=detectRedFlags(question)
 return {level:result.level==='URGENT_MEDICAL'?'MEDICAL_REVIEW':result.level,signals:result.evidence,
  historical:result.temporal==='HISTORY'?['既往症状记录']:[],psychological:result.classes.includes('PSYCHOLOGICAL')}
}
export function classifyLocalSafety(question:string):LocalSafety{return screenLocalSafety(question).level}
export function localSafetyAction(question:string):string|null{
 const result=detectRedFlags(question)
 return result.level==='EMERGENCY'||result.level==='URGENT_MEDICAL'||result.level==='MEDICAL_REVIEW'&&result.classes.some(c=>['ENERGY','POST_ILLNESS'].includes(c))?redFlagResponse(result):null
}
export function localMedicalReviewGuidance(question:string):string{
 const result=detectRedFlags(question)
 return redFlagResponse(result)??'先停止诱发不适的动作，必要时寻求运动医学或康复评估；不能由聊天判断原因。具体哪里不适、何时出现，现在是否影响日常活动？'
}
