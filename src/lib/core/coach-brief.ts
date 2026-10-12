import { evidenceAvailability } from "./evidence-availability.ts"
import { projectOccurrenceEvidence, type EvidenceGroup, type EvidenceRecord } from "./evidence.ts"
import { loadEvents } from "./events.ts"
import { dispatchEvent } from "./events.ts"
import { listTrainingOccurrences } from "./occurrence.ts"
import { occurrenceVoided } from "./training-correction.ts"
import { projectRunningExecution } from "./running-execution.ts"
import { readTrainingFact } from "./fact-read.ts"
import { readTrainingContext } from "./training-decision.ts"
import type { Plan } from "@/lib/strength/model"
import { computePlan, todayEatTarget } from "@/lib/nutrition/calc"
import { loadDay } from "@/lib/nutrition/day"
import { loadEntries } from "@/lib/nutrition/log"
import { loadProfile } from "@/lib/strength/profile"
import { calendarDay } from "./coach-calendar.ts"
import { assertCoachFuel, fuelClaimNeedsSource, fuelForTraining, unsupportedFuelConclusion, type CoachFuel } from "./coach-fuel.ts"
import { assertCoachReturn, projectCoachReturn, type CoachReturnView } from "./coach-return.ts"
import { assertCoachNextSession, nextSessionAdviceNeedsSource, projectCoachNextSession, type CoachNextSessionView } from "./coach-next-session.ts"

export type CoachConstraint = {
  increaseBlocked: boolean
  blockReason: string | null
  medicalReferral: boolean
}

export type CoachBrief = {
  question: string
  occurrenceId: string | null
  runningStructure: "AVAILABLE" | "UNAVAILABLE"
  sessionRpe: number | null
  sleepHours: number | null
  subjectiveRecovery?: number | null
  recoveryState: string | null
  fatigueState: string | null
  duplicateCount: number
  repetitionSlots: number
  continuousCount: number
  plannedSetCount: number | null
  completedSetCount: number | null
  durationSec: number | null
  pain: boolean
  soreness?: boolean
  musculoskeletalState?: string | null
  daysToCompetition: number | null
  week: 1 | 2 | 3 | 4 | null
  bias: "build" | "hold" | "deload" | null
  constraints: CoachConstraint
  mustAsk: string[]
  sourceIds: string[]
  sources?: { id: string; kind: "FACT" | "DERIVED" | "CONTEXT"; detail: string }[]
  running?: { kind: "REPETITION" | "CONTINUOUS" | "RECOVERY"; position: string; status: string; planned: string; actual: string; sourceEventIds: string[] }[]
  runningTruncated?: boolean
  fuel?: CoachFuel | null
  returnToTraining?: CoachReturnView
  nextSession?: CoachNextSessionView
}

export function assertCoachPacket(b: CoachBrief): void {
  if (!b || typeof b.question !== "string" || b.question.trim().length === 0 || b.question.length > 200 ||
    (b.occurrenceId !== null && typeof b.occurrenceId !== "string") ||
    (b.soreness !== undefined && typeof b.soreness !== "boolean") ||
    (b.musculoskeletalState !== undefined && b.musculoskeletalState !== null && !["NO_RELEVANT_EVIDENCE", "SIGNAL_PRESENT", "INSUFFICIENT_EVIDENCE", "CONFLICTING_EVIDENCE"].includes(b.musculoskeletalState)) ||
    !Array.isArray(b.sourceIds) || !Array.isArray(b.sources) || !Array.isArray(b.running) ||
    b.sources.length > 100 || b.running.length > 48 || b.sourceIds.length > 100 ||
    ![null, 1, 2, 3, 4].includes(b.week) ||
    (b.sessionRpe !== null && (typeof b.sessionRpe !== "number" || b.sessionRpe < 0 || b.sessionRpe > 10)) ||
    (b.daysToCompetition !== null && (!Number.isFinite(b.daysToCompetition) || Math.abs(b.daysToCompetition) > 10000)) ||
    b.sourceIds.some((id) => typeof id !== "string" || id.length > 120 || !b.sources?.some((source) => source.id === id)) ||
    b.sources.some((source) => typeof source.id !== "string" || source.id.length > 120 || typeof source.detail !== "string" || source.detail.length > 300)) throw new Error("bad evidence packet")
  assertCoachFuel(b.fuel)
  assertCoachReturn(b.returnToTraining)
  assertCoachNextSession(b.nextSession)
  if (b.fuel && [b.fuel.logSourceId, b.fuel.targetSourceId].some((id) => id != null && (!b.sourceIds.includes(id) || !b.sources?.some((source) => source.id === id)))) throw new Error("bad evidence packet")
  if ([...(b.returnToTraining?.sourceIds ?? []), ...(b.nextSession?.sourceIds ?? [])].some((id) => !b.sourceIds.includes(id))) throw new Error("bad evidence packet")
}

export type CoachParts = Omit<CoachBrief, "constraints" | "mustAsk" | "returnToTraining" | "nextSession">

