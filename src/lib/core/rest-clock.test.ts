import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeRest, restKey, restRemaining } from './rest-clock.ts'
const c = { version: 1 as const, decisionId: 'd', sessionId: 's', nextSetKey: 'm:2', remainingMs: 120000, deadlineMs: 200000, running: true }
test('lockscreen gap uses wall clock not interval ticks', () => assert.equal(restRemaining(c, 180000), 20000))
test('expired while locked yields zero', () => assert.equal(restRemaining(c, 300000), 0))
test('paused timer does not elapse', () => assert.equal(restRemaining({ ...c, deadlineMs: null, running: false }, 999999), 120000))
test('midnight crossing is based on absolute deadline', () => assert.equal(restRemaining({ ...c, deadlineMs: 86410000 }, 86400000), 10000))
test('decision and session isolation', () => { assert.notEqual(restKey('a','b'), restKey('a','c')); assert.equal(decodeRest(JSON.stringify(c), 'other','s'), null) })
test('corrupt and malformed snapshots are rejected', () => { assert.equal(decodeRest('{', 'd','s'), null); assert.equal(decodeRest(JSON.stringify({ ...c, remainingMs: -1 }), 'd','s'), null) })
test('valid snapshot restores next set identity', () => assert.deepEqual(decodeRest(JSON.stringify(c), 'd','s'), c))
