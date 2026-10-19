/* v81（用户 t513）：逐组引导“放弃本次，不记录”。
 * 事件日志只追加不删除：放弃 = 关闭进行中的课次（TRAINING_INTERRUPTED，payload.discarded=true，不发 AI_DECISION_INTERRUPTED）
 * ＋ 追加一条 VOID 更正（与“作废记录”同一机制；日志/复盘/五维/方坤读取都已排除作废课次）
 * ＋ 把日程条目里由这次执行投影出的 actual 清掉、状态回到 planned → 力量分项回到“未记录”。 */
import { currentAthleteId, loadEvents, dispatchEvent } from '@/lib/core/events'
import { closeTrainingOccurrence, listTrainingOccurrences, getTrainingOccurrence } from '@/lib/core/occurrence'
import { executionOf } from '@/lib/core/execution'
import { appendCorrection, occurrenceVoided } from '@/lib/core/training-correction'
import { loadSchedule, saveSchedule } from './day-schedule'

export const DISCARD_REASON = '用户放弃本次（试用/误开），不记录'
const ownedStarts = () => new Set(loadEvents().filter(e => e.event_type === 'TRAINING_STARTED' && (e.athlete_id ?? 'local') === currentAthleteId()).map(e => e.event_id))
/** 这个 sessionId 最近一次、归属当前运动员且尚未作废的课次。 */
export function latestOccurrence(sessionId: string) {
  const ids = ownedStarts()
  return [...listTrainingOccurrences()].reverse().find(o => ids.has(o.startEventId) && o.sessionId === sessionId && !occurrenceVoided(o.trainingOccurrenceId)) ?? null
}
export function guidedLive(sessionId: string): boolean {
  const ids = ownedStarts()
  return listTrainingOccurrences().some(o => ids.has(o.startEventId) && o.lifecycle === 'IN_PROGRESS' && o.sessionId === sessionId && !occurrenceVoided(o.trainingOccurrenceId))
}
/** 放弃 sessionId 当前（或刚结束的）这一次引导。返回是否已核实写入。 */
export function discardGuided(sessionId: string): boolean {
  const occ = latestOccurrence(sessionId)
  if (!occ) return false
  if (occ.lifecycle === 'IN_PROGRESS') {
    const decisionId = executionOf(sessionId).decisionId ?? 'discard'
    const ev = dispatchEvent('TRAINING_INTERRUPTED', { decisionId, sessionId, discarded: true })
    if (!ev) return false
    const closed = closeTrainingOccurrence(ev as Parameters<typeof closeTrainingOccurrence>[0])
    if (!closed || getTrainingOccurrence(closed.trainingOccurrenceId)?.lifecycle === 'IN_PROGRESS') return false
  }
  if (!appendCorrection({ trainingOccurrenceId: occ.trainingOccurrenceId, kind: 'VOID', reason: DISCARD_REASON })) return false
  const store = loadSchedule(); let changed = false
  const entries = store.entries.map(e => {
    if (!e.actual?.occurrenceIds?.includes(occ.trainingOccurrenceId)) return e
    changed = true
    const { actual: _drop, ...rest } = e; void _drop
    return { ...rest, status: 'planned' as const }
  })
  if (changed && !saveSchedule({ ...store, entries })) return false
  // 本机的休息计时 / 逐组位置 / 输入草稿也清掉，下次从头开始
  try { const enc = encodeURIComponent(sessionId); for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i) ?? ''; if ((k.startsWith('rs-rest-v1:') && k.includes(':' + enc)) || ((k.startsWith('fk-runner-draft-v71:') || k.startsWith('fr255-runner-draft-v1:')) && k.includes(':' + sessionId + ':'))) localStorage.removeItem(k) } } catch { /* node / storage unavailable */ }
  try { for (const n of ['fk-schedule-changed', 'fk-training-activities-changed', 'fk-plan400-components']) window.dispatchEvent(new Event(n)) } catch { /* node */ }
  return true
}
