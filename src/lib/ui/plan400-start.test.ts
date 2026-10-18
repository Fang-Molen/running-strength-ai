import test from 'node:test'
import assert from 'node:assert/strict'
import { plan400StrengthEntry } from './plan400-start.ts'
import { resolveScheduledCourse } from './scheduled-execution.ts'
const dose = (n: string) => ({ unit: 'reps' as const, perSide: /分腿|单腿/.test(n) })
test('plan400 我的力量安排 becomes a runnable guided strength course', () => {
  const e = plan400StrengthEntry('2026-10-19', '400m', { parts: ['腿'], betweenRestSec: 120, exercises: [
    { name: '分腿蹲', sets: '2', reps: '5', weight: '20', rpe: '', sideRestSec: 15 } as never,
    { name: 'RDL', sets: '2', reps: '5', weight: '', rpe: '', restSec: 90 } as never,
  ] }, dose)
  const c = resolveScheduledCourse(e, { sessions: [] }, [])
  assert.deepEqual(c.errors, [])
  const [a, b] = c.strength!.moves
  assert.equal(a.perSide, true); assert.equal(a.sideRestSec, 15); assert.equal(a.restSec, 75); assert.equal(a.betweenRestSec, 120)
  assert.equal(b.perSide, undefined); assert.equal(b.weightKg, 0); assert.equal(b.restSec, 90)
})
