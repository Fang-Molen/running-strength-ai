/**
 * v83（整改包 P1-06 / A09–A11 / N15–N16）：手表圈段 → 计划分段结构（只读识别，待用户确认才写入）。
 * - 没有圈段（只有总距离/总时间）→ unknown，每组成绩和组间休息保持未知，不按平均值造；
 * - 工作段数量必须正好 = 轮数×每轮次数，且每段距离接近计划距离，否则 unknown（不猜）；
 * - 多轮（如 200m×4×2）保留“轮”结构：轮内组间休息、轮间休息分开，不展平成 8×200m。
 */
import type { GLap } from '@/lib/coach/plain-coach'
export type PlannedReps = { distanceM: number; reps: number; rounds?: number }
export type LapRep = { lap: number; distM: number; durSec: number; avgHr: number | null }
export type LapMatch =
  | { status: 'matched'; rounds: { reps: LapRep[]; restSec: (number | null)[] }[]; roundRestSec: (number | null)[]; repsText: string; restText: string; source: string }
  | { status: 'unknown'; reason: string }
const tol = (d: number) => Math.max(25, d * 0.15)
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
const secs = (s: number) => s < 60 ? `${s.toFixed(1)}` : mmss(s)
export function matchLaps(laps: GLap[] | null | undefined, plan: PlannedReps | null, source = '佳明圈段'): LapMatch {
  if (!plan || !(plan.distanceM > 0) || !(plan.reps > 0)) return { status: 'unknown', reason: '这节课的计划分段写不清，不自动对照' }
  if (!laps?.length) return { status: 'unknown', reason: '手表只有总距离/总时间，没有圈段：每组成绩和组间休息保持未知' }
  const rounds = Math.max(1, plan.rounds ?? 1), need = rounds * plan.reps
  const L = [...laps].sort((a, b) => a.i - b.i)
  if (L.some(l => l.dur == null)) return { status: 'unknown', reason: '圈段缺时间，不能逐组对照' }
  const isWork = (l: GLap) => l.dist != null && Math.abs(l.dist - plan.distanceM) <= tol(plan.distanceM)
  const work = L.map((l, k) => ({ l, k })).filter(x => isWork(x.l))
  if (work.length !== need) return { status: 'unknown', reason: `圈段里接近 ${plan.distanceM}m 的有 ${work.length} 段，计划是 ${rounds > 1 ? `${rounds} 轮×` : ''}${plan.reps} 次，对不上，不自动对照` }
  // 工作段之间必须有恢复段（否则可能是一段连续跑被切圈）
  const gaps: (number | null)[] = []
  for (let n = 1; n < work.length; n++) {
    const between = L.slice(work[n - 1].k + 1, work[n].k)
    if (!between.length) return { status: 'unknown', reason: '有两段工作圈之间没有恢复段，可能是连续跑切圈，不自动对照' }
    gaps.push(between.reduce((s, x) => s + (x.dur ?? 0), 0))
  }
  const out: { reps: LapRep[]; restSec: (number | null)[] }[] = [], roundRest: (number | null)[] = []
  for (let r = 0; r < rounds; r++) {
    const ws = work.slice(r * plan.reps, (r + 1) * plan.reps)
    out.push({ reps: ws.map(x => ({ lap: x.l.i, distM: x.l.dist!, durSec: x.l.dur!, avgHr: x.l.avgHr })), restSec: gaps.slice(r * plan.reps, r * plan.reps + plan.reps - 1) })
    if (r < rounds - 1) roundRest.push(gaps[(r + 1) * plan.reps - 1] ?? null)
  }
  const repsText = `${plan.distanceM}m: ` + out.map(o => o.reps.map(x => secs(x.durSec)).join('/')).join(' ｜ ')
  const restText = out.map((o, r) => o.restSec.map(x => x == null ? '?' : mmss(x)).join('/') + (r < rounds - 1 ? ` ｜轮间 ${roundRest[r] == null ? '?' : mmss(roundRest[r]!)}` : '')).join(' ｜ ')
  return { status: 'matched', rounds: out, roundRestSec: roundRest, repsText, restText, source }
}
/** V4 正式主课文字 → 计划分段（单段距离×次数，可带“×轮数”）；多段组合（如 250m＋150m）不自动对照。 */
export function plannedRepsFromText(text: string): PlannedReps | null {
  const t = text.replace(/\s+/g, '').replace(/^正式主课[：:]/, '').split(/[；;。]|观察/)[0]
  if (/[＋+]/.test(t.split(/组间|，/)[0])) return null
  const m = /(?<![\d(（])(\d{2,4})(?:m|米)[×xX*✕](\d{1,2})(?:—\d{1,2})?(?:[×xX*✕](\d))?/.exec(t)
  return m ? { distanceM: Number(m[1]), reps: Number(m[2]), ...(m[3] ? { rounds: Number(m[3]) } : {}) } : null
}
