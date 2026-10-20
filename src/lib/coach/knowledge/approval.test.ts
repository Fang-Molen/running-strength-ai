// v87 受信知识审批：签名回执 → 版本/哈希绑定 → 正式分析只用已批准卡 → 卡或批准变化后历史回答标“需复核”。
// 测试专用密钥对在测试里临时生成，不进入产品代码；产品受信名单为空，所以 48 卡在产品里始终 0 批准。
import test from 'node:test'
import assert from 'node:assert/strict'
import registry from '../../../../knowledge/coach-complete-20261020/registry.json' with { type: 'json' }
import rawCards from '../../../../knowledge/coach-complete-20261020/knowledge_cards.json' with { type: 'json' }
import { verifyKnowledgeApprovals, approvalSigningPayload, installKnowledgeLedger, PRODUCTION_TRUSTED_REVIEWER_KEYS, ledgerApproves,
  type KnowledgeApprovalReceipt, type TrustedReviewerKey } from './approval.ts'
import { selectCompleteKnowledge, formalKnowledgeSection, completeKnowledgeInventory } from './complete.ts'
import { reviewKnowledgeJudgments } from './history.ts'
import { importKnowledgeApprovalReceipts, loadInstalledKnowledgeLedger, KNOWLEDGE_APPROVALS_KEY } from './approval-store.ts'
import { answerLocally } from '../../core/coach-local-first.ts'
import { assembleCoachBrief } from '../../core/coach-brief.ts'
import { firstWeekMemory } from '../../core/coach-first-week.fixtures.ts'
import { setStoreBackend } from '../../core/storage.ts'
import { emptyDialogue } from '../../core/coach-dialogue.ts'

const b64 = (u: ArrayBuffer | Uint8Array) => Buffer.from(u instanceof Uint8Array ? u : new Uint8Array(u)).toString('base64')
const cardSha = registry.cardSha256 as Record<string, string>, sourceSha = registry.sourceSha256 as Record<string, string>
const R03 = (rawCards as { id: string; version: number; source_ids: string[] }[]).find(c => c.id === 'R03')!
async function testReviewer(reviewerId = 'test-coach-reviewer', role: TrustedReviewerKey['role'] = 'HUMAN_PROFESSIONAL') {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair
  const key: TrustedReviewerKey = { keyId: `TEST-${reviewerId}`, reviewerId, role, publicKey: b64(await crypto.subtle.exportKey('raw', pair.publicKey)), validFrom: '2026-10-20T00:00:00Z', validUntil: null }
  const sign = async (r: Omit<KnowledgeApprovalReceipt, 'signature'>): Promise<KnowledgeApprovalReceipt> => ({ ...r, signature: b64(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, approvalSigningPayload(r))) })
  return { key, sign }
}
const receipt = (over: Partial<KnowledgeApprovalReceipt> = {}): Omit<KnowledgeApprovalReceipt, 'signature'> => ({
  schema: 'FK-KNOWLEDGE-APPROVAL-1', receiptId: 'rcpt-R03-1', catalog: 'FK-COACH-KNOWLEDGE-COMPLETE-20261020', cardId: 'R03', cardVersion: R03.version,
  contentSha256: cardSha.R03, sourceSha256: Object.fromEntries(R03.source_ids.map(id => [id, sourceSha[id]])), decision: 'APPROVED',
  scope: { population: '成年业余跑者（测试）', note: 'test fixture only' }, reviewer: { id: 'test-coach-reviewer', role: 'HUMAN_PROFESSIONAL' },
  reviewedAt: new Date(Date.now() - 60_000).toISOString(), keyId: 'TEST-test-coach-reviewer', ...over,
})

