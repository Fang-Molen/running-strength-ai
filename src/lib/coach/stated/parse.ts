/** 方坤“题面事实”解析（v86，R1.1）：只读、不存储。把用户这句话里给出的数字和否定条件变成结构化事实，
 * 供本地回答直接引用和计算。不推断没给的数，不把计划/目标当实际，不把别人的数据写成本人记录。 */
import { contextClauses, negatedAt } from '../../../safety/redflag/context.ts'

export type StatedSet = { label: string; reps: number | null; meters: number | null; targetSec: number | null; targetSeries?: number[]; splits: Array<number | null>; restSec: number | null; rpe: number | null; date: string | null }
export type PlanActual = { meters: number | null; planSec: number; actualSec: number }
export type Baseline = { label: string; unit: string; base: number; today: number | null; todayNull: boolean }
export type DistanceTime = { meters: number; seconds: number }
export type StrengthSet = { kg: number; reps: number; sets: number; date: string | null }
export type Rounds = { rounds: number; perRound: number; meters: number; eachSec: number; repRest: number | null; roundRest: number | null }
export type Statuses = { planned: number; completed: number; skipped: number; notRecorded: number }
export type Symptom = { term: string; label: string; state: 'PRESENT' | 'ABSENT' }
export type StatedFacts = {
  raceDays: { race: string; asOf: string; days: number } | null; raceUndecided: boolean
  energy: { kcal: number; partial: boolean; whole: boolean } | null
  priorLast: number[] | null; corrected: { meters: number; from: number; to: number } | null
  budget: { estimate: number; cap: number | null; remaining: number | null } | null; sessionRpeNull: boolean
  result: { sec: number; pb: number | null; target: number | null } | null; hrvMetricMismatch: string | null
  changes: { label: string; from: number; to: number; unit: string }[]
  sets: StatedSet[]; rounds: Rounds | null; statuses: Statuses | null; planActual: PlanActual[]; distanceTimes: DistanceTime[]; strength: StrengthSet[]
  secondsToMinutes: number | null; sessionMinutes: number | null; sessionRpe: number | null
  /** v87：用户说“只剩/还剩N分钟”并问怎么安排（剩余任务），只记这个数，不推出剂量 */
  remainingMinutes: number | null
  pain: { score: number; where: string | null }[]; painFree: boolean
  recovery10: number | null; readiness: number | null; sleepHours: number | null; sleepRange: [number, number] | null
  baselines: Baseline[]; weekly: number[]; symptoms: Symptom[]; recentInjury: string | null; notAssessed: boolean
}

