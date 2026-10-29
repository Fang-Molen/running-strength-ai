/** App-independent capture service. Facts use the existing atomic event writer. */
import {createAppEvent, currentAthleteId, loadEvents, notifyCommittedEvent} from '../core/events'
import {currentStore} from '../core/storage'
import {commitRunningTransaction} from '../core/running-transaction'
import {coachImports, importedCoachParts} from '../core/coach-import-evidence'
import {loadImportRatings} from '../core/coach-import-rating'
import {listTrainingOccurrences} from '../core/occurrence'
import {appendCorrection, listCorrections, occurrenceVoided} from '../core/training-correction'
import {validDate} from './fieldwork-plan-drafts'
import {todayDate} from '../nutrition/body'
import type {AppEvent} from '../core/types'

export type CaptureKind='feedback'|'body'
export type CaptureDraft={id:string;owner:string;kind:CaptureKind;occurrenceId:string|null;version:string;date:string;text:string;rpe:string;recovery:string;soreness:string;location:string}
export type CaptureReceipt={id:string;owner:string;kind:CaptureKind;occurrenceId:string|null;eventIds:string[];savedAt:string;summary:string;version:string;undoSafe:boolean}
export {openPetCapture, PET_CAPTURE_OPEN, type CaptureAction} from './pet-capture-navigation'
const key=(kind:CaptureKind,owner=currentAthleteId())=>`fk-pet-capture-draft-v1:${encodeURIComponent(owner)}:${kind}`
const ownEvents=()=>loadEvents().filter(e=>e.athlete_id===currentAthleteId())
function target(id:string){
 const imported=coachImports().find(r=>r.confirmedImportId===id)
 const native=listTrainingOccurrences().find(r=>r.trainingOccurrenceId===id&&ownEvents().some(e=>e.event_id===r.startEventId&&e.event_type==='TRAINING_STARTED'))
 return !occurrenceVoided(id)&&(imported||native)?{imported,native}:null
}
export function captureTargets(){const imported=coachImports().filter(r=>!occurrenceVoided(r.confirmedImportId)).map(r=>({id:r.confirmedImportId,label:`${r.occurredAt.value?.slice(0,10)} · ${r.title.value||'导入训练'} · ${r.confirmedImportId.slice(-6)}`}));const native=listTrainingOccurrences().filter(r=>target(r.trainingOccurrenceId)).map(r=>({id:r.trainingOccurrenceId,label:`${r.startedAt?.slice(0,10)} · ${r.sessionId} · ${r.trainingOccurrenceId.slice(-6)}`}));return [...imported,...native]}
function version(id:string|null){return id?JSON.stringify([target(id),ownEvents().filter(e=>e.payload.trainingOccurrenceId===id),listCorrections(id),loadImportRatings().filter(r=>r.occurrenceId===id&&r.athleteId===currentAthleteId())]):''}
export function newCaptureDraft(kind:CaptureKind,occurrenceId:string|null=null):CaptureDraft{return {id:crypto.randomUUID(),owner:currentAthleteId(),kind,occurrenceId,version:version(occurrenceId),date:todayDate(),text:'',rpe:'',recovery:'',soreness:'',location:''}}
export function persistCaptureDraft(draft:CaptureDraft):boolean{if(draft.owner!==currentAthleteId())return false;try{const value=JSON.stringify(draft),s=currentStore();s?.setItem(key(draft.kind),value);return s?.getItem(key(draft.kind))===value}catch{return false}}
export function readCaptureDraft(kind:CaptureKind):CaptureDraft|null{try{const d=JSON.parse(currentStore()?.getItem(key(kind))||'null');return d?.owner===currentAthleteId()&&d.kind===kind&&typeof d.id==='string'&&['date','text','rpe','recovery','soreness','location','version'].every(k=>typeof d[k]==='string')?d:null}catch{return null}}
export function parseCaptureText(input:string):Pick<CaptureDraft,'rpe'|'recovery'|'soreness'|'location'>{
 const empty={rpe:'',recovery:'',soreness:'',location:''};if(/朋友|他|她|队友|家人|教练说/.test(input))return empty
 const rpe=input.match(/(?:RPE|用力(?:程度)?)\s*([1-9]|10)(?!\d)/i)?.[1]??''
 const recovery=input.match(/恢复(?:感受|状态)?\s*([1-9]|10)(?!\d)/)?.[1]??''
 const soreness=/(?:没有|不|无|没)\s*(?:酸痛|酸|痛)/.test(input)?'':input.match(/(?:酸痛|酸)\s*([1-9]|10)(?!\d)/)?.[1]??''
 return {rpe,recovery,soreness,location:soreness?input.match(/(?:左|右)?(?:小腿|大腿|膝盖?|脚踝|腰|背|肩|臀)(?=.{0,4}(?:酸痛|酸))/)?.[0]??'':''}
}
export function captureReceipts():CaptureReceipt[]{return ownEvents().flatMap(e=>{const r=e.payload.captureReceipt as CaptureReceipt|undefined;return r?.owner===currentAthleteId()&&Array.isArray(r.eventIds)?[r]:[]})}
function bad(reason:string){return {ok:false as const,reason}}
export function saveCaptureDraft(d:CaptureDraft):{ok:true;receipt:CaptureReceipt}|{ok:false;reason:string}{
 if(d.owner!==currentAthleteId())return bad('运动员已切换，请重新打开；原草稿留在原档案。')
 const prior=captureReceipts().find(r=>r.id===d.id);if(prior)return {ok:true,receipt:prior}
 if(!validDate(d.date)||d.date>todayDate())return bad('请选择有效的实际日期，不能记入未来。')
 const selected=d.kind==='feedback'&&d.occurrenceId?target(d.occurrenceId):null
 if(d.kind==='feedback'&&!selected)return bad('请明确选择本人已有的训练。')
 if(d.kind==='feedback'&&version(d.occurrenceId)!==d.version)return bad('所选训练已变化，请重新选择并核对草稿。')
 const fields=[['SESSION_RPE',d.kind==='feedback'?d.rpe:''],['SUBJECTIVE_RECOVERY',d.recovery],['SORENESS',d.soreness]] as const
 if(!fields.some(([,v])=>v.trim()))return bad('请填写至少一项；未填写的保持未知。')
 if(fields.some(([,v])=>v.trim()&&(!/^([1-9]|10)$/.test(v.trim()))))return bad('评分需为1到10的整数；未知请留空。')
 if(d.soreness.trim()&&!d.location.trim())return bad('请填写酸痛部位。')
 const existing=ownEvents().filter(e=>e.payload.trainingOccurrenceId===d.occurrenceId)
 if(selected){
  const imported=selected.imported
  const parts=imported?importedCoachParts(imported,'记录反馈'):null
  if(fields.some(([kind,value])=>value.trim()&&(existing.some(e=>e.payload.evidenceType===kind)||(kind==='SESSION_RPE'&&(imported?.sessionRpe.status==='RECORDED'||loadImportRatings().some(r=>r.athleteId===d.owner&&r.occurrenceId===d.occurrenceId)))||(kind==='SORENESS'&&parts?.soreness)||(kind==='SUBJECTIVE_RECOVERY'&&parts?.subjectiveRecovery!=null))))return bad('此项已有反馈；请在原记录查看差异后更正。')
 }
 const savedAt=new Date().toISOString(),events:AppEvent[]=fields.filter(([,v])=>v.trim()).map(([kind,value])=>{
  const event=createAppEvent(kind==='SESSION_RPE'?'RPE_RECORDED':'SUBJECTIVE_FEEDBACK',{evidenceType:kind,...(kind==='SESSION_RPE'?{ratingCollectedAt:savedAt,ratingScale:'0-10_SESSION_RPE'}:{}),...(kind==='SORENESS'?{intensity:Number(value),location:d.location.trim()}:{value:Number(value)}),...(d.kind==='feedback'?{trainingOccurrenceId:d.occurrenceId}:{}),date:d.date,captureId:d.id,source:'USER_CONFIRMED',note:d.text.trim()})
  if(d.kind==='body'&&d.date!==todayDate())event.timestamp=new Date(`${d.date}T12:00:00`).toISOString()
  return event
 })
 const summary=[d.kind==='feedback'?'训练反馈':'身体状态',...fields.filter(([,v])=>v.trim()).map(([kind,v])=>`${kind==='SESSION_RPE'?'RPE':kind==='SUBJECTIVE_RECOVERY'?'恢复感受':d.location+'酸痛'} ${v}/10`)].join(' · ')
 const original=selected?.imported
 const undoSafe=!!original&&[original.sessionRpe,original.subjectiveRecovery,original.soreness,original.pain,original.sleepHours].every(f=>f.status!=='RECORDED')&&!existing.some(e=>typeof e.payload.evidenceType==='string')&&!loadImportRatings().some(r=>r.athleteId===d.owner&&r.occurrenceId===d.occurrenceId)
 const receipt:CaptureReceipt={id:d.id,owner:d.owner,kind:d.kind,occurrenceId:d.occurrenceId,eventIds:events.map(e=>e.event_id),savedAt,summary,version:d.version,undoSafe}
 events[0].payload.captureReceipt=receipt
 // A single immutable transaction prevents half-saved RPE/body feedback.
 if(!commitRunningTransaction({version:1,id:`pet:${d.owner}:${d.id}`,events}))return bad('保存失败，草稿仍保留；请重试。')
 if(!captureReceipts().some(r=>r.id===d.id))return bad('未能回读保存结果，草稿仍保留。')
 for(const event of events)notifyCommittedEvent(event)
 try{currentStore()?.removeItem?.(key(d.kind));if(typeof window!=='undefined')window.dispatchEvent(new Event('fk-training-activities-changed'))}catch{/* committed receipt is durable */}
 return {ok:true,receipt}
}
/** Feedback withdrawal is allowed only before any later fact/correction touches this training. */
export function undoCapture(id:string):{ok:boolean;reason:string}{
 const receipt=captureReceipts().find(r=>r.id===id);if(!receipt||!receipt.undoSafe||receipt.kind!=='feedback'||!receipt.occurrenceId)return bad('此记录需在原记录中核对后更正。')
 const related=ownEvents().filter(e=>e.payload.trainingOccurrenceId===receipt.occurrenceId)
 const after=related.some(e=>!receipt.eventIds.includes(e.event_id)&&Date.parse(e.timestamp)>=Date.parse(receipt.savedAt))
 if(after||listCorrections(receipt.occurrenceId).some(c=>!c.recordedAt||Date.parse(c.recordedAt)>=Date.parse(receipt.savedAt)))return bad('训练已有后续修改，不能自动撤销；请核对原记录。')
 const correction=appendCorrection({trainingOccurrenceId:receipt.occurrenceId,kind:'FIELD',field:'feedback',reason:`撤销快捷反馈 ${receipt.id}`,originalValue:receipt.summary,newValue:''})
 return correction?{ok:true,reason:'已撤销本次反馈，原始训练保留。'}:bad('撤销失败，原记录保留。')
}