export function deriveCoachBrief(parts: CoachParts): CoachBrief {
  const mustAsk: string[] = []
  if (!parts.occurrenceId) mustAsk.push("NO_TRAINING_OCCURRENCE")
  if (parts.duplicateCount > 0) mustAsk.push("DUPLICATE_UNRESOLVED")
  // These gaps limit training advice, but do not prevent a factual question.
  // The model must choose the question's intent; the server enforces the limit
  // on any proposed adjustment in guardCoachResponse.
  const near = parts.daysToCompetition != null && parts.daysToCompetition >= 0 && parts.daysToCompetition <= 28
  const deload = parts.week === 4 || parts.bias === "deload"
  const increaseBlocked = near || deload || parts.pain || parts.duplicateCount > 0
  const blockReason = parts.pain
    ? "已有疼痛记录。先不要加量，必要时做运动医学或康复评估。这不是诊断。"
    : near
      ? "成绩期限在 28 天内，不因为一次表现去加负荷。"
      : parts.duplicateCount > 0
        ? "本次训练有未解决的重复冲突，先核对原始记录。"
      : deload
        ? "这一周是减量或第 4 周，不在对话里加量。"
        : null
  return {
    ...parts,
    mustAsk,
    constraints: { increaseBlocked, blockReason, medicalReferral: parts.pain },
    returnToTraining: projectCoachReturn(parts),
    nextSession: projectCoachNextSession(parts),
  }
}

function recordedNumber(group: EvidenceGroup | undefined): number | null {
  return group?.status === "RECORDED" ? group.value : null
}

function evidenceDetail(record: EvidenceRecord): string {
  const label = { SESSION_RPE: "本次主观强度", SUBJECTIVE_RECOVERY: "本次主观恢复", SLEEP: "睡眠", PAIN: "疼痛", SORENESS: "酸痛" }[record.evidenceType]
  const value = record.value == null ? "未记录程度" : `${record.value}${record.evidenceType === "SLEEP" ? "小时" : "/10"}`
  const location = record.location?.length ? `；部位 ${record.location.join("、")}` : ""
  return `${record.evidenceType} ${label}：${value}${location}；已绑定本次训练的记录，不能单独作为恢复或伤病诊断`
}

function uncitedBodyValue(brief: CoachBrief, text: string, citations: string[]): boolean {
  const claims: { pattern: RegExp; type: string }[] = [
    { pattern: /\bRPE\s*(?:为|是|约)?\s*(10|[1-9])(?!\d)/gi, type: "SESSION_RPE" },
    { pattern: /(?:恢复感|主观恢复)\s*(?:为|是|约)?\s*(10|[1-9])(?!\d)/g, type: "SUBJECTIVE_RECOVERY" },
    { pattern: /睡眠\s*(?:为|是|约|了)?\s*(\d+(?:\.\d+)?)\s*小时/g, type: "SLEEP" },
    { pattern: /酸痛\s*(?:程度|强度|评分|为|是|约)?\s*(10|[1-9])(?!\d)/g, type: "SORENESS" },
    { pattern: /疼痛\s*(?:程度|强度|评分|为|是|约)?\s*(10|[1-9])(?!\d)/g, type: "PAIN" },
  ]
  for (const { pattern, type } of claims) {
    for (const match of text.matchAll(pattern)) {
      const value = Number(match[1])
      if (!brief.sources?.some((source) => citations.includes(source.id) && source.kind === "FACT" && source.detail.startsWith(`${type} `) && source.detail.includes(`：${value}${type === "SLEEP" ? "小时" : "/10"}`))) return true
    }
  }
  return false
}

function unsupportedBodyStatement(brief: CoachBrief, text: string, citations: string[]): boolean {
  const unsupportedAbsence = text.split(/[。；\n]/).some((clause) =>
    !/(?:不能|无法|尚不能|未能|不代表|不等于|没有证据|证据不足|不可据此|不能确认|无法确认|不确定)/.test(clause) &&
    /(?:没有|无|不存在)(?:疼痛|酸痛)(?!记录)/.test(clause),
  )
  if (unsupportedAbsence) return true
  const affirmed = [
    { type: "PAIN", pattern: /(?:已记录|记录了|记录到|出现了|已有).{0,8}疼痛|疼痛.{0,5}(?:已记录|有记录)/ },
    { type: "SORENESS", pattern: /(?:已记录|记录了|记录到|出现了|已有).{0,8}酸痛|酸痛.{0,5}(?:已记录|有记录)/ },
  ]
  return affirmed.some(({ type, pattern }) => pattern.test(text) && !brief.sources?.some((source) => citations.includes(source.id) && source.kind === "FACT" && source.detail.startsWith(`${type} `)))
}

function unsupportedMedicalConclusion(text: string): boolean {
  return text.split(/[。；\n]/).some((clause) => {
    if (/(?:不能|无法|尚不能|未能|不代表|不等于|没有证据|证据不足|不可据此|不能确认|无法确认|不确定|并非|不是)/.test(clause)) return false
    return /(?:已经|已|完全|确定)(?:恢复正常|完全恢复|痊愈|康复|安全回归)|(?:可以|能够|确认|适合|获准).{0,8}(?:恢复正常训练|完全恢复训练|安全回归|恢复原强度)|(?:没有|不存在|绝无)(?:伤病|受伤风险)|酸痛(?:就是|等于|说明)(?:受伤|伤病)/.test(clause)
  })
}

