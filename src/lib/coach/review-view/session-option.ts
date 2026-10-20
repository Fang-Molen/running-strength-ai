/** 复盘选课下拉的“人话”标签（v86.1，区块 review-view）。纯函数：只用传入的已记录字段，没有的不补、不猜。 */
export type ReviewSessionSummary = {
  id: string
  startedAt: string
  /** 'RUN_REPEATS' 间歇/重复跑；'RUN' 连续跑；'STRENGTH' 力量；'MIXED' 混合；'OTHER' 未知 */
  kind: 'RUN_REPEATS' | 'RUN' | 'STRENGTH' | 'MIXED' | 'OTHER'
  title?: string | null
  planName?: string | null
  distanceM?: number | null
  durationSec?: number | null
  /** 同距离重复段：只在每段距离一致时给出 */
  repeats?: { count: number; distanceM: number; workSec: number | null } | null
  strengthSets?: number | null
}

const KIND: Record<ReviewSessionSummary['kind'], string> = { RUN_REPEATS: '间歇跑', RUN: '跑步', STRENGTH: '力量', MIXED: '跑步+力量', OTHER: '训练' }
const pos = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0

export function clock(sec: number): string {
  const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}
export function km(m: number): string {
  return m >= 1000 ? `${Number((m / 1000).toFixed(2))}公里` : `${Math.round(m)}米`
}
/** 每公里配速，只有距离和用时都记录时才算。 */
export function pacePerKm(distanceM: number | null | undefined, sec: number | null | undefined): string | null {
  return pos(distanceM) && pos(sec) ? `${clock((sec * 1000) / distanceM)}/公里` : null
}

/** “2026-06-24 20:37” → 今年只显示“06-24 20:37”。when 由调用方按产品时区格式化。 */
export function shortWhen(when: string, nowYear = new Date().getFullYear()): string {
  const m = when.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})$/)
  if (!m) return when
  return Number(m[1]) === nowYear ? `${m[2]}-${m[3]} ${m[4]}` : `${m[1]}-${m[2]}-${m[3]} ${m[4]}`
}

/** 下拉里的一行：日期 · 类型/名称 · 距离 · 用时 · 平均配速 · 计划名（只列有的）。 */
export function describeSession(s: ReviewSessionSummary, when: string, nowYear?: number): string {
  const parts: string[] = [shortWhen(when, nowYear)]
  const name = s.title?.trim() || KIND[s.kind]
  parts.push(name)
  if (s.repeats && s.repeats.count > 1 && pos(s.repeats.distanceM)) {
    parts.push(`${s.repeats.count}×${km(s.repeats.distanceM)}`)
    const pace = pacePerKm(s.repeats.count * s.repeats.distanceM, s.repeats.workSec)
    if (pace) parts.push(pace)
  } else {
    if (pos(s.distanceM)) parts.push(km(s.distanceM))
    if (pos(s.durationSec)) parts.push(clock(s.durationSec))
    const pace = s.kind === 'RUN' || s.kind === 'RUN_REPEATS' ? pacePerKm(s.distanceM, s.durationSec) : null
    if (pace) parts.push(pace)
  }
  if (pos(s.strengthSets)) parts.push(`${s.strengthSets}组`)
  if (s.planName?.trim() && s.planName.trim() !== name) parts.push(`计划：${s.planName.trim()}`)
  return parts.join(' · ')
}

/** 新的在前；同一时刻按 id 稳定排序。 */
export function sortNewestFirst<T extends { startedAt: string; id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0) || b.id.localeCompare(a.id))
}
