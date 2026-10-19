import { describeC03Group, type C03MetricBrief, type C03Number } from './evidence.ts'

/** C03/R14 structural review. Host options/obligations are supplied by the
 * existing coach, never by a parsed model answer. It cannot approve doses. */
export type C03HostOption = Readonly<{
  id: string; kind: 'HOLD' | 'ASK_FOR_CONTEXT' | 'HOST_APPROVED_COURSE'; changes: readonly unknown[]
}>
export type C03NumberUse = Readonly<{ handle: string; value: number; unit: string; role: 'SUPPORT' | 'LIMITATION' }>
export type C03ArgumentDraft = Readonly<{
  version: 'FK-APP-C03-ARGUMENT-1'; revisionReceipt: string; selectedOptionId: string
  comparisons: readonly { optionId: string; numbers: readonly C03NumberUse[]; benefitToCheck: string; limitation: string }[]
  explanations: readonly { id: string; supportHandles: readonly string[]; counterHandles: readonly string[];
    missing: readonly string[]; observation: { metric: string; protocol: string; supportOutcome: string; refuteOutcome: string } }[]
}>
export type C03ArgumentReview = Readonly<{
  state: 'BLOCKED' | 'NEEDS_REVISION' | 'STRUCTURAL_REVIEW_ONLY'; reasons: readonly string[]
  checkedNumbers: readonly C03Number[]; candidateTable: readonly C03HostOption[]; selectedOptionId: string | null
  semanticCorrectnessEvaluated: false; trainingBenefitProven: false; professionalReviewRequired: true
  planMutationAuthorized: false; didWrite: false; didCallModel: false
}>
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const exact = (x: unknown, keys: string[]) => record(x) && Object.keys(x).sort().join('|') === [...keys].sort().join('|')
const text = (x: unknown): x is string => typeof x === 'string' && !!x.trim() && x.length <= 2000
const strings = (x: unknown): x is string[] => Array.isArray(x) && x.length <= 512 && x.every(text) && new Set(x).size === x.length

/** Host-selected arithmetic relevant to a segment review. This is not model
 * input, and callers may add obligations for a more specific question. */
export function requiredC03NumericHandles(brief: C03MetricBrief): string[] {
  const primary = brief.groups.filter(g => g.role !== 'WARMUP')
  return [...new Set([...brief.numbers.filter(n => n.kind === 'SOURCE').map(n => n.handle),
    ...primary.flatMap(g => [...g.orderedEvidenceIds, `${g.id}:MEAN`,
      ...(g.lastMinusFirstSeconds === null ? [] : [`${g.id}:LAST_FIRST`])])])]
}

