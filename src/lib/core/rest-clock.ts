/** Only a timer checkpoint. Never stores or modifies training facts. */
export type RestCheckpoint = { version: 1; decisionId: string; sessionId: string; nextSetKey: string; remainingMs: number; deadlineMs: number | null; running: boolean }
export function restKey(decisionId: string, sessionId: string) { return `rs-rest-v1:${encodeURIComponent(decisionId)}:${encodeURIComponent(sessionId)}` }
export function restRemaining(c: RestCheckpoint, now: number): number { return Math.max(0, c.running && c.deadlineMs !== null ? c.deadlineMs - now : c.remainingMs) }
export function decodeRest(raw: string | null, decisionId: string, sessionId: string): RestCheckpoint | null {
  if (!raw) return null
  try {
    const c: unknown = JSON.parse(raw)
    if (!c || typeof c !== 'object') return null
    const x = c as Partial<RestCheckpoint>
    if (x.version !== 1 || x.decisionId !== decisionId || x.sessionId !== sessionId || typeof x.nextSetKey !== 'string' || !x.nextSetKey || typeof x.remainingMs !== 'number' || !Number.isFinite(x.remainingMs) || x.remainingMs < 0 || x.remainingMs > 86400000 || typeof x.running !== 'boolean' || (x.deadlineMs !== null && (typeof x.deadlineMs !== 'number' || !Number.isFinite(x.deadlineMs)))) return null
    return x as RestCheckpoint
  } catch { return null }
}
