/** R1-R3 historical author notes: indexing only, NOT new verified studies. */
import { RESEARCH_DOMAINS, RESEARCH_SEED } from './research-knowledge-registry.ts'
import { R4_R7_EVIDENCE } from './research-r4-r7-data.ts'

export const HISTORY_RECONCILIATION_VERSION = 'FK-R3-HISTORY-R5-20261012' as const
export type HistoricalTopic = Readonly<{
 id:string; domainIndex:number; theme:string; source:string; sourceSection:string;
 reviewQuestion:string; evidenceStatus:'AUTHOR_SYNTHESIS_NOT_PAPER';
 independentPaperVerification:false; decisionAuthorization:false
}>
/** The four gaps are gaps in the imported 31-record sample, not proof of missing research. */
export const HISTORICAL_TOPICS:readonly HistoricalTopic[] = [
 {id:'H-R2-COACH',domainIndex:2,theme:'教练任务完成标准与条件化沟通',source:'方坤_完整知识逻辑_R2_合订本.md',sourceSection:'第2节、第4节、第8节',reviewQuestion:'教练回答是否先识别任务，区分方向、可执行草稿和获准计划，并保留不确定性？',evidenceStatus:'AUTHOR_SYNTHESIS_NOT_PAPER',independentPaperVerification:false,decisionAuthorization:false},
 {id:'H-R2-STRENGTH',domainIndex:4,theme:'力量与跑步同周安排及迁移边界',source:'方坤_完整知识逻辑_R2_合订本.md',sourceSection:'第4.4节',reviewQuestion:'是否明确力量目标、动作/专项结果指标，并避免把1RM增长等同于800米成绩改善？',evidenceStatus:'AUTHOR_SYNTHESIS_NOT_PAPER',independentPaperVerification:false,decisionAuthorization:false},
 {id:'H-R2-RECOVERY',domainIndex:6,theme:'恢复证据与疲劳原因的区分',source:'方坤_完整知识逻辑_R2_合订本.md',sourceSection:'第5.1—5.4节',reviewQuestion:'是否区分当前自报、工作/生活背景、长期变化，并禁止将单个恢复指标诊断为疲劳病因？',evidenceStatus:'AUTHOR_SYNTHESIS_NOT_PAPER',independentPaperVerification:false,decisionAuthorization:false},
 {id:'H-R3-REHAB',domainIndex:8,theme:'伤后回归与训练监测冲突',source:'00_R3知识总审计与综合推理.md',sourceSection:'第2节',reviewQuestion:'是否避免以手表恢复指标解除专业伤后限制；缺少功能评估时是否保留未知？',evidenceStatus:'AUTHOR_SYNTHESIS_NOT_PAPER',independentPaperVerification:false,decisionAuthorization:false},
] as const

export function canonicalDoi(value:string|null|undefined):string|null {
 if(typeof value!=='string')return null
 const s=value.normalize('NFKC').trim().replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi\s*:\s*)/i,'').trim().toLowerCase()
 if(!s)return null
 // DOI identity check only. A plausible DOI is not a verified DOI.
 return /^10\.\d{4,9}\/\S+$/.test(s)?s:null
}
export function reconcileImportedDoi(){
 const records=[...RESEARCH_SEED.map(r=>({id:r.id,doi:r.doi,title:r.title})),...R4_R7_EVIDENCE.map(r=>({id:r.id,doi:r.doi,title:r.title}))]
 const byDoi=new Map<string,{id:string;title:string}[]>(),missing:string[]=[],malformed:string[]=[]
 for(const r of records){
  if(!r.doi){missing.push(r.id);continue}
  const doi=canonicalDoi(r.doi)
  if(!doi){malformed.push(r.id);continue}
  const entries=byDoi.get(doi)??[];entries.push({id:r.id,title:r.title});byDoi.set(doi,entries)
 }
 return {version:HISTORY_RECONCILIATION_VERSION,records:records.length,uniqueValidDoi:byDoi.size,
  duplicates:[...byDoi].filter(([,a])=>a.length>1).map(([doi,entries])=>({doi,entries})),
  missing,malformed,independentlyReverified:0, historicalSourceCompleteness:'PARTIAL' as const}
}
export function auditHistoricalTopicGaps(){
 const grouped=RESEARCH_DOMAINS.map((domain,i)=>({domain,authorTopics:HISTORICAL_TOPICS.filter(x=>x.domainIndex===i).map(x=>x.id),independentlyVerifiedPapersAdded:0,saturated:false}))
 return {version:HISTORY_RECONCILIATION_VERSION,topicCount:HISTORICAL_TOPICS.length,topics:HISTORICAL_TOPICS,
  domains:grouped,independentlyVerifiedPapersAdded:0,scientificSaturationAchieved:false}
}
