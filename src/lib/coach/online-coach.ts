import { historySummary, isHistoryQuestion } from './assessment/history'
import { cycleCoachSummary, readCycleGoal } from './cycle/host'
import { loadEntries as readNutritionSourceForFreshness } from '../nutrition/log'
import { readEffectiveProfile } from './loop/effective-host'
import { readEffectiveTrainingProfile } from './loop/effective-training'
import { readScheduleDocument } from '../ui/day-schedule'
import { analysisDigest } from '../health/analysis-evidence'
import { readAnalysis } from '../health/analysis-host'
import { guardR5Reply } from './r5/guard'
import { planPrefix } from '../plan/active-plan'
import { partLine, loadOwnedComponents } from '../ui/plan400-components-store'
/** 方坤联网分析（用户 t460 明确要求“一直保持联网”）：默认开启并记录一次同意；用户可在方坤里关闭。
 * 只发送去标识化事实（活动数值/分段/恢复指标/计划目标），不发送账号、位置或凭证。失败/离线回退本地分析。 */
import { currentStore } from '../core/storage'
import { garminViewKey } from '../health/garmin-view-scope'
import { analysisDay } from '../health/coach-data'
import { validDay, shiftDay } from '../health/observation'
import { currentAthleteId } from '../core/events'
import { ownedBy } from '../core/ownership'
import { listTrainingOccurrences } from '../core/occurrence'
import { coachImports } from '../core/coach-import-evidence'
import { readTrainingCorrectionsAsOf, TRAINING_CORRECTION_KEY } from '../core/training-correction'
import { loadTrainingActivities, type ActivityRow } from '../ui/training-read-model'
import type { DayComponents } from '../ui/plan400-components-store'
import { activityTs, activityLocalDay, fmtDistance, fmtDuration, fmtHr } from '../ui/activity-format'
import { activityFacts, localDayOf, planFor, userMarks, v4RecordLine, sportLabel, type GActivity, type GLap } from './plain-coach'
import { onlineNutritionFacts } from './online-nutrition-facts'
import { onlineTrainingFacts } from './online-training-facts'
import { onlineRecoveryFacts } from './online-recovery-facts'
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
export const garminActivities = (): GActivity[] => Object.values(read<Record<string, GActivity & { athleteId?: string }>>(garminViewKey('fk-garmin-acts-v1'), {})).filter(a => a && typeof a.start === 'string' && ownedBy(a, currentAthleteId()))
export const cachedLaps = (id: number | string): GLap[] | null => read<Record<string, GLap[]>>(garminViewKey('fk-garmin-laps-v1'), {})[String(id)] ?? null
export function saveLaps(id: number | string, laps: GLap[]) { const k = garminViewKey('fk-garmin-laps-v1'), all = read<Record<string, GLap[]>>(k, {}); all[String(id)] = laps; try { currentStore()?.setItem(k, JSON.stringify(all)) } catch { /* ignore */ } }
const STATE_WORD: Record<string, string> = { done: '完成', reduced: '减量完成', skipped: '跳过', partial: '有记录·未标完成', live: '进行中', candidate: '有同日手表跑步·待用户确认（未关联，不要当作这节课的跑步）', none: '未记录' }
const pl = (n: string, p: DayComponents['running']) => { const t = partLine(n, p)?.slice(n.length + 1); return t ? `（${t}）` : '' }
/** v83：V4 一天的统一事实行（与 App 各页同一投影）。 */
export function v4FactLine(r: ActivityRow, c?: DayComponents, asOf = new Date().toISOString()): string {
  if (c && !ownedBy(c, currentAthleteId())) c = undefined
  const f = r.v4!, segs: string[] = []
  const part = (p: DayComponents['strength']) => p && availableTime(p.savedAt, asOf) ? { status: p.status, rpe: p.rpe, pain: p.pain } : undefined
  if (f.running) segs.push(`跑步 ${STATE_WORD[f.running.state] ?? f.running.state}${pl('跑步', part(c?.running))}`)
  if (f.strength) segs.push(`力量 ${STATE_WORD[f.strength.state] ?? f.strength.state}${pl('力量', part(c?.strength))}`)
  if (r.runLink && r.distanceM != null) segs.push(`跑步实际 ${fmtDistance(r.distanceM) ?? ''} ${fmtDuration(r.durationSec)}（已关联佳明，同一次训练只算一次）`)
  // 旧整课记录原样带上（成绩/组间休息/整课 RPE 都保留，不拆、不丢），只标口径
  const legacy = ownedLegacyLine(r.date, asOf)?.replace(/^(?:\S+ )?计划记录（[^）]*）：/, '')
  if (f.legacyOverall) segs.push(`历史整课记录（旧口径·仅参考，整课 RPE 不拆给跑步或力量）：${legacy ?? f.legacy.done ?? ''}`)
  else if (legacy) segs.push(`旧整课字段（仅参考）：${legacy}`)
  return `${planPrefix()}计划记录（${r.date} ${(planPrefix() && r.title?.startsWith(planPrefix()) ? r.title.slice(planPrefix().length) : r.title)?.replace(/（.*$/, '') ?? ''}）：${segs.join('；')}`
}
/** 去标识化事实包。v86（R1.1）：只发用户自己的数据——目标来自资料“目标成绩”或聊天里明确说过的目标，没有就写“未知”；
 * 内置 V4 课表只有用户真的在用（本机有 V4 记录）时才作为“用户在用的计划”发出，不再给新用户/合成学员套用。 */
