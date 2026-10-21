import { stampCN } from "@/lib/ui/activity-format";
import { planTag, planPrefix } from "@/lib/plan/active-plan";
import type { ActivityRow } from "@/lib/ui/training-read-model"
type Entry = { id: string; date: string; title?: string; refId?: string | null; actual?: { outcome?: string; minutes?: number | null; rpe?: number | null; note?: string }; restLog?: { name: string; actual: number }[]; exercises?: { name: string; sets: string; reps: string; weight: string }[] }
type Check = { date: string; sessionId: string; moves: Record<string, { done: boolean; reps: number; kg: number }[]>; rpe: number | null }
const read = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? "null") ?? d } catch { return d } }
const OUT: Record<string, string> = { as_planned: "按计划完成", different: "实际与计划不同", missed: "没练" }
/** 手机记录详情：只显示本机原始记录（日程条目 + 逐组清单 / 直接记下的组），不推断。 */
export function PhoneRecordDetail({ row }: { row: ActivityRow }) {
  const schedId = row.originIds.find(x => x.startsWith("sched:"))?.slice(6)
  const e = schedId ? (read<{ entries?: Entry[] }>("fk-schedule-v1", {}).entries ?? []).find(x => x.id === schedId) : undefined
  const checks = Object.values(read<Record<string, Check>>("fk-today-checklist-v1", {}))
  const c = checks.find(x => x && x.date === row.date && (row.originIds.includes(`chk:${x.date}:${x.sessionId}`) || (e && (x.sessionId === e.refId || x.sessionId === e.id))))
  let names: Record<string, string> = {}
  try { const plan = read<{ data?: { sessions?: { moves?: { id: string; customName?: string; name?: string }[] }[] }; sessions?: { moves?: { id: string; customName?: string; name?: string }[] }[] }>("fr255-strength-plan-v3", {}); for (const ss of (plan.data ?? plan).sessions ?? []) for (const m of ss.moves ?? []) names[m.id] = m.customName || m.name || "动作" } catch { names = {} }
  const p4day = row.originIds.find(x => x.startsWith("p400:"))?.slice(5)
  if (p4day) {
    const l = read<Record<string, Record<string, string>>>("fk-plan400-v4-log", {})[p4day] ?? {}
    const F: [string, string][] = [["reps", "成绩"], ["rest", "组间休息"], ["aux", "辅助/技术"], ["strength", "力量实际"], ["rpe", "整课 RPE"], ["pain", "疼痛"], ["r24", "24 小时后"], ["r48", "48 小时后"], ["note", "备注"]]
    return <div className="keep space-y-1 rounded-card bg-surface-2 p-2 text-xs" data-testid="v4-record-detail">
      <p><b>{planPrefix()}计划记录 · {l.done === "done" ? "已完成" : l.done === "reduced" ? "已完成·减量" : "已记录未完成"}</b>{l.savedAt ? <span className="text-muted"> · 保存于 {stampCN(l.savedAt)}</span> : null}</p>
      <ul>{F.filter(([k]) => String(l[k] ?? "").trim()).map(([k, n]) => <li key={k}>{n}：{l[k]}</li>)}</ul>
      <p className="text-muted">同一天的手表活动单独列出（两者没有可靠的对应关系，不合并、不重复计入距离）。</p>
    </div>
  }
  return <div className="keep space-y-1 rounded-card bg-surface-2 p-2 text-xs">
    <p><b>{row.status === "incomplete" ? "已记录未完成" : "已完成"}</b>{e?.actual?.outcome ? ` · ${OUT[e.actual.outcome] ?? e.actual.outcome}` : ""}{e?.actual?.minutes ? ` · ${e.actual.minutes} 分钟` : ""}{(e?.actual?.rpe ?? c?.rpe) != null ? ` · RPE ${e?.actual?.rpe ?? c?.rpe}` : ""}</p>
    {c ? <ul>{Object.entries(c.moves).map(([id, sets]) => <li key={id}>{names[id] ?? "动作"}：{sets.map((x, i) => `${i + 1}组 ${x.kg ? `${x.kg}kg×` : ""}${x.reps}${x.done ? "✓" : "（未勾）"}`).join("，")}</li>)}</ul> : null}
    {!c && e?.exercises?.length ? <ul>{e.exercises.map((x, i) => <li key={i}>{x.name}：{x.sets}组×{x.reps}{x.weight ? ` ${x.weight}kg` : ""}（计划）</li>)}</ul> : null}
    {e?.restLog?.length ? <p className="text-muted">记录了 {e.restLog.length} 次组间休息</p> : null}
    {e?.actual?.note ? <p className="text-muted">备注：{e.actual.note}</p> : null}
    {row.status === "incomplete" ? <p className="text-muted">这节在今日卡片里改过或勾过组，但没点“完成”。回到当天卡片点完成，就会算作已完成。</p> : null}
  </div>
}
