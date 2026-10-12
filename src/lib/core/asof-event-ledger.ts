/** K19: read-only as-of ledger with knowledge-time gating and explicit revisions.
 * A historical decision may use only records actually known at that cutoff.
 * No prescriptions, clinical clearance, or performance causality.
 */
import { reviewAsOf, buildAsOfModelContext } from './prospective-evidence.ts'
import type { AthleteEvidence } from './athlete-evidence-audit.ts'

export type KnownEvent = Readonly<{
  eventId:string
  observedAt:string // ISO timestamp, including timezone
  fact:AthleteEvidence
  operation:'ASSERT'|'CORRECT'|'RETRACT'
  replacesEventId?:string
}>
export type AsOfLedger = Readonly<{
  status:'REVIEWABLE'|'NEEDS_RECONCILIATION'|'INVALID_CUTOFF'
  cutoff:string
  facts:AthleteEvidence[]
  issues:string[]
  quarantinedEventIds:string[]
  hiddenFutureEventCount:number
  trainingDecisionAuthorized:false
  clinicalClearance:'UNKNOWN'
}>
export const validTimestamp=(s:string)=>typeof s==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(s)&&Number.isFinite(Date.parse(s))&&validDay(s.slice(0,10))&&Number(s.slice(11,13))<24&&Number(s.slice(14,16))<60&&Number(s.slice(17,19))<60
const validDay=(s:string)=>/^\d{4}-\d\d-\d\d$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s
export const asOfDay=(s:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(s))
const sorted=(x:readonly KnownEvent[])=>[...x].sort((a,b)=>Date.parse(a.observedAt)-Date.parse(b.observedAt)||a.eventId.localeCompare(b.eventId))

export function snapshotKnownEvents(events:readonly KnownEvent[],cutoff:string):AsOfLedger {
 const base={cutoff,trainingDecisionAuthorized:false as const,clinicalClearance:'UNKNOWN' as const}
 if(!validTimestamp(cutoff))return {...base,status:'INVALID_CUTOFF',facts:[],issues:['INVALID_CUTOFF'],quarantinedEventIds:[],hiddenFutureEventCount:0}
 const future=events.filter(e=>validTimestamp(e.observedAt)&&Date.parse(e.observedAt)>Date.parse(cutoff))
 const visible=sorted(events.filter(e=>validTimestamp(e.observedAt)&&Date.parse(e.observedAt)<=Date.parse(cutoff)))
 const issues:string[]=[]
 const bad=[...events.filter(e=>!validTimestamp(e.observedAt)),...visible.filter(e=>!e.eventId||!validDay(e.fact.date)||!['ASSERT','CORRECT','RETRACT'].includes(e.operation)||(e.operation==='ASSERT'&&e.replacesEventId!==undefined))]
 if(bad.length)issues.push('INVALID_EVENT_QUARANTINED')
 const quarantined=new Set(bad.map(e=>e.eventId))
 const seen=new Map<string,KnownEvent>()
 for(const e of visible){
  if(quarantined.has(e.eventId))continue
  const prior=seen.get(e.eventId)
  if(prior && JSON.stringify(prior)!==JSON.stringify(e)){issues.push('DUPLICATE_EVENT_ID');quarantined.add(e.eventId)}
  else if(!prior)seen.set(e.eventId,e)
 }
 const replaced=new Set<string>()
 const replacementTargets=new Map<string,string>()
 for(const e of seen.values()){
  if(quarantined.has(e.eventId)||e.operation==='ASSERT')continue
  const target=e.replacesEventId?seen.get(e.replacesEventId):undefined
  if(!target||quarantined.has(target.eventId)||target.fact.id!==e.fact.id||target.operation==='RETRACT'||Date.parse(target.observedAt)>Date.parse(e.observedAt)||target.eventId===e.eventId){
   issues.push('INVALID_REVISION_CHAIN');quarantined.add(e.eventId);continue
  }
  if(replacementTargets.has(target.eventId)){
   issues.push('CONFLICTING_REVISIONS');quarantined.add(e.eventId);quarantined.add(replacementTargets.get(target.eventId)!);quarantined.add(target.eventId)
  }else replacementTargets.set(target.eventId,e.eventId)
  replaced.add(target.eventId)
 }
 // A branch whose parent was later quarantined cannot survive as an accepted fact.
 let changed=true
 while(changed){changed=false;for(const e of seen.values())if(e.replacesEventId&&quarantined.has(e.replacesEventId)&&!quarantined.has(e.eventId)){quarantined.add(e.eventId);changed=true;issues.push('INVALID_REVISION_CHAIN')}}
 const facts=[...seen.values()].filter(e=>!quarantined.has(e.eventId)&&!replaced.has(e.eventId)&&e.operation!=='RETRACT')
   .filter(e=>e.fact.date<=asOfDay(cutoff))
   .map(e=>({...e.fact}))
 const dayHidden=visible.some(e=>!quarantined.has(e.eventId)&&e.fact.date>asOfDay(cutoff))
 if(dayHidden)issues.push('EVENT_DATE_AFTER_CUTOFF')
 const review=reviewAsOf(facts,asOfDay(cutoff))
 if(review.status==='NEEDS_RECONCILIATION')issues.push('EVIDENCE_NEEDS_RECONCILIATION')
 return {...base,status:issues.length?'NEEDS_RECONCILIATION':review.status==='INVALID_CUTOFF'?'INVALID_CUTOFF':'REVIEWABLE',facts,issues:[...new Set(issues)],quarantinedEventIds:[...quarantined].sort(),hiddenFutureEventCount:future.length}
}
/** No raw event IDs or future-event counts are passed to the model. */
export function buildKnownAtModelContext(events:readonly KnownEvent[],cutoff:string):string {
 const snap=snapshotKnownEvents(events,cutoff)
 if(snap.status==='INVALID_CUTOFF')return JSON.stringify({status:'INVALID_CUTOFF',trainingDecisionAuthorized:false,clinicalClearance:'UNKNOWN'})
 return JSON.stringify({status:snap.status,issues:snap.issues,trainingDecisionAuthorized:false,clinicalClearance:'UNKNOWN',trainingReview:JSON.parse(buildAsOfModelContext(snap.facts,asOfDay(cutoff)))})
}