function asksReturnToTraining(question: string): boolean {
  return /(?:分阶段|逐步).{0,8}(?:恢复|回归)|(?:恢复|回归|回到|重新开始|重返).{0,8}(?:训练|跑步|力量)|(?:疼痛|酸痛|伤后|受伤后).{0,12}(?:怎么练|如何练|能练|训练)/.test(question)
}

function hasBoundReturnSignal(brief: CoachBrief): boolean {
  return brief.returnToTraining?.state === "PAIN_RECORDED" || brief.returnToTraining?.state === "SORENESS_RECORDED"
}

function returnAdviceNeedsBoundSource(brief: CoachBrief, text: string, citations: string[]): boolean {
  if (!asksReturnToTraining(brief.question) || !hasBoundReturnSignal(brief) || !/(?:停止|避免|保持|减量|恢复|核对|观察|评估|诱发动作)/.test(text)) return false
  return !(brief.returnToTraining?.sourceIds ?? []).some((id) => citations.includes(id))
}

export function assembleCoachBrief(plan: Plan | null, question: string, selectedOccurrenceId?: string | null): CoachBrief {
  const events = loadEvents()
  const candidates = listTrainingOccurrences()
    .filter((item) => !occurrenceVoided(item.trainingOccurrenceId) && item.startedAt && events.some((event) => event.event_id === item.startEventId && event.event_type === "TRAINING_STARTED"))
    .sort((left, right) => (left.startedAt ?? "").localeCompare(right.startedAt ?? "") || left.trainingOccurrenceId.localeCompare(right.trainingOccurrenceId))
  const latest = selectedOccurrenceId === undefined ? candidates.at(-1) : candidates.find((item) => item.trainingOccurrenceId === selectedOccurrenceId)
  const occurrenceId = latest?.trainingOccurrenceId ?? null
  const subjective = occurrenceId ? projectOccurrenceEvidence(occurrenceId, events) : null
  const execution = occurrenceId ? projectRunningExecution(occurrenceId, events) : null
  const availability = occurrenceId ? evidenceAvailability(occurrenceId) : null
  const fact = occurrenceId ? readTrainingFact(occurrenceId) : null
  const context = readTrainingContext(plan)
  const todayDay = calendarDay(new Date().toISOString())
  const nutritionPlan = computePlan(loadProfile())
  const target = nutritionPlan && loadDay().date === todayDay ? todayEatTarget(nutritionPlan) : nutritionPlan?.kcal ?? null
  const fuel = fuelForTraining(latest?.startedAt ?? null, new Date().toISOString(), loadEntries(), target)
  const rpe = recordedNumber(subjective?.sessionRpe)
  const sleep = recordedNumber(subjective?.sleep)
  const subjectiveRecovery = recordedNumber(subjective?.subjectiveRecovery)
  const duplicateCount = (execution?.repetitions.filter((item) => item.status === "DUPLICATE_UNRESOLVED").length ?? 0) + (execution?.continuous.filter((item) => item.status === "DUPLICATE_UNRESOLVED").length ?? 0) + (execution?.recoveries.filter((item) => item.status === "DUPLICATE_UNRESOLVED").length ?? 0) + (fact?.duplicateSetCount ?? 0) + (subjective && [subjective.sessionRpe, subjective.sleep, subjective.subjectiveRecovery].some((group) => group.status === "MULTIPLE") ? 1 : 0)
  const sources: NonNullable<CoachBrief["sources"]> = []
  if (occurrenceId) sources.push({ id: occurrenceId, kind: "FACT", detail: `训练开始；${latest?.startedAt ?? "时间未记录"}；${latest?.lifecycle ?? "状态未知"}` })
  if (fact?.trainingPlanSnapshotId) sources.push({ id: fact.trainingPlanSnapshotId, kind: "FACT", detail: strengthSetDetail(fact.plannedSetCount, fact.completedSetCount) })
  if (fuel.logSourceId) sources.push({ id: fuel.logSourceId, kind: "DERIVED", detail: `${fuel.todayDay} 已记录摄入 ${fuel.recordedKcal} 千卡，来自 ${fuel.entries.length} 条本地饮食记录；未确认全天记录完整，不能推断实际摄入不足` })
  if (fuel.targetSourceId) sources.push({ id: fuel.targetSourceId, kind: "CONTEXT", detail: `${fuel.todayDay} 热量目标 ${fuel.targetKcal} 千卡；来自个人目标与当日记录，不是实际摄入事实` })
  if (subjective) for (const group of [subjective.sessionRpe, subjective.sleep, subjective.subjectiveRecovery, subjective.pain, subjective.soreness]) {
    for (const record of group.records) sources.push({ id: record.evidenceId, kind: "FACT", detail: evidenceDetail(record).slice(0, 300) })
  }
  const running: NonNullable<CoachBrief["running"]> = []
  for (const slot of execution?.repetitions ?? []) running.push({ kind: "REPETITION", position: `${slot.componentId}/${slot.blockId}/${slot.stepId} 第${slot.roundOrdinal}轮第${slot.repeatOrdinal}次`, status: slot.status, planned: `${slot.plannedDistanceMeters ?? "?"}米/${slot.plannedDurationSeconds ?? "?"}秒`, actual: `${slot.actualDistanceMeters ?? "未记录"}米/${slot.actualDurationSeconds ?? "未记录"}秒`, sourceEventIds: slot.sourceEventIds })
  for (const slot of execution?.continuous ?? []) running.push({ kind: "CONTINUOUS", position: slot.componentId, status: slot.status, planned: `${slot.plannedDistanceMeters ?? "?"}米/${slot.plannedDurationSeconds ?? "?"}秒`, actual: `${slot.actualDistanceMeters ?? "未记录"}米/${slot.actualDurationSeconds ?? "未记录"}秒`, sourceEventIds: slot.sourceEventIds })
  for (const slot of execution?.recoveries ?? []) running.push({ kind: "RECOVERY", position: `${slot.componentId}/${slot.blockId}/${slot.kind} 第${slot.roundOrdinal ?? "?"}轮`, status: slot.status, planned: `${slot.plannedRecoverySeconds ?? "未记录"}秒`, actual: `${slot.actualRecoverySeconds ?? "未记录"}秒`, sourceEventIds: slot.sourceEventIds })
  for (const slot of running) for (const id of slot.sourceEventIds) sources.push({ id, kind: "FACT", detail: `${slot.kind} ${slot.position}：${slot.status}；实际 ${slot.actual}` })
  if (availability) for (const domain of ["fatigue", "recovery", "musculoskeletal"] as const) sources.push({ id: `${occurrenceId}:${domain}`, kind: "DERIVED", detail: `${domain} 证据状态 ${availability[domain].state}；结论 UNKNOWN` })
  if (context.daysToCompetition != null) sources.push({ id: "context:competition", kind: "CONTEXT", detail: `距比赛 ${context.daysToCompetition} 天；来自当前目标，非本次训练事件` })
  if (context.week != null || context.bias) sources.push({ id: "context:cycle", kind: "CONTEXT", detail: `第 ${context.week ?? "?"} 周，${context.bias ?? "未记录"}；来自当前计划` })
  if (context.pain) sources.push({ id: "context:pain", kind: "CONTEXT", detail: "近期教练笔记或周期日志提及疼痛；未绑定为本次训练疼痛事实" })
  const includedSources = sources.slice(0, 100)
  return deriveCoachBrief({
    question: question.slice(0, 200),
    occurrenceId,
    runningStructure: execution?.availability === "AVAILABLE" ? "AVAILABLE" : "UNAVAILABLE",
    sessionRpe: rpe,
    sleepHours: sleep,
    subjectiveRecovery,
    recoveryState: availability?.recovery.state ?? null,
    fatigueState: availability?.fatigue.state ?? null,
    duplicateCount,
    repetitionSlots: execution?.repetitions.length ?? 0,
    continuousCount: execution?.continuous.length ?? 0,
    plannedSetCount: fact?.plannedSetCount ?? null,
    completedSetCount: fact?.completedSetCount ?? null,
    durationSec: fact?.duration ?? null,
    pain: context.pain || Boolean(subjective?.pain.records.length),
    soreness: Boolean(subjective?.soreness.records.length),
    musculoskeletalState: availability?.musculoskeletal.state ?? null,
    daysToCompetition: context.daysToCompetition,
    week: context.week,
    bias: context.bias,
    sourceIds: [...new Set(includedSources.map((item) => item.id))],
    sources: includedSources,
    running: running.slice(0, 48),
    runningTruncated: running.length > 48,
    fuel,
  })
}

