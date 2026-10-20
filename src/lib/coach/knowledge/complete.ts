import rawCards from '../../../../knowledge/coach-complete-20261020/knowledge_cards.json' with { type: 'json' }
import rawSources from '../../../../knowledge/coach-complete-20261020/sources.json' with { type: 'json' }
import rawMethods from '../../../../knowledge/coach-complete-20261020/reasoning_methods.json' with { type: 'json' }
import registry from '../../../../knowledge/coach-complete-20261020/registry.json' with { type: 'json' }
import { compareCoachFollowupDependencies, type C03QuerySnapshot } from '../c03/followup.ts'
import { currentKnowledgeLedger, ledgerApproves, type VerifiedKnowledgeLedger } from './approval.ts'

/** Read-only research catalogue. It is not an athlete fact store, an approval
 * authority, a new plan executor, or a replacement for existing reviewed knowledge. */
export const COMPLETE_KNOWLEDGE_VERSION = 'FK-COACH-KNOWLEDGE-COMPLETE-20261020' as const
export type CompleteKnowledgeDomain = 'PROGRAMMING'|'RUNNING'|'STRENGTH'|'RECOVERY'|'MEASUREMENT'|'NUTRITION'
export type CompleteKnowledgeTask = 'plan'|'review'|'compare'|'capability'|'action'|'recovery'|'calculate'|'cause'|'memory'|'nutrition'|'knowledge'
export type CompleteKnowledgeMode = 'PRODUCTION'|'RESEARCH_PREVIEW'
type Card = typeof rawCards[number]
type Source = typeof rawSources[number]
const domains: readonly CompleteKnowledgeDomain[] = ['PROGRAMMING','RUNNING','STRENGTH','RECOVERY','MEASUREMENT','NUTRITION']
const tasks: readonly CompleteKnowledgeTask[] = ['plan','review','compare','capability','action','recovery','calculate','cause','memory','nutrition','knowledge']
function freeze<T>(value:T):Readonly<T> {
  if (value && typeof value === 'object') { Object.values(value).forEach(v=>freeze(v)); Object.freeze(value) }
  return value
}
// Take an internal copy; callers never receive a mutable reference to imported data.
const cards=freeze(structuredClone(rawCards)), sources=freeze(structuredClone(rawSources)), methods=freeze(structuredClone(rawMethods))
const hashes=freeze(structuredClone(registry))
// No signed/host-authenticated professional approval has been supplied. A JSON
// "APPROVED", production_eligible:true or hostVerified:true cannot authorize use.
const approvedCardVersions: ReadonlySet<string> = new Set<string>()
const cardHash=(id:string)=>(hashes.cardSha256 as Record<string,string>)[id]??null
const sourceHash=(id:string)=>(hashes.sourceSha256 as Record<string,string>)[id]??null
const handle=(card:Card)=>`${COMPLETE_KNOWLEDGE_VERSION}:${card.id}@${card.version}`

export type CompleteKnowledgeUse = {
  id:string; cardId:string; version:number; contentSha256:string; title:string; domain:CompleteKnowledgeDomain;
  mode:CompleteKnowledgeMode; professionalReview:string; productionEligible:boolean;
  applicability:'UNASSESSED_FOR_PERSON'; prerequisiteStatus:'MISSING_DECLARED_FIELDS'|'DECLARED_FIELDS_ONLY';
  missingPrerequisites:string[]; sourceIds:string[]; sourceRefs:{id:string;contentSha256:string;title:string;url:string;readLevel:string;limits:string}[];
  applicationProposal:string; unsupported:string; smallestUsefulQuestion:string; revisitTrigger:string;
  knownAt:string; sourceVerification:'SUPPLIER_REPORTED_NOT_REVERIFIED';
  prescriptionAuthorized:false; personalEvidence:false; approvalReceiptId:string|null;
}
export type CompleteKnowledgeSelection = {
  version:typeof COMPLETE_KNOWLEDGE_VERSION; mode:CompleteKnowledgeMode;
  status:'NO_APPROVED_KNOWLEDGE'|'APPROVED_BY_TRUSTED_RECEIPT'|'RESEARCH_PREVIEW_ONLY'|'INVALID_QUERY'|'NOT_KNOWN_AT_ASOF';
  matched:number; held:number; uses:CompleteKnowledgeUse[]; decisionAuthorized:false;
}

/** This query must be assembled by the host, not deserialized from model output.
 * Declared keys only describe available fields; they never certify population,
 * values, provenance, clinical applicability, or professional approval. */
