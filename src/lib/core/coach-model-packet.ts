import type { CoachBrief } from "./coach-brief.ts"

export type CoachQuestionIntent = "RETURN" | "NEXT_SESSION" | "FUEL" | "RUNNING" | "SERIES" | "COMPARE" | "GENERAL"

export function coachQuestionIntent(question: string): CoachQuestionIntent {
  if (/(?:分阶段|逐步).{0,8}(?:恢复|回归)|(?:恢复|回归|回到|重新开始|重返).{0,8}(?:训练|跑步|力量)|(?:疼痛|酸痛|伤后|受伤后).{0,12}(?:怎么练|如何练|能练|训练)/.test(question)) return "RETURN"
  if (/(?:最近|过去|连续).{0,8}(?:三|四|五|六|3|4|5|6).{0,6}(?:次|节)|纵向|趋势/.test(question)) return "SERIES"
  if (/(?:两|2).{0,4}(?:次|节).{0,8}(?:比较|对比)|(?:比较|对比).{0,8}(?:两|2).{0,4}(?:次|节)|哪次.{0,8}(?:更快|更慢)|谁更快/.test(question)) return "COMPARE"
  if (/(?:下一课|下一次训练|下次训练|接下来).{0,18}(?:怎么|如何|安排|调整|加|减|保持)|(?:加量|加组|提速|减量).{0,10}(?:吗|么|是否|可不可以)/.test(question)) return "NEXT_SESSION"
  if (/(?:热量|千卡|饮食|摄入|吃了|吃得|吃少|没吃够|能量不足)/.test(question)) return "FUEL"
  if (/(?:间歇|重复跑|连续跑|配速|用时|秒|恢复时间|完成情况|实际表现|掉速)/.test(question)) return "RUNNING"
  return "GENERAL"
}

function selectedSources(brief: CoachBrief, intent: CoachQuestionIntent) {
  const wanted = new Set<string>((brief.sources??[]).filter(s=>s.kind==="CONTEXT"&&s.id.startsWith("linked:")).map(s=>s.id))
  if (brief.occurrenceId) wanted.add(brief.occurrenceId)
  if (brief.appData) wanted.add(brief.appData.sourceId)
  if (intent === "RETURN" || intent === "NEXT_SESSION") {
    for (const id of brief.returnToTraining?.sourceIds ?? []) wanted.add(id)
    for (const id of brief.nextSession?.sourceIds ?? []) wanted.add(id)
    for (const id of brief.nextSession?.requiredSourceIds ?? []) wanted.add(id)
  }
  if (intent === "FUEL") {
    if (brief.fuel?.logSourceId) wanted.add(brief.fuel.logSourceId)
    if (brief.fuel?.targetSourceId) wanted.add(brief.fuel.targetSourceId)
  }
  for (const id of brief.nextSession?.requiredSourceIds ?? []) wanted.add(id)
  if (intent === "RUNNING" || intent === "NEXT_SESSION") {
    for (const slot of brief.running ?? []) for (const id of slot.sourceEventIds) wanted.add(id)
  }
  if (intent === "SERIES" || intent === "COMPARE" || intent === "GENERAL") return brief.sources ?? []
  return (brief.sources ?? []).filter((source) => wanted.has(source.id))
}

export function compactSingleCoachPacket(
  brief: CoachBrief,
  history: { role: "user" | "coach"; text: string }[],
  candidates: { id: string; startedAt: string; running: "INTERVAL" | "OTHER" | "UNAVAILABLE" }[],
) {
  const intent = coachQuestionIntent(brief.question)
  if (intent === "GENERAL") return { intent, history, current: brief, candidates }
  const sources = selectedSources(brief, intent)
  const common = {
    question: brief.question,
    ...(brief.appData?{appData:brief.appData}:{}),
    occurrenceId: brief.occurrenceId,
    runningStructure: brief.runningStructure,
    sessionRpe: brief.sessionRpe,
    sleepHours: brief.sleepHours,
    subjectiveRecovery: brief.subjectiveRecovery ?? null,
    recoveryState: brief.recoveryState,
    duplicateCount: brief.duplicateCount,
    pain: brief.pain,
    soreness: brief.soreness ?? false,
    musculoskeletalState: brief.musculoskeletalState ?? null,
    daysToCompetition: brief.daysToCompetition,
    week: brief.week,
    bias: brief.bias,
    constraints: brief.constraints,
    mustAsk: brief.mustAsk,
    sourceIds: sources.map((source) => source.id),
    sources,
  }
  const current = intent === "RETURN"
    ? { ...common, returnToTraining: brief.returnToTraining }
    : intent === "NEXT_SESSION"
      ? { ...common, running:brief.running, runningTruncated:brief.runningTruncated??false, nextSession: brief.nextSession, returnToTraining: brief.returnToTraining }
      : intent === "FUEL"
        ? { ...common, fuel: brief.fuel }
        : intent === "RUNNING"
          ? { ...common, plannedSetCount: brief.plannedSetCount, completedSetCount: brief.completedSetCount, durationSec: brief.durationSec, running: brief.running, runningTruncated: brief.runningTruncated ?? false }
          : common
  return { intent, history, current, candidates }
}
