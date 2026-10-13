/** Quick "tick what you did" log for today's session. Local, auto-saved, prefilled from the plan. */
export type SetLog = { done: boolean; reps: number; kg: number }
export type StateTag = "normal" | "tired" | "short" | "pain"
export type ChecklistState = {
  date: string; sessionId: string
  moves: Record<string, SetLog[]>
  run: { done: boolean; km: number | null; pace: string } | null
  rpe: number | null; state: StateTag | null
  startedAt: number | null; restEndsAt: number | null
  updatedAt: number
}
export type PlanMoveLite = { id: string; sets: number; amount: number; weightKg: number }
export const CHECKLIST_KEY = "fk-today-checklist-v1"
export const STATE_LABELS: Record<StateTag, string> = { normal: "状态正常", tired: "状态差", short: "时间不够", pain: "有疼痛" }

export function initChecklist(date: string, sessionId: string, moves: PlanMoveLite[], hasRun: boolean): ChecklistState {
  return {
    date, sessionId,
    moves: Object.fromEntries(moves.map((m) => [m.id, Array.from({ length: Math.max(1, m.sets) }, () => ({ done: false, reps: m.amount, kg: m.weightKg }))])),
    run: hasRun ? { done: false, km: null, pace: "" } : null,
    rpe: null, state: null, startedAt: null, restEndsAt: null, updatedAt: 0,
  }
}
/** Keep logged values when the plan changed (added/removed moves or sets). */
export function reconcile(saved: ChecklistState | null, fresh: ChecklistState): ChecklistState {
  if (!saved || saved.date !== fresh.date || saved.sessionId !== fresh.sessionId) return fresh
  const moves: ChecklistState["moves"] = {}
  for (const [id, sets] of Object.entries(fresh.moves)) moves[id] = sets.map((s, i) => saved.moves[id]?.[i] ?? s)
  return { ...saved, moves, run: fresh.run ? saved.run ?? fresh.run : null }
}
export function toggleSet(s: ChecklistState, moveId: string, index: number, now: number, restSec: number): ChecklistState {
  const sets = (s.moves[moveId] ?? []).map((x, i) => i === index ? { ...x, done: !x.done } : x)
  const nowDone = sets[index]?.done
  return { ...s, moves: { ...s.moves, [moveId]: sets }, startedAt: s.startedAt ?? now, restEndsAt: nowDone && restSec > 0 ? now + restSec * 1000 : s.restEndsAt, updatedAt: now }
}
export function toggleMove(s: ChecklistState, moveId: string, now: number): ChecklistState {
  const sets = s.moves[moveId] ?? []
  const all = sets.every((x) => x.done)
  return { ...s, moves: { ...s.moves, [moveId]: sets.map((x) => ({ ...x, done: !all })) }, startedAt: s.startedAt ?? now, updatedAt: now }
}
export function editSet(s: ChecklistState, moveId: string, index: number, patch: Partial<SetLog>, now: number): ChecklistState {
  return { ...s, moves: { ...s.moves, [moveId]: (s.moves[moveId] ?? []).map((x, i) => i === index ? { ...x, ...patch } : x) }, updatedAt: now }
}
export function progress(s: ChecklistState): { done: number; total: number } {
  const sets = Object.values(s.moves).flat()
  const run = s.run ? 1 : 0
  return { done: sets.filter((x) => x.done).length + (s.run?.done ? 1 : 0), total: sets.length + run }
}
export function loadChecklist(storage: Pick<Storage, "getItem"> | null, date: string): ChecklistState | null {
  try { const all = JSON.parse(storage?.getItem(CHECKLIST_KEY) ?? "{}"); return all?.[date] ?? null } catch { return null }
}
export function saveChecklist(storage: Pick<Storage, "getItem" | "setItem"> | null, s: ChecklistState): boolean {
  if (!storage) return false
  try {
    const all = JSON.parse(storage.getItem(CHECKLIST_KEY) ?? "{}") as Record<string, ChecklistState>
    all[s.date] = s
    const keep = Object.keys(all).sort().slice(-60)
    storage.setItem(CHECKLIST_KEY, JSON.stringify(Object.fromEntries(keep.map((k) => [k, all[k]]))))
    return true
  } catch { return false }
}
