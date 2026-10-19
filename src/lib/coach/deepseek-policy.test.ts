import assert from 'node:assert/strict'
import test from 'node:test'
import { checkDeepSeekRequestBudget, deepSeekCacheKey, estimateInputTokenUpperBound, selectDeepSeekRoute, type DeepSeekCacheScope, type DeepSeekRoute } from './deepseek-policy'

test('local calculation and existing offline topics have zero provider budget', () => {
  for (const question of ['只计算400米80秒的配速', '整课50分钟RPE7训练负荷是多少', '力量怎么复盘', '下一课怎么安排']) {
    const p = selectDeepSeekRoute(question)
    assert.equal(p.kind, 'LOCAL', question); assert.equal(p.inputTokenLimit, 0); assert.equal(p.outputTokenLimit, 0)
  }
})
test('explicit local capability and missing purpose cannot be overridden by a complex label', () => {
  assert.equal(selectDeepSeekRoute('请比较三次变化', { localIndependent: true, complexComparison: true }).kind, 'LOCAL')
  assert.equal(selectDeepSeekRoute('这节课训练什么', { missingCriticalPurpose: true }).kind, 'LOCAL')
  assert.equal(selectDeepSeekRoute('只计算400米配速', { needsComplexExplanation: true }).kind, 'LOCAL')
})
test('medical boundaries remain local, including a retained prior-turn safety flag', () => {
  assert.equal(selectDeepSeekRoute('跑步时胸痛快晕倒了，还能继续吗', { complexComparison: true }).kind, 'LOCAL')
  assert.equal(selectDeepSeekRoute('那我现在还能加速吗', { mustRetainSafety: true }).reason, 'RETAIN_LOCAL_SAFETY')
})
test('simple language and complex comparison routes keep fixed output, zero tools and zero retries', () => {
  const low = selectDeepSeekRoute('请帮我组织措辞')
  const high = selectDeepSeekRoute('跨周期综合比较三次表现')
  assert.equal(low.kind, 'LOW'); assert.equal(low.inputTokenLimit, 4000)
  assert.equal(high.kind, 'COMPLEX'); assert.equal(high.inputTokenLimit, 8000)
  assert.equal(selectDeepSeekRoute('请解释两种可能原因', { needsComplexExplanation: true }).kind, 'COMPLEX')
  for (const route of [low, high]) { assert.equal(route.outputTokenLimit, 900); assert.equal(route.retries, 0); assert.equal(route.toolRounds, 0) }
})
test('UTF8 measurement includes all messages and optional schema instead of character count', () => {
  const messages = [{ role: 'system', content: '安全边界' }, { role: 'user', content: '训练' }]
  assert.equal(estimateInputTokenUpperBound(messages), new TextEncoder().encode(JSON.stringify(messages)).length)
  assert.ok(estimateInputTokenUpperBound(messages) > JSON.stringify(messages).length)
  assert.ok(estimateInputTokenUpperBound(messages, { response_format: { schema: 'x'.repeat(9000) } }) > 9000)
})
test('unknown tokenizer/framing semantics block an otherwise small request', () => {
  const p = selectDeepSeekRoute('请帮我组织措辞')
  assert.equal(checkDeepSeekRequestBudget(p, [], { tokenAccountingVerified: false, framingTokenUpperBound: 0 }).allowed, false)
  assert.equal(checkDeepSeekRequestBudget(p, [], { tokenAccountingVerified: true, framingTokenUpperBound: NaN }).allowed, false)
})
test('oversized safety or facts are rejected without altering their original content', () => {
  const messages = [{ role: 'system', content: '安全'.repeat(1500) }]
  const before = structuredClone(messages)
  const answer = checkDeepSeekRequestBudget(selectDeepSeekRoute('请帮我组织措辞'), messages, { tokenAccountingVerified: true, framingTokenUpperBound: 16 })
  assert.equal(answer.reason, 'INPUT_BUDGET_EXCEEDED'); assert.deepEqual(messages, before)
})
test('schema and framing participate in the hard bound; inclusive boundary is accurate', () => {
  const p = selectDeepSeekRoute('请帮我组织措辞'), messages = [{ role: 'user', content: 'x' }]
  const bytes = estimateInputTokenUpperBound(messages)
  assert.equal(checkDeepSeekRequestBudget(p, messages, { tokenAccountingVerified: true, framingTokenUpperBound: 4000 - bytes }).allowed, true)
  assert.equal(checkDeepSeekRequestBudget(p, messages, { tokenAccountingVerified: true, framingTokenUpperBound: 4001 - bytes }).allowed, false)
  assert.equal(checkDeepSeekRequestBudget(p, messages, { tokenAccountingVerified: true, framingTokenUpperBound: 0, extraEnvelope: { schema: 'x'.repeat(5000) } }).allowed, false)
})
test('local or tampered route limits never authorize a provider request', () => {
  assert.equal(checkDeepSeekRequestBudget(selectDeepSeekRoute('只计算配速'), [], { tokenAccountingVerified: true, framingTokenUpperBound: 0 }).allowed, false)
  const p = selectDeepSeekRoute('请帮我组织措辞')
  for (const update of [{ inputTokenLimit: 12000 }, { outputTokenLimit: 3000 }, { retries: 1 }, { toolRounds: 1 }]) {
    assert.equal(checkDeepSeekRequestBudget({ ...p, ...update } as DeepSeekRoute, [], { tokenAccountingVerified: true, framingTokenUpperBound: 0 }).reason, 'INVALID_ROUTE_LIMITS')
  }
})
const scope: DeepSeekCacheScope = { subjectId: 'synthetic-user', athleteId: 'synthetic-athlete', snapshotId: 's1', snapshotVersion: 'r1', consentId: 'c1', consentVersion: 'r1', asOf: '2026-10-19T10:00:00Z', planVersion: 'p1', evidenceHash: 'e1', model: 'approved-model', modelVersion: 'v1', policyVersion: 'v1', route: 'COMPLEX', question: '比较两种解释' }
test('cache keys are stable, opaque and do not contain athlete identifiers or the question', async () => {
  const key = await deepSeekCacheKey(scope)
  assert.equal(key, await deepSeekCacheKey({ ...scope }))
  assert.match(key, /^fk-deepseek-v1:[0-9a-f]{64}$/)
  assert.equal(key.includes(scope.athleteId), false); assert.equal(key.includes(scope.question), false)
})
test('each ownership, consent, correction, plan, model, purpose or as-of change invalidates cache identity', async () => {
  const key = await deepSeekCacheKey(scope)
  for (const field of ['subjectId', 'athleteId', 'snapshotId', 'snapshotVersion', 'consentId', 'consentVersion', 'planVersion', 'evidenceHash', 'model', 'modelVersion', 'policyVersion', 'question'] as const) assert.notEqual(await deepSeekCacheKey({ ...scope, [field]: scope[field] + '-changed' }), key, field)
  assert.notEqual(await deepSeekCacheKey({ ...scope, asOf: '2026-10-19T11:00:00Z' }), key)
})
test('missing cache scope cannot collapse users into a global default cache', async () => {
  await assert.rejects(deepSeekCacheKey({ ...scope, subjectId: '' }))
  await assert.rejects(deepSeekCacheKey({ ...scope, asOf: 'invalid' }))
})
