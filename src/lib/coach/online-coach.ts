/** 方坤联网分析（用户 t460 明确要求“一直保持联网”）：默认开启并记录一次同意；用户可在方坤里关闭。
 * 只发送去标识化事实（活动数值/分段/恢复指标/计划目标），不发送账号、位置或凭证。失败/离线回退本地分析。 */
import { currentStore } from '../core/storage'
import { garminViewKey } from '../health/garmin-view-scope'
import { loadHealthSnapshot, healthSummaryLine } from '../health/snapshot'
import { activityFacts, planFor, sportLabel, type GActivity, type GLap } from './plain-coach'
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
/** 去标识化事实包。 */
export function buildFacts(day: string, act: GActivity | null, laps: GLap[] | null): string {
  const lines: string[] = [`今天：${day}`]
  const p = planFor(day); lines.push(`目标：${p.goal}`); if (p.today) lines.push(`今天计划：${p.today}`); if (p.next) lines.push(`下一节计划：${p.next}`)
  if (act) lines.push('关联训练（佳明手表）：', ...activityFacts(act, laps))
  const recent = garminActivities().sort((a, b) => Date.parse(b.start) - Date.parse(a.start)).slice(0, 7)
  if (recent.length) lines.push('近期活动：' + recent.map(a => `${a.start.slice(0, 10)} ${sportLabel(a.type)} ${a.dist != null ? (a.dist / 1000).toFixed(1) + 'km' : ''} ${a.dur != null ? Math.round(a.dur / 60) + '分钟' : ''} 心率${a.avgHr ?? '—'}`).join('；'))
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
