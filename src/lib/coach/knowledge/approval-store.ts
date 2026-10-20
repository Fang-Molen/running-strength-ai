/** 受信回执的本机存放处（只存原始回执，读取时重新验证签名与哈希）。
 * 存进来不等于批准：没有受信审核人公钥时，所有回执都会被拒绝。 */
import { currentStore } from '../../core/storage.ts'
import { verifyKnowledgeApprovals, installKnowledgeLedger, type TrustedReviewerKey, type VerifiedKnowledgeLedger } from './approval.ts'
export const KNOWLEDGE_APPROVALS_KEY = 'fk-knowledge-approvals-v1'
function readRaw(): unknown[] { try { const v = JSON.parse(currentStore()?.getItem(KNOWLEDGE_APPROVALS_KEY) ?? '[]'); return Array.isArray(v) ? v : [] } catch { return [] } }
/** 受信管理员导入签名回执（追加，不覆盖；同 receiptId 不重复）。返回验证结果，未通过的不会生效。 */
export async function importKnowledgeApprovalReceipts(receipts: unknown[], options: { trustedKeys?: readonly TrustedReviewerKey[]; asOf?: string } = {}) {
  const store = currentStore(); if (!store || !Array.isArray(receipts)) return { ok: false as const, reason: 'STORE_UNAVAILABLE' }
  const prior = readRaw(), ids = new Set(prior.map(r => (r as { receiptId?: string })?.receiptId))
  const fresh = receipts.filter(r => r && typeof r === 'object' && typeof (r as { receiptId?: unknown }).receiptId === 'string' && !ids.has((r as { receiptId: string }).receiptId))
  const ledger = await verifyKnowledgeApprovals([...prior, ...fresh], options)
  const accepted = fresh.filter(r => !ledger.rejected.some(x => x.receiptId === (r as { receiptId: string }).receiptId))
  if (accepted.length) store.setItem(KNOWLEDGE_APPROVALS_KEY, JSON.stringify([...prior, ...accepted].slice(-500)))
  return { ok: true as const, accepted: accepted.length, rejected: ledger.rejected.filter(x => fresh.some(r => (r as { receiptId: string }).receiptId === x.receiptId)) }
}
/** 启动时调用：读本机回执 → 用宿主内置受信名单验证 → 安装到当前会话。 */
export async function loadInstalledKnowledgeLedger(options: { trustedKeys?: readonly TrustedReviewerKey[]; asOf?: string } = {}): Promise<VerifiedKnowledgeLedger> {
  const ledger = await verifyKnowledgeApprovals(readRaw(), options)
  installKnowledgeLedger(ledger); return ledger
}