export type CoachTurn = {
  mode: "ask" | "answer" | "unavailable"
  text: string
  nextStep: string | null
  citations: string[]
  medicalReferral: boolean
  planChanged: false
}

type CoachModelJson = { mode?: string; text?: string; citations?: string[]; nextStep?: string | null; medicalReferral?: boolean }

function withoutNegatedIncrease(clause: string): string {
  return clause.replace(/(?:不要|不能|不可|不宜|不应该|不建议|不得|不会|不许|避免|禁止|别|暂缓|停止|不)[^。；，、\n]{0,8}?(?:加量|加重|加(?:\d+|一|两|几)?组|加速|增加|提高|提升|提速|冲量|更多组|延长距离|上调负荷|冲强度)/g, "")
}

function mentionsProposedIncrease(text: string): boolean {
  return text.split(/[。；，、\n]/).some((clause) => /(?:下次|下一课|接下来|建议|可以|应该|可考虑|批准).{0,16}(?:加量|加(?:\d+|一|两|几)?组|加重|提速|增加|提高|提升|延长距离|上调负荷|冲强度)/.test(withoutNegatedIncrease(clause)))
}

function stillProposesIncrease(text: string): boolean {
  return text.split(/[。；，、\n]/).some((clause) => /加(?:大|高|多|长|快|重|组|量|速|(?:\d+|一|两|几)组)|增加|提高|提升|提速|冲量|更多组|延长距离|上调负荷|冲强度/.test(withoutNegatedIncrease(clause)))
}

