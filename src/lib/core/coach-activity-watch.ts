import type { AppEvent } from './types.ts'

export type CoachActivityNotice = { id: string; message: string; sourceEventId: string }

/** Foreground-only event observation; no medical diagnosis, network, storage or plan edits. */
export function noticeForCoachEvent(event: Pick<AppEvent, 'event_id' | 'event_type' | 'payload'>): CoachActivityNotice | null {
  const p = event.payload as Record<string, unknown>
  let message: string | null = null
  if (event.event_type === 'TRAINING_COMPLETED') message = '检测到新的训练完成记录。你可以问我这次训练的完成情况；分析前需要核对本次训练的证据绑定。'
  else if (event.event_type === 'TRAINING_STARTED') message = '训练已开始。训练过程中可以记录实际完成情况，结束后我能协助核对。'
  else if (event.event_type === 'RPE_RECORDED' && p.evidenceType === 'SESSION_RPE' && typeof p.value === 'number' && p.value >= 8 && p.value <= 10) message = '记录到一次较高主观强度（RPE ≥8）。这不是疲劳诊断；建议结合恢复、疼痛和近期训练记录一起查看。'
  else if (event.event_type === 'RPE_RECORDED' && p.evidenceType === 'SESSION_RPE') message = '已记录一次主观训练强度，可结合本次训练事实查看。'
  if (!message) return null
  return { id: `coach-activity-${event.event_id}`, sourceEventId: event.event_id, message }
}

/** No repeat notices for a replayed event. Keeps the in-memory inbox small. */
export function appendCoachNotice(previous: CoachActivityNotice[], notice: CoachActivityNotice | null): CoachActivityNotice[] {
  if (!notice || previous.some(item => item.sourceEventId === notice.sourceEventId)) return previous
  return [...previous, notice].slice(-5)
}
