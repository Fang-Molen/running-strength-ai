import { readCoachData, analysisDay, dataHasRecords, assertCoachData, type CoachDataContext } from "../health/coach-data"
import { isConditionalAdvice, isNonFactNumber } from "./coach-claim-scope.ts"
import { readLinkedCoachSources, attachLinkedSources } from "./coach-linked-context.ts"
import { coachImports, importedCoachParts } from "./coach-import-evidence.ts"
import { preserveReferral } from "./coach-referral-safety.ts"
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
  appData?: CoachDataContext
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
  assertCoachData(b.appData)
  if(b.appData && (!b.sourceIds.includes(b.appData.sourceId)||!b.sources?.some(s=>s.id===b.appData!.sourceId)))throw new Error("bad app data provenance")
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
      if(isNonFactNumber(text,match.index??0))continue
      const value = Number(match[1])
      if (!brief.sources?.some((source) => citations.includes(source.id) && source.kind === "FACT" && source.detail.startsWith(`${type} `) && new RegExp(`[:：]\\s*${value}${type === "SLEEP" ? "小时" : "/10"}`).test(source.detail))) return true
    }
  }
  return false
}

function unsupportedBodyStatement(brief: CoachBrief, text: string, citations: string[]): boolean {
  const unsupportedAbsence = text.split(/[。；\n]/).some((clause) =>
    !/(?:不能|无法|尚不能|未能|不代表|不等于|没有证据|证据不足|不可据此|不能确认|无法确认|不确定|如果|若|前提|是否|有无|确认.{0,8}后)/.test(clause) &&
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

function assembleSessionCoachBrief(plan: Plan | null, question: string, selectedOccurrenceId?: string | null): CoachBrief {
  const imported=selectedOccurrenceId ? coachImports().find(r=>r.confirmedImportId===selectedOccurrenceId) : null
  if(imported&&!occurrenceVoided(imported.confirmedImportId))return attachLinkedSources(deriveCoachBrief(importedCoachParts(imported,question)),readLinkedCoachSources(undefined,question))
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
  sources.push(...readLinkedCoachSources(undefined,question))
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
    durationSec: fact?.duration != null ? fact.duration / 1000 : null,
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

/** Fresh local calendar context is separate from the selected occurrence and its evidence. */
export function assembleCoachBrief(plan:Plan|null,question:string,selectedOccurrenceId?:string|null):CoachBrief{
 const brief=assembleSessionCoachBrief(plan,question,selectedOccurrenceId)
 if(!/健康|睡眠|hrv|静息|疲劳|恢复|均衡|这周|本周|饮食|摄入|导入|手表|下一次训练/i.test(question))return brief
 const started=brief.occurrenceId?listTrainingOccurrences().find(o=>o.trainingOccurrenceId===brief.occurrenceId)?.startedAt??null:null
 const appData=readCoachData(analysisDay(question,started))
 if(!dataHasRecords(appData)&&!/健康|睡眠|hrv|静息|疲劳|均衡/i.test(question))return brief
 if((brief.sources?.length??0)>=100)return brief // retain full source-bound training evidence
 const source={id:appData.sourceId,kind:'CONTEXT' as const,detail:`${appData.day} 本地健康、饮食与训练日历背景；经验阈值只作复核提示，不是本次课的事实或自动处方。`}
 const out={...brief,appData,sourceIds:[...brief.sourceIds,source.id],sources:[...brief.sources??[],source]}
 if(appData.fatigue.state==='PAIN_REVIEW')out.constraints={...brief.constraints,increaseBlocked:true,medicalReferral:true,blockReason:'当天另有疼痛记录：先核对疼痛与功能；没有绑定为本次课疼痛事实。'}
 return out
}

export type CoachTurn = {
  candidate?: import('./coach-structured-candidate.ts').StructuredCoachingCandidate|null;
  mode: "ask" | "answer" | "unavailable"
  text: string
  nextStep: string | null
  citations: string[]
  medicalReferral: boolean
  planChanged: false
}

type CoachModelJson = { mode?: string; text?: string; citations?: string[]; nextStep?: string | null; medicalReferral?: boolean }

// K13: a worsening symptom ("疼痛跑后加重") describes the athlete, not a proposed
// load increase. The filler may not contain advice words, so "疼痛减轻后可以加重"
// is still treated as a proposal.
const SYMPTOM_WORSENING = /(?:疼痛|酸痛|痛感|症状|不适|疼|痛|跑后|跑完|训练后|运动后|练完)(?:(?!可以|建议|下次|再|能|应)[^。；，、\n]){0,6}?加重/g

function withoutNegatedIncrease(clause: string): string {
  // K13: "不支持/不允许/不批准/限制…增加" are prohibitions too. "限制" only counts
  // when it is not itself lifted (不再限制、解除限制、取消限制、放开限制、没有限制).
  return clause
    .replace(SYMPTOM_WORSENING, "")
    .replace(/(?:不要|不能|不可|不宜|不应该|不建议|不得|不会|不许|避免|禁止|别|暂缓|停止|不支持|不允许|不批准|不赞成|盲目|(?<!不再|解除|取消|放开|没有)限制|不)[^。；，、\n]{0,8}?(?:加量|加重|加(?:\d+|一|两|几)?(?:组|次|课|节)|加速|增加|提高|提升|提速|冲量|更多组|延长距离|上调负荷|冲强度)(?:[（(](?:(?!可以|建议|下次|但|而是|只|改为|换成|应|再|能)[^）)]){0,24}[）)]|(?:(?!可以|建议|下次|但|而是|只|改为|换成|应|再|能)[^。；，\n]){0,24}(?=[。；，\n]|$))?/g, "")
}

function mentionsProposedIncrease(text: string): boolean {
  return text.split(/[。；，、\n]/).some((clause) => /(?:下次|下一课|接下来|建议|可以|应该|必须|可考虑|批准).{0,16}(?:加量|加(?:\d+|一|两|几)?(?:组|次|课|节)|加重|提速|增加|提高|提升|延长距离|上调负荷|冲强度)/.test(withoutNegatedIncrease(clause)))
}

function stillProposesIncrease(text: string): boolean {
  return text.split(/[。；，、\n]/).some((clause) => /加(?:大|高|多|长|快|重|组|量|速|课|(?:\d+|一|两|几)(?:组|次|课|节))|增加|提高|提升|提速|冲量|更多组|延长距离|上调负荷|冲强度/.test(withoutNegatedIncrease(clause)))
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
  const missingAsKnown = joined.split(/[。；\n]/).some((clause) => !/(?:不能|无法|不是|并非|不要|不得|没有把|如果|若|前提|是否)/.test(clause) && /(?:恢复|睡眠)[^。；\n]{0,8}(?:为|是|约)?\s*0|状态正常|恢复正常|已经恢复/.test(clause))
  // R3 (user-approved): an answer is no longer replaced wholesale; guardCoachResponseCore strips increase advice
  // and appends the recovery/sleep follow-up. Stating missing recovery/sleep as known is still rejected.
  if (missingAsKnown) return reject()
  if (mode === "answer" || /[？?]|多少|怎样|如何|吗/.test(joined)) return null
  const citesRpe = (brief.sources ?? []).some((source) => citations.includes(source.id) && source.kind === "FACT" && source.detail.startsWith("SESSION_RPE "))
  const unrecorded = /恢复/.test(joined) && /睡眠/.test(joined) && /未记录|没有记录|还没|尚未|缺失|没记录/.test(joined)
  const asks = /[？?]|多少|怎样|如何|请问|吗/.test(joined)
  const prescribes = joined.split(/[。；，\n]/).some((clause) => !/(?:不要|不能|不可|不得|别)/.test(clause) && /保持|减量|加量|加重|提速|增加|恢复课|恢复训练/.test(clause))
  if (citesRpe && unrecorded && asks && !prescribes) return null
  return null
}

function sorenessBoundaryFailure(brief: CoachBrief, mode: CoachTurn["mode"], text: string, nextStep: string | null, citations: string[]): CoachTurn | null {
  if (mode !== "answer" || !sorenessBoundaryRequired(brief)) return null
  const joined = `${text} ${nextStep ?? ""}`
  const reject = (message: string): CoachTurn => ({ mode: "unavailable", text: message, nextStep: null, citations: [], medicalReferral: brief.constraints.medicalReferral, planChanged: false })
  const equates = joined.split(/[。；\n]/).some((clause) => !/(?:不能|无法|并非|不是|不等于|不代表)/.test(clause) && /酸痛(?:就是|等于|说明|属于)(?:疼痛|受伤|伤病)/.test(clause))
  if (equates || unsupportedMedicalConclusion(joined)) return reject("回答把训练证据说成了确定的恢复或伤病结论，无法采用。")
  const citesSoreness = (brief.sources ?? []).some((source) => citations.includes(source.id) && source.kind === "FACT" && source.detail.startsWith("SORENESS "))
  if (citesSoreness && distinguishesSoreness(joined)) return null
  return reject("回归回答没有区分酸痛和疼痛或未引用绑定来源，不能由酸痛判断已经恢复。")
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

function guardCoachResponseCore(brief: CoachBrief, raw: string): CoachTurn {
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
  let text = parsed.text.trim().slice(0, 2400)
  let nextStep = typeof parsed.nextStep === "string" ? parsed.nextStep.trim().slice(0, 600) : null
  const conditionalCandidate=isConditionalAdvice(`${text} ${nextStep??""}`)
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
  // K13: without a selected training the model may only give general, non-personal
  // guidance. Any proposed increase or body value is replaced by the fixed prompt.
  const generalOnly = brief.mustAsk.length === 1 && brief.mustAsk[0] === "NO_TRAINING_OCCURRENCE"
  const generalUnsafe = (candidate: string) => (!isConditionalAdvice(candidate)&&mentionsProposedIncrease(candidate)) || uncitedBodyValue(brief, candidate, []) || unsupportedBodyStatement(brief, candidate, []) || unsupportedMedicalConclusion(candidate)
  if (generalOnly && generalUnsafe(`${text} ${nextStep ?? ""}`)) {
    mode = "ask"
    nextStep = null
    text = "请先选择一条有训练开始事件的记录，我才能核对这次训练。"
  } else if (generalOnly && mode !== "ask") {
    mode = "ask"
    text = `${text}（以上是一般性说明，没有结合你的训练记录。）`
  } else if (brief.mustAsk.length > 0 && mode !== "ask") {
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
  if (mode === "answer" && !conditionalCandidate && nextSessionAdviceNeedsSource(brief.nextSession, `${text} ${nextStep ?? ""}`, citations)) {
    return { mode: "unavailable", text: "下一课建议没有覆盖触发约束的训练来源，无法采用。", nextStep: null, citations: [], medicalReferral: brief.constraints.medicalReferral, planChanged: false }
  }
  if (mode === "answer" && returnAdviceNeedsBoundSource(brief, `${text} ${nextStep ?? ""}`, citations)) {
    return { mode: "unavailable", text: "回归训练边界没有引用已绑定的疼痛或酸痛来源，无法采用。", nextStep: null, citations: [], medicalReferral: brief.constraints.medicalReferral, planChanged: false }
  }
  // Missing RPE/recovery still blocks a load prescription. It must not erase a
  // source-backed pain/soreness boundary such as stopping a provoking movement
  // or keeping/reducing while current symptoms are confirmed.
  const boundedReturnAnswer = asksReturnToTraining(brief.question) && hasBoundReturnSignal(brief)
  const highRpeGap = brief.sessionRpe != null && brief.sessionRpe >= 7 && brief.sleepHours == null && brief.subjectiveRecovery == null
  let followup: string | null = null
  if (highRpeGap && !conditionalCandidate && mode === "answer" && (proposedIncrease || nextStep && !boundedReturnAnswer || highRpeRecoveryRequired(brief))) {
    // R3 (user-approved): keep the analysis, forbid any load increase, append the follow-up.
    // Strip increase ADVICE (future/prescriptive clauses); descriptive history such as "配速逐渐加快" stays.
    const advice = /下次|下一课|下一次|下周|之后|接下来|建议|可以|应该|应当|计划|安排|尝试|不妨/
    const forward = /提快|加快|提速|提高|加量|增加|多跑|多做|加一组|更快|延长|缩短(?:休息|恢复|间歇)/
    const isIncrease = (clause: string) => mentionsProposedIncrease(clause) || ((stillProposesIncrease(clause) || forward.test(clause)) && advice.test(clause))
    const kept = text.split(/(?<=[。；！？，,\n])/).filter((clause) => !isIncrease(clause)).join("").trim()
    const step = nextStep && !isIncrease(nextStep) ? nextStep.trim() : null
    // R4: a question-shaped nextStep is merged into the single follow-up instead of being shown as a "candidate".
    const isQuestion = (v: string) => /[？?]|请问|是否|吗|多少|怎样|如何/.test(v)
    const stepQuestion = step && isQuestion(step) ? step : null
    text = [kept, step && !stepQuestion ? `下一步候选（不加量）：${step}` : ""].filter(Boolean).join(" ")
    nextStep = null
    // Recovery/sleep questions are already covered; any other model question (e.g. soreness) is merged as one extra clause.
    const extraRaw = stepQuestion
      ? stepQuestion.replace(/^请问(?:您|你)?/, "").replace(/[？?。]+$/, "").replace(/(?:你|您)?(?:最近|近期)?(?:几晚|一晚)?的?(?:睡眠|主观恢复|恢复)(?:情况|感觉|状态)?(?:如何|怎样|怎么样|是多少)?(?:以及|和|、|，)?/g, "").trim()
      : ""
    const extra = /[\u4e00-\u9fa5]{3,}/.test(extraRaw.replace(/^(?:身体)?(?:如何|怎样|怎么样)$/, "")) ? extraRaw : ""
    followup = `已记录本次 RPE ${brief.sessionRpe}。在恢复情况未知前不建议增加训练量或强度；为给出下一课建议，请告诉我：你现在的主观恢复（1–10）是多少，或最近一晚睡了几小时${extra ? `；另外，${extra}` : ""}？`
  } else if (adviceGap && !conditionalCandidate && mode === "answer" && (proposedIncrease || nextStep && !boundedReturnAnswer)) {
    mode = "ask"
    text += "\n" + (brief.sessionRpe == null
      ? "要建议下一课，需要先记录本次主观强度和恢复情况。你这次训练的 RPE 是多少，恢复感觉怎样？"
      : `已记录本次 RPE ${brief.sessionRpe}。要建议下一课，还需要了解恢复情况：你现在的主观恢复（1–10）是多少，或最近一晚睡了几小时？`)
    nextStep = null
  }
  // R3: if the kept analysis fails any later check, fall back to the fixed follow-up only (the pre-R3 outcome).
  const failOrFollowup = (turn: CoachTurn): CoachTurn => followup ? { mode: "ask", text: followup, nextStep: null, citations, medicalReferral: brief.constraints.medicalReferral, planChanged: false } : turn
  // In R3 follow-up mode advice clauses were already stripped; remaining matches must also not be plain
  // descriptions of what happened (e.g. "配速从3:17逐渐加快至3:05") to count as an increase proposal.
  const descriptive = /逐渐|逐组|越来越|依次|从.{0,24}(?:加快|提高|提升|增加)|(?:加快|提高|提升|增加)(?:了|至|到)/
  const increase = followup
    ? `${text} ${nextStep ?? ""}`.split(/[。；，、\n]/).some((clause) => stillProposesIncrease(clause) && !descriptive.test(clause))
    : stillProposesIncrease(`${text} ${nextStep ?? ""}`)
  if (brief.constraints.increaseBlocked && increase && (!conditionalCandidate||brief.pain||brief.duplicateCount>0)) {
    const referral = brief.constraints.medicalReferral ? "已有疼痛记录，必要时请做运动医学或康复评估。这不是诊断。" : ""
    return failOrFollowup({ mode: "unavailable", text: `回答与已记录的安全约束冲突，无法采用。${referral}`, nextStep: null, citations: [], medicalReferral: brief.constraints.medicalReferral, planChanged: false })
  }
  if (mode === "answer" && !conditionalCandidate && brief.nextSession?.increaseSupported === false && (followup ? mentionsProposedIncrease(text) : proposedIncrease)) {
    return failOrFollowup({ mode: "unavailable", text: "当前证据只支持追问、保持、减量或恢复建议，不能据此批准增加训练。", nextStep: null, citations: [], medicalReferral: brief.constraints.medicalReferral, planChanged: false })
  }
  if (mode === "answer" && brief.occurrenceId && citations.length === 0) {
    return failOrFollowup({ mode: "unavailable", text: "回答没有可核对的事实来源，无法采用。", nextStep: null, citations: [], medicalReferral: brief.constraints.medicalReferral, planChanged: false })
  }
  if (brief.constraints.medicalReferral && !text.includes("评估")) {
    text = `${text}已有疼痛记录，必要时请做运动医学或康复评估。这不是诊断。`
  }
  text = softenUnrecordedSets(brief, text)
  if (followup) { mode = "ask"; text = text ? `${text}\n${followup}` : followup }
  if(mode==="ask"&&nextStep){
    if (!/(?:下次|下一课|增加|提高|加量|提速|加组)/.test(nextStep)) text+=`\n${nextStep}`;
    nextStep=null;
  }
  return { mode, text, nextStep, citations, medicalReferral: brief.constraints.medicalReferral, planChanged: false }
}

/** Preserve source-backed safety referral in answer, ask, and unavailable modes. */
export function guardCoachResponse(brief: CoachBrief, raw: string): CoachTurn {
  const turn=preserveReferral(guardCoachResponseCore(brief, raw), brief.constraints.medicalReferral)
  return {...turn,text:scrubInternalTerms(brief,turn.text),nextStep:turn.nextStep?scrubInternalTerms(brief,turn.nextStep):null}
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

const INTERNAL_TERMS: [RegExp, string][] = [
  [/\b(?:returnToTraining\.)?clearance\s*(?:为|是|=|:|：)?\s*UNKNOWN\b/g, "目前不能确认已经恢复"],
  [/\bincreaseSupported\s*(?:为|是|=|:|：)?\s*false\b/g, "目前证据不支持加量"],
  [/\bKEEP_OR_REDUCE_ONLY\b|\bHOLD_OR_REDUCE\b/g, "只能保持或减量"],
  [/\bKEEP_ONLY\b/g, "只能保持原计划"],
  [/\bRECOVERY_ONLY\b/g, "只安排恢复"],
  [/\bASK_FOR_RECOVERY\b/g, "需要先补充恢复情况"],
  [/\bSESSION_RPE\b/g, "主观强度"],
  [/\bSUBJECTIVE_RECOVERY\b/g, "主观恢复"],
  [/\bPAIN_RECORDED\b/g, "已记录疼痛"],
  [/\bSORENESS_RECORDED\b/g, "已记录酸痛"],
  [/\b(?:requiredSourceIds|sourceIds|occurrenceId|nextSession|returnToTraining|mustAsk|increaseBlocked|medicalReferral)\b/g, "相关记录"],
  [/\bUNKNOWN\b/g, "未知"],
]

export function scrubInternalTerms(brief: Pick<CoachBrief, "sourceIds">, text: string): string {
  let out = text
  for (const [pattern, replacement] of INTERNAL_TERMS) out = out.replace(pattern, replacement)
  for (const id of [...brief.sourceIds].sort((a, b) => b.length - a.length)) {
    if (id.length < 4) continue
    out = out.split(`（${id}）`).join("").split(`(${id})`).join("").split(`[${id}]`).join("").split(id).join("该记录")
  }
  return out.replace(/该记录(?:[、，,]\s*该记录)+/g, "相关记录").replace(/\s{2,}/g, " ").trim()
}

