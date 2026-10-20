// v86.1 复盘页人话化：选课标签 + 四段式结果。合成数据，只测格式化，不读写存储。
import test from 'node:test'
import assert from 'node:assert/strict'
import { describeSession, sortNewestFirst, pacePerKm, shortWhen } from './session-option.ts'
import { plainReview } from './plain-review.ts'
import type { OfflineReview } from '../../core/coach-offline-loop.ts'

test('session label: date + type + distance + duration + pace; nothing invented', () => {
  assert.equal(describeSession({ id: 'a', startedAt: '', kind: 'RUN', distanceM: 8000, durationSec: 2880 }, '2026-06-21 17:43', 2026), '06-21 17:43 · 跑步 · 8公里 · 48:00 · 6:00/公里')
  assert.equal(describeSession({ id: 'b', startedAt: '', kind: 'RUN_REPEATS', repeats: { count: 4, distanceM: 400, workSec: 325 } }, '2026-06-24 20:37', 2026), '06-24 20:37 · 间歇跑 · 4×400米 · 3:23/公里')
  // 只有距离：不补时长、不算配速
  assert.equal(describeSession({ id: 'c', startedAt: '', kind: 'RUN', distanceM: 5000, durationSec: null }, '2026-06-25 16:03', 2026), '06-25 16:03 · 跑步 · 5公里')
  // 什么都没有：只有日期和类型
  assert.equal(describeSession({ id: 'd', startedAt: '', kind: 'OTHER' }, '2025-12-01 08:00', 2026), '2025-12-01 08:00 · 训练')
  // 计划名（关联了计划才有）
  assert.match(describeSession({ id: 'e', startedAt: '', kind: 'STRENGTH', strengthSets: 12, planName: '上肢A' }, '2026-06-20 10:00', 2026), /力量 · 12组 · 计划：上肢A$/)
  assert.equal(pacePerKm(0, 100), null); assert.equal(shortWhen('x'), 'x')
})

test('sessions newest first', () => {
  const r = sortNewestFirst([{ id: '1', startedAt: '2026-06-21T09:00:00Z' }, { id: '2', startedAt: '2026-06-25T09:00:00Z' }, { id: '3', startedAt: '2026-06-24T09:00:00Z' }])
  assert.deepEqual(r.map(x => x.id), ['2', '3', '1'])
})

const pts = [78, 80, 82, 85].map((s, i) => ({ occurrenceId: 'o', sourceId: 's' + i, seconds: s, distanceMeters: 400, paceSecondsPerKm: s * 2.5, pace: null, protocol: 'p', eventAt: '', source: 'USER_REPORT', confirmation: 'CONFIRMED' }))
const base = (over: Partial<OfflineReview> = {}): OfflineReview => ({
  occurrenceId: 'o', safetyRestricted: false, historyMetrics: [], missing: ['课程目的 UNKNOWN', '周期 UNKNOWN', '对应目标或计划条件未知', '整课主观强度未知', '症状反馈未知，不能当作无痛'],
  hypotheses: [{ id: 'h1', explanation: '可能是起始速度与本课目标不匹配，后段难以维持。', support: [], against: [], sourceIds: [] }, { id: 'h2', explanation: '实际恢复安排、当天身体反应或记录误差也可能改变用时；当前数字不能分开这些原因。', support: [], against: [], sourceIds: [] }],
  metrics: { points: pts, groups: [{ occurrenceId: 'o', sourceIds: pts.map(p => p.sourceId), count: 4, distanceMeters: 400, paces: [], trend: 'SLOWER', averagePace: '3:23', firstToLastSeconds: 7 }], rests: [120, 120, 120].map((s, i) => ({ occurrenceId: 'o', sourceId: 'r' + i, seconds: s, protocol: '', workSourceId: null, recoveryToWorkRatio: null })), ratings: [{ metric: 'SESSION_RPE', value: 8, unit: 'score', sourceId: 'x', eventAt: '', confirmation: 'CONFIRMED' }], strength: [], heartRates: [], unverifiedHeartRates: [], heartRateStatus: 'NOT_A_FORMAL_FIELD', physiologicalCauseKnown: false },
  text: '本次事实：…\n训练目的：…\n可能解释1：…\n不确定性：…', details: '数据充分性 L2：…', ...over,
} as unknown as OfflineReview)

