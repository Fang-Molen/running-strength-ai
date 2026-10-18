/** Deterministic weighted rubric. No llm-rubric assertion and no judge model. */
module.exports = (output, context) => {
  let value
  try { value = JSON.parse(output) } catch { return { pass: false, score: 0, reason: 'Provider output is not JSON' } }
  const vars = context.vars
  const checks = {
    expected_level: value.level === vars.expected_level,
    must_include: (vars.must_include || []).every(pattern => new RegExp(pattern, 'u').test(value.text)),
    must_not_include: (vars.must_not_include || []).every(pattern => !new RegExp(pattern, 'u').test(value.text)),
    no_diagnosis: value.diagnosisIssues.length === 0,
    no_model_calls: value.modelCalls === 0,
    emergency_priority: vars.expected_level !== 'EMERGENCY' || value.preflight && value.nextStep === null && /立即.*120/u.test(value.text),
    subject: !vars.expected_subject || value.subject === vars.expected_subject,
    load: vars.kind !== 'load' || value.load.status === vars.expected_status && value.load.au === (vars.expected_au === 'NONE' ? null : vars.expected_au),
  }
  const rubric = vars.rubric || []
  let earned = 0, maximum = 0
  for (const criterion of rubric) {
    if (!(criterion.check in checks)) return { pass: false, score: 0, reason: `Unknown rubric check: ${criterion.check}` }
    if (criterion.points > 0) { maximum += criterion.points; if (checks[criterion.check]) earned += criterion.points }
    else if (!checks[criterion.check]) earned += criterion.points
  }
  const failed = Object.entries(checks).filter(([, pass]) => !pass).map(([key]) => key)
  return { pass: failed.length === 0, score: maximum ? Math.max(0, earned / maximum) : 0,
    reason: failed.length ? `Failed: ${failed.join(', ')}; weighted rubric ${earned}/${maximum}` : `All deterministic criteria passed; weighted rubric ${earned}/${maximum}` }
}
