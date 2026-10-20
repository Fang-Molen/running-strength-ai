/** 题面事实的算术（v86）：秒、百分比、速度变化、均值、变异系数。纯函数，只用题面给出的数。 */
import type { StatedSet, PlanActual, Baseline, DistanceTime, StrengthSet } from './parse.ts'

export const r1 = (n: number) => Number(n.toFixed(1))
export const r2 = (n: number) => Number(n.toFixed(2))
export const signed = (n: number, d = 1) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(Number(n.toFixed(d)))}`
export const pct = (n: number) => `${signed(n * 100, 2)}%`
export const pace = (secPerKm: number) => { const m = Math.floor(secPerKm / 60), s = secPerKm - m * 60; return `${m}:${s.toFixed(s % 1 ? 1 : 0).padStart(s % 1 ? 4 : 2, '0')}/公里` }

export type SetStats = { n: number; missing: number; total: number; mean: number; first: number; last: number; diff: number; diffPct: number; speedPct: number; cv: number; vsTarget: number[] | null; meanVsTarget: number | null; pacePerKm: number | null; meters: number | null }
export function setStats(s: StatedSet): SetStats | null {
  const v = s.splits.filter((x): x is number => x !== null)
  if (v.length < 2) return null
  const total = v.reduce((a, b) => a + b, 0), mean = total / v.length, first = v[0], last = v[v.length - 1]
  // sample SD (n−1), the same convention the engine's saved-session review uses
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1))
  return { n: v.length, missing: s.splits.length - v.length, total, mean, first, last, diff: last - first, diffPct: (last - first) / first, speedPct: first / last - 1, cv: sd / mean,
    vsTarget: s.targetSec !== null ? v.map(x => x - s.targetSec!) : null, meanVsTarget: s.targetSec !== null ? mean - s.targetSec : null,
    pacePerKm: s.meters ? mean / (s.meters / 1000) : null, meters: s.meters }
}
export const planActualStats = (p: PlanActual) => ({ diff: p.actualSec - p.planSec, pct: (p.actualSec - p.planSec) / p.planSec })
export const baselineStats = (b: Baseline) => b.today === null ? null : { diff: b.today - b.base, pct: (b.today - b.base) / b.base }
export const distanceTimeStats = (d: DistanceTime) => ({ pacePerKm: d.seconds / (d.meters / 1000), mps: d.meters / d.seconds, kmh: d.meters / d.seconds * 3.6 })
export const strengthVolume = (xs: StrengthSet[]) => xs.reduce((a, s) => a + s.kg * s.reps * s.sets, 0)
