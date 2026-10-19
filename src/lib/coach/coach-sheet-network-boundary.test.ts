import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../../components/coach-sheet.tsx', import.meta.url), 'utf8')
test('production chat preserves the existing local safety/fact result instead of replacing it with plain templates or an automatic paid call', () => {
  assert.match(source, /const local = answerLocally\(/)
  assert.match(source, /let shown = local\.dialogue \? local\.text : presentCoachAnswer\(local\.text/)
  assert.doesNotMatch(source, /await askOnlineCoach\(|shown = reviewActivity\(|shown = iv|onlineSetting\(\)\.on && navigator\.onLine/)
  assert.match(source, /没有上传训练和健康数据|没有上传训练或健康数据/)
  assert.match(source, /serverAuthorized: false/)
})
test('chat rendering rejects stale athlete memory and automatic review does not fetch wearable laps', () => {
  assert.match(source, /storedMemory\?\.athleteId === athleteScope \? storedMemory : null/)
  assert.match(source, /\}, \[athleteScope\]\)/)
  assert.doesNotMatch(source, /await fetchLaps\(/)
  assert.match(source, /本开关不会上传训练、身体指标或历史聊天/)
})
