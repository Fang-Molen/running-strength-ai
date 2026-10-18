import rawCatalogue from './catalogue.json' with { type: 'json' }
import type { Drill, DrillFilter, ReadonlyDrillCatalogue, TechniqueCategory } from './types'

const CATEGORY_IDS = ['posture', 'coordination', 'support', 'acceleration', 'maxspeed', 'curve', 'middle', 'observation', 'transfer'] as const
const EVENTS = ['100', '200', '400', '800', '1500', '3000', '5000', '10000', 'half_marathon', 'marathon'] as const
const LEVELS = ['beginner', 'intermediate', 'advanced'] as const
const EFFORTS = ['low', 'medium', 'high'] as const
const REGIONS = ['trunk_stabilizers', 'shoulder_girdle', 'hip_flexors', 'gluteal_region', 'hip_stabilizers', 'hip_extensors', 'quadriceps_region', 'hamstrings_region', 'calf_ankle'] as const
const DRILL_KEYS = ['id', 'schema_version', 'content_version', 'kind', 'name_zh', 'name_en', 'category_id', 'category_name', 'skill_level', 'effort_band', 'event_tags', 'primary_purpose', 'steps', 'cues', 'common_errors', 'correction_or_regression', 'starting_dose', 'dose_note', 'equipment', 'safety', 'evidence', 'media', 'body_region_roles', 'muscle_overlay_note', 'ui_badges', 'review_status'] as const

function invalid(path: string): never {
  throw new Error(`RUN_TECH_CATALOGUE_INVALID: ${path}`)
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(path)
  return value as Record<string, unknown>
}

function fields(value: Record<string, unknown>, expected: readonly string[], path: string) {
  const keys = Object.keys(value)
  if (keys.length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) invalid(`${path}.fields`)
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) invalid(path)
  return value
}

function array(value: unknown, path: string, allowEmpty = false): unknown[] {
  if (!Array.isArray(value) || (!allowEmpty && !value.length)) invalid(path)
  return value
}

function strings(value: unknown, path: string, allowEmpty = false): string[] {
  return array(value, path, allowEmpty).map((entry, index) => text(entry, `${path}[${index}]`))
}

function unique(values: readonly string[], path: string) {
  if (new Set(values).size !== values.length) invalid(path)
}

function oneOf(value: unknown, options: readonly string[], path: string): string {
  if (typeof value !== 'string' || !options.includes(value)) invalid(path)
  return value
}

