/** Browser reader for the shared effective profile. Reading never writes. */
import { currentAthleteId } from '@/lib/core/events'
import { loadProfile, profileSavedAt, profileFieldTimes, type Profile } from '@/lib/strength/profile'
import { loadChecks } from '@/lib/nutrition/body'
import { createPersonalStore } from '@/lib/coach/personal/store'
import { resolveEffectiveProfile, withEffectiveBody, type EffectiveProfile } from './effective-profile'

/** Window events that can change the effective profile; pages and the coach re-read on these. */
export const EFFECTIVE_PROFILE_EVENTS = ['fk-profile-changed', 'fk-personal-profile-changed', 'fk-health-changed', 'storage'] as const

function readPersonal() {
  try {
    if (typeof window === 'undefined') return null
    const state = createPersonalStore(window.localStorage, currentAthleteId).read()
    return { profile: state.profile, profileSavedAt: state.profileSavedAt }
  } catch {
    // An unreadable personal store stays unknown; it never blocks the other sources.
    return null
  }
}

export function readEffectiveProfile(profile: Profile = loadProfile()): EffectiveProfile {
  let checks: ReturnType<typeof loadChecks> = []
  try { checks = loadChecks() } catch { checks = [] }
  return resolveEffectiveProfile({ profile, profileSavedAt: profileSavedAt(), profileFieldSavedAt:profileFieldTimes(), checks, personal: readPersonal() })
}

/** The athlete profile with the shared current weight/age/sex/height applied, for nutrition. */
export function effectiveNutritionProfile(profile: Profile = loadProfile()): Profile {
  return withEffectiveBody(profile, readEffectiveProfile(profile))
}
