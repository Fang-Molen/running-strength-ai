import {readEnvelope,writeEnvelope} from './storage.ts'
import {loadConfirmedTrainingImports,normalizeConfirmedTrainingImport} from './training-import.ts'
import {occurrenceVoided} from './training-correction.ts'
import {currentAthleteId} from './events.ts'
export const IMPORT_RATING_KEY='fangkun-import-session-ratings-v1'
export type ImportRating={id:string;occurrenceId:string;athleteId:string;value:number;recordedAt:string;eventAt:string;scope:'SESSION_RPE'}
export function loadImportRatings():ImportRating[]{
 const data=readEnvelope<unknown>(IMPORT_RATING_KEY,[]).data
 return Array.isArray(data)?data.filter((r):r is ImportRating=>r&&typeof r.id==='string'&&typeof r.occurrenceId==='string'&&typeof r.athleteId==='string'&&r.scope==='SESSION_RPE'&&Number.isInteger(r.value)&&r.value>=1&&r.value<=10&&Number.isFinite(Date.parse(r.recordedAt))&&Number.isFinite(Date.parse(r.eventAt))):[]
}
/** Only invoked by explicit confirmation. Appends a new timestamped fact; original import is immutable. */
export function confirmImportedSessionRpe(occurrenceId:string,value:number):{ok:boolean;reason:string}{
 const r=loadConfirmedTrainingImports().map(normalizeConfirmedTrainingImport).find(x=>x?.confirmedImportId===occurrenceId&&(x.athleteId??'local')===currentAthleteId())
 if(!r||occurrenceVoided(occurrenceId))return {ok:false,reason:'找不到有效的所选导入。'}
 if(!Number.isInteger(value)||value<1||value>10)return {ok:false,reason:'整课评分需为1到10的整数。'}
 const old=loadImportRatings()
 if(r.sessionRpe.status==='RECORDED'||old.some(x=>x.occurrenceId===occurrenceId&&x.athleteId===(r.athleteId??'local')))return {ok:false,reason:'已有整课评分，请走原记录更正流程，不重复写入。'}
 const now=new Date().toISOString(),id=`import-rating:${r.draftId}:${Date.now()}`
 const fact:ImportRating={id,occurrenceId,athleteId:r.athleteId??'local',value,recordedAt:now,eventAt:r.occurredAt.value!,scope:'SESSION_RPE'}
 if(!writeEnvelope(IMPORT_RATING_KEY,[...old,fact]))return {ok:false,reason:'保存失败，评分未确认。'}
 return {ok:loadImportRatings().some(x=>x.id===id),reason:'已保存为所选导入的整课RPE；原导入及其他组未改动。'}
}
