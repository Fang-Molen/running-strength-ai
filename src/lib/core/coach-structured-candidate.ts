import type { ReasoningFrame } from './coach-reasoning.ts'

export type StructuredCoachingCandidate = {
  decision: 'HOLD' | 'CONDITIONAL_REPEAT' | 'CONDITIONAL_ADJUST'
  changed_variable: string | null
  from: number | string | null
  to: number | string | null
  unchanged: string[]
  stop_conditions: string[]
  preconditions: string[]
  rule_ids: string[]
}

/** Only an explicit positive goal statement; a question, negation or hypothetical is unresolved. */
export function hasExplicitUniformPacingGoal(question: string): boolean {
  return question.split(/[。；\n]/).some(clause =>
    /(?:本次|这次|原)?计划(?:是|为|要|按)?(?:均速|均匀配速)/.test(clause) &&
    !/不是|并非|不打算|取消|没有|如果|假设|是否|是不是|吗|若/.test(clause))
}

/** Pure projection: read confirmed source facts; never save or authorize a plan change. */
export function structuredCoachingCandidate(frame: ReasoningFrame): StructuredCoachingCandidate | null {
  if (frame.safety.mustRetain) return null
  const common = {
    unchanged: ['工作段组数与实际距离', '原目标配速、其他动作剂量和其余训练段'],
    stop_conditions: ['疼痛加重、动作变形或日常功能异常', '热身反应异常、睡眠或恢复明显变差', '次日反馈变差或逐段表现没有改善时撤回候选并复查'],
    preconditions: ['当前无不适、日常功能及睡眠精神如常，热身反应正常', '原课程已获批准，目标与记录方法可比，当前周期允许', '逐段记录用时、整课RPE和次日恢复以便复查', '用户确认后才考虑候选，不自动写入训练'],
    rule_ids: ['PB-INTERVAL', 'PB-RPE', 'FK-SINGLE-VARIABLE', 'FK-NO-AUTO-WRITE'],
  }
  const hold = (): StructuredCoachingCandidate => ({ decision: 'HOLD', changed_variable: null, from: null, to: null, ...common })
  const group = frame.computed.groups.find(g => g.count >= 2)
  const rests = group ? frame.computed.rests.filter(r => r.workSourceId && group.sourceIds.includes(r.workSourceId)) : []
  const points = group ? frame.computed.points.filter(p => group.sourceIds.includes(p.sourceId)) : []
  const restricted = frame.nextSession && (frame.nextSession.status !== 'KEEP_ONLY' || frame.nextSession.blockers.length > 0)
  if (frame.stage !== 'EXPLAIN_EVIDENCE' || !frame.basis.complete || frame.scopeOccurrenceIds.length !== 1 || frame.conflicts.length || restricted || !group ||
      points.length !== group.count || points.some(p => p.confirmation !== 'CONFIRMED') ||
      rests.length !== group.count - 1 || new Set(rests.map(r => r.workSourceId)).size !== group.count - 1 ||
      !group.sourceIds.slice(0, -1).every(id => rests.some(r => r.workSourceId === id)) ||
      rests.some(r => !Number.isFinite(r.seconds) || r.seconds <= 0 || !frame.observedSourceIds.includes(r.sourceId)) ||
      new Set(rests.map(r => r.seconds)).size !== 1 ||
      frame.unknowns.some(s => /整课主观强度|整课RPE|症状反馈|来源未经|自报来源/.test(s))) return hold()

  const from = Number(rests[0].seconds.toFixed(2))
  // The old observational comparison remains a repeat. It does not grant progression.
  if (group.trend !== 'SLOWER')
    return { decision: 'CONDITIONAL_REPEAT', changed_variable: 'recovery_seconds', from, to: from, ...common }

  // Slowing, RPE and sleep do not authorize the former empirical +30 s prescription.
  // Approved course snapshots are selected by the existing development projection instead.
  return {...hold(),rule_ids:[...common.rule_ids,'FK-APPROVED-COURSE-REQUIRED']}
}
