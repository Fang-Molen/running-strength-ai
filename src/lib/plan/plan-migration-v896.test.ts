// v89.6：应用不内置个人计划。① 老用户设备（有记录、没有计划文档）：记录原样、日志照常、计划页显示“未导入计划”；
// 导入计划文件后计划回来，记录一个字节都不变，可撤销。② 全新设备：没有计划、没有个人资料。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { activePlan, hasActivePlan, planLabel, planPrefix, PLAN_DOC_KEY } from './active-plan.ts'
import { previewImport, confirmImport, undoImport } from './plan-import.ts'
import { emptyProfile, type Profile } from '../strength/profile.ts'
import { scoreAbilities } from '../ui/ability-score-v76.ts'

class Mem { m = new Map<string, string>(); get length() { return this.m.size } key(i: number) { return [...this.m.keys()][i] ?? null } getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null } setItem(k: string, v: string) { this.m.set(k, String(v)) } removeItem(k: string) { this.m.delete(k) } clear() { this.m.clear() } }
const fixture = JSON.parse(readFileSync(new URL('../../../test-fixtures/private/plan400-v4.json', import.meta.url), 'utf8'))
const userFile = JSON.stringify({ schema: 'fangkun-plan-v1', label: '400米 V4', tag: 'V4', plan: fixture, profileDefaults: { marks: [{ meters: 400, goal: '53秒' }] } })
const day = fixture.days.find((d: { title: string }) => !/休息/.test(d.title)).date
const EXISTING: Record<string, string> = {
  'fk-plan400-v4-log': JSON.stringify({ [day]: { done: 'done', reps: '30.1 30.4 30.0', rpe: '7', athleteId: 'local', savedAt: '2026-10-19T12:00:00Z' } }),
  'fk-plan400-v4-overrides': JSON.stringify({ [day]: { parts: ['腘绳肌'], exercises: [], savedAt: '2026-10-19T10:00:00Z' } }),
  'fk-plan400-v4-components-v1': JSON.stringify({ days: { [day]: { running: { rpe: 7 } } } }),
  'fk-schedule-v1': JSON.stringify({ entries: [] }), 'fk-pain-log-v1': JSON.stringify([{ id: 'p1', date: day, part: '腘绳肌', score: 3 }]),
  'fr255-events-v1': JSON.stringify([{ id: 'e1' }]), 'fk-garmin-acts-v1': JSON.stringify([{ id: 1 }]), 'fk-onboard-v1': '1', 'fk-plan-source-v1': JSON.stringify({ active: '400m-v4' }),
  'fr255-profile-v1': JSON.stringify({ ...emptyProfile(), sex: 'male' }),
}
let saved: unknown
test.before(() => { saved = (globalThis as Record<string, unknown>).__FK_TEST_PLAN_DOC__; delete (globalThis as Record<string, unknown>).__FK_TEST_PLAN_DOC__ })
test.after(() => { (globalThis as Record<string, unknown>).__FK_TEST_PLAN_DOC__ = saved })
const seed = () => { const s = new Mem(); for (const [k, v] of Object.entries(EXISTING)) s.setItem(k, v); return s }
const snapshot = (s: Mem) => Object.fromEntries([...s.m.entries()].filter(([k]) => k !== PLAN_DOC_KEY && k !== 'fr255-profile-v1'))

test('existing-user device after code change: no plan in code → “未导入计划”, every record key untouched', () => {
  const s = seed(), before = JSON.stringify(snapshot(s))
  assert.equal(activePlan(s), null); assert.equal(hasActivePlan(s), false); assert.equal(planLabel(s), '未导入计划'); assert.equal(planPrefix(s), '')
  assert.equal(JSON.stringify(snapshot(s)), before)
})
test('importing the exported plan file: preview → confirm restores the plan; logs/feedback/Garmin/pain unchanged; undo works', () => {
  const s = seed(), before = JSON.stringify(snapshot(s)), profile: Profile = { ...emptyProfile(), sex: 'male' }
  const pv = previewImport(userFile, s, profile)
  assert.ok(pv.ok); if (!pv.ok) return
  assert.equal(pv.kind, 'plan'); assert.equal(pv.plan?.days, fixture.days.length); assert.deepEqual(pv.profileChanges, ['400米目标成绩：53秒'])
  assert.equal(s.getItem(PLAN_DOC_KEY), null, 'preview writes nothing')
  let savedProfile: Profile | null = null
  const r = confirmImport(userFile, s, profile, p => { savedProfile = p; s.setItem('fr255-profile-v1', JSON.stringify(p)) })
  assert.ok(r.ok); if (!r.ok) return
  assert.equal(activePlan(s)?.days.length, fixture.days.length); assert.equal(planLabel(s), '400米 V4'); assert.equal(planPrefix(s), 'V4 ')
  assert.equal(JSON.stringify(snapshot(s)), before, 'records/feedback/garmin/pain/onboarding keys byte-identical')
  assert.equal((savedProfile as Profile | null)?.marks.find(m => m.meters === 400)?.goal, '53秒')
  assert.ok(r.undo && undoImport(r.undo, s))
  assert.equal(activePlan(s), null); assert.equal(JSON.stringify(snapshot(s)), before)
})
test('profile defaults never overwrite what the user already filled', () => {
  const s = seed(), p: Profile = { ...emptyProfile(), marks: [{ meters: 400, goal: '52秒', recent: '', deadline: '' }] }
  const pv = previewImport(userFile, s, p); assert.ok(pv.ok && pv.profileChanges.length === 0)
})
test('fresh device: clean — no plan, no profile, no personal 400 target in scores', () => {
  const s = new Mem()
  assert.equal(activePlan(s), null); assert.equal(hasActivePlan(s), false); assert.equal(s.length, 0)
  const scores = scoreAbilities({ asOf: '2026-10-21T00:00:00Z', marks: [{ meters: 400, recentSec: 60, goalSec: null }], acts: [], laps: {}, lifts: [] } as never)
  const speed = scores.find(x => x.key === 'speed')!
  assert.equal(speed.score, null); assert.match(speed.reasonText, /目标成绩/)
})
test('a broken or foreign file is rejected without writing anything', () => {
  const s = seed(), before = JSON.stringify([...s.m.entries()])
  for (const bad of ['not json', '{"schema":"fangkun-plan-v1","plan":{"days":[]}}', '{"schema":"fangkun-plan-v1","plan":{"days":[{"date":"2026-1-1","title":"x","main":[],"aux":[],"strength":[]}]}}', '{"hello":1}']) {
    const pv = previewImport(bad, s, emptyProfile()); assert.equal(pv.ok, false, bad)
    const r = confirmImport(bad, s, emptyProfile(), () => {}); assert.equal(r.ok, false)
  }
  assert.equal(JSON.stringify([...s.m.entries()]), before)
})
