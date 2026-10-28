/** Read-only measurements. A shared day or plan slot is not an activity identity. */
export type ActivityMember = {
  id: string; source: 'execution' | 'phone' | 'import' | 'garmin'; sport: string;
  durationSec: number | null; distanceM?: number | null; originIds?: string[];
  startedAt?: string; endedAt?: string; status?: 'completed' | 'incomplete';
}
const actualKeys = (m: ActivityMember) => [m.id, ...(m.originIds ?? [])]
  .filter(k => !/^(?:p400:|plan400:|sched:)/.test(k))
const valid = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0

export function activityDose(members: ActivityMember[]) {
  const groups: ActivityMember[][] = []
  for (const member of members.filter(m => m.source !== 'phone' || m.durationSec != null || m.distanceM != null)) {
    const keys = actualKeys(member)
    const matched = groups.filter(g => g[0].sport === member.sport && g.some(m => actualKeys(m).some(k => keys.includes(k))))
    const merged = [member, ...matched.flat()]
    for (const g of matched) groups.splice(groups.indexOf(g), 1)
    groups.push(merged)
  }
  let conflict = false
  const consistent = (values: (number | null | undefined)[]) => {
    const known = values.filter(valid)
    if (!known.length) return null
    // Hundredth-second/metre display precision only; minutes are never equated to seconds.
    if (known.some(v => Math.round(v * 100) !== Math.round(known[0] * 100))) { conflict = true; return null }
    return known[0]
  }
  const doses = groups.map(g => ({
    sport: g[0].sport, duration: consistent(g.map(m => m.durationSec)), distance: consistent(g.map(m => m.distanceM)),
    intervals: g.flatMap(m => m.startedAt && m.endedAt && Number.isFinite(Date.parse(m.startedAt)) && Date.parse(m.endedAt) >= Date.parse(m.startedAt)
      ? [{ start:Date.parse(m.startedAt), end:Date.parse(m.endedAt) }] : []),
  }))
  const runs = doses.filter(d => d.sport === 'RUNNING')
  const separate = (items: typeof doses) => items.every(d => d.intervals.length > 0) && items.every((a,i) => items.slice(i+1).every(b =>
    a.intervals.every(x => b.intervals.every(y => x.end <= y.start || y.end <= x.start))))
  const total = (items: typeof doses, key: 'duration' | 'distance') => {
    if (!items.length || items.some(d => d[key] == null)) return null
    if (items.length > 1 && !separate(items)) return null
    return items.reduce((n,d) => n+d[key]!,0)
  }
  const ambiguous = doses.length > 1 && !separate(doses)
  return {
    durationSec: total(doses,'duration'), runningDurationSec: total(runs,'duration'), runningDistanceM: total(runs,'distance'),
    durationPartial: false,
    measurementNote: conflict ? '同一活动的来源数值存在冲突，请核对原记录；冲突数值暂不汇总。'
      : ambiguous ? '分项时间或整课范围未能核对，不确定是否重叠；各分项保留，整课时长暂不相加。' : undefined,
  }
}
