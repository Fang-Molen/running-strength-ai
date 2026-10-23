import type { HealthMetricView } from './snapshot'
import type { IntradayDay } from './garmin-intraday'
import { shortHash } from './observation'

/** Only an automatic date follows new data. An explicit historical date stays pinned. */
export function reconcileHealthDay(input: {
  day: string; today: string; previousToday: string; historyPinned: boolean; hasTodayData: boolean
}): string {
  if (input.historyPinned) return input.day
  return input.day === input.previousToday || input.hasTodayData ? input.today : input.day
}

function streamSource(stream: string): string | null {
  if (!stream.startsWith('[')) return stream.split('|')[0] || null
  try {
    const parts: unknown = JSON.parse(stream)
    if (!Array.isArray(parts) || parts.length !== 5 || !parts.every(p => typeof p === 'string')) return null
    return `${parts[0].toLowerCase()}:${shortHash(parts[1]+':'+parts[2])}`
  } catch { return null }
}

/** Daily source choice also constrains the continuous chart. Never relabel Garmin
 * points as a different watch, or treat resting HR as continuous HR samples. */
export function intradayMatchesSource(view: HealthMetricView | undefined, data: IntradayDay | null | undefined): boolean {
  if (!data || view?.state === 'CONFLICT') return false
  const requested = view?.selectedSource ?? view?.current?.stream
  if (!requested) return true
  const source = view?.current?.stream === requested && view.current.sourceId
    ? view.current.sourceId : streamSource(requested)
  if (data.sourceId) return source === data.sourceId
  // Unidentified legacy samples can stay visible only in automatic Garmin views.
  return !view?.selectedSource && !!source?.startsWith('garmin:')
}
