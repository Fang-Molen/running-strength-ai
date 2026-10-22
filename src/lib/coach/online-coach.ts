import { planVsActual } from '../ui/run-link'
import { planTag, planPrefix } from '../plan/active-plan'
import { partLine, loadComponents } from '../ui/plan400-components-store'
/** 方坤联网分析（用户 t460 明确要求“一直保持联网”）：默认开启并记录一次同意；用户可在方坤里关闭。
 * 只发送去标识化事实（活动数值/分段/恢复指标/计划目标），不发送账号、位置或凭证。失败/离线回退本地分析。 */
import { currentStore } from '../core/storage'
import { garminViewKey } from '../health/garmin-view-scope'
import { loadHealthSnapshot, healthSummaryLine } from '../health/snapshot'
import { personalStatsCards, personalStatsFactLine } from '../health/personal-stats-host'
import { currentAthleteId } from '../core/events'
import { loadTrainingActivities, loadRunMatch, type ActivityRow } from '../ui/training-read-model'
import type { DayComponents } from '../ui/plan400-components-store'
import { isGarmin, recordLabel } from '../ui/log-range'
import { activityTs, activityLocalDay, fmtDistance, fmtDuration, fmtHr } from '../ui/activity-format'
import { activityFacts, localDayOf, planFor, userMarks, v4RecordLine, sportLabel, type GActivity, type GLap } from './plain-coach'
import { COACH_ONLINE_KEY, savedOnlineChoices, savedOnlineRecord } from '../ui/online-preferences'
export { COACH_ONLINE_KEY } from '../ui/online-preferences'
export type OnlineSetting = { on: boolean; consentAt: string; by: string }
export function onlineSetting(now = new Date().toISOString()): OnlineSetting {
  const s = currentStore()
  const saved = savedOnlineRecord(s, COACH_ONLINE_KEY)
  const v: OnlineSetting = { on: savedOnlineChoices(s).coach ?? true, consentAt: typeof saved?.consentAt === 'string' ? saved.consentAt : now, by: typeof saved?.by === 'string' ? saved.by : '沿用用户联网选择（t460）' }
  if (saved && typeof saved.on === 'boolean') return v
  try { s?.setItem(COACH_ONLINE_KEY, JSON.stringify(v)) } catch { /* session only */ }
  return v
}
export function setOnline(on: boolean) { const v = { ...onlineSetting(), on, consentAt: new Date().toISOString(), by: on ? '用户在方坤中开启联网' : '用户在方坤中关闭联网' }; try { currentStore()?.setItem(COACH_ONLINE_KEY, JSON.stringify(v)) } catch { /* ignore */ } try { window.dispatchEvent(new Event('fk-online-features-changed')) } catch { /* no browser */ } return v }
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
  const legacy = v4RecordLine(r.date)?.replace(/^(?:\S+ )?计划记录（[^）]*）：/, '')
  if (f.legacyOverall) segs.push(`历史整课记录（旧口径·仅参考，整课 RPE 不拆给跑步或力量）：${legacy ?? f.legacy.done ?? ''}`)
  else if (legacy) segs.push(`旧整课字段（仅参考）：${legacy}`)
  return `${planPrefix()}计划记录（${r.date} ${(planPrefix() && r.title?.startsWith(planPrefix()) ? r.title.slice(planPrefix().length) : r.title)?.replace(/（.*$/, '') ?? ''}）：${segs.join('；')}`
}
/** 去标识化事实包。v86（R1.1）：只发用户自己的数据——目标来自资料“目标成绩”或聊天里明确说过的目标，没有就写“未知”；
 * 内置 V4 课表只有用户真的在用（本机有 V4 记录）时才作为“用户在用的计划”发出，不再给新用户/合成学员套用。 */
export function buildFacts(day: string, act: GActivity | null, laps: GLap[] | null, known: { goalTarget?: { meters: number; toSeconds: number } | null } = {}): string {
  const lines: string[] = [`今天：${day}`]
  const store = currentStore() as Pick<Storage, 'getItem'> | null
  const p = planFor(day, store, known.goalTarget ?? null)
  lines.push(`目标：${p.goal ?? '未知（用户没有设定具体成绩目标；不要假设任何目标）'}`)
  const marks = userMarks(store); if (marks.length) lines.push(`用户资料成绩：${marks.join('；')}`)
  if (p.today) lines.push(`用户在用的计划·今天（计划，不是实际）：${p.today}`); if (p.next) lines.push(`用户在用的计划·下一节（计划，不是实际）：${p.next}`)
  if (!p.active) lines.push('训练计划：本机没有用户在用的课表记录（不要引用或编造任何课表、日期或课次）')
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
  try { const snap = loadHealthSnapshot(day); lines.push('恢复指标：' + snap.metrics.filter(m => ['SLEEP', 'RHR', 'HRV', 'BODY_BATTERY', 'STRESS'].includes(m.metric)).map(healthSummaryLine).join('；'))
    const u09 = personalStatsFactLine(personalStatsCards(snap, currentAthleteId(), `${day}T23:59:59`)); if (u09) lines.push(u09) } catch { /* optional */ }
  return lines.join('\n').slice(0, 7800)
}
/** 与受控服务端保持相同上限；超限拒绝，不能静默截断安全信息。 */
export const ONLINE_QUESTION_MAX = 200
export type OnlineAuthorization = {requestId:string;snapshotId:string;consentId:string;asOf:string}
export async function askOnlineCoach(input: { question: string; facts: string; local: string; history: { role: string; text: string }[]; authorization?: OnlineAuthorization }, ms = 30000): Promise<{ text: string } | { error: string }> {
  const owner=currentAthleteId(),setting=onlineSetting()
  if (!setting.on) return { error: '联网分析已关闭，已保留本地分析；没有上传数据' }
  const q=input.question.trim(),refs=input.authorization
  if (!q || q.length > ONLINE_QUESTION_MAX || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(q)) return {error:'问题格式无效，保留本地分析'}
  if(!refs||![refs.requestId,refs.snapshotId,refs.consentId,refs.asOf].every(x=>typeof x==='string'&&x.trim()))return {error:'受信任事实授权与费用审批尚未接通，已保留本地分析；没有上传训练或健康记录'}
  const ac=new AbortController(),t=setTimeout(()=>ac.abort(),Math.min(Math.max(ms,1),30000))
  const changed=()=>{if(currentAthleteId()!==owner||!onlineSetting().on||onlineSetting().consentAt!==setting.consentAt)ac.abort()}
  if(typeof window!=='undefined')window.addEventListener('fk-online-features-changed',changed)
  try {
    const r=await fetch('/api/coach-chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:q,requestId:refs.requestId,snapshotId:refs.snapshotId,consentId:refs.consentId,asOf:refs.asOf}),signal:ac.signal})
    const j=await r.json().catch(()=>({}))
    changed();if(ac.signal.aborted)return {error:'授权或当前档案已变化，未采用联网结果'}
    return r.ok&&j.ok===true&&j.planChanged===false&&typeof j.text==='string'&&j.text.trim()?{text:j.text}:{error:j.error||`HTTP ${r.status}`}
  }catch{return {error:ac.signal.aborted?'联网取消或超时，保留本地分析':'网络不可用，保留本地分析'}}finally{clearTimeout(t);if(typeof window!=='undefined')window.removeEventListener('fk-online-features-changed',changed)}
}
