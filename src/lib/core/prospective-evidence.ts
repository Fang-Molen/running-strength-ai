import { projectAthleteEvidence } from './athlete-longitudinal-evidence.ts'
import { reviewLongitudinalTraining } from './longitudinal-review.ts'
import type { AthleteEvidence } from './athlete-evidence-audit.ts'

/** K18: as-of snapshot for retrospective audit / prospective evaluation.
 * Do not expose future outcomes or infer missing values. Read-only.
 */
export type ProspectiveReview = Readonly<{
  version:'FK-K18-1'
  asOfDate:string
  status:'REVIEWABLE'|'NEEDS_RECONCILIATION'|'INSUFFICIENT'|'INVALID_CUTOFF'
  visibleRecords:number
  futureRecordsExcluded:number
  invalidRecords:number
  reasons:string[]
  comparisonStatus:'COMPARABLE_OBSERVATIONS'|'INSUFFICIENT_EVIDENCE'|'NOT_COMPARABLE'|'UNAVAILABLE'
  performanceImproved:'UNKNOWN'
  causalTrainingEffect:'UNKNOWN'
  clinicalClearance:'UNKNOWN'
  trainingDecisionAuthorized:false
  originalDataModified:false
}>

function validDay(day:string):boolean {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return false
  const [y,m,d]=day.split('-').map(Number)
  const dt=new Date(Date.UTC(y,m-1,d))
  return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d
}
export function reviewAsOf(items:readonly AthleteEvidence[],asOfDate:string):ProspectiveReview {
 const base={version:'FK-K18-1' as const,asOfDate,performanceImproved:'UNKNOWN' as const,
   causalTrainingEffect:'UNKNOWN' as const,clinicalClearance:'UNKNOWN' as const,
   trainingDecisionAuthorized:false as const,originalDataModified:false as const}
 if(!validDay(asOfDate))return {...base,status:'INVALID_CUTOFF',visibleRecords:0,futureRecordsExcluded:0,
  invalidRecords:items.length,reasons:['INVALID_AS_OF_DATE'],comparisonStatus:'UNAVAILABLE'}
 const visible:AthleteEvidence[]= []
 let futureRecordsExcluded=0,invalidRecords=0
 for(const x of items){
  if(!validDay(x.date)){invalidRecords++;continue}
  if(x.date>asOfDate){futureRecordsExcluded++;continue}
  visible.push(x)
 }
 const projection=projectAthleteEvidence(visible)
 const review=reviewLongitudinalTraining(visible)
 const reasons=[...review.issues]
 if(invalidRecords)reasons.push('INVALID_DATED_RECORDS_EXCLUDED')
 if(futureRecordsExcluded)reasons.push('FUTURE_RECORDS_EXCLUDED')
 // The existence of later records may be noted for retrospective audit only.
 // Never include their content, values, IDs, or outcomes in model context.
 return {...base,status:invalidRecords||projection.conflicts.length||projection.rejected.length
   ?'NEEDS_RECONCILIATION':review.status,
   visibleRecords:projection.ordered.length,futureRecordsExcluded,invalidRecords,
   reasons:[...new Set(reasons)],comparisonStatus:review.comparison.status}
}

/** Prospective model context must not reveal the existence of future records. */
export function buildAsOfModelContext(items:readonly AthleteEvidence[],asOfDate:string):string {
 const r=reviewAsOf(items,asOfDate)
 const {futureRecordsExcluded,...safe}=r
 return JSON.stringify({...safe,reasons:safe.reasons.filter(x=>x!=='FUTURE_RECORDS_EXCLUDED')})
}