export function recoveryConflictApplies(brief: Pick<CoachBrief, "question" | "sources">): boolean {
  const facts = (brief.sources ?? []).filter((source) => source.kind === "FACT" && source.detail.startsWith("SUBJECTIVE_RECOVERY "))
  return facts.length > 1 && /恢复|回归|下一课|下次训练|下一次训练|分阶段/.test(brief.question)
}

function asksNextSession(question: string): boolean {
  return /(?:下一课|下一次训练|下次训练|接下来).{0,18}(?:怎么|如何|安排|调整|加|减|保持)|(?:加量|加组|提速|减量).{0,10}(?:吗|么|是否|可不可以)/.test(question)
}

export function highRpeRecoveryRequired(brief: Pick<CoachBrief, "question" | "sessionRpe" | "sleepHours" | "subjectiveRecovery">): boolean {
  return brief.sessionRpe != null && brief.sessionRpe >= 7 && brief.subjectiveRecovery == null && brief.sleepHours == null && (asksReturnToTraining(brief.question) || asksNextSession(brief.question))
}

export function sorenessBoundaryRequired(brief: Pick<CoachBrief, "question" | "sources">): boolean {
  if (!asksReturnToTraining(brief.question)) return false
  const sources = brief.sources ?? []
  return sources.some((source) => source.kind === "FACT" && source.detail.startsWith("SORENESS ")) && !sources.some((source) => source.kind === "FACT" && source.detail.startsWith("PAIN "))
}

function distinguishesSoreness(text: string): boolean {
  return /酸痛(?:[^。；\n]{0,16})?(?:不等于|并非|不是|不能当成|不能视为|不能说明|不能判断|无法说明|无法判断)(?:[^。；\n]{0,8})?(?:疼痛|伤病|受伤|伤)/.test(text)
    || /(?:仅凭|只凭|光凭|不能仅凭|不能凭)酸痛(?:[^。；\n]{0,16})?(?:不能|无法|不足以)(?:[^。；\n]{0,8})?(?:说明|判断|证明)(?:[^。；\n]{0,6})?(?:疼痛|伤病|受伤|伤)/.test(text)
}

function highRpeRecoveryFailure(brief: CoachBrief, mode: CoachTurn["mode"], text: string, nextStep: string | null, citations: string[]): CoachTurn | null {
  if (!highRpeRecoveryRequired(brief)) return null
  const joined = `${text} ${nextStep ?? ""}`
  const reject = (): CoachTurn => ({ mode: "unavailable", text: "高主观强度后必须先追问尚未记录的恢复或睡眠，不能直接形成训练建议。", nextStep: null, citations: [], medicalReferral: brief.constraints.medicalReferral, planChanged: false })
  const missingAsKnown = joined.split(/[。；\n]/).some((clause) => !/(?:不能|无法|不是|并非|不要|不得|没有把)/.test(clause) && /(?:恢复|睡眠)[^。；\n]{0,8}(?:为|是|约)?\s*0|状态正常|恢复正常|已经恢复/.test(clause))
  if (missingAsKnown || mode === "answer") return reject()
  const citesRpe = (brief.sources ?? []).some((source) => citations.includes(source.id) && source.kind === "FACT" && source.detail.startsWith("SESSION_RPE "))
  const unrecorded = /恢复/.test(joined) && /睡眠/.test(joined) && /未记录|没有记录|还没|尚未|缺失|没记录/.test(joined)
  const asks = /[？?]|多少|怎样|如何|请问|吗/.test(joined)
  const prescribes = joined.split(/[。；，\n]/).some((clause) => !/(?:不要|不能|不可|不得|别)/.test(clause) && /保持|减量|加量|加重|提速|增加|恢复课|恢复训练/.test(clause))
  if (citesRpe && unrecorded && asks && !prescribes) return null
  return reject()
}

function sorenessBoundaryFailure(brief: CoachBrief, mode: CoachTurn["mode"], text: string, nextStep: string | null, citations: string[]): CoachTurn | null {
  if (mode !== "answer" || !sorenessBoundaryRequired(brief)) return null
  const joined = `${text} ${nextStep ?? ""}`
  const reject = (message: string): CoachTurn => ({ mode: "unavailable", text: message, nextStep: null, citations: [], medicalReferral: brief.constraints.medicalReferral, planChanged: false })
  const equates = joined.split(/[。；\n]/).some((clause) => !/(?:不能|无法|并非|不是|不等于|不代表)/.test(clause) && /酸痛(?:就是|等于|说明|属于)(?:疼痛|受伤|伤病)/.test(clause))
  if (equates || unsupportedMedicalConclusion(joined)) return reject("回答把训练证据说成了确定的恢复或伤病结论，无法采用。")
  const citesSoreness = (brief.sources ?? []).some((source) => citations.includes(source.id) && source.kind === "FACT" && source.detail.startsWith("SORENESS "))
  if (citesSoreness && distinguishesSoreness(joined)) return null
  return reject("酸痛回归没有区分酸痛和疼痛，无法采用。")
}

