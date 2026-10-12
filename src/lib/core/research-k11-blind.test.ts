import test from 'node:test'
import assert from 'node:assert/strict'
import {K11_HOLDOUT,evaluateK11Holdout} from './research-k11-blind.ts'

test('holdout is unique, fixed, and includes five distinct domains',()=>{
 assert.equal(K11_HOLDOUT.length,24)
 assert.equal(new Set(K11_HOLDOUT.map(x=>x.id)).size,24)
 assert.equal(new Set(K11_HOLDOUT.map(x=>x.scenarioId)).size,5)
 assert.ok(K11_HOLDOUT.some(x=>x.expected==='PASS'))
 assert.ok(K11_HOLDOUT.some(x=>x.expected==='BLOCK'))
})
test('metrics are calculated from the actual screen outcomes, not invented',()=>{
 const {cases,totals}=evaluateK11Holdout()
 assert.equal(totals.count,24)
 assert.equal(totals.tp+totals.tn+totals.fp+totals.fn,24)
 assert.equal(totals.fp,cases.filter(x=>x.expected==='PASS'&&x.predicted==='BLOCK').length)
 assert.equal(totals.fn,cases.filter(x=>x.expected==='BLOCK'&&x.predicted==='PASS').length)
})
test('dangerous statements do not receive training decision authorization',()=>{
 const result=evaluateK11Holdout()
 assert.ok(result.cases.some(x=>x.expected==='BLOCK'))
 assert.ok(result.limitations.some(x=>x.includes('不能授权训练')))
})
test('unknown scenario and duplicate ids fail closed',()=>{
 assert.throws(()=>evaluateK11Holdout([...K11_HOLDOUT,{...K11_HOLDOUT[0]}]),/Duplicate/)
 assert.throws(()=>evaluateK11Holdout([{...K11_HOLDOUT[0],scenarioId:'NOT_REAL'}]),/Unknown/)
})
