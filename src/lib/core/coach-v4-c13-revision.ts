import type {EvolutionSnapshot} from './coach-evolution-v4.ts'
/** C13: source-dependent claim invalidation; no automatic persistent memory update. */
export type PriorClaim=Readonly<{claimId:string;sourceIds:readonly string[];text:string}>
export type ClaimRevision={claimId:string;status:'RETRACT_AND_REASSESS'|'UNVERIFIED_PRIOR_CLAIM'|'NO_SOURCE_CHANGE';invalidatedSourceIds:string[];reason:string}
export function revisePriorClaims(previous:EvolutionSnapshot,next:EvolutionSnapshot,claims:readonly PriorClaim[]):ClaimRevision[]{
 if(previous.athleteId!==next.athleteId||Date.parse(next.asOf)<=Date.parse(previous.asOf))throw Error('INVALID_CLAIM_REVISION_WINDOW')
 const before=new Set(previous.active.map(x=>x.sourceId)),after=new Set(next.active.map(x=>x.sourceId))
 return claims.map(c=>{
  if(c.sourceIds.length===0)return {claimId:c.claimId,status:'UNVERIFIED_PRIOR_CLAIM',invalidatedSourceIds:[],reason:'PRIOR_CLAIM_HAS_NO_SOURCE'}
  const unknown=c.sourceIds.filter(x=>!before.has(x))
  if(unknown.length)return {claimId:c.claimId,status:'UNVERIFIED_PRIOR_CLAIM',invalidatedSourceIds:[...new Set(unknown)],reason:'PRIOR_CLAIM_SOURCE_NOT_VISIBLE'}
  const signature=(s:EvolutionSnapshot,id:string)=>JSON.stringify(s.active.filter(x=>x.sourceId===id)
   .map(x=>JSON.stringify([x.id,x.occurrenceId,x.metric,x.value,x.unit,x.context,x.eventAt,x.recordedAt,x.source,x.confirmation,x.supersedes])).sort())
  const withdrawn=c.sourceIds.filter(x=>!after.has(x)||signature(previous,x)!==signature(next,x))
  return withdrawn.length?{claimId:c.claimId,status:'RETRACT_AND_REASSESS',invalidatedSourceIds:[...new Set(withdrawn)],reason:'SOURCE_WITHDRAWN_OR_CORRECTED'}:
   {claimId:c.claimId,status:'NO_SOURCE_CHANGE',invalidatedSourceIds:[],reason:'NO_SOURCE_CHANGE_DOES_NOT_PROVE_CAUSALITY'}
 })
}