export function reviewC03Argument(brief: C03MetricBrief, raw: unknown,
  host: { task: 'FACT' | 'EXPLAIN' | 'COMPARE'; options: readonly C03HostOption[];
    requiredNumericHandles: readonly string[] }): C03ArgumentReview {
  const boundary = { semanticCorrectnessEvaluated: false, trainingBenefitProven: false,
    professionalReviewRequired: true, planMutationAuthorized: false, didWrite: false, didCallModel: false } as const
  const output = (state: C03ArgumentReview['state'], reasons: string[], checkedNumbers: C03Number[] = [],
    selectedOptionId: string | null = null): C03ArgumentReview => ({ ...boundary, state, reasons, checkedNumbers,
    selectedOptionId, candidateTable: state === 'BLOCKED' ? [] : structuredClone(host.options) })
  if (brief.state === 'BLOCKED') return output('BLOCKED', ['FORMAL_EVIDENCE_BLOCKED'])
  const options = host.options
  if (!['FACT', 'EXPLAIN', 'COMPARE'].includes(host.task) || !Array.isArray(options) || !options.length || options.length > 12 ||
    new Set(options.map(o => o.id)).size !== options.length || options.some(o => !text(o.id) ||
      !['HOLD', 'ASK_FOR_CONTEXT', 'HOST_APPROVED_COURSE'].includes(o.kind) || !Array.isArray(o.changes) ||
      (o.kind !== 'HOST_APPROVED_COURSE' && o.changes.length))) return output('BLOCKED', ['INVALID_HOST_OPTIONS'])
  const numbers = new Map(brief.numbers.map(n => [n.handle, n]))
  const required = requiredC03NumericHandles(brief)
  if (!strings(host.requiredNumericHandles) || host.requiredNumericHandles.some(h => !numbers.has(h)) ||
    required.some(h => !host.requiredNumericHandles.includes(h))) return output('BLOCKED', ['HOST_KEY_NUMBER_OBLIGATION_MISSING'])
  if (!exact(raw, ['version', 'revisionReceipt', 'selectedOptionId', 'comparisons', 'explanations']))
    return output('BLOCKED', ['ARGUMENT_SCHEMA'])
  const d = raw as Record<string, unknown>
  if (d.version !== 'FK-APP-C03-ARGUMENT-1' || d.revisionReceipt !== brief.revisionReceipt ||
    !text(d.selectedOptionId) || !options.some(o => o.id === d.selectedOptionId) || !Array.isArray(d.comparisons) ||
    d.comparisons.length !== options.length || !Array.isArray(d.explanations) || d.explanations.length > 2)
    return output('BLOCKED', ['ARGUMENT_SCOPE_OR_COVERAGE'])
  const seenOptions = new Set<string>(), checked: C03Number[] = [], selectedUses = new Set<string>()
  for (const item of d.comparisons) {
    if (!exact(item, ['optionId', 'numbers', 'benefitToCheck', 'limitation']) || !text(item.optionId) ||
      !options.some(o => o.id === item.optionId) || seenOptions.has(item.optionId) ||
      !text(item.benefitToCheck) || !text(item.limitation) || !Array.isArray(item.numbers) || item.numbers.length > 512)
      return output('BLOCKED', ['MISSING_DUPLICATE_OR_FOREIGN_OPTION'])
    seenOptions.add(item.optionId)
    const seen = new Set<string>()
    for (const n of item.numbers) {
      if (!exact(n, ['handle', 'value', 'unit', 'role']) || !text(n.handle) ||
        !['SUPPORT', 'LIMITATION'].includes(n.role as string)) return output('BLOCKED', ['NUMBER_USE_SCHEMA'])
      const fact = numbers.get(n.handle)
      if (!fact || fact.value !== n.value || fact.unit !== n.unit || seen.has(`${n.handle}|${n.role}`))
        return output('BLOCKED', ['INVENTED_STALE_OR_DUPLICATE_NUMBER'])
      seen.add(`${n.handle}|${n.role}`); checked.push(fact)
      if (item.optionId === d.selectedOptionId) selectedUses.add(n.handle)
    }
  }
  const reasons: string[] = []
  for (const id of host.requiredNumericHandles) if (!selectedUses.has(id)) reasons.push(`KEY_NUMBER_NOT_APPLIED:${id}`)
  const seenHypotheses = new Set<string>(), observations = new Set<string>()
  for (const h of d.explanations) {
    if (!exact(h, ['id', 'supportHandles', 'counterHandles', 'missing', 'observation']) || !text(h.id) || seenHypotheses.has(h.id) ||
      !strings(h.supportHandles) || !strings(h.counterHandles) || !strings(h.missing) ||
      [...h.supportHandles, ...h.counterHandles].some(id => !numbers.has(id)) ||
      h.supportHandles.some((id: string) => h.counterHandles.includes(id))) return output('BLOCKED', ['EXPLANATION_EVIDENCE_SHAPE'])
    seenHypotheses.add(h.id)
    if (!h.supportHandles.length || !h.counterHandles.length && !h.missing.length) reasons.push('MISSING_SUPPORT_OR_COUNTER_CONDITION')
    if (h.supportHandles.some((id: string) => !selectedUses.has(id))) reasons.push('EXPLANATION_NUMBER_NOT_APPLIED')
    const o = h.observation
    if (!exact(o, ['metric', 'protocol', 'supportOutcome', 'refuteOutcome']) ||
      ![o.metric, o.protocol, o.supportOutcome, o.refuteOutcome].every(text) ||
      o.supportOutcome.trim() === o.refuteOutcome.trim()) reasons.push('MISSING_DISCRIMINATING_OBSERVATION')
    else observations.add(JSON.stringify([o.metric.trim(), o.protocol.trim(), o.supportOutcome.trim(), o.refuteOutcome.trim()]))
  }
  if (host.task !== 'FACT' && d.explanations.length < 2) reasons.push('TWO_LIMITED_EXPLANATIONS_REQUIRED_OR_EXPLAIN_INSUFFICIENCY')
  if (d.explanations.length === 2 && observations.size < 2) reasons.push('NON_DISTINGUISHING_OBSERVATIONS')
  return output(reasons.length ? 'NEEDS_REVISION' : 'STRUCTURAL_REVIEW_ONLY',
    reasons.length ? reasons : ['NUMERICAL_STRUCTURE_ONLY_PROFESSIONAL_SEMANTICS_NOT_VERIFIED'], checked, d.selectedOptionId)
}