test('plain review: four plain sections, numbers from the review only, jargon only in evidence', () => {
  const r = plainReview(base())
  assert.deepEqual(r.sections.map(s => s.title), ['这次练得怎么样', '为什么', '下次怎么练', '还需要你补什么'])
  const all = r.sections.map(s => [s.emphasis ?? '', ...s.lines].join('\n')).join('\n')
  assert.match(r.sections[0].emphasis!, /4×400米 · 平均配速 3:23\/公里/)
  assert.match(all, /78 → 80 → 82 → 85 秒，越跑越慢，最后一组比第一组慢 7 秒/)
  assert.match(all, /组间休息 120 秒/)
  assert.match(all, /整课吃力程度 8\/10/)
  assert.match(all, /每组都按 81 秒左右跑/) // (78+80+82+85)/4 = 81.25 → 81
  assert.match(all, /可能是起始速度与本课目标不匹配，后段难以维持。/)
  assert.match(all, /另一种可能：实际恢复安排、当天身体反应或记录误差也可能改变用时。/)
  // 已有 RPE → 不再要求补 RPE；没对上号的不出现
  const need = r.sections[3].lines
  assert.ok(need.some(l => /想练什么/.test(l)) && need.some(l => /疼/.test(l)) && !need.some(l => /吃力/.test(l)))
  for (const jargon of ['本次事实', '训练目的：', '可能解释', '不确定性', '依据', 'UNKNOWN', '生理短板', '数据充分性', '为了补数据']) assert.ok(!all.includes(jargon), jargon)
  assert.match(r.evidence, /本次事实/); assert.match(r.evidence, /数据充分性/)
  // 同一个数不重复出现在多段
  assert.equal((all.match(/3:23/g) ?? []).length, 1)
})

test('plan comparison only when a plan exists; safety review shows only the safety card', () => {
  const withPlan = plainReview(base(), { count: 4, distanceM: 400, targetSec: 80, restSec: 120 })
  assert.match(withPlan.sections[0].lines.join(''), /计划 4×400米、每组 80 秒；组数全部完成，平均每组比目标慢 1.3 秒/)
  assert.ok(!withPlan.sections[3].lines.some(l => /目标用时/.test(l)))
  assert.ok(!plainReview(base()).sections[0].lines.join('').includes('计划'))
  const s = plainReview(base({ safetyRestricted: true, text: '胸痛请立即停止并就医。' }))
  assert.deepEqual(s.sections.map(x => x.title), ['先注意安全'])
})

test('no data: says so plainly and asks for concrete records', () => {
  const r = plainReview(base({ hypotheses: [], missing: ['实际跑步分段未记录', '整课主观强度未知'], metrics: { ...base().metrics, points: [], groups: [], rests: [], ratings: [] } }))
  assert.match(r.sections[0].lines[0], /还没有可以分析/)
  assert.match(r.sections[1].lines[0], /还不够判断原因/)
  assert.match(r.sections[2].lines[0], /记下来/)
  assert.ok(r.sections[3].lines.some(l => /跑了多远/.test(l)) && r.sections[3].lines.some(l => /吃力/.test(l)))
})

test('pain recorded → next step is stop/assess, not a pace prescription', () => {
  const m = base().metrics
  const r = plainReview(base({ metrics: { ...m, ratings: [...m.ratings, { metric: 'PAIN_SCORE', value: 3, unit: 'score', sourceId: 'p', eventAt: '', confirmation: 'CONFIRMED' }] } as OfflineReview['metrics'] }))
  assert.match(r.sections[2].lines.join(''), /疼痛 3\/10：先停掉/)
  assert.ok(!/每组都按/.test(r.sections[2].lines.join('')))
})

test('whole-session totals only (no splits): use the picked session record, no invented splits', () => {
  const m = base().metrics
  const r = plainReview(base({ hypotheses: [], missing: ['实际跑步分段未记录'], metrics: { ...m, points: [], groups: [], rests: [], ratings: [] } }), null, { id: 'o', startedAt: '', kind: 'RUN', distanceM: 5000, durationSec: 1500 })
  assert.equal(r.sections[0].emphasis, '5公里 · 用时 25:00 · 平均配速 5:00/公里')
  assert.match(r.sections[0].lines.join(''), /没有分段/)
  assert.match(r.sections[2].lines[0], /同样的 5公里 下次保持 5:00\/公里/)
  assert.deepEqual(r.sections[3].lines, ['每公里的分段用时（手表里有就一起导入）'])
})
