/** Engineering denominator audit only. No answer keys, expert scores or provider calls. */
export type EvaluationAttempt = { caseId: string; arm: 'A' | 'B'; inputDigest: string; configDigest: string;
  status: 'ANSWERED' | 'REFUSED' | 'TIMEOUT' | 'ERROR' | 'UNKNOWN'; outputId: string | null }
export function auditEvaluationLedger(cases: readonly { id: string; inputDigest: string }[], attempts: readonly EvaluationAttempt[], configDigest: string) {
  if (!configDigest || !cases.length || cases.some(c => !c.id || !c.inputDigest) || new Set(cases.map(c => c.id)).size !== cases.length) throw Error('INVALID_FROZEN_REGISTRY')
  const issues = attempts.filter(a => !cases.some(c => c.id === a.caseId)).map(a => `UNREGISTERED:${a.caseId}`)
  const slots = cases.flatMap(c => (['A', 'B'] as const).map(arm => {
    const found = attempts.filter(a => a.caseId === c.id && a.arm === arm)
    const a = found[0]
    const status = !found.length ? 'NOT_RUN' : found.length !== 1 ? 'DUPLICATE' : a.inputDigest !== c.inputDigest || a.configDigest !== configDigest ? 'MISMATCH' :
      !['ANSWERED', 'REFUSED', 'TIMEOUT', 'ERROR', 'UNKNOWN'].includes(a.status) || a.status === 'ANSWERED' && !a.outputId ? 'INVALID' : a.status
    return { caseId: c.id, arm, status }
  }))
  return { denominator: cases.length * 2, slots, issues, answered: slots.filter(s => s.status === 'ANSWERED').length,
    pairedAnswers: cases.filter(c => slots.filter(s => s.caseId === c.id && s.status === 'ANSWERED').length === 2).length,
    failedOrUnexecuted: slots.filter(s => s.status !== 'ANSWERED').length, qualityScore: null, expertGraded: false, didCallModel: false }
}
