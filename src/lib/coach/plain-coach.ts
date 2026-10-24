import { mainTrainingLines } from '../plan/plan-main';
import { activityTs, activityLocalDay, fmtDistance, fmtDuration, fmtHr, fmtPaceSec } from '../ui/activity-format'
import { loadOwnedComponents, hasFeedback } from '../ui/plan400-components-store'
import { currentStore } from '../core/storage'
import { currentAthleteId } from '../core/events'
import { ownedBy } from '../core/ownership'
/** 方坤面向用户的“成熟教练”表达层：事实 → 目的 → 限定解释 → 观察；不生成未经批准的训练剂量。
 * 只读：不写计划、不改记录。内部事实/审计模型不变，这里只组织文字与联网上下文。 */
import { planDays, hasActivePlan, planTag, planDocumentKey, planPrefix } from '../plan/active-plan'
export type GActivity = { id: number | string; sourceIdentity?: string; name: string; type: string; start: string; dist: number | null; dur: number | null; avgHr: number | null; maxHr: number | null; cad: number | null; elev: number | null; cal: number | null; sets: number | null; reps: number | null; tl: number | null; te: number | null; ate?: number | null; rpe?: number | null }
export type GLap = { i: number; dist: number | null; dur: number | null; avgHr: number | null; maxHr: number | null; cad: number | null; elev: number | null; speed: number | null }

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

type Store = Pick<Storage, 'getItem'> | null
const browserStore = (): Store => currentStore() as Store
/** v86（R1.1）：内置 V4 课表只有在用户真的在用（本机有 V4 记录或分项记录）时才算“用户的计划”；
 * 新用户/别的运动员没有这份计划，不能把它当事实发出去或拿来对照。 */
export function plan400Active(store: Store = browserStore()): boolean {
  const has = (k: string, pick: (v: any) => unknown) => { try { const v = JSON.parse(store?.getItem(k) ?? 'null'); const x = v && pick(v); return !!x && typeof x === 'object' && Object.keys(x).length > 0 } catch { return false } }
  // v89.6：计划只来自本机已导入/生成的计划文档；没有文档 = 没有计划（旧记录照常是事实）。
  let stored = false; try { stored = store?.getItem(planDocumentKey()) != null } catch { stored = false }
  return hasActivePlan(store) && (stored || has('fk-plan400-v4-log', v => v) || has('fk-plan400-v4-components-v1', v => v.days))
}
const mmss = (s: number) => s >= 60 ? `${Math.floor(s / 60)}分${String(Math.round((s % 60) * 100) / 100).padStart(2, '0')}秒` : `${s}秒`
/** v86：目标只来自用户自己的设置（资料“目标成绩”）或用户在聊天里明确说过的目标；没有就返回 null（= 未知），绝不用内置课表名里的成绩。 */
export function userGoal(chatGoal?: { meters: number; toSeconds: number } | null, store: Store = browserStore()): string | null {
  const goals: string[] = []
  try {
    const marks = (JSON.parse(store?.getItem('fr255-profile-v1') ?? 'null')?.marks ?? []) as { meters?: number; goal?: string; deadline?: string }[]
    for (const m of Array.isArray(marks) ? marks : []) if (m && typeof m.goal === 'string' && m.goal.trim() && Number(m.meters) > 0) goals.push(`${m.meters}米 ${m.goal.trim()}${m.deadline ? `（日期 ${m.deadline}）` : ''}（用户在资料里设定）`)
  } catch { /* unreadable profile → unknown */ }
  if (chatGoal && Number.isFinite(chatGoal.meters) && Number.isFinite(chatGoal.toSeconds)) goals.push(`${chatGoal.meters}米 ${mmss(chatGoal.toSeconds)}（用户在聊天中明确说过）`)
  return goals.length ? goals.join('；') : null
}
/** 用户自己的 PB（资料“最近成绩”）。没有就是空。 */
export function userMarks(store: Store = browserStore()): string[] {
  try { const marks = (JSON.parse(store?.getItem('fr255-profile-v1') ?? 'null')?.marks ?? []) as { meters?: number; recent?: string }[]
    return (Array.isArray(marks) ? marks : []).filter(m => m && typeof m.recent === 'string' && m.recent.trim() && Number(m.meters) > 0).map(m => `${m.meters}米 最近成绩 ${m.recent!.trim()}（用户在资料里填写）`) } catch { return [] }
}
export function planFor(day: string, store: Store = browserStore(), chatGoal?: { meters: number; toSeconds: number } | null) {
  const active = plan400Active(store)
  const days = active ? [...planDays(store)].sort((a, b) => a.date.localeCompare(b.date)) : []
  const d = days.find(x => x.date === day), next = days.find(x => x.date > day)
  return { today: d ? `${d.date} ${d.title}：${mainTrainingLines(d).join('').replace(/观察：/, '；观察：')}` : null, next: next ? `${next.date} ${next.title}：${mainTrainingLines(next).join('').replace(/观察：/, '；观察：')}` : null, goal: userGoal(chatGoal, store), active }
}

