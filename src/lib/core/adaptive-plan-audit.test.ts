import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { PLAN_AUDIT_KEY, readPlanAudit, recordPlanAudit } from './adaptive-plan-audit.ts'
const storage = () => { const m = new Map<string,string>(); return { m, keys:()=>[...m.keys()], getItem:(k:string)=>m.get(k)??null, setItem:(k:string,v:string)=>{m.set(k,v)} } }
const req = (daysAhead=0, severity=0) => ({daysAhead, expectedRevision:0, actualRevision:0, reason:'训练前反馈', evidenceIds:['e1'], discomfort:{region:'腘绳肌',severity,functionalLimitation:false},nextSessionIntensity:'EASY' as const,proposedAction:'POSTPONE' as const})
test('daily confirmation is a recorded non-applied event',()=>{const s=storage();const e=recordPlanAudit(s,{candidateId:'c1',request:req(),choice:'CONFIRM',id:'id1',now:'2026-10-10T00:00:00Z'});assert.equal(e.kind,'USER_CONFIRMED');assert.equal(e.applied,false);assert.equal(readPlanAudit(s).length,1);assert.equal(s.m.size,1);assert.ok(s.m.has(PLAN_AUDIT_KEY))})
test('daily acknowledgement cannot replace confirmation',()=>assert.throws(()=>recordPlanAudit(storage(),{candidateId:'c1',request:req(),choice:'ACKNOWLEDGE'})))
test('safety cannot be confirmed',()=>assert.throws(()=>recordPlanAudit(storage(),{candidateId:'c1',request:req(0,5),choice:'CONFIRM'})))
test('weekly notice can be acknowledged without applying plan',()=>{const e=recordPlanAudit(storage(),{candidateId:'c1',request:req(3),choice:'ACKNOWLEDGE'});assert.equal(e.kind,'USER_NOTIFIED');assert.equal(e.applied,false)})
test('future cycle review is not a plan mutation',()=>{const e=recordPlanAudit(storage(),{candidateId:'c1',request:req(8),choice:'ACKNOWLEDGE'});assert.equal(e.kind,'REPLAN_REQUESTED')})
test('stale revision is rejected before storage write',()=>{const s=storage();assert.throws(()=>recordPlanAudit(s,{candidateId:'c1',request:{...req(),actualRevision:1},choice:'CONFIRM'}));assert.equal(s.m.size,0)})
test('duplicate event ids rejected',()=>{const s=storage();recordPlanAudit(s,{candidateId:'c1',request:req(),choice:'CONFIRM',id:'dup'});assert.throws(()=>recordPlanAudit(s,{candidateId:'c1',request:req(),choice:'CONFIRM',id:'dup'}))})
test('corrupt local audit safely reads empty',()=>{const s=storage();s.setItem(PLAN_AUDIT_KEY,'bad');assert.deepEqual(readPlanAudit(s),[])})
test('declining safety change is recorded but not applied',()=>{const e=recordPlanAudit(storage(),{candidateId:'c1',request:req(0,6),choice:'DECLINE'});assert.equal(e.kind,'USER_DECLINED');assert.equal(e.applied,false)})
