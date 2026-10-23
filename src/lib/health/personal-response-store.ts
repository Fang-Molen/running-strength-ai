import type { ResponseFact } from './analysis-contract'
import { currentAthleteId } from '../core/events'
import { appendJournal, readJournal } from '../core/storage-journal'
import { healthChanged } from './observation'
import { validAnalysisFact, stableJson } from './analysis-evidence'
const prefix=(athlete:string)=>'fk-analysis-response-v1:'+encodeURIComponent(athlete)+':'
/** Explicit user save only. Never invoked by analysis/rendering. */
export function savePersonalResponse(f:ResponseFact){
 const athlete=currentAthleteId(),now=new Date().toISOString()
 if(f.athleteId!==athlete||f.kind!=='RESPONSE'||!validAnalysisFact(f)||Date.parse(f.occurredAt)>Date.parse(now))return {ok:false as const,error:'INVALID_RESPONSE'}
 const rows=readJournal<ResponseFact>(prefix(athlete)).map(r=>r.data),same=rows.find(x=>x.id===f.id&&x.revision===f.revision)
 if(same)return stableJson({...same,knownAt:f.knownAt,receivedAt:f.receivedAt})===stableJson(f)?{ok:true as const,receipt:`${f.id}@${f.revision}`}:{ok:false as const,error:'REVISION_CONFLICT'}
 if(rows.some(x=>x.id===f.id&&x.revision>=f.revision))return {ok:false as const,error:'STALE_REVISION'}
 const ok=appendJournal(prefix(athlete),`${f.id}@${f.revision}`,{...f,knownAt:now,receivedAt:now})
 if(ok)healthChanged();return ok?{ok:true as const,receipt:`${f.id}@${f.revision}`}:{ok:false as const,error:'PERSIST_FAILED'}
}
export function readPersonalResponses(asOf:string){return readJournal<ResponseFact>(prefix(currentAthleteId())).filter(r=>r.recordedAt&&Date.parse(r.recordedAt)<=Date.parse(asOf)).map(r=>r.data)}
