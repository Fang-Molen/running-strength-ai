// v79（用户 t489）：10-17 排了课但没练、没反馈（00:09 只打开过清单）→ 不是训练记录、不计入；10-18 自己新建的课标记后才是真记录。
process.env.TZ = 'Asia/Shanghai'
import test from 'node:test'
import assert from 'node:assert/strict'
import { phoneRows } from './training-read-model.ts'
import { summarize } from './log-range.ts'
import { unmarkedEntries } from './unmarked.ts'
const NOW = Date.parse('2026-10-19T01:30:00Z')
const store = (o: Record<string, unknown>) => ({ getItem: (k: string) => k in o ? JSON.stringify(o[k]) : null })
const planned = { id: 'str:core:2026-10-17:z', date: '2026-10-17', kind: 'strength', modality: 'strength', trainingType: 'strength', title: '力量课 · 核心+下肢', minutes: 40, source: 'fangkun', refId: 'core', status: 'planned' }
const own = { id: 'custom-1018', date: '2026-10-18', kind: 'strength', modality: 'strength', trainingType: 'strength', title: '力量·小腿', minutes: 40, source: 'custom', status: 'planned' }
const opened = { date: '2026-10-17', sessionId: 'core', moves: { sq: [{ done: false }, { done: false }] }, run: null, rpe: null, state: null, startedAt: Date.parse('2026-10-16T16:09:00Z'), restEndsAt: null, updatedAt: Date.parse('2026-10-16T16:09:30Z') }
test('只打开过清单（00:09，没勾组、没反馈）→ 不生成记录；在“还没标记的课”里显示未反馈', () => {
  const rows = phoneRows(store({ 'fk-schedule-v1': { entries: [planned, own] }, 'fk-today-checklist-v1': { '2026-10-17|core': opened } }), NOW)
  assert.equal(rows.length, 0, JSON.stringify(rows))
  const s = summarize(rows, '4w', 'all', '2026-10-19'); assert.equal(s.count, 0)
  const un = unmarkedEntries([planned, own] as never, '2026-09-22', '2026-10-19', '2026-10-19', 'all', new Set(rows.flatMap(r => r.originIds)))
  assert.deepEqual(un.map(e => e.date), ['2026-10-18', '2026-10-17'])
})
test('误勾了 1 组但没完成、没反馈 → 列出“未完成·未反馈”，不计入次数/时长', () => {
  const c = { ...opened, moves: { sq: [{ done: true, reps: 8, kg: 20 }, { done: false }] } }
  const rows = phoneRows(store({ 'fk-schedule-v1': { entries: [planned] }, 'fk-today-checklist-v1': { '2026-10-17|core': c } }), NOW)
  assert.equal(rows.length, 1); assert.equal(rows[0].status, 'incomplete')
  const s = summarize(rows, '4w', 'all', '2026-10-19'); assert.equal(s.count, 0); assert.equal(s.lift, 0); assert.equal(s.durationSec, 0); assert.equal(s.incomplete, 1); assert.equal(s.list.length, 1)
})
test('10-18 自己新建的课：标记完成后才是真记录并计入', () => {
  const done = { ...own, status: 'done', actual: { outcome: 'as_planned', minutes: 40 } }
  const rows = phoneRows(store({ 'fk-schedule-v1': { entries: [planned, done] }, 'fk-today-checklist-v1': { '2026-10-17|core': opened } }), NOW)
  assert.deepEqual(rows.map(r => [r.date, r.title, r.status]), [['2026-10-18', '力量·小腿', 'completed']])
  assert.equal(summarize(rows, '4w', 'lift', '2026-10-19').count, 1)
})
