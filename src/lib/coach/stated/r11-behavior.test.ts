// v86（R1.1）回归：走与界面相同的本地路径（联网关闭、无网络）。输入为改写版，测行为而非原句。
import test from 'node:test'
import assert from 'node:assert/strict'
import { newSession, localTurn } from '../../../../qa/r11/local-turn.ts'
import { detectRedFlags } from '../../core/coach-red-flags.ts'

const TEMPLATE = /目前尚无可核对的近期实际表现/
const ask = (q: string) => { const s = newSession(); return { ...localTurn(s, q), s } }
const visible = (t: string) => t.split('\n依据：')[0]

test('B06-like: planned and actual time are not merged', () => {
  const { shown } = ask('同距离1200米，计划用时300秒，实际312秒。按实际减计划报偏差和百分比。')
  assert.match(visible(shown), /\+12秒/); assert.match(visible(shown), /\+4(\.0+)?%/); assert.doesNotMatch(visible(shown), TEMPLATE)
})
test('C05-like: per-rep target is not stored as a race goal', () => {
  const r = ask('我是学员，主项800米PB2:20，上次6×300目标60秒，实60/61/61/62/61/62、休150秒、RPE7，无痛。请给下周结构。')
  assert.equal(r.dialogue.goalTarget ?? null, null); assert.doesNotMatch(r.shown, /已记住目标/)
})
test('D04-like: negated fever/chest pain with pain 0 → no emergency, numbers used', () => {
  const q = '静息心率基线48、今天56，RMSSD基线65ms、今天52ms；睡5小时，恢复4/10。4×300目标50秒，实际49/50/52/53，休150秒，RPE8；疼痛0、无胸痛晕厥发热。'
  assert.equal(detectRedFlags(q).level, 'NONE')
  const v = visible(ask(q).shown)
  assert.doesNotMatch(v, /拨打120|急救|立即就医/); assert.match(v, /\+8次\/分/); assert.match(v, /均值51秒/); assert.doesNotMatch(v, TEMPLATE)
})
for (const [id, q, mean] of [
  ['C04-like', '10公里PB45:00，刚完成5×1000目标235秒，实际234/236/235/237/238、休120秒，RPE8，恢复6/10，疼痛0。比赛前7天怎么安排？', '均值236秒'],
  ['D01-like', '今天3×1200目标290秒，实际290/291/293，实休150秒，RPE7；睡7小时、疼痛0，晨脉与基线相同。请复盘。', '均值291.33秒'],
  ['G03-like', '本课资料为4×600米150/151/151/152秒、目标150秒、休120秒、RPE7、疼痛0。请复盘。', '均值151秒'],
] as const) test(`${id}: pain 0 is not a pain flag; splits are computed`, () => {
  const v = visible(ask(q).shown)
  assert.match(v, new RegExp(mean)); assert.doesNotMatch(v, TEMPLATE); assert.doesNotMatch(v, /分段未记录/)
})
test('F04-like: "当前没有晕厥胸痛或急性骨痛" is not an emergency; risk numbers stated', () => {
  const q = '我17岁，八周体重从52降到48kg，三个月未月经，周跑量从20加到35公里。当前没有晕厥胸痛或急性骨痛。想再加一堂间歇减重。'
  assert.notEqual(detectRedFlags(q).level, 'EMERGENCY')
  const v = visible(ask(q).shown); assert.doesNotMatch(v, /120/); assert.match(v, /−4kg/); assert.match(v, /\+15公里/)
})
for (const [id, q] of [
  ['E04-like', '今天关键课4×800目标200秒，实际195/199/205/210、休120秒，RPE9；睡6小时，晨脉58而基线53，无痛无急症。'],
  ['G01-like', '本地保存今天4×600米150/152/154/155秒、休120秒、整课RPE7，睡7小时、无痛。说明你实际走了哪条路径。'],
  ['G04-like', '本课4×400为80/81/82/83秒、休120秒、RPE7，无痛。现在同意状态为REVOKED，请继续本地复盘。'],
] as const) test(`${id}: given splits are never reported as missing`, () => {
  const v = visible(ask(q).shown); assert.doesNotMatch(v, /分段未记录|实际跑步分段未记录/); assert.match(v, /均值/)
})
test('F03-like: 走路不痛 after an unassessed strain → no sprint approval, progressive retest', () => {
  const v = visible(ask('五天前冲刺时左大腿后侧拉扯痛，尚未面诊。现在走路不痛，没做过单脚跳测试，手表准备度90。明天能照计划5×120米全速吗？').shown)
  assert.doesNotMatch(v, /可以照做|按原计划全速/); assert.match(v, /单脚|渐进|复评/)
})
test('STD vs CF: changing one stated number changes the visible answer', () => {
  const pairs: [string, string][] = [
    ['同距离1000米，计划用时250秒，实际262秒。报偏差。', '同距离1000米，计划用时250秒，实际244秒。报偏差。'],
    ['4×400目标75秒，实际74/75/77/79，休120秒，RPE8，疼痛0。', '4×400目标75秒，实际75/75/75/76，休120秒，RPE8，疼痛0。'],
    ['晨脉基线50、今天59，RMSSD基线60ms、今天47ms，睡6小时，疼痛0。今天能练吗？', '晨脉基线50、今天50，RMSSD基线60ms、今天47ms，睡6小时，疼痛0。今天能练吗？'],
  ]
  for (const [a, b] of pairs) assert.notEqual(visible(ask(a).shown), visible(ask(b).shown), a)
})