export function buildFacts(today: string, act: GActivity | null, laps: GLap[] | null, known: {
  goalTarget?: { meters: number; toSeconds: number } | null
  question?: string
  asOf?: string
  selectedOccurrenceId?: string | null
} = {}): string {
  const asOf = known.asOf ?? new Date().toISOString()
  if (!validDay(today) || !Number.isFinite(Date.parse(asOf))) return '本轮事实读取失败：日期或读取截止时间无效，不能判断是否有记录。'
  const athlete = currentAthleteId(), selectedId = known.selectedOccurrenceId
  let selectedStart = act?.start ?? null
  if (!selectedStart && selectedId) {
    selectedStart = listTrainingOccurrences().find(o => o.trainingOccurrenceId === selectedId)?.startedAt
      ?? coachImports(athlete, asOf).find(o => o.confirmedImportId === selectedId)?.occurredAt.value ?? null
  }
  const day = analysisDay(known.question ?? '', selectedStart, today)
  const store = currentStore() as Pick<Storage, 'getItem'> | null, p = planFor(day, store, known.goalTarget ?? null)
  const history = isHistoryQuestion(known.question ?? '') ? historySummary(readAnalysis(day, asOf, known.question).history) : null
  const profile = [`目标：${p.goal ?? '未知（用户没有设定具体成绩目标；不要假设任何目标）'}`]
  const marks = userMarks(store); if (marks.length) profile.push(`用户资料成绩：${marks.join('；')}`)
  if (p.today) profile.push(`用户在用的计划·${day === today ? '今天' : day}（计划，不是实际）：${p.today}`)
  if (p.next) profile.push(`用户在用的计划·下一节（计划，不是实际）：${p.next}`)
  if (!p.active) profile.push('训练计划：本机没有用户在用的课表记录（不要引用或编造任何课表、日期或课次）')

  // Domain snapshots are read on every send. A training selection only adds session detail.
  const nutrition = onlineNutritionFacts(day, asOf)
  const training = onlineTrainingFacts(day, asOf, { selectedOccurrenceId: selectedId })
  const recovery = onlineRecoveryFacts(day, asOf)
  const from = shiftDay(day, -6), cutoff = Date.parse(asOf)
  const eligibleWatch = (a: GActivity) => ownedBy(a as GActivity & { athleteId?: string }, athlete)
    && activityTs(a.start) > 0 && activityTs(a.start) <= cutoff && localDayOf(a.start) <= day
  const confirmed = coachImports(athlete, asOf)
  const bySource = new Map(confirmed.filter(record => record.sourceRecordIdentity).map(record => [record.sourceRecordIdentity!, record]))
  const linked: string[] = []
  if (act && eligibleWatch(act)) {
    const record = act.sourceIdentity ? bySource.get(act.sourceIdentity) : undefined
    if (!record) linked.push(...activityFacts(act, laps).map(line => `关联训练（佳明手表）：${line}`))
    else {
      let readable = true
      try { const raw = currentStore()?.getItem(TRAINING_CORRECTION_KEY); if (raw && !Array.isArray(JSON.parse(raw)?.data)) readable = false } catch { readable = false }
      const correction = readTrainingCorrectionsAsOf(record.confirmedImportId, asOf)
      if (!readable || correction.unknownCommitTime.length || correction.voided) linked.push('关联训练已撤销或更正信息无法确认，未采用旧设备缓存数值。')
      else {
        const changed = (field: string) => correction.rows.some(change => change.kind === 'FIELD' && change.field === field)
        const revised = changed('distance') || changed('duration')
        const current = { ...act,
          dist: changed('distance') || record.totalDistanceMeters.status !== 'RECORDED' ? null : record.totalDistanceMeters.value,
          dur: changed('duration') || record.durationSeconds.status !== 'RECORDED' ? null : record.durationSeconds.value,
          rpe: changed('feedback') || record.sessionRpe.status !== 'RECORDED' ? null : record.sessionRpe.value! * 10,
        }
        if (revised) linked.push('关联训练已有更正：被更正的设备总量与原始分段已撤回，以当前确认的训练事实为准。')
        linked.push(...activityFacts(current, revised ? null : laps).map(line => `关联训练（同一条已确认手表记录）：${line}`))
      }
    }
  }
  // Confirmed imports remain readable without their optional display cache. Only uncaptured cache rows are supplemental.
  // Even a voided/corrected confirmed record owns its source identity, so its old cache cannot resurrect it.
  const recent = garminActivities().filter(a => eligibleWatch(a) && localDayOf(a.start) >= from && !(a.sourceIdentity && bySource.has(a.sourceIdentity)))
    .sort((a, b) => activityTs(b.start) - activityTs(a.start)).slice(0, 7)
  const watch = recent.map(a => `近期手表活动：${activityLocalDay(a.start)} ${sportLabel(a.type)} ${fmtDistance(a.dist) ?? '距离未知'} ${fmtDuration(a.dur)} 心率${fmtHr(a.avgHr) ?? '未知'}`)
  const legacy: string[] = []
  try {
    const components = loadOwnedComponents(store).days
    const rows = loadTrainingActivities().filter(r => r.v4 && r.date >= from && r.date <= day
      && (r.timeUnknown || activityTs(r.startedAt) <= cutoff) && v4AvailableAt(r.date, components[r.date], asOf))
      .sort((a, b) => b.date.localeCompare(a.date))
    legacy.push(...rows.map(r => v4FactLine(r.originIds.some(id => bySource.has(id)) ? { ...r, distanceM: null, durationSec: null } : r, components[r.date], asOf)))
    const seen = new Set(rows.map(r => r.date))
    // Keep valid historical actuals when their original plan is no longer active, using the same owner/time rules.
    const raw = read<Record<string, unknown>>('fk-plan400-v4-log', {})
    for (const date of Object.keys(raw ?? {}).filter(d => validDay(d) && d >= from && d <= day).sort().reverse()) {
      if (seen.has(date)) continue
      const line = ownedLegacyLine(date, asOf)
      if (line) legacy.push(`${line}（历史整课记录·旧口径·仅参考）`)
    }
  } catch { legacy.push('历史计划记录读取失败，不能把读取失败当作没有记录。') }
  const header = [`今天：${today}`, `查询日期：${day}`, `读取截止时间：${asOf}`,
    '口径：查询日期读取当前保存版本；饮食与体重缺少完整历史版本链，不能重建过去某时刻已知的全部记录。',
    '范围：当前运动员本机已保存的记录；未关联训练不影响读取饮食、训练、力量和恢复背景。各域缺失或不完整单独标明。',
    '相同来源的训练只计一次；计划不等于完成，旧整课评价不拆给跑步和力量。']
  // Independent budgets prevent a long plan or lap list from silently deleting later domains.
  // Total budgets, headings and separators stay below the existing 7800/8000 client/server limit.
  return [header.join('\n'), ...(history ? [boundedSection('历史执行画像（不是能力诊断）', history.split('\n'), 1100)] : []), boundedSection('资料与计划', profile, 650),
    boundedSection('饮食', [...nutrition.summary, ...nutrition.details], 1450),
    boundedSection('训练与力量', [...training.summary, ...linked, ...training.details.slice(0, 4), ...legacy, ...watch, ...training.details.slice(4)], 1750),
    boundedSection('健康与恢复', [...recovery.summary, ...recovery.details], 1500)].join('\n\n')
}

