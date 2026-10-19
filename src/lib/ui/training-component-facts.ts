/** Read-only component facts. Planned modalities never establish actual work. */
export type ComponentId = 'running' | 'strength'
export type ComponentFact = {
  sessionId: string
  componentId: ComponentId
  status: 'done' | 'reduced' | 'skipped' | 'not_recorded' | 'recorded'
  originIds: string[]
  rpe: number | null
  provenance: 'component' | 'execution' | 'manual' | 'linked'
  distanceM?: number | null
  durationSec?: number | null
  sets?: number | null
  strengthVolumeKg?: number | null
}
export function normalizePlanSessionId(id: string): string {
  const unprefixed = id.replace(/^sched:/, '')
  const bare = unprefixed.startsWith('scheduled:') ? unprefixed.slice(10).replace(/:(?:run|strength)$/, '') : unprefixed
  return bare.match(/^plan400:\d{4}-\d\d-\d\d/)?.[0] ?? bare
}
export const componentCompleted = (fact: ComponentFact | undefined) => fact?.status === 'done' || fact?.status === 'reduced'
export const componentHasActual = (fact: ComponentFact) => componentCompleted(fact) || fact.status === 'recorded'
export function allComponentsCompleted(planned: readonly ComponentId[], facts: readonly ComponentFact[]): boolean {
  return planned.length > 0 && planned.every(id => componentCompleted(facts.find(f => f.componentId === id)))
}
export function mergeComponentFacts(facts: readonly ComponentFact[]): ComponentFact[] {
  const rank = { linked: 0, manual: 1, execution: 2, component: 3 }, out: ComponentFact[] = []
  for (const fact of facts) {
    const at = out.findIndex(f => f.sessionId === fact.sessionId && f.componentId === fact.componentId)
    if (at < 0) { out.push({ ...fact, originIds: [...fact.originIds] }); continue }
    const prior = out[at]
    const chosen = rank[fact.provenance] > rank[prior.provenance] ? fact : rank[fact.provenance] < rank[prior.provenance] ? prior
      : !componentCompleted(prior) ? prior : fact
    out[at] = { ...prior, ...fact, ...chosen, originIds: [...new Set([...prior.originIds, ...fact.originIds])] }
  }
  return out
}
export function actualSport(facts: readonly ComponentFact[]): 'RUNNING' | 'STRENGTH' | 'MIXED' | 'UNKNOWN' {
  const run = facts.some(f => f.componentId === 'running' && componentHasActual(f)), lift = facts.some(f => f.componentId === 'strength' && componentHasActual(f))
  return run && lift ? 'MIXED' : run ? 'RUNNING' : lift ? 'STRENGTH' : 'UNKNOWN'
}
