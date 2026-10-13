/** 方坤日程：跑步、力量、方坤安排统一放进同一份按天排期（单一数据源）。 */
import { exerciseById } from "@/lib/strength/catalog"
import { estimateMinutes, type Session } from "@/lib/strength/model"
import type { RunningPlan } from "@/lib/core/running-plan"
import { describeTrackPlan } from "@/lib/ui/running-workouts"
import { readJournal } from "@/lib/core/storage-journal"
import { INTAKE_PREFIX, type FirstWeekDraft } from "@/lib/core/coach-first-week"
import { loadCoachPlanCandidates } from "@/lib/core/coach-plan"
import { loadVitals } from "@/lib/nutrition/vitals"
import { loadExtras } from "@/lib/ui/device-store"
import { applyFeedbackToProposal } from "@/lib/ui/coach-assessment"
import { loadSettings } from "@/lib/ui/app-settings"
import { loadFeedback } from "@/lib/ui/assessment-store"
import { adaptProposal, adaptation, addDays, weekOf, type Recovery, type ScheduleEntry } from "@/lib/ui/day-schedule-rules"

export const SCHEDULE_KEY = "fk-schedule-v1"
export type ScheduleStore = { entries: ScheduleEntry[]; acks: string[] }
export function loadSchedule(): ScheduleStore {
  try { const v = JSON.parse(localStorage.getItem(SCHEDULE_KEY) ?? "null"); if (v && Array.isArray(v.entries)) return { entries: v.entries, acks: Array.isArray(v.acks) ? v.acks : [] } } catch { /* fallthrough */ }
  return { entries: [], acks: [] }
}
export function saveSchedule(s: ScheduleStore): boolean {
  try { localStorage.setItem(SCHEDULE_KEY, JSON.stringify({ entries: s.entries.slice(-400), acks: s.acks.slice(-200) })); return true } catch { return false }
}

const LOWER = new Set(["腿", "臀"]), UPPER = new Set(["胸", "背", "肩", "手臂"])
export function classifyStrength(session: Session): Pick<ScheduleEntry, "focus" | "lowerHeavy" | "intensity" | "minutes"> {
  const groups = session.moves.map((m) => (m.catalogId ? exerciseById(m.catalogId)?.group : undefined) ?? (/蹲|腿|臀|硬拉|弓步|提踵/.test(m.customName) ? "腿" : /核心|平板|卷腹|死虫/.test(m.customName) ? "核心" : "全身"))
  const focus: string[] = []
  if (groups.some((g) => g === "核心")) focus.push("核心")
  if (groups.some((g) => LOWER.has(g))) focus.push("下肢")
  if (groups.some((g) => UPPER.has(g))) focus.push("上肢")
  if (groups.some((g) => g === "全身")) focus.push("全身")
  // 【经验规则】下肢动作负重 ≥20kg 且 ≤8 次/组 视为“大重量下肢”
  const lowerHeavy = session.moves.some((m, i) => LOWER.has(groups[i] ?? "") && m.weightKg >= 20 && m.mode === "reps" && m.amount <= 8)
  return { focus, lowerHeavy, intensity: lowerHeavy ? "HARD" : "MODERATE", minutes: estimateMinutes(session) }
}
export function classifyRun(plan: RunningPlan): Pick<ScheduleEntry, "title" | "intensity" | "minutes" | "focus"> {
  const runs = plan.components.filter((c) => c.modality === "RUNNING")
  const hard = runs.some((c) => c.modality === "RUNNING" && (c.structure.kind === "REPEATED" || ["TEMPO_THRESHOLD", "INTERVAL", "REPETITION_SPEED", "HILL", "RACE"].includes(c.purpose)))
  let secs = 0
  for (const c of runs) if (c.modality === "RUNNING") {
    if (c.structure.kind === "CONTINUOUS") secs += c.structure.plannedDurationSeconds ?? ((c.structure.plannedDistanceMeters ?? 5000) / 1000) * 360
    else for (const b of c.structure.blocks) for (const s of b.steps) secs += b.roundCount * s.repeatCount * ((s.plannedDurationSeconds ?? ((s.plannedDistanceMeters ?? 400) / 1000) * 270) + (s.recoveryAfterRepeatSeconds ?? 60))
  }
  const long = runs.some((c) => c.modality === "RUNNING" && c.purpose === "LONG")
  let title = "跑步课"; try { title = describeTrackPlan(plan).split(/[。\n]/)[0].slice(0, 30) || title } catch { /* keep */ }
  return { title, intensity: hard ? "HARD" : long ? "MODERATE" : "EASY", minutes: Math.max(15, Math.round(secs / 60) + (hard ? 20 : 0)), focus: [hard ? "强度" : long ? "长距离" : "轻松"] }
}
export function strengthEntry(session: Session, date: string, source: ScheduleEntry["source"]): ScheduleEntry {
  const c = classifyStrength(session)
  return { id: `str:${session.id}:${date}:${Math.random().toString(36).slice(2, 6)}`, date, kind: "strength", modality: "strength", title: `力量课 · ${c.focus.join("+") || session.name}`, ...c, source, refId: session.id, status: "planned" }
}
export function runEntry(plan: RunningPlan, date: string, source: ScheduleEntry["source"]): ScheduleEntry {
  const c = classifyRun(plan)
  return { id: `run:${plan.planId}:${date}:${Math.random().toString(36).slice(2, 6)}`, date, kind: "run", modality: "run", ...c, lowerHeavy: false, source, refId: plan.planId, status: "planned" }
}

