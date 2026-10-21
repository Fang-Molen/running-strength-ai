/** V92: read-only multi-provider projection for server-verified COROS batches.
 * Does not authenticate accounts, persist data, grant training clearance, or mutate plans.
 * Never pass untrusted browser JSON as VerifiedBatch; ownership is checked server-side.
 */
import { buildIntradayRecovery, recoveryCoachFacts, type Input } from './intraday-recovery-u10'
import { intradayInput } from './intraday-recovery-bridge-v89'
import type { IntradayDay } from './garmin-intraday'
import { adaptVerifiedCoros, mergeCorosRecovery, type VerifiedBatch } from './coros-evidence-v92'
import { corosRecoveryAvailability } from './coros-capabilities-v92'
import { corosDailyRecoveryTrend, corosRecoveryInterpretation } from './coros-recovery-trend-v93'

export type TrustedRecoveryRequest = {
  athleteId: string
  day: string
  now: string
  utcOffsetMinutes: number
  garminDays: Record<string, IntradayDay>
  /** Optional trusted COROS batch, never a client-side verifiedOwner flag. */
  corosBatch?: VerifiedBatch | null
  preferredSources?: Input['preferredSources']
  minReferenceDays?: number
}

/** One U10 calculation path for Garmin-only, COROS-only and mixed sources. */
export function projectVerifiedMultiDeviceRecovery(request: TrustedRecoveryRequest) {
  const base = intradayInput(request.garminDays, request.athleteId, request.day, request.now,
    request.minReferenceDays ?? 7)
  // Explicitly use the user's selected calendar offset even if no Garmin data is present.
  const withContext: Input = { ...base, utcOffsetMinutes: request.utcOffsetMinutes,
    preferredSources: request.preferredSources }
  const coros = request.corosBatch
    ? adaptVerifiedCoros(request.corosBatch, request.athleteId, request.now)
    : null
  const merged = coros ? mergeCorosRecovery(withContext, coros) : withContext
  const view = buildIntradayRecovery(merged)
  return {
    view,
    coachFacts: recoveryCoachFacts(view),
    corosAvailability: coros ? corosRecoveryAvailability(coros) : null,
    dailyFacts: coros?.dailyFacts ?? [],
    // v89.9.4（参考补丁合入，休眠）：高驰日级趋势，只来自已核实批次；不生成佳明身体电量。
    corosDailyTrend: coros ? corosDailyRecoveryTrend(coros.dailyFacts, request.utcOffsetMinutes) : [],
    corosRecoveryAssessment: coros ? corosRecoveryInterpretation(corosDailyRecoveryTrend(coros.dailyFacts, request.utcOffsetMinutes)) : null,
    warnings: [...view.warnings, ...(coros?.warnings ?? [])],
    // Do not persist unverified records or use this output to modify a plan.
    canAutoChangePlan: false as const,
    medicalClearance: false as const,
  }
}
