import { R4_R7_EVIDENCE } from './research-r4-r7-data.ts'
/**
 * Evidence disagreement / non-equivalence index, compiled from historical author notes.
 * These are REVIEW FLAGS, not adjudicated clinical findings or new publications.
 */
export const CONFLICT_INDEX_VERSION = 'FK-R3-CONFLICT-R6-20261012' as const
export type ConflictReview = Readonly<{
  id:string; terms:readonly string[]; kind:'METHOD_DISAGREEMENT'|'CAUSAL_OVERREACH'|'MEASUREMENT_CONFLICT'|'SAFETY_PRECEDENCE';
  question:string; caution:string; sourceRecordIds:readonly string[];
  sourceStatus:'HISTORICAL_RECORDS_NOT_REVERIFIED';
  resolution:'UNRESOLVED_REVIEW_REQUIRED'; decisionAuthorization:false; personalFact:false
}>
const REVIEWS:readonly ConflictReview[]=[
  {id:'CI-ACWR',terms:['acwr','急慢性负荷','负荷比'],kind:'METHOD_DISAGREEMENT',
   question:'核对ACWR相关性综述与比值方法学批评的分母、时间窗、混杂和损伤定义。',
   caution:'不得从群体相关性推导个人安全区间或自动加量阈值。',sourceRecordIds:['R7-004','R7-005'],sourceStatus:'HISTORICAL_RECORDS_NOT_REVERIFIED',resolution:'UNRESOLVED_REVIEW_REQUIRED',decisionAuthorization:false,personalFact:false},
  {id:'CI-REDS',terms:['reds','red-s','能量可用性','低能量'],kind:'METHOD_DISAGREEMENT',
   question:'比较RED-S批判性综述与回应的诊断构念、因果证据和鉴别诊断要求。',
   caution:'不得因学术争论否定健康风险，也不得仅凭非特异性症状自行诊断。',sourceRecordIds:['R7-007','R7-008'],sourceStatus:'HISTORICAL_RECORDS_NOT_REVERIFIED',resolution:'UNRESOLVED_REVIEW_REQUIRED',decisionAuthorization:false,personalFact:false},
  {id:'CI-MONITOR',terms:['hrv','心率变异','手表','睡眠分期','伤后','康复'],kind:'MEASUREMENT_CONFLICT',
   question:'区分可穿戴设备的测量误差、日常波动和临床功能评估。',
   caution:'良好的设备指标不能撤销临床限制或证明已可高速回归。',sourceRecordIds:['R7-003'],sourceStatus:'HISTORICAL_RECORDS_NOT_REVERIFIED',resolution:'UNRESOLVED_REVIEW_REQUIRED',decisionAuthorization:false,personalFact:false},
  {id:'CI-ADAPT',terms:['没进步','无反应','训练适应','训练反应'],kind:'CAUSAL_OVERREACH',
   question:'区分重复测试的测量误差、个体变异、训练剂量与真正的非反应。',
   caution:'不能因为一次测试无变化就认定无适应，也不能据此自动增加训练量。',sourceRecordIds:['R7-001','R7-002'],sourceStatus:'HISTORICAL_RECORDS_NOT_REVERIFIED',resolution:'UNRESOLVED_REVIEW_REQUIRED',decisionAuthorization:false,personalFact:false},
] as const
function normalize(s:string){return s.normalize('NFKC').toLowerCase().slice(0,3000)}
export function retrieveConflictReviews(question:string,limit=2):ConflictReview[]{
 const q=normalize(question),n=Number.isFinite(limit)?Math.max(0,Math.min(4,Math.floor(limit))):2
 if(!q.trim()||!n)return []
 return REVIEWS.filter(x=>x.terms.some(t=>q.includes(normalize(t)))).slice(0,n)
  .map(x=>({...x,terms:[...x.terms],sourceRecordIds:[...x.sourceRecordIds]}))
}
export function buildConflictReviewContext(question:string,maxChars=1300){
 const bound=Number.isFinite(maxChars)?Math.max(350,Math.min(2500,Math.floor(maxChars))):1300
 const out:{version:string;status:'REVIEW_FLAGS_ONLY';decisionAuthorization:false;personalFact:false;entries:ConflictReview[];truncated:boolean}={
  version:CONFLICT_INDEX_VERSION,status:'REVIEW_FLAGS_ONLY',decisionAuthorization:false,personalFact:false,entries:[],truncated:false}
 for(const item of retrieveConflictReviews(question,4)){
  if(JSON.stringify({...out,entries:[...out.entries,item]}).length>bound){out.truncated=true;break}
  out.entries.push(item)
 }
 return out
}
export const CONFLICT_REVIEW_COUNT=REVIEWS.length

/** Source-link integrity, not a scientific adjudication or re-verification of papers. */
export type ConflictSourceLink = Readonly<{
  conflictId:string; sourceId:string; doi:string|null; title:string|null;
  reportedVerification:string|null; independentlyReverified:false;
  sourceFound:boolean; metadataOnly:boolean
}>
const sourceById=new Map<string,(typeof R4_R7_EVIDENCE)[number]>(R4_R7_EVIDENCE.map(e=>[e.id,e]))
export function auditConflictSourceLinks():{
  links:ConflictSourceLink[]; missingSourceIds:string[]; metadataOnlyIds:string[];
  uniqueLinkedSourceCount:number; independentlyReverified:0; adjudicationAuthorized:false
}{
  const links:ConflictSourceLink[]=REVIEWS.flatMap(review=>review.sourceRecordIds.map(sourceId=>{
    const source=sourceById.get(sourceId)
    return {conflictId:review.id,sourceId,doi:source?.doi??null,title:source?.title??null,
      reportedVerification:source?.verification??null,independentlyReverified:false as const,
      sourceFound:!!source,metadataOnly:!!source&&/METADATA_ONLY|BIBLIOGRAPHIC_ONLY|NOT_VERIFIED/.test(source.verification)}
  }))
  return {links,missingSourceIds:[...new Set(links.filter(l=>!l.sourceFound).map(l=>l.sourceId))],
    metadataOnlyIds:[...new Set(links.filter(l=>l.metadataOnly).map(l=>l.sourceId))],
    uniqueLinkedSourceCount:new Set(links.filter(l=>l.sourceFound).map(l=>l.sourceId)).size,
    independentlyReverified:0,adjudicationAuthorized:false}
}
/** Conflict summaries expose source status explicitly; metadata-only records are never treated as evidence of a claim. */
export function retrieveConflictSourceStatus(question:string,limit=2){
  const matched=retrieveConflictReviews(question,limit)
  const audit=auditConflictSourceLinks()
  return matched.map(r=>({conflictId:r.id,sourceLinks:audit.links.filter(l=>l.conflictId===r.id),
    fullySupportedByReverifiedPapers:false as const,reviewOnly:true as const}))
}