/** Safe deterministic fallback. It proposes observations inside an already
 * approved course; it does not create a workout or claim a physiological cause. */
export function buildC03ObservationReview(brief: C03MetricBrief, purpose: string | null = null) {
  const selected = brief.groups.filter(g => g.role !== 'WARMUP')
  const facts = brief.groups.map(describeC03Group)
  const hasChange = selected.some(g => g.lastMinusFirstSeconds !== null && g.lastMinusFirstSeconds !== 0)
  const hasVariation = selected.some(g => g.durationsSeconds.some(t => t !== g.durationsSeconds[0]))
  const hasRepeatedSegments = selected.some(g => g.observedCount >= 2)
  const basis = selected.flatMap(g => g.basisIds)
  const explanations = brief.state === 'BLOCKED' || !basis.length ? [] : [
    { id: 'PACING_PROTOCOL', explanation: hasChange ? '起跑节奏、实际恢复或测量条件可能参与所见段间变化，原因尚未确定。' :
      hasVariation ? '已记录段存在差异，首末相同也不能代表中间各段稳定；起跑节奏、恢复或测量条件仍需核对。' :
      hasRepeatedSegments ? '已记录段用时相同可能符合任务要求；仍需原目标和恢复条件，不能直接推成能力达标。' :
      '单个已记录段只能描述当前结果；节奏与任务是否匹配尚待原目标和恢复条件核对，不能比较未记录段。',
      support: selected.map(describeC03Group),
      against: ['若原目标要求不同节奏，或核对后距离、计时及休息条件不同，便削弱这项解释；缺记录不算反证。'],
      missing: ['原计划逐段目标、起跑节奏及实际恢复的对应关系'], basisIds: basis,
      observation: { metric: '逐段用时及对应实际恢复', protocol: '仅在已有批准的同目的课程中记录，保留轮次与计时方式',
        supportOutcome: '在可比条件下，节奏或恢复差异与段间变化共同重复出现，仅支持待验证解释',
        refuteOutcome: '节奏及实际恢复可比而变化不再重复，削弱当前解释' } },
    { id: 'SESSION_CONTEXT', explanation: '当天主观感受、近期训练背景或环境也可能影响表现；本次记录没有证明其因果作用。',
      support: ['同一批已记录用时可用于提出背景核对问题，不能单独证明疲劳或生理短板。'],
      against: ['若不同背景下同协议表现并未同步变化，或差异可由计时与任务解释，则削弱背景因素解释。'],
      missing: ['同日睡眠、整课RPE、环境和次日恢复的可比记录'], basisIds: basis,
      observation: { metric: '整课主观强度、同日背景与次日恢复', protocol: '跟踪原有批准课程，不新增测试剂量，疼痛或异常按原安全通道处理',
        supportOutcome: '相同协议的多个观察中，背景与主观强度及恢复同步变化，仅支持继续观察',
        refuteOutcome: '背景改变而同协议强度和恢复不随之变化，削弱该解释' } },
  ]
  return { facts, purpose: purpose?.trim() || 'UNKNOWN', explanations, missing: [...brief.missing,
    ...(!purpose?.trim() ? ['训练目的 UNKNOWN；优先核对原计划或教练意图'] : [])],
    nextObservation: brief.state === 'BLOCKED' ? '现有安全或证据限制未解除，先按原安全门控处理，不安排探索性训练或自动改课。' :
      explanations.length ? '在下一次已批准的同目的课程中记录每轮逐段用时、实际组间/轮间恢复、整课RPE和次日恢复；先核对计时与环境，不额外编造组数、配速或全力测试。' :
      '先核对所选实际课次及原计划目的；缺数据不填零，保留有效事实。',
    semanticCorrectnessEvaluated: false as const, planMutationAuthorized: false as const, didWrite: false as const }
}
