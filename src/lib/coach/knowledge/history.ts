/** v87 知识变化后的历史判断复核：用过知识卡的旧回答，在卡/来源哈希、版本或批准状态变化后标“需复核”。
 * 复用 C03 依赖比较器（reviewCompleteKnowledgeUses → compareCoachFollowupDependencies），不另建账本、不改写旧回答。 */
import { reviewCompleteKnowledgeUses, type CompleteKnowledgeUse } from './complete.ts'
import { currentKnowledgeLedger, ledgerApproves, type VerifiedKnowledgeLedger } from './approval.ts'
export type KnowledgeJudgmentReview = { messageId: string; state: 'CURRENT' | 'NEEDS_REVIEW'; reasons: string[] }
export function reviewKnowledgeJudgments(messages: readonly { id: string; knowledgeUses?: readonly CompleteKnowledgeUse[] }[],
  context: { athleteId: string; asOf: number; ledger?: VerifiedKnowledgeLedger | null }): KnowledgeJudgmentReview[] {
  const ledger = context.ledger === undefined ? currentKnowledgeLedger() : context.ledger, out: KnowledgeJudgmentReview[] = []
  for (const m of messages) {
    const uses = Array.isArray(m?.knowledgeUses) ? m.knowledgeUses : []
    if (!uses.length) continue
    const dep = reviewCompleteKnowledgeUses(uses, { athleteId: context.athleteId, asOf: context.asOf })
    const reasons = dep.state === 'UNCHANGED' || dep.state === 'PROVENANCE_ONLY' ? [] : [...dep.reasons]
    for (const u of uses) if (u.approvalReceiptId && !ledgerApproves(ledger, u.cardId, u.version, u.contentSha256, new Date(context.asOf).toISOString())) reasons.push(`APPROVAL_NO_LONGER_VALID:${u.cardId}`)
    out.push({ messageId: m.id, state: reasons.length ? 'NEEDS_REVIEW' : 'CURRENT', reasons })
  }
  return out
}
