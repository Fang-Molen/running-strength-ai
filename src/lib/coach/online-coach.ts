import { planVsActual } from '../ui/run-link'
import { partLine, loadComponents } from '../ui/plan400-components-store'
/* 本地事实摘要与受控联网入口分离。历史偏好不是本次上传同意；
 * 真实调用只发送受信服务端引用，不能把本地健康全文当作服务端事实。 */
import { currentStore } from '../core/storage'
import { currentAthleteId } from '../core/events'
import { loadCoach } from '../strength/coach'
import { garminViewKey } from '../health/garmin-view-scope'
import { loadHealthSnapshot, healthSummaryLine } from '../health/snapshot'
import { loadTrainingActivities, loadRunMatch } from '../ui/training-read-model'
import { isGarmin, recordLabel } from '../ui/log-range'
import { activityTs, activityLocalDay, fmtDistance, fmtDuration, fmtHr } from '../ui/activity-format'
import { activityFacts, localDayOf, planFor, v4RecordLine, sportLabel, type GActivity, type GLap } from './plain-coach'
export const COACH_ONLINE_KEY = 'fk-coach-online-v1'
export type OnlineSetting = { on: boolean; consentAt: string; by: string; athleteId: string; version: 2 }
export const onlineSettingKey = (athleteId = currentAthleteId()) => `${COACH_ONLINE_KEY}:${encodeURIComponent(athleteId)}:v2`
export function onlineSetting(_now = new Date().toISOString()): OnlineSetting {
  const athleteId = currentAthleteId()
  try {
    const v = JSON.parse(currentStore()?.getItem(onlineSettingKey(athleteId)) ?? 'null')
    if (v?.version === 2 && v.athleteId === athleteId && typeof v.on === 'boolean' && typeof v.consentAt === 'string' && typeof v.by === 'string') return v
  } catch { /* default off; legacy global consent is never migrated */ }
  return { on: false, consentAt: '', by: '尚未开启；每次调用仍需单独授权', athleteId, version: 2 }
}
/** Saves a preference only, never issues upload consent or a trusted snapshot. */
export function setOnline(on: boolean): OnlineSetting {
  const v: OnlineSetting = { ...onlineSetting(), on, consentAt: new Date().toISOString(), by: on ? '当前运动员开启联网偏好（非本次数据授权）' : '当前运动员关闭联网偏好' }
  try { const store = currentStore(), raw = JSON.stringify(v); if (!store) throw new Error('NO_STORE'); store.setItem(onlineSettingKey(), raw); if (store.getItem(onlineSettingKey()) !== raw) throw new Error('NOT_PERSISTED') } catch { return { ...v, on: false, by: '偏好保存失败，保持本地分析' } }
  return v
}
const read = <T,>(k: string, d: T): T => { try { return JSON.parse(currentStore()?.getItem(k) ?? '') as T } catch { return d } }
export const garminActivities = (): GActivity[] => Object.values(read<Record<string, GActivity>>(garminViewKey('fk-garmin-acts-v1'), {})).filter(a => a && typeof a.start === 'string')
export const cachedLaps = (id: number | string): GLap[] | null => read<Record<string, GLap[]>>(garminViewKey('fk-garmin-laps-v1'), {})[String(id)] ?? null
export function saveLaps(id: number | string, laps: GLap[]) { const k = garminViewKey('fk-garmin-laps-v1'), all = read<Record<string, GLap[]>>(k, {}); all[String(id)] = laps; try { currentStore()?.setItem(k, JSON.stringify(all)) } catch { /* ignore */ } }
/** 仅供本地查看的有范围摘要；可能含自由文字及敏感健康指标，不能视为完整去标识化。 */
export function buildFacts(day: string, act: GActivity | null, laps: GLap[] | null): string {
  const athleteId = currentAthleteId()
  const lines: string[] = [`本地事实摘要（不用于直接上传）；截至：${day}`]
  const dialogue = loadCoach().dialogue
  lines.push(`目标：${day === localDayOf(new Date().toISOString()) && dialogue?.athleteId === athleteId && dialogue.goal ? dialogue.goal.slice(0, 200) + '（来源：当前运动员对话记录，未核准为正式计划）' : 'UNKNOWN（未确认目标或缺少该历史时点的有效来源）'}`)
  const p = athleteId === 'local' ? planFor(day) : null
  if (p?.today) lines.push(`本地历史计划（计划不是实际）：${p.today}`)
  if (act && localDayOf(act.start) <= day && garminActivities().some(a => a.id === act.id && a.start === act.start && a.sourceIdentity === act.sourceIdentity)) lines.push('关联训练（当前运动员佳明视图）：', ...activityFacts(act, laps))
  const recent = garminActivities().filter(a => localDayOf(a.start) <= day).sort((a, b) => activityTs(b.start) - activityTs(a.start)).slice(0, 7)
  if (recent.length) lines.push('近期活动：' + recent.map(a => `${activityLocalDay(a.start) ?? '?'} ${sportLabel(a.type)} ${fmtDistance(a.dist) ?? ''} ${fmtDuration(a.dur)} 心率${fmtHr(a.avgHr) ?? '—'}`).join('；'))
  try {
    const from = new Date(Date.parse(day + 'T12:00:00Z') - 7 * 864e5).toISOString().slice(0, 10)
    const mine = loadTrainingActivities().filter(r => (r.athleteId ?? 'local') === athleteId && r.date >= from && r.date <= day && !isGarmin(r)).slice(-12)
    if (mine.length) lines.push('近期手机/计划记录：' + mine.map(r => `${r.date} ${recordLabel(r).replace(/^[^·]*· /, '')}${r.status === 'incomplete' ? '（整课待补录；仅采用明确的分项实际，未记录部分未知）' : ''}`).join('；'))
    // v79：计划跑步课已关联的佳明跑步（同一条记录，只算一次）
    try { const m = (athleteId === 'local' ? loadRunMatch().links : []).filter(l => l.by === 'user' && l.entry.date >= from && l.entry.date <= day && l.run.date <= day)
      if (m.length) lines.push('计划跑步课已关联佳明（同一次训练，只算一次）：' + m.map(l => { const c = planVsActual(l.entry, l.run); return `${l.entry.date} 计划「${l.entry.title}」${c.plan} → 实际 ${c.actual}（${c.note}）` }).join('；')) } catch { /* optional */ }
    try { const cd: ReturnType<typeof loadComponents>['days'] = athleteId === 'local' ? loadComponents().days : {}, ds = Object.keys(cd).filter(d => d >= from && d <= day).sort()
      const ls2 = ds.map(d => { const c = cd[d], parts = [partLine('跑步', c.running), partLine('力量', c.strength)].filter(Boolean); return parts.length ? `${d} ${parts.join('；')}` : null }).filter(Boolean)
      if (ls2.length) lines.push('V4 分项反馈（跑步和力量分开；旧整课评价另算，不拆）：' + ls2.join(' | ')) } catch { /* optional */ }
    const v4 = (athleteId === 'local' ? [act && localDayOf(act.start) <= day ? localDayOf(act.start) : null, day] : []).filter((x, i, xs): x is string => !!x && xs.indexOf(x) === i).map(d => v4RecordLine(d)).filter(Boolean)
    if (v4.length) lines.push(...(v4 as string[]))
  } catch { /* optional */ }
  try { if (athleteId !== 'local') throw new Error('UNOWNED_LEGACY_HEALTH'); const snap = loadHealthSnapshot(day); lines.push('恢复指标：' + snap.metrics.filter(m => ['SLEEP', 'RHR', 'HRV', 'BODY_BATTERY', 'STRESS'].includes(m.metric)).map(healthSummaryLine).join('；')) } catch { /* optional */ }
  return lines.join('\n').slice(0, 7800)
}
export type TrustedCoachAuthorization = {
  explicitConsent: true
  requestId: string
  snapshotId: string
  consentId: string
  asOf: string
}
export type OnlineCoachInput = {
  question: string
  /** Legacy local parameters remain callable but are never serialized for upload. */
  facts: string
  local: string
  history: { role: string; text: string }[]
  authorization?: TrustedCoachAuthorization
}
const validRef = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9:_-]{1,160}$/.test(v)
export async function askOnlineCoach(input: OnlineCoachInput, ms = 30000): Promise<{ text: string } | { error: string }> {
  const a = input.authorization
  if (!a || a.explicitConsent !== true || ![a.requestId, a.snapshotId, a.consentId].every(validRef) || !Number.isFinite(Date.parse(a.asOf)) || Date.parse(a.asOf) > Date.now()) {
    return { error: '缺少本次明确同意及受信服务端事实引用，已保留本地分析；没有上传数据' }
  }
  if (!onlineSetting().on) return { error: '当前运动员的联网偏好未开启，已保留本地分析' }
  const question = input.question.trim()
  if (!question || question.length > 4000) return { error: '问题为空或超过4000字符，已保留本地分析' }
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), Math.min(30000, Math.max(1, ms)))
  try {
    const r = await fetch('/api/coach-chat', {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, requestId: a.requestId, snapshotId: a.snapshotId, consentId: a.consentId, asOf: a.asOf }), signal: ac.signal,
    })
    const j = await r.json().catch(() => ({}))
    return r.ok && typeof j.text === 'string' && j.text.trim() ? { text: j.text } : { error: typeof j.error === 'string' ? j.error : `HTTP ${r.status}` }
  } catch { return { error: ac.signal.aborted ? '联网超时' : '网络不可用' } } finally { clearTimeout(t) }
}