export function selectCompleteKnowledge(input:{task:CompleteKnowledgeTask;domains:readonly CompleteKnowledgeDomain[];
  mode?:CompleteKnowledgeMode;asOf?:string;cardIds?:readonly string[];declaredFactKeys?:readonly string[];maxRefs?:number;
  /** 只接受 verifyKnowledgeApprovals 生成的账本；默认用当前会话安装的账本（生产环境没有受信审核人 = 0 批准）。 */
  ledger?:VerifiedKnowledgeLedger|null}):CompleteKnowledgeSelection {
  const mode=input.mode??'PRODUCTION'
  const result:CompleteKnowledgeSelection={version:COMPLETE_KNOWLEDGE_VERSION,mode:mode==='RESEARCH_PREVIEW'?mode:'PRODUCTION',
    status:'INVALID_QUERY',matched:0,held:0,uses:[],decisionAuthorized:false}
  const asOf=input.asOf??new Date().toISOString(), time=Date.parse(asOf)
  if (!tasks.includes(input.task)||!['PRODUCTION','RESEARCH_PREVIEW'].includes(mode)||!Array.isArray(input.domains)
    ||input.domains.some(d=>!domains.includes(d))||!Number.isFinite(time)||time>Date.now()
    ||input.cardIds!==undefined&&(!Array.isArray(input.cardIds)||input.cardIds.some(id=>typeof id!=='string'))
    ||input.declaredFactKeys!==undefined&&(!Array.isArray(input.declaredFactKeys)||input.declaredFactKeys.some(k=>typeof k!=='string'))
    ||input.maxRefs!==undefined&&(!Number.isFinite(input.maxRefs)||input.maxRefs<0)) return result
  if (time<Date.parse(hashes.importedAt)) return {...result,status:'NOT_KNOWN_AT_ASOF'}
  const matching=cards.filter(c=>input.domains.includes(c.domain as CompleteKnowledgeDomain)
    &&(input.task==='knowledge'||c.task_tags.includes(input.task))&&(!input.cardIds||input.cardIds.includes(c.id))
    &&!['RETIRED','NEEDS_REVIEW'].includes(c.professional_review))
    .sort((a,b)=>input.cardIds?input.cardIds.indexOf(a.id)-input.cardIds.indexOf(b.id):0)
  result.matched=matching.length
  const ledger=input.ledger===undefined?currentKnowledgeLedger():input.ledger
  const receiptOf=(c:Card)=>ledgerApproves(ledger,c.id,c.version,cardHash(c.id)??'')
  const eligible=matching.filter(c=>mode==='RESEARCH_PREVIEW'||approvedCardVersions.has(handle(c))||!!receiptOf(c))
  result.held=matching.length-eligible.length
  result.status=mode==='PRODUCTION'?(eligible.length?'APPROVED_BY_TRUSTED_RECEIPT':'NO_APPROVED_KNOWLEDGE'):'RESEARCH_PREVIEW_ONLY'
  const limit=input.maxRefs===undefined?2:Math.min(4,Math.floor(input.maxRefs))
  result.uses=eligible.slice(0,limit).map(c=>{
    const missing=c.required_fact_keys.filter(k=>!input.declaredFactKeys?.includes(k))
    return {id:handle(c),cardId:c.id,version:c.version,contentSha256:cardHash(c.id)!,title:c.title,domain:c.domain as CompleteKnowledgeDomain,
      mode,professionalReview:mode==='PRODUCTION'&&receiptOf(c)?'APPROVED_BY_TRUSTED_RECEIPT':c.professional_review,productionEligible:mode==='PRODUCTION'&&!!receiptOf(c),applicability:'UNASSESSED_FOR_PERSON',
      prerequisiteStatus:missing.length?'MISSING_DECLARED_FIELDS':'DECLARED_FIELDS_ONLY',missingPrerequisites:missing,
      sourceIds:[...c.source_ids],sourceRefs:c.source_ids.map(id=>{
        const s=sources.find(s=>s.id===id) as Source
        return {id:`${COMPLETE_KNOWLEDGE_VERSION}:SOURCE:${id}`,contentSha256:sourceHash(id)!,title:s.title,url:s.url,readLevel:s.read_level,limits:s.limits}
      }),applicationProposal:c.proposed_application,unsupported:c.not_supported,smallestUsefulQuestion:c.smallest_useful_question,
      revisitTrigger:c.revisit_trigger,knownAt:hashes.importedAt,sourceVerification:'SUPPLIER_REPORTED_NOT_REVERIFIED',
      prescriptionAuthorized:false,personalEvidence:false,approvalReceiptId:mode==='PRODUCTION'?receiptOf(c)?.receiptId??null:null}
  })
  return result
}

