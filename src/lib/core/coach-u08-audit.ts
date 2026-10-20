/**
 * U08: audit STRUCTURED model output against trusted V87 C03 numeric proof and
 * the host-verified complete-knowledge selection. This is an explanatory lint,
 * NEVER a safety clearance, professional correctness grade or plan executor.
 *
 * Only the host may construct brief/review/knowledge from trusted functions;
 * model output and user-supplied JSON must never be used to forge these inputs.
 */
import type { C03MetricBrief } from './coach-c03-evidence.ts'
import type { C03ArgumentReview } from './coach-c03-argument.ts'
import { selectCompleteKnowledge } from '../coach/knowledge/complete.ts'

export type U08EvidenceUse = Readonly<{
  handle: string; value: number; unit: string; role: 'FACT' | 'REASON' | 'DECISION'
}>
export type U08KnowledgeUse = Readonly<{
  cardId: string; version: number; contentSha256: string;
  role: 'GENERAL_EXPLANATION' | 'PERSONAL_PRESCRIPTION'
}>
export type U08AnswerDraft = Readonly<{
  schema: 'FK-U08-ANSWER-1'; revisionReceipt: string; selectedOptionId: string;
  evidenceUses: readonly U08EvidenceUse[]; knowledgeUses: readonly U08KnowledgeUse[];
  /** Host can display missing information; model must not substitute zeros. */
  missingAcknowledged: readonly string[];
}>
export type U08AnswerAudit = Readonly<{
  status: 'BLOCKED' | 'STRUCTURAL_PASS_SEMANTICS_UNVERIFIED'; reasons: readonly string[];
  selectedOptionId: string | null; usedNumericHandles: readonly string[];
  reviewedKnowledgeCards: readonly string[];
  semanticCorrectnessEvaluated: false; professionalReviewRequired: true;
  trainingBenefitProven: false; planMutationAuthorized: false; didWrite: false; didCallModel: false
}>
const obj = (x:unknown):x is Record<string,unknown> => !!x && typeof x==='object' && !Array.isArray(x)
const nonblank = (x:unknown):x is string => typeof x==='string' && x.trim().length>0 && x.length<=1000
const exact = (x:unknown, fields:readonly string[]) => obj(x) && Object.keys(x).sort().join('|')===[...fields].sort().join('|')
const boundedArray = (x:unknown, limit:number):x is unknown[] => Array.isArray(x) && x.length<=limit

