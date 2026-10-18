import type { FatigueBand } from './agent'
import { acceptExplanation } from './coach'
import { deriveCoachBrief,guardCoachResponse,type CoachTurn } from '@/lib/core/coach-brief'
import { DIAGNOSIS_TERMS,filterDiagnosisWording } from '@/lib/core/coach-diagnosis-wording'
import { detectRedFlags,redFlagResponse,RED_FLAG_PRIORITY,type RedFlagResult } from '@/lib/core/coach-red-flags'
import { validateCoachCompletion } from '@/lib/core/coach-output-contract'

export type ExplainInput={text:string;decision:string;band:FatigueBand;goals:string;notes:string;energy:string}
export const EXPLANATION_RESPONSE_FORMAT={type:'json_schema',json_schema:{name:'coach_explanation',strict:true,schema:{
 type:'object',properties:{text:{type:'string'},citations:{type:'array',items:{type:'string'}}},required:['text','citations'],additionalProperties:false,
}}} as const

/** Separate input fields retain their own context; one field cannot negate another field's acute report. */
export function localSafetyForTexts(texts:readonly string[]):CoachTurn|null{
 const results=texts.map(text=>detectRedFlags(text)).filter(result=>result.level!=='NONE')
 if(!results.length)return null
 const highest=results.reduce((a,b)=>RED_FLAG_PRIORITY[a.level]>=RED_FLAG_PRIORITY[b.level]?a:b)
 const result:RedFlagResult={...highest,classes:[...new Set(results.flatMap(item=>item.classes))],evidence:[...new Set(results.flatMap(item=>item.evidence))]}
 return {mode:'answer',text:redFlagResponse(result)!,nextStep:null,citations:[],medicalReferral:true,planChanged:false}
}
export function explanationSafety(data:ExplainInput):CoachTurn|null{
 return localSafetyForTexts([data.text,data.notes,data.energy,data.goals])
}
function localExplanation(data:ExplainInput):string{
 return data.band==='tired'||data.band==='cooked'
  ?'这次先把负荷保持在保守范围，避免在疲劳偏高时继续增加要求。规则调整不能证明已经恢复，仍需结合真实训练记录和身体反馈核对。'
  :'这次先沿用现有规则，调整原因需要结合已核对的训练记录解释。仅凭这段描述不能判断恢复状态，也不能新增训练剂量。'
}
function explanationBrief(data:ExplainInput){
 return deriveCoachBrief({question:data.text||'解释已有规则调整',occurrenceId:null,runningStructure:'UNAVAILABLE',sessionRpe:null,sleepHours:null,
  subjectiveRecovery:null,recoveryState:null,fatigueState:null,duplicateCount:0,repetitionSlots:0,continuousCount:0,plannedSetCount:null,
  completedSetCount:null,durationSec:null,pain:false,soreness:false,daysToCompetition:null,week:null,bias:null,sourceIds:[],sources:[],running:[]})
}
type ExplanationReview={text:string;flags:string[];accepted:boolean;localSafety:boolean}
/** This legacy route has no formal evidence rows: prose notes cannot authorize quantities or citations. */
export function reviewCoachExplanation(data:ExplainInput,raw:string):ExplanationReview{
 const preflight=explanationSafety(data)
 if(preflight)return {text:preflight.text,flags:['RED_FLAG_PRE_AND_POST'],accepted:true,localSafety:true}
 const contract=validateCoachCompletion(raw)
 const parsed=contract.success?contract.data:null
 const visible=parsed?[parsed.text,parsed.nextStep].filter((value):value is string=>typeof value==='string').join(' '):''
 const postflight=localSafetyForTexts([visible])
 if(postflight)return {text:postflight.text,flags:['RED_FLAG_PRE_AND_POST'],accepted:true,localSafety:true}
 const flags:string[]=[]
 if(!parsed||typeof parsed.text!=='string'||!Array.isArray(parsed.citations)||parsed.sections)flags.push('MODEL_SCHEMA_INVALID')
 if(parsed?.citations?.length)flags.push('UNKNOWN_OR_REVOKED_SOURCE')
 if(parsed?.nextStep)flags.push('UNSUPPORTED_EXPLANATION_NEXT_STEP')
 if(filterDiagnosisWording(visible).issues.length)flags.push('DIAGNOSIS_WORDING_FILTERED')
 const supplied=[data.text,data.notes,data.energy,data.goals].join('。')
 const attributed=/按你提供的(?:医生|医疗)|你提到医生(?:已)?诊断|据你转述的医生诊断/
 for(const sentence of visible.split(/[。！？!?；;\n]/))if(attributed.test(sentence)){
  const terms=DIAGNOSIS_TERMS.filter(term=>sentence.toLowerCase().includes(term.toLowerCase()))
  if(terms.some(term=>!supplied.split(/[，,。！？!?；;\n]/).some(input=>{
   const index=input.toLowerCase().indexOf(term.toLowerCase())
   const prefix=index<0?'':input.slice(0,index+term.length)
   return index>=0&&/医生.{0,12}诊断|诊断.{0,12}医生/.test(input)&&!/(?:没有|并非|不是|否认|未曾|从未|尚未|不曾|并无|未被|没被|未诊断|未确诊|不能确诊)/.test(prefix)
  })))flags.push('UNVERIFIED_DIAGNOSIS_ATTRIBUTION')
 }
 const number='(?:\\d+(?:\\.\\d+)?|[零〇一二两三四五六七八九十百千万]+)'
 const quantity=new RegExp(`${number}\\s*(?:kg|公斤|千克|组|次|秒|分钟|小时|公里|千米|km|米|m|kcal|千卡|大卡|au|%|％|bpm)(?![a-z])|(?:rpe|心率|配速|用时|耗时|负荷|跑量|疲劳分|恢复分)\\s*(?:为|是|[:：])?\\s*${number}`,'i')
 if(quantity.test(visible.normalize('NFKC')))flags.push('UNVERIFIED_EXPLANATION_QUANTITY')
 const accepted=parsed&&typeof parsed.text==='string'?acceptExplanation(parsed.text,data.band):null
 if(!accepted)flags.push('UNSUPPORTED_EXPLANATION')
 const guarded=accepted?guardCoachResponse(explanationBrief(data),JSON.stringify({mode:'answer',text:accepted,nextStep:null,citations:[]})):null
 if(guarded&&(guarded.mode==='unavailable'||!guarded.text.startsWith(accepted!)))flags.push('UNSUPPORTED_EXPLANATION_CLAIM')
 return flags.length?{text:localExplanation(data),flags:[...new Set(flags)],accepted:false,localSafety:false}
  :{text:guarded!.text,flags:[],accepted:true,localSafety:false}
}

/** The callback owns provider transport/access. Only one repair is permitted, and red flags never call it. */
export async function explainWithOneRepair(data:ExplainInput,generate:(attempt:0|1,flags:string[])=>Promise<string>){
 const safety=explanationSafety(data)
 if(safety)return {text:safety.text,flags:['RED_FLAG_PRE_AND_POST'],repair:{attempts:0,initialFlags:['RED_FLAG_PRE_AND_POST'],failed:false}}
 const first=reviewCoachExplanation(data,await generate(0,[]))
 if(first.accepted||first.localSafety)return {...first,repair:{attempts:0,initialFlags:first.flags,failed:false}}
 try{
  const second=reviewCoachExplanation(data,await generate(1,first.flags))
  return {...second,repair:{attempts:1,initialFlags:first.flags,failed:!second.accepted}}
 }catch{return {...first,repair:{attempts:1,initialFlags:first.flags,failed:true}}}
}
