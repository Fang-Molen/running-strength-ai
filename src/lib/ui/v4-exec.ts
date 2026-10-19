/* v83（P0-01/P0-02）：V4 当天课的手机执行证据（逐组力量 / 逐段跑步），按日期汇总，给 v4DayFact 用。
 * - 只认未作废的课次；只“开始”没有做任何一组/一段不算证据（与训练日志口径一致）。
 * - 同一个 sessionId 取最近一次（重做/放弃后以最新为准）。只读，不写任何存储。 */
import { listTrainingOccurrences, type TrainingOccurrence } from '@/lib/core/occurrence'
import { occurrenceVoided } from '@/lib/core/training-correction'
import { loadEvents } from '@/lib/core/events'
import { projectRunningExecution } from '@/lib/core/running-execution'
import type { ExecState } from './plan400-view'
export type V4Exec = { strength?: ExecState; run?: ExecState; strengthLive?: boolean }
const SID = /^scheduled:plan400:(\d{4}-\d\d-\d\d):strength:(strength|run)$/
export function v4ExecFrom(occ: readonly TrainingOccurrence[], events: ReturnType<typeof loadEvents>, voided: (id: string) => boolean): Record<string, V4Exec> {
  const latest = new Map<string, TrainingOccurrence>()
  for (const o of occ) if (SID.test(o.sessionId) && !voided(o.trainingOccurrenceId)) latest.set(o.sessionId, o)
  const out: Record<string, V4Exec> = {}
  for (const [sid, o] of latest) {
    const [, date, part] = SID.exec(sid)!
    const cur = out[date] ?? (out[date] = {})
    if (o.lifecycle === 'IN_PROGRESS') { if (part === 'strength') cur.strengthLive = true; continue }
    let evidence = false
    if (part === 'strength') evidence = events.some(e => e.event_type === 'TRAINING_SET_COMPLETED' && (e.payload as { trainingOccurrenceId?: string; completed?: boolean; skipped?: boolean }).trainingOccurrenceId === o.trainingOccurrenceId && (e.payload as { completed?: boolean }).completed !== false && !(e.payload as { skipped?: boolean }).skipped)
    else { try { const r = projectRunningExecution(o.trainingOccurrenceId, events); evidence = r.availability === 'AVAILABLE' && [...r.repetitions, ...r.continuous].some(s => s.status === 'COMPLETED') } catch { evidence = false } }
    if (!evidence) continue
    const st: ExecState = o.lifecycle === 'COMPLETED' ? 'COMPLETED' : 'INTERRUPTED'
    if (part === 'strength') cur.strength = st; else cur.run = st
  }
  return out
}
export function v4ExecByDate(): Record<string, V4Exec> {
  try { return v4ExecFrom(listTrainingOccurrences(), loadEvents(), occurrenceVoided) } catch { return {} }
}