function recoveryConflictFailure(brief: CoachBrief, mode: CoachTurn["mode"], text: string, nextStep: string | null, citations: string[]): CoachTurn | null {
  if (!recoveryConflictApplies(brief)) return null
  const facts = (brief.sources ?? []).filter((source) => source.kind === "FACT" && source.detail.startsWith("SUBJECTIVE_RECOVERY "))
  const joined = `${text} ${nextStep ?? ""}`
  const reject = (message: string): CoachTurn => ({ mode: "unavailable", text: message, nextStep: null, citations: [], medicalReferral: brief.constraints.medicalReferral, planChanged: false })
  if (unsupportedMedicalConclusion(joined) || joined.split(/[。；\n]/).some((clause) => !/(?:不能|无法|尚不能|未能|不代表|不等于|没有证据|证据不足|不可据此|不能确认|无法确认|不确定|并非|不是|不要|不得)/.test(clause) && /恢复正常|安全回归/.test(clause))) {
    return reject("回答把训练证据说成了确定的恢复或伤病结论，无法采用。")
  }
  if (stillProposesIncrease(joined)) {
    const referral = brief.constraints.medicalReferral ? "已有疼痛记录，必要时请做运动医学或康复评估。这不是诊断。" : ""
    return reject(`回答与已记录的安全约束冲突，无法采用。${referral}`)
  }
  if (joined.split(/[。；\n]/).some((clause) => /平均|均值/.test(clause) && !/(?:不要|不能|别|不可|并未|不是)/.test(clause))) {
    return reject("冲突的恢复记录被计算成了平均值，无法采用。")
  }
  if (/(?:以|按|采用|相信|只看|只认).{0,12}(?:\d+\s*[/／]\s*10|\d+\s*分)|忽略.{0,8}(?:另一|其余|较低|较高)/.test(joined)) {
    return reject("回答选择了冲突恢复中的一条，无法采用。")
  }
  const values = facts.map((fact) => fact.detail.match(/(\d+)\s*\/\s*10/)?.[1]).filter((value): value is string => Boolean(value))
  const citedAll = facts.every((fact) => citations.includes(fact.id))
  const shown = values.every((value) => new RegExp(`(?<!\\d)${value}(?!\\d)`).test(joined))
  if (mode === "ask" && citedAll && shown) return null
  return reject("冲突的恢复记录没有被同时追问，无法采用。")
}

