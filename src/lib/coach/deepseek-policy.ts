import { offlineCapability } from '../core/coach-offline'
import { detectRedFlags } from '../core/coach-red-flags'

export type DeepSeekRouteKind = 'LOCAL' | 'LOW' | 'COMPLEX'
export type DeepSeekRoute = {
  kind: DeepSeekRouteKind
  inputTokenLimit: 0 | 4000 | 8000
  outputTokenLimit: 0 | 900
  toolRounds: 0
  retries: 0
  reason: string
}
export type DeepSeekRouteContext = {
  localIndependent?: boolean
  mustRetainSafety?: boolean
  complexComparison?: boolean
  hasComparableHistory?: boolean
  needsComplexExplanation?: boolean
  missingCriticalPurpose?: boolean
}

/** Select a budget, never grant permission to send data or spend money. */
export function selectDeepSeekRoute(question: string, context: DeepSeekRouteContext = {}): DeepSeekRoute {
  const local = (reason: string): DeepSeekRoute => ({ kind: 'LOCAL', inputTokenLimit: 0, outputTokenLimit: 0, toolRounds: 0, retries: 0, reason })
  if (typeof question !== 'string' || !question.trim()) return local('EMPTY_QUESTION')
  if (context.mustRetainSafety || detectRedFlags(question).level !== 'NONE') return local('RETAIN_LOCAL_SAFETY')
  if (context.missingCriticalPurpose) return local('ASK_FOR_MISSING_PURPOSE_LOCALLY')
  if (context.localIndependent || /只计算|仅计算|只看记录|仅看记录|仅核对数值/.test(question)) return local('DETERMINISTIC_LOCAL_TASK')
  const capability = offlineCapability(question)
  if (capability.independent) return local('EXISTING_LOCAL_CAPABILITY')
  const complex = capability.complex || context.complexComparison || context.needsComplexExplanation || context.hasComparableHistory && /比较|对比|趋势|变化/.test(question)
  return { kind: complex ? 'COMPLEX' : 'LOW', inputTokenLimit: complex ? 8000 : 4000, outputTokenLimit: 900, toolRounds: 0, retries: 0, reason: complex ? 'BOUNDED_COMPLEX_EXPLANATION' : 'BOUNDED_LANGUAGE_TASK' }
}

/**
 * Serialized UTF-8 bytes, not an exact provider token count. A host may use this
 * as a conservative bound only after verifying byte-token/framing semantics for
 * its selected model. Include schema/envelope and separately verified framing.
 */
export function estimateInputTokenUpperBound(messages: readonly { role: string; content: string }[], extraEnvelope?: unknown): number {
  if (!Array.isArray(messages) || messages.some(m => !m || typeof m.role !== 'string' || typeof m.content !== 'string')) throw new Error('INVALID_MESSAGES')
  const value = extraEnvelope === undefined ? messages : { messages, envelope: extraEnvelope }
  return new TextEncoder().encode(JSON.stringify(value)).length
}

/** Do not silently trim facts or safety instructions in order to fit a budget. */
export function checkDeepSeekRequestBudget(route: DeepSeekRoute, messages: readonly { role: string; content: string }[], options: {
  tokenAccountingVerified: boolean
  framingTokenUpperBound: number
  extraEnvelope?: unknown
}): { allowed: boolean; reason: string; inputUpperBound: number | null } {
  if (route.kind === 'LOCAL') return { allowed: false, reason: 'LOCAL_ROUTE_NO_PROVIDER', inputUpperBound: null }
  const expectedInput = route.kind === 'LOW' ? 4000 : route.kind === 'COMPLEX' ? 8000 : null
  if (expectedInput == null || route.inputTokenLimit !== expectedInput || route.outputTokenLimit !== 900 || route.toolRounds !== 0 || route.retries !== 0) return { allowed: false, reason: 'INVALID_ROUTE_LIMITS', inputUpperBound: null }
  if (!options.tokenAccountingVerified || !Number.isSafeInteger(options.framingTokenUpperBound) || options.framingTokenUpperBound < 0) return { allowed: false, reason: 'TOKEN_ACCOUNTING_UNVERIFIED', inputUpperBound: null }
  let measured: number
  try { measured = estimateInputTokenUpperBound(messages, options.extraEnvelope) + options.framingTokenUpperBound } catch { return { allowed: false, reason: 'INVALID_MESSAGES', inputUpperBound: null } }
  if (!Number.isSafeInteger(measured)) return { allowed: false, reason: 'INVALID_INPUT_BOUND', inputUpperBound: null }
  return { allowed: measured <= route.inputTokenLimit, reason: measured <= route.inputTokenLimit ? 'WITHIN_APPROVED_TOKEN_ENVELOPE' : 'INPUT_BUDGET_EXCEEDED', inputUpperBound: measured }
}

export type DeepSeekCacheScope = {
  subjectId: string
  athleteId: string
  snapshotId: string
  snapshotVersion: string
  consentId: string
  consentVersion: string
  asOf: string
  planVersion: string
  evidenceHash: string
  model: string
  modelVersion: string
  policyVersion: string
  route: DeepSeekRouteKind
  question: string
}

/** Cache identity never substitutes for a fresh authorization or source check. */
export async function deepSeekCacheKey(scope: DeepSeekCacheScope): Promise<string> {
  const keys: (keyof DeepSeekCacheScope)[] = ['subjectId', 'athleteId', 'snapshotId', 'snapshotVersion', 'consentId', 'consentVersion', 'asOf', 'planVersion', 'evidenceHash', 'model', 'modelVersion', 'policyVersion', 'route', 'question']
  if (keys.some(key => typeof scope[key] !== 'string' || !scope[key].trim()) || !Number.isFinite(Date.parse(scope.asOf))) throw new Error('INVALID_CACHE_SCOPE')
  const bytes = new TextEncoder().encode(JSON.stringify(keys.map(key => [key, scope[key]])))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return 'fk-deepseek-v1:' + [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}
