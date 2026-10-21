import { stampCN, fmtDurationPrecise } from "@/lib/ui/activity-format";
import { loadSchedule, saveSchedule } from "@/lib/ui/day-schedule"
import { logActual, type ScheduleEntry } from "@/lib/ui/day-schedule-rules"
import { syncActualToLog } from "@/lib/ui/checklist-log"
import type { Plan } from "@/lib/strength/model"
import { saveRunLink } from "@/lib/ui/run-link"
import type { ActivityRow } from "@/lib/ui/training-read-model"
export { unmarkedEntries } from "@/lib/ui/unmarked"
const SRC: Record<string, string> = { custom: "自定", fangkun: "方坤" }
export function UnmarkedPlans({ items, plan, onChanged, suggestions = [] }: { items: ScheduleEntry[]; plan: Plan; onChanged: () => void; suggestions?: { entry: ScheduleEntry; runs: ActivityRow[] }[] }) {
  if (!items.length) return null
  const mark = (e: ScheduleEntry, outcome: "as_planned" | "missed") => {
    const store = loadSchedule(), next = logActual(store.entries, e.id, { outcome, minutes: null, intensity: null, note: "", reasons: [] })
    if (!saveSchedule({ ...store, entries: next }, 'unmarked-plans')) return
    const saved = next.find(x => x.id === e.id); if (saved) syncActualToLog(saved, e.modality === "strength" ? plan.sessions.find(s => s.id === e.refId) : undefined)
    onChanged()
  }
  return <section className="home-card mt-3 px-3 py-2" aria-label="还没标记的课" data-testid="unmarked-plans">
    <h3 className="keep pt-1 text-sm font-bold">还没标记的课 · {items.length} 节</h3>
    <p className="keep text-xs text-muted">这些课排在日程里，但没有完成也没有反馈（未反馈），不算训练记录、不计入统计。练了就点“按计划完成”，没练点“没练”。</p>
    <ul className="divide-y divide-line">{items.map(e => <li key={e.id} className="py-2">
      <p className="keep text-sm"><b>{e.title}</b> <span className="text-xs text-muted">{e.date.slice(5)} · {e.minutes ? `${e.minutes} 分钟 · ` : ""}{SRC[e.source] ?? "计划"} · <b className="text-amber-800">未完成·未反馈</b></span></p>
      {(suggestions.find(x => x.entry.id === e.id)?.runs ?? []).map(r => <p key={r.id} className="keep mt-1 text-xs" data-testid="run-suggest">是这次吗？<b>{r.date.slice(5)} {stampCN(r.startedAt, "hm")} 佳明 {r.distanceM != null ? (r.distanceM / 1000).toFixed(2) + " km" : ""}{r.durationSec ? ` · 用时 ${fmtDurationPrecise(r.durationSec)}` : ""}</b>
        <button type="button" className="fk-chip ml-2 min-h-9" onClick={() => saveRunLink(e.id, { garminId: r.id, by: "user" })}>是，关联</button></p>)}
      <div className="mt-1 flex gap-2"><button type="button" className="fk-chip min-h-10" onClick={() => mark(e, "as_planned")}>按计划完成</button><button type="button" className="fk-chip min-h-10" onClick={() => mark(e, "missed")}>没练</button><button type="button" className="fk-chip min-h-10" onClick={() => window.dispatchEvent(new CustomEvent("fk-open-scheduled", { detail: e.id }))}>补记细节</button></div>
    </li>)}</ul>
  </section>
}