export function completeKnowledgeInventory() {
  return {version:COMPLETE_KNOWLEDGE_VERSION,importedAt:hashes.importedAt,cards:cards.length,sources:sources.length,methods:methods.length,
    domains:domains.map(domain=>({domain,count:cards.filter(c=>c.domain===domain).length})),
    professionalReview:'PENDING' as const,approvedForProduction:0,developmentCases:50,developmentTrajectories:6,
    examplesUsedInRuntime:0,independentLiteratureReviewPerformed:false,approvalIngress:'NOT_CONNECTED' as const}
}

const domainTerms:Record<CompleteKnowledgeDomain,RegExp>={
  PROGRAMMING:/周期|比赛|目标|安排|计划|准备|热身|时间不足/,
  RUNNING:/跑步|短跑|中跑|冲刺|加速|配速|分段|起跑|800|1500/,
  STRENGTH:/力量|肌群|肌肉|动作|组次|重量|负重|深蹲|足踝|抗阻/,
  RECOVERY:/恢复|疲劳|HRV|睡眠|心率|酸痛|疼痛|疾病|出差/i,
  MEASUREMENT:/统计|单位|均值|平均|极差|首尾|测量|因果|负荷|口径|缺失|来源/,
  NUTRITION:/营养|饮食|摄入|补给|食物|补液|体重|补剂|REDs/i,
}
export function completeKnowledgeDomains(question:string):CompleteKnowledgeDomain[] {
  return domains.filter(d=>domainTerms[d].test(question.normalize('NFKC')))
}
export function completeReasoningMethods(task:CompleteKnowledgeTask) {
  const ids:Record<CompleteKnowledgeTask,readonly string[]>={
    calculate:['L01','L02','L04'],review:['L02','L03','L12'],compare:['L02','L03','L04'],
    capability:['L03','L06','L12'],action:['L08','L09','L10'],recovery:['L03','L05','L12'],
    cause:['L05','L06','L10'],plan:['L08','L09','L10'],memory:['L07','L11','L14','L16'],
    nutrition:['L02','L12','L13'],knowledge:['L13','L16'],
  }
  return methods.filter(m=>ids[task]?.includes(m.id)).map(m=>({id:m.id,name:m.name,steps:[...m.steps],limits:m.limits,
    kind:m.kind,scientificApproval:false,automaticPrescription:false}))
}

/** An explicit read-only document-preview action, not a user-set production mode. */
export function isCompleteKnowledgePreviewRequest(question:string):boolean {
  return /(?:预览|查看|查阅|解释|说明|看看).{0,16}(?:待审知识|研究知识|研究资料|知识卡)|(?:知识卡|待审知识).{0,10}(?:[PRSFNM]\d{2}|预览|有哪些)/i.test(question)
}
export function answerCompleteKnowledgePreview(question:string,asOf=new Date().toISOString()) {
  if (!isCompleteKnowledgePreviewRequest(question)) return null
  const q=question.normalize('NFKC').slice(0,2000)
  const ids=[...q.matchAll(/(?<![A-Za-z0-9])([PRSFNM]\d{2})(?!\d)/gi)].map(m=>m[1].toUpperCase())
  const selectedDomains=ids.length?domains.filter(d=>cards.some(c=>c.domain===d&&ids.includes(c.id))):completeKnowledgeDomains(q)
  const selection=selectCompleteKnowledge({task:'knowledge',domains:selectedDomains,mode:'RESEARCH_PREVIEW',cardIds:ids.length?ids:undefined,asOf,maxRefs:2})
  // Lexical matching is document discovery only. It does not infer a training
  // purpose, a diagnosis, or a dose. Exact card IDs take precedence over topics.
  if (!ids.length && selectedDomains.length) {
    const ranked=cards.filter(c=>selectedDomains.includes(c.domain as CompleteKnowledgeDomain)).map(c=>({c,
      score:[...c.title.matchAll(/[\u4e00-\u9fff]{2,}|[A-Za-z]{2,}/g)].reduce((n,m)=>n+(q.includes(m[0])?4:[...m[0]].slice(0,-1).filter((_,i)=>q.includes(m[0].slice(i,i+2))).length),0)}))
      .sort((a,b)=>b.score-a.score||a.c.id.localeCompare(b.c.id))
    const chosen=selectCompleteKnowledge({task:'knowledge',domains:selectedDomains,mode:'RESEARCH_PREVIEW',cardIds:ranked.slice(0,2).map(x=>x.c.id),asOf,maxRefs:2})
    selection.uses=chosen.uses
  }
  if (!selection.uses.length) return {text:selection.status==='NOT_KNOWN_AT_ASOF'?'这份资料在所选时点尚未接入，不能用于当时的判断。':
    '可查阅训练原理、跑步、力量、恢复、测量与营养六类待审核资料。你想查看哪类，或哪张知识卡？',selection,writesPerformed:false as const}
  const text=['以下是待专业审核的研究资料预览，尚未作为你的训练处方依据。',...selection.uses.map(use=>
    `${use.cardId}｜${use.title}\n资料中的应用提案：${use.applicationProposal}\n适用边界：${use.unsupported}\n来源：${use.sourceRefs.map(s=>`${s.title}（${s.url}）`).join('；')}`),
    '这里只展示资料内容；是否适用于个人，需要核对训练事实、人群和专业限制。'].join('\n\n')
  return {text,selection,writesPerformed:false as const}
}