function bounds(value: unknown, path: string, options: { nullable?: boolean; integer?: boolean; allowZero?: boolean } = {}) {
  if (value === null && options.nullable) return
  if (!Array.isArray(value) || value.length !== 2 || value.some(number => typeof number !== 'number' || !Number.isFinite(number) || (options.allowZero ? number < 0 : number <= 0) || (options.integer && !Number.isInteger(number))) || value[0] > value[1]) invalid(path)
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

/**
 * Fail closed on content/schema/approval/media drift. Returns an isolated frozen
 * copy; it neither freezes the caller's input nor writes any athlete/plan state.
 */
export function parseCatalogue(input: unknown): ReadonlyDrillCatalogue {
  const root = record(input, 'catalogue')
  fields(root, ['schema_version', 'dataset_version', 'status', 'count', 'categories', 'sources', 'drills'], 'catalogue')
  if (root.schema_version !== '1.0.0' || root.dataset_version !== '1.0.0' || root.status !== 'curated_draft_requires_coach_review' || root.count !== 53) invalid('catalogue.version/status/count')
  const categoryNames = record(root.categories, 'categories')
  fields(categoryNames, CATEGORY_IDS, 'categories')
  for (const key of CATEGORY_IDS) text(categoryNames[key], `categories.${key}`)

  const sources = array(root.sources, 'sources').map((entry, index) => {
    const source = record(entry, `sources[${index}]`)
    fields(source, ['id', 'name', 'url', 'supports'], `sources[${index}]`)
    for (const key of ['id', 'name', 'supports']) text(source[key], `sources[${index}].${key}`)
    const url = text(source.url, `sources[${index}].url`)
    try { if (new URL(url).protocol !== 'https:') invalid(`sources[${index}].url`) } catch { invalid(`sources[${index}].url`) }
    return source.id as string
  })
  unique(sources, 'sources.ids')
  const drills = array(root.drills, 'drills')
  if (drills.length !== root.count) invalid('drills.count')
  const ids: string[] = []
  const seenCategories = new Set<string>()
  drills.forEach((entry, index) => {
    const path = `drills[${index}]`
    const drill = record(entry, path)
    fields(drill, DRILL_KEYS, path)
    const id = text(drill.id, `${path}.id`)
    if (!/^fk-run-tech-\d{3}$/.test(id)) invalid(`${path}.id`)
    ids.push(id)
    if (drill.schema_version !== '1.0.0' || drill.kind !== 'running_technique' || drill.review_status !== 'draft_needs_coach_review') invalid(`${path}.schema/kind/review_status`)
    if (!/^\d+\.\d+\.\d+$/.test(text(drill.content_version, `${path}.content_version`))) invalid(`${path}.content_version`)
    for (const key of ['name_zh', 'name_en', 'primary_purpose', 'correction_or_regression', 'dose_note', 'muscle_overlay_note']) text(drill[key], `${path}.${key}`)
    const category = oneOf(drill.category_id, CATEGORY_IDS, `${path}.category_id`)
    seenCategories.add(category)
    if (drill.category_name !== categoryNames[category]) invalid(`${path}.category_name`)
    const level = oneOf(drill.skill_level, LEVELS, `${path}.skill_level`)
    const effort = oneOf(drill.effort_band, EFFORTS, `${path}.effort_band`)
    const events = strings(drill.event_tags, `${path}.event_tags`)
    events.forEach(value => oneOf(value, EVENTS, `${path}.event_tags`))
    unique(events, `${path}.event_tags`)
    for (const key of ['steps', 'cues', 'common_errors']) strings(drill[key], `${path}.${key}`)
    const equipment = strings(drill.equipment, `${path}.equipment`, true)
    if (equipment.includes('none')) invalid(`${path}.equipment.reserved-none`)
    unique(equipment, `${path}.equipment`)
    const badges = strings(drill.ui_badges, `${path}.ui_badges`)
    if (badges.length !== 2 || !badges.includes(level) || !badges.includes(effort)) invalid(`${path}.ui_badges`)

    const dose = record(drill.starting_dose, `${path}.starting_dose`)
    fields(dose, ['sets', 'distance_m', 'duration_s', 'reps', 'rest_s'], `${path}.starting_dose`)
    bounds(dose.sets, `${path}.starting_dose.sets`, { integer: true })
    bounds(dose.distance_m, `${path}.starting_dose.distance_m`, { nullable: true })
    bounds(dose.duration_s, `${path}.starting_dose.duration_s`, { nullable: true })
    bounds(dose.reps, `${path}.starting_dose.reps`, { nullable: true, integer: true })
    bounds(dose.rest_s, `${path}.starting_dose.rest_s`, { allowZero: true })
    if (dose.distance_m === null && dose.duration_s === null && dose.reps === null) invalid(`${path}.starting_dose.empty-reference`)

    const safety = record(drill.safety, `${path}.safety`)
    fields(safety, ['caution', 'stop_rule', 'requires_supervision'], `${path}.safety`)
    text(safety.caution, `${path}.safety.caution`)
    text(safety.stop_rule, `${path}.safety.stop_rule`)
    if (typeof safety.requires_supervision !== 'boolean') invalid(`${path}.safety.requires_supervision`)
    const evidence = record(drill.evidence, `${path}.evidence`)
    fields(evidence, ['classification', 'limits', 'source_ids'], `${path}.evidence`)
    text(evidence.classification, `${path}.evidence.classification`)
    text(evidence.limits, `${path}.evidence.limits`)
    const refs = strings(evidence.source_ids, `${path}.evidence.source_ids`)
    unique(refs, `${path}.evidence.source_ids`)
    if (refs.some(id => !sources.includes(id))) invalid(`${path}.evidence.source_ids`)

    const media = record(drill.media, `${path}.media`)
    fields(media, ['status', 'type', 'url', 'animation_storyboard_id'], `${path}.media`)
    if (media.status !== 'not_provided' || media.type !== 'none' || media.url !== null || (media.animation_storyboard_id !== null && (typeof media.animation_storyboard_id !== 'string' || !/^SB-(0[1-9]|1[0-2])$/.test(media.animation_storyboard_id)))) invalid(`${path}.media`)
    // Observation-only drills intentionally name no body region; do not invent one.
    array(drill.body_region_roles, `${path}.body_region_roles`, true).forEach((entry, regionIndex) => {
      const region = record(entry, `${path}.body_region_roles[${regionIndex}]`)
      fields(region, ['region_key', 'role'], `${path}.body_region_roles[${regionIndex}]`)
      oneOf(region.region_key, REGIONS, `${path}.body_region_roles[${regionIndex}].region_key`)
      if (region.role !== 'anatomical_relevance_only') invalid(`${path}.body_region_roles[${regionIndex}].role`)
    })
  })
  unique(ids, 'drills.ids')
  if (seenCategories.size !== CATEGORY_IDS.length) invalid('drills.categories')
  // The content version has an explicitly reviewed inventory, not a mutable remote feed.
  for (let n = 1; n <= 53; n++) if (!ids.includes(`fk-run-tech-${String(n).padStart(3, '0')}`)) invalid('drills.id-inventory')
  return deepFreeze(structuredClone(input)) as ReadonlyDrillCatalogue
}

export const catalogue: ReadonlyDrillCatalogue = parseCatalogue(rawCatalogue)
export const categories: Readonly<Record<TechniqueCategory, string>> = catalogue.categories
const byId = new Map(catalogue.drills.map(drill => [drill.id, drill]))

export function getDrill(id: string): Drill | undefined {
  return byId.get(id)
}

const normal = (value: string) => value.normalize('NFKC').toLowerCase().trim()

/** Pure catalogue filtering, not a safety clearance, recommendation or plan write. */
export function filterDrills(filter: DrillFilter = {}): readonly Drill[] {
  const query = normal(filter.query ?? '')
  return Object.freeze(catalogue.drills.filter(drill => {
    if (filter.category !== undefined && drill.category_id !== filter.category) return false
    if (filter.event !== undefined && !drill.event_tags.includes(filter.event)) return false
    if (filter.level !== undefined && drill.skill_level !== filter.level) return false
    if (filter.equipment !== undefined && (filter.equipment === 'none' ? drill.equipment.length !== 0 : !drill.equipment.includes(filter.equipment))) return false
    return !query || normal([drill.name_zh, drill.name_en, drill.primary_purpose, drill.category_name, ...drill.steps, ...drill.cues, ...drill.common_errors, drill.correction_or_regression, ...drill.equipment].join(' ')).includes(query)
  }))
}
