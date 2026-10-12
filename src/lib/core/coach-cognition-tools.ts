export type TimedRep = { distanceMeters: number; actualSeconds: number; plannedSeconds: number | null; sourceIds: string[]; position: string }
const positive = (n: number) => Number.isFinite(n) && n > 0
export function summarizeTimedReps(reps: TimedRep[]) {
  if (!reps.length || reps.some(r => !positive(r.distanceMeters) || !positive(r.actualSeconds)) || new Set(reps.map(r => r.distanceMeters)).size !== 1) return null
  const mean = (rs: TimedRep[]) => rs.reduce((sum, r) => sum + r.actualSeconds, 0) / rs.length
  const n = Math.min(2, Math.floor(reps.length / 2))
  const first = n ? mean(reps.slice(0,n)) : null
  const last = n ? mean(reps.slice(-n)) : null
  return { count: reps.length, distanceMeters: reps[0].distanceMeters, meanSeconds: mean(reps), firstMeanSeconds: first, lastMeanSeconds: last,
    timeIncreaseSeconds: first != null && last != null ? last-first : null,
    timeIncreasePercent: first != null && last != null ? (last/first-1)*100 : null,
    speedDeclinePercent: first != null && last != null ? (1-first/last)*100 : null,
    deviations: reps.map(r => r.plannedSeconds != null && positive(r.plannedSeconds) ? r.actualSeconds-r.plannedSeconds : null), sourceIds: reps.flatMap(r => r.sourceIds) }
}
export function parseRoundStructure(q: string) {
  const m = q.match(/(?:\(\s*)?(\d+)\s*(?:米|m)?\s*[×x*]\s*(\d+)\s*\)?\s*[×x*]\s*(\d+)/i)
  if (!m) return null
  const [distanceMeters, repeats, rounds] = m.slice(1).map(Number)
  if (![distanceMeters,repeats,rounds].every(positive) || repeats>100 || rounds>100) return null
  return { distanceMeters, repeats, rounds, totalReps: repeats*rounds, kind: 'PLANNED_STRUCTURE' as const }
}
export function daysBetweenCalendarDates(now: string, competition: string): number | null {
  const parse = (s: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return NaN
    const t=Date.parse(s+'T00:00:00Z')
    return Number.isFinite(t) && new Date(t).toISOString().slice(0,10)===s ? t : NaN
  }
  const a=parse(now), b=parse(competition)
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b-a)/86400000) : null
}
export type ComparisonContext = { event: string; distanceMeters: number; reps: number; rounds: number; restSeconds: number | null; timing: string | null; surface: string | null; phase: string | null }
export function comparability(a: ComparisonContext, b: ComparisonContext): { comparable: boolean; reasons: string[] } {
  const reasons: string[]=[]
  for (const key of ['event','distanceMeters','reps','rounds','restSeconds','timing','surface','phase'] as const) {
    if (a[key] == null || b[key] == null || a[key] === '' || b[key] === '') reasons.push(`${key}:UNKNOWN`)
    else if (a[key] !== b[key]) reasons.push(`${key}:DIFFERENT`)
  }
  return { comparable: reasons.length===0, reasons }
}