const availableTime = (time: string | undefined, asOf: string) => !time || Number.isFinite(Date.parse(time)) && Date.parse(time) <= Date.parse(asOf)
type LegacyRecord = { athleteId?: string; savedAt?: string; [key: string]: unknown }
function ownedLegacyLine(day: string, asOf: string): string | null {
  const row = read<Record<string, LegacyRecord>>('fk-plan400-v4-log', {})?.[day]
  if (!row || typeof row !== 'object' || !ownedBy(row, currentAthleteId()) || !availableTime(row.savedAt, asOf)) return null
  const fields = ['done', 'reps', 'rest', 'strength', 'rpe', 'pain', 'r24']
  const safe = { athleteId: currentAthleteId(), ...Object.fromEntries(fields.filter(key => typeof row[key] === 'string' || typeof row[key] === 'number').map(key => [key, row[key]])) }
  const base = currentStore()
  return v4RecordLine(day, { getItem: key => key === 'fk-plan400-v4-log' ? JSON.stringify({ [day]: safe }) : base?.getItem(key) ?? null })
}
function v4AvailableAt(day: string, components: DayComponents | undefined, asOf: string): boolean {
  const row = read<Record<string, LegacyRecord>>('fk-plan400-v4-log', {})?.[day]
  if (row && ownedBy(row, currentAthleteId()) && !availableTime(row.savedAt, asOf)) return false
  return [components?.running, components?.strength, components?.recovery].every(part => availableTime(part?.savedAt, asOf))
}
function boundedSection(title: string, lines: readonly string[], budget: number): string {
  const marker = '\n（本节部分明细已省略；不能据此认定没有其他记录。）'
  let out = `【${title}】`
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
    if (!line) continue
    if (out.length + line.length + 1 <= budget - marker.length) out += `\n${line}`
    else {
      const remaining = budget - out.length - marker.length - 2
      if (remaining > 25) out += `\n${line.slice(0, remaining)}…`
      return out + marker
    }
  }
  return out
}
/** 客户端问题上限与线上 /api/coach-chat 一致（v84 线上服务端截断到 1000 字）：超限直接拒绝、不 fetch，避免静默截断。
 * C03/R14 包里的 200 字上限属于未启用的 server/coach-deepseek 受控入口，线上未路由，故此处不采用 200。 */
