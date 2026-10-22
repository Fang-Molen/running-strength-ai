import { EXPERIENCE, GOALS, VENUES, WHEN, type Answers } from './first-run'
import { WATCHES } from './watch-mode'
import type { AboutMe } from '@/components/onboarding-about'

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type OnboardingSyncDraft = { step: number; me: AboutMe; answers: Answers; brand: string | null }
const key = (owner: string) => `fk-onboarding-sync-draft:${encodeURIComponent(owner)}`
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v))
const short = (v: unknown, max: number) => typeof v === 'string' && v.length <= max

/** Only a short-lived same-tab draft. No account credentials, saved profile or training writes. */
export function readOnboardingSyncDraft(store: Store, owner: string, now = Date.now()): OnboardingSyncDraft | null {
  try {
    const v: unknown = JSON.parse(store.getItem(key(owner)) ?? 'null')
    if (!object(v) || typeof v.at !== 'number' || v.at > now || now - v.at > 30 * 60_000 || typeof v.step !== 'number' || !Number.isInteger(v.step) || v.step < 0 || v.step > 5 || !(v.brand === null || short(v.brand, 40))) throw new Error('invalid-draft')
    const m = v.me, a = v.answers
    if (!object(m) || !short(m.nickname, 20) || !short(m.birthYear, 4) || !short(m.event, 20) || !short(m.pb, 20) || !['', 'female', 'male'].includes(String(m.sex))) throw new Error('invalid-about')
    if (!object(a) || !WATCHES.some(x => x[0] === a.source) || !EXPERIENCE.some(x => x[0] === a.experience) || !VENUES.some(x => x[0] === a.venue) || !Array.isArray(a.goals) || a.goals.length > 2 || !a.goals.every(g => GOALS.some(x => x[0] === g)) || !Array.isArray(a.equipment) || a.equipment.length > 20 || !a.equipment.every(e => short(e, 50)) || !Array.isArray(a.days) || a.days.length > 7 || !a.days.every(d => Number.isInteger(d) && d >= 0 && d <= 6) || typeof a.minutes !== 'number' || ![20, 30, 45, 60].includes(a.minutes) || !(a.when === null || WHEN.some(x => x[0] === a.when))) throw new Error('invalid-answers')
    return { step: v.step, me: { nickname: m.nickname, sex: m.sex, birthYear: m.birthYear, event: m.event, pb: m.pb } as AboutMe, answers: { source: a.source, goals: a.goals, experience: a.experience, venue: a.venue, equipment: a.equipment, days: a.days, minutes: a.minutes, when: a.when } as Answers, brand: v.brand as string | null }
  } catch { try { store.removeItem(key(owner)) } catch { /* unavailable session storage */ }; return null }
}
export function saveOnboardingSyncDraft(store: Store, owner: string, draft: OnboardingSyncDraft, now = Date.now()): void {
  try { store.setItem(key(owner), JSON.stringify({ ...draft, at: now })) } catch { /* setup can continue without a resume draft */ }
}
export function clearOnboardingSyncDraft(store: Store, owner: string): void { try { store.removeItem(key(owner)) } catch { /* unavailable session storage */ } }
