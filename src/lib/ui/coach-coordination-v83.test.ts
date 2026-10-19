// v83 整改包 P0-05：协同中枢“今日”不再写死 0，按分项真实状态显示
import assert from 'node:assert/strict'
import test from 'node:test'
import { coachCoordinationView, coachCoordinationNext, todayCoordinationParts } from './coach-coordination-view.ts'
const T = '2026-10-19'
test('P0-05：跑步完成、力量未记录 → “跑步已完成，力量未记录”；1/2', () => {
  const rows = [{ date: T, v4: { date: T, running: { state: 'done' as const }, strength: null } }]
  const { parts } = todayCoordinationParts(rows, [], T, { run: true, lift: true })
  assert.deepEqual(parts, [{ label: '跑步', state: 'done' }, { label: '力量', state: 'none' }])
  const v = coachCoordinationView({ loaded: true, todayParts: parts, strengthSessions: 3 }).find(x => x.id === 'today')!
  assert.equal(v.readout, '跑步已完成，力量未记录')
  assert.match(coachCoordinationNext({ loaded: true, todayParts: parts, strengthSessions: 3 }).detail, /跑步已完成，力量未记录/)
})
test('P0-05：两项都完成 → 下一步去日志；候选手表跑步 → 提示确认，不算完成', () => {
  const done = [{ label: '跑步', state: 'done' as const }, { label: '力量', state: 'reduced' as const }]
  assert.equal(coachCoordinationNext({ loaded: true, todayParts: done, strengthSessions: 1 }).target, 'log')
  const cand = [{ label: '跑步', state: 'candidate' as const }, { label: '力量', state: 'done' as const }]
  assert.equal(coachCoordinationNext({ loaded: true, todayParts: cand, strengthSessions: 1 }).title, '确认今天的手表跑步')
  assert.match(coachCoordinationView({ loaded: true, todayParts: cand, strengthSessions: 1 })[1].readout, /待确认/)
})
test('P0-05：日程上的其他计划课按实际；计划外记录只做说明', () => {
  const entries = [{ id: 'e1', date: T, title: '轻松跑', status: 'done', actual: { outcome: 'as_planned' } }, { id: 'q-1', date: T, title: '跑步', status: 'done', unplanned: true, actual: { outcome: 'as_planned' } }]
  const r = todayCoordinationParts([{ date: T, quickLog: true, source: 'import', originIds: ['act-q-n-1'] }], entries, T, null)
  assert.deepEqual(r.parts, [{ label: '轻松跑', state: 'done' }]); assert.equal(r.unplanned, 1)
  assert.match(coachCoordinationView({ loaded: true, todayParts: r.parts, todayUnplanned: r.unplanned, strengthSessions: 0 })[1].readout, /另有 1 条计划外/)
})
