/** 复盘结果的“人话”版（v86.1，区块 review-view 入口）。纯函数：只用 OfflineReview 里已算好的数，
 * 不补数、不猜原因；内部术语和来源清单留给“查看依据”。不写存储、不改课表。 */
import type { OfflineReview } from '../../core/coach-offline-loop.ts'
import { clock, km, pacePerKm, type ReviewSessionSummary } from './session-option.ts'

export type PlannedRepeats = { count: number; distanceM: number; targetSec: number | null; restSec: number | null }
export type PlainSection = { key: 'how' | 'why' | 'next' | 'need' | 'safety'; title: string; lines: string[]; emphasis?: string }
export type PlainReview = { sections: PlainSection[]; evidence: string }

const n1 = (n: number) => `${Number(n.toFixed(1))}`
const strip = (t: string) => t
  .replace(/\[[^\]]*\]/g, '')
  .replace(/\b(?:UNKNOWN|UNAVAILABLE|NOT_RECORDED)\b/g, '未记录')
  .replace(/[；;]\s*$/g, '').replace(/\s+/g, ' ').trim()

const RATING: Record<string, (v: number) => string> = {
  SESSION_RPE: v => `整课吃力程度 ${n1(v)}/10`,
  SLEEP_HOURS: v => `睡眠 ${n1(v)} 小时`,
  SUBJECTIVE_RECOVERY: v => `自我恢复感 ${n1(v)}/10`,
  PAIN_SCORE: v => `疼痛 ${n1(v)}/10`,
  SORENESS: v => `酸痛 ${n1(v)}/10`,
}

/** “还需要你补什么”：只把能对上号的缺失翻成具体要做的记录；对不上的留在依据里。 */
const NEED: [RegExp, string][] = [
  [/课程目的|本课.*目的/, '这节课想练什么（比如速度、耐力还是放松跑）'],
  [/对应目标或计划条件/, '这节课的目标用时或目标配速'],
  [/实际跑步分段未记录/, '每一段跑了多远、用了多久'],
  [/组间或轮间恢复|恢复未知/, '每组之间休息了多久'],
  [/整课主观强度|整课RPE/, '整节课有多吃力（1–10 分）'],
  [/症状反馈/, '练的时候和练完有没有哪里疼（没有就记 0）'],
  [/睡眠/, '前一晚睡了几个小时'],
  [/周期/, '你现在处在哪个训练阶段（可在上面“我的背景”里填）'],
]

