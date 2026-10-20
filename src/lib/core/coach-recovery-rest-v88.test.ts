import test from 'node:test'
import assert from 'node:assert/strict'
import { setStoreBackend } from './storage.ts'
import { setEventContext } from './events.ts'
import { saveSelfReportedRest } from '../health/rest-store.ts'
import { readRecoveryContext, recoveryContextLines } from './coach-recovery-context.ts'
const before='2026-10-20T08:00:00Z',after='2026-10-20T12:00:00Z'
function mem(){const m=new Map<string,string>();return {keys:()=>[...m.keys()],getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v)}}}
test.afterEach(()=>{setStoreBackend(null);setEventContext({athleteId:'local'})})
test('V88 local coach sees nap after knownAt, not before, never as precise sleep',()=>{
 setStoreBackend(mem());setEventContext({athleteId:'local'})
 const initial=readRecoveryContext('local','2026-10-20',before)!
 const s=saveSelfReportedRest({athleteId:'local',requestId:'nap-1',contextDay:'2026-10-20',kind:'NAP',duration:{low:20,high:35},start:null,end:null,timezone:'Asia/Shanghai'},Date.parse('2026-10-20T09:00:00Z'))
 assert.equal(s.ok,true)
 const old=readRecoveryContext('local','2026-10-20',before)!,next=readRecoveryContext('local','2026-10-20',after)!
 assert.deepEqual(old.subjective,initial.subjective)
 assert.ok(next.subjective.some(x=>x.includes('午睡')&&x.includes('20–35')))
 assert.ok(recoveryContextLines(next).some(x=>x.includes('未证明全天睡眠')))
 assert.notEqual(old.dependency?.signature,next.dependency?.signature)
 assert.equal(next.planWrite,false)
})
