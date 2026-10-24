/** One current, effective athlete profile shared by the health, diet, personal-coach
 * and coach paths, so they never use different weights or goals.
 *
 * Inputs are the three places the app already stores these values:
 *  - dated body measurements (BODY_MEASUREMENT_RECORDED / legacy body log)
 *  - the main athlete profile (运动员档案, no save timestamp)
 *  - the personal-coach profile (私人教练, revision + saved time)
 * Rules: a measured value beats a typed one; a dated value beats an undated one;
 * missing stays unknown (never 0); differing values are reported as conflicts to
 * check instead of being silently merged. Reading never writes.
 */
import type { Profile } from '@/lib/strength/profile'
import type { BodyCheck } from '@/lib/nutrition/body'
import type { PersonalProfile, Goal } from '@/lib/coach/personal/planner'

export type ProfileSource = 'BODY_MEASUREMENT' | 'ATHLETE_PROFILE' | 'PERSONAL_COACH'
export const SOURCE_LABEL: Record<ProfileSource, string> = {
  BODY_MEASUREMENT: '身体测量',
  ATHLETE_PROFILE: '运动员档案',
  PERSONAL_COACH: '私人教练资料',
}
export type Known<T> = { value: T; source: ProfileSource; at: string | null; version: string }
export type Field<T> = Known<T> | null
export type EffectiveGoal = 'FAT_LOSS' | 'WEIGHT_MAINTENANCE' | 'HYPERTROPHY' | 'RUN_PERFORMANCE' | 'WEIGHT_GAIN'
export type ProfileConflict = { field: 'weightKg' | 'age' | 'sex' | 'heightCm' | 'goal'; values: { value: string; source: ProfileSource; at: string | null }[] }

export type EffectiveProfile = {
  weightKg: Field<number>
  age: Field<number>
  sex: Field<'male' | 'female'>
  heightCm: Field<number>
  goal: Field<EffectiveGoal>
  conflicts: ProfileConflict[]
  missing: ('weightKg' | 'age' | 'sex' | 'heightCm' | 'goal')[]
  /** Stable digest of the inputs, used to detect that dependent advice is out of date. */
  version: string
}

export type EffectiveProfileInput = {
  profile: Profile | null
  /** When the athlete profile was last saved; null for profiles saved before this was recorded. */
  profileSavedAt?: string | null
  checks: BodyCheck[]
  personal: { profile: PersonalProfile | null; profileSavedAt: string | null } | null
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}
/** Measurement noise and day-to-day variation are not conflicts. */
const WEIGHT_TOLERANCE_KG = 1.5
const HEIGHT_TOLERANCE_CM = 2

const AIM_GOAL: Record<string, EffectiveGoal> = { lose: 'FAT_LOSS', keep: 'WEIGHT_MAINTENANCE', gain: 'WEIGHT_GAIN' }
const GOAL_LABEL: Record<EffectiveGoal, string> = {
  FAT_LOSS: '减脂', WEIGHT_MAINTENANCE: '维持体重', HYPERTROPHY: '增肌', RUN_PERFORMANCE: '跑步表现', WEIGHT_GAIN: '增重',
}
/** Personal-coach goals that are compatible with the athlete-profile aim. */
const COMPATIBLE: Record<string, EffectiveGoal[]> = {
  FAT_LOSS: ['FAT_LOSS'],
  WEIGHT_MAINTENANCE: ['WEIGHT_MAINTENANCE', 'RUN_PERFORMANCE', 'HYPERTROPHY'],
  WEIGHT_GAIN: ['WEIGHT_GAIN', 'HYPERTROPHY'],
}

const digest = (value: unknown) => {
  const text = JSON.stringify(value)
  let h = 2166136261
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0).toString(16)
}

