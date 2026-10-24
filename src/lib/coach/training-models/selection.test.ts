import {test} from 'node:test'
import assert from 'node:assert/strict'
import {reviewDistribution} from './distribution'
import {selectTrainingModels} from './selection'
import {fixture,threshold,zone} from './test-fixtures'
test('complete time distribution distinguishes observed pattern and method choice',()=>{
 const i=fixture();i.thresholds=[threshold('LT1',3),threshold('LT2',4)]
 i.zoneSegments=[zone('z1',80,1),zone('z2',5,2,80),zone('z3',15,3,85)]
 const d=reviewDistribution(i);assert.equal(d.pattern,'POLARIZED_SHAPED');assert.deepEqual(d.sharesPercent,[80,5,15]);assert.equal(d.unknown,0)
 const methods=selectTrainingModels(i).methods;assert.equal(methods.find(m=>m.method==='PYRAMIDAL')?.status,'CONSIDER');assert.equal(methods.find(m=>m.method==='POLARIZED')?.status,'CONSIDER')
})
test('unknown minutes remain denominator, partial coverage cannot be called polarized',()=>{
 const i=fixture();i.zoneSegments=[zone('z1',80,1)];i.thresholds=[threshold('LT1',3),threshold('LT2',4)]
 const d=reviewDistribution(i);assert.equal(d.unknown,20);assert.equal(d.sharesPercent[0],80);assert.equal(d.pattern,'UNRESOLVED')
 i.window.complete=false;assert.equal(reviewDistribution(i).pattern,'UNRESOLVED')
})
test('overlaps, wrong threshold test and future segments never double count',()=>{
 const i=fixture();i.thresholds=[threshold('LT1',3),threshold('LT2',4)]
 i.zoneSegments=[zone('z1',80,1),zone('dup',80,1)]
 let d=reviewDistribution(i);assert.equal(d.classified,0);assert.ok(d.gaps.length)
 i.zoneSegments=[{...zone('z1',80,1),thresholdTestId:'old'}];assert.equal(reviewDistribution(i).classified,0)
})
test('elite experience alone does not pick polarized or enable double threshold',()=>{
 const i=fixture();i.profile.experience='ADVANCED'
 let r=selectTrainingModels(i);assert.equal(r.methods.find(m=>m.method==='DOUBLE_THRESHOLD')?.status,'INSUFFICIENT');assert.equal(r.preferredMethod,null)
 i.thresholds=[threshold('LT1',3),threshold('LT2',4)];r=selectTrainingModels(i);assert.notEqual(r.methods.find(m=>m.method==='DOUBLE_THRESHOLD')?.status,'CONSIDER')
})
test('pain holds all training methods despite positive performance and HRV',()=>{
 const i=fixture();i.thresholds=[threshold('LT1',3),threshold('LT2',4)];i.snapshot.safetyConstraints.push({id:'pain',version:'1',scope:'PAIN_REVIEW',evidenceRefs:[]})
 const r=selectTrainingModels(i);assert.ok(r.methods.every(m=>m.status==='HOLD'));assert.equal(r.allowTrainingCandidates,false)
})
test('short event and upcoming race cannot inherit a distant-runner training prescription',()=>{
 const i=fixture();i.profile.eventMeters=400;i.profile.raceDate='2026-10-26';i.profile.phase='SPECIFIC'
 const r=selectTrainingModels(i);assert.ok(r.notes.some(n=>n.includes('比赛')));assert.notEqual(r.methods.find(m=>m.method==='POLARIZED')?.status,'CONSIDER')
 i.profile.experience='NOVICE';assert.equal(selectTrainingModels(i).methods.find(m=>m.method==='DOUBLE_THRESHOLD')?.status,'NOT_APPLICABLE')
})
test('removing thresholds changes method decision while leaving race arithmetic available',()=>{
 const i=fixture();i.thresholds=[threshold('LT1',3),threshold('LT2',4)]
 assert.equal(selectTrainingModels(i).methods.find(m=>m.method==='PYRAMIDAL')?.status,'CONSIDER')
 i.thresholds=[];assert.equal(selectTrainingModels(i).methods.find(m=>m.method==='PYRAMIDAL')?.status,'INSUFFICIENT')
})


test('intensity bins cannot use later-measured thresholds or a different threshold revision',()=>{
 const i=fixture();i.thresholds=[threshold('LT1',3),threshold('LT2',4)]
 i.zoneSegments=[zone('z1',80,1),zone('z2',5,2,80),zone('z3',15,3,85)]
 i.thresholds=i.thresholds.map(t=>({...t,occurredAt:'2026-10-22T09:00:00.000Z',knownAt:'2026-10-22T10:00:00.000Z',receivedAt:'2026-10-22T10:00:00.000Z'}))
 assert.equal(reviewDistribution(i).classified,0)
 i.thresholds=[{...threshold('LT1',3),revision:1},threshold('LT2',4)]
 assert.equal(reviewDistribution(i).classified,0)
})
test('session-goal counts preserve their own denominator and can report a complete shape',()=>{
 const i=fixture();i.thresholds=[threshold('LT1',3),threshold('LT2',4)]
 i.window={...i.window,basis:'SESSION_GOAL',totalSessions:4}
 i.zoneSegments=[zone('a',10,1),zone('b',10,1,10),zone('c',10,1,20),zone('d',10,3,30)].map(r=>({...r,basis:'SESSION_GOAL'}))
 const d=reviewDistribution(i);assert.equal(d.unit,'sessions');assert.equal(d.denominator,4);assert.deepEqual(d.sharesPercent,[75,0,25])
})
