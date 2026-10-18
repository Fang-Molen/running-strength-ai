import test from 'node:test'
import assert from 'node:assert/strict'
import original from './catalogue.json' with { type: 'json' }
import type { ReadonlyDrillCatalogue } from './types'

// Test first import as well as reads under unavailable browser storage/network APIs.
const accessed: string[] = []
const externalApis = ['localStorage', 'sessionStorage', 'indexedDB', 'caches', 'fetch'] as const
const descriptors = new Map(externalApis.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
let api: typeof import('./catalogue')
try {
  for (const key of externalApis) Object.defineProperty(globalThis, key, { configurable: true, get() { accessed.push(key); throw new Error(`Unexpected external access: ${key}`) } })
  api = await import('./catalogue')
  api.getDrill('fk-run-tech-001')
  api.filterDrills({ category: 'observation', equipment: '手机/支架' })
} finally {
  for (const key of externalApis) {
    const descriptor = descriptors.get(key)
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
}

const { catalogue, categories, getDrill, filterDrills, parseCatalogue } = api
const ids = (rows: readonly { id: string }[]) => rows.map(row => row.id)

test('R190 catalogue import and filtering do not access storage, cache or network', () => {
  assert.deepEqual(accessed, [])
})

test('R190 preserves every original field in 53 unique drafts and nine categories', () => {
  assert.deepEqual(catalogue, original)
  assert.equal(catalogue.count, 53)
  assert.equal(catalogue.drills.length, 53)
  assert.equal(new Set(catalogue.drills.map(drill => drill.id)).size, 53)
  assert.equal(Object.keys(categories).length, 9)
  assert.equal(catalogue.status, 'curated_draft_requires_coach_review')
  assert.ok(catalogue.drills.every(drill => drill.review_status === 'draft_needs_coach_review' && drill.kind === 'running_technique'))
})

test('R190 content keeps source references, limitations, versions and absent-media truth', () => {
  const sourceIds = new Set(catalogue.sources.map(source => source.id))
  const storyboards = new Set<string>()
  for (const drill of catalogue.drills) {
    assert.equal(drill.content_version, '1.0.0')
    assert.ok(drill.evidence.limits.length > 0)
    assert.ok(drill.evidence.source_ids.every(id => sourceIds.has(id)))
    assert.deepEqual([drill.media.status, drill.media.type, drill.media.url], ['not_provided', 'none', null])
    if (drill.media.animation_storyboard_id) storyboards.add(drill.media.animation_storyboard_id)
    assert.ok(drill.body_region_roles.every(region => region.role === 'anatomical_relevance_only'))
  }
  assert.equal(storyboards.size, 12)
  assert.deepEqual(getDrill('fk-run-tech-047')?.body_region_roles, [])
})

test('R190 stable ID lookup never falls back to another action', () => {
  assert.equal(getDrill('fk-run-tech-007')?.name_en, 'A-March')
  assert.equal(getDrill('fk-run-tech-053')?.name_zh, '快腿节奏+放松跑')
  assert.equal(getDrill('unknown'), undefined)
  assert.equal(getDrill('pushup'), undefined)
  assert.equal(getDrill('fk-run-tech-007 '), undefined)
})

test('R190 filters categories, events and levels together without changing catalogue order', () => {
  assert.equal(filterDrills({ category: 'coordination' }).length, 8)
  assert.equal(filterDrills({ level: 'advanced' }).length, 5)
  const result = filterDrills({ category: 'observation', event: '800', level: 'beginner' })
  assert.deepEqual(ids(result), ['fk-run-tech-047', 'fk-run-tech-048'])
  assert.equal(filterDrills().length, 53)
})

test('R190 searches Chinese, case-insensitive English, normalized input and step instructions', () => {
  // Also finds the explicit A-March regression/instructions in A-Skip and the combination.
  assert.deepEqual(ids(filterDrills({ query: '  Ａ－ＭＡＲＣＨ  ' })), ['fk-run-tech-007', 'fk-run-tech-008', 'fk-run-tech-051'])
  assert.deepEqual(ids(filterDrills({ query: '耳、肩、骨盆' })), ['fk-run-tech-001'])
  assert.deepEqual(ids(filterDrills({ query: '侧面跑姿录像' })), ['fk-run-tech-047'])
  assert.equal(filterDrills({ query: '不存在的技术动作XYZ' }).length, 0)
})

test('R190 supports every named equipment label and none without treating unknown as none', () => {
  assert.deepEqual(ids(filterDrills({ equipment: '手机/支架' })), ['fk-run-tech-047', 'fk-run-tech-048', 'fk-run-tech-049'])
  assert.deepEqual(ids(filterDrills({ equipment: '手机节拍器/手表' })), ['fk-run-tech-039'])
  assert.deepEqual(ids(filterDrills({ equipment: '软质低障碍/地面标记' })), ['fk-run-tech-031'])
  assert.equal(filterDrills({ equipment: 'none' }).length, 48)
  assert.equal(filterDrills({ equipment: '未提供器材' }).length, 0)
  assert.deepEqual(ids(filterDrills({ equipment: '手机/支架', level: 'intermediate' })), ['fk-run-tech-049'])
})

test('R190 unknown dose measures remain null and ranges are not converted into a prescription', () => {
  const posture = getDrill('fk-run-tech-001')!
  assert.deepEqual(posture.starting_dose, { sets: [1, 2], distance_m: null, duration_s: [15, 30], reps: null, rest_s: [20, 60] })
  assert.deepEqual(getDrill('fk-run-tech-015')!.starting_dose.reps, [8, 15])
  assert.equal(Object.hasOwn(posture, 'approved'), false)
  assert.equal(Object.hasOwn(posture, 'planned'), false)
  assert.equal(Object.hasOwn(posture, 'actual'), false)
})

test('R190 nested content, reference arrays, ranges and filtered arrays are immutable', () => {
  const visit = (value: unknown) => {
    if (value !== null && typeof value === 'object') {
      assert.equal(Object.isFrozen(value), true)
      for (const child of Object.values(value)) visit(child)
    }
  }
  visit(catalogue)
  const drill = getDrill('fk-run-tech-001')!
  assert.equal(Reflect.set(drill, 'review_status', 'coach_reviewed'), false)
  assert.equal(Reflect.set(drill.starting_dose.sets, '0', 99), false)
  assert.equal(Reflect.set(drill.evidence.source_ids, '0', 'fabricated'), false)
  const result = filterDrills({ category: 'posture' })
  assert.equal(Object.isFrozen(result), true)
  assert.throws(() => Array.prototype.pop.call(result), TypeError)
  assert.equal(getDrill(drill.id)?.review_status, 'draft_needs_coach_review')
  assert.deepEqual(drill.starting_dose.sets, [1, 2])
})

test('R190 validation freezes a detached copy without mutating the supplied object', () => {
  const input = structuredClone(original)
  const snapshot = parseCatalogue(input)
  assert.equal(Object.isFrozen(input), false)
  input.drills[0].name_zh = '外部改名'
  input.drills[0].starting_dose.sets[0] = 9
  assert.equal(snapshot.drills[0].name_zh, '站姿-跑姿对齐')
  assert.deepEqual(snapshot.drills[0].starting_dose.sets, [1, 2])
})

type MutableFixture = typeof original
const badCases: [string, (value: MutableFixture) => void][] = [
  ['missing source reference', value => { value.drills[0].evidence.source_ids = ['UNKNOWN'] }],
  ['duplicate drill identity', value => { value.drills[1].id = value.drills[0].id }],
  ['inventory loss', value => { value.drills.pop() }],
  ['unknown content schema', value => { value.schema_version = '2.0.0' }],
  ['false library approval', value => { value.status = 'approved' }],
  ['false action approval', value => { value.drills[0].review_status = 'coach_reviewed' }],
  ['fabricated animation', value => { value.drills[0].media.status = 'available' }],
  ['invalid storyboard reference', value => { value.drills[0].media.animation_storyboard_id = 'SB-99' }],
  ['missing evidence limits', value => { value.drills[0].evidence.limits = '' }],
  ['inverted dose range', value => { value.drills[0].starting_dose.sets = [4, 1] }],
  ['non-finite dose', value => { value.drills[0].starting_dose.duration_s = [15, Infinity] }],
  ['zero dose invented from missing', value => { value.drills[0].starting_dose.distance_m = [0, 0] }],
  ['unsafe evidence URL', value => { value.sources[0].url = 'javascript:alert(1)' }],
  ['unknown category', value => { value.drills[0].category_id = 'strength' }],
  ['wrong category label', value => { value.drills[0].category_name = '错误分类' }],
  ['unrecognized event', value => { value.drills[0].event_tags = ['pentathlon'] }],
]
for (const [name, mutate] of badCases) test(`R190 rejects ${name}; no partial catalogue or fabricated defaults`, () => {
  const input = structuredClone(original)
  mutate(input)
  assert.throws(() => parseCatalogue(input), /RUN_TECH_CATALOGUE_INVALID/)
  assert.equal(catalogue.drills.length, 53)
  assert.equal(catalogue.drills[0].review_status, 'draft_needs_coach_review')
})

// Compile-time contract: consumers can read content through its deeply readonly type.
const typedCatalogue: ReadonlyDrillCatalogue = catalogue
void typedCatalogue
