import { activityTs, activityLocalDay, fmtDistance, fmtDuration, fmtHr, fmtPaceSec } from '../ui/activity-format'
/** 只读事实表达层：事实与可能解释分开，不由心率阈值生成医学结论或新训练剂量。 */
import plan from '../plan400-v4.json' with { type: 'json' }
import { loadComponents, STATUS_TEXT } from '../ui/plan400-components-store'
import { dayStatus, STATUS_LABEL, hasRunPart, hasStrength, type V4Day } from '../ui/plan400-view'
export type GActivity = { id: number | string; sourceIdentity?: string; name: string; type: string; start: string; dist: number | null; dur: number | null; avgHr: number | null; maxHr: number | null; cad: number | null; elev: number | null; cal: number | null; sets: number | null; reps: number | null; tl: number | null; te: number | null; ate?: number | null; rpe?: number | null }
export type GLap = { i: number; dist: number | null; dur: number | null; avgHr: number | null; maxHr: number | null; cad: number | null; elev: number | null; speed: number | null }
type Day = { date: string; title: string; main: string[]; aux: string[]; strength: string[]; week: string }
const days = (plan as { days: Day[] }).days

export const isReviewAsk = (q: string) => /复盘|这节|这次训练|这次跑|今天.{0,3}(?:跑|练)得|昨天.{0,6}(?:跑|练|训练)|上一?次.{0,4}(?:跑|训练|课)|刚才.{0,4}(?:跑|练)|跑得怎么样|练得怎么样/.test(q)
export const localDayOf = (iso: string) => activityLocalDay(iso) ?? iso.slice(0, 10)
const shift = (day: string, n: number) => new Date(Date.parse(day + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10)

/** 默认关联：问“昨天/今天”就取那天最后一次；否则取最近一次。只在用户没手动选、也没选“不绑定”时使用。 */
export function pickDefaultActivity<T extends { start: string }>(question: string, rows: T[], today: string): T | null {
  const sorted = rows.filter(r => r.start && localDayOf(r.start) <= today).sort((a, b) => activityTs(b.start) - activityTs(a.start))
  const want = /昨天/.test(question) ? shift(today, -1) : /前天/.test(question) ? shift(today, -2) : /今天/.test(question) ? today : null
  return want ? sorted.find(r => localDayOf(r.start) === want) ?? null : sorted[0] ?? null
}
const isRun = (t: string) => /run|track|treadmill/.test(t)
export const paceText = (sec: number | null) => fmtPaceSec(sec) ?? '—'
const durText = (s: number | null) => fmtDuration(s)
const lapPace = (l: GLap) => l.dist && l.dur && l.dist > 50 ? l.dur / (l.dist / 1000) : null

export function planFor(day: string) {
  const d = days.find(x => x.date === day), next = days.find(x => x.date > day)
  return { today: d ? `${d.date} ${d.title}：${d.main.slice(1).join('').replace(/观察：/, '；观察：')}` : null, next: next ? `${next.date} ${next.title}：${next.main.slice(1).join('').replace(/观察：/, '；观察：')}` : null, goal: 'UNKNOWN（当前运动员的目标尚未在本接口确认）' }
}

/** V4 计划记录（首页/计划页/训练中写的 fk-plan400-v4-log）→ 一行事实。日志页与复盘读的是同一条。 */
export function v4RecordLine(day: string, store: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): string | null {
  let l: Record<string, string> | undefined
  try { l = JSON.parse(store?.getItem('fk-plan400-v4-log') ?? '{}')?.[day] } catch { l = undefined }
  const parts = loadComponents(store).days[day]
  const explicit = !!parts && (parts.running != null || parts.strength != null)
  if ((!l || typeof l !== 'object') && !explicit) return null
  l = l && typeof l === 'object' ? l : {}
  const d = days.find(x => x.date === day), status = d ? dayStatus(d as V4Day, l, day, false, { parts }) : null
  const st = explicit ? [
    ...(d && !hasRunPart(d as V4Day) ? [] : [`跑步 ${STATUS_TEXT[parts?.running?.status ?? 'not_recorded']}${parts?.running?.rpe != null ? ` · RPE ${parts.running.rpe}` : ''}`]),
    ...(d && !hasStrength(d as V4Day) ? [] : [`力量 ${STATUS_TEXT[parts?.strength?.status ?? 'not_recorded']}${parts?.strength?.rpe != null ? ` · RPE ${parts.strength.rpe}` : ''}`]),
    status ? `整课派生 ${STATUS_LABEL[status]}` : '整课状态未知',
    ...(l.done ? [`旧整课标记 ${l.done}（历史口径，不参与新分项完成判断）`] : []),
  ].join('；') : `历史整课口径：${l.done === 'done' ? '已完成' : l.done === 'reduced' ? '已完成·减量' : l.done === 'skipped' ? '取消' : '已记录未完成'}；不能拆成两项各自完成`
  const F: [string, string][] = [['reps', '历史手填成绩'], ['rest', '历史组间休息'], ['strength', '历史力量手填'], ['rpe', '历史整课RPE（不可拆分）'], ['pain', '疼痛'], ['r24', '24小时后'], ['note', '备注']]
  const legacyFields = F.filter(([k]) => String(l![k] ?? '').trim()).map(([k, n]) => `${n} ${String(l![k]).trim().slice(0, 80)}`)
  return `V4 计划记录（${day}${d ? ' 原计划「' + d.title + '」' : ''}）：${st}${legacyFields.length ? '；' + legacyFields.join('；') : ''}`
}
/** 只用运动类型，不用活动名（佳明默认活动名带城市）。 */
export const sportLabel = (t: string) => /track/.test(t) ? '田径场跑' : /treadmill/.test(t) ? '跑步机跑' : /trail/.test(t) ? '越野跑' : /run/.test(t) ? '跑步' : /strength/.test(t) ? '力量训练' : /cycl|bik/.test(t) ? '骑行' : /swim/.test(t) ? '游泳' : t || '训练'
/** 一次佳明跑步的事实摘要（联网和本地共用）。不含账号、位置。 */
export function activityFacts(a: GActivity, laps: GLap[] | null): string[] {
  const out: string[] = []
  const pace = a.dist && a.dur ? a.dur / (a.dist / 1000) : null
  out.push(`${localDayOf(a.start)} ${sportLabel(a.type)}：${fmtDistance(a.dist) ?? '距离未知'}，用时 ${durText(a.dur)}，平均配速 ${paceText(pace)}，平均心率 ${fmtHr(a.avgHr) ?? '—'}，最高心率 ${fmtHr(a.maxHr) ?? '—'}${a.cad ? `，步频 ${Math.round(a.cad)}` : ''}${a.elev != null ? `，爬升 ${Math.round(a.elev)} m` : ''}`)
  if (a.te != null || a.tl != null || a.ate != null) out.push(`手表训练效果：有氧 ${a.te ?? '—'}，无氧 ${a.ate ?? '—'}，训练负荷 ${a.tl != null ? Math.round(a.tl) : '—'}${a.rpe != null ? `，手表上记的RPE ${a.rpe / 10}` : ''}`)
  const runLaps = (laps ?? []).filter(l => lapPace(l) != null)
  if (runLaps.length) out.push('分段：' + runLaps.slice(0, 20).map(l => `第${l.i}段 ${fmtDistance(l.dist) ?? '?'} ${paceText(lapPace(l))} 心率${fmtHr(l.avgHr) ?? '—'}`).join('；'))
  return out
}

/** Read-only activity summary. Imported plans are context, never a new prescription. */
export function reviewActivity(a: GActivity, laps: GLap[] | null, today: string): string {
  const day = localDayOf(a.start)
  if (day > today) return '本次活动发生在复盘日期之后，不纳入本次判断。'
  const pace = a.dist && a.dur ? a.dur / (a.dist / 1000) : null
  const runLaps = (laps ?? []).filter(l => lapPace(l) != null && (l.dist ?? 0) >= 400)
  const lines: string[] = []
  if (!isRun(a.type)) {
    lines.push(`结论：${day} 这次是${sportLabel(a.type)}，用时 ${durText(a.dur)}${a.avgHr ? `，平均心率 ${fmtHr(a.avgHr)}` : ''}${a.sets ? `，${a.sets} 组` : ''}。`)
    lines.push('训练目的：UNKNOWN；请确认原计划目的。下一次观察：在已有课程中记录每个动作的重量、次数、实际组数和整课RPE；不据此新增训练剂量。')
    return lines.join('\n')
  }
  let verdict = `平均 ${paceText(pace)}、心率 ${fmtHr(a.avgHr) ?? '未知'}；平均心率不能单独确定个人强度区间。`
  if (runLaps.length >= 3) {
    const half = Math.floor(runLaps.length / 2), first = runLaps.slice(0, half), last = runLaps.slice(-half)
    const partPace = (xs: GLap[]) => xs.reduce((v, l) => v + l.dur!, 0) / (xs.reduce((v, l) => v + l.dist!, 0) / 1000)
    const drift = partPace(last) - partPace(first)
    const hrComplete = runLaps.every(l => l.avgHr != null && Number.isFinite(l.avgHr) && l.avgHr > 0)
    const hrAvg = (xs: GLap[]) => xs.reduce((v, l) => v + l.avgHr!, 0) / xs.length
    const hrUp = hrComplete ? hrAvg(last) - hrAvg(first) : null
    verdict = `后半程比前半程${drift <= 0 ? '快' : '慢'} ${Math.abs(Math.round(drift))} 秒/公里`
    if (hrUp == null) verdict += '；分段心率缺失或不完整，心率变化未知。'
    else verdict += `，心率变化 ${hrUp > 0 ? '+' : ''}${Math.round(hrUp)} 次/分（分段均值之差）。`
    if (drift > 0 && hrUp != null && hrUp > 0) verdict += ` 后半程掉速 ${Math.round(drift)} 秒/公里、心率还上升 ${Math.round(hrUp)}。`
  }
  lines.push(`结论：${day} ${fmtDistance(a.dist) ? fmtDistance(a.dist) + ' ' : ''}${durText(a.dur)}（平均 ${paceText(pace)}，平均心率 ${fmtHr(a.avgHr) ?? '未知'}），${verdict}`)
  { const v4 = v4RecordLine(day); if (v4) lines.push(v4) }
  lines.push('训练目的：UNKNOWN；仅凭距离、课程名称或平均心率不能确定。最重要的问题：这节课原计划希望训练什么？')
  lines.push('为什么：现有计时数据只能说明配速变化，不能据此确认心率稳定、乳酸变化或恢复状态。可能解释一是前段配速及各段任务不同；可能解释二是天气、路线或近期疲劳等背景不同。若原任务本来安排渐快/渐慢，或环境与个人状态不一致，就不能把变化归为能力短板。')
  if (a.te != null || a.ate != null) lines.push(`设备估计（非能力诊断）：有氧训练效果 ${a.te ?? '未知'}、无氧 ${a.ate ?? '未知'}。`)
  lines.push('下一次观察：继续已有且适用的批准课程，记录各段成绩、距离、组间休息、整课RPE和环境；与同协议历史比较。只有配速、休息和环境可比时，重复出现的变化才支持后程保持问题；任务或环境改变会削弱该解释。不自动减组、停训或新增测试；出现疼痛或急症先走安全处理。')
  if (!runLaps.length) lines.push('想看得更细：在日志里加载分段；未知的休息和心率继续保留未知。')
  if (a.rpe == null) lines.push('整课RPE尚未记录；训练负荷仅在实际时长和整课RPE都有效时计算，不用默认值补齐。')
  return lines.join('\n')
}

/** 间歇休息时长这类原理题：先给结论，再讲生理原因，再说怎么用。 */
export function intervalRestAnswer(q: string): string | null {
  if (!/(?:400|300|200|600|800)\s*(?:米|m)?\s*[×x*]\s*\d+/i.test(q) && !/间歇/.test(q)) return null
  if (!/休|歇|间隔|恢复|组间/.test(q)) return null
  // 只回答“休息长短有什么区别/怎么选”这类概念题；报了实际成绩的复盘题交给记录分析。
  if (!/区别|不同|差别|差异|vs|哪个|还是|有什么用|怎么选|作用|练什么/i.test(q)) return null
  if (/实际|完成了?|\d+\s*\/\s*\d+|\d+秒[，,、]\s*\d+/.test(q)) return null
  return [
    '结论：同一间歇结构中，休息长短会改变下一组开始时的恢复程度，但不能只凭休息时长确定训练目的。',
    '较短休息可能让前组影响延续，较长休息通常更利于保持单组速度质量；实际效果还取决于配速、组数、恢复方式和个人背景。短休不能直接等同乳酸耐受，长休也不证明已完全恢复。',
    '怎么用：优先保留原教练目的和已批准课程，不从这道原理题另配400米次数、比赛配速或全力测试。',
    '下一次观察：在原有课程中记录每组实际成绩、组间休息、RPE及环境，核对目标是否完成；如果任务、配速或休息不一致，就不能把成绩差异直接判为速度或速度耐力短板。',
    '最重要的问题：你是在比较已有课程，还是想了解原教练为什么安排这段休息？',
  ].join('\n')
}

/** Legacy export retained for compatibility; live prompt policy belongs to the trusted server. */
export const COACH_SYSTEM_PROMPT = `你是方坤。先用可核对的本地计算事实，再说明课程目的、最多两种有依据的解释及反证、缺失数据和下一次观察。
未知目标、训练目的或数据保留UNKNOWN；不预设项目、成绩、比赛日、个人心率区间或恢复时限。
只读当前运动员、当前as-of范围内的有效证据。研究候选阈值不能决定减量、停训或医学回归。
仅提出有依据的观察或适用的已批准课程候选，不编造剂量，不修改正式计划。
胸痛、晕厥、呼吸困难、急性损伤等优先走现有安全规则，不给普通训练处方。`