const num = (s: string) => Number(s)
/** “2:30”“5:10”“86”“30.0” → seconds; null for tokens that are not times. */
export function timeToken(raw: string): number | null {
  const t = raw.trim().replace(/[秒s]$/i, '')
  const clock = t.match(/^(\d{1,3})[:′'](\d{1,2}(?:\.\d+)?)$/)
  if (clock) return Number(clock[2]) < 60 ? num(clock[1]) * 60 + num(clock[2]) : null
  const n = Number(t); return t && Number.isFinite(n) && n > 0 ? n : null
}
const TOKEN = String.raw`\d{1,4}(?:[:′']\d{1,2})?(?:\.\d{1,3})?`
// A run of ≥2 times: 30/31/32、238/240/241、30、31、32、33秒、[240,240,241,240]
// NFKC turns “，” into “,”, so a plain comma only separates times inside [...]; “/” and “、” separate anywhere.
const SERIES = new RegExp(String.raw`\[(${TOKEN}(?:\s*,\s*${TOKEN}){1,40})\]\s*(秒|s)?|(${TOKEN}(?:\s*(?:\/|、)\s*${TOKEN}){1,40})\s*(秒|s|kg|公斤|公里|km|米|m|分钟)?`, 'g')
const STRUCT = /(\d{1,2})\s*[×x*]\s*(\d{2,5}(?:\.\d+)?)(?![\d.])\s*(米|m|公里|km)?(?!\s*(?:kg|公斤|次|组))|(\d{2,5})\s*(米|m)\s*[×x*]\s*(\d{1,2})(?!\d)/g

function setsOf(q: string): StatedSet[] {
  const structs = [...q.matchAll(STRUCT)].map(m => m[1] ? { at: m.index!, end: m.index! + m[0].length, reps: num(m[1]), meters: num(m[2]) * (/公里|km/.test(m[3] ?? '') ? 1000 : 1), unit: !!m[3] } : { at: m.index!, end: m.index! + m[0].length, reps: num(m[6]), meters: num(m[4]), unit: true })
    .filter(s => s.unit || s.meters >= 50)
  const out: StatedSet[] = []
  let pendingTargets: number[] | null = null
  for (const m of q.matchAll(SERIES)) {
    const at = m.index!, unit = m[2] ?? m[4] ?? '', body = m[1] ?? m[3]
    if (/kg|公斤|公里|km|^米$|^m$|分钟/.test(unit)) continue
    const before = q.slice(Math.max(0, at - 12), at)
    if (/(?:周量|周跑量|跑量|量|基线|范围|恢复|疼痛|痛|准备度|评分|rpe|RPE|\d{1,2}-)\s*$/.test(before) || /^\s*(?:\/\s*10|\/\s*100)(?![\d./])/.test(q.slice(at + m[0].length))) continue
    if (/^\d+(?:\.\d+)?\s*\/\s*10{1,2}$/.test(body.trim()) && Number(body.split('/')[0]) <= 100) continue
    if (/^\d{1,2}-\d/.test(q.slice(at - 3, at + 3))) continue
    const values = body.split(/\s*(?:\/|、|,)\s*/).map(timeToken)
    if (values.length < 2) continue
    // nearest preceding structure inside the same sentence-ish window
    const st = [...structs].reverse().find(s => s.end <= at && !/[。；;]/.test(q.slice(s.end, at)) && at - s.end <= 60) ?? [...structs].reverse().find(s => s.end <= at && at - s.end <= 160)
    const between = st ? q.slice(st.end, at) : q.slice(Math.max(0, at - 30), at)
    if (/计划|目标表|目标为|目标均为/.test(between.slice(-8)) && !/实际|实/.test(between.slice(-6))) {
      // “目标表为[240,240,240,240]” is a plan series, not an actual
      pendingTargets = values.filter((v): v is number => v !== null); continue
    }
    const after = q.slice(at + m[0].length, at + m[0].length + 40).split(/[。；;]|\d{1,2}-\d{1,2}|(?=\d+\s*[×x*]\s*\d)/)[0]
    const target = between.match(/(?:目标|意图)(?:均匀|均为|均|各|每段|每次|是|为)?\s*(\d{1,4}(?:[:′']\d{1,2})?(?:\.\d+)?)\s*秒?/)
    const rest = (after.match(/(?:实休|趟休|组休|休息|恢复|休)(?:均|各|均为|为)?\s*(\d+(?:\.\d+)?)\s*(秒|分钟|分)/) ?? between.match(/(?:实休|趟休|组休|休息|恢复|休)(?:均|各|均为|为)?\s*(\d+(?:\.\d+)?)\s*(秒|分钟|分)/))
    const rpe = after.match(/rpe\s*(\d+(?:\.\d+)?)/i)
    const date = (q.slice(Math.max(0, at - 30), at).match(/(\d{1,2}-\d{1,2}|\d{1,2}月\d{1,2}日|\d{1,2}日|W\d|上次)[^\d]{0,12}$/) ?? [])[1] ?? null
    const series = pendingTargets && pendingTargets.length === values.length ? pendingTargets : null; pendingTargets = null
    out.push({ label: st ? `${st.reps}×${st.meters}米` : '分段', reps: st?.reps ?? null, meters: st?.meters ?? null,
      targetSec: series ? (series.every(v => v === series[0]) ? series[0] : null) : target ? timeToken(target[1]) : null, ...(series && !series.every(v => v === series[0]) ? { targetSeries: series } : {}), splits: values, restSec: rest ? num(rest[1]) * (rest[2] === '秒' ? 1 : 60) : null, rpe: rpe ? num(rpe[1]) : null, date })
  }
  // “第1次32秒、第2次34秒，第3次实际用时为null”
  const nth = [...q.matchAll(/第\s*(\d+)\s*(?:次|段)(?:实际(?:用时)?)?(?:为|是)?\s*(\d+(?:\.\d+)?\s*秒|null|NOT_RECORDED|SKIPPED)/gi)]
  if (!out.length && nth.length >= 2) { const st = structs[0]; const vals = nth.map(m => /秒/.test(m[2]) ? num(m[2].replace(/秒/, '')) : null)
    out.push({ label: st ? `${st.reps}×${st.meters}米` : '分段', reps: st?.reps ?? nth.length, meters: st?.meters ?? null, targetSec: null, splits: vals, restSec: null, rpe: null, date: null }) }
  const fl = q.match(/(?:各|两段各)?(\d{2,5})\s*米[^。；]{0,12}?第一段\s*(\d+(?:\.\d+)?)\s*秒[、,\s]*(?:末段|最后一段|第二段)\s*(\d+(?:\.\d+)?)\s*秒/)
  if (fl && !out.length) out.push({ label: `首末两段（各${fl[1]}米）`, reps: 2, meters: num(fl[1]), targetSec: null, splits: [num(fl[2]), num(fl[3])], restSec: null, rpe: null, date: null })
  return out.filter(s => s.splits.length || s.targetSec !== null)
}

function roundsOf(q: string): Rounds | null {
  const m = q.match(/(\d+)\s*轮[^。；]{0,4}?每轮\s*(\d+)\s*次\s*(\d{2,5})\s*米[^。；]{0,10}?均\s*(\d+(?:\.\d+)?)\s*秒/)
  if (!m) return null
  const rep = q.match(/(?:相邻两次之间|每轮内部[^。；]{0,10}?)实?休\s*(\d+)\s*秒/), round = q.match(/两轮之间(?:只休一次|只休|休)?\s*(\d+)\s*秒/)
  return { rounds: num(m[1]), perRound: num(m[2]), meters: num(m[3]), eachSec: num(m[4]), repRest: rep ? num(rep[1]) : null, roundRest: round ? num(round[1]) : null }
}
function statusesOf(q: string): Statuses | null {
  const planned = q.match(/计划\s*(\d+)\s*次/), c = q.match(/(\d+)\s*次\s*COMPLETED/i), s = q.match(/(\d+)\s*次\s*SKIPPED/i), n = q.match(/(\d+)\s*次\s*NOT_RECORDED/i)
  if (!(planned && c)) {
    const sk = [...q.matchAll(/第\s*\d+\s*次[^。；,]{0,6}?SKIPPED/gi)].length, nr = [...q.matchAll(/第\s*\d+\s*次[^。；,]{0,6}?NOT_RECORDED/gi)].length
    const st = q.match(/计划\s*(\d+)\s*[×x*]\s*\d+/), done = q.match(/第\s*1\s*至\s*(\d+)\s*次实际/)
    if ((sk || nr) && st && done) return { planned: num(st[1]), completed: num(done[1]), skipped: sk, notRecorded: nr }
  }
  return planned && c ? { planned: num(planned[1]), completed: num(c[1]), skipped: s ? num(s[1]) : 0, notRecorded: n ? num(n[1]) : 0 } : null
}
const SYMPTOMS: [RegExp, string][] = [[/胸痛|胸口压迫|胸闷/g, '胸痛/胸闷'], [/晕厥|昏厥|晕倒/g, '晕厥'], [/发热|发烧/g, '发热'], [/急性骨痛|骨痛/g, '急性骨痛'], [/麻木/g, '麻木'], [/畸形/g, '畸形'], [/冷汗/g, '冷汗'], [/呼吸困难/g, '呼吸困难']]
function symptomsOf(q: string): Symptom[] {
  const out = new Map<string, Symptom>()
  for (const clause of contextClauses(q)) for (const [re, label] of SYMPTOMS) for (const m of clause.matchAll(re)) {
    const state = negatedAt(clause, m.index!, m[0].length) ? 'ABSENT' : 'PRESENT'
    const prev = out.get(label); if (!prev || state === 'PRESENT') out.set(label, { term: m[0], label, state })
  }
  return [...out.values()]
}

export function parseStatedFacts(input: string): StatedFacts {
  const q = input.normalize('NFKC').replace(/\s+/g, ' ').slice(0, 8000)
  const planActual: PlanActual[] = [...q.matchAll(/(?:(\d+(?:\.\d+)?)\s*(米|m|公里|km)[^。；;]{0,12}?)?(?:计划|目标)(?:用时|时间)?\s*(\d+(?:[:′']\d{1,2})?(?:\.\d+)?)\s*秒?[，,、\s]*实际(?:用时)?\s*(\d+(?:[:′']\d{1,2})?(?:\.\d+)?)\s*秒?(?![/、\d])/g)]
    .flatMap(m => { const p = timeToken(m[3]), a = timeToken(m[4]); return p !== null && a !== null ? [{ meters: m[1] ? num(m[1]) * (/公里|km/.test(m[2]) ? 1000 : 1) : null, planSec: p, actualSec: a }] : [] })
  const distanceTimes: DistanceTime[] = []
  for (const m of q.matchAll(/(\d+(?:\.\d+)?)\s*(公里|km|米|m)(?:一段|一次)?[，,\s]*(?:实际|用时|用了|跑了)\s*(\d+(?:[:′']\d{1,2})?(?:\.\d+)?)\s*(秒|分钟|分)?/g)) {
    if (/[×x*]\s*$/.test(q.slice(0, m.index))) continue
    const t = timeToken(m[3]); if (t === null) continue
    distanceTimes.push({ meters: num(m[1]) * (/公里|km/.test(m[2]) ? 1000 : 1), seconds: /分/.test(m[4] ?? '') && !/[:′']/.test(m[3]) ? t * 60 : t })
  }
  for (const m of q.matchAll(/(?<![\d×x*.])(\d{2,5})\s*米\s*(?:存为|为)?\s*(\d{2,4}(?:\.\d+)?)\s*秒(?![/、\d])/g)) {
    if (/[×x*]\s*$/.test(q.slice(0, m.index)) || /\/\s*$/.test(q.slice(0, m.index))) continue
    if (!distanceTimes.some(d => d.meters === num(m[1]) && d.seconds === num(m[2]))) distanceTimes.push({ meters: num(m[1]), seconds: num(m[2]) })
  }
  const strength: StrengthSet[] = []
  for (const m of q.matchAll(/(\d+(?:\.\d+)?)\s*(?:kg|公斤)\s*[×x*]\s*(\d+)\s*次?(?:\s*共\s*(\d+)\s*组)?/gi)) {
    const pre = q.slice(Math.max(0, m.index! - 10), m.index), groups = m[3] ? num(m[3]) : (pre.match(/([一二两三四五六七八九\d])\s*组(?:实际)?(?:均|各)?(?:记录|为|都是|均为)?\s*$/)?.[1] ?? null)
    const cn: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
    const day = (q.slice(Math.max(0, m.index! - 40), m.index).match(/(\d{1,2}月\d{1,2}日|\d{1,2}-\d{1,2})(?!.*(?:\d{1,2}月\d{1,2}日|\d{1,2}-\d{1,2}))/) ?? [])[1] ?? null
    strength.push({ kg: num(m[1]), reps: num(m[2]), sets: groups === null ? 1 : typeof groups === 'number' ? groups : cn[groups] ?? Number(groups), date: day })
  }
  const ser = q.match(/([一二两三四五六七八九\d])\s*组各\s*(\d+)\s*次[^。；]{0,12}?((?:\d+(?:\.\d+)?\s*\/\s*)+\d+(?:\.\d+)?)\s*(?:kg|公斤)/i)
  if (ser) for (const kg of ser[3].split('/')) strength.push({ kg: num(kg.trim()), reps: num(ser[2]), sets: 1, date: null })
  const pain: { score: number; where: string | null }[] = []
  for (const m of q.matchAll(/((?:普通|日常)?(?:走路|行走|跑步|跑|负重))?(?:疼痛|痛)(?:评分|程度)?\s*(\d+(?:\.\d+)?)\s*(?:\/\s*10|分)?(?![\d.])/g)) pain.push({ score: num(m[2]), where: m[1] ?? null })
  const painFree = /无痛|无疼痛|没有疼痛|不痛|完成组无疼痛/.test(q) || (pain.length > 0 && pain.every(p => p.score === 0))
  const g = (re: RegExp) => { const m = q.match(re); return m ? num(m[1]) : null }
  const baselines: Baseline[] = []
  const rhrBase = q.match(/(?:静息心率|晨脉)(?:个人)?(?:\d+周)?基线\s*(\d{2,3})|基线\s*(\d{2,3})[^。；]{0,6}?(?:静息心率|晨脉)|(?:而|，)?个人基线\s*(\d{2,3})/) ?? q.match(/(?:静息心率|晨脉)\s*\d{2,3}[^。；\d]{0,4}基线\s*(\d{2,3})/)
  const rhrToday = q.match(/(?:今天|今日)?(?:静息心率|晨脉)\s*(\d{2,3})(?!\s*ms)/g) ?? q.match(/(?:静息心率|晨脉)[^。；\d]{0,6}基线\s*\d{2,3}[、，,]\s*(?:今天|今日)\s*\d{2,3}(?!\s*ms)/g)?.map(t => t.replace(/^.*(?:今天|今日)\s*/, ''))
  if (rhrBase) { const base = num(rhrBase[1] ?? rhrBase[2] ?? rhrBase[3]); const todays = (rhrToday ?? []).map(t => num(t.match(/(\d{2,3})/)![1])).filter(Number.isFinite); baselines.push({ label: '静息心率', unit: '次/分', base, today: todays.at(-1) ?? null, todayNull: false }) }
  const hrvBase = q.match(/RMSSD\s*基线\s*(\d{2,3})\s*ms|RMSSD[^。；]{0,4}基线\s*(\d{2,3})\s*ms/i) ?? q.match(/RMSSD[^。；]{0,4}均值\s*(\d{2,3})/i) ?? q.match(/RMSSD\s*(?:今天|今日)\s*\d{2,3}\s*ms[、，,]\s*基线\s*(\d{2,3})\s*ms/i)
  if (hrvBase) { const base = num(hrvBase[1] ?? hrvBase[2]); const today = q.match(/(?:今天|今日)[^。；]{0,10}?RMSSD\s*(?:值为)?\s*(\d{2,3})\s*ms/i) ?? q.match(/今天[^。；]{0,30}?指标名是RMSSD[^。；]{0,4}?显示\s*(\d{2,3})\s*ms/i) ?? q.match(/RMSSD\s*(\d{2,3})\s*ms(?![^。；]{0,3}基线)/i) ?? q.match(/RMSSD\s*(?:今天|今日)\s*(\d{2,3})\s*ms/i) ?? q.match(/RMSSD\s*基线\s*\d{2,3}\s*ms[、，,]\s*(?:今天|今日)\s*(\d{2,3})\s*ms/i); const nullToday = /今日?RMSSD值为null|今天?RMSSD[^。；]{0,4}null/i.test(q)
    baselines.push({ label: 'RMSSD', unit: 'ms', base, today: today ? num(today[1]) : null, todayNull: nullToday }) }
  const sleepRange = q.match(/睡(?:眠)?[^。；，,]{0,8}?(\d+(?:\.\d+)?)\s*(?:到|至|-|~)\s*(\d+(?:\.\d+)?)\s*小时/)
  const weekly = (q.match(/周(?:跑)?量[^。；]{0,8}?((?:\d+(?:\.\d+)?\s*\/\s*){1,8}\d+(?:\.\d+)?)\s*公里/)?.[1] ?? '').split('/').filter(Boolean).map(Number)
  const injury = q.match(/((?:\d+|[一二两三四五六七八九十])\s*(?:天|周)前[^。；]{0,24}?(?:拉伤|拉扯痛|扭伤|突然[^。；]{0,6}痛))/)
  return {
    raceDays: (() => { const r = q.match(/比赛(?:日|日期)?(?:是|为)?\s*(\d{4}-\d{2}-\d{2})/), a = q.match(/(?:当前(?:场景时点)?|现在|当前日期)\s*(\d{4}-\d{2}-\d{2})/); if (!r || !a) return null
      return { race: r[1], asOf: a[1], days: Math.round((Date.parse(r[1]) - Date.parse(a[1])) / 864e5) } })(),
    raceUndecided: /比赛日期(?:未确定|未定|还没定|待定)/.test(q),
    energy: (() => { const m = q.match(/(\d{2,5})\s*kcal/i); return m ? { kcal: num(m[1]), partial: /仅早餐|未录|只记了|部分/.test(q), whole: /全天(?:全部)?[^。；]{0,10}(?:已|均已)?如实录入|全天全部/.test(q) } : null })(),
    priorLast: (() => { const m = q.match(/(?:此前|之前|上次)[^。；]{0,12}?末段(?:分别)?\s*(\d+(?:\.\d+)?)\s*(?:和|、|\/)\s*(\d+(?:\.\d+)?)\s*秒/); return m ? [num(m[1]), num(m[2])] : null })(),
    corrected: (() => { const d = q.match(/(\d{2,5})\s*米\s*(\d{2,4}(?:\.\d+)?)\s*秒/), c = q.match(/(?:当前值为|更正(?:为|后为)|更正V\d[:：])\s*(\d{2,4}(?:\.\d+)?)\s*秒/); return d && c && num(c[1]) !== num(d[2]) ? { meters: num(d[1]), from: num(d[2]), to: num(c[1]) } : null })(),
    budget: (() => { const e = q.match(/预估[^。；]{0,8}?(\d+(?:\.\d+)?)\s*个?(?:测试)?计费单位/); if (!e) return null; const cap = q.match(/单次上限\s*(\d+(?:\.\d+)?)/), rem = q.match(/剩余额度\s*(\d+(?:\.\d+)?)/); return { estimate: num(e[1]), cap: cap ? num(cap[1]) : null, remaining: rem ? num(rem[1]) : null } })(),
    sessionRpeNull: /整课s?RPE(?:字段)?(?:为|是)?\s*null/i.test(q),
    result: (() => { const r = q.match(/(?:成绩|更正[^。；]{0,16}?为)\s*(\d{1,2}:\d{2})(?!\d)/); if (!r) return null; const pb = q.match(/PB\s*(\d{1,2}:\d{2})/), t = q.match(/目标\s*(\d{1,2}:\d{2})|(\d{1,2}:\d{2})\s*目标/)
      return { sec: timeToken(r[1])!, pb: pb ? timeToken(pb[1]) : null, target: t ? timeToken(t[1] ?? t[2]) : null } })(),
    hrvMetricMismatch: /RMSSD/i.test(q) && /SDNN/i.test(q) ? '今天的读数是另一台设备的SDNN，基线是RMSSD：指标不同，不能直接算“较基线下降多少%”；这不妨碍用实际分段复盘训练。' : null,
    changes: [...q.matchAll(/(体重|周跑量|跑量)[^。；]{0,6}?从\s*(\d+(?:\.\d+)?)\s*(?:kg|公斤|公里)?\s*(?:降到|减到|加到|增到|升到|到)\s*(\d+(?:\.\d+)?)\s*(kg|公斤|公里)/g)].map(m => ({ label: m[1], from: num(m[2]), to: num(m[3]), unit: m[4] === '公斤' ? 'kg' : m[4] })),
    sets: setsOf(q), rounds: roundsOf(q), statuses: statusesOf(q), planActual, distanceTimes: planActual.length ? [] : distanceTimes, strength,
    secondsToMinutes: /换算成分钟|换成分钟|折合.{0,3}分钟/.test(q) ? g(/(\d+(?:\.\d+)?)\s*秒/) : g(/(\d+(?:\.\d+)?)\s*秒\s*(?:是|等于|合|折合|换算成?)?\s*(?:多少|几)\s*分钟?/),
    remainingMinutes: /怎么安排|怎么办|做什么|练什么|怎么练|怎么用|如何安排/.test(q) ? g(/(?:只剩|还剩|剩下|仅剩)\s*(\d+(?:\.\d+)?)\s*分钟/) : null,
    sessionMinutes: g(/(?:整课|完整时长|完成整课|总时长|整课时长)\s*(\d+(?:\.\d+)?)\s*分钟/),
    sessionRpe: g(/(?:整课s?RPE|sRPE|整课评分)(?:字段)?\s*(?:为|是|明确为)?\s*(\d+(?:\.\d+)?)/i),
    pain, painFree,
    recovery10: g(/恢复\s*(\d+(?:\.\d+)?)\s*\/\s*10/), readiness: g(/准备度\s*(\d+(?:\.\d+)?)/),
    sleepHours: sleepRange ? null : g(/睡(?:眠)?(?:了)?\s*(\d+(?:\.\d+)?)\s*小时/) ?? g(/(?:昨夜|前夜|昨晚)[^。；，,]{0,6}?(\d+(?:\.\d+)?)\s*小时/), sleepRange: sleepRange ? [num(sleepRange[1]), num(sleepRange[2])] : null,
    baselines, weekly: weekly.length >= 2 ? weekly : [], symptoms: symptomsOf(q),
    recentInjury: injury ? injury[1] : null, notAssessed: /尚未(?:面诊|就医|做临床评估|评估)|未就医|没有就医/.test(q),
  }
}
export const hasStatedNumbers = (f: StatedFacts) => !!f.rounds || !!f.statuses || (f.sessionMinutes !== null && f.sessionRpe !== null) || f.sessionRpeNull || !!f.result || !!f.budget || !!f.corrected || f.changes.length > 0 || !!f.raceDays || !!f.hrvMetricMismatch || f.sets.some(s => s.splits.some(v => v !== null)) || f.planActual.length > 0 || f.distanceTimes.length > 0 || f.strength.length > 0 || f.baselines.some(b => b.today !== null) || f.secondsToMinutes !== null
