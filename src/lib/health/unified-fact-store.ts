import { currentAthleteId } from '../core/events'
import { currentStore } from '../core/storage'
import { appendJournal, readJournal, storeKeys } from '../core/storage-journal'
import { normalizeFact, projectFacts, factId, type UnifiedFact } from './unified-facts'
import { healthChanged, shortHash } from './observation'
export const UNIFIED_FACT_PREFIX='fk-device-facts-v1:'
/** Called only by the existing reviewed import save action. Append, never overwrite. */
export function saveReviewedFacts(rows:readonly UnifiedFact[]){
 const athleteId=currentAthleteId(),prefix=UNIFIED_FACT_PREFIX+encodeURIComponent(athleteId)+':',errors:string[]=[];let saved=0
 // One source-history read per successful batch; never reuse an index across athletes or calls.
 let existing:Map<string,UnifiedFact>|undefined
 for(const raw of rows){const f=normalizeFact(raw);if(!f||f.athleteId!==athleteId){errors.push('无效或非本人证据未保存');continue}
  const content=JSON.stringify(f),id=shortHash(content)
  if(!existing){existing=new Map();for(const entry of readJournal<UnifiedFact>(prefix))if(!existing.has(entry.id))existing.set(entry.id,entry.data)}
  if(existing.has(id)){if(JSON.stringify(existing.get(id))!==content)errors.push('证据标识冲突，未覆盖');continue}
  if(!appendJournal(prefix,id,f)){
   errors.push('证据保存失败')
   // A failed read-back can follow a successful physical write. Re-read before the next retry.
   existing=undefined
  }else{saved++;existing.set(id,f)}
 }
 if(saved)healthChanged();return {saved,errors}
}
export function readUnifiedFacts(asOf=new Date().toISOString()){
 const athleteId=currentAthleteId(),rows=readJournal<UnifiedFact>(UNIFIED_FACT_PREFIX+encodeURIComponent(athleteId)+':').filter(x=>x.recordedAt&&Date.parse(x.recordedAt)<=Date.parse(asOf)).map(x=>x.data)
 const result=projectFacts(rows,athleteId,asOf)
 try{const box=currentStore();if(box){const prefix=UNIFIED_FACT_PREFIX+encodeURIComponent(athleteId)+':';if(storeKeys(box).filter(k=>k.startsWith(prefix)).length!==readJournal(prefix).length)result.rejected.push('UNREADABLE_JOURNAL')}}catch{result.rejected.push('UNREADABLE_JOURNAL')}
 return result
}
export function factRevisionKey(f:UnifiedFact){return `${factId(f)}@${f.revision}`}