test('production: no trusted reviewer keys, all 48 cards PENDING, zero approvals', async () => {
  assert.equal(PRODUCTION_TRUSTED_REVIEWER_KEYS.length, 0)
  const { sign } = await testReviewer()
  const ledger = await verifyKnowledgeApprovals([await sign(receipt())]) // production key list
  assert.equal(ledger.approved.size, 0); assert.equal(ledger.rejected[0].reason, 'UNTRUSTED_KEY')
  assert.equal(completeKnowledgeInventory().approvedForProduction, 0)
  assert.deepEqual(selectCompleteKnowledge({ task: 'knowledge', domains: ['RUNNING', 'MEASUREMENT'], mode: 'PRODUCTION', ledger }).uses, [])
  assert.ok((rawCards as { professional_review: string }[]).every(c => c.professional_review === 'PENDING'))
})
test('a valid signed receipt from a trusted human reviewer approves exactly that card version + hash', async () => {
  const { key, sign } = await testReviewer()
  const ledger = await verifyKnowledgeApprovals([await sign(receipt())], { trustedKeys: [key] })
  assert.equal(ledger.approved.size, 1); assert.ok(ledgerApproves(ledger, 'R03', R03.version, cardSha.R03))
  const sel = selectCompleteKnowledge({ task: 'knowledge', domains: ['RUNNING', 'MEASUREMENT'], mode: 'PRODUCTION', ledger })
  assert.equal(sel.status, 'APPROVED_BY_TRUSTED_RECEIPT'); assert.deepEqual(sel.uses.map(u => u.cardId), ['R03'])
  assert.equal(sel.uses[0].productionEligible, true); assert.equal(sel.uses[0].approvalReceiptId, 'rcpt-R03-1'); assert.equal(sel.uses[0].prescriptionAuthorized, false)
})
test('self-approval paths are rejected: JSON labels, forged/missing signatures, model reviewers, wrong hash/version/sources, future time', async () => {
  const { key, sign } = await testReviewer(), other = await testReviewer()
  const cases: [string, unknown][] = [
    ['UNTRUSTED_KEY', await other.sign(receipt({ keyId: 'TEST-unknown' }))],
    ['SIGNATURE_INVALID_OR_UNSUPPORTED', { ...(await sign(receipt())), signature: (await other.sign(receipt({ keyId: key.keyId }))).signature }],
    ['SIGNATURE_INVALID_OR_UNSUPPORTED', { ...(await sign(receipt())), scope: { population: '所有人', note: 'edited after signing' } }],
    ['REVIEWER_NOT_HUMAN_OR_TRUSTED_ADMIN', await sign(receipt({ receiptId: 'm', reviewer: { id: 'deepseek-model', role: 'HUMAN_PROFESSIONAL' } }))],
    ['CARD_CONTENT_CHANGED', await sign(receipt({ receiptId: 'h', contentSha256: '0'.repeat(64) }))],
    ['CARD_VERSION_CHANGED', await sign(receipt({ receiptId: 'v', cardVersion: R03.version + 1 }))],
    ['SOURCE_CONTENT_CHANGED', await sign(receipt({ receiptId: 's', sourceSha256: { S01: 'x' } }))],
    ['REVIEW_TIME_INVALID', await sign(receipt({ receiptId: 'f', reviewedAt: new Date(Date.now() + 86_400_000).toISOString() }))],
    ['SCHEMA', { cardId: 'R03', professional_review: 'APPROVED', production_eligible: true, receiptId: 'json' }],
  ]
  for (const [reason, r] of cases) {
    const ledger = await verifyKnowledgeApprovals([r], { trustedKeys: [key] })
    assert.equal(ledger.approved.size, 0, reason); assert.equal(ledger.rejected[0]?.reason, reason)
  }
  // a plain object shaped like a ledger is not a ledger
  assert.equal(ledgerApproves({ approved: new Map([['x', {}]]) }, 'R03', R03.version, cardSha.R03), null)
  assert.equal(installKnowledgeLedger({ verifiedAt: '', approved: new Map(), rejected: [] } as never), false)
  // registry-embedded receipts are not read at all
  assert.deepEqual(registry.trustedApprovalReceipts, [])
})
test('revocation receipt removes the approval', async () => {
  const { key, sign } = await testReviewer()
  const ledger = await verifyKnowledgeApprovals([await sign(receipt()), await sign(receipt({ receiptId: 'rcpt-R03-2', decision: 'REVOKED', reviewedAt: new Date(Date.now() - 1000).toISOString() }))], { trustedKeys: [key] })
  assert.equal(ledger.approved.size, 0)
})
function ask(q: string) {
  const box = firstWeekMemory(); setStoreBackend(box)
  try { return answerLocally(assembleCoachBrief(null, q, null), undefined, [], undefined, emptyDialogue()) } finally { setStoreBackend(null) }
}
test('formal analysis uses only approved knowledge, in the 依据 section, and records versioned uses', async () => {
  const q = '我的400米分段均值和首尾差该怎么看？'
  installKnowledgeLedger(null)
  const before = ask(q)
  assert.equal(before.knowledgeUses, undefined); assert.doesNotMatch(before.text, /已审核的通用知识/)
  assert.equal(formalKnowledgeSection(q), null)
  const { key, sign } = await testReviewer()
  installKnowledgeLedger(await verifyKnowledgeApprovals([await sign(receipt())], { trustedKeys: [key] }))
  try {
    const after = ask(q)
    assert.deepEqual(after.knowledgeUses?.map(u => [u.cardId, u.version, u.contentSha256]), [['R03', R03.version, cardSha.R03]])
    const [visible, basis] = after.text.split('\n依据：')
    assert.doesNotMatch(visible, /已审核的通用知识/); assert.match(basis, /已审核的通用知识（不是你的个人证据，不授权剂量）：R03/)
    // emergency still wins, no knowledge appended
    assert.equal(ask('我现在胸痛快晕倒了，均值和首尾差怎么看').knowledgeUses, undefined)
    // preview remains preview, not formal
    assert.equal(ask('预览知识卡R03').knowledgeUses, undefined)
  } finally { installKnowledgeLedger(null) }
})
test('historical judgments that used knowledge are marked NEEDS_REVIEW when card hash/version or approval changes (C03 comparator)', async () => {
  const { key, sign } = await testReviewer()
  const ledger = await verifyKnowledgeApprovals([await sign(receipt())], { trustedKeys: [key] })
  const use = selectCompleteKnowledge({ task: 'knowledge', domains: ['RUNNING', 'MEASUREMENT'], mode: 'PRODUCTION', ledger, cardIds: ['R03'] }).uses[0]
  const ctx = { athleteId: 'local', asOf: Date.now(), ledger }
  assert.deepEqual(reviewKnowledgeJudgments([{ id: 'm1', knowledgeUses: [use] }, { id: 'm0' }], ctx), [{ messageId: 'm1', state: 'CURRENT', reasons: [] }])
  const changedCard = { ...use, contentSha256: 'f'.repeat(64) } // judgment saved against an older card text
  const r1 = reviewKnowledgeJudgments([{ id: 'm2', knowledgeUses: [changedCard] }], ctx)[0]
  assert.equal(r1.state, 'NEEDS_REVIEW'); assert.ok(r1.reasons.includes('RELATED_CONTENT_OR_COVERAGE_CHANGED'))
  const changedSource = { ...use, sourceRefs: use.sourceRefs.map(s => ({ ...s, contentSha256: '0'.repeat(64) })) }
  assert.equal(reviewKnowledgeJudgments([{ id: 'm3', knowledgeUses: [changedSource] }], ctx)[0].state, 'NEEDS_REVIEW')
  const revoked = await verifyKnowledgeApprovals([await sign(receipt()), await sign(receipt({ receiptId: 'rv', decision: 'REVOKED' }))], { trustedKeys: [key] })
  const r4 = reviewKnowledgeJudgments([{ id: 'm4', knowledgeUses: [use] }], { ...ctx, ledger: revoked })[0]
  assert.equal(r4.state, 'NEEDS_REVIEW'); assert.ok(r4.reasons.includes('APPROVAL_NO_LONGER_VALID:R03'))
})
test('local trusted-admin import stores raw receipts, re-verifies on load, and production load approves nothing', async () => {
  const box = firstWeekMemory(); setStoreBackend(box)
  try {
    const { key, sign } = await testReviewer('test-admin', 'TRUSTED_ADMIN')
    const good = await sign(receipt({ reviewer: { id: 'test-admin', role: 'TRUSTED_ADMIN' }, keyId: key.keyId }))
    const res = await importKnowledgeApprovalReceipts([good, { receiptId: 'junk', professional_review: 'APPROVED' }], { trustedKeys: [key] })
    assert.ok(res.ok && res.accepted === 1 && res.rejected.length === 1)
    assert.equal(JSON.parse(box.getItem(KNOWLEDGE_APPROVALS_KEY)!).length, 1)
    const again = await importKnowledgeApprovalReceipts([good], { trustedKeys: [key] }); assert.ok(again.ok && again.accepted === 0, 'idempotent import')
    assert.equal((await loadInstalledKnowledgeLedger({ trustedKeys: [key] })).approved.size, 1)
    assert.equal((await loadInstalledKnowledgeLedger()).approved.size, 0, 'production key list approves nothing')
  } finally { installKnowledgeLedger(null); setStoreBackend(null) }
})
