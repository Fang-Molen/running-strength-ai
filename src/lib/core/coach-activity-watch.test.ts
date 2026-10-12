import test from 'node:test'
import assert from 'node:assert/strict'
import { appendCoachNotice, noticeForCoachEvent } from './coach-activity-watch.ts'
const event = (event_type: string, payload: Record<string, unknown> = {}) => ({ event_id: 'e1', event_type, payload }) as Parameters<typeof noticeForCoachEvent>[0]
test('completion creates grounded notice', () => assert.match(noticeForCoachEvent(event('TRAINING_COMPLETED'))!.message, /训练完成/))
test('start creates grounded notice', () => assert.match(noticeForCoachEvent(event('TRAINING_STARTED'))!.message, /训练已开始/))
test('high RPE does not diagnose fatigue', () => { const n = noticeForCoachEvent(event('RPE_RECORDED', { evidenceType: 'SESSION_RPE', value: 9 }))!; assert.match(n.message, /不是疲劳诊断/) })
test('recovery RPE does not masquerade as session RPE', () => assert.equal(noticeForCoachEvent(event('RPE_RECORDED', { evidenceType: 'SUBJECTIVE_RECOVERY', value: 9 })), null))
test('unrecognized events do not trigger', () => assert.equal(noticeForCoachEvent(event('UNKNOWN')), null))
test('duplicate event is not shown twice', () => { const n = noticeForCoachEvent(event('TRAINING_STARTED'))!; assert.equal(appendCoachNotice(appendCoachNotice([], n), n).length, 1) })
test('inbox bounded to 5', () => { let inbox: ReturnType<typeof appendCoachNotice> = []; for(let i=0;i<8;i++) inbox=appendCoachNotice(inbox,{id:`i${i}`,sourceEventId:`e${i}`,message:'test'}); assert.equal(inbox.length,5) })
