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
test('review uses actual numbers and bounded explanations without inventing an athlete goal or dose', () => {
  const t = reviewActivity(run, null, '2026-10-19')
  assert.match(t, /^结论：2026-10-18 6\.01 km 31:38/); assert.match(t, /5'16"\/km/); assert.match(t, /心率 144/)
  assert.match(t, /为什么：/); assert.match(t, /训练目的：UNKNOWN/)
  assert.match(t, /可能解释一/); assert.match(t, /可能解释二/); assert.match(t, /下一次观察：/)
  assert.doesNotMatch(t, /400米 53秒多|12月28|减 1 组|24–48|乳酸阈附近|第二天能正常训练/)
  assert.match(t, /加载分段/)
})
test('review with laps reads pace drift and HR drift', () => {
  const laps = [1, 2, 3, 4, 5, 6].map(i => ({ i, dist: 1000, dur: 300 + (i > 3 ? 20 : 0), avgHr: 140 + (i > 3 ? 12 : 0), maxHr: 160, cad: 170, elev: 0, speed: null }))
  const t = reviewActivity(run, laps, '2026-10-19')
  assert.match(t, /后半程掉速 20 秒\/公里、心率还上升 12/); assert.match(t, /近期疲劳/)
  assert.match(activityFacts(run, laps).join('\n'), /第4段 1\.00 km 5'20"\/km 心率152/)
})
test('interval rest explanation distinguishes plausible effects without unsupported thresholds or all-out tests', () => {
  const t = intervalRestAnswer('400米×8，组间休息1分钟和8分钟有什么区别？')!
  assert.match(t, /^结论：/); assert.match(t, /较短休息/); assert.match(t, /较长休息/); assert.match(t, /速度质量/)
  assert.match(t, /不能只凭休息时长确定训练目的/); assert.match(t, /下一次观察：/)
  assert.match(t, /已批准课程/); assert.match(t, /实际成绩、组间休息、RPE/)
  assert.doesNotMatch(t, /300 米全力计时|62–68|53–56|每周 1 次|超过 1.5 秒就停|53 秒|85–90%/)
  assert.equal(intervalRestAnswer('今天吃什么'), null)
  assert.ok(intervalRestAnswer('400米×8，休1分钟和休8分钟有什么区别'))
  assert.ok(intervalRestAnswer('400m x8 歇1分钟 vs 歇8分钟'))
})
test('pace and heart rate changes are reported without unapproved mild/normal thresholds', () => {
  const laps = [[1000,312,138],[1000,313,141],[1000,315,143],[1000,317,146],[1000,318,149],[1010,323,151]].map(([d,t,h],i)=>({ i: i+1, dist: d, dur: t, avgHr: h, maxHr: h+6, cad: 172, elev: 0, speed: null }))
  const t = reviewActivity(run, laps, '2026-10-19')
  assert.match(t, /^结论：/); assert.match(t, /心率变化 \+8 次\/分/); assert.doesNotMatch(t, /轻度心率漂移|心率没明显飘|乳酸没有明显堆积|合格的有氧/)
})
test('free questions are not review asks (no auto-binding)', () => { for (const q of ['明天怎么安排','运动后为什么酸痛','我800米PB两分钟，怎么提高','下周训练计划怎么安排']) assert.equal(isReviewAsk(q), false, q) })
test('reported-result review is not hijacked by the interval concept answer', () => {
  assert.equal(intervalRestAnswer('今天实际完成200m×4，39/38/37/36秒，组间3分钟，练了50分钟，整课RPE7，练得怎么样？'), null)
  assert.ok(intervalRestAnswer('400米×8，组间休息1分钟和8分钟有什么区别？'))
})

test('future activity is excluded from historical review', () => {
  assert.match(reviewActivity({...run,start:'2026-10-20T00:00:00Z'},null,'2026-10-19'),/发生在复盘日期之后/)
})
test('negative measured heart-rate change is not rewritten as a normal recovery claim', () => {
  const laps = [140,140,140,130,130,130].map((avgHr,i)=>({i:i+1,dist:1000,dur:300,avgHr,maxHr:null,cad:null,elev:null,speed:null}))
  const t=reviewActivity(run,laps,'2026-10-19')
  assert.match(t,/心率变化 -10 次\/分/);assert.doesNotMatch(t,/恢复成本低|乳酸没有明显堆积|没有看到明显的疲劳信号/)
})