/** 把已接受的方坤计划同步进排期（幂等）。 */
export function fangkunSessions(): ScheduleEntry[] {
  const out: ScheduleEntry[] = []
  const choices = readJournal<{ kind: string; value: { choice?: string; draft?: FirstWeekDraft } }>(INTAKE_PREFIX).map((x) => x.data).filter((r) => (r.kind === "CHOICE" || r.kind === "EDIT") && r.value?.draft && r.value.choice !== "REJECT")
  const draft = choices.at(-1)?.value.draft
  for (const s of draft?.sessions ?? []) {
    if (s.kind === "REST") continue
    out.push({ id: `fk:${draft!.id}:${s.id}`, date: s.date, kind: "coach", modality: "run", title: `方坤安排 · ${s.purpose}`.slice(0, 32), focus: [s.kind === "FAMILIAR_REPETITION" ? "重复跑" : "基础有氧"], minutes: s.estimatedMinutes, intensity: s.kind === "FAMILIAR_REPETITION" ? "HARD" : "EASY", lowerHeavy: false, source: "fangkun", refId: s.id, status: "proposed" })
  }
  for (const cand of loadCoachPlanCandidates().filter((c) => c.status === "ACCEPTED" || c.status === "MODIFIED")) {
    const start = weekOf(cand.createdAt.slice(0, 10))[0]
    for (const s of cand.candidate.firstWeek) {
      if (s.type === "REST") continue
      const isStr = s.type === "STRENGTH"
      out.push({ id: `fkc:${cand.candidateId}:${s.day}:${s.type}`, date: addDays(start, Math.max(0, s.day - 1)), kind: "coach", modality: isStr ? "strength" : "run", title: `方坤安排 · ${s.title}`.slice(0, 32), focus: [isStr ? "力量" : s.type === "QUALITY_RUN" ? "强度" : s.type === "LONG_RUN" ? "长距离" : "轻松"], minutes: s.durationMinutes ?? 40, intensity: s.intensity === "NONE" ? "EASY" : s.intensity, lowerHeavy: false, source: "fangkun", refId: cand.candidateId, status: "proposed" })
    }
  }
  return out
}
export function syncFangkun(store: ScheduleStore): ScheduleStore {
  const have = new Set(store.entries.map((e) => e.id.replace(/@.*$/, "")))
  const now = new Date(); const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
  const a = adaptation(store.entries, today)
  const add = fangkunSessions().filter((e) => !have.has(e.id) && e.date >= today).map((e) => (loadSettings().personalize ? applyFeedbackToProposal(adaptProposal(e, a), loadFeedback()) : e))
  return add.length ? { ...store, entries: [...store.entries, ...add] } : store
}