const RANK: Record<ProfileSource, number> = { BODY_MEASUREMENT: 0, PERSONAL_COACH: 1, ATHLETE_PROFILE: 2 }
/** Newest dated value first; undated values last; measurements win ties. */
function newestFirst<T>(a: Known<T>, b: Known<T>) {
  const ta = a.at ? Date.parse(a.at) : NaN, tb = b.at ? Date.parse(b.at) : NaN
  if (Number.isFinite(ta) !== Number.isFinite(tb)) return Number.isFinite(ta) ? -1 : 1
  if (Number.isFinite(ta) && Number.isFinite(tb) && a.at!.slice(0, 10) !== b.at!.slice(0, 10)) return tb - ta
  return RANK[a.source] - RANK[b.source]
}

function latestCheck(checks: BodyCheck[]): BodyCheck | null {
  return [...checks].filter(c => num(c.weight) !== null).sort((a, b) => a.date.localeCompare(b.date) || (a.recordedAt ?? '').localeCompare(b.recordedAt ?? '')).at(-1) ?? null
}

export function resolveEffectiveProfile(input: EffectiveProfileInput): EffectiveProfile {
  const { profile } = input
  const personal = input.personal?.profile ?? null
  const personalAt = input.personal?.profileSavedAt ?? null
  const personalVersion = personal ? `personal:r${personal.revision}` : ''
  const conflicts: ProfileConflict[] = []

  const profileAt = input.profileSavedAt ?? null
  const profileVersion = `profile:${profileAt ?? 'undated'}`
  // Weight: the most recent dated value is current; measurements win ties; undated last.
  const check = latestCheck(input.checks)
  const weights: Known<number>[] = []
  if (check) weights.push({ value: check.weight, source: 'BODY_MEASUREMENT', at: check.recordedAt ?? check.date, version: `body:${check.date}:${check.id}` })
  if (num(personal?.weightKg) !== null) weights.push({ value: personal!.weightKg!, source: 'PERSONAL_COACH', at: personalAt, version: personalVersion })
  if (num(profile?.weightKg) !== null) weights.push({ value: num(profile!.weightKg)!, source: 'ATHLETE_PROFILE', at: profileAt, version: profileVersion })
  weights.sort(newestFirst)
  const weightKg = weights[0] ?? null
  // Values recorded more than two weeks before the current one are history, not a conflict.
  const comparable = weights.slice(1).filter(w => !weightKg?.at || !w.at || Date.parse(weightKg.at) - Date.parse(w.at) <= 14 * 86400000)
  if (weightKg && comparable.some(w => Math.abs(w.value - weightKg.value) > WEIGHT_TOLERANCE_KG))
    conflicts.push({ field: 'weightKg', values: [weightKg, ...comparable].map(w => ({ value: `${w.value} kg`, source: w.source, at: w.at })) })

  // Age, sex, height: the more recently saved entry wins; the other fills gaps.
  const pick = <T,>(field: 'age' | 'sex' | 'heightCm', fromPersonal: T | null, fromProfile: T | null, same: (a: T, b: T) => boolean): Field<T> => {
    const a: Known<T> | null = fromPersonal !== null ? { value: fromPersonal, source: 'PERSONAL_COACH', at: personalAt, version: personalVersion } : null
    const b: Known<T> | null = fromProfile !== null ? { value: fromProfile, source: 'ATHLETE_PROFILE', at: profileAt, version: profileVersion } : null
    if (a && b && !same(a.value, b.value)) conflicts.push({ field, values: [a, b].map(k => ({ value: String(k.value), source: k.source, at: k.at })) })
    return [a, b].filter((k): k is Known<T> => k !== null).sort(newestFirst)[0] ?? null
  }
  const age = pick('age', num(personal?.age), num(profile?.age), (x, y) => x === y)
  const sex = pick<'male' | 'female'>('sex', personal?.sex ?? null, profile?.sex === 'male' || profile?.sex === 'female' ? profile.sex : null, (x, y) => x === y)
  const heightCm = pick('heightCm', num(personal?.heightCm), num(profile?.heightCm), (x, y) => Math.abs(x - y) <= HEIGHT_TOLERANCE_CM)

  // Goal: report incompatible goals instead of letting each page pick its own.
  const profileGoal = profile?.aim ? AIM_GOAL[profile.aim] ?? null : null
  const personalGoal: Goal | null = personal?.goal ?? null
  let goal: Field<EffectiveGoal> = null
  const goals: Known<EffectiveGoal>[] = []
  if (personalGoal) goals.push({ value: personalGoal, source: 'PERSONAL_COACH', at: personalAt, version: personalVersion })
  if (profileGoal) goals.push({ value: profileGoal, source: 'ATHLETE_PROFILE', at: profileAt, version: profileVersion })
  goal = goals.sort(newestFirst)[0] ?? null
  if (personalGoal && profileGoal && !(COMPATIBLE[profileGoal] ?? [profileGoal]).includes(personalGoal))
    conflicts.push({ field: 'goal', values: [
      { value: GOAL_LABEL[personalGoal], source: 'PERSONAL_COACH', at: personalAt },
      { value: GOAL_LABEL[profileGoal], source: 'ATHLETE_PROFILE', at: profileAt },
    ] })

  const fields = { weightKg, age, sex, heightCm, goal }
  const missing = (Object.keys(fields) as (keyof typeof fields)[]).filter(k => fields[k] === null)
  return { ...fields, conflicts, missing, version: digest([fields, conflicts]) }
}