/** V4 计划记录（首页/计划页/训练中写的 fk-plan400-v4-log）→ 一行事实。日志页与复盘读的是同一条。 */
export function v4RecordLine(day: string, store: Store = browserStore()): string | null {
  let l: Record<string, string> | undefined
  try { l = JSON.parse(store?.getItem('fk-plan400-v4-log') ?? '{}')?.[day] } catch { l = undefined }
  if (!l || typeof l !== 'object' || !ownedBy(l, currentAthleteId())) return null
  const d = planDays(store).find(x => x.date === day), st = l.done === 'done' ? '已完成' : l.done === 'reduced' ? '已完成·减量' : l.done === 'skipped' ? '取消' : '已记录未完成'
  const F: [string, string][] = [['reps', '成绩'], ['rest', '组间休息'], ['strength', '力量实际'], ['rpe', 'RPE'], ['pain', '疼痛'], ['r24', '24小时后'], ['note', '备注']]
  const parts = F.filter(([k]) => String(l![k] ?? '').trim()).map(([k, n]) => `${n} ${String(l![k]).trim().slice(0, 80)}`)
  return `${planPrefix(store)}计划记录（${day}${d ? ' ' + d.title : ''}）：${st}${parts.length ? '；' + parts.join('；') : ''}`
}
/** 只用运动类型，不用活动名（佳明默认活动名带城市）。 */
export const sportLabel = (t: string) => /track/.test(t) ? '田径场跑' : /treadmill/.test(t) ? '跑步机跑' : /trail/.test(t) ? '越野跑' : /run/.test(t) ? '跑步' : /strength/.test(t) ? '力量训练' : /cycl|bik/.test(t) ? '骑行' : /swim/.test(t) ? '游泳' : t || '训练'
/** 一次佳明跑步的事实摘要（联网和本地共用）。不含账号、位置。 */
export function activityFacts(a: GActivity, laps: GLap[] | null): string[] {
  const out: string[] = []
  const pace = a.dist && a.dur ? a.dur / (a.dist / 1000) : null
  out.push(`${localDayOf(a.start)} ${sportLabel(a.type)}：${fmtDistance(a.dist) ?? '距离未知'}，用时 ${durText(a.dur)}，平均配速 ${paceText(pace)}，平均心率 ${fmtHr(a.avgHr) ?? '—'}，最高心率 ${fmtHr(a.maxHr) ?? '—'}${a.cad ? `，步频 ${Math.round(a.cad)}` : ''}${a.elev != null ? `，爬升 ${Math.round(a.elev)} m` : ''}`)
  if (a.te != null || a.tl != null || a.ate != null) out.push(`手表训练效果：有氧 ${a.te ?? '—'}，无氧 ${a.ate ?? '—'}，训练负荷 ${a.tl != null ? Math.round(a.tl) : '—'}${a.rpe != null ? `，手表RPE原值 ${a.rpe}（量表待确认）` : ''}`)
  const runLaps = (laps ?? []).filter(l => lapPace(l) != null)
  if (runLaps.length) out.push('分段：' + runLaps.slice(0, 20).map(l => `第${l.i}段 ${fmtDistance(l.dist) ?? '?'} ${paceText(lapPace(l))} 心率${fmtHr(l.avgHr) ?? '—'}`).join('；'))
  return out
}

