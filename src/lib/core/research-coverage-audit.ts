/** Research coverage audit. Coverage is a cataloguing measure, never a saturation claim. */
import { RESEARCH_DOMAINS, RESEARCH_SEED } from './research-knowledge-registry.ts'
import { R4_R7_EVIDENCE } from './research-r4-r7-data.ts'

export const COVERAGE_AUDIT_VERSION = 'FK-COVERAGE-R4-20261012' as const
export type CoverageRow = Readonly<{
  domain: string; historicalRecordIds: readonly string[]; historicalCount: number;
  independentlyReverifiedCount: 0; status:'UNASSESSED'; saturated:false;
  reason: string
}>

/**
 * Explicit tags are curated only to locate historic records; they are not proof
 * that any research question, subdiscipline or population is fully covered.
 */
const tags: Readonly<Record<string, readonly number[]>> = {
 'R3-SPRINT-2019':[1], 'R3-400-2024':[5],
 'R4-001':[1,5], 'R4-002':[1,5], 'R4-003':[1,5], 'R4-004':[1,5],
 'R4-005':[10], 'R4-006':[10,13], 'R4-007':[11], 'R4-008':[10], 'R4-009':[1,5],
 'R5-001':[1], 'R5-002':[1], 'R5-003':[1,5], 'R5-004':[1,5], 'R5-005':[1,5], 'R5-006':[1,5], 'R5-007':[1,5], 'R5-008':[1,5],
 'R6-001':[1,5], 'R6-002':[1,5], 'R6-003':[1,5],
 'R7-001':[0,14], 'R7-002':[0,14], 'R7-003':[12], 'R7-004':[3,7,14], 'R7-005':[3,7,14],
 'R7-006':[10], 'R7-007':[9], 'R7-008':[9], 'R7-009':[15],
}
export function auditHistoricalCoverage(){
 const records=[...RESEARCH_SEED,...R4_R7_EVIDENCE]
 const unknownIds=records.filter(r=>!tags[r.id]).map(r=>r.id)
 const staleIds=Object.keys(tags).filter(id=>!records.some(r=>r.id===id))
 const rows:CoverageRow[]=RESEARCH_DOMAINS.map((domain,i)=>{
  const ids=records.filter(r=>tags[r.id]?.includes(i)).map(r=>r.id)
  return {domain,historicalRecordIds:ids,historicalCount:ids.length,independentlyReverifiedCount:0,
   status:'UNASSESSED',saturated:false,
   reason:'历史材料仅建立主题索引；未完成领域核心问题、独立证据质量、反证、跨人群适用及连续三轮增量检索审查。'}
 })
 return {version:COVERAGE_AUDIT_VERSION,totalHistoricalRecords:records.length,
  mappedRecords:records.length-unknownIds.length,unknownIds,staleIds,
  historicalCoverageOnly:true,independentlyReverifiedInThisAudit:0,
  saturatedDomains:0,rows}
}
/** Never promote a record to independently verified on the strength of a historical flag. */
export function validateHistoricalEvidence(){
 const records=R4_R7_EVIDENCE
 const seen=new Map<string,string>(),duplicates:{doi:string;first:string;second:string}[]=[]
 const incomplete:string[]=[]
 for(const r of records){
  const doi=r.doi?.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//,'')
  if(doi){const old=seen.get(doi);if(old)duplicates.push({doi,first:old,second:r.id});else seen.set(doi,r.id)}
  if(!r.id||!r.title||!r.design||!r.population||!r.limitations||!r.boundary||!r.provenance)incomplete.push(r.id)
  if(r.decisionAuthorization!==false)incomplete.push(r.id+':UNAUTHORIZED')
 }
 return {records:records.length,uniqueDoi:seen.size,duplicates,incomplete,independentlyReverified:0}
}