export function guardCoachResponse(brief: CoachBrief, raw: string): CoachTurn {
  let parsed: CoachModelJson | null = null
  try {
    const match = raw.match(/\{[\s\S]*\}/)
    parsed = match ? (JSON.parse(match[0]) as CoachModelJson) : null
  } catch {
    parsed = null
  }
  if (!parsed || typeof parsed.text !== "string" || !parsed.text.trim()) {
    return { mode: "unavailable", text: "模型没有返回可核对的回答。没有用固定话术代替。", nextStep: null, citations: [], medicalReferral: brief.constraints.medicalReferral, planChanged: false }
  }
  const citations = Array.isArray(parsed.citations) ? [...new Set(parsed.citations.filter((id): id is string => typeof id === "string" && brief.sourceIds.includes(id)))].slice(0, 8) : []
  let mode: CoachTurn["mode"] = parsed.mode === "ask" ? "ask" : "answer"
  let text = parsed.text.trim().slice(0, 900)
  let nextStep = typeof parsed.nextStep === "string" ? parsed.nextStep.trim().slice(0, 240) : null
  if (mode === "answer" && unsupportedMedicalConclusion(`${text} ${nextStep ?? ""}`)) {
    return { mode: "unavailable", text: "回答把训练证据说成了确定的恢复或伤病结论，无法采用。", nextStep: null, citations: [], medicalReferral: brief.constraints.medicalReferral, planChanged: false }
  }
  if (unsupportedFuelConclusion(`${text} ${nextStep ?? ""}`)) {
    return { mode: "unavailable", text: "回答把不完整的饮食记录或一次掉速当成了确定原因，无法采用。", nextStep: null, citations: [], medicalReferral: brief.constraints.medicalReferral, planChanged: false }
  }
  if (mode === "answer" && fuelClaimNeedsSource(text)) {
    const fuel = brief.fuel
    if (!fuel || fuel.status !== "SAME_DAY_RECORDED" || !fuel.logSourceId || !citations.includes(fuel.logSourceId) ||
      (fuel.targetKcal != null && (!fuel.targetSourceId || !citations.includes(fuel.targetSourceId)))) {
      return { mode: "unavailable", text: "回答提到了热量，却没有同一天可核对的记录与目标来源，无法采用。", nextStep: null, citations: [], medicalReferral: brief.constraints.medicalReferral, planChanged: false }
    }
  }
  const adviceGap = brief.sessionRpe == null || brief.sessionRpe >= 7 && brief.sleepHours == null && brief.subjectiveRecovery == null
  const proposedIncrease = mentionsProposedIncrease(`${text} ${nextStep ?? ""}`)
  const conflictFailure = recoveryConflictFailure(brief, mode, text, nextStep, citations)
  if (conflictFailure) return conflictFailure
  const highRpeFailure = highRpeRecoveryFailure(brief, mode, text, nextStep, citations)
  if (highRpeFailure) return highRpeFailure
  const sorenessFailure = sorenessBoundaryFailure(brief, mode, text, nextStep, citations)
  if (sorenessFailure) return sorenessFailure
  if (brief.mustAsk.length > 0 && mode !== "ask") {
    mode = "ask"
    nextStep = null
    text = brief.mustAsk.includes("NO_TRAINING_OCCURRENCE") ? "请先选择一条有训练开始事件的记录，我才能核对这次训练。" : "本次训练有未解决的重复记录。请先核对冲突的原始记录，再讨论调整。"
  }
  if (mode === "answer" && uncitedBodyValue(brief, `${text} ${nextStep ?? ""}`, citations)) {
    return { mode: "unavailable", text: "回答中的主观强度或身体反馈数值没有对应的本次训练来源，无法采用。", nextStep: null, citations: [], medicalReferral: brief.constraints.medicalReferral, planChanged: false }
  }
  if (mode === "answer" && unsupportedBodyStatement(brief, `${text} ${nextStep ?? ""}`, citations)) {
    return { mode: "unavailable", text: "回答把未绑定的身体反馈说成已记录，或把缺失说成正常，无法采用。", nextStep: null, citations: [], medicalReferral: brief.constraints.medicalReferral, planChanged: false }
  }
  if (mode === "answer" && nextSessionAdviceNeedsSource(brief.nextSession, `${text} ${nextStep ?? ""}`, citations)) {
    return { mode: "unavailable", text: "下一课建议没有覆盖触发约束的训练来源，无法采用。", nextStep: null, citations: [], medicalReferral: brief.constraints.medicalReferral, planChanged: false }
  }
  if (mode === "answer" && returnAdviceNeedsBoundSource(brief, `${text} ${nextStep ?? ""}`, citations)) {
    return { mode: "unavailable", text: "回归训练边界没有引用已绑定的疼痛或酸痛来源，无法采用。", nextStep: null, citations: [], medicalReferral: brief.constraints.medicalReferral, planChanged: false }
  }
  // Missing RPE/recovery still blocks a load prescription. It must not erase a
  // source-backed pain/soreness boundary such as stopping a provoking movement
  // or keeping/reducing while current symptoms are confirmed.
  const boundedReturnAnswer = asksReturnToTraining(brief.question) && hasBoundReturnSignal(brief)
  if (adviceGap && mode === "answer" && (proposedIncrease || nextStep && !boundedReturnAnswer)) {
    mode = "ask"
    text = "要建议下一课，需要先记录本次主观强度和恢复情况。你这次训练的 RPE 是多少，恢复感觉怎样？"
    nextStep = null
  }
  const increase = stillProposesIncrease(`${text} ${nextStep ?? ""}`)
  if (brief.constraints.increaseBlocked && increase) {
    const referral = brief.constraints.medicalReferral ? "已有疼痛记录，必要时请做运动医学或康复评估。这不是诊断。" : ""
    return { mode: "unavailable", text: `回答与已记录的安全约束冲突，无法采用。${referral}`, nextStep: null, citations: [], medicalReferral: brief.constraints.medicalReferral, planChanged: false }
  }
  if (mode === "answer" && brief.nextSession?.increaseSupported === false && proposedIncrease) {
    return { mode: "unavailable", text: "当前证据只支持追问、保持、减量或恢复建议，不能据此批准增加训练。", nextStep: null, citations: [], medicalReferral: brief.constraints.medicalReferral, planChanged: false }
  }
  if (mode === "answer" && brief.occurrenceId && citations.length === 0) {
    return { mode: "unavailable", text: "回答没有可核对的事实来源，无法采用。", nextStep: null, citations: [], medicalReferral: brief.constraints.medicalReferral, planChanged: false }
  }
  if (brief.constraints.medicalReferral && !text.includes("评估")) {
    text = `${text}已有疼痛记录，必要时请做运动医学或康复评估。这不是诊断。`
  }
  text = softenUnrecordedSets(brief, text)
  if (mode !== "answer") nextStep = null
  return { mode, text, nextStep, citations, medicalReferral: brief.constraints.medicalReferral, planChanged: false }
}

export function guardSubcode(turn: CoachTurn): string | null {
  if (turn.mode !== "unavailable") return null
  if (turn.text.includes("必须先追问尚未记录的恢复或睡眠")) return "HIGH_RPE_RECOVERY_REQUIRED"
  if (turn.text.includes("没有区分酸痛和疼痛")) return "SORENESS_BOUNDARY_MISSING"
  if (turn.text.includes("冲突的恢复记录") || turn.text.includes("选择了冲突恢复")) return "CONFLICT_NOT_ASKED"
  if (turn.text.includes("安全约束冲突")) return "PROPOSED_INCREASE"
  if (turn.text.includes("确定的恢复或伤病")) return "FALSE_CLEARANCE"
  if (turn.text.includes("未绑定的身体反馈") || turn.text.includes("缺失说成正常")) return "UNSUPPORTED_ABSENCE"
  if (turn.text.includes("回归训练边界没有引用")) return "RETURN_SOURCE_MISSING"
  return null
}

