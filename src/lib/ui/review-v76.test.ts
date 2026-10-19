import test from 'node:test'
import assert from 'node:assert/strict'
import { buildReview } from './review.ts'
const e = (id: string, date: string, extra: Record<string, unknown> = {}) => ({ id, date, kind: 'strength', modality: 'strength', title: '力量A', minutes: 45, status: 'done', actual: { outcome: 'as_planned', minutes: null, intensity: null, note: '', reasons: [], at: date + 'T12:00:00Z', ...extra } }) as any
test('flag-only "按计划完成" does not claim quality', () => {
  const r = buildReview('session', [e('a', '2026-10-16')], '2026-10-19', 'pro', 'a', '2026-10-19T00:20:00Z')
  assert.equal(r.verdict, '已标记按计划完成，训练质量依据不足。'); assert.doesNotMatch(r.verdict, /节奏不错|整体稳定/)
  assert.deepEqual(r.trainingDates, ['2026-10-16']); assert.equal(r.createdAt, '2026-10-19T00:20:00Z')
  assert.equal(r.linked![0].quality, false)
})
test('a real record on that day is linked and openable', () => {
  const r = buildReview('session', [e('a', '2026-10-16')], '2026-10-19', 'pro', 'a', '2026-10-19T00:20:00Z', [{ id: 'garmin:x:1', date: '2026-10-16', sport: 'STRENGTH', label: '佳明 力量训练 45分钟' }, { id: 'garmin:x:2', date: '2026-10-16', sport: 'RUNNING', label: '跑步' }])
  assert.deepEqual(r.linked![0].recordIds, ['garmin:x:1']); assert.match(r.verdict, /有实际记录可核对/)
})
