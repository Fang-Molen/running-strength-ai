import { retrieveCurriculum } from './coach-curriculum.ts'
import { selectArchivedResearch } from './research-evidence-r4-r7.ts'
import { EVENT_CANDIDATES } from './coach-event-cards.ts'

export type KnowledgeVerification = 'CANDIDATE' | 'FULL_TEXT_CHECKED'
export type CognitionKnowledge = {
  id: string; event: string; claim: string; population: string; phase: string
  title: string; url: string | null; doi: string | null; year: number | null
  verification: KnowledgeVerification; evidenceLevel: 'TEACHING_CANDIDATE' | 'NARRATIVE_REVIEW' | 'OBSERVATIONAL'
  teachingRuleId?: string; evidenceRefs?: string[];
  limitations: string; checkedAt: string | null; reviewedBy: string | null; prescriptionApproved: false
}
export const COGNITION_KNOWLEDGE_VERSION = 'FK-COGNITION-R3+FK5R1-20261011'
const checked: CognitionKnowledge[] = [
  { id: 'SCI-SPRINT-2019', event: '短跑', claim: '短跑训练需要按能力、经验与恢复个体化，并协调速度、技术、力量及赛前恢复。', population: '以高水平短跑尤其100米为主的科学与教练实践综述', phase: '准备期/专项期/比赛期，具体剂量需另审', title: 'Haugen et al. (2019), The Training and Development of Elite Sprint Performance', url: 'https://link.springer.com/article/10.1186/s40798-019-0221-0', doi: '10.1186/s40798-019-0221-0', year: 2019, verification: 'FULL_TEXT_CHECKED', evidenceLevel: 'NARRATIVE_REVIEW', limitations: '叙述性综述与精英实践；并非400米个体处方试验，不能照搬剂量或承诺效果。', checkedAt: '2026-10-11', reviewedBy: 'GPT source check; professional approval pending', prescriptionApproved: false },
  { id: 'SCI-400-2024', event: '400米', claim: '400米后程表现下降可以伴随步态与肌肉协调变化；分段本身不能定位个人生理或技术原因。', population: '9名日本男性400米选手，PB均值48.11秒，配戴EMG设备', phase: '单次最大400米表现观察', title: 'Kakehata et al. (2024), Changes in muscle coordination patterns during 400-m sprint', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11236024/', doi: '10.1002/ejsc.12085', year: 2024, verification: 'FULL_TEXT_CHECKED', evidenceLevel: 'OBSERVATIONAL', limitations: '小样本男性观察，比较100–150与350–400米，设备影响表现；没有验证训练干预或个人病因。', checkedAt: '2026-10-11', reviewedBy: 'GPT source check; professional approval pending', prescriptionApproved: false },
]
export function detectCognitionEvents(q: string): string[] {
  const normalized = q.replace(/(\d)\s*m\b/gi, '$1米').replace(/半马/g, '半程马拉松')
  const matches = EVENT_CANDIDATES.filter(c => new RegExp(`(?<!\\d)${c.event}`).test(normalized)).map(c => c.event)
  const specific = matches.filter(e => !matches.some(other => other !== e && other.includes(e))).sort((a,b)=>normalized.indexOf(a)-normalized.indexOf(b))
  const target = specific.find(e => new RegExp(`(?:希望|主项|专项目标(?:是|为)?)\\s*${e}`).test(normalized))
  const explicit = specific.find(e => new RegExp(`(?:练|主项|目标|准备|想把|要练)\\s*${e}`).test(normalized))
  const transfers = specific.filter(e => new RegExp(`(?:转练|转项|改练|转到|转向)\\s*${e}`).test(normalized))
  const first = target ?? explicit ?? specific[0]
  return first ? [...new Set([first,...transfers])] : []
}
export function retrieveCognitionKnowledge(events: string[], question = ''): CognitionKnowledge[] {
  const candidates: CognitionKnowledge[] = EVENT_CANDIDATES.filter(c => events.includes(c.event)).map(c => ({
    id: c.id, event: c.event, claim: c.knowledge, population: '交接教学材料，适用人群尚待文献核验', phase: 'UNSPECIFIED', title: '方坤_AI大脑_跨项目认知训练_V2', url: null, doi: null, year: null,
    verification: 'CANDIDATE', evidenceLevel: 'TEACHING_CANDIDATE', limitations: `${c.forbidden}；未独立科学审核，不授权训练剂量。`, checkedAt: null, reviewedBy: null, prescriptionApproved: false,
  }))
  const teaching: CognitionKnowledge[] = retrieveCurriculum(question).lessons.map(r=>({
    id:r.id,event:'跨项目教学',claim:r.guidance,population:'教练教学候选；须结合当前运动员资料',phase:'未由此决定',
    title:r.title,url:null,doi:null,year:null,verification:'CANDIDATE',evidenceLevel:'TEACHING_CANDIDATE',
    limitations:`${r.counterexample}；来源支持一般原则，不代表验证了此人剂量。`,checkedAt:null,reviewedBy:null,prescriptionApproved:false,
    teachingRuleId:r.id,evidenceRefs:r.evidenceRefs,
  }))
  // Historical archive remains unverified in this integration, and never authorizes a prescription.
  // The prefix prevents collisions with existing cognition knowledge IDs.
  const archived: CognitionKnowledge[] = selectArchivedResearch(events, question, 2).map(r=>({
    id:`archive:${r.id}`, event:r.events[0] ?? '跨项目研究', claim:r.claim,
    population:r.population,phase:'仅供研究解释；非个人训练阶段',title:r.title,
    url:r.url,doi:r.doi,year:null,verification:'CANDIDATE',
    evidenceLevel:'TEACHING_CANDIDATE',
    limitations:`${r.limits}；${r.transfer}；本次接入未独立重核原文。历史报告核验标记：${r.verification}。`,
    checkedAt:null,reviewedBy:null,prescriptionApproved:false,
  }))
  return [...checked.filter(c => events.includes(c.event) || c.event === '短跑' && events.some(e => ['60米','100米','200米','400米'].includes(e))), ...candidates, ...teaching, ...archived]
}
export type ResearchGap = { id: string; event: string; question: string; status: 'GAP' | 'SOURCE_FOUND' | 'TEXT_CHECKED' | 'BLIND_TESTED' | 'APPROVED' | 'REJECTED'; url: string | null; methodNotes: string | null; blindTestEvidence: string | null; reviewer: string | null; version: number }
/** Deliberate development workflow. A model cannot self-approve a prescription. */
export function advanceResearchGap(gap: ResearchGap, patch: Partial<ResearchGap>): ResearchGap {
  const next = { ...gap, ...patch, id: gap.id, version: gap.version + 1 }
  const order = ['GAP','SOURCE_FOUND','TEXT_CHECKED','BLIND_TESTED','APPROVED']
  const valid=[...order,'REJECTED']
  if(!valid.includes(next.status)||!valid.includes(gap.status)) throw new Error('INVALID_RESEARCH_STAGE')
  if(gap.status==='REJECTED'&&next.status!=='REJECTED') throw new Error('NEW_GAP_REQUIRED')
  if(next.status!=='REJECTED'&&order.indexOf(next.status)<order.indexOf(gap.status)) throw new Error('RESEARCH_STAGE_REGRESSION')
  if (next.status !== 'REJECTED' && order.indexOf(next.status) > order.indexOf(gap.status) + 1) throw new Error('RESEARCH_STAGE_SKIPPED')
  if (next.status !== 'GAP' && next.status !== 'REJECTED' && !/^https:\/\//.test(next.url ?? '')) throw new Error('SOURCE_REQUIRED')
  if (['TEXT_CHECKED','BLIND_TESTED','APPROVED'].includes(next.status) && !next.methodNotes?.trim()) throw new Error('METHODS_REQUIRED')
  if (['BLIND_TESTED','APPROVED'].includes(next.status) && !next.blindTestEvidence?.trim()) throw new Error('BLIND_TEST_REQUIRED')
  if (next.status === 'APPROVED' && (!next.reviewer?.trim() || /gpt|model|ai|自动/i.test(next.reviewer))) throw new Error('HUMAN_REVIEW_REQUIRED')
  return next
}
