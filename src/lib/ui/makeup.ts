/**
 * v87.2（用户 2026-10-20）：补练 / 提前练——计划里某天的一个分项，实际在另一天做。
 * 唯一出处：分项的实际日期 = 逐组/逐段执行（或关联的手表跑步）的开始日期（有时间戳的事实）＞ 用户在分项评价里填的 doneOn ＞ 计划当天。
 * 计划那天仍显示这个分项（“补练于 X月X日”，不算缺）；记录、周统计按实际日期算，只算一次。只读，不写存储。
 */
import type { DayParts } from './plan400-view'
const ISO = /^\d{4}-\d\d-\d\d$/
export type MakeupPart = 'running' | 'strength'
export function partDoneOn(planDate: string, part: MakeupPart, x: DayParts | undefined): string {
  const exec = part === 'strength' ? x?.strengthOn : x?.runOn
  if (typeof exec === 'string' && ISO.test(exec)) return exec
  const explicit = x?.parts?.[part]?.doneOn
  if (typeof explicit === 'string' && ISO.test(explicit)) return explicit
  return planDate
}
/** 不在计划当天做的分项 → 实际日期；同一天 → null */
export const madeUpOn = (planDate: string, part: MakeupPart, x: DayParts | undefined): string | null => { const d = partDoneOn(planDate, part, x); return d !== planDate ? d : null }
export const mdCN = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`
export const makeupText = (planDate: string, on: string) => on > planDate ? `补练于 ${mdCN(on)}` : `提前于 ${mdCN(on)} 练`
