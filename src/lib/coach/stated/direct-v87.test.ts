// v87：单纯换算直接回答；“只剩N分钟怎么安排”无经批准候选时不出剂量。
import test from 'node:test'
import assert from 'node:assert/strict'
import { statedDirectAnswer, statedFactsSection, secondsAsMinutes } from './compose.ts'
test('seconds to minutes is exact and bounded', () => {
  assert.equal(secondsAsMinutes(1536), '1536秒 = 25分36秒（25.6分钟）')
  assert.equal(secondsAsMinutes(1500), '1500秒 = 25分0秒（25分钟）')
  assert.deepEqual(statedDirectAnswer('1536秒是多少分钟？'), { kind: 'DIRECT_CALCULATION', text: '1536秒 = 25分36秒（25.6分钟）。' })
  assert.match(statedFactsSection('实际时长1530秒，输入单位明确是秒。请换算成分钟，不增加其他判断').text!, /1530秒 = 25分30秒（25\.5分钟）/)
})
test('long or mixed questions are not reduced to a single conversion', () => {
  assert.equal(statedDirectAnswer('今天400米分段68、70、72秒，整课1536秒是多少分钟，状态怎么样，明天要不要加量？'), null)
  assert.equal(statedDirectAnswer('今天状态一般'), null)
})
test('remaining work with no approved candidate never invents a dose', () => {
  const a = statedDirectAnswer('跑步做完了，力量没做，只剩20分钟，怎么安排？')!
  assert.equal(a.kind, 'REMAINING_WORK_NO_CANDIDATE'); assert.match(a.text, /核准|批准/)
  assert.doesNotMatch(a.text, /\d+\s*(?:组|次|kg|公斤|%)/)
  assert.equal(statedDirectAnswer('运行剩余额度0.05，怎么安排'), null)
})
