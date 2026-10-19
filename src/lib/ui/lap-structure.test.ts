// v83 整改包 P1-06：A09/A10/A11、N15/N16
import assert from 'node:assert/strict'
import test from 'node:test'
import { matchLaps, plannedRepsFromText } from './lap-structure.ts'
const lap = (i: number, dist: number | null, dur: number | null) => ({ i, dist, dur, avgHr: 150, maxHr: null, cad: null, elev: null, speed: null })
test('A09/N15：只有总距离总时间、没有圈段 → 未知，不造三组成绩', () => {
  const r = matchLaps(null, { distanceM: 150, reps: 3 }); assert.equal(r.status, 'unknown'); assert.match((r as { reason: string }).reason, /保持未知/)
})
test('A10：明确 150m×3（含恢复段）→ 逐组对照，恢复段算组间休息', () => {
  const laps = [lap(1, 800, 300), lap(2, 151, 21.3), lap(3, 300, 420), lap(4, 149, 21.0), lap(5, 320, 465), lap(6, 150, 21.6), lap(7, 600, 280)]
  const r = matchLaps(laps, plannedRepsFromText('正式主课：150m×3，组间6—8分钟，RPE 7')); assert.equal(r.status, 'matched')
  if (r.status !== 'matched') return
  assert.equal(r.repsText, '150m: 21.3/21.0/21.6'); assert.equal(r.restText, '7:00/7:45'); assert.equal(r.rounds.length, 1)
})
test('A11/N16：200m×4×2 → 2 轮×4 次，轮内与轮间休息分开，不展平成 8 次', () => {
  const laps: ReturnType<typeof lap>[] = []; let i = 1
  for (let r = 0; r < 2; r++) { for (let n = 0; n < 4; n++) { laps.push(lap(i++, 200, 32 + n)); if (n < 3) laps.push(lap(i++, 100, 150)) } if (r === 0) laps.push(lap(i++, 400, 600)) }
  const r = matchLaps(laps, { distanceM: 200, reps: 4, rounds: 2 }); assert.equal(r.status, 'matched'); if (r.status !== 'matched') return
  assert.equal(r.rounds.length, 2); assert.deepEqual(r.rounds.map(x => x.reps.length), [4, 4]); assert.deepEqual(r.rounds[0].restSec, [150, 150, 150]); assert.deepEqual(r.roundRestSec, [600])
  assert.match(r.restText, /轮间 10:00/)
  assert.equal(matchLaps(laps, { distanceM: 200, reps: 8 }).status, 'matched', '按 8 次计划也只在用户计划就是 8 次时成立')
  assert.equal(plannedRepsFromText('200m×4×2，组间2—3分钟')?.rounds, 2)
})
test('数量对不上 / 连续切圈 / 组合段 → 不对照（未知）', () => {
  assert.equal(matchLaps([lap(1, 150, 21), lap(2, 300, 400), lap(3, 150, 22)], { distanceM: 150, reps: 3 }).status, 'unknown')
  assert.equal(matchLaps([lap(1, 150, 21), lap(2, 150, 22), lap(3, 150, 22)], { distanceM: 150, reps: 3 }).status, 'unknown')
  assert.equal(plannedRepsFromText('正式主课：(250m＋150m)×1；两段间休10—12分钟'), null)
})
