import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { poseFrames, POSE_CARD_IDS, posePattern, POSE_PATTERNS } from './pose-cards-r8.ts'

test('每个力量类动作男女三帧文件都存在，且有动作模式分组', () => {
  const ids = POSE_CARD_IDS.filter(id => !id.startsWith('fk-run'))
  assert.equal(ids.length, 100)
  for (const id of ids) {
    assert.ok(POSE_PATTERNS.includes(posePattern(id)), id)
    for (const g of ['male', 'female'] as const) for (const f of poseFrames(id, g)) {
      assert.ok(f.url, `${id} ${g} ${f.key}`)
      assert.ok(existsSync(`public${f.url}`), f.url!)
    }
  }
})
test('未知动作不给图，三帧全为空', () => {
  assert.deepEqual(poseFrames('nope', 'male').map(f => f.url), [null, null, null])
})