export function plainReview(review: OfflineReview, planned: PlannedRepeats | null = null, session: ReviewSessionSummary | null = null): PlainReview {
  const evidence = [review.text, review.details].filter(Boolean).join('\n\n')
  if (review.safetyRestricted) {
    return { sections: [{ key: 'safety', title: '先注意安全', lines: review.text.split('\n').map(strip).filter(Boolean) }], evidence }
  }
  const c = review.metrics
  const how: string[] = []
  let emphasis: string | undefined
  const g = c.groups[0]
  const groupPts = g ? c.points.filter(p => g.sourceIds.includes(p.sourceId)) : []
  if (g && g.distanceMeters) {
    const diff = g.firstToLastSeconds
    const trend = Math.abs(diff) < 1 ? '前后很均匀' : diff > 0 ? `越跑越慢，最后一组比第一组慢 ${n1(diff)} 秒` : `越跑越快，最后一组比第一组快 ${n1(-diff)} 秒`
    emphasis = `${g.count}×${g.distanceMeters}米 · 平均配速 ${g.averagePace}/公里`
    how.push(`每组用时：${groupPts.map(p => n1(p.seconds)).join(' → ')} 秒，${trend}。`)
    if (planned && planned.distanceM === g.distanceMeters) {
      const mean = groupPts.reduce((n, p) => n + p.seconds, 0) / groupPts.length
      const plan = `计划 ${planned.count}×${planned.distanceM}米${planned.targetSec !== null ? `、每组 ${n1(planned.targetSec)} 秒` : ''}`
      const done = g.count === planned.count ? '组数全部完成' : `实际完成 ${g.count} 组`
      const vs = planned.targetSec !== null ? `，平均每组比目标${mean > planned.targetSec ? '慢' : '快'} ${n1(Math.abs(mean - planned.targetSec))} 秒` : ''
      how.push(`${plan}；${done}${vs}。`)
    }
  } else if (!c.points.length && session && (session.distanceM || session.durationSec)) {
    // 整课只记了总距离/总用时（没有分段）：用选课里的同一份记录，不另算分段
    const pace = session.kind === 'RUN' || session.kind === 'RUN_REPEATS' ? pacePerKm(session.distanceM, session.durationSec) : null
    emphasis = [session.distanceM ? km(session.distanceM) : null, session.durationSec ? `用时 ${clock(session.durationSec)}` : null, pace ? `平均配速 ${pace}` : null].filter(Boolean).join(' · ')
  } else if (c.points.length) {
    for (const p of c.points.slice(0, 3)) how.push(`${p.distanceMeters ? `${p.distanceMeters}米，` : ''}用时 ${clock(p.seconds)}${p.pace ? `，配速 ${p.pace}/公里` : ''}。`)
    if (c.points.length > 3) how.push(`另有 ${c.points.length - 3} 段，见“查看依据”。`)
  }
  const rests = c.rests.map(r => r.seconds)
  if (rests.length) how.push(Math.min(...rests) === Math.max(...rests) ? `组间休息 ${n1(rests[0])} 秒。` : `组间休息 ${n1(Math.min(...rests))}–${n1(Math.max(...rests))} 秒。`)
  if (c.strength.length) {
    const kg = c.strength.map(s => s.kg).filter((k): k is number => k !== null)
    how.push(`力量 ${c.strength.length} 组${kg.length ? `，最重 ${n1(Math.max(...kg))}kg` : ''}。`)
  }
  const ratings = [...new Map(c.ratings.map(r => [r.metric, r])).values()].filter(r => RATING[r.metric]).map(r => RATING[r.metric](r.value))
  if (ratings.length) how.push(ratings.join('，') + '。')
  for (const h of review.historyMetrics.slice(0, 1)) how.push('和以前同样的课比：' + strip(h.text) + '。')
  if (!how.length && !emphasis) how.push('这次还没有可以分析的分段、用时或感受记录。')
  if (emphasis && !c.points.length) how.push('这次只有整课总数，没有分段，所以看不出前后快慢。')

  const why: string[] = []
  const [h1, h2] = review.hypotheses
  const first = (t: string) => { const x = strip(t).split(/[；;]/)[0].replace(/[。，,\s]+$/, ''); return x ? x + '。' : '' }
  if (h1) why.push(first(h1.explanation))
  if (h2 && first(h2.explanation)) why.push('另一种可能：' + first(h2.explanation))
  if (!why.length) why.push('现在的记录还不够判断原因，先把下面要补的记上。')

  const next: string[] = []
  const pain = c.ratings.find(r => r.metric === 'PAIN_SCORE' && r.value > 0)
  if (pain) next.push(`这次记录了疼痛 ${n1(pain.value)}/10：先停掉会引起疼痛的练习，疼痛消失、走路和日常活动正常后再恢复；持续或加重请找医生或理疗师。`)
  else if (g && g.distanceMeters && groupPts.length) {
    const mean = groupPts.reduce((n, p) => n + p.seconds, 0) / groupPts.length, target = Math.round(mean)
    const base = `下次同样的 ${g.count}×${g.distanceMeters}米`
    if (g.firstToLastSeconds >= 2) next.push(`${base}，每组都按 ${target} 秒左右跑（你这次的平均），第一组不要快于 ${target - 1} 秒；目标是最后一组和第一组相差不超过 2 秒。`)
    else if (g.firstToLastSeconds <= -2) next.push(`${base}，可以直接按 ${target} 秒左右起跑，一直保持均匀，不用前面留太多。`)
    else next.push(`${base}，保持 ${target} 秒左右和同样的休息；连续两次都这样稳定完成，再考虑每组快 1 秒。`)
    if (rests.length && Math.min(...rests) === Math.max(...rests)) next.push(`组间休息继续 ${n1(rests[0])} 秒，方便和这次比较。`)
  } else if (c.points.length === 1 && c.points[0].pace) next.push(`同样的距离下次保持 ${c.points[0].pace}/公里 左右的均匀配速，前后半程尽量一样快。`)
  else if (!c.points.length && session && pacePerKm(session.distanceM, session.durationSec)) next.push(`同样的 ${km(session.distanceM!)} 下次保持 ${pacePerKm(session.distanceM, session.durationSec)} 左右的均匀配速，前后半程尽量一样快；跑完记一下整课吃力程度（1–10）。`)
  else if (c.strength.length) next.push('下次同样的重量先做同样的组数，动作稳定、没有疼痛再加重量。')
  else next.push('下次练完把每段用时、组间休息和整课吃力程度（1–10）记下来，方坤才能给具体建议。')
  if (!pain) next.push('练的时候出现疼痛就停。')

  const haveRpe = c.ratings.some(r => r.metric === 'SESSION_RPE'), haveRest = rests.length > 0, haveSplits = c.points.length > 0, haveSleep = c.ratings.some(r => r.metric === 'SLEEP_HOURS')
  const need: string[] = []
  for (const m of review.missing) {
    const hit = NEED.find(([re]) => re.test(m))
    if (!hit) continue
    if ((hit[1].includes('吃力') && haveRpe) || (hit[1].includes('休息') && haveRest) || (hit[1].includes('跑了多远') && haveSplits) || (hit[1].includes('睡了') && haveSleep)) continue
    if (hit[1].includes('目标用时') && planned?.targetSec != null) continue
    const text = hit[1].includes('跑了多远') && session?.distanceM && session.durationSec ? '每公里的分段用时（手表里有就一起导入）' : hit[1]
    if (!need.includes(text)) need.push(text)
  }

  const sections: PlainSection[] = [
    { key: 'how', title: '这次练得怎么样', lines: how, emphasis },
    { key: 'why', title: '为什么', lines: why },
    { key: 'next', title: '下次怎么练', lines: next },
  ]
  if (need.length) sections.push({ key: 'need', title: '还需要你补什么', lines: need.slice(0, 4) })
  return { sections, evidence }
}
