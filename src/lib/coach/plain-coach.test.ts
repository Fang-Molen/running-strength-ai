import test from 'node:test'
import assert from 'node:assert/strict'
import { isReviewAsk, pickDefaultActivity, reviewActivity, intervalRestAnswer, activityFacts, type GActivity } from './plain-coach.ts'
const run: GActivity = { id: 1, name: '杭州市 跑步', type: 'running', start: '2026-10-18T05:54:00Z', dist: 6010, dur: 1898, avgHr: 144, maxHr: 162, cad: 172, elev: 12, cal: 400, sets: null, reps: null, tl: 85, te: 2.9, ate: 0.4 }
const older = { ...run, id: 2, start: '2026-10-17T04:53:00Z', dist: 6370 }
test('review asks are recognized', () => {
  for (const q of ['帮我复盘这节训练', '复盘我昨天的跑步', '我昨天跑得怎么样', '这次训练怎么样']) assert.equal(isReviewAsk(q), true, q)
  assert.equal(isReviewAsk('400米×8 休1分钟和8分钟有什么区别'), false)
})
test('default link: most recent, or the asked day', () => {
  assert.equal(pickDefaultActivity('帮我复盘这节训练', [older, run], '2026-10-19')!.id, 1)
  assert.equal(pickDefaultActivity('复盘我昨天的跑步', [older, run], '2026-10-19')!.id, 1)
  assert.equal(pickDefaultActivity('复盘前天', [older, run], '2026-10-19')!.id, 2)
  assert.equal(pickDefaultActivity('今天跑得怎么样', [older, run], '2026-10-19'), null)
})
test('review is conclusion-first, plain, with reason and next-session prescription, no stock hedging', () => {
  const t = reviewActivity(run, null, '2026-10-19')
  assert.match(t, /^结论：2026-10-18 6\.01km 31:38/); assert.match(t, /5'16"\/km/); assert.match(t, /心率 144/)
  assert.match(t, /为什么：/); assert.match(t, /下一课怎么练：按计划 2026-10-19 速度耐力＋力量A：正式主课：150m×3/)
  assert.match(t, /400米 53秒多/)
  assert.doesNotMatch(t, /尚无可核对|尚未关联|可撤回|已批准原课程|还需证据|无法判断|UNKNOWN/)
  assert.match(t, /加载分段/)
})
test('review with laps reads pace drift and HR drift', () => {
  const laps = [1, 2, 3, 4, 5, 6].map(i => ({ i, dist: 1000, dur: 300 + (i > 3 ? 20 : 0), avgHr: 140 + (i > 3 ? 12 : 0), maxHr: 160, cad: 170, elev: 0, speed: null }))
  const t = reviewActivity(run, laps, '2026-10-19')
  assert.match(t, /后半程掉速 20 秒\/公里、心率还上升 12/); assert.match(t, /心率漂移/)
  assert.match(activityFacts(run, laps).join('\n'), /第4段 1\.00km 5'20"\/km 心率152/)
})
test('400m×8 1min vs 8min: clear physiological contrast and how to use, plus a concrete test', () => {
  const t = intervalRestAnswer('400米×8，组间休息1分钟和8分钟有什么区别？')!
  assert.match(t, /^结论：/); assert.match(t, /乳酸耐受/); assert.match(t, /速度耐力/); assert.match(t, /不完全恢复/); assert.match(t, /速度质量/); assert.match(t, /比赛配速/); assert.match(t, /接近完全恢复/)
  assert.match(t, /怎么用：/); assert.match(t, /300 米全力计时/)
  assert.doesNotMatch(t, /UNKNOWN|还需证据|判断边界|不能仅凭/)
  assert.equal(intervalRestAnswer('今天吃什么'), null)
  assert.ok(intervalRestAnswer('400米×8，休1分钟和休8分钟有什么区别'))
  assert.ok(intervalRestAnswer('400m x8 歇1分钟 vs 歇8分钟'))
})
test('even pace with +8 bpm is described as mild drift, not "no drift"', () => {
  const laps = [[1000,312,138],[1000,313,141],[1000,315,143],[1000,317,146],[1000,318,149],[1010,323,151]].map(([d,t,h],i)=>({ i: i+1, dist: d, dur: t, avgHr: h, maxHr: h+6, cad: 172, elev: 0, speed: null }))
  const t = reviewActivity(run, laps, '2026-10-19')
  assert.match(t, /^结论：/); assert.match(t, /轻度心率漂移/); assert.doesNotMatch(t, /心率没明显飘/)
})
test('free questions are not review asks (no auto-binding)', () => { for (const q of ['明天怎么安排','运动后为什么酸痛','我800米PB两分钟，怎么提高','下周训练计划怎么安排']) assert.equal(isReviewAsk(q), false, q) })
test('reported-result review is not hijacked by the interval concept answer', () => {
  assert.equal(intervalRestAnswer('今天实际完成200m×4，39/38/37/36秒，组间3分钟，练了50分钟，整课RPE7，练得怎么样？'), null)
  assert.ok(intervalRestAnswer('400米×8，组间休息1分钟和8分钟有什么区别？'))
})
