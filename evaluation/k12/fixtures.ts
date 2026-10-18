/** Builds synthetic CoachParts using the exact source-detail formats of assembleCoachBrief. Synthetic data only. */
import { strengthSetDetail, type CoachBrief, type CoachParts } from "@/lib/core/coach-brief"

type Running = { kind: "REPETITION" | "CONTINUOUS" | "RECOVERY"; position: string; status: string; planned: string; actual: string; id: string }
export type FactSpec = {
  occurrence?: { id: string; startedAt: string; lifecycle?: string } | null
  rpe?: number; sleep?: number; recovery?: number | number[]
  pain?: { location: string; intensity: number }
  soreness?: { location: string; intensity: number }
  sets?: { planned: number | null; completed: number | null }
  durationSec?: number
  running?: Running[]
  availability?: { fatigue: string; recovery: string; musculoskeletal: string }
  daysToCompetition?: number
  week?: 1 | 2 | 3 | 4
  bias?: "build" | "hold" | "deload"
  contextPain?: boolean
  fuel?: { entries: number[]; target: number | null }
}

const label: Record<string, string> = { SESSION_RPE: "本次主观强度", SUBJECTIVE_RECOVERY: "本次主观恢复", SLEEP: "睡眠", PAIN: "疼痛", SORENESS: "酸痛" }
function ev(type: string, value: number | null, location?: string) {
  const v = value == null ? "未记录程度" : `${value}${type === "SLEEP" ? "小时" : "/10"}`
  return `${type} ${label[type]}：${v}${location ? `；部位 ${location}` : ""}；已绑定本次训练的记录，不能单独作为恢复或伤病诊断`
}

export function buildParts(question: string, f: FactSpec): CoachParts {
  const occ = f.occurrence ?? null
  const id = occ?.id ?? null
  const sources: NonNullable<CoachBrief["sources"]> = []
  if (occ) sources.push({ id: occ.id, kind: "FACT", detail: `训练开始；${occ.startedAt}；${occ.lifecycle ?? "COMPLETED"}` })
  if (occ && f.sets) sources.push({ id: `plan-snap:${occ.id}`, kind: "FACT", detail: strengthSetDetail(f.sets.planned, f.sets.completed) })
  let fuel: CoachBrief["fuel"] = null
  if (occ && f.fuel) {
    const day = occ.startedAt.slice(0, 10)
    const entries = f.fuel.entries.map((kcal, i) => ({ id: `food-${day}-${i + 1}`, kcal }))
    const recorded = entries.length ? Math.round(entries.reduce((s, e) => s + e.kcal, 0)) : null
    fuel = { trainingDay: day, todayDay: day, targetKcal: f.fuel.target, entries, recordedKcal: recorded, status: entries.length ? "SAME_DAY_RECORDED" : "NO_RECORD", logSourceId: entries.length ? `nutrition:log:${day}` : null, targetSourceId: f.fuel.target != null ? `context:fuel-target:${day}` : null }
    if (fuel.logSourceId) sources.push({ id: fuel.logSourceId, kind: "DERIVED", detail: `${day} 已记录摄入 ${recorded} 千卡，来自 ${entries.length} 条本地饮食记录；未确认全天记录完整，不能推断实际摄入不足` })
    if (fuel.targetSourceId) sources.push({ id: fuel.targetSourceId, kind: "CONTEXT", detail: `${day} 热量目标 ${f.fuel.target} 千卡；来自个人目标与当日记录，不是实际摄入事实` })
  }
  const recoveries = f.recovery == null ? [] : Array.isArray(f.recovery) ? f.recovery : [f.recovery]
  if (occ) {
    if (f.rpe != null) sources.push({ id: `ev:${id}:rpe`, kind: "FACT", detail: ev("SESSION_RPE", f.rpe) })
    if (f.sleep != null) sources.push({ id: `ev:${id}:sleep`, kind: "FACT", detail: ev("SLEEP", f.sleep) })
    recoveries.forEach((value, i) => sources.push({ id: `ev:${id}:recovery-${i + 1}`, kind: "FACT", detail: ev("SUBJECTIVE_RECOVERY", value) }))
    if (f.pain) sources.push({ id: `ev:${id}:pain`, kind: "FACT", detail: ev("PAIN", f.pain.intensity, f.pain.location) })
    if (f.soreness) sources.push({ id: `ev:${id}:soreness`, kind: "FACT", detail: ev("SORENESS", f.soreness.intensity, f.soreness.location) })
  }
  const running = occ ? (f.running ?? []) : []
  for (const slot of running) sources.push({ id: slot.id, kind: "FACT", detail: `${slot.kind} ${slot.position}：${slot.status}；实际 ${slot.actual}` })
  if (occ && f.availability) for (const d of ["fatigue", "recovery", "musculoskeletal"] as const) sources.push({ id: `${id}:${d}`, kind: "DERIVED", detail: `${d} 证据状态 ${f.availability[d]}；结论 UNKNOWN` })
  if (f.daysToCompetition != null) sources.push({ id: "context:competition", kind: "CONTEXT", detail: `距比赛 ${f.daysToCompetition} 天；来自当前目标，非本次训练事件` })
  if (f.week != null || f.bias) sources.push({ id: "context:cycle", kind: "CONTEXT", detail: `第 ${f.week ?? "?"} 周，${f.bias ?? "未记录"}；来自当前计划` })
  if (f.contextPain) sources.push({ id: "context:pain", kind: "CONTEXT", detail: "近期教练笔记或周期日志提及疼痛；未绑定为本次训练疼痛事实" })
  const dup = (recoveries.length > 1 ? 1 : 0) + running.filter((s) => s.status === "DUPLICATE_UNRESOLVED").length
  return {
    question: question.slice(0, 200),
    occurrenceId: id,
    runningStructure: running.some((s) => s.kind === "REPETITION") ? "AVAILABLE" : "UNAVAILABLE",
    sessionRpe: occ ? f.rpe ?? null : null,
    sleepHours: occ ? f.sleep ?? null : null,
    subjectiveRecovery: recoveries.length === 1 ? recoveries[0] : null,
    recoveryState: f.availability?.recovery ?? null,
    fatigueState: f.availability?.fatigue ?? null,
    duplicateCount: dup,
    repetitionSlots: running.filter((s) => s.kind === "REPETITION").length,
    continuousCount: running.filter((s) => s.kind === "CONTINUOUS").length,
    plannedSetCount: f.sets?.planned ?? null,
    completedSetCount: f.sets?.completed ?? null,
    durationSec: f.durationSec ?? null,
    pain: Boolean(f.contextPain) || Boolean(occ && f.pain),
    soreness: Boolean(occ && f.soreness),
    musculoskeletalState: (f.availability?.musculoskeletal as CoachBrief["musculoskeletalState"]) ?? null,
    daysToCompetition: f.daysToCompetition ?? null,
    week: f.week ?? null,
    bias: f.bias ?? null,
    sourceIds: [...new Set(sources.map((s) => s.id))],
    sources,
    running: running.map(({ id: sid, ...rest }) => ({ ...rest, sourceEventIds: [sid] })),
    runningTruncated: false,
    fuel,
  }
}
