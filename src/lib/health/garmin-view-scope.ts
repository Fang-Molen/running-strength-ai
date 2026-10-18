import { currentAthleteId } from '../core/events'
import { currentStore } from '../core/storage'
export const garminScopeKey = (athlete = currentAthleteId()) => 'fk-garmin-view-scope:' + encodeURIComponent(athlete)
export function garminViewScope() { return currentStore()?.getItem(garminScopeKey()) ?? null }
export function garminViewKey(base: string) {
  const athlete = currentAthleteId(), scope = garminViewScope()
  return scope ? `${base}:${encodeURIComponent(athlete)}:${scope}` : athlete === 'local' ? base : `${base}:${encodeURIComponent(athlete)}:unbound`
}