export function strengthSetDetail(planned: number | null, recorded: number | null): string {
  return `力量计划 ${planned ?? "未知"} 组；已记录完成 ${recorded ?? "未知"} 组；未记录的组不能推断为实际没做`
}

export function softenUnrecordedSets(brief: Pick<CoachBrief, "plannedSetCount" | "completedSetCount">, text: string): string {
  if (brief.plannedSetCount == null || brief.completedSetCount == null || brief.completedSetCount >= brief.plannedSetCount) return text
  const safe = `已记录完成 ${brief.completedSetCount} 组，未记录的组不能推断为实际没做`
  return text
    .replace(/已记录完成\s*\d+\s*组/g, "§RECORDED§")
    .replace(/实际完成\s*0\s*组|完成了\s*0\s*组|完成\s*0\s*组|完成量(?:为|是)?零|训练完成量(?:为|是)?零|一组都没(?:做|练)?|什么都没做/g, safe)
    .replace(/§RECORDED§/g, `已记录完成 ${brief.completedSetCount} 组`)
}

export function recordCoachChoice(input: { choice: "accept" | "reject" | "modify"; question: string; note?: string }): { planChanged: false } {
  const type = input.choice === "accept" ? "USER_ACCEPTED" : input.choice === "reject" ? "USER_REJECTED" : "USER_MODIFIED"
  dispatchEvent(type, { source: "COACH_07_1", question: input.question.slice(0, 200), note: input.note?.slice(0, 200) ?? "" })
  return { planChanged: false }
}

export function recordCoachEvidence(trainingOccurrenceId: string, values: { sessionRpe?: number; subjectiveRecovery?: number }): { ok: boolean; reason: string } {
  if (!reliableCoachOccurrence(trainingOccurrenceId)) return { ok: false, reason: "找不到可靠的训练开始记录。" }
  const entries = [["SESSION_RPE", values.sessionRpe], ["SUBJECTIVE_RECOVERY", values.subjectiveRecovery]] as const
  if (entries.every(([, value]) => value === undefined)) return { ok: false, reason: "请先填写一项记录。" }
  const existing = projectOccurrenceEvidence(trainingOccurrenceId, loadEvents())
  for (const [evidenceType, value] of entries) {
    if (value === undefined) continue
    if (!Number.isInteger(value) || value < 1 || value > 10) return { ok: false, reason: "评分需为 1 到 10 的整数。" }
    if ((evidenceType === "SESSION_RPE" ? existing.sessionRpe : existing.subjectiveRecovery).status !== "ABSENT") return { ok: false, reason: "这项已经有记录，请先核对原记录，避免重复冲突。" }
  }
  for (const [evidenceType, value] of entries) {
    if (value !== undefined && !dispatchEvent("RPE_RECORDED", { evidenceType, value, trainingOccurrenceId, source: "COACH_CONFIRMED" })) return { ok: false, reason: "记录失败，请重试。" }
  }
  return { ok: true, reason: "已绑定到所选训练。现在可以继续追问。" }
}

function reliableCoachOccurrence(trainingOccurrenceId: string): boolean {
  return typeof trainingOccurrenceId === "string" && !occurrenceVoided(trainingOccurrenceId) && loadEvents().some((event) => event.event_id === trainingOccurrenceId && event.event_type === "TRAINING_STARTED") &&
    listTrainingOccurrences().some((item) => item.trainingOccurrenceId === trainingOccurrenceId && item.startEventId === trainingOccurrenceId)
}

export function recordCoachBodyEvidence(trainingOccurrenceId: string, input: { kind: "SORENESS" | "PAIN"; location: string; intensity: number }): { ok: boolean; reason: string } {
  if (!reliableCoachOccurrence(trainingOccurrenceId)) return { ok: false, reason: "请先选择有可靠开始事件的训练。" }
  if (input.kind !== "SORENESS" && input.kind !== "PAIN") return { ok: false, reason: "请选择酸痛或疼痛。" }
  const location = typeof input.location === "string" ? input.location.trim() : ""
  if (!location || location.length > 40) return { ok: false, reason: "请填写 1–40 字的部位。" }
  if (!Number.isInteger(input.intensity) || input.intensity < 1 || input.intensity > 10) return { ok: false, reason: "程度需为 1 到 10 的整数。" }
  const existing = projectOccurrenceEvidence(trainingOccurrenceId, loadEvents())
  const group = input.kind === "PAIN" ? existing.pain : existing.soreness
  if (group.records.some((record) => record.location?.includes(location) && record.value === input.intensity)) return { ok: false, reason: "本次训练已经有相同部位和程度的记录，未重复写入。" }
  const payload = { trainingOccurrenceId, location, intensity: input.intensity, source: "COACH_CONFIRMED" }
  const saved = input.kind === "PAIN"
    ? dispatchEvent("PAIN_RECORDED", payload)
    : dispatchEvent("SUBJECTIVE_FEEDBACK", { ...payload, evidenceType: "SORENESS" })
  return saved ? { ok: true, reason: "已绑定到所选训练。酸痛与疼痛会分别引用，不会自动改课。" } : { ok: false, reason: "记录失败，请重试。" }
}
