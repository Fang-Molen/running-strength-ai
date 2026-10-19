import { loadSchedule, saveSchedule } from "@/lib/ui/day-schedule"
import { logActual, type ScheduleEntry } from "@/lib/ui/day-schedule-rules"
import { syncActualToLog } from "@/lib/ui/checklist-log"
import type { Plan } from "@/lib/strength/model"
export { unmarkedEntries } from "@/lib/ui/unmarked"
const SRC: Record<string, string> = { custom: "自定", fangkun: "方坤" }
export function UnmarkedPlans({ items, plan, onChanged }: { items: ScheduleEntry[]; plan: Plan; onChanged: () => void }) {
  if (!items.length) return null
  const mark = (e: ScheduleEntry, outcome: "as_planned" | "missed") => {
    const store = loadSchedule(), next = logActual(store.entries, e.id, { outcome, minutes: null, intensity: null, note: "", reasons: [] })
    if (!saveSchedule({ ...store, entries: next })) return
    const saved = next.find(x => x.id === e.id); if (saved) syncActualToLog(saved, e.modality === "strength" ? plan.sessions.find(s => s.id === e.refId) : undefined)
    onChanged()
  }
  return <section className="home-card mt-3 px-3 py-2" aria-label="还没标记的课" data-testid="unmarked-plans">
    <h3 className="keep pt-1 text-sm font-bold">还没标记的课 · {items.length} 节</h3>
    <p className="keep text-xs text-muted">这些课排在日程里但没有标记，不算训练记录。练了就点“按计划完成”。</p>
    <ul className="divide-y divide-line">{items.map(e => <li key={e.id} className="py-2">
      <p className="keep text-sm"><b>{e.title}</b> <span className="text-xs text-muted">{e.date.slice(5)} · {e.minutes ? `${e.minutes} 分钟 · ` : ""}{SRC[e.source] ?? "计划"}</span></p>
      <div className="mt-1 flex gap-2"><button type="button" className="fk-chip min-h-10" onClick={() => mark(e, "as_planned")}>按计划完成</button><button type="button" className="fk-chip min-h-10" onClick={() => mark(e, "missed")}>没练</button><button type="button" className="fk-chip min-h-10" onClick={() => window.dispatchEvent(new CustomEvent("fk-open-scheduled", { detail: e.id }))}>补记细节</button></div>
    </li>)}</ul>
  </section>
}
