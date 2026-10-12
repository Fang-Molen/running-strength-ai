export type CoachNextSessionStatus =
  | "SELECT_TRAINING"
  | "RESOLVE_CONFLICT"
  | "ASK_FOR_RECOVERY"
  | "RECOVERY_ONLY"
  | "HOLD_OR_REDUCE"
  | "KEEP_ONLY"

export type CoachNextSessionView = {
  status: CoachNextSessionStatus
  increaseSupported: false
  allowed: ("ASK" | "RECOVERY" | "KEEP" | "REDUCE")[]
  blockers: string[]
  sourceIds: string[]
  requiredSourceIds: string[]
}

type NextInput = {
  occurrenceId: string | null
  sessionRpe: number | null
  sleepHours: number | null
  subjectiveRecovery?: number | null
  duplicateCount: number
  pain: boolean
  soreness?: boolean
  daysToCompetition: number | null
  week: 1 | 2 | 3 | 4 | null
  bias: "build" | "hold" | "deload" | null
  sources?: { id: string; kind: "FACT" | "DERIVED" | "CONTEXT"; detail: string }[]
}

function relevantSources(input: NextInput): string[] {
  return [...new Set((input.sources ?? []).filter((source) => source.kind === "FACT" && /^(?:SESSION_RPE|SUBJECTIVE_RECOVERY|SLEEP|PAIN|SORENESS)\b/.test(source.detail) || source.id === "context:competition" || source.id === "context:cycle").map((source) => source.id))]
}

export function projectCoachNextSession(input: NextInput): CoachNextSessionView {
  const boundPain = (input.sources ?? []).some((source) => source.kind === "FACT" && source.detail.startsWith("PAIN "))
  const nearRace = input.daysToCompetition != null && input.daysToCompetition >= 0 && input.daysToCompetition <= 28
  const deload = input.week === 4 || input.bias === "deload"
  const recoveryGap = input.sessionRpe == null || input.sessionRpe >= 7 && input.subjectiveRecovery == null && input.sleepHours == null
  const lowRecovery = input.subjectiveRecovery != null && input.subjectiveRecovery <= 4
  const shortSleep = input.sleepHours != null && input.sleepHours < 6
  const blockers: string[] = []
  if (!input.occurrenceId) blockers.push("NO_TRAINING_OCCURRENCE")
  if (input.duplicateCount > 0) blockers.push("DUPLICATE_UNRESOLVED")
  if (boundPain) blockers.push("PAIN_RECORDED")
  else if (input.pain) blockers.push("BOUND_PAIN_DETAIL_MISSING")
  if (input.sessionRpe == null) blockers.push("SESSION_RPE_MISSING")
  if (input.sessionRpe != null && input.sessionRpe >= 7 && input.subjectiveRecovery == null && input.sleepHours == null) blockers.push("RECOVERY_MISSING_AFTER_HIGH_RPE")
  if (lowRecovery) blockers.push("LOW_SUBJECTIVE_RECOVERY")
  if (shortSleep) blockers.push("SHORT_SLEEP")
  if (nearRace) blockers.push("COMPETITION_WITHIN_28_DAYS")
  if (deload) blockers.push("DELOAD_OR_WEEK_4")
  const status: CoachNextSessionStatus = !input.occurrenceId
    ? "SELECT_TRAINING"
    : input.duplicateCount > 0
      ? "RESOLVE_CONFLICT"
      : boundPain
        ? "RECOVERY_ONLY"
        : input.pain
          ? "ASK_FOR_RECOVERY"
        : recoveryGap
          ? "ASK_FOR_RECOVERY"
          : lowRecovery || shortSleep || (input.sessionRpe ?? 0) >= 8 || input.soreness || nearRace || deload
            ? "HOLD_OR_REDUCE"
            : "KEEP_ONLY"
  const allowed: CoachNextSessionView["allowed"] = status === "SELECT_TRAINING" || status === "RESOLVE_CONFLICT" || status === "ASK_FOR_RECOVERY"
    ? ["ASK"]
    : status === "RECOVERY_ONLY"
      ? ["RECOVERY", "REDUCE"]
      : status === "HOLD_OR_REDUCE"
        ? ["KEEP", "REDUCE", "RECOVERY"]
        : ["KEEP"]
  const sourceIds = relevantSources(input)
  const requiredPrefixes = new Set<string>()
  if (boundPain) requiredPrefixes.add("PAIN ")
  if (input.soreness) requiredPrefixes.add("SORENESS ")
  if (input.sessionRpe != null && input.sessionRpe >= 7) requiredPrefixes.add("SESSION_RPE ")
  if (lowRecovery) requiredPrefixes.add("SUBJECTIVE_RECOVERY ")
  if (shortSleep) requiredPrefixes.add("SLEEP ")
  const requiredSourceIds = (input.sources ?? []).filter((source) =>
    sourceIds.includes(source.id) && ([...requiredPrefixes].some((prefix) => source.detail.startsWith(prefix)) || nearRace && source.id === "context:competition" || deload && source.id === "context:cycle"),
  ).map((source) => source.id)
  return { status, increaseSupported: false, allowed, blockers, sourceIds, requiredSourceIds: [...new Set(requiredSourceIds)] }
}

// K13.2: a referral to a clinician/dietitian or a request to complete/correct the
// record is not next-session training advice. Only such clauses are removed; any
// clause that also mentions a training change still requires the sources.
function withoutReferralOrRecordCheck(text: string): string {
  return text.split(/(?<=[。；\n])/).filter((clause) => {
    const referral = /建议(?:你|您)?(?:尽快)?(?:寻求|咨询|进行|做|找|去|前往)?[^。；\n]{0,14}(?:医生|医学|医院|就医|营养师|康复|评估)/.test(clause)
    const recordCheck = /(?:核对|补全|补充|更正)[^。；\n]{0,10}(?:记录|饮食)/.test(clause)
    const training = /(?:下一课|下一次训练|下次训练|明天|减量|减少|恢复课|恢复训练|降低|少一组|保持原计划|加量|增加|提高|间歇|跑量|组数|强度)/.test(clause)
    return !((referral || recordCheck) && !training)
  }).join("")
}

export function nextSessionAdviceNeedsSource(view: CoachNextSessionView | undefined, rawText: string, citations: string[]): boolean {
  const text = withoutReferralOrRecordCheck(rawText)
  if (!view || view.requiredSourceIds.length === 0 || !/(?:下一课|下一次训练|建议|保持原计划|减量|减少|恢复课|恢复训练|降低|少一组|停止)/.test(text)) return false
  return view.requiredSourceIds.some((id) => !citations.includes(id))
}

export function assertCoachNextSession(view: CoachNextSessionView | undefined): void {
  if (!view || !["SELECT_TRAINING", "RESOLVE_CONFLICT", "ASK_FOR_RECOVERY", "RECOVERY_ONLY", "HOLD_OR_REDUCE", "KEEP_ONLY"].includes(view.status) ||
    view.increaseSupported !== false || !Array.isArray(view.allowed) || !Array.isArray(view.blockers) || !Array.isArray(view.sourceIds) || !Array.isArray(view.requiredSourceIds) ||
    view.allowed.length > 4 || view.blockers.length > 12 || view.sourceIds.length > 20 || view.requiredSourceIds.length > 20 || view.requiredSourceIds.some((id) => !view.sourceIds.includes(id))) throw new Error("bad next-session projection")
}
