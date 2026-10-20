import test from 'node:test'
import assert from 'node:assert/strict'
import { pendingFeedback } from './pending-feedback'
import type { V4Day } from './plan400-view'
const d: V4Day = { orig:'2026-10-19',date:'2026-10-19',weekday:'周一',week:'W1',title:'速度耐力＋力量A',main:['主课'],aux:[],strength:['分腿蹲 2×5'] }
const moved = new Set(['2026-10-19'])
test('原日改期、没有实际：不再催确认旧日手表候选',()=>{
 assert.equal(pendingFeedback([d],{'2026-10-19':{runCandidates:1}}, {}, '2026-10-20',[],14,moved).length,0)
})
test('原日改期、没有实际：不再催旧日评分',()=>{
 assert.equal(pendingFeedback([d],{'2026-10-19':{parts:{running:{rpe:undefined}},runCandidates:2}}, {}, '2026-10-20',[],14,moved).length,0)
})
test('即使错误改期，原日已有真实跑步仍保留其待评价任务',()=>{
 const x=pendingFeedback([d],{'2026-10-19':{runLinked:true}}, {}, '2026-10-20',[],14,moved)
 assert.equal(x.length,1);assert.equal(x[0].kind,'rate_run')
})
