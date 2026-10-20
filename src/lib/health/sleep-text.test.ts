// v88.1：睡眠时长唯一格式（用户截图“5.783333333333333 小时”）
import assert from 'node:assert/strict'
import test from 'node:test'
import { sleepHoursText } from './observation.ts'
test('同步来的长小数 → 小时+分；整数/一位小数原样', () => {
  assert.equal(sleepHoursText(5.783333333333333), '5小时47分')
  assert.equal(sleepHoursText(7.5), '7.5 小时'); assert.equal(sleepHoursText(6), '6 小时')
})
