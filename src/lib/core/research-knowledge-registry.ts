/** R3 research intake: read-only, non-prescriptive, and independent of athlete facts. */
export const RESEARCH_REGISTRY_VERSION = 'FK-R3-RESEARCH-INTAKE-2026-10-12' as const
export const RESEARCH_DOMAINS = [
  '运动生理与适应','田径专项（60米至马拉松、跨栏、跳跃、投掷）','教练理论与实践',
  '周期训练与负荷','力量迁移','运动生物力学','疲劳与恢复','运动医学与伤病预防',
  '康复回归与力量重建','营养与RED-S','特殊人群','运动心理',
  '测量与可穿戴设备','比赛环境','个体适应与因果推断','AI知识治理与安全',
] as const
export type ResearchDomain = typeof RESEARCH_DOMAINS[number]
export type VerificationLevel = 'FULL_TEXT' | 'ABSTRACT' | 'BIBLIOGRAPHIC' | 'UNVERIFIED'
export type ResearchEntry = Readonly<{
  id: string
  domain: ResearchDomain
  claim: string
  title: string
  doi: string | null
  url: string | null
  studyDesign: string
  population: string
  intervention: string | null
  result: string
  limitations: string
  transferBoundary: string
  verification: VerificationLevel
  evidenceConflict: string | null
  reviewedAt: string | null
  sourceProvenance: string
  decisionAuthorized: false
}>
/** Only the two full-text items already curated in R3 are seeded. No new paper is silently upgraded. */
export const RESEARCH_SEED: readonly ResearchEntry[] = [
  {
    id:'R3-SPRINT-2019',domain:'田径专项（60米至马拉松、跨栏、跳跃、投掷）',
    claim:'高水平短跑训练需要考虑专项、经验、恢复和训练阶段。',
    title:'Haugen et al. (2019), The Training and Development of Elite Sprint Performance',
    doi:'10.1186/s40798-019-0221-0',url:'https://link.springer.com/article/10.1186/s40798-019-0221-0',
    studyDesign:'叙述性综述',population:'高水平短跑运动员的研究与实践资料',intervention:null,
    result:'综合训练原则而非单一干预的因果效果',limitations:'叙述性综述，未验证个体剂量。',
    transferBoundary:'不能将100米训练直接等同于400米、800米或青少年训练处方。',
    verification:'FULL_TEXT',evidenceConflict:null,reviewedAt:'2026-10-11',
    sourceProvenance:'继承R3源码 coach-cognition-knowledge.ts 既有全文核对标记；本轮未重新独立全文核验',decisionAuthorized:false,
  },
  {
    id:'R3-400-2024',domain:'运动生物力学',
    claim:'400米后程表现下降可伴随肌肉协调模式变化，不能据此诊断个人掉速原因。',
    title:'Kakehata et al. (2024), Changes in muscle coordination patterns during 400-m sprint',
    doi:'10.1002/ejsc.12085',url:'https://pmc.ncbi.nlm.nih.gov/articles/PMC11236024/',
    studyDesign:'观察性生物力学研究',population:'9名日本男性400米运动员',intervention:null,
    result:'比较400米不同赛段的肌肉协调表现',limitations:'小样本、仅男性、穿戴设备可能影响表现；未验证干预。',
    transferBoundary:'不能推断女性、青年、其他项目或个人疲劳病因。',
    verification:'FULL_TEXT',evidenceConflict:null,reviewedAt:'2026-10-11',
    sourceProvenance:'继承R3源码 coach-cognition-knowledge.ts 既有全文核对标记；本轮未重新独立全文核验',decisionAuthorized:false,
  },
] as const
export function auditResearchEntries(entries: readonly ResearchEntry[]) {
  const seen = new Set<string>(); const issues: string[]=[]
  for(const entry of entries){
    if(!RESEARCH_DOMAINS.includes(entry.domain)) issues.push(`${entry.id}:INVALID_DOMAIN`)
    if(!entry.id || !entry.claim.trim() || !entry.limitations.trim() || !entry.transferBoundary.trim()) issues.push(`${entry.id}:MISSING_BOUNDARY`)
    if(entry.decisionAuthorized !== false) issues.push(`${entry.id}:DECISION_AUTHORIZATION_FORBIDDEN`)
    if(entry.verification==='FULL_TEXT' && (!entry.url?.startsWith('https://') || !entry.reviewedAt || !entry.sourceProvenance)) issues.push(`${entry.id}:FULL_TEXT_PROVENANCE_REQUIRED`)
    const key = entry.doi?.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//,'').trim()
    if(key){if(seen.has(key))issues.push(`${entry.id}:DUPLICATE_DOI`);seen.add(key)}
  }
  return {ok:issues.length===0,issues}
}
export function researchCoverage(entries: readonly ResearchEntry[]) {
  return RESEARCH_DOMAINS.map(domain=>({domain,records:entries.filter(e=>e.domain===domain).length,
    status:'NOT_ASSESSED' as const, saturated:false as const}))
}
/** Search returns explanatory source candidates only. It never creates personal facts or a prescription. */
export function retrieveResearchCandidates(query:string,entries:readonly ResearchEntry[]=RESEARCH_SEED){
  const q=query.toLowerCase()
  return entries.filter(e=>e.domain.toLowerCase().split('（')[0].includes(q) ||
    (q.includes('400米') && e.id==='R3-400-2024') ||
    (/(短跑|100米|200米|60米)/.test(q) && e.id==='R3-SPRINT-2019'))
}
