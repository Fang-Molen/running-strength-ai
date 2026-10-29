import test from 'node:test'
import assert from 'node:assert/strict'
import {contextPeriod} from './context-period'
test('明确范围含中间记录，离散日期不扩大为范围',()=>{
 const range=contextPeriod('复盘2025-01-01到2025-12-31的训练','2026-10-29','UTC')
 assert.equal(range.matches('2025-06-01T10:00:00Z'),true)
 assert.equal(range.matches('2024-12-31T23:59:59Z'),false)
 assert.equal(range.matches('2025-12-31T23:59:59Z'),true)
 const discrete=contextPeriod('比较2025-01-01和2025-12-31的训练','2026-10-29','UTC');assert.equal(discrete.matches('2025-06-01T10:00:00Z'),false)
})
test('跨年、闰日和用户时区保留包含边界',()=>{
 const r=contextPeriod('复盘2023-12-31至2024-03-01','2026-10-29','Asia/Shanghai')
 assert.equal(r.matches('2024-02-29T15:59:59Z'),true);assert.equal(r.matches('2023-12-30T16:00:00Z'),true);assert.equal(r.matches('2024-03-01T16:00:00Z'),false)
})
test('无效或倒序范围不得猜测成离散日期或近期记录',()=>{
 for(const q of ['复盘2025-12-31到2025-01-01','复盘2025-02-29到2025-03-01']){
  const p=contextPeriod(q,'2026-10-29','UTC');assert.equal(p.matches('2025-03-01T10:00:00Z'),false);assert.ok((p as {error?:string}).error)
 }
})

test('审查回归：昨天、上周和本月使用明确日历范围，不退回28天',()=>{
 const yesterday=contextPeriod('我的昨天训练负荷汇总','2026-10-29','UTC');assert.deepEqual(yesterday.bounds,{startDay:'2026-10-28',endDay:'2026-10-28'});assert.equal(yesterday.matches('2026-10-22T08:00:00Z'),false)
 assert.deepEqual(contextPeriod('我的上周训练负荷','2026-10-29','UTC').bounds,{startDay:'2026-10-19',endDay:'2026-10-25'})
 assert.deepEqual(contextPeriod('我的本月负荷','2026-10-29','Asia/Shanghai').bounds,{startDay:'2026-10-01',endDay:'2026-10-29'})
})
