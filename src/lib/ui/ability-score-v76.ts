/**
 * 五维能力图打分（v76，用户 t463 要求带分数）。只用用户自己的真实成绩/训练数据，不补数、不编造：
 * 每一维给出 输入 → 公式 → 分数；没有数据的维度是“待评估”（score=null，图上不画成 0），并写明原因类别。
 * 方法（0–100，封顶 100）：
 *  速度      = 100 × 目标400米 ÷ 实际400米（个人资料“最近成绩”或近90天 380–420 米分段折算到 400 米，取最好）
 *  速度耐力  = 100 − 10 × 掉速%（近42天同一节课里 ≥4 段 150–600 米快段：后两段平均配速比前两段慢多少%）
 *  有氧耐力  = (佳明最大摄氧量 − 30) ÷ (70 − 30) × 100（线性：30→0，70→100）
 *  力量功率  = 深蹲估算1RM/体重 ÷ 2.0 × 100 或 硬拉估算1RM/体重 ÷ 2.5 × 100，取高者（1RM 用 Epley：重量×(1+次数/30)，只用 ≤10 次的组）
 *  跑步经济性= 100 − (垂直步幅比% − 6) × 12.5（佳明跑步动态；6%→100，14%→0）
 */
export type AxisKey = 'speed' | 'speedEndurance' | 'endurance' | 'strength' | 'economy'
export const AXES: { key: AxisKey; label: string; method: string }[] = [
  { key: 'speed', label: '速度', method: '100 × 目标400米 ÷ 你的400米成绩（个人资料最近成绩，或近90天 380–420 米分段折算，取最好）' },
  { key: 'speedEndurance', label: '速度耐力', method: '100 − 10 × 掉速%（近42天同一节课 ≥4 段 150–600 米快段，后两段比前两段慢多少）' },
  { key: 'endurance', label: '有氧耐力', method: '(佳明最大摄氧量 − 30) ÷ 40 × 100（30→0 分，70→100 分）' },
  { key: 'strength', label: '力量功率', method: '深蹲估算1RM/体重 ÷ 2.0 × 100，或硬拉估算1RM/体重 ÷ 2.5 × 100，取高者（Epley 公式，只用 ≤10 次的组）' },
  { key: 'economy', label: '跑步经济性', method: '100 − (垂直步幅比% − 6) × 12.5（佳明跑步动态，6%→100，14%→0）' },
]
export type PendingReason = '缺记录' | '条件不可比' | '缺评分标准'
export type AxisScore = { key: AxisKey; label: string; method: string; score: number | null; inputs: string[]; reason: PendingReason | null; reasonText: string }
export type Lap = { dist: number | null; dur: number | null }
export type Act = { id: number | string; start: string; type: string; dist: number | null; dur: number | null; vo2?: number | null; vr?: number | null }
export type LiftSet = { name: string; weightKg: number | null; reps: number | null; date: string }
export type ScoreInput = { asOf: string; marks: { meters: number; recentSec: number | null; goalSec: number | null }[]; acts: Act[]; laps: Record<string, Lap[]>; lifts: LiftSet[]; bodyWeightKg: number | null }
import { activityLocalDay, parseActivityTime } from './activity-format'
const dayOf = (s: string) => activityLocalDay(s) ?? s.slice(0, 10)
const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)))
const daysBefore = (asOf: string, iso: string) => { const t = parseActivityTime(iso)?.getTime() ?? NaN; return (Date.parse(asOf + 'T23:59:59Z') - t) / 864e5 }
const fmt = (s: number) => s >= 60 ? `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}` : `${s.toFixed(1)}秒`
const isRun = (t: string) => /run|track|treadmill/.test(t)
export function scoreAbilities(x: ScoreInput): AxisScore[] {
  const base = (key: AxisKey) => AXES.find(a => a.key === key)!
  const pend = (key: AxisKey, reason: PendingReason, reasonText: string, inputs: string[] = []): AxisScore => ({ ...base(key), score: null, inputs, reason, reasonText })
  const ok = (key: AxisKey, score: number, inputs: string[]): AxisScore => ({ ...base(key), score: clamp(score), inputs, reason: null, reasonText: '' })
  const out: AxisScore[] = []
  // 速度
  const m400 = x.marks.find(m => m.meters === 400), goal = m400?.goalSec ?? 53.5
  const cands: { sec: number; src: string }[] = []
  if (m400?.recentSec) cands.push({ sec: m400.recentSec, src: `个人资料最近 400 米成绩 ${fmt(m400.recentSec)}` })
  let roadLaps = 0
  for (const a of x.acts) if (isRun(a.type) && !/track/.test(a.type) && daysBefore(x.asOf, a.start) <= 90) roadLaps += (x.laps[String(a.id)] ?? []).filter(l => l.dist && l.dist >= 380 && l.dist <= 420).length
  for (const a of x.acts) if (/track/.test(a.type) && daysBefore(x.asOf, a.start) <= 90 && daysBefore(x.asOf, a.start) >= 0) for (const l of x.laps[String(a.id)] ?? []) if (l.dist && l.dur && l.dist >= 380 && l.dist <= 420) cands.push({ sec: l.dur * 400 / l.dist, src: `${dayOf(a.start)} 田径场训练分段（非正式测试，分数偏保守） ${Math.round(l.dist)} 米 ${fmt(l.dur)}，折算 400 米 ${fmt(l.dur * 400 / l.dist)}` })
  const best = cands.sort((a, b) => a.sec - b.sec)[0]
  out.push(best ? ok('speed', 100 * goal / best.sec, [best.src, `目标 400 米 ${fmt(goal)}`]) : roadLaps ? pend('speed', '条件不可比', `只有路跑里的 ${roadLaps} 段约 400 米分段，不是全力测试，不能代表速度。在田径场做一次 400 米全力计时，或在个人资料填最近 400 米成绩。`) : pend('speed', '缺记录', '没有 400 米成绩：在个人资料填最近 400 米成绩，或在田径场跑一次 400 米计时（手表按圈记录）。'))
  // 速度耐力
  let se: AxisScore | null = null
  for (const a of [...x.acts].sort((p, q) => (parseActivityTime(q.start)?.getTime() ?? 0) - (parseActivityTime(p.start)?.getTime() ?? 0))) {
    if (!isRun(a.type) || daysBefore(x.asOf, a.start) > 42 || daysBefore(x.asOf, a.start) < 0) continue
    const fast = (x.laps[String(a.id)] ?? []).filter(l => l.dist && l.dur && l.dist >= 150 && l.dist <= 600 && l.dur / (l.dist / 1000) < 240)
    if (fast.length < 4) continue
    const pace = (l: Lap) => l.dur! / (l.dist! / 1000), first = (pace(fast[0]) + pace(fast[1])) / 2, last = (pace(fast.at(-1)!) + pace(fast.at(-2)!)) / 2
    const decay = Math.max(0, (last - first) / first * 100)
    se = ok('speedEndurance', 100 - 10 * decay, [`${dayOf(a.start)} 共 ${fast.length} 段快段`, `前两段平均 ${fmt(first)}/公里，后两段 ${fmt(last)}/公里，掉速 ${decay.toFixed(1)}%`]); break
  }
  out.push(se ?? pend('speedEndurance', '缺记录', '近 6 周没有带分段的间歇课：做一次 300 米×4（休 3 分钟），手表每段按圈，记录每段用时。'))
  // 有氧耐力
  const vo2 = [...x.acts].filter(a => a.vo2 != null && a.vo2 > 0 && daysBefore(x.asOf, a.start) <= 60 && daysBefore(x.asOf, a.start) >= 0).sort((p, q) => (parseActivityTime(q.start)?.getTime() ?? 0) - (parseActivityTime(p.start)?.getTime() ?? 0))[0]
  out.push(vo2 ? ok('endurance', (vo2.vo2! - 30) / 40 * 100, [`佳明最大摄氧量 ${vo2.vo2}（${dayOf(vo2.start)} 跑步）`]) : pend('endurance', '缺记录', '佳明没有提供最大摄氧量：戴表在户外跑 15 分钟以上（开心率），同步后自动计算。'))
  // 力量功率
  const bw = x.bodyWeightKg
  const e1 = (re: RegExp) => x.lifts.filter(s => re.test(s.name) && s.weightKg && s.reps && s.reps <= 10 && daysBefore(x.asOf, s.date + 'T12:00:00Z') <= 90 && daysBefore(x.asOf, s.date + 'T12:00:00Z') >= -1).map(s => ({ v: s.weightKg! * (1 + s.reps! / 30), s })).sort((a, b) => b.v - a.v)[0]
  const sq = e1(/深蹲|squat/i), dl = e1(/硬拉|deadlift/i)
  if (!sq && !dl) out.push(pend('strength', '缺记录', '近 90 天没有带重量的深蹲或硬拉记录：下次力量课记录深蹲每组的重量和次数（≤10 次）。'))
  else if (!bw) out.push(pend('strength', '缺记录', '缺体重：在个人资料填体重后按体重比计算。', [sq ? `深蹲 ${sq.s.weightKg}kg×${sq.s.reps}` : '', dl ? `硬拉 ${dl.s.weightKg}kg×${dl.s.reps}` : ''].filter(Boolean)))
  else {
    const sqS = sq ? sq.v / bw / 2 * 100 : -1, dlS = dl ? dl.v / bw / 2.5 * 100 : -1
    const use = sqS >= dlS ? { n: '深蹲', r: sq!, k: 2 } : { n: '硬拉', r: dl!, k: 2.5 }
    out.push(ok('strength', Math.max(sqS, dlS), [`${use.r.s.date} ${use.n} ${use.r.s.weightKg}kg×${use.r.s.reps}，估算1RM ${use.r.v.toFixed(1)}kg`, `体重 ${bw}kg，体重比 ${(use.r.v / bw).toFixed(2)}（满分 ${use.k}）`]))
  }
  // 跑步经济性
  const vr = [...x.acts].filter(a => a.vr != null && a.vr > 0 && daysBefore(x.asOf, a.start) <= 42 && daysBefore(x.asOf, a.start) >= 0).sort((p, q) => (parseActivityTime(q.start)?.getTime() ?? 0) - (parseActivityTime(p.start)?.getTime() ?? 0))[0]
  out.push(vr ? ok('economy', 100 - (vr.vr! - 6) * 12.5, [`垂直步幅比 ${vr.vr}%（${dayOf(vr.start)} 跑步）`]) : pend('economy', '缺记录', '没有跑步动态数据：佳明需要心率带（HRM-Pro/Run）或跑步传感器才能测垂直步幅比；没有时这一维不打分。'))
  return out
}
