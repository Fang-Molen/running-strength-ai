import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assessPhysiology, fixedLactateCrossing } from './physiology'
import { fixture, meta, performance, threshold } from './test-fixtures'
test('measured same-test thresholds stay separate from CS and refuse unmatched test sessions',()=>{
 const i=fixture();i.thresholds=[threshold('LT1',3.2),threshold('LT2',4.2)]
 let r=assessPhysiology(i);assert.deepEqual(r.thresholds.speed?.values,[3.2,4.2]);assert.equal(r.cs.status,'UNAVAILABLE')
 i.thresholds=[threshold('LT1',3.2),{...threshold('LT2',4.2),testId:'another'}]
 assert.equal(assessPhysiology(i).thresholds.speed,null)
})
test('future, foreign, withdrawn and conflicting tests cannot become current thresholds',()=>{
 const i=fixture();i.thresholds=[threshold('LT1',3.2),threshold('LT2',4.2),{...threshold('LT2',4.2),revision:1,status:'RETRACTED'}]
 assert.equal(assessPhysiology(i).thresholds.speed,null)
 i.thresholds=[threshold('LT1',3.2),{...threshold('LT2',4.2),knownAt:'2026-10-24T00:00:00.000Z'}]
 assert.equal(assessPhysiology(i).thresholds.speed,null)
 i.thresholds=[threshold('LT1',3.2),{...threshold('LT2',4.2),athleteId:'other'}]
 assert.equal(assessPhysiology(i).thresholds.speed,null)
 i.thresholds=[threshold('LT1',3.2),threshold('LT2',4.2),{...threshold('LT2',4.4),id:'conflict'}]
 assert.equal(assessPhysiology(i).thresholds.speed,null)
})
test('CS uses existing OLS and never fills missing LT2',()=>{
 const i=fixture();i.performances=[180,360,720].map((s,n)=>performance('p'+n,4*s+150,s))
 const r=assessPhysiology(i);assert.equal(r.cs.status,'AVAILABLE');assert.ok(Math.abs(r.cs.value!-4)<1e-9);assert.equal(r.thresholds.speed,null);assert.equal(r.cs.decisionAuthorized,false)
 i.performances=i.performances.map(p=>({...p,effort:'INTERVAL'}));assert.equal(assessPhysiology(i).cs.status,'UNAVAILABLE')
})
test('special event profile uses actual race speed, and cannot convert interval reps to a race PB',()=>{
 const i=fixture();i.performances=[performance('p400',400,52),performance('p800',800,112),performance('p1500',1500,248)]
 const r=assessPhysiology(i);assert.equal(r.eventProfile.races.length,3);assert.ok(Math.abs(r.eventProfile.speedRetention800over400!-104/112)<1e-10)
 assert.equal(r.eventProfile.predicted800Seconds,null);assert.equal(r.eventProfile.aerobicContributionPercent,null)
 i.performances=i.performances.map(p=>({...p,effort:'INTERVAL'}));assert.equal(assessPhysiology(i).eventProfile.races.length,0)
})
test('fixed 4mmol crossing is OBLA4, not automatically LT2, and nonmonotone curves fail',()=>{
 const r=fixedLactateCrossing([{speed:3,lactate:1},{speed:4,lactate:3},{speed:5,lactate:5}],4)
 assert.equal(r?.speed,4.5);assert.equal(r?.label,'OBLA4');assert.equal(r?.isIndividualLT,false)
 assert.equal(fixedLactateCrossing([{speed:3,lactate:3},{speed:4,lactate:2}],4),null)
})
test('expired thresholds are not renewed from recent race performance',()=>{
 const i=fixture();i.thresholds=[threshold('LT1',3),{...threshold('LT2',4),validUntil:'2026-10-22T00:00:00.000Z'}]
 i.performances=[performance('p5k',5000,1000)];assert.equal(assessPhysiology(i).thresholds.speed,null)
})
test('VDOT is a performance index from sustained race, not VO2max or short-race prediction',()=>{
 const i=fixture();i.performances=[performance('5k',5000,1200)]
 const r=assessPhysiology(i);assert.ok(r.vdot&&r.vdot.value>49&&r.vdot.value<51);assert.equal(r.vdot?.measuredVO2max,false)
 i.performances=[performance('800',800,112)];assert.equal(assessPhysiology(i).vdot,null)
})


test('threshold pairs reject ambiguous lower endpoints with separate source record ids',()=>{
 const i=fixture();i.thresholds=[threshold('LT1',3),{...threshold('LT1',3.4),id:'other-low',sourceRecordId:'other-low'},threshold('LT2',4)]
 assert.equal(assessPhysiology(i).thresholds.speed,null)
})
test('latest means absolute instant, including valid timezone offset representations',()=>{
 const i=fixture(),early='2026-10-20T10:00:00+08:00',late='2026-10-20T09:00:00Z'
 i.thresholds=[{...threshold('LT1',3),occurredAt:early},{...threshold('LT2',4),occurredAt:early},
 {...threshold('LT1',3.5),id:'new-low',sourceRecordId:'new-low',testId:'new-test',occurredAt:late},
 {...threshold('LT2',4.5),id:'new-high',sourceRecordId:'new-high',testId:'new-test',occurredAt:late}]
 assert.deepEqual(assessPhysiology(i).thresholds.speed?.values,[3.5,4.5])
 i.performances=[{...performance('early',5000,1300),occurredAt:early},{...performance('late',5000,1200),occurredAt:late}]
 assert.equal(assessPhysiology(i).vdot?.sourceRef.id,'late')
})
