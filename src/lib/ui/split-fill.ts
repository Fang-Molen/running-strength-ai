/** R5「按目标填充」：手填正式主课分段时，一键把每组填成目标秒数，只改偏离的那几组。
 *  只生成与圈段识别相同格式的文字（如 "150m: 21.3/21.0/21.6"），仍写入原 reps 字段；不改存储键、不自动保存。 */
import type { PlannedReps } from './lap-structure'
export type SplitTarget = { sec: number; source: string } | null
const num = (s: string) => Number(s.replace(/[—–]/g, '-'))
/** 课表里写明的单组参考秒数（如“起始参考30—32秒”→31）。组间/休息秒数不算目标。 */
export function targetSecFromText(text: string): SplitTarget {
  const t = text.replace(/\s+/g, '')
  const m = /(?:起始参考|参考|目标|用时)(?:约)?(\d{1,3}(?:\.\d)?)(?:[—–\-~～](\d{1,3}(?:\.\d)?))?秒/.exec(t)
  if (!m) return null
  const a = num(m[1]), b = m[2] ? num(m[2]) : a
  return { sec: Math.round(((a + b) / 2) * 10) / 10, source: m[2] ? `课表参考 ${m[1]}–${m[2]} 秒` : `课表参考 ${m[1]} 秒` }
}
export function parseSec(v: string): number | null {
  const s = v.trim(); if (!s) return null
  const mm = /^(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(s); if (mm) return Number(mm[1]) * 60 + Number(mm[2])
  const n = Number(s.replace(/秒|s$/i, '')); return Number.isFinite(n) && n > 0 ? n : null
}
export const fmtSec = (s: number) => s < 60 ? s.toFixed(1) : `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
/** 已有分段文字 → 每组值（按计划组数补空/截断）。 */
export function splitsFromText(text: string | undefined, plan: PlannedReps): string[] {
  const n = plan.reps * (plan.rounds ?? 1)
  const body = String(text ?? '').replace(/^\s*\d{2,4}\s*(?:m|米)\s*[:：]\s*/, '')
  const vals = body ? body.split(/[\/／｜|,，、\s]+/).map(x => x.trim()).filter(Boolean) : []
  return Array.from({ length: n }, (_, i) => vals[i] ?? '')
}
export function splitsToText(values: string[], plan: PlannedReps): string {
  if (!values.some(v => v.trim())) return ''
  const per = plan.reps, rounds = plan.rounds ?? 1
  const groups = Array.from({ length: rounds }, (_, r) => values.slice(r * per, r * per + per).map(v => v.trim() || '—').join('/'))
  return `${plan.distanceM}m: ` + groups.join(' ｜ ')
}
/** 同距离最近一次手填/确认的分段平均值（目标没写秒数时的参考）。 */
export function lastSplitTarget(logs: Record<string, { reps?: string }>, plan: PlannedReps, before: string): SplitTarget {
  const prev = Object.keys(logs).filter(d => d < before).sort().reverse()
  for (const d of prev) {
    const t = String(logs[d]?.reps ?? '')
    const m = /^\s*(\d{2,4})\s*(?:m|米)\s*[:：]/.exec(t)
    if (!m || Number(m[1]) !== plan.distanceM) continue
    const secs = t.replace(m[0], '').split(/[\/／｜|,，、\s]+/).map(parseSec).filter((x): x is number => x != null)
    if (secs.length) return { sec: Math.round(secs.reduce((a, b) => a + b, 0) / secs.length * 10) / 10, source: `${d.slice(5)} 同距离平均` }
  }
  return null
}
/** 一键填充：只填空着的组，已填的组保留（不覆盖手改过的偏离值）。 */
export function fillFromTarget(values: string[], sec: number): string[] {
  return values.map(v => v.trim() ? v : fmtSec(sec))
}
