import type { UnifiedFact } from '../health/unified-facts'
import type { DeviceParseResult } from './device-parse'

type Picks = Readonly<Record<string, boolean>>

/** Include the complete revision payload so conflicting evidence stays distinct. */
export const reviewFactKey = (fact: UnifiedFact): string => JSON.stringify(fact)

function uniqueFacts(facts: readonly UnifiedFact[]): UnifiedFact[] {
  return [...new Map(facts.map(fact => [reviewFactKey(fact), fact])).values()]
}

export function reviewStatusFacts(result: DeviceParseResult): UnifiedFact[] {
  return uniqueFacts((result.facts ?? []).filter(fact => fact.quality !== 'VALID'))
}

/** Count and persistence share one explicit selection. A selected reading keeps
 * its original evidence history; unrelated missing/retracted states opt in. */
export function selectReviewedDeviceRows(result: DeviceParseResult, healthPicks: Picks, activityPicks: Picks, statusPicks: Picks) {
  const health = result.health.filter(row => healthPicks[row.key] === true)
  const activities = result.activities.filter(row => activityPicks[row.key] === true)
  const states = reviewStatusFacts(result).filter(fact => statusPicks[reviewFactKey(fact)] === true)
  const facts = uniqueFacts([...health.flatMap(row => row.observation?.facts ?? []), ...states])
  return { health, activities, facts, count: health.length + activities.length + states.length }
}
