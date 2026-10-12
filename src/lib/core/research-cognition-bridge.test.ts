import test from 'node:test'
import assert from 'node:assert/strict'
import {retrieveCognitionKnowledge} from './coach-cognition-knowledge.ts'

test('sleep wearable archive is available through cognition but not certified',()=>{
 const cards=retrieveCognitionKnowledge(['800米'],'手表睡眠分期').filter(x=>x.id.startsWith('archive:'))
 assert.deepEqual(cards.map(x=>x.id),['archive:R7-003'])
 assert.ok(cards.every(x=>x.verification==='CANDIDATE'&&x.checkedAt===null&&!x.prescriptionApproved))
})
test('400m hurdles archive is not silently inserted for flat 400m',()=>{
 const flat=retrieveCognitionKnowledge(['400米'],'后半程')
 const hurdles=retrieveCognitionKnowledge(['400米栏'],'后半程')
 assert.ok(!flat.some(x=>x.id==='archive:R5-001'))
 assert.ok(hurdles.some(x=>x.id==='archive:R5-001'))
})
test('archive cards retain research limitations and cap at two',()=>{
 const cards=retrieveCognitionKnowledge(['110米栏','400米栏'],'跨栏').filter(x=>x.id.startsWith('archive:'))
 assert.ok(cards.length<=2)
 assert.ok(cards.every(x=>x.limitations.includes('本次接入未独立重核原文')&&!x.prescriptionApproved))
})
