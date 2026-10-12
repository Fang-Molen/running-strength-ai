import { R4_R7_EVIDENCE } from './research-r4-r7-data.ts'
import { RESEARCH_SEED } from './research-knowledge-registry.ts'

export const RESEARCH_CONTEXT_VERSION = 'FK-R3-RESEARCH-CONTEXT-R4-R7-20261012' as const
export type ResearchContextItem = {
  id: string; domain: string; title: string; doi: string | null; url: string | null;
  finding: string; limitations: string; transferBoundary: string; verificationReported: string;
  verificationIndependentThisRun: false; sourceProvenance: string;
  decisionAuthorization: false; personalFact: false
}

/** Topic-specific routing: no free-form text is executed as a command and no unrelated evidence is inserted. */
const ROUTES: readonly { terms: readonly string[]; ids: readonly string[] }[] = [
  { terms: ['400米栏','400m栏'], ids: ['R5-001','R5-002'] },
  { terms: ['100米栏','110米栏','跨栏'], ids: ['R6-001','R4-001'] },
  { terms: ['撑竿跳'], ids: ['R5-003'] },
  { terms: ['铅球'], ids: ['R5-004','R5-005'] },
  { terms: ['链球'], ids: ['R4-002','R6-003'] },
  { terms: ['标枪'], ids: ['R4-003'] },
  { terms: ['跳高'], ids: ['R6-002'] },
  { terms: ['铁饼'], ids: ['R5-006'] },
  { terms: ['无反应','没进步','训练适应','训练反应'], ids: ['R7-001','R7-002'] },
  { terms: ['睡眠分期','睡眠监测','睡眠手表','睡眠设备'], ids: ['R7-003'] },
  { terms: ['acwr','急慢性负荷','负荷比'], ids: ['R7-004','R7-005'] },
  { terms: ['reds','red-s','能量可用性','低能量'], ids: ['R7-007','R7-008'] },
  { terms: ['青少年','生物成熟','身高增长'], ids: ['R7-006'] },
  { terms: ['心理训练','正念'], ids: ['R4-007'] },
  { terms: ['热适应','高温适应'], ids: ['R4-006'] },
]

function normalize(q:string){return q.normalize('NFKC').toLowerCase().slice(0,3000)}
export function retrieveResearchContext(question:string,max=3): ResearchContextItem[] {
  const q=normalize(question)
  const n=Number.isFinite(max)?Math.max(0,Math.min(4,Math.floor(max))):3
  if(!q.trim() || n===0)return []
  const ids=new Set<string>()
  for(const route of ROUTES)if(route.terms.some(t=>q.includes(t.toLowerCase())))for(const id of route.ids)ids.add(id)
  const selected=R4_R7_EVIDENCE.filter(e=>ids.has(e.id)).slice(0,n)
  return selected.map(e=>({id:e.id,domain:e.domain,title:e.title,doi:e.doi,url:e.url,
    finding:e.result,limitations:e.limitations,transferBoundary:e.boundary,
    verificationReported:e.verification,verificationIndependentThisRun:false,
    sourceProvenance:e.provenance,decisionAuthorization:false,personalFact:false}))
}
export function buildResearchModelContext(question:string,maxChars=3500){
  const max=Number.isFinite(maxChars)?Math.max(600,Math.min(4500,Math.floor(maxChars))):3500
  const evidence=retrieveResearchContext(question,4)
  const result:{version:string;status:'RESEARCH_REFERENCE_ONLY';decisionAuthorization:false;personalFact:false;entries:ResearchContextItem[];truncated:boolean}={
    version:RESEARCH_CONTEXT_VERSION,status:'RESEARCH_REFERENCE_ONLY',decisionAuthorization:false,personalFact:false,entries:[],truncated:false}
  for(const entry of evidence){
    if(JSON.stringify({...result,entries:[...result.entries,entry]}).length>max){result.truncated=true;break}
    result.entries.push(entry)
  }
  return result
}
/** Seed remains independent of historical ledger, preventing a silent verification upgrade. */
export const RESEARCH_HISTORICAL_COUNTS={r3Seed:RESEARCH_SEED.length,r4r7:R4_R7_EVIDENCE.length,independentlyReverifiedInImport:0} as const
