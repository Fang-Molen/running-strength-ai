/** v87 知识审批入口（受信回执）。
 * 只有“受信审核人签名的回执”才能让一张知识卡进入正式分析：
 *  - 签名用 Ed25519，公钥必须在宿主内置的受信审核人名单里（PRODUCTION_TRUSTED_REVIEWER_KEYS）；
 *  - 回执绑定 卡号 + 卡版本 + 卡内容哈希 + 每个来源的内容哈希，任何一项变了，旧回执自动失效；
 *  - 卡片 JSON 里的 professional_review / production_eligible / registry.trustedApprovalReceipts、
 *    用户消息、模型输出都不能批准；审核人身份只能是人类专业人员或受信管理员，不能是模型/系统。
 * 当前没有提供任何受信审核人公钥，所以正式批准数恒为 0；48 张卡全部 PENDING。
 */
import rawCards from '../../../../knowledge/coach-complete-20261020/knowledge_cards.json' with { type: 'json' }
import registry from '../../../../knowledge/coach-complete-20261020/registry.json' with { type: 'json' }

export const KNOWLEDGE_APPROVAL_SCHEMA = 'FK-KNOWLEDGE-APPROVAL-1' as const
export const KNOWLEDGE_CATALOG = 'FK-COACH-KNOWLEDGE-COMPLETE-20261020' as const
export type TrustedReviewerKey = {
  keyId: string; reviewerId: string; role: 'HUMAN_PROFESSIONAL' | 'TRUSTED_ADMIN'
  /** Ed25519 raw public key, base64 */
  publicKey: string; validFrom: string; validUntil: string | null
}
export type KnowledgeApprovalReceipt = {
  schema: typeof KNOWLEDGE_APPROVAL_SCHEMA; receiptId: string; catalog: typeof KNOWLEDGE_CATALOG
  cardId: string; cardVersion: number; contentSha256: string; sourceSha256: Record<string, string>
  decision: 'APPROVED' | 'REVOKED'; scope: { population: string; note: string; usage?: 'GENERAL_EDUCATION' | 'PERSONAL_ANALYSIS' }
  reviewer: { id: string; role: 'HUMAN_PROFESSIONAL' | 'TRUSTED_ADMIN' }
  reviewedAt: string; keyId: string; signature: string
}
/** 宿主内置的受信审核人名单。目前为空：没有任何受信审核人，正式批准数为 0。
 * 增加审核人需要改代码并重新发布（不是运行时开关，也不能由数据或模型写入）。 */
export const PRODUCTION_TRUSTED_REVIEWER_KEYS: readonly TrustedReviewerKey[] = Object.freeze([])

type Approved = Readonly<{ cardId: string; cardVersion: number; contentSha256: string; receiptId: string; reviewedAt: string; reviewerId: string; validUntil: string | null; scope: Readonly<KnowledgeApprovalReceipt['scope']> }>
export type VerifiedKnowledgeLedger = {
  readonly verifiedAt: string; readonly approved: ReadonlyMap<string, Approved>
  readonly rejected: readonly { receiptId: string; reason: string }[]
}
// Authorization state never escapes this module. A caller may mutate its own
// inspection Map, but neither Map mutations nor value mutations affect authority.
const authority = new WeakMap<object, ReadonlyMap<string, Approved>>()
const brand = new WeakSet<object>()
export const isVerifiedKnowledgeLedger = (x: unknown): x is VerifiedKnowledgeLedger => !!x && typeof x === 'object' && brand.has(x)
const cards = rawCards as { id: string; version: number; source_ids: string[] }[]
const cardSha = registry.cardSha256 as Record<string, string>, sourceSha = registry.sourceSha256 as Record<string, string>
const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x)
/** 被签名的内容：回执去掉 signature 后的规范 JSON。 */
export const approvalSigningPayload = (r: Omit<KnowledgeApprovalReceipt, 'signature'> | KnowledgeApprovalReceipt) => { const { signature: _s, ...rest } = r as KnowledgeApprovalReceipt; void _s; return new TextEncoder().encode(canonical(rest)) }
const b64 = (s: string) => { const bin = atob(s); return Uint8Array.from(bin, c => c.charCodeAt(0)) }
const MODEL_REVIEWER = /model|deepseek|gpt|llm|assistant|system|grok|codex|auto/i
const handle = (id: string, version: number) => `${KNOWLEDGE_CATALOG}:${id}@${version}`
export const approvalHandle = handle

