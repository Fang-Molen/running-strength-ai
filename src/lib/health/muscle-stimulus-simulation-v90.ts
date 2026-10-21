/** Exploratory, UNCALIBRATED visualization of documented training exposure.
 * Values are arbitrary relative stimulus units, NOT muscle fatigue, recovery %, injury risk,
 * readiness, or a clinically/individually validated prediction. No write or prescription. */
export type StimulusEvidence = {
  id: string
  modality: 'RUN' | 'STRENGTH'
  occurredAt: string | null
  actualSets?: number | null
}
export type StimulusPoint = { offsetHours: number; central: number; fast: number; slow: number }
export type StimulusSimulation = {
  mode: 'ILLUSTRATIVE_UNCALIBRATED'
  unit: 'RELATIVE_STIMULUS_UNITS'
  asOf: string
  eventCount: number
  strengthEvents: number
  runningEvents: number
  points: StimulusPoint[]
  disclaimer: string
  isRecoveryPercent: false
  canAuthorizeTraining: false
}
const HOUR = 3600000
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))
const finiteIso = (v: string | null): v is string => !!v && Number.isFinite(Date.parse(v))
/** Returns null if there is no valid, time-anchored training exposure. */
export function simulateMuscleStimulus(input: {
  asOf: string
  evidence: StimulusEvidence[]
  horizonHours?: number
}): StimulusSimulation | null {
  const now = Date.parse(input.asOf)
  if (!Number.isFinite(now)) throw Error('INVALID_ASOF')
  const horizon = input.horizonHours ?? 72
  if (!Number.isInteger(horizon) || horizon < 12 || horizon > 120) throw Error('INVALID_HORIZON')
  const byId = new Map<string, StimulusEvidence>()
  for (const item of input.evidence) {
    if (!item.id || !finiteIso(item.occurredAt)) continue
    const time = Date.parse(item.occurredAt)
    if (time > now || time < now - 72 * HOUR) continue
    if (item.modality === 'STRENGTH' && !(item.actualSets != null && Number.isFinite(item.actualSets) && item.actualSets > 0)) continue
    if (!byId.has(item.id)) byId.set(item.id, item)
  }
  const xs = [...byId.values()]
  if (!xs.length) return null
  // Deliberately arbitrary scenario weights and half-lives; NOT fitted physiology.
  const weight = (s: StimulusEvidence) => s.modality === 'STRENGTH'
    ? 1 + Math.min(s.actualSets ?? 0, 8) / 8 : 1
  const level = (offset: number, halfLife: number) => xs.reduce((sum, s) => {
    const age = (now + offset * HOUR - Date.parse(s.occurredAt!)) / HOUR
    return age < 0 ? sum : sum + weight(s) * Math.pow(2, -age / halfLife)
  }, 0)
  const offsets = [-48, -36, -24, -12, 0, 12, 24, 36, 48, 60, 72].filter(x => x <= horizon)
  const max = Math.max(1, ...offsets.map(x => level(x, 36)))
  const points = offsets.map(offsetHours => ({
    offsetHours,
    central: +clamp(100 * level(offsetHours, 36) / max, 0, 100).toFixed(1),
    fast: +clamp(100 * level(offsetHours, 18) / max, 0, 100).toFixed(1),
    slow: +clamp(100 * level(offsetHours, 60) / max, 0, 100).toFixed(1),
  }))
  return {
    mode: 'ILLUSTRATIVE_UNCALIBRATED', unit: 'RELATIVE_STIMULUS_UNITS', asOf: input.asOf,
    eventCount: xs.length,
    strengthEvents: xs.filter(s => s.modality === 'STRENGTH').length,
    runningEvents: xs.filter(s => s.modality === 'RUN').length,
    points,
    disclaimer: '未校准的训练刺激变化情景示意；曲线及快慢情景均为任意模型参数，不是实测肌肉疲劳、恢复百分比、医学预测或训练许可。',
    isRecoveryPercent: false, canAuthorizeTraining: false,
  }
}