const FIELD_LABEL: Record<ProfileConflict['field'], string> = { weightKg: '体重', age: '年龄', sex: '性别', heightCm: '身高', goal: '目标' }
const when = (at: string | null) => (at ? at.slice(0, 10) : '时间未记录')

/** Plain-language lines with source and time, for facts sent to the coach and for display. */
export function describeEffectiveProfile(p: EffectiveProfile): string[] {
  const line = <T,>(label: string, f: Field<T>, show: (v: T) => string) =>
    f ? `${label}：${show(f.value)}（${SOURCE_LABEL[f.source]}，${when(f.at)}）` : `${label}：未知`
  const out = [
    line('当前体重', p.weightKg, v => `${v} kg`),
    line('年龄', p.age, v => `${v} 岁`),
    line('性别', p.sex, v => (v === 'male' ? '男' : '女')),
    line('身高', p.heightCm, v => `${v} cm`),
    line('目标', p.goal, v => GOAL_LABEL[v]),
  ]
  for (const c of p.conflicts)
    out.push(`待核对：${FIELD_LABEL[c.field]}在不同页面不一致——${c.values.map(v => `${SOURCE_LABEL[v.source]} ${v.value}（${when(v.at)}）`).join(' / ')}`)
  return out
}

/** A question that would change advice, at most one per conflict. */
export function conflictQuestions(p: EffectiveProfile): string[] {
  return p.conflicts.map(c => `${FIELD_LABEL[c.field]}在${c.values.map(v => SOURCE_LABEL[v.source]).join('和')}里不一致（${c.values.map(v => v.value).join(' / ')}），以哪个为准？`)
}

/** Apply the shared values to the athlete profile used by the nutrition calculation. */
export function withEffectiveBody(profile: Profile, p: EffectiveProfile): Profile {
  return {
    ...profile,
    weightKg: p.weightKg ? String(p.weightKg.value) : profile.weightKg,
    age: p.age ? String(p.age.value) : profile.age,
    sex: p.sex ? p.sex.value : profile.sex,
    heightCm: p.heightCm ? String(p.heightCm.value) : profile.heightCm,
  }
}

/** Apply the shared values to the personal-coach profile before planning. */
export function withEffectivePersonal(profile: PersonalProfile, p: EffectiveProfile): PersonalProfile {
  return {
    ...profile,
    weightKg: p.weightKg ? p.weightKg.value : profile.weightKg,
    age: p.age ? p.age.value : profile.age,
    sex: p.sex ? p.sex.value : profile.sex,
    heightCm: p.heightCm ? p.heightCm.value : profile.heightCm,
  }
}