export function auditU08Answer(
  brief:C03MetricBrief, review:C03ArgumentReview,
  raw:unknown, task:'FACT'|'EXPLAIN'|'COMPARE', requiredDecisionHandles:readonly string[]
):U08AnswerAudit {
  const reasons:string[]=[]
  const output=(status:U08AnswerAudit['status'], option:string|null=null, used:string[]=[], cards:string[]=[]):U08AnswerAudit=>({
    status,reasons:[...new Set(reasons)],selectedOptionId:option,usedNumericHandles:used,reviewedKnowledgeCards:cards,
    semanticCorrectnessEvaluated:false,professionalReviewRequired:true,trainingBenefitProven:false,
    planMutationAuthorized:false,didWrite:false,didCallModel:false
  })
  if(!obj(brief)||!obj(review)||!boundedArray(brief.numbers,512)||!boundedArray(brief.missing,512)||
    typeof brief.revisionReceipt!=='string'||!brief.revisionReceipt.length||brief.revisionReceipt.length>500000||typeof brief.asOf!=='string'||!Number.isFinite(Date.parse(brief.asOf))||
    brief.numbers.some(n=>!obj(n)||!nonblank(n.handle)||typeof n.value!=='number'||!Number.isFinite(n.value)||!nonblank(n.unit))||
    brief.missing.some(m=>!nonblank(m))||new Set(brief.numbers.map(n=>n.handle)).size!==brief.numbers.length||
    !boundedArray(review.candidateTable,12)||review.candidateTable.some(o=>!obj(o)||!nonblank(o.id))){
    reasons.push('INVALID_HOST_CONTEXT');return output('BLOCKED')
  }
  if (!['FACT','EXPLAIN','COMPARE'].includes(task)) reasons.push('INVALID_TASK')
  if (brief.state==='BLOCKED'||review.state!=='STRUCTURAL_REVIEW_ONLY'||review.selectedOptionId===null ||
    review.semanticCorrectnessEvaluated!==false || review.planMutationAuthorized!==false) reasons.push('HOST_C03_REVIEW_NOT_READY')
  if (!boundedArray(requiredDecisionHandles,512)||requiredDecisionHandles.some(h=>!nonblank(h))||
    new Set(requiredDecisionHandles).size!==requiredDecisionHandles.length) {
    reasons.push('INVALID_REQUIRED_HANDLES');return output('BLOCKED')
  }
  if (!exact(raw,['schema','revisionReceipt','selectedOptionId','evidenceUses','knowledgeUses','missingAcknowledged'])) {
    reasons.push('ANSWER_SCHEMA');return output('BLOCKED')
  }
  const d=raw as Record<string,unknown>
  if (d.schema!=='FK-U08-ANSWER-1'||d.revisionReceipt!==brief.revisionReceipt||
    !nonblank(d.selectedOptionId)||d.selectedOptionId!==review.selectedOptionId||
    !review.candidateTable.some(o=>o.id===d.selectedOptionId)) reasons.push('ANSWER_REVISION_OR_OPTION_MISMATCH')
  if (!boundedArray(d.evidenceUses,512)||!boundedArray(d.knowledgeUses,4)||!boundedArray(d.missingAcknowledged,512)) {
    reasons.push('ANSWER_ARRAY_BOUNDS');return output('BLOCKED')
  }
  const numbers=new Map(brief.numbers.map(n=>[n.handle,n]))
  const used=new Set<string>(),decisions=new Set<string>(), seenUses=new Set<string>()
  for (const item of d.evidenceUses) {
    if (!obj(item)) {reasons.push('EVIDENCE_USE_SCHEMA');continue}
    if (!exact(item,['handle','value','unit','role'])||!nonblank(item.handle)||
      !['FACT','REASON','DECISION'].includes(item.role as string)||
      typeof item.value!=='number'||!Number.isFinite(item.value)||!nonblank(item.unit)) {
      reasons.push('EVIDENCE_USE_SCHEMA');continue
    }
    const expected=numbers.get(item.handle as string)
    if (!expected || expected.value!==item.value || expected.unit!==item.unit) {
      reasons.push('STALE_FOREIGN_OR_INVENTED_NUMBER');continue
    }
    const key=`${item.handle}|${item.role}`
    if (seenUses.has(key)) reasons.push('DUPLICATE_NUMBER_USE')
    seenUses.add(key);used.add(item.handle as string)
    if (item.role==='DECISION') decisions.add(item.handle as string)
  }
  if (requiredDecisionHandles.some(h=>!numbers.has(h))) reasons.push('HOST_REQUIRED_HANDLE_NOT_IN_BRIEF')
  // On complex tasks the important figures must inform the decision, not merely
  // appear in the first paragraph. On arithmetic tasks factual citation suffices.
  for (const h of requiredDecisionHandles) if (!(task==='FACT'?used:decisions).has(h)) reasons.push(`KEY_NUMBER_NOT_USED_FOR_${task}:${h}`)
  const missing=new Set(brief.missing)
  const acknowledged=new Set<string>()
  for (const x of d.missingAcknowledged) {
    if (!nonblank(x)||!missing.has(x)||acknowledged.has(x)) reasons.push('INVALID_OR_DUPLICATE_MISSING_ACK')
    else acknowledged.add(x)
  }
  if (brief.missing.length && !brief.missing.every(m=>acknowledged.has(m))) reasons.push('KNOWN_MISSING_NOT_ACKNOWLEDGED')
  // Resolve through the current host's production gate (no trusted approvals
  // are installed in this baseline). A caller
  // cannot forge a CompleteKnowledgeSelection or set productionEligible=true.
  const knowledge=selectCompleteKnowledge({task:'knowledge',
    domains:['PROGRAMMING','RUNNING','STRENGTH','RECOVERY','MEASUREMENT','NUTRITION'],
    mode:'PRODUCTION',cardIds:d.knowledgeUses.filter(obj).map(k=>k.cardId).filter((x):x is string=>typeof x==='string'),
    asOf:brief.asOf,maxRefs:4})
  const reviewed:string[]=[];const seenCards=new Set<string>()
  for (const item of d.knowledgeUses) {
    if (!obj(item)) {reasons.push('KNOWLEDGE_USE_SCHEMA');continue}
    if (!exact(item,['cardId','version','contentSha256','role'])||!nonblank(item.cardId)||
      !Number.isSafeInteger(item.version)||!nonblank(item.contentSha256)||
      !['GENERAL_EXPLANATION','PERSONAL_PRESCRIPTION'].includes(item.role as string)) {
      reasons.push('KNOWLEDGE_USE_SCHEMA');continue
    }
    if (seenCards.has(item.cardId as string)) reasons.push('DUPLICATE_KNOWLEDGE_USE')
    seenCards.add(item.cardId as string)
    // Only a trusted production approval system may create this selection.
    // A string from the model must never act as an approval receipt.
    const matched=knowledge.uses.find(k=>k.cardId===item.cardId&&k.version===item.version&&k.contentSha256===item.contentSha256)
    if (knowledge.mode!=='PRODUCTION'||
      !matched||!matched.productionEligible||!matched.approvalReceiptId) reasons.push('UNAPPROVED_OR_FOREIGN_KNOWLEDGE')
    else reviewed.push(item.cardId as string)
    if (item.role==='PERSONAL_PRESCRIPTION') reasons.push('GENERAL_KNOWLEDGE_CANNOT_PRESCRIBE')
  }
  if (reasons.length) return output('BLOCKED',null,[...used],reviewed)
  return output('STRUCTURAL_PASS_SEMANTICS_UNVERIFIED',d.selectedOptionId as string,[...used],reviewed)
}

