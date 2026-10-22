/** Uses C03's existing append-only dependency review, never a second claim store. */
import { currentAthleteId } from '../core/events'
import { registerCoachHypothesis,readCoachFollowupHistory,recheckCoachForecastDependencies,type C03QuerySnapshot } from '../coach/c03/followup'
import type { EvidenceDecision } from './evidence-decision'
export function retainEvidenceDecision(d:EvidenceDecision){
 const now=Date.now(),c={actorId:`local-profile:${currentAthleteId()}`,athleteId:currentAthleteId(),asOf:now}
 if(d.athleteId!==c.athleteId||Date.parse(d.asOf)>now)return {ok:false,reason:'CONTEXT_CHANGED'}
 const scopeKey=`batch99:${c.athleteId}:${d.day}`
 const basis:C03QuerySnapshot={scopeKey,athleteId:c.athleteId,asOf:now,state:d.conflicts.length?'CONFLICT':'COMPLETE',dataKey:JSON.stringify(d.evidence),provenanceKey:d.revision,completeRead:!d.conflicts.length}
 const prior=readCoachFollowupHistory(c);if(prior.status!=='AVAILABLE')return {ok:false,reason:prior.reason}
 const changes=recheckCoachForecastDependencies(c,[basis],key=>key===scopeKey)
 if(!changes.ok)return changes
 for(const h of d.hypotheses){
  const support=d.evidence.filter(e=>h.support.includes(e.id)&&e.sourceIds.length)
  if(!support.length)continue
  const id=`batch99:${d.day}:${h.id}`,versions=prior.records.filter(r=>r.kind==='HYPOTHESIS'&&r.input.id===id)
  const last=versions.at(-1)
  if(last?.kind==='HYPOTHESIS'&&last.input.basis[0]?.provenanceKey===d.revision)continue
  const revision=last?.kind==='HYPOTHESIS'?last.input.revision+1:1
  const saved=registerCoachHypothesis(c,{id,revision,reviewId:d.revision,observedOccurrenceId:null,explanation:h.possibility,supportEvidence:support.flatMap(e=>e.sourceIds.map(sourceId=>({sourceId,revision:d.revision,fieldPaths:['actual']}))),counterEvidence:[],missing:h.missing,supportingObservations:support.map(e=>e.text),counterConditions:h.against,alternativeExplanations:d.hypotheses.filter(x=>x.id!==h.id).map(x=>x.possibility),nextObservation:h.observe,basis:[basis]})
  if(!saved.ok)return saved
 }
 return {ok:true,reason:'RETAINED_WITH_DEPENDENCIES'}
}

/** Called by the existing App-level C03 save/change observer, never by a pure read. */
export async function refreshEvidenceDecisions(){
 const athleteId=currentAthleteId(),c={actorId:`local-profile:${athleteId}`,athleteId,asOf:Date.now()},history=readCoachFollowupHistory(c)
 if(history.status!=='AVAILABLE')return {ok:false,reason:history.reason}
 const [{readEvidenceDecision},{localDay,validDay}]=await Promise.all([import('./evidence-decision-host'),import('./observation')])
 if(currentAthleteId()!==athleteId)return {ok:false,reason:'CONTEXT_CHANGED'}
 const today=localDay(),prefix=`batch99:${athleteId}:`,days=new Set([today])
 for(const r of history.records)if(r.kind==='HYPOTHESIS')for(const b of r.input.basis)if(b.scopeKey.startsWith(prefix)){const day=b.scopeKey.slice(prefix.length);if(validDay(day)&&day<=today)days.add(day)}
 for(const day of days){if(currentAthleteId()!==athleteId)return {ok:false,reason:'CONTEXT_CHANGED'};const r=retainEvidenceDecision(readEvidenceDecision(day));if(!r.ok)return r}
 return {ok:true,reason:'RECHECKED_CURRENT_AND_RETAINED_DAYS'}
}