function shapeProblem(r: KnowledgeApprovalReceipt, keys: readonly TrustedReviewerKey[], asOf: number): string | null {
  if (!r || typeof r !== 'object' || r.schema !== KNOWLEDGE_APPROVAL_SCHEMA || r.catalog !== KNOWLEDGE_CATALOG) return 'SCHEMA'
  if (typeof r.receiptId !== 'string' || !r.receiptId || typeof r.signature !== 'string' || typeof r.keyId !== 'string') return 'SCHEMA'
  if (!['APPROVED', 'REVOKED'].includes(r.decision)) return 'DECISION'
  if (!r.reviewer || !['HUMAN_PROFESSIONAL', 'TRUSTED_ADMIN'].includes(r.reviewer.role) || typeof r.reviewer.id !== 'string' || MODEL_REVIEWER.test(r.reviewer.id)) return 'REVIEWER_NOT_HUMAN_OR_TRUSTED_ADMIN'
  if (r.scope?.usage !== undefined && !['GENERAL_EDUCATION', 'PERSONAL_ANALYSIS'].includes(r.scope.usage)) return 'SCOPE_INVALID'
  const key = keys.find(k => k.keyId === r.keyId)
  if (!key) return 'UNTRUSTED_KEY'
  if (key.reviewerId !== r.reviewer.id || key.role !== r.reviewer.role) return 'REVIEWER_KEY_MISMATCH'
  if (!r.scope || typeof r.scope.population !== 'string' || !r.scope.population.trim() || typeof r.scope.note !== 'string') return 'SCOPE_INVALID'
  if (!Number.isFinite(Date.parse(key.validFrom)) || key.validUntil !== null && !Number.isFinite(Date.parse(key.validUntil))) return 'KEY_TIME_INVALID'
  if (Date.parse(key.validFrom) > asOf || key.validUntil !== null && Date.parse(key.validUntil) < asOf) return 'KEY_NOT_ACTIVE'
  const at = Date.parse(r.reviewedAt)
  if (!Number.isFinite(at) || at > asOf || at < Date.parse(key.validFrom) || (key.validUntil !== null && at > Date.parse(key.validUntil))) return 'REVIEW_TIME_INVALID'
  if (at < Date.parse(registry.importedAt)) return 'BEFORE_IMPORT'
  const card = cards.find(c => c.id === r.cardId)
  if (!card) return 'UNKNOWN_CARD'
  if (card.version !== r.cardVersion) return 'CARD_VERSION_CHANGED'
  if (cardSha[card.id] !== r.contentSha256) return 'CARD_CONTENT_CHANGED'
  const want = Object.fromEntries(card.source_ids.map(id => [id, sourceSha[id]]))
  if (canonical(want) !== canonical(r.sourceSha256 ?? {})) return 'SOURCE_CONTENT_CHANGED'
  return null
}
/** 验证一批回执（来自本机受信管理员导入或受信服务端），返回只能由本函数生成的账本。 */
export async function verifyKnowledgeApprovals(receipts: readonly unknown[], options: { trustedKeys?: readonly TrustedReviewerKey[]; asOf?: string } = {}): Promise<VerifiedKnowledgeLedger> {
  const keys = structuredClone(options.trustedKeys ?? PRODUCTION_TRUSTED_REVIEWER_KEYS), asOfIso = options.asOf ?? new Date().toISOString(), asOf = Date.parse(asOfIso)
  const rejected: { receiptId: string; reason: string }[] = [], valid: KnowledgeApprovalReceipt[] = []
  // Snapshot before the first await: callers cannot alter a signed receipt
  // between validation and installation.
  let input: unknown[] = []
  try { input = structuredClone(Array.isArray(receipts) ? receipts : []) } catch { /* invalid input grants nothing */ }
  const seen = new Map<string, string>(), conflicts = new Set<string>()
  for (const item of input) {
    const r = item as KnowledgeApprovalReceipt
    if (typeof r?.receiptId !== 'string') continue
    const value = canonical(r)
    if (seen.has(r.receiptId) && seen.get(r.receiptId) !== value) conflicts.add(r.receiptId)
    seen.set(r.receiptId, value)
  }
  for (const raw of input) {
    const r = raw as KnowledgeApprovalReceipt, id = typeof r?.receiptId === 'string' ? r.receiptId : '?'
    if (conflicts.has(id)) { rejected.push({ receiptId: id, reason: 'RECEIPT_ID_CONFLICT' }); continue }
    const problem = Number.isFinite(asOf) && asOf <= Date.now() + 60_000 ? shapeProblem(r, keys, asOf) : 'CLOCK'
    if (problem) { rejected.push({ receiptId: id, reason: problem }); continue }
    let ok = false
    try {
      const key = keys.find(k => k.keyId === r.keyId)!
      const pub = await crypto.subtle.importKey('raw', b64(key.publicKey), { name: 'Ed25519' }, false, ['verify'])
      ok = await crypto.subtle.verify({ name: 'Ed25519' }, pub, b64(r.signature), approvalSigningPayload(r))
    } catch { ok = false }
    if (!ok) { rejected.push({ receiptId: id, reason: 'SIGNATURE_INVALID_OR_UNSUPPORTED' }); continue }
    valid.push(r)
  }
  // 每张卡以最新的有效回执为准；撤销回执会移除批准。
  const approved = new Map<string, Approved>()
  for (const r of [...valid].sort((a, b) => Date.parse(a.reviewedAt) - Date.parse(b.reviewedAt) || Number(a.decision === 'REVOKED') - Number(b.decision === 'REVOKED') || a.receiptId.localeCompare(b.receiptId))) {
    const h = handle(r.cardId, r.cardVersion)
    if (r.decision === 'REVOKED') approved.delete(h)
    else approved.set(h, Object.freeze({ cardId: r.cardId, cardVersion: r.cardVersion, contentSha256: r.contentSha256, receiptId: r.receiptId, reviewedAt: r.reviewedAt, reviewerId: r.reviewer.id, validUntil: keys.find(k => k.keyId === r.keyId)!.validUntil, scope: Object.freeze({ ...r.scope }) }))
  }
  const ledger: VerifiedKnowledgeLedger = Object.freeze({ verifiedAt: asOfIso, get approved() { return new Map(approved) }, rejected: Object.freeze(rejected.map(r => Object.freeze({ ...r }))) })
  authority.set(ledger, approved)
  brand.add(ledger)
  return ledger
}
/** 某个卡版本+内容哈希是否被这个（经验证的）账本批准。非账本对象一律 false。 */
export function ledgerApproves(ledger: unknown, cardId: string, cardVersion: number, contentSha256: string, asOf = new Date().toISOString()): Approved | null {
  if (!isVerifiedKnowledgeLedger(ledger)) return null
  const time = Date.parse(asOf)
  if (!Number.isFinite(time) || time > Date.now() + 60_000) return null
  const a = authority.get(ledger)?.get(handle(cardId, cardVersion))
  return a && a.contentSha256 === contentSha256 && Date.parse(a.reviewedAt) <= time
    && (a.validUntil === null || time <= Date.parse(a.validUntil)) ? a : null
}

// 当前会话使用的账本：只接受 verifyKnowledgeApprovals 生成的对象；默认没有（= 0 批准）。
let installed: VerifiedKnowledgeLedger | null = null
const ledgerListeners = new Set<() => void>()
export function subscribeKnowledgeLedger(listener: () => void): () => void {
  ledgerListeners.add(listener)
  return () => { ledgerListeners.delete(listener) }
}
export function installKnowledgeLedger(ledger: VerifiedKnowledgeLedger | null): boolean {
  if (ledger !== null && !isVerifiedKnowledgeLedger(ledger)) return false
  installed = ledger
  for (const listener of ledgerListeners) { try { listener() } catch { /* UI cannot veto revocation */ } }
  return true
}
export const currentKnowledgeLedger = (): VerifiedKnowledgeLedger | null => installed