export function readRecovery(today: string): Recovery | null {
  const v = loadVitals().records
  const ex = loadExtras()
  const series = (k: string) => v.filter((r) => r.kind === k).sort((a, b) => a.observedOn.localeCompare(b.observedOn))
  const sleep = series("SLEEP"), hrv = series("HRV")
  const readiness = ex.filter((e) => e.metric === "READINESS" && e.day === today).at(-1)?.value ?? null
  const hrvToday = hrv.find((r) => r.observedOn === today)?.value ?? null
  const hrvPrev = hrv.filter((r) => r.observedOn < today).slice(-7)
  const sleepPrev = sleep.filter((r) => r.observedOn < addDays(today, -1)).slice(-14)
  const r: Recovery = {
    readiness, hrvToday, hrvBaseline: hrvPrev.length >= 3 ? hrvPrev.reduce((s, x) => s + x.value, 0) / hrvPrev.length : null,
    sleepRecent: sleep.filter((x) => x.observedOn >= addDays(today, -1)).map((x) => x.value), sleepBaseline: sleepPrev.length >= 5 ? sleepPrev.reduce((s, x) => s + x.value, 0) / sleepPrev.length : null,
  }
  return r.readiness == null && r.hrvToday == null && !r.sleepRecent.length ? null : r
}

/**
 * 方坤按本周空档，用用户已保存的课生成建议（status=proposed，需用户审核）。
 * 摆放遵循手册：强度跑每周 ≤2 次、间隔 ≥48h；力量课优先放在强度跑同一天（先跑后练），避免放在强度跑前一天。
 */
export function proposeWeek(store: ScheduleStore, week: string[], today: string, sessions: Session[], runPlans: RunningPlan[]): ScheduleStore {
  const busy = new Set(store.entries.filter((e) => e.status !== "rejected").map((e) => e.date))
  const a = adaptation(store.entries, today)
  const free = (i: number) => week[i] >= today && !busy.has(week[i])
  const out: ScheduleEntry[] = []
  const runs = runPlans.map((r) => ({ r, c: classifyRun(r) }))
  const hard = runs.filter((x) => x.c.intensity === "HARD").slice(0, 2), easy = runs.filter((x) => x.c.intensity !== "HARD")
  const hardDays = [1, 4].filter(free)
  hard.forEach((x, i) => { if (hardDays[i] != null) { out.push({ ...runEntry(x.r, week[hardDays[i]], "fangkun"), status: "proposed", kind: "coach" }); busy.add(week[hardDays[i]]) } })
  if (easy[0] && free(5)) { out.push({ ...runEntry(easy[0].r, week[5], "fangkun"), status: "proposed", kind: "coach" }); busy.add(week[5]) }
  const strengthDays = [...hardDays.slice(0, hard.length), 3, 0, 6].filter((i, k, arr) => arr.indexOf(i) === k && week[i] >= today && (!busy.has(week[i]) || hardDays.includes(i)))
  sessions.slice(0, 2).forEach((sess, i) => { const d = strengthDays[i]; if (d != null) out.push({ ...strengthEntry(sess, week[d], "fangkun"), status: "proposed", kind: "coach" }) })
  return { ...store, entries: [...store.entries, ...out.map((e) => (loadSettings().personalize ? applyFeedbackToProposal(adaptProposal(e, a), loadFeedback()) : e))] }
}

/** 当天已确认（接受/自定/已完成）的课，供饮食建议用；待确认的建议不算。 */
export function confirmedSessionsOn(date: string): { title: string; modality: "run" | "strength" | "rest"; minutes: number; intensity: "EASY" | "MODERATE" | "HARD" }[] {
  return loadSchedule().entries.filter((e) => e.date === date && (e.status === "planned" || e.status === "done")).map((e) => ({ title: e.title, modality: e.modality, minutes: e.actual?.minutes ?? e.minutes, intensity: e.actual?.intensity ?? e.intensity }))
}