/** Activity facts are a separate source, never a physiology diagnosis from HR/TE. */
export function reviewActivity(a: GActivity, laps: GLap[] | null, today: string): string {
 const day=localDayOf(a.start),p=planFor(day)
 if(day>today)return '这次活动在复盘日期之后，不纳入这次判断。'
 const lines=[`结论：${day} ${fmtDistance(a.dist)?fmtDistance(a.dist)+' ':''}${durText(a.dur)}，平均 ${paceText(a.dist&&a.dur?a.dur/(a.dist/1000):null)}、心率 ${fmtHr(a.avgHr)??'未知'}。仅描述这条活动。`, `训练目的：${p.today??'UNKNOWN，请先确认原课目的'}；仅凭名称、心率或厂商训练效果不能确定训练目的是否实现。`]
 if(!isRun(a.type))return [...lines,'缺少逐组动作、重量、次数、RPE与组休时，无法判断具体肌群或实际力量剂量。'].join('\n')
 const valid=(laps??[]).filter(l=>lapPace(l)!==null)
 if(valid.length>=3){
  const half=Math.floor(valid.length/2),first=valid.slice(0,half),last=valid.slice(-half)
  const pace=(xs:GLap[])=>xs.reduce((n,l)=>n+l.dur!,0)/xs.reduce((n,l)=>n+l.dist!,0)*1000
  const delta=pace(last)-pace(first),hrComplete=[...first,...last].every(l=>l.avgHr!==null&&Number.isFinite(l.avgHr)&&l.avgHr>0)
  const hr=(xs:GLap[])=>xs.reduce((n,l)=>n+l.avgHr!,0)/xs.length
  lines.push(`分段事实：后半程比前半程${delta>0?'慢':'快'} ${Number(Math.abs(delta).toFixed(2))} 秒/公里；${hrComplete?`心率变化 ${Number((hr(last)-hr(first)).toFixed(2))} bpm`:'分段心率缺失或不完整，心率变化未知'}。工作段/恢复段及路况是否可比尚待核对，不把它当作疲劳诊断。`)
 }else lines.push('分段未充分记录；请在日志加载分段，保留组间和轮间休息。')
 const mark=v4RecordLine(day);if(mark)lines.push(mark+'（整课标记不代替跑步与力量各自实际记录）')
 lines.push('为什么：解释一，执行配速、休息或路线差异可能影响表现；若同协议、同条件仍出现变化，此解释减弱。', '解释二，近期训练与睡眠等恢复背景也可能参与；若热身功能、后续表现及主观反馈稳定，会削弱能力下降的判断。单节活动无法区分这些原因。')
 lines.push(p.goal?`对照目标（${p.goal}）：先核对本次目的，再讨论对目标的贡献。`:'目标：你还没有在资料里设定目标成绩，不能替你设定专项目标。')
 lines.push(`下一课怎么练：${p.next?`按你在用的计划：${p.next}。`:'按你自己的计划安排；这里不替你编新课。'}候选保持；先记录原热身功能、组休及分段/逐组完成量，再留24/48/72h反馈。疼痛或功能异常优先复核，不根据单一HRV、RHR或厂商分数减组或放行。任何变更须确认。`)
 if(a.rpe==null)lines.push('整课RPE未记录；没有整课实际时长与明确RPE口径时，不补算负荷。')
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
    '结论：同样的距离和组数，改变休息会改变下一组的执行条件，但不能只凭休息长短确定训练目的。',
    '短休：可能增加前一组对下一组的影响；需要同时知道实际速度、组数、完成质量和教练意图。不能直接等同乳酸耐受或有氧训练。',
    '长休：可能更有利于维持每组速度质量，但不保证组织完全恢复，也不自动等同比赛配速训练。',
    '怎么用：先确认原批准课程的目的、目标配速、组间及轮间休息。若比较方案，只比较一个变量；不新增全力测试或编造剂量。',
    '具体观察：保留已有课程的各组成绩、真实组休和RPE；若同协议休息安排下速度仍下降，再核对前置训练、睡眠和功能。出现疼痛不做试探测试。',
  ].join('\n')
}

/** 联网系统提示只有一份，在服务端 functions/api/coach-chat.js（客户端不再保留副本，避免两份规则不一致）。 */
