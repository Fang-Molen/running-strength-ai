import type { Context, EvidenceRef } from './types'
import type { EvidenceMeta, MetricFact } from '../../health/analysis-contract'
import { projectAnalysisEvidence, stableJson } from '../../health/analysis-evidence'
export const ref=(r:EvidenceMeta):EvidenceRef=>({id:r.id,revision:r.revision})
/** Same version/source conflict, retraction and as-of semantics as the existing fact layer. */
export function eligibleRecords<T extends EvidenceMeta>(rows:readonly T[],context:Context,channel:(r:T)=>string):T[]{
 const mapped:MetricFact[]=rows.map(r=>({...r,kind:'METRIC',metric:channel(r),value:1,unit:'record',statistic:'SAMPLE',windowStart:null,windowEnd:null,providerDate:null,isFinal:true,energyKind:null}))
 const projected=projectAnalysisEvidence({context,facts:mapped.map((r,i)=>({...r,modelPayload:rows[i]}))})
 // Put full payload in the semantic projection: conflicting non-metadata fields must not be deduplicated.
 return projected.facts.flatMap(f=>{
  const matches=rows.filter(r=>r.id===f.id&&r.revision===f.revision)
  return matches.length===1?[matches[0]]:[]
 })
}
export const scope=(r:EvidenceMeta)=>stableJson([r.athleteId,r.provider,r.accountRef,r.deviceId,r.protocolKey])
export const sameRef=(a:EvidenceRef,b:EvidenceRef)=>a.id===b.id&&a.revision===b.revision
export const canonical=stableJson
export const exactTime=(v:string)=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v))
