export type CoachReturnState =
  | "SELECT_TRAINING"
  | "RESOLVE_CONFLICT"
  | "PAIN_RECORDED"
  | "SORENESS_RECORDED"
  | "RECOVERY_EVIDENCE_GAP"
  | "CHECK_CURRENT_STATUS"

export type CoachReturnView = {
  state: CoachReturnState
  clearance: "UNKNOWN"
  normalTrainingCleared: false
  sourceIds: string[]
  missing: string[]
  allowedSteps: ("CONFIRM_CURRENT_SYMPTOMS" | "STOP_PROVOKING_MOVEMENT" | "KEEP_OR_REDUCE_ONLY" | "CONSIDER_PROFESSIONAL_EVALUATION")[]
}

type ReturnInput = {
  occurrenceId: string | null
  sessionRpe: number | null
  sleepHours: number | null
  subjectiveRecovery?: number | null
  recoveryState: string | null
  duplicateCount: number
  pain: boolean
  soreness?: boolean
  musculoskeletalState?: string | null
  sources?: { id: string; kind: "FACT" | "DERIVED" | "CONTEXT"; detail: string }[]
}

function factIds(input: ReturnInput, prefix: string): string[] {
  return (input.sources ?? []).filter((source) => source.kind === "FACT" && source.detail.startsWith(`${prefix} `)).map((source) => source.id)
}

export function projectCoachReturn(input: ReturnInput): CoachReturnView {
  const painIds = factIds(input, "PAIN")
  const sorenessIds = factIds(input, "SORENESS")
  const recoveryIds = factIds(input, "SUBJECTIVE_RECOVERY")
  const sleepIds = factIds(input, "SLEEP")
  const rpeIds = factIds(input, "SESSION_RPE")
  const conflict = input.duplicateCount > 0 || input.musculoskeletalState === "CONFLICTING_EVIDENCE" || input.recoveryState === "CONFLICTING_EVIDENCE"
  const recoveryGap = input.sessionRpe == null || input.sessionRpe >= 7 && input.subjectiveRecovery == null && input.sleepHours == null
  const state: CoachReturnState = !input.occurrenceId
    ? "SELECT_TRAINING"
    : conflict
      ? "RESOLVE_CONFLICT"
      : painIds.length > 0
        ? "PAIN_RECORDED"
        : sorenessIds.length > 0
          ? "SORENESS_RECORDED"
          : recoveryGap || input.pain
            ? "RECOVERY_EVIDENCE_GAP"
            : "CHECK_CURRENT_STATUS"
  const missing: string[] = []
  if (!input.occurrenceId) missing.push("TRAINING_OCCURRENCE")
  if (conflict) missing.push("CONFLICT_RESOLUTION")
  if (input.sessionRpe == null) missing.push("SESSION_RPE")
  if (input.sessionRpe != null && input.sessionRpe >= 7 && input.subjectiveRecovery == null && input.sleepHours == null) missing.push("RECOVERY_OR_SLEEP")
  if (input.pain && painIds.length === 0) missing.push("BOUND_PAIN_DETAIL")
  const allowedSteps: CoachReturnView["allowedSteps"] = ["CONFIRM_CURRENT_SYMPTOMS", "KEEP_OR_REDUCE_ONLY"]
  if (painIds.length > 0) allowedSteps.push("STOP_PROVOKING_MOVEMENT", "CONSIDER_PROFESSIONAL_EVALUATION")
  return {
    state,
    clearance: "UNKNOWN",
    normalTrainingCleared: false,
    sourceIds: [...new Set([...painIds, ...sorenessIds, ...rpeIds, ...recoveryIds, ...sleepIds])],
    missing,
    allowedSteps,
  }
}

export function assertCoachReturn(view: CoachReturnView | undefined): void {
  if (!view || !["SELECT_TRAINING", "RESOLVE_CONFLICT", "PAIN_RECORDED", "SORENESS_RECORDED", "RECOVERY_EVIDENCE_GAP", "CHECK_CURRENT_STATUS"].includes(view.state) ||
    view.clearance !== "UNKNOWN" || view.normalTrainingCleared !== false || !Array.isArray(view.sourceIds) || !Array.isArray(view.missing) || !Array.isArray(view.allowedSteps) ||
    view.sourceIds.length > 20 || view.missing.length > 10 || view.allowedSteps.length > 8) throw new Error("bad return projection")
}
