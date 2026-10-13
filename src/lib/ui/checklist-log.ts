import { confirmTrainingImport, createTrainingImportDraft, loadConfirmedTrainingImports, permanentlyDeleteConfirmedTrainingImport } from "@/lib/core/training-import"
import { checklistCandidate, type ChecklistState } from "@/lib/ui/today-checklist"

/** 把今日清单写进训练日志（已确认导入记录）。同一节课只保留一条，内容变化就替换。 */
export function syncChecklistToLog(s: ChecklistState, title: string, names: Record<string, string>): { ok: boolean; reason?: string } {
  const draftId = `chk-${s.date}-${s.sessionId}`.replace(/[^0-9A-Za-z-]/g, "").slice(0, 55)
  const existing = loadConfirmedTrainingImports().find((x) => x.draftId === draftId)
  const cand = checklistCandidate(s, title, names)
  if (existing) permanentlyDeleteConfirmedTrainingImport(existing.confirmedImportId)
  if (!cand) return { ok: true }
  const draft = createTrainingImportDraft(cand, "TEXT", ["user-confirmed"])
  draft.draftId = draftId
  const r = confirmTrainingImport(draft)
  return r.ok ? { ok: true } : { ok: false, reason: r.reason }
}

import type { ScheduleEntry } from "@/lib/ui/day-schedule-rules"
import type { Session } from "@/lib/strength/model"
import { displayName } from "@/lib/strength/model"
/** 把“按计划完成 / 实际不同”写进训练日志。逐组细节以清单为准；这里只补没打勾时的记录。 */
export function syncActualToLog(e: ScheduleEntry, session: Session | undefined): { ok: boolean; reason?: string } {
  const a = e.actual
  const draftId = `act-${e.id}`.replace(/[^0-9A-Za-z-]/g, "").slice(0, 55)
  const existing = loadConfirmedTrainingImports().find((x) => x.draftId === draftId)
  if (existing) permanentlyDeleteConfirmedTrainingImport(existing.confirmedImportId)
  if (!a || a.outcome === "missed") return { ok: true }
  const f = <T,>(v: T | null) => v == null ? { value: null, status: "ABSENT", sourceIds: [] } : { value: v, status: "RECORDED", sourceIds: ["user-confirmed"] }
  const strengthSets = e.modality === "strength" && a.outcome === "as_planned" && session ? session.moves.flatMap((m) => Array.from({ length: m.sets }, (_, i) => ({ m, i }))).slice(0, 80).map(({ m, i }, n) => ({ id: `p${n + 1}`, exerciseName: f(displayName(m)), setOrdinal: f(i + 1), weightKg: f(m.weightKg || null), repetitions: f(m.mode === "reps" ? m.amount : null), durationSeconds: f(m.mode === "seconds" ? m.amount : null), recoverySeconds: f(null), completion: "COMPLETED" })) : []
  if (e.modality === "strength" && !strengthSets.length) return { ok: true, reason: "力量课的不同之处请在逐组清单里打勾，才会进日志" }
  const reasons = a.reasons.map((r) => ({ tired: "状态差", short: "时间不够", pain: "有疼痛", weather: "天气", other: "其他" })[r])
  const draft = createTrainingImportDraft({
    sport: e.modality === "run" ? "RUNNING" : "STRENGTH", occurredAt: f(a.at.replace(/\.\d+Z$/, "Z")), title: f(`${e.title}${a.outcome === "different" ? " · 实际不同" : " · 按计划"}`.slice(0, 120)),
    durationSeconds: f(a.minutes ? a.minutes * 60 : null), totalDistanceMeters: f(null), runningStructure: e.modality === "run" ? "CONTINUOUS" : "UNAVAILABLE", runningSegments: [], strengthSets,
    sessionRpe: f(null), subjectiveRecovery: f(null), sleepHours: f(null), pain: f(a.reasons.includes("pain") ? { location: "未说明部位", intensity: null } : null), soreness: f(null),
    uncertainFields: [], conflicts: [], warnings: [reasons.length ? `偏差原因：${reasons.join("、")}（状态/时间类只说明当天状态）` : "", a.note ? `备注：${a.note.slice(0, 60)}` : "", `计划 ${e.minutes} 分钟 · ${e.intensity}`].filter(Boolean),
  }, "TEXT", ["user-confirmed"])
  draft.draftId = draftId
  const r = confirmTrainingImport(draft)
  return r.ok ? { ok: true } : { ok: false, reason: r.reason }
}
