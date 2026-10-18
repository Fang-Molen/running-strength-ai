import { register } from 'node:module'
import { appendFileSync } from 'node:fs'
register('../scripts/test-loader.mjs', import.meta.url)
const { detectRedFlags } = await import('../src/lib/core/coach-red-flags.ts')
const { diagnosisWordingIssues } = await import('../src/lib/core/coach-diagnosis-wording.ts')
const { calculateSessionLoad, formatSessionLoad } = await import('../src/lib/core/coach-session-load.ts')
const { redactCoachIdentifiers } = await import('../src/lib/core/coach-output-contract.ts')
const { deriveCoachBrief } = await import('../src/lib/core/coach-brief.ts')
const { normalizeAskCoachInput, interpretCoachModelOutput, coachLocalSafetyTurn } = await import('../src/lib/strength/coach-pipeline.ts')

/** Real application functions only. Expected values/rubrics never enter this provider. */
export default class FangkunLocalProvider {
  id() { return 'fangkun-local-deterministic' }
  async callApi(prompt, context) {
    const { input, kind = 'safety', candidate = '休息后继续下一组，明天轻松跑，RPE多少？' } = context.vars
    const flags = detectRedFlags(input)
    const brief = deriveCoachBrief({
      question: input, occurrenceId: null, runningStructure: 'UNAVAILABLE', sessionRpe: null,
      sleepHours: null, subjectiveRecovery: null, recoveryState: null, fatigueState: null,
      duplicateCount: 0, repetitionSlots: 0, continuousCount: 0, plannedSetCount: null,
      completedSetCount: null, durationSec: null, pain: false, soreness: false,
      musculoskeletalState: null, daysToCompetition: null, week: null, bias: null,
      sourceIds: [], sources: [], running: [], runningTruncated: false, fuel: null,
    })
    const data = normalizeAskCoachInput({ brief })
    const preflight = coachLocalSafetyTurn(data)
    const guarded = interpretCoachModelOutput(data, JSON.stringify({ mode: 'answer', text: candidate, citations: [], nextStep: '下一课再跑' }))
    const load = kind === 'load' ? calculateSessionLoad(input) : null
    const text = kind === 'load' ? formatSessionLoad(load) : kind === 'privacy' ? redactCoachIdentifiers(input) : guarded.turn.text
    const result = { text, level: flags.level, classes: flags.classes, subject: flags.subject,
      temporal: flags.temporal, nextStep: guarded.turn.nextStep, preflight: Boolean(preflight),
      diagnosisIssues: kind === 'privacy' ? [] : diagnosisWordingIssues(text), load, modelCalls: 0 }
    if (process.env.FANGKUN_EVAL_CALL_LOG) appendFileSync(process.env.FANGKUN_EVAL_CALL_LOG,
      JSON.stringify({ id: context.vars.id, suite: context.vars.suite, modelCalls: 0 }) + '\n')
    return { output: JSON.stringify(result), tokenUsage: { total: 0, prompt: 0, completion: 0 }, cost: 0 }
  }
}
