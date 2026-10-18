/** Arithmetic only. These functions carry no training thresholds or permission to train. */
export function sampleStatistics(values: readonly number[]) {
  if (!values.length || values.some(value => !Number.isFinite(value))) return null
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const sampleSd = values.length < 2 ? null : Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1))
  if (!Number.isFinite(mean) || sampleSd !== null && !Number.isFinite(sampleSd)) return null
  return { count: values.length, mean, sampleSd,
    cvPercent: mean > 0 && sampleSd !== null ? 100 * sampleSd / mean : null }
}

export function median(values: readonly number[]): number | null {
  if (!values.length || values.some(value => !Number.isFinite(value))) return null
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : sorted[middle - 1] / 2 + sorted[middle] / 2
}

export function relativeChange(current: number, reference: number): number | null {
  return Number.isFinite(current) && Number.isFinite(reference) && reference > 0
    ? 100 * (current - reference) / reference : null
}

/** Equal-distance time change and velocity change have different denominators. */
export function splitArithmetic(seconds: readonly number[]) {
  if (seconds.length < 2 || seconds.some(value => !Number.isFinite(value) || value <= 0)) return null
  const stats = sampleStatistics(seconds)
  if (!stats) return null
  const first = seconds[0], last = seconds[seconds.length - 1]
  return { ...stats, firstSeconds: first, lastSeconds: last, differenceSeconds: last - first,
    timeChangePercent: relativeChange(last, first)!, speedDeclinePercent: 100 * (1 - first / last) }
}

export function fitDistanceTime(points: readonly { seconds: number; meters: number }[]) {
  if (points.length < 3 || points.some(p => !Number.isFinite(p.seconds) || p.seconds <= 0 || !Number.isFinite(p.meters) || p.meters <= 0) ||
      new Set(points.map(p => p.seconds)).size < 3) return null
  const timeStats = sampleStatistics(points.map(p => p.seconds))
  const distanceStats = sampleStatistics(points.map(p => p.meters))
  if (!timeStats || !distanceStats) return null
  const meanTime = timeStats.mean, meanDistance = distanceStats.mean
  const timeSquares = points.reduce((sum, p) => sum + (p.seconds - meanTime) ** 2, 0)
  if (!Number.isFinite(timeSquares) || timeSquares <= 0) return null
  const slope = points.reduce((sum, p) => sum + (p.seconds - meanTime) * (p.meters - meanDistance), 0) / timeSquares
  const intercept = meanDistance - slope * meanTime
  const residuals = points.map(p => p.meters - (slope * p.seconds + intercept))
  const totalSquares = points.reduce((sum, p) => sum + (p.meters - meanDistance) ** 2, 0)
  const rSquared = totalSquares > 0 ? 1 - residuals.reduce((sum, value) => sum + value ** 2, 0) / totalSquares : null
  return [slope, intercept, ...residuals].every(Number.isFinite)
    ? { csMetersPerSecond: slope, dPrimeMeters: intercept, residualsMeters: residuals, rSquared } : null
}
