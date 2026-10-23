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
test('review preserves numbers, purpose uncertainty and observation-only next step', () => {
  const t = reviewActivity(run, null, '2026-10-19')
  assert.match(t, /^结论：2026-10-18 6\.01 km 31:38/); assert.match(t, /5'16"\/km/); assert.match(t, /心率 144/)
  assert.match(t, /为什么：/)
  // v86（R1.1）：没有用户在用的计划/目标时，不再套内置 V4 课表和“400米53秒”目标。
  assert.doesNotMatch(t, /53秒|12\/28|按你在用的计划/); assert.match(t, /还没有在资料里设定目标成绩/); assert.match(t, /下一课怎么练：按你自己的计划安排/)
  assert.match(t, /训练目的：UNKNOWN/); assert.match(t, /解释一/); assert.match(t, /解释二/); assert.match(t, /任何变更须确认/); assert.doesNotMatch(t, /乳酸清除|线粒体|减1组|24–48小时恢复/)
  assert.match(t, /加载分段/)
})
test('v86: review uses the V4 plan and the profile goal only when they are the user\'s own', async () => {
  const { setStoreBackend } = await import('../core/storage.ts')
  const m = new Map<string, string>([['fk-plan400-v4-log', JSON.stringify({ '2026-10-18': { done: 'done' } })], ['fr255-profile-v1', JSON.stringify({ marks: [{ meters: 400, goal: '58', recent: '', deadline: '' }] })]])
  // Synthetic owned plan: the slim source intentionally excludes private athlete fixtures.
  m.set('fk-plan-doc-v1', JSON.stringify({schema:'fangkun-plan-v1',tag:'V4',plan:{name:'synthetic',weeks:[],shiftDays:0,days:[{date:'2026-10-18',title:'基础训练',main:['连续跑'],aux:[],strength:[]},{date:'2026-10-19',title:'速度耐力＋力量A',main:['正式主课：150m×3'],aux:[],strength:[]}]}}))
  setStoreBackend({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } })
  try {
    const t = reviewActivity(run, null, '2026-10-19')
    assert.match(t, /下一课怎么练：按你在用的计划：2026-10-19 速度耐力＋力量A：正式主课：150m×3/); assert.match(t, /对照目标（400米 58/); assert.doesNotMatch(t, /53秒/)
  } finally { setStoreBackend(null) }
})
test('review with laps reads pace drift and HR drift', () => {
  const laps = [1, 2, 3, 4, 5, 6].map(i => ({ i, dist: 1000, dur: 300 + (i > 3 ? 20 : 0), avgHr: 140 + (i > 3 ? 12 : 0), maxHr: 160, cad: 170, elev: 0, speed: null }))
  const t = reviewActivity(run, laps, '2026-10-19')
  assert.match(t, /后半程比前半程慢 20 秒\/公里；心率变化 12 bpm/); assert.match(t, /不把它当作疲劳诊断/)
  assert.match(activityFacts(run, laps).join('\n'), /第4段 1\.00 km 5'20"\/km 心率152/)
})
test('interval comparison explains conditions without inventing an all-out test', () => {
  const t = intervalRestAnswer('400米×8，组间休息1分钟和8分钟有什么区别？')!
  assert.match(t, /^结论：/); assert.match(t, /实际速度、组数、完成质量和教练意图/); assert.match(t, /速度质量/); assert.match(t, /不保证组织完全恢复/)
  assert.match(t, /怎么用：/); assert.match(t, /原批准课程/); assert.match(t, /只比较一个变量/); assert.doesNotMatch(t, /300 米全力计时|相差超过2秒|休息10分钟/)
  assert.match(t, /出现疼痛不做试探测试/)
  assert.equal(intervalRestAnswer('今天吃什么'), null)
  assert.ok(intervalRestAnswer('400米×8，休1分钟和休8分钟有什么区别'))
  assert.ok(intervalRestAnswer('400m x8 歇1分钟 vs 歇8分钟'))
})
test('pace and HR changes are numerical observations without an uncalibrated fatigue threshold', () => {
  const laps = [[1000,312,138],[1000,313,141],[1000,315,143],[1000,317,146],[1000,318,149],[1010,323,151]].map(([d,t,h],i)=>({ i: i+1, dist: d, dur: t, avgHr: h, maxHr: h+6, cad: 172, elev: 0, speed: null }))
  const t = reviewActivity(run, laps, '2026-10-19')
  assert.match(t, /^结论：/); assert.match(t, /心率变化 8 bpm/); assert.doesNotMatch(t, /轻度心率漂移|心率没明显飘|已经恢复/)
})
test('free questions are not review asks (no auto-binding)', () => { for (const q of ['明天怎么安排','运动后为什么酸痛','我800米PB两分钟，怎么提高','下周训练计划怎么安排']) assert.equal(isReviewAsk(q), false, q) })
test('reported-result review is not hijacked by the interval concept answer', () => {
  assert.equal(intervalRestAnswer('今天实际完成200m×4，39/38/37/36秒，组间3分钟，练了50分钟，整课RPE7，练得怎么样？'), null)
  assert.ok(intervalRestAnswer('400米×8，组间休息1分钟和8分钟有什么区别？'))
})