/** Pairwise structural counterfactual audit: changing a relevant input should
 * update its cited numeric value, even if the safe final action stays HOLD.
 * This cannot decide whether the wording/physiology is correct. */
export function auditU08Pair(input:{
  baselineBrief:C03MetricBrief; changedBrief:C03MetricBrief;
  baseline:U08AnswerDraft; changed:U08AnswerDraft;
  /** Relevant handles are frozen by the independent case designer, not model. */
  relevantHandles:readonly string[];
}):{state:'BLOCKED'|'STRUCTURAL_CHANGE_OBSERVED'|'NOT_APPLICABLE';reasons:string[];semanticCorrectnessEvaluated:false} {
  if(!obj(input)||!obj(input.baselineBrief)||!obj(input.changedBrief)||!obj(input.baseline)||!obj(input.changed)||
    !Array.isArray(input.baselineBrief.numbers)||!Array.isArray(input.changedBrief.numbers)||
    !Array.isArray(input.baseline.evidenceUses)||!Array.isArray(input.changed.evidenceUses)||
    [...input.baselineBrief.numbers,...input.changedBrief.numbers,...input.baseline.evidenceUses,...input.changed.evidenceUses]
      .some(n=>!obj(n)||!nonblank(n.handle)||typeof n.value!=='number'||!Number.isFinite(n.value)||!nonblank(n.unit)))
    return {state:'BLOCKED',reasons:['PAIR_CONTEXT_INVALID'],semanticCorrectnessEvaluated:false}
  const {baselineBrief,changedBrief,baseline,changed,relevantHandles}=input
  const reasons:string[]=[]
  if (!Array.isArray(relevantHandles)||relevantHandles.length>512||new Set(relevantHandles).size!==relevantHandles.length ||
    relevantHandles.some(h=>!nonblank(h)))
    return {state:'BLOCKED',reasons:['PAIR_SCOPE_INVALID'],semanticCorrectnessEvaluated:false}
  if (baselineBrief.athleteId!==changedBrief.athleteId ||
    baselineBrief.observedOccurrenceId!==changedBrief.observedOccurrenceId) reasons.push('PAIR_SCOPE_INVALID')
  if (baseline.revisionReceipt!==baselineBrief.revisionReceipt || changed.revisionReceipt!==changedBrief.revisionReceipt)
    reasons.push('PAIR_STALE_RECEIPT')
  const before=new Map(baselineBrief.numbers.map(n=>[n.handle,n])),after=new Map(changedBrief.numbers.map(n=>[n.handle,n]))
  const changedHandles=relevantHandles.filter(h=>{
    const a=before.get(h),b=after.get(h)
    if (!a||!b) {reasons.push(`PAIR_UNKNOWN_HANDLE:${h}`);return false}
    return a.value!==b.value||a.unit!==b.unit
  })
  for (const h of changedHandles) {
    const a=baseline.evidenceUses.find(x=>x.handle===h),b=changed.evidenceUses.find(x=>x.handle===h)
    if (!a||!b) {reasons.push(`PAIR_CHANGED_FACT_NOT_USED:${h}`);continue}
    if (a.value!==before.get(h)?.value||b.value!==after.get(h)?.value||a.unit!==before.get(h)?.unit||b.unit!==after.get(h)?.unit)
      reasons.push(`PAIR_STALE_OR_WRONG_VALUE:${h}`)
  }
  if (reasons.length) return {state:'BLOCKED',reasons,semanticCorrectnessEvaluated:false}
  return {state:changedHandles.length?'STRUCTURAL_CHANGE_OBSERVED':'NOT_APPLICABLE',reasons:[],semanticCorrectnessEvaluated:false}
}
