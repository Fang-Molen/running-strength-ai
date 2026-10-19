// v79.1：V4 整天状态也看分项 key；时间按北京时间显示（不受设备时区影响）
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dayStatus, partsDayStatus, progressCounts, type V4Plan } from './plan400-view.ts'
import { stampCN } from './activity-format.ts'
const plan = JSON.parse(readFileSync(new URL('../plan400-v4.json', import.meta.url), 'utf8')) as V4Plan
const d = plan.days.find(x => x.date === '2026-10-19')!   // 速度耐力＋力量A：跑步 + 力量
const rest = plan.days.find(x => /休息/.test(x.title))!
test('分项推整天状态：只有旧 log 时不变；分项都完成 → done；一项跳过 → reduced；都跳过 → skipped', () => {
  assert.equal(dayStatus(d, undefined, '2026-10-19'), 'not_started')
  assert.equal(dayStatus(d, undefined, '2026-10-19', false, { parts: { running: { status: 'done', rpe: 7 } } }), 'in_progress')
  assert.equal(dayStatus(d, undefined, '2026-10-19', false, { parts: { running: { status: 'done' }, strength: { status: 'done' } } }), 'done')
  assert.equal(dayStatus(d, undefined, '2026-10-19', false, { parts: { running: { status: 'skipped' }, strength: { status: 'done' } } }), 'reduced')
  assert.equal(dayStatus(d, undefined, '2026-10-19', false, { parts: { running: { status: 'skipped' }, strength: { status: 'skipped' } } }), 'skipped')
  assert.equal(dayStatus(d, undefined, '2026-10-19', false, { parts: { strength: { rpe: 6 } } }), 'in_progress')
  assert.equal(dayStatus(d, { done: 'done' }, '2026-10-19', false, { parts: { running: { status: 'skipped' } } }), 'done', '旧整课标记优先，不改历史')
})
test('手表跑步关联只算跑步有记录：整天 in_progress，不会 done', () => {
  assert.equal(dayStatus(d, undefined, '2026-10-19', false, { runLinked: true }), 'in_progress')
  assert.equal(partsDayStatus(d, { runLinked: true, parts: { running: { status: 'done' } } }), 'in_progress')
  assert.equal(partsDayStatus(d, undefined), null)
  assert.equal(dayStatus(rest, undefined, rest.date), 'rest')
})
test('进度计数也读分项', () => {
  const c = progressCounts(plan, {}, { '2026-10-19': { parts: { running: { status: 'done' }, strength: { status: 'reduced' } } } })
  assert.equal(c.recordedDays, 1); assert.equal(c.completedTrainingDays, 1)
  assert.equal(progressCounts(plan, {}, { '2026-10-19': { runLinked: true } }).completedTrainingDays, 0)
})
test('stampCN：UTC 时间戳按北京时间显示，与设备时区无关', () => {
  for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Shanghai']) {
    process.env.TZ = tz
    assert.equal(stampCN('2026-10-19T01:31:00.000Z'), '10-19 09:31')
    assert.equal(stampCN('2026-10-18T16:09:00Z', 'ymd'), '2026-10-19 00:09')
    assert.equal(stampCN('2026-10-18T23:30:00Z', 'hm'), '07:30')
  }
  assert.equal(stampCN(''), ''); assert.equal(stampCN('坏数据'), '坏数据')
})
test('源码里不再把 ISO 时间戳直接截成显示文本', () => {
  for (const f of ['plan400.tsx', 'plan400-parts.tsx', 'phone-record-detail.tsx', 'garmin-sync.tsx', 'settings-center.tsx', 'r8.tsx', 'unmarked-plans.tsx', 'coach-first-week-panel.tsx', 'online-features-settings.tsx']) {
    const src = readFileSync(new URL(`../../components/${f}`, import.meta.url), 'utf8')
    assert.ok(!/(At|\.at)\??\.slice\((0|5), ?16\)|\.replace\("T", " "\)|startedAt\.slice\(11/.test(src), f)
  }
})
