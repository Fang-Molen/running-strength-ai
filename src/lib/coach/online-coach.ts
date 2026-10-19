import { planVsActual } from '../ui/run-link'
import { partLine, loadComponents } from '../ui/plan400-components-store'
/** 方坤联网分析（用户 t460 明确要求“一直保持联网”）：默认开启并记录一次同意；用户可在方坤里关闭。
 * 只发送去标识化事实（活动数值/分段/恢复指标/计划目标），不发送账号、位置或凭证。失败/离线回退本地分析。 */
import { currentStore } from '../core/storage'
import { garminViewKey } from '../health/garmin-view-scope'
import { loadHealthSnapshot, healthSummaryLine } from '../health/snapshot'
import { loadTrainingActivities, loadRunMatch, type ActivityRow } from '../ui/training-read-model'
import type { DayComponents } from '../ui/plan400-components-store'
import { isGarmin, recordLabel } from '../ui/log-range'
import { activityTs, activityLocalDay, fmtDistance, fmtDuration, fmtHr } from '../ui/activity-format'
import { activityFacts, localDayOf, planFor, v4RecordLine, sportLabel, type GActivity, type GLap } from './plain-coach'
export const COACH_ONLINE_KEY = 'fk-coach-online-v1'
export type OnlineSetting = { on: boolean; consentAt: string; by: string }
export function onlineSetting(now = new Date().toISOString()): OnlineSetting {
  const s = currentStore()
  try { const v = JSON.parse(s?.getItem(COACH_ONLINE_KEY) ?? 'null'); if (v && typeof v.on === 'boolean') return v } catch { /* reset below */ }
  const v: OnlineSetting = { on: true, consentAt: now, by: '用户要求一直保持联网（t460）' }
  try { s?.setItem(COACH_ONLINE_KEY, JSON.stringify(v)) } catch { /* session only */ }
  return v
}
export function setOnline(on: boolean) { const v = { ...onlineSetting(), on, consentAt: new Date().toISOString(), by: on ? '用户在方坤中开启联网' : '用户在方坤中关闭联网' }; try { currentStore()?.setItem(COACH_ONLINE_KEY, JSON.stringify(v)) } catch { /* ignore */ } return v }
const read = <T,>(k: string, d: T): T => { try { return JSON.parse(currentStore()?.getItem(k) ?? '') as T } catch { return d } }
export const garminActivities = (): GActivity[] => Object.values(read<Record<string, GActivity>>(garminViewKey('fk-garmin-acts-v1'), {})).filter(a => a && typeof a.start === 'string')
export const cachedLaps = (id: number | string): GLap[] | null => read<Record<string, GLap[]>>(garminViewKey('fk-garmin-laps-v1'), {})[String(id)] ?? null
export function saveLaps(id: number | string, laps: GLap[]) { const k = garminViewKey('fk-garmin-laps-v1'), all = read<Record<string, GLap[]>>(k, {}); all[String(id)] = laps; try { currentStore()?.setItem(k, JSON.stringify(all)) } catch { /* ignore */ } }
const STATE_WORD: Record<string, string> = { done: '完成', reduced: '减量完成', skipped: '跳过', partial: '有记录·未标完成', live: '进行中', candidate: '有同日手表跑步·待用户确认（未关联，不要当作这节课的跑步）', none: '未记录' }
const pl = (n: string, p: DayComponents['running']) => { const t = partLine(n, p)?.slice(n.length + 1); return t ? `（${t}）` : '' }
/** v83：V4 一天的统一事实行（与 App 各页同一投影）。 */
export function v4FactLine(r: ActivityRow, c?: DayComponents): string {
  const f = r.v4!, segs: string[] = []
  if (f.running) segs.push(`跑步 ${STATE_WORD[f.running.state] ?? f.running.state}${pl('跑步', c?.running)}`)
  if (f.strength) segs.push(`力量 ${STATE_WORD[f.strength.state] ?? f.strength.state}${pl('力量', c?.strength)}`)
  if (r.runLink && r.distanceM != null) segs.push(`跑步实际 ${fmtDistance(r.distanceM) ?? ''} ${fmtDuration(r.durationSec)}（已关联佳明，同一次训练只算一次）`)
  // 旧整课记录原样带上（成绩/组间休息/整课 RPE 都保留，不拆、不丢），只标口径
  const legacy = v4RecordLine(r.date)?.replace(/^V4 计划记录（[^）]*）：/, '')
  if (f.legacyOverall) segs.push(`历史整课记录（旧口径·仅参考，整课 RPE 不拆给跑步或力量）：${legacy ?? f.legacy.done ?? ''}`)
  else if (legacy) segs.push(`旧整课字段（仅参考）：${legacy}`)
  return `V4 计划记录（${r.date} ${r.title?.replace(/^V4 /, '').replace(/（.*$/, '') ?? ''}）：${segs.join('；')}`
}
/** 去标识化事实包。 */
export function buildFacts(day: string, act: GActivity | null, laps: GLap[] | null): string {
  const lines: string[] = [`今天：${day}`]
  const p = planFor(day); lines.push(`目标：${p.goal}`); if (p.today) lines.push(`今天计划：${p.today}`); if (p.next) lines.push(`下一节计划：${p.next}`)
  if (act) lines.push('关联训练（佳明手表）：', ...activityFacts(act, laps))
  const recent = garminActivities().filter(a => localDayOf(a.start) <= day).sort((a, b) => activityTs(b.start) - activityTs(a.start)).slice(0, 7)
  if (recent.length) lines.push('近期活动：' + recent.map(a => `${activityLocalDay(a.start) ?? '?'} ${sportLabel(a.type)} ${fmtDistance(a.dist) ?? ''} ${fmtDuration(a.dur)} 心率${fmtHr(a.avgHr) ?? '—'}`).join('；'))
  try {
    const from = new Date(Date.parse(day + 'T12:00:00Z') - 7 * 864e5).toISOString().slice(0, 10)
    // v83（P1-10）：V4 每天只出一行统一投影（与首页/计划/日志同一个 v4DayFact）；旧整课记录标“仅参考”，不再另出“分项反馈”“旧记录”两行互相矛盾。
    const all = loadTrainingActivities(), cd = (() => { try { return loadComponents().days } catch { return {} } })()
    const mine = all.filter(r => r.date >= from && r.date <= day && !isGarmin(r) && !r.v4).slice(-12)
    if (mine.length) lines.push('近期手机/计划记录：' + mine.map(r => `${r.date} ${recordLabel(r).replace(/^[^·]*· /, '')}${r.quickLog ? '（记一笔·计划外）' : ''}${r.note ? `（${r.note}）` : ''}${r.status === 'incomplete' ? (r.rpe != null ? '（未完成，不计入）' : '（未完成·未反馈，不计入；不要当作练过）') : ''}`).join('；'))
    try { const m = loadRunMatch().links.filter(l => l.entry.date >= from && !l.entry.id.startsWith('plan400:'))
      if (m.length) lines.push('计划跑步课已关联佳明（同一次训练，只算一次）：' + m.map(l => { const c = planVsActual(l.entry, l.run); return `${l.entry.date} 计划「${l.entry.title}」${c.plan} → 实际 ${c.actual}（${c.note}）` }).join('；')) } catch { /* optional */ }
    const v4rows = all.filter(r => r.v4 && r.date >= from && r.date <= day)
    const v4lines = v4rows.map(r => v4FactLine(r, cd[r.date]))
    const seen = new Set(v4rows.map(r => r.date))
    for (const d of [act ? localDayOf(act.start) : null, day]) { if (d && !seen.has(d)) { const l = v4RecordLine(d); if (l) { v4lines.push(l + '（历史整课记录·旧口径·仅参考）'); seen.add(d) } } }
    if (v4lines.length) lines.push(...v4lines)
  } catch { /* optional */ }
  try { const snap = loadHealthSnapshot(day); lines.push('恢复指标：' + snap.metrics.filter(m => ['SLEEP', 'RHR', 'HRV', 'BODY_BATTERY', 'STRESS'].includes(m.metric)).map(healthSummaryLine).join('；')) } catch { /* optional */ }
  return lines.join('\n').slice(0, 7800)
}
export async function askOnlineCoach(input: { question: string; facts: string; local: string; history: { role: string; text: string }[] }, ms = 30000): Promise<{ text: string } | { error: string }> {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms)
  try {
    const r = await fetch('/api/coach-chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, history: input.history.slice(-6) }), signal: ac.signal })
    const j = await r.json().catch(() => ({}))
    return r.ok && typeof j.text === 'string' && j.text.trim() ? { text: j.text } : { error: j.error || `HTTP ${r.status}` }
  } catch { return { error: ac.signal.aborted ? '联网超时' : '网络不可用' } } finally { clearTimeout(t) }
}
