// v88：U09 宿主接入——健康页卡片 / 方坤事实行只读、数据不足不编趋势、运动员隔离
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildHealthSnapshot } from './snapshot.ts'
import { personalStatsCards, personalStatsFactLine } from './personal-stats-host.ts'
const vit = (day: string, v: number) => ({ id: 'r' + day, kind: 'RHR', value: v, observedOn: day, source: 'DEVICE_CONFIRMED', createdAt: day + 'T08:00:00Z', athleteId: 'local', observation: { key: 'garmin:rhr:' + day, sourceId: 'garmin:qa', statistic: '佳明每日静息心率', syncedAt: day + 'T08:00:00Z' } })
const legacy = (day: string, v: number) => ({ id: 'l' + day, kind: 'RHR', value: v, observedOn: day, source: 'MANUAL', createdAt: day + 'T08:00:00Z', athleteId: 'local' })
test('没有数据 → 三项都是“数据不足”，事实行不写数字', () => {
  const cards = personalStatsCards(buildHealthSnapshot([], [], '2026-10-20'), 'local', '2026-10-20T12:00:00Z')
  assert.deepEqual(cards.map(c => c.metric), ['RHR', 'HRV', 'SLEEP'])
  assert.ok(cards.every(c => c.decisionAuthorized === false && c.status !== 'DESCRIPTIVE'))
  assert.doesNotMatch(personalStatsFactLine(cards)!, /均值/)
})
test('14 天静息心率 → 有描述统计；事实行标明只读、不是许可', () => {
  const days = Array.from({ length: 14 }, (_, i) => `2026-10-${String(7 + i).padStart(2, '0')}`)
  const snap = buildHealthSnapshot(days.map((d, i) => vit(d, 52 + (i % 3))) as never, [], '2026-10-20')
  const cards = personalStatsCards(snap, 'local', '2026-10-20T12:00:00Z'), rhr = cards.find(c => c.metric === 'RHR')!
  assert.ok(['DESCRIPTIVE', 'STATISTICAL_REVIEW'].includes(rhr.status), rhr.status)
  const line = personalStatsFactLine(cards)!
  assert.match(line, /不是恢复许可/); assert.match(line, /静息心率：有效可比记录 14 条/)
})
test('旧手工记录（统计口径未提供）→ 不当成可比序列，不出趋势', () => {
  const days = Array.from({ length: 14 }, (_, i) => `2026-10-${String(7 + i).padStart(2, '0')}`)
  const rhr = personalStatsCards(buildHealthSnapshot(days.map(d => legacy(d, 53)) as never, [], '2026-10-20'), 'local', '2026-10-20T12:00:00Z').find(c => c.metric === 'RHR')!
  assert.equal(rhr.status, 'NEED_MORE_DATA')
})
