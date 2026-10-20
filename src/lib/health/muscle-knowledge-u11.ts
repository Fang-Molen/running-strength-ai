import type {MuscleReview,Region} from './muscle-recovery-u11'
/** Research may contextualize an observed workload; it cannot become an individual's measured recovery. */
export type KnowledgeCard={id:string;sourceRef:string;status:'APPROVED'|'CANDIDATE'|'REJECTED';topic:'CONCURRENT_TRAINING'|'STRENGTH_RECOVERY'|'SORENESS'|'OTHER';regions:Region[];population?:string;claim:string}
export type KnowledgeContext={region:Region;cardIds:string[];notes:string[]}
export function muscleKnowledgeContext(review:MuscleReview,cards:KnowledgeCard[]):KnowledgeContext[]{
 return review.regions.filter(r=>r.state!=='UNKNOWN').map(r=>{
  const eligible=cards.filter(c=>c.status==='APPROVED'&&!!c.id&&!!c.sourceRef&&c.regions.includes(r.region)&&c.topic!=='OTHER')
  const approved=eligible.filter(c=>r.state==='OVERLAP_OBSERVED'?c.topic==='CONCURRENT_TRAINING'||c.topic==='STRENGTH_RECOVERY':r.state==='REPORTED_SORENESS'?c.topic==='SORENESS'||c.topic==='STRENGTH_RECOVERY':c.topic==='STRENGTH_RECOVERY'||c.topic==='SORENESS')
  return {region:r.region,cardIds:[...new Set(approved.map(c=>c.id))],notes:approved.length?['仅用于解释可能机制和观察建议；不能把群体研究当成该运动员已测得的肌肉恢复程度。']:['暂无已审核且适用的知识条目；不得把待审核知识作为确定性处方。']}
 })
}
