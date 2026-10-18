import type { ScheduleEntry } from './day-schedule-rules'
type Ex = NonNullable<ScheduleEntry['exercises']>[number]
type Dose = { unit: 'reps' | 'sec' | 'm'; perSide: boolean }
/** 把 400m 计划当天「我的力量安排」变成可执行的力量课（同一 id，可重复打开继续）。缺组间休息时用 75 秒默认值；负重留空按自重 0。 */
export function plan400StrengthEntry(date: string, title: string, o: { parts: string[]; exercises: Ex[]; betweenRestSec?: number | null }, doseOf: (name: string) => Dose): ScheduleEntry {
  return {
    id: `plan400:${date}:strength`, date, kind: 'strength', modality: 'strength', trainingType: 'strength', title: `${title} · 力量与核心`,
    focus: o.parts.length ? o.parts : ['力量'], minutes: 30, intensity: 'MODERATE', lowerHeavy: false, source: 'custom', refId: null, status: 'planned',
    ...(o.betweenRestSec != null ? { betweenRestSec: o.betweenRestSec } : {}),
    exercises: o.exercises.filter(e => e.name.trim()).map((e, i) => {
      const d = doseOf(e.name), perSide = e.perSide ?? d.perSide
      return { ...e, id: e.id ?? `plan400:${date}:move:${i + 1}`, unit: e.unit ?? d.unit, perSide, ...(perSide && !e.counting ? { counting: 'perSide' as const } : {}), weight: e.weight?.trim() ? e.weight : '0', restSec: e.restSec ?? 75 }
    }),
  } as ScheduleEntry
}