export const ONLINE_QUESTION_MAX = 1000
export async function askOnlineCoach(input: { question: string; facts: string; local: string; history: { role: string; text: string }[] }, ms = 30000): Promise<{ text: string } | { error: string }> {
  // v86（R1.1 G04）：开关在这里再查一次——用户关掉联网后，任何调用方都不能再发出请求（不只靠界面判断）。
  if (!onlineSetting().on) return { error: '联网分析已关闭，已保留本地分析；没有上传数据' }
  const q = input.question.trim()
  // eslint-disable-next-line no-control-regex -- 有意拒绝控制字符
  if (!q || q.length > ONLINE_QUESTION_MAX || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(q)) return { error: `问题为空、含无效字符或超过${ONLINE_QUESTION_MAX}字，已保留本地分析；没有上传数据` }
  if (input.facts.length > 8000) return { error: '本轮事实摘要超过发送上限，已保留本地分析；没有上传数据' }
  // The live proxy caps Content-Length in bytes. Chinese text must not be budgeted as one byte per character.
  // Keep the full current facts and question; only older conversation and the optional local explanation shrink.
  const cycle = cycleCoachSummary();
  const cycleFacts = cycle && input.facts.length + cycle.length + 2 <= 8000 ? input.facts + '\n\n' + cycle : input.facts;
  const payload = { question: q, facts: cycleFacts, local: '', history: [] as typeof input.history }
  const bytes = () => new TextEncoder().encode(JSON.stringify(payload)).length
  const limit = 23_500
  const baseSize = bytes()
  if (baseSize > limit) return { error: '本轮事实摘要超过发送上限，已保留本地分析；没有上传数据' }
  const historyLimit = Math.min(limit, baseSize + 3000)
  for (const message of input.history.slice(-6).reverse()) {
    const entry = { role: message.role, text: message.text.slice(0, 400) }
    payload.history.unshift(entry)
    if (bytes() > historyLimit) { payload.history.shift(); break }
  }
  payload.local = input.local.slice(0, 3000)
  if (bytes() > limit) {
    const source = payload.local, marker = '（参考说明部分省略，以本轮事实为准）'
    let low = 0, high = source.length
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      payload.local = source.slice(0, mid).replace(/[\uD800-\uDBFF]$/, '') + marker
      if (bytes() <= limit) low = mid
      else high = mid - 1
    }
    payload.local = low ? source.slice(0, low).replace(/[\uD800-\uDBFF]$/, '') + marker : ''
  }
  const ownerAtRequest=currentAthleteId(), cutoff=new Date().toISOString(), analysisDayAtRequest=analysisDay(q,null,localDayOf(cutoff))
  let verified:ReturnType<typeof readAnalysis>
  try{verified=readAnalysis(analysisDayAtRequest,cutoff,q)}catch{return {error:'当前事实或安全依据不可核对，已保留本地回答'}}
  const contextVersion=()=>analysisDigest([readEffectiveProfile().version,readEffectiveTrainingProfile().version,readScheduleDocument(),readNutritionSourceForFreshness(),readCycleGoal(),currentStore()?.getItem('fk-plan-doc-v1')??null]);
  const contextAtRequest=contextVersion();
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms)
  try {
    const r = await fetch('/api/coach-chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: ac.signal })
    const j = await r.json().catch(() => ({}))
    if(!r.ok||typeof j.text!=='string'||!j.text.trim())return {error:j.error||`HTTP ${r.status}`}
    if(currentAthleteId()!==ownerAtRequest)return {error:'身份已变化，未显示其他账号的模型回答'}
    const latest=readAnalysis(analysisDayAtRequest,new Date().toISOString(),q)
    if(latest.revision!==verified.revision||contextAtRequest!==contextVersion())return {error:'模型等待期间训练或安全依据已变化，已保留本地回答'}
    const check=guardR5Reply(j.text,verified.packet)
    return check.ok?{text:j.text.slice(0,1000)}:{error:'模型内容未通过数值、来源或安全核验，已保留本地回答'}
  } catch { return { error: ac.signal.aborted ? '联网超时' : '网络不可用' } } finally { clearTimeout(t) }
}
