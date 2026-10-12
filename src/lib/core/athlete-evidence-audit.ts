/** Deterministic evidence reconciliation; advisory only. No storage writes or prescriptions. */
export type AthleteEvidence = { id:string; kind:'PB'|'SESSION'|'SYMPTOM'|'RECOVERY'; date:string; value:number|null; unit?:string; source:'OFFICIAL'|'DEVICE'|'SELF_REPORT'; context?:string }
export type EvidenceAudit = { accepted:AthleteEvidence[]; rejected:{id:string;reason:string}[]; conflicts:{ids:string[];reason:string}[]; currentPerformanceKnown:false; decisionAuthorization:false }
const iso = /^\d{4}-\d{2}-\d{2}$/
export function auditAthleteEvidence(items:readonly AthleteEvidence[]):EvidenceAudit {
 const accepted:AthleteEvidence[]=[]; const rejected:EvidenceAudit['rejected']=[]; const conflicts:EvidenceAudit['conflicts']=[]; const seen=new Map<string,AthleteEvidence>()
 for(const x of items){
  if(!x.id || !iso.test(x.date) || !Number.isFinite(Date.parse(x.date+'T00:00:00Z')) || (x.value!==null && (!Number.isFinite(x.value)||x.value<0))){rejected.push({id:x.id,reason:'INVALID_EVIDENCE'});continue}
  if(x.kind==='PB' && (x.value===null || x.value<=0)){rejected.push({id:x.id,reason:'INVALID_PB'});continue}
  const prior=seen.get(x.id)
  if(prior){ if(JSON.stringify(prior)!==JSON.stringify(x))conflicts.push({ids:[x.id],reason:'SAME_ID_DIFFERENT_FACT'}); continue }
  seen.set(x.id,x); accepted.push({...x})
 }
 const pb=accepted.filter(x=>x.kind==='PB')
 for(let i=0;i<pb.length;i++)for(let j=i+1;j<pb.length;j++){
  if(pb[i].date===pb[j].date && pb[i].unit===pb[j].unit && pb[i].value!==pb[j].value)conflicts.push({ids:[pb[i].id,pb[j].id],reason:'CONFLICTING_PB_SAME_DATE'})
 }
 return {accepted,rejected,conflicts,currentPerformanceKnown:false,decisionAuthorization:false}
}