/** Reuse the existing C03 dependency comparator. Research receipts remain
 * read-only: never register pending knowledge as a personal hypothesis basis. */
export function reviewCompleteKnowledgeUses(saved:readonly CompleteKnowledgeUse[],context:{athleteId:string;asOf:number}) {
  const unavailable={state:'BLOCKED' as const,changedScopes:[] as string[],reasons:['KNOWLEDGE_SCOPE_UNAVAILABLE'],planWriteAuthorized:false as const}
  if (!context.athleteId||!Number.isSafeInteger(context.asOf)||context.asOf>Date.now()||!Array.isArray(saved)) return unavailable
  const snapshot=(use:CompleteKnowledgeUse,available:boolean):C03QuerySnapshot=>({
    scopeKey:`${COMPLETE_KNOWLEDGE_VERSION}:CARD:${use.cardId}`,athleteId:context.athleteId,asOf:Math.min(Date.parse(use.knownAt),context.asOf),
    state:available?'COMPLETE':'PENDING',completeRead:available,
    // 批准状态由 history.ts 用受信账本单独核对；这里只比内容（卡号/版本/内容哈希/来源哈希）。
    dataKey:JSON.stringify([use.id,use.version,use.contentSha256,use.applicability,use.prescriptionAuthorized,use.sourceRefs.map(s=>[s.id,s.contentSha256])]),
    provenanceKey:JSON.stringify(use.sourceRefs.map(s=>[s.id,s.contentSha256])),
  })
  if (saved.some(s=>!cards.some(c=>c.id===s.cardId)||!Number.isFinite(Date.parse(s.knownAt))||Date.parse(s.knownAt)>context.asOf)) return unavailable
  const previous=saved.map(s=>snapshot(s,true)),current=saved.map(s=>{
    const c=cards.find(c=>c.id===s.cardId)!
    const selection=selectCompleteKnowledge({task:'knowledge',domains:[c.domain as CompleteKnowledgeDomain],cardIds:[s.cardId],mode:'RESEARCH_PREVIEW',asOf:new Date(context.asOf).toISOString()})
    return snapshot(selection.uses[0]??s,!!selection.uses.length)
  })
  return compareCoachFollowupDependencies(previous,current,context.asOf)
}


/** v87 正式分析入口：只取经受信回执批准的卡（默认 0 张 → 返回 null，回答不变）。
 * 输出进入回答的“依据”段，标明是通用知识、不是个人证据、不授权剂量；uses 随消息保存，用于日后复核。 */
export function formalKnowledgeSection(question:string,asOf?:string,ledger?:VerifiedKnowledgeLedger|null):{text:string;uses:CompleteKnowledgeUse[]}|null {
  const q=typeof question==='string'?question.normalize('NFKC').slice(0,2000):''
  if (!q||isCompleteKnowledgePreviewRequest(q)) return null
  const selected=completeKnowledgeDomains(q); if (!selected.length) return null
  const sel=selectCompleteKnowledge({task:'knowledge',domains:selected,mode:'PRODUCTION',asOf,maxRefs:2,...(ledger!==undefined?{ledger}:{})})
  const uses=sel.uses.filter(u=>u.productionEligible&&u.approvalReceiptId)
  if (!uses.length) return null
  return {uses,text:'已审核的通用知识（不是你的个人证据，不授权剂量）：'+uses.map(u=>`${u.cardId} v${u.version}｜${u.title}：${u.applicationProposal}（边界：${u.unsupported}）`).join('；')}
}
