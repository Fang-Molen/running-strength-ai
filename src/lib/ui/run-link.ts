import type { ScheduleEntry } from './day-schedule-rules'
import type { ActivityRow } from './training-read-model'
import { loadComponents, setRunDevice, type ComponentsDoc } from './plan400-components-store'
import { dayKind, type V4Day } from './plan400-view'
/**
 * v79（用户 t492/t493）：日程里的跑步课 ↔ 佳明跑步 关联。
 * - v83（P1-05/IMP-01，用户规则“同日候选必须经用户确认才算关联”）：同一北京日期恰好 1 节跑步课 + 1 条佳明跑步
 *   不再自动关联，只作为“很可能是这次”的候选（likely），用户点“是，关联”后才写入关联；同日不是充分证据。
 * - 同一天多条/多节，或只有相邻一天有跑步 → 普通候选“是这次吗？”。
 * - 旧数据里已保存的关联（用户确认过的）照常生效；by:'auto' 的历史关联只读不新增。
 * - 关联是派生的：日志里只有那条佳明记录（计划不生成第二条），所以各处只算一次。
 * - 只处理跑步课；手表跑步永远不会把力量课标成完成。
 */
import { plannedRepsFromText } from './lap-structure'
export const RUN_LINKS_KEY = 'fk-run-links-v1'
export type RunLinkStore = Record<string, { garminId?: string; by?: 'auto' | 'user'; rejected?: string[] }>
export type RunLink = { entry: ScheduleEntry; run: ActivityRow; by: 'auto' | 'user' }
// v81：plan400:<date>:… 日程条目只是 V4 当天的执行入口，跑步关联走 V4 跑步分项，不再当作另一节计划跑
const isRunEntry = (e: ScheduleEntry) => !!e && e.modality === 'run' && !(e.id.startsWith('plan400:') && !e.id.endsWith(':running')) && !e.actual && (e.status === 'planned' || e.status === 'proposed' || (e.status as string) === 'edited')
const isRun = (r: ActivityRow) => r.sport === 'RUNNING' && (r.source === 'garmin' || r.originIds.some(id => id.startsWith('garmin:')))
const shift = (d: string, n: number) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }
export function planKm(e: ScheduleEntry): number | null {
  if (typeof e.km === 'number' && e.km > 0) return e.km
  const m = /(\d+(?:\.\d+)?)\s*(?:公里|km|KM|千米)/.exec(e.title || ''); if (!m) return null
  const reps = /[×x]\s*(\d+)/.exec(e.title.slice(m.index + m[0].length)); return Number(m[1]) * (reps ? Number(reps[1]) : 1)
}
export function loadRunLinks(store: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): RunLinkStore {
  try { const v = JSON.parse(store?.getItem(RUN_LINKS_KEY) ?? '{}'); return v && typeof v === 'object' ? v : {} } catch { return {} }
}
export const V4_RUN_PREFIX = 'plan400:'
export const v4RunSlotId = (date: string) => `plan400:${date}:running`
/** V4 课里有跑步部分的日子（到今天为止）→ 当作“计划跑步课”参与同一套匹配。 */
export function v4RunSlots(days: readonly V4Day[], today: string, comps: ComponentsDoc = { schemaVersion: 1, days: {} }): ScheduleEntry[] {
  return days.filter(d => d.date <= today && dayKind(d) !== 'rest' && !/^力量/.test(d.title) && comps.days[d.date]?.running?.status !== 'skipped')
    .map(d => ({ v4Intervals: (() => { const p = plannedRepsFromText(d.main.slice(1).join('')); return p ? `${p.distanceM}m×${p.reps}${p.rounds ? `×${p.rounds}` : ''}` : undefined })(), id: v4RunSlotId(d.date), date: d.date, kind: 'run', modality: 'run', trainingType: 'run', title: `V4 ${d.title} · 跑步部分`, focus: [], minutes: 0, intensity: 'MODERATE', lowerHeavy: false, source: 'fangkun', refId: null, status: 'planned' }) as unknown as ScheduleEntry)
}
/** 日程跑步课的关联（fk-run-links-v1）+ V4 跑步分项的关联（fk-plan400-v4-components-v1 running.device / deviceRejected）。 */
export function allRunLinks(comps: ComponentsDoc = loadComponents(), base: RunLinkStore = loadRunLinks()): RunLinkStore {
  const out: RunLinkStore = { ...base }
  for (const [d, c] of Object.entries(comps.days ?? {})) { const r = c?.running; if (!r) continue; out[v4RunSlotId(d)] = { ...(r.device ? { garminId: r.device.sourceIdentity, by: r.device.linkedBy } : {}), ...(r.deviceRejected?.length ? { rejected: r.deviceRejected } : {}) } }
  return out
}
export function saveRunLink(entryId: string, value: RunLinkStore[string] | null) {
  if (entryId.startsWith(V4_RUN_PREFIX)) { const date = entryId.slice(8, 18)
    if (value?.garminId) setRunDevice(date, { sourceIdentity: value.garminId, source: 'garmin', linkedBy: value.by ?? 'user' })
    else setRunDevice(date, null, value?.rejected?.at(-1))
    try { window.dispatchEvent(new Event('fk-run-links')); window.dispatchEvent(new Event('fk-training-activities-changed')) } catch { /* node */ } return }
  try { const s = loadRunLinks(); if (value) s[entryId] = value; else delete s[entryId]; localStorage.setItem(RUN_LINKS_KEY, JSON.stringify(s)); window.dispatchEvent(new Event('fk-run-links')); window.dispatchEvent(new Event('fk-training-activities-changed')) } catch { /* 存不了就不关联 */ }
}
export type RunSuggestion = { entry: ScheduleEntry; runs: ActivityRow[]; likely?: boolean; basis?: string }
export function matchRuns(entries: ScheduleEntry[], rows: ActivityRow[], links: RunLinkStore, today: string): { links: RunLink[]; suggestions: RunSuggestion[] } {
  const runs = rows.filter(isRun), byId = new Map(runs.flatMap(r => [r.id, ...r.originIds].map(k => [k, r] as const))), out: RunLink[] = [], taken = new Set<string>()
  const cands = entries.filter(e => isRunEntry(e) && e.date <= today)
  // 1) 用户确认过的
  for (const e of cands) { const l = links[e.id], r = l?.garminId ? byId.get(l.garminId) : undefined; if (r && !taken.has(r.id)) { out.push({ entry: e, run: r, by: l!.by === 'auto' ? 'auto' : 'user' }); taken.add(r.id) } }
  const linked = new Set(out.map(x => x.entry.id)), rest = cands.filter(e => !linked.has(e.id) && !links[e.id]?.garminId)
  const free = (e: ScheduleEntry, d: string) => runs.filter(r => r.date === d && !taken.has(r.id) && !(links[e.id]?.rejected ?? []).some(x => x === r.id || r.originIds.includes(x)))
  // 2) 候选：同一天恰好 1 对 1 = likely（仍需用户确认）；同一天多条/多节，或相邻一天 = 普通候选
  const suggestions: RunSuggestion[] = rest.map(e => {
    const same = free(e, e.date), sameDayEntries = rest.filter(x => x.date === e.date)
    const iv = (e as { v4Intervals?: string }).v4Intervals
    // 分段课（如 150m×3）：总距离/总时间证明不了做了分段，不说“很可能”，只作普通候选（A07/N14）
    if (same.length === 1 && sameDayEntries.length === 1 && iv) return { entry: e, runs: same, basis: `同一天只有这一条手表跑步，但这节是分段课（${iv}），只凭日期和总距离不能确认做的是这节` }
    if (same.length === 1 && sameDayEntries.length === 1) return { entry: e, runs: same, likely: true, basis: '同一天只有这一节跑步课和这一条手表跑步' }
    const runsFor = same.length ? same : [...free(e, shift(e.date, -1)), ...free(e, shift(e.date, 1))]
    return { entry: e, runs: runsFor, basis: same.length ? `同一天有 ${same.length} 条手表跑步` : '只有相邻一天有手表跑步' }
  }).filter(x => x.runs.length)
  return { links: out, suggestions }
}
const pace = (m: number | null, s: number | null) => m && s ? `${Math.floor(s / (m / 1000) / 60)}'${String(Math.round(s / (m / 1000) % 60)).padStart(2, '0')}"/km` : null
/** 计划 vs 实际 + 简单偏差说明（只比较计划里写了的项）。 */
export function planVsActual(e: ScheduleEntry, r: ActivityRow) {
  const km = planKm(e), min = e.minutes > 0 ? e.minutes : null, ak = r.distanceM != null ? r.distanceM / 1000 : null, am = r.durationSec != null ? r.durationSec / 60 : null
  const notes: string[] = []
  if (km && ak != null) { const d = (ak - km) / km; notes.push(Math.abs(d) <= 0.1 ? '距离基本按计划' : d > 0 ? `距离多 ${(ak - km).toFixed(1)} km` : `距离少 ${(km - ak).toFixed(1)} km`) }
  if (min && am != null) { const d = (am - min) / min; notes.push(Math.abs(d) <= 0.15 ? '时长基本按计划' : d > 0 ? `时长多 ${Math.round(am - min)} 分钟` : `时长少 ${Math.round(min - am)} 分钟`) }
  return { plan: [km ? `${km} km` : null, min ? `${min} 分钟` : null].filter(Boolean).join(' · ') || '—', actual: [ak != null ? `${ak.toFixed(2)} km` : null, am != null ? `${Math.round(am)} 分钟` : null, pace(r.distanceM, r.durationSec), r.avgHr ? `心率 ${Math.round(r.avgHr)}` : null].filter(Boolean).join(' · ') || '—', note: notes.join('，') || '计划没写距离/时长，无法比较' }
}
