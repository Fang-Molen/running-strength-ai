import { activityTs, activityLocalDay, fmtDistance, fmtDuration, fmtHr, fmtPaceSec } from '../ui/activity-format'
import { loadComponents, hasFeedback } from '../ui/plan400-components-store'
/** 方坤面向用户的“成熟教练”表达层：结论 → 生理原因 → 下一课处方；数据不够时直接说做什么测试、记什么。
 * 只读：不写计划、不改记录。内部事实/审计模型不变，这里只组织文字与联网上下文。 */
import plan from '../plan400-v4.json' with { type: 'json' }
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
  return { today: d ? `${d.date} ${d.title}：${d.main.slice(1).join('').replace(/观察：/, '；观察：')}` : null, next: next ? `${next.date} ${next.title}：${next.main.slice(1).join('').replace(/观察：/, '；观察：')}` : null, goal: '400米 53秒多（12/28 最终测试）' }
}

/** V4 计划记录（首页/计划页/训练中写的 fk-plan400-v4-log）→ 一行事实。日志页与复盘读的是同一条。 */
export function v4RecordLine(day: string, store: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): string | null {
  let l: Record<string, string> | undefined
  try { l = JSON.parse(store?.getItem('fk-plan400-v4-log') ?? '{}')?.[day] } catch { l = undefined }
  if (!l || typeof l !== 'object') return null
  const d = days.find(x => x.date === day), st = l.done === 'done' ? '已完成' : l.done === 'reduced' ? '已完成·减量' : l.done === 'skipped' ? '取消' : '已记录未完成'
  const F: [string, string][] = [['reps', '成绩'], ['rest', '组间休息'], ['strength', '力量实际'], ['rpe', 'RPE'], ['pain', '疼痛'], ['r24', '24小时后'], ['note', '备注']]
  const parts = F.filter(([k]) => String(l![k] ?? '').trim()).map(([k, n]) => `${n} ${String(l![k]).trim().slice(0, 80)}`)
  return `V4 计划记录（${day}${d ? ' ' + d.title : ''}）：${st}${parts.length ? '；' + parts.join('；') : ''}`
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

/** 本地“成熟教练”复盘：结论 → 原因 → 下一课怎么练；缺什么就说明去测什么。 */
export function reviewActivity(a: GActivity, laps: GLap[] | null, today: string): string {
  const day = localDayOf(a.start), pace = a.dist && a.dur ? a.dur / (a.dist / 1000) : null, p = planFor(day)
  if (day > today) return '这次活动在复盘日期之后，不纳入这次判断。'
  const runLaps = (laps ?? []).filter(l => lapPace(l) != null && (l.dist ?? 0) >= 400)
  const lines: string[] = []
  if (!isRun(a.type)) {
    lines.push(`结论：${day} 这次是${a.name || '非跑步训练'}，用时 ${durText(a.dur)}${a.avgHr ? `，平均心率 ${fmtHr(a.avgHr)}` : ''}${a.sets ? `，${a.sets} 组` : ''}。`)
    lines.push('下一步：力量课请在方坤里记下每个动作的重量×次数和RPE，我才能判断负荷是否合适。')
    return lines.join('\n')
  }
  // 结论
  let verdict = '', why = '', next = ''
  const easy = (a.avgHr != null && a.avgHr <= 150) || (a.te != null && a.te < 3)
  if (runLaps.length >= 3) {
    const half = Math.floor(runLaps.length / 2), first = runLaps.slice(0, half), last = runLaps.slice(-half)
    const avg = (xs: GLap[], f: (l: GLap) => number | null) => { const v = xs.map(f).filter((x): x is number => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null }
    // v84（合入 Codex 1019y）：分段心率缺失/为 0/不完整时心率变化是“未知”，不能当作 0（以前会说成“心率没明显飘”）
    const hrOk = (l: GLap) => typeof l.avgHr === 'number' && Number.isFinite(l.avgHr) && l.avgHr > 0
    const hrComplete = runLaps.every(hrOk)
    const p1 = avg(first, lapPace), p2 = avg(last, lapPace), h1 = hrComplete ? avg(first, l => l.avgHr) : null, h2 = hrComplete ? avg(last, l => l.avgHr) : null
    const drift = p1 && p2 ? p2 - p1 : 0, hrUp = h1 && h2 ? h2 - h1 : 0
    if (!hrComplete) { verdict = `后半程比前半程${drift <= 0 ? '快' : '慢'} ${Math.abs(Math.round(drift))} 秒/公里；分段心率缺失或不完整，心率变化未知。`; why = '只有配速数据，看不出心率漂移；配速变化可能来自分段任务不同、天气路线或疲劳，需要结合这节课原本的安排判断。' }
    else if (drift < -5) { verdict = `越跑越快（后半程快 ${Math.round(-drift)} 秒/公里${hrUp > 0 ? `，心率后程上升 ${Math.round(hrUp)}` : ''}），属于渐加速跑，完成得不错。`; why = '后程能提速说明前段节奏留有余地，这正是有氧课该有的样子。' }
    else if (drift <= 5 && hrUp > 5 && hrUp <= 10) { verdict = `配速很稳（后半程比前半程${drift <= 0 ? '快' : '慢'} ${Math.abs(Math.round(drift))} 秒/公里），心率后程上升 ${Math.round(hrUp)}，属于轻度心率漂移，整体是一次合格的${easy ? '有氧跑' : '训练'}。`; why = '同样配速下心率慢慢升高，主要是体温上升、出汗失水和慢肌疲劳，30 分钟左右升 5–10 次属于正常；如果超过 10 次或越跑越吃力，说明当天配速偏快或没恢复好。' }
    else if (drift <= 5 && hrUp <= 5) { verdict = `配速稳、心率没明显飘（后半程比前半程${drift <= 0 ? '快' : '慢'} ${Math.abs(Math.round(drift))} 秒/公里，心率 +${Math.round(hrUp)}），这是一次合格的${easy ? '有氧/恢复跑' : '中等强度跑'}。`; why = '前后半程配速和心率基本一致，说明这个速度在你的有氧能力范围内，乳酸没有明显堆积，恢复成本低。' }
    else if (drift > 5 && hrUp > 8) { verdict = `后半程掉速 ${Math.round(drift)} 秒/公里、心率还上升 ${Math.round(hrUp)}，这次强度对当天状态偏高。`; why = '速度降、心率反而升，是典型的心率漂移：体温和疲劳上来后，同样的速度要付出更多代价，常见原因是起步太快、睡眠/恢复不足或天气热。' }
    else { verdict = `整体平稳，后半程配速变化 ${Math.round(drift)} 秒/公里、心率变化 ${Math.round(hrUp)}。`; why = '变化在正常范围，没有看到明显的疲劳信号。' }
  } else {
    verdict = `平均 ${paceText(pace)}、心率 ${fmtHr(a.avgHr) ?? '—'}，${easy ? '强度属于轻松有氧，适合作为恢复或基础课。' : '强度中等偏上，算一次质量有氧。'}`
    why = easy ? '心率在有氧区间，主要刺激的是毛细血管、线粒体和脂肪供能，疲劳小，第二天能正常训练。' : `平均心率 ${fmtHr(a.avgHr)} 已接近乳酸阈附近，对有氧能力刺激较大，但恢复要 24–48 小时。`
  }
  lines.push(`结论：${day} ${fmtDistance(a.dist) ? fmtDistance(a.dist) + ' ' : ''}${durText(a.dur)}${runLaps.length >= 3 ? `（平均 ${paceText(pace)}，平均心率 ${fmtHr(a.avgHr) ?? '—'}）` : ''}，${verdict}`)
  { const v4 = v4RecordLine(day); if (v4) { let split = false; try { const c = loadComponents().days[day]; split = hasFeedback(c?.running) || hasFeedback(c?.strength) } catch { /* none */ } lines.push(split ? `${v4}（旧整课记录，仅参考；跑步、力量以分项记录为准）` : v4) } }
  lines.push(`为什么：${why}${a.te != null ? ` 手表有氧训练效果 ${a.te}${a.ate != null ? `、无氧 ${a.ate}` : ''}。` : ''}`)
  // 对照目标
  lines.push(`对照目标（${p.goal}）：这类${easy ? '轻松' : '中等'}有氧跑是 400 米的“底座”，提高恢复能力和后程耐受；它本身不练速度，速度要靠计划里的短距离快跑课。`)
  next = p.next ? `按计划 ${p.next}。` : '下一课：安排一次专项速度课。'
  if (!easy) next += ' 今天这次强度不低，下一课开始前如果腿沉或静息心率比平时高 5 次以上，先把快跑段减 1 组。'
  lines.push(`下一课怎么练：${next}`)
  if (!runLaps.length) lines.push('想看得更细：在日志里点开这次活动加载分段（或下次跑完同步一次），我就能看前后半程配速和心率漂移。')
  if (a.rpe == null) lines.push('另外：跑完在手表上给这次打个主观强度（RPE），负荷统计就能算出来。')
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
    '结论：同样是 400米×8，休 1 分钟和休 8 分钟是两种完全不同的课。',
    '· 休 1 分钟（不完全恢复）：练的是乳酸耐受和速度耐力。每组开始时心率和血乳酸都还没降下来，后几组是在“酸”的状态下维持速度，提高的是身体缓冲酸、清除乳酸、带着疲劳保持动作的能力。代价是配速只能跑到比赛配速的 85–90% 左右（例如 400 目标 53 秒，这类课每组大约 62–68 秒）。',
    '· 休 8 分钟（接近完全恢复）：练的是速度质量和比赛配速。磷酸原系统基本恢复，每组都能跑到接近或达到比赛配速（53–56 秒），练的是高速下的跑姿、步频和神经肌肉募集，让“目标速度”变得熟悉、轻松。代价是总刺激量小，对耐乳酸帮助有限。',
    '为什么：休息长短决定下一组开始时的身体状态——短休让疲劳累积，刺激偏代谢；长休让每组都“新鲜”，刺激偏速度和神经。',
    '怎么用：备战 400 米两种都要。离比赛远（现在到 11 月中）以短休/中休的速度耐力为主，每周 1 次；离比赛 4–6 周开始加长休息的比赛配速课，每周 1 次；两种课之间至少隔 48 小时。8 分钟长休的那节，每组成绩差超过 1.5 秒就停，不要硬凑组数。',
    '想确认哪种你更需要：做一次 300 米全力计时（记成绩），隔 10 分钟再做一次 300 米（记成绩）。第二次比第一次慢超过 2 秒，说明速度耐力是短板，多练短休；差得少但两次都慢，说明绝对速度是短板，多练长休快跑。',
  ].join('\n')
}

/** 联网系统提示：用户的教练标准。 */
export const COACH_SYSTEM_PROMPT = `你是“方坤”，一位经验丰富的短跑/400米专项教练，正在指导一名业余运动员（目标：400米跑进53秒多，12月28日最终测试）。
说话规则（必须遵守）：
1. 用平实的中文，像成熟教练当面说话。先给结论，再讲生理原因，最后给具体的下一课处方（距离×组数、配速/用时、休息、强度RPE）。
2. 一切分析要对照目标（400米53秒多）和当前训练计划来说。
3. 不要说“数据不足无法判断”“需要更多证据”这类空话。数据不够时，先基于已有事实给出最可能的判断，再明确说出要做什么测试、记录什么数据（例如“下次跑完记下每个400的成绩和组间休息”）。
4. 不使用术语堆砌和免责声明；不要说“可撤回”“候选”“审计”“已批准原课程”等系统用语。
5. 安全：出现胸痛、晕厥、呼吸困难、心悸、急性受伤或剧烈疼痛等，先让对方停止训练并就医，不给训练处方。疼痛时不建议加量。
6. 你只给建议，不会自动修改用户的训练计划；如建议调整计划，告诉用户可以在计划页自己改。
7. 只用下面“事实”里的数据，不编造成绩、心率或分段；回答控制在 350 字以内，分段清楚。`
